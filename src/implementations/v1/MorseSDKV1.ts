import type { MorseContractV1 } from "../../contracts/v1/MorseContractV1";
import type {
  CreateSignalOptions,
  CreateSignalOptionsEncrypted,
  CreateSignalResponse,
  CreateSignalResponseEncrypted,
  OpenSignalResponse,
  OpenSignalResponseDecrypted,
  ListMySignalsResponse,
  UploadFileOptions,
  UploadFileResponse,
  DownloadFileResponse,
  WalletAuth,
  SignalErrorResponse,
  MorseSDKConfig,
} from "../../types";
import { mapErrorResponse, NetworkError } from "../../errors";
import { RateLimiter, RateLimitError } from "../../rate-limiter";
import {
  generateKey,
  exportKey,
  importKey,
  encryptText,
  encryptFile,
  decryptText,
  decryptFile,
  getCipherVersion,
  generateShareableLink,
} from "../../crypto";
import {
  createSharedSignal,
  verifyKeyCertificate,
  generateSignalId,
  sealDataKey,
  type MorseKeyCert,
} from "../../crypto-x25519";
import { WalletKeyService } from "../../wallet-key-service";
import { validateSignalId, validateWalletAddress, normalizeSignalId } from "../../utils";

const API_BASE_URL = "https://api.morseai.tech";
const FRONTEND_BASE_URL = "https://morseai.tech";

export class MorseSDKV1 implements MorseContractV1 {
  readonly version = "v1" as const;

  private config: MorseSDKConfig;
  private timeout: number;
  private retries: number;
  private retryDelay: number;
  private rateLimiter: RateLimiter | null = null;

  constructor(config: MorseSDKConfig) {
    if (!config.apiKey) {
      throw new Error("apiKey is required. Please provide an API key in the SDK configuration.");
    }

    if (!config.apiKey.startsWith("sk_")) {
      throw new Error("Invalid API key format. API key must start with 'sk_'");
    }

    this.config = config;
    this.timeout = config.timeout || 30000;
    this.retries = config.retries || 0;
    this.retryDelay = config.retryDelay || 1000;

    if (config.rateLimit?.enabled !== false) {
      const maxRequests = config.rateLimit?.maxRequests || 100;
      const windowMs = config.rateLimit?.windowMs || 60000;
      this.rateLimiter = new RateLimiter({ maxRequests, windowMs });
    }

  }

  private base64ToUint8Array(base64: string): Uint8Array {
    if (typeof Buffer !== 'undefined') {
      return Uint8Array.from(Buffer.from(base64, 'base64'));
    }
    if (typeof atob !== 'undefined') {
      return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    }
    throw new Error('Base64 decoding not available. Requires Node.js Buffer or browser atob.');
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    if (typeof btoa !== 'undefined') {
      return btoa(String.fromCharCode(...bytes));
    }
    throw new Error('Base64 encoding not available. Requires Node.js Buffer or browser btoa.');
  }

  private sanitizeRequestOptions(options: RequestInit): RequestInit {
    const sanitized = { ...options };

    if (sanitized.body) {
      try {
        const body = JSON.parse(sanitized.body as string);
        const sanitizedBody: any = {};

        if (body.wallet) {
          sanitizedBody.wallet = {
            address: body.wallet.address,
            signature: '[REDACTED]',
            message: body.wallet.message,
          };
        }

        if (body.encryptedText) {
          sanitizedBody.encryptedText = '[REDACTED]';
        }

        if (body.payloadNonce) {
          sanitizedBody.payloadNonce = '[REDACTED]';
        }

        if (body.sealedDataKey) {
          sanitizedBody.sealedDataKey = '[REDACTED]';
        }

        if (body.file) {
          sanitizedBody.file = {
            ...body.file,
            payloadNonce: body.file.payloadNonce ? '[REDACTED]' : null,
            sealedDataKey: body.file.sealedDataKey ? '[REDACTED]' : null,
          };
        }

        if (body.signalId) {
          sanitizedBody.signalId = body.signalId;
        }

        sanitized.body = JSON.stringify(sanitizedBody);
      } catch {
        sanitized.body = '[REDACTED - non-JSON body]';
      }
    }

    return sanitized;
  }

  private getApiUrl(path: string): string {
    const version = this.config.apiVersion || "v1";
    return `${API_BASE_URL}/${version}${path}`;
  }

  private async createAuthMessage(action: string, context: string = ""): Promise<string> {
    const timestamp = Date.now();
    if (context) {
      return `MORSE: ${action} ${context} at ${timestamp}`;
    }
    return `MORSE: ${action} at ${timestamp}`;
  }

  private async signMessage(wallet: WalletAuth, message: string): Promise<string> {
    return await wallet.signMessage(message);
  }

  private async makeRequest<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (this.rateLimiter) {
      try {
        await this.rateLimiter.checkLimit();
      } catch (error) {
        if (error instanceof RateLimitError) {
          if (this.config.onError) {
            this.config.onError(error);
          }
          throw error;
        }
        throw error;
      }
    }


    const requestOptions: RequestInit = {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.config.apiKey,
        ...options.headers,
      },
    };

    if (this.config.onRequest) {
      const sanitizedOptions = this.sanitizeRequestOptions(requestOptions);
      this.config.onRequest(url, sanitizedOptions);
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          ...requestOptions,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (this.config.onResponse) {
          this.config.onResponse(url, response);
        }

        if (!response.ok) {
          const error: SignalErrorResponse = await response.json().catch(() => ({
            status: "error" as const,
            code: "VALIDATION_ERROR" as const,
            message: `HTTP ${response.status}: ${response.statusText}`,
          }));


          const mappedError = mapErrorResponse(error);

          if (this.config.onError) {
            this.config.onError(mappedError);
          }

          throw mappedError;
        }

        const data = await response.json();
        return data;
      } catch (error: any) {
        lastError = error;

        if (error.name === "AbortError") {
          const timeoutError = new NetworkError(`Request timeout after ${this.timeout}ms`, error);
          if (this.config.onError) {
            this.config.onError(timeoutError);
          }
          throw timeoutError;
        }

        if (error instanceof NetworkError || error.name?.includes("Error")) {
          if (attempt < this.retries) {
            await new Promise(resolve => setTimeout(resolve, this.retryDelay * (attempt + 1)));
            continue;
          }

          if (this.config.onError) {
            this.config.onError(error);
          }
          throw error;
        }

        if (error.message?.includes("fetch") || error.message?.includes("network")) {
          if (attempt < this.retries) {
            await new Promise(resolve => setTimeout(resolve, this.retryDelay * (attempt + 1)));
            continue;
          }

          const networkError = new NetworkError("Network request failed", error);
          if (this.config.onError) {
            this.config.onError(networkError);
          }
          throw networkError;
        }

        if (this.config.onError) {
          this.config.onError(error);
        }
        throw error;
      }
    }

    if (lastError) {
      if (this.config.onError) {
        this.config.onError(lastError);
      }
      throw lastError;
    }

    throw new NetworkError("Request failed after all retries");
  }

  async createSignal(
    wallet: WalletAuth,
    options: CreateSignalOptions
  ): Promise<CreateSignalResponse> {
    validateWalletAddress(wallet.address);

    if (options.walletTarget) {
      validateWalletAddress(options.walletTarget);
    }

    if (options.shareWithRecipient && !options.walletTarget) {
      throw new Error("walletTarget is required when shareWithRecipient is true");
    }

    if (!options.hasFile && !options.hasMessage) {
      throw new Error("Either hasFile or hasMessage must be true");
    }

    const tempSignalId = "temp-" + Date.now();
    const authMessage = await this.createAuthMessage("create", `signal ${tempSignalId}`);
    const signature = await this.signMessage(wallet, authMessage);

    const requestBody = {
      ...options,
      wallet: {
        address: wallet.address,
        signature,
        message: authMessage,
      },
    };

    const result = await this.makeRequest<CreateSignalResponse>(
      this.getApiUrl("/signals"),
      {
        method: "POST",
        body: JSON.stringify(requestBody),
      }
    );

    return result;
  }

  async openSignal(
    wallet: WalletAuth,
    signalId: string
  ): Promise<OpenSignalResponse> {
    signalId = normalizeSignalId(signalId);
    validateSignalId(signalId);
    validateWalletAddress(wallet.address);

    const authMessage = await this.createAuthMessage("open", `signal ${signalId}`);
    const signature = await this.signMessage(wallet, authMessage);

    const requestBody = {
      signalId,
      wallet: {
        address: wallet.address,
        signature,
        message: authMessage,
      },
    };

    const result = await this.makeRequest<OpenSignalResponse>(
      this.getApiUrl("/signals/open"),
      {
        method: "POST",
        body: JSON.stringify(requestBody),
      }
    );

    return result;
  }

  async openSignalDecrypted(
    wallet: WalletAuth,
    signalId: string,
    keyBase64?: string
  ): Promise<OpenSignalResponseDecrypted> {
    signalId = normalizeSignalId(signalId);
    signalId = normalizeSignalId(signalId);
    validateSignalId(signalId);
    validateWalletAddress(wallet.address);

    const encryptedResponse = await this.openSignal(wallet, signalId);

    const isX25519Signal = Boolean(
      encryptedResponse.sealedDataKey &&
      encryptedResponse.sealedNonce &&
      encryptedResponse.senderEphemeralPublicKey
    );

    let message: string | null = null;
    let fileData: ArrayBuffer | null = null;
    let fileName: string | null = null;
    let fileMimeType: string | null = null;
    let keySource: "derived" | "provided" = "derived";

    if (isX25519Signal) {
      const { openSharedSignal } = await import("../../crypto-x25519");

      const walletTarget = encryptedResponse.walletTarget || wallet.address;
      const walletCreator = encryptedResponse.walletCreator || wallet.address;
      const expiresAtMs = Math.floor(new Date(encryptedResponse.expiresAt).getTime());

      const isPrivateSignal = walletTarget.toLowerCase() === walletCreator.toLowerCase();

      const keyService = new WalletKeyService(API_BASE_URL, this.config.apiKey, this.config.apiVersion || "v1");
      const certificateWallet = isPrivateSignal ? walletCreator : walletTarget;
      const certResponse = await keyService.getPublicKey(certificateWallet);

      if (!certResponse.exists || !certResponse.certificate) {
        if (isPrivateSignal) {
          throw new Error(
            `Certificate not found for creator ${walletCreator}. ` +
            `The creator needs to publish their public key certificate first.`
          );
        } else {
          throw new Error(
            `Certificate not found for recipient ${walletTarget}. ` +
            `The recipient needs to publish their public key certificate first. ` +
            `They can do this by opening any shared signal sent to them, or visiting the app.`
          );
        }
      }

      const domain = certResponse.certificate.domain || "morseai.tech";
      const chainId = certResponse.certificate.chainId ?? 1;

      if (encryptedResponse.encryptedText && encryptedResponse.payloadNonce) {
        const payloadNonceBytes = Buffer.from(encryptedResponse.payloadNonce, "base64");
        const isAesGcm = payloadNonceBytes.length === 12;

        if (isAesGcm) {
          const { unsealDataKey } = await import("../../crypto-x25519");
          const dataKeyBytes = await unsealDataKey(
            encryptedResponse.sealedDataKey!,
            encryptedResponse.sealedNonce!,
            encryptedResponse.senderEphemeralPublicKey!,
            signalId,
            walletTarget,
            walletCreator,
            expiresAtMs,
            encryptedResponse.aadHash || "",
            wallet.address,
            domain,
            chainId,
            wallet.signMessage
          );

          const keyBase64 = Buffer.from(dataKeyBytes).toString("base64");
          const key = await importKey(keyBase64);
          message = await decryptText(encryptedResponse.encryptedText, encryptedResponse.payloadNonce, key);
        } else {
          const decryptedBytes = await openSharedSignal(
            encryptedResponse.encryptedText,
            encryptedResponse.payloadNonce,
            encryptedResponse.sealedDataKey!,
            encryptedResponse.sealedNonce!,
            encryptedResponse.senderEphemeralPublicKey!,
            signalId,
            walletTarget,
            walletCreator,
            expiresAtMs,
            encryptedResponse.aadHash || "",
            wallet.address,
            domain,
            chainId,
            wallet.signMessage
          );
          message = new TextDecoder().decode(decryptedBytes);
        }
      }

      if (encryptedResponse.file) {
        const fileResponse = await this.downloadFile(wallet, signalId);
        const encryptedFileBase64 = fileResponse.file;

        const fileSealedDataKey = encryptedResponse.file.sealedDataKey || encryptedResponse.sealedDataKey;
        const fileSealedNonce = encryptedResponse.file.sealedNonce || encryptedResponse.sealedNonce;
        const fileSenderEphemeralPublicKey = encryptedResponse.file.senderEphemeralPublicKey || encryptedResponse.senderEphemeralPublicKey;
        const fileAadHash = encryptedResponse.file.aadHash || encryptedResponse.aadHash || "";

        if (fileSealedDataKey && fileSealedNonce && fileSenderEphemeralPublicKey && encryptedResponse.file.payloadNonce) {
          if (isPrivateSignal) {
            const { unsealDataKey } = await import("../../crypto-x25519");
            const { decryptFile, importKey } = await import("../../crypto");

            const creatorCertResponse = await keyService.getPublicKey(walletCreator);
            if (!creatorCertResponse.exists || !creatorCertResponse.certificate) {
              throw new Error("Creator's certificate not found. Cannot decrypt this signal.");
            }
            const creatorDomain = creatorCertResponse.certificate.domain || "morseai.tech";
            const creatorChainId = creatorCertResponse.certificate.chainId ?? 1;

            const dataKeyBytes = await unsealDataKey(
              fileSealedDataKey,
              fileSealedNonce,
              fileSenderEphemeralPublicKey,
              signalId, // Use main signalId, not signalId-file for private signals
              walletTarget.toLowerCase(),
              walletCreator.toLowerCase(),
              expiresAtMs,
              fileAadHash,
              wallet.address,
              creatorDomain,
              creatorChainId,
              wallet.signMessage
            );

            if (dataKeyBytes.length !== 32) {
              throw new Error(`Invalid data key length: expected 32 bytes, got ${dataKeyBytes.length}`);
            }
            const keyArray = dataKeyBytes instanceof Uint8Array ? dataKeyBytes : new Uint8Array(dataKeyBytes);
            const keyBase64 = btoa(String.fromCharCode(...keyArray));
            const key = await importKey(keyBase64);

            const encryptedFileBytes = Buffer.from(encryptedFileBase64, "base64");
            const encryptedFileBuffer = encryptedFileBytes.buffer.slice(
              encryptedFileBytes.byteOffset,
              encryptedFileBytes.byteOffset + encryptedFileBytes.byteLength
            ) as ArrayBuffer;
            fileData = await decryptFile(encryptedFileBuffer, encryptedResponse.file.payloadNonce, key);
            fileName = encryptedResponse.file.originalName || "file";
            fileMimeType = encryptedResponse.file.mimeType || "application/octet-stream";
          } else {
            const fileCertResponse = await keyService.getPublicKey(walletTarget);
            if (!fileCertResponse.exists || !fileCertResponse.certificate) {
              throw new Error(
                `Certificate not found for recipient ${walletTarget}. ` +
                `The recipient needs to publish their public key certificate first.`
              );
            }
            const fileDomain = fileCertResponse.certificate.domain || "morseai.tech";
            const fileChainId = fileCertResponse.certificate.chainId ?? 1;
            const fileWalletCreator = (encryptedResponse.walletCreator || "").toLowerCase();

            const decryptedFileBytes = await openSharedSignal(
              encryptedFileBase64,
              encryptedResponse.file.payloadNonce,
              fileSealedDataKey,
              fileSealedNonce,
              fileSenderEphemeralPublicKey,
              `${signalId}-file`, // Use hyphen like frontend
              walletTarget.toLowerCase(),
              fileWalletCreator,
              expiresAtMs,
              fileAadHash,
              wallet.address,
              fileDomain,
              fileChainId,
              wallet.signMessage
            );
            fileData = decryptedFileBytes.buffer.slice(
              decryptedFileBytes.byteOffset,
              decryptedFileBytes.byteOffset + decryptedFileBytes.byteLength
            ) as ArrayBuffer;
            fileName = encryptedResponse.file.originalName || "file";
            fileMimeType = encryptedResponse.file.mimeType || "application/octet-stream";
          }
        } else {
          throw new Error("File encryption format not supported for this signal type");
        }
      }

      keySource = "derived";
    } else {
      if (!keyBase64 || typeof keyBase64 !== 'string' || keyBase64.length < 32) {
        throw new Error("This signal requires an encryption key. Please provide the key from the URL fragment (#k=...).");
      }

      const key = await importKey(keyBase64);

      if (encryptedResponse.encryptedText && encryptedResponse.payloadNonce) {
        message = await decryptText(encryptedResponse.encryptedText, encryptedResponse.payloadNonce, key);
      }

      if (encryptedResponse.file) {
        const fileResponse = await this.downloadFile(wallet, signalId);
        const encryptedFileData = this.base64ToUint8Array(fileResponse.file);
        const buffer = encryptedFileData.buffer.slice(
          encryptedFileData.byteOffset,
          encryptedFileData.byteOffset + encryptedFileData.byteLength
        ) as ArrayBuffer;
        fileData = await decryptFile(buffer, encryptedResponse.file.payloadNonce, key);
      }

      keySource = "provided";
    }

    return {
      message,
      file: encryptedResponse.file && fileData && fileName && fileMimeType
        ? {
          data: fileData,
          originalName: fileName,
          mimeType: fileMimeType,
          sizeBytes: encryptedResponse.file.sizeBytes,
        }
        : null,
      expiresAt: encryptedResponse.expiresAt,
      onChainNotification: encryptedResponse.onChainNotification,
      keySource,
    };
  }

  async listMySignals(wallet: WalletAuth): Promise<ListMySignalsResponse> {
    const authMessage = await this.createAuthMessage("view", "vault");
    const signature = await this.signMessage(wallet, authMessage);

    const params = new URLSearchParams({
      walletAddress: wallet.address,
      walletSignature: signature,
      walletMessage: authMessage,
    });

    return this.makeRequest<ListMySignalsResponse>(
      `${this.getApiUrl("/signals/my-signals")}?${params.toString()}`,
      {
        method: "GET",
      }
    );
  }

  async uploadFile(
    wallet: WalletAuth,
    options: UploadFileOptions
  ): Promise<UploadFileResponse> {
    const authMessage = await this.createAuthMessage("upload", "file");
    const signature = await this.signMessage(wallet, authMessage);

    const requestBody = {
      ...options,
      wallet: {
        address: wallet.address,
        signature,
        message: authMessage,
      },
    };

    return this.makeRequest<UploadFileResponse>(
      this.getApiUrl("/files/upload"),
      {
        method: "POST",
        body: JSON.stringify(requestBody),
      }
    );
  }

  async downloadFile(
    wallet: WalletAuth,
    signalId: string
  ): Promise<DownloadFileResponse> {
    const authMessage = await this.createAuthMessage("download", `file ${signalId}`);
    const signature = await this.signMessage(wallet, authMessage);

    const requestBody = {
      signalId,
      wallet: {
        address: wallet.address,
        signature,
        message: authMessage,
      },
    };

    return this.makeRequest<DownloadFileResponse>(
      this.getApiUrl("/files/download"),
      {
        method: "POST",
        body: JSON.stringify(requestBody),
      }
    );
  }

  async downloadFileDecrypted(
    wallet: WalletAuth,
    signalId: string,
    keyBase64: string
  ): Promise<{ data: ArrayBuffer; originalName: string; mimeType: string; sizeBytes: number }> {
    const encryptedResponse = await this.openSignal(wallet, signalId);

    if (!encryptedResponse.file) {
      throw new Error("Signal does not have a file");
    }

    const fileResponse = await this.downloadFile(wallet, signalId);
    const key = await importKey(keyBase64);
    const encryptedFileData = this.base64ToUint8Array(fileResponse.file);
    const buffer = encryptedFileData.buffer.slice(
      encryptedFileData.byteOffset,
      encryptedFileData.byteOffset + encryptedFileData.byteLength
    ) as ArrayBuffer;
    const decryptedData = await decryptFile(buffer, encryptedResponse.file.payloadNonce, key);

    return {
      data: decryptedData,
      originalName: fileResponse.originalName,
      mimeType: fileResponse.mimeType,
      sizeBytes: fileResponse.sizeBytes,
    };
  }

  async createSignalEncrypted(
    wallet: WalletAuth,
    options: CreateSignalOptionsEncrypted
  ): Promise<CreateSignalResponseEncrypted> {
    validateWalletAddress(wallet.address);

    const shareWithRecipient = options.mode === "shared_wallet";

    if (options.mode === "shared_wallet" && !options.walletTarget) {
      throw new Error("walletTarget is required when mode is 'shared_wallet'");
    }

    if (options.walletTarget) {
      validateWalletAddress(options.walletTarget);
    }

    if (!options.message && !options.file) {
      throw new Error("Either message or file must be provided");
    }

    if (!options.expiresIn && !options.expiresAt) {
      throw new Error(
        "Either expiresIn or expiresAt must be provided.\n" +
        "  - expiresIn: relative time (e.g., '24h', '7d', '1h')\n" +
        "  - expiresAt: specific date (ISO 8601, e.g., '2026-12-31T23:59:59.000Z')"
      );
    }

    if (options.expiresIn && options.expiresAt) {
      throw new Error("Cannot provide both expiresIn and expiresAt. Use only one.");
    }

    const mergedOptions: CreateSignalOptionsEncrypted & { shareWithRecipient: boolean } = {
      ...options,
      shareWithRecipient,
    };

    if (shareWithRecipient && options.walletTarget) {
      return this.createSharedSignalEncrypted(wallet, mergedOptions);
    }

    return this.createPrivateSignalEncrypted(wallet, mergedOptions);
  }

  private async createPrivateSignalEncrypted(
    wallet: WalletAuth,
    options: CreateSignalOptionsEncrypted & { shareWithRecipient: boolean }
  ): Promise<CreateSignalResponseEncrypted> {
    const key = await generateKey();
    const keyBase64 = await exportKey(key);

    const signalId = options.signalId || generateSignalId();

    let expiresAtMs: number;
    if (options.expiresAt) {
      expiresAtMs = new Date(options.expiresAt).getTime();
    } else if (options.expiresIn) {
      const match = options.expiresIn.match(/^(\d+)([smhd])$/);
      if (!match) throw new Error("Invalid expiresIn format");
      const value = parseInt(match[1], 10);
      const unit = match[2];
      const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
      expiresAtMs = Date.now() + value * multipliers[unit];
    } else {
      expiresAtMs = Date.now() + 24 * 60 * 60 * 1000;
    }

    const walletTarget = wallet.address;
    const walletCreator = wallet.address;

    const keyService = new WalletKeyService(API_BASE_URL, this.config.apiKey, this.config.apiVersion || "v1");
    const creatorKeyResponse = await keyService.getPublicKey(wallet.address);

    let domain: string;
    let chainId: number;
    let creatorPubKey: Buffer;

    if (creatorKeyResponse.exists && creatorKeyResponse.certificate) {
      domain = creatorKeyResponse.certificate.domain || options.domain || "morseai.tech";
      chainId = creatorKeyResponse.certificate.chainId ?? (options.chainId ?? 8453);
      creatorPubKey = Buffer.from(creatorKeyResponse.certificate.x25519PublicKey, "base64");

    } else {
      domain = options.domain || "morseai.tech";
      chainId = options.chainId ?? 8453;

      const { deriveKeyPairFromWalletSignature, createKeyCertificate } = await import("../../crypto-x25519");
      const creatorKeypair = await deriveKeyPairFromWalletSignature(
        wallet.address,
        domain,
        chainId,
        wallet.signMessage
      );
      const publicKeyBase64 = Buffer.from(creatorKeypair.publicKey).toString("base64");
      creatorPubKey = Buffer.from(creatorKeypair.publicKey);
      const expiresAtMsCert = Date.now() + (30 * 24 * 60 * 60 * 1000);

      let signTypedDataFn: (domain: any, types: any, value: any) => Promise<string>;
      if (wallet.signTypedData) {
        signTypedDataFn = wallet.signTypedData;
      } else {
        throw new Error(
          "signTypedData is required for publishing public key certificate. " +
          "Please ensure your WalletAuth includes signTypedData. " +
          "If using createWalletFromPrivateKey, update to the latest version of the SDK."
        );
      }

      const certificate = await createKeyCertificate(
        wallet.address,
        publicKeyBase64,
        domain,
        chainId,
        expiresAtMsCert,
        signTypedDataFn
      );
      await keyService.publishPublicKey(certificate);
    }

    const keyBytes = this.base64ToUint8Array(keyBase64);

    let sealedBox;
    try {
      sealedBox = await sealDataKey(
        keyBytes,
        walletTarget.toLowerCase(),
        walletCreator.toLowerCase(),
        expiresAtMs,
        signalId,
        new Uint8Array(creatorPubKey)
      );
    } catch (sealError: any) {
      throw new Error(`Failed to seal encryption key: ${sealError.message || String(sealError)}`);
    }

    let encryptedText: string | undefined;
    let payloadNonce: string | undefined;
    let fileOptions: CreateSignalOptions["file"] | undefined;

    if (options.message) {
      const encrypted = await encryptText(options.message, key);
      encryptedText = encrypted.encrypted;
      payloadNonce = encrypted.iv;
    }

    if (options.file) {
      const uploadResult = await this.uploadFileEncrypted(
        wallet,
        options.file.data,
        options.file.originalName,
        options.file.mimeType,
        key
      );

      const encrypted = await encryptFile(options.file.data, key);

      fileOptions = {
        storagePath: uploadResult.storagePath,
        payloadNonce: encrypted.iv,
        originalName: options.file.originalName,
        mimeType: options.file.mimeType,
        sizeBytes: uploadResult.sizeBytes,
      };
    }

    const signalOptions: CreateSignalOptions = {
      signalId,
      walletTarget: options.walletTarget,
      shareWithRecipient: options.shareWithRecipient,
      mode: options.mode,
      hasFile: !!options.file,
      hasMessage: !!options.message,
      cipherVersion: getCipherVersion(),
      encryptedText,
      payloadNonce,
      sealedDataKey: sealedBox.sealedDataKey,
      sealedNonce: sealedBox.sealedNonce,
      senderEphemeralPublicKey: sealedBox.senderEphemeralPublicKey,
      aadHash: sealedBox.aadHash,
      file: fileOptions,
      onChainNotification: options.onChainNotification,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };

    const result = await this.createSignal(wallet, signalOptions);
    const shareableLink = generateShareableLink(FRONTEND_BASE_URL, result.signalId);

    return {
      ...result,
      shareableLink,
    };
  }

  private async createSharedSignalEncrypted(
    wallet: WalletAuth,
    options: CreateSignalOptionsEncrypted & { shareWithRecipient: boolean }
  ): Promise<CreateSignalResponseEncrypted> {
    const walletTarget = options.walletTarget!;
    const walletCreator = wallet.address;

    const signalId = options.signalId || generateSignalId();

    let expiresAtMs: number;
    if (options.expiresAt) {
      expiresAtMs = new Date(options.expiresAt).getTime();
    } else if (options.expiresIn) {
      const match = options.expiresIn.match(/^(\d+)([smhd])$/);
      if (!match) throw new Error("Invalid expiresIn format");
      const value = parseInt(match[1], 10);
      const unit = match[2];
      const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
      expiresAtMs = Date.now() + value * multipliers[unit];
    } else {
      expiresAtMs = Date.now() + 24 * 60 * 60 * 1000; // Default 24h
    }

    const keyService = new WalletKeyService(API_BASE_URL, this.config.apiKey, this.config.apiVersion || "v1");
    const recipientKeyResponse = await keyService.getPublicKey(walletTarget);

    if (!recipientKeyResponse.exists || !recipientKeyResponse.certificate) {
      throw new Error(
        `Certificate not found for recipient ${walletTarget}. ` +
        `The recipient needs to publish their public key certificate first. ` +
        `They can do this by opening any shared signal sent to them, or visiting the app.`
      );
    }

    if (!verifyKeyCertificate(recipientKeyResponse.certificate)) {
      throw new Error("Recipient's key certificate signature verification failed");
    }

    if (Date.now() > recipientKeyResponse.certificate.expiresAt) {
      throw new Error("Recipient's key certificate has expired");
    }

    const recipientPubKey = Buffer.from(recipientKeyResponse.certificate.x25519PublicKey, "base64");

    let payloadText = "";
    if (options.message) {
      payloadText = options.message;
    }
    const payloadBytes = new TextEncoder().encode(payloadText);

    const sealedResult = await createSharedSignal(
      payloadBytes,
      new Uint8Array(recipientPubKey),
      walletTarget,
      walletCreator,
      expiresAtMs,
      signalId
    );

    let fileOptions: CreateSignalOptions["file"] | undefined;

    if (options.file) {
      const fileBytes = options.file.data instanceof ArrayBuffer
        ? new Uint8Array(options.file.data)
        : new Uint8Array(options.file.data);

      const fileSealedResult = await createSharedSignal(
        fileBytes,
        new Uint8Array(recipientPubKey),
        walletTarget,
        walletCreator,
        expiresAtMs,
        signalId + "_file"
      );

      const uploadResult = await this.uploadFile(wallet, {
        file: fileSealedResult.encryptedPayload,
        originalName: options.file.originalName,
        mimeType: options.file.mimeType,
      });

      fileOptions = {
        storagePath: uploadResult.storagePath,
        payloadNonce: fileSealedResult.payloadNonce,
        originalName: options.file.originalName,
        mimeType: options.file.mimeType,
        sizeBytes: uploadResult.sizeBytes,
        sealedDataKey: fileSealedResult.sealedDataKey,
        sealedNonce: fileSealedResult.sealedNonce,
        senderEphemeralPublicKey: fileSealedResult.senderEphemeralPublicKey,
        aadHash: fileSealedResult.aadHash,
      };
    }

    const signalOptions: CreateSignalOptions = {
      signalId,
      walletTarget,
      shareWithRecipient: true,
      mode: "shared_wallet",
      hasFile: !!options.file,
      hasMessage: !!options.message,
      cipherVersion: sealedResult.cipherVersion,
      encryptedText: options.message ? sealedResult.encryptedPayload : undefined,
      payloadNonce: options.message ? sealedResult.payloadNonce : undefined,
      sealedDataKey: sealedResult.sealedDataKey,
      sealedNonce: sealedResult.sealedNonce,
      senderEphemeralPublicKey: sealedResult.senderEphemeralPublicKey,
      aadHash: sealedResult.aadHash,
      file: fileOptions,
      onChainNotification: options.onChainNotification,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };

    const result = await this.createSignal(wallet, signalOptions);

    const shareableLink = `${FRONTEND_BASE_URL}/view/${result.signalId}`;

    return {
      ...result,
      shareableLink
    };
  }

  async uploadFileEncrypted(
    wallet: WalletAuth,
    fileData: ArrayBuffer | Uint8Array | Buffer,
    originalName: string,
    mimeType: string,
    key: CryptoKey
  ): Promise<UploadFileResponse> {
    const encrypted = await encryptFile(fileData, key);
    const encryptedBase64 = this.arrayBufferToBase64(encrypted.encrypted);

    return this.uploadFile(wallet, {
      file: encryptedBase64,
      originalName,
      mimeType,
    });
  }

  async burnSignal(wallet: WalletAuth, signalId: string): Promise<{ success: boolean }> {
    signalId = normalizeSignalId(signalId);
    validateSignalId(signalId);
    validateWalletAddress(wallet.address);

    const authMessage = await this.createAuthMessage("burn", `signal ${signalId}`);
    const signature = await this.signMessage(wallet, authMessage);

    const requestBody = {
      signalId,
      wallet: {
        address: wallet.address,
        signature,
        message: authMessage,
      },
    };

    const result = await this.makeRequest<{ success: boolean }>(
      this.getApiUrl("/signals/burn"),
      {
        method: "POST",
        body: JSON.stringify(requestBody),
      }
    );

    return result;
  }
}

