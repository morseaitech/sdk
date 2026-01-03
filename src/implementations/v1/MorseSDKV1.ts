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
import { logger } from "../../logger";
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
  type MorseKeyCert,
} from "../../crypto-x25519";
import { WalletKeyService } from "../../wallet-key-service";
import { validateSignalId, validateWalletAddress } from "../../utils";

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

    logger.debug("MorseSDKV1 initialized", {
      apiVersion: config.apiVersion || "v1",
      timeout: this.timeout,
      retries: this.retries,
      rateLimitEnabled: this.rateLimiter !== null,
      hasApiKey: !!config.apiKey,
    });
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
          logger.warn("Rate limit exceeded", {
            url,
            retryAfterMs: error.retryAfterMs
          });
          if (this.config.onError) {
            this.config.onError(error);
          }
          throw error;
        }
        throw error;
      }
    }

    logger.debug("Making request", {
      url,
      method: options.method || "GET",
      hasBody: !!options.body,
    });

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

          logger.error("Request failed", {
            status: response.status,
            code: error.code,
            message: error.message,
            attempt: attempt + 1,
          });

          const mappedError = mapErrorResponse(error);

          if (this.config.onError) {
            this.config.onError(mappedError);
          }

          throw mappedError;
        }

        const data = await response.json();
        logger.debug("Request successful", { url, attempt: attempt + 1 });
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
            logger.warn(`Request failed, retrying... (${attempt + 1}/${this.retries})`, { url });
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
            logger.warn(`Network error, retrying... (${attempt + 1}/${this.retries})`, { url });
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

    logger.info("Creating signal", {
      hasFile: options.hasFile,
      hasMessage: options.hasMessage,
      mode: options.mode,
    });

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

    logger.info("Signal created", { signalId: result.signalId });
    return result;
  }

  async openSignal(
    wallet: WalletAuth,
    signalId: string
  ): Promise<OpenSignalResponse> {
    validateSignalId(signalId);
    validateWalletAddress(wallet.address);

    logger.info("Opening signal", { signalId });

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

    logger.info("Signal opened", { signalId, hasFile: !!result.file });
    return result;
  }

  async openSignalDecrypted(
    wallet: WalletAuth,
    signalId: string,
    keyBase64?: string
  ): Promise<OpenSignalResponseDecrypted> {
    validateSignalId(signalId);
    validateWalletAddress(wallet.address);

    const encryptedResponse = await this.openSignal(wallet, signalId);

    // Check if this is an X25519 signal
    const isX25519Signal = Boolean(
      encryptedResponse.sealedDataKey &&
      encryptedResponse.sealedNonce &&
      encryptedResponse.senderEphemeralPublicKey
    );

    let message: string | null = null;
    let fileData: ArrayBuffer | null = null;
    let keySource: "derived" | "provided" = "derived";

    if (isX25519Signal) {
      // X25519 signal - decrypt using wallet
      const { openSharedSignal } = await import("../../crypto-x25519");

      const walletTarget = encryptedResponse.walletTarget || wallet.address;
      const walletCreator = encryptedResponse.walletCreator || wallet.address;
      const expiresAtMs = new Date(encryptedResponse.expiresAt).getTime();

      // Fetch domain and chainId from the recipient's certificate
      const keyService = new WalletKeyService(API_BASE_URL, this.config.apiKey, this.config.apiVersion || "v1");
      const certResponse = await keyService.getPublicKey(wallet.address);

      const domain = certResponse.certificate?.domain || "morseai.tech";
      const chainId = certResponse.certificate?.chainId || 1;

      if (encryptedResponse.encryptedText && encryptedResponse.payloadNonce) {
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

      // Handle X25519 file decryption
      if (encryptedResponse.file) {
        const fileResponse = await this.downloadFile(wallet, signalId);
        const encryptedFileBase64 = fileResponse.file;

        // Use file-specific sealed key data if available, otherwise fall back to signal-level data
        const fileSealedDataKey = encryptedResponse.file.sealedDataKey || encryptedResponse.sealedDataKey;
        const fileSealedNonce = encryptedResponse.file.sealedNonce || encryptedResponse.sealedNonce;
        const fileSenderEphemeralPublicKey = encryptedResponse.file.senderEphemeralPublicKey || encryptedResponse.senderEphemeralPublicKey;
        const fileAadHash = encryptedResponse.file.aadHash || encryptedResponse.aadHash || "";

        if (fileSealedDataKey && fileSealedNonce && fileSenderEphemeralPublicKey && encryptedResponse.file.payloadNonce) {
          // File is encrypted with X25519
          const decryptedFileBytes = await openSharedSignal(
            encryptedFileBase64,
            encryptedResponse.file.payloadNonce,
            fileSealedDataKey,
            fileSealedNonce,
            fileSenderEphemeralPublicKey,
            `${signalId}-file`, // Use hyphen like frontend
            walletTarget.toLowerCase(),
            walletCreator.toLowerCase(),
            expiresAtMs,
            fileAadHash,
            wallet.address,
            domain,
            chainId,
            wallet.signMessage
          );
          fileData = decryptedFileBytes.buffer.slice(
            decryptedFileBytes.byteOffset,
            decryptedFileBytes.byteOffset + decryptedFileBytes.byteLength
          ) as ArrayBuffer;
        } else {
          // File is encrypted with AES-GCM (legacy or private signal)
          // This shouldn't happen for X25519 signals, but handle it gracefully
          throw new Error("File encryption format not supported for this signal type");
        }
      }

      keySource = "derived";
    } else {
      // AES-GCM signal - decrypt using provided key
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
      file: encryptedResponse.file && fileData
        ? {
          data: fileData,
          originalName: encryptedResponse.file.originalName,
          mimeType: encryptedResponse.file.mimeType,
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

    // SECURITY: shareWithRecipient is determined by mode - cannot be overridden
    const shareWithRecipient = options.mode === "shared_wallet";

    // Validate mode consistency
    if (options.mode === "shared_wallet" && !options.walletTarget) {
      throw new Error("walletTarget is required when mode is 'shared_wallet'");
    }

    if (options.walletTarget) {
      validateWalletAddress(options.walletTarget);
    }

    if (!options.message && !options.file) {
      throw new Error("Either message or file must be provided");
    }

    // Validate expiration - either expiresIn or expiresAt must be provided
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

    // Merge shareWithRecipient (determined by mode) into options
    const mergedOptions: CreateSignalOptionsEncrypted & { shareWithRecipient: boolean } = {
      ...options,
      shareWithRecipient,
    };

    // For shared signals, use X25519 encryption
    if (shareWithRecipient && options.walletTarget) {
      return this.createSharedSignalEncrypted(wallet, mergedOptions);
    }

    // For private signals, use simple AES-GCM with key in URL
    return this.createPrivateSignalEncrypted(wallet, mergedOptions);
  }

  private async createPrivateSignalEncrypted(
    wallet: WalletAuth,
    options: CreateSignalOptionsEncrypted & { shareWithRecipient: boolean }
  ): Promise<CreateSignalResponseEncrypted> {
    const key = await generateKey();
    const keyBase64 = await exportKey(key);

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
      walletTarget: options.walletTarget,
      shareWithRecipient: options.shareWithRecipient,
      mode: options.mode,
      hasFile: !!options.file,
      hasMessage: !!options.message,
      cipherVersion: getCipherVersion(),
      encryptedText,
      payloadNonce,
      file: fileOptions,
      onChainNotification: options.onChainNotification,
      expiresAt: options.expiresAt,
      expiresIn: options.expiresIn,
    };

    const result = await this.createSignal(wallet, signalOptions);
    const shareableLink = generateShareableLink(FRONTEND_BASE_URL, result.signalId, keyBase64);

    return {
      ...result,
      keyBase64,
      shareableLink,
    };
  }

  private async createSharedSignalEncrypted(
    wallet: WalletAuth,
    options: CreateSignalOptionsEncrypted & { shareWithRecipient: boolean }
  ): Promise<CreateSignalResponseEncrypted> {
    const walletTarget = options.walletTarget!;
    const walletCreator = wallet.address;

    // Generate signal ID upfront (needed for encryption)
    const signalId = options.signalId || generateSignalId();

    // Calculate expiration
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

    // Get recipient's public key from registry
    const keyService = new WalletKeyService(API_BASE_URL, this.config.apiKey, this.config.apiVersion || "v1");
    const recipientKeyResponse = await keyService.getPublicKey(walletTarget);

    if (!recipientKeyResponse.exists || !recipientKeyResponse.certificate) {
      throw new Error(
        `Public key not found for recipient ${walletTarget}. ` +
        `The recipient needs to publish their public key first. ` +
        `They can do this by opening any shared signal sent to them, or visiting the app.`
      );
    }

    // Verify certificate
    if (!verifyKeyCertificate(recipientKeyResponse.certificate)) {
      throw new Error("Recipient's key certificate signature verification failed");
    }

    // Check expiration
    if (Date.now() > recipientKeyResponse.certificate.expiresAt) {
      throw new Error("Recipient's key certificate has expired");
    }

    const recipientPubKey = Buffer.from(recipientKeyResponse.certificate.x25519PublicKey, "base64");

    // Prepare payload
    let payloadText = "";
    if (options.message) {
      payloadText = options.message;
    }
    const payloadBytes = new TextEncoder().encode(payloadText);

    // Create shared signal with X25519 encryption
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
      // Encrypt file with same mechanism
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

      // Upload encrypted file
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

    // For X25519 signals, no key in URL (recipient decrypts with their wallet)
    const shareableLink = `${FRONTEND_BASE_URL}/view/${result.signalId}`;

    return {
      ...result,
      keyBase64: "", // No key needed for X25519 signals
      shareableLink,
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
    validateSignalId(signalId);
    validateWalletAddress(wallet.address);

    logger.info("Burning signal", { signalId });

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

    logger.info("Signal burned successfully", { signalId });
    return result;
  }
}

