export type SignalMode = "private" | "shared_wallet";

export type SignalStatus = "active" | "used" | "expired";

export type OnChainNotificationStatus = "pending" | "minted" | "failed" | null;

export interface OnChainNotification {
  enabled: boolean;
  network: string;
  status: OnChainNotificationStatus;
  txHash: string | null;
  tokenId: string | null;
  expiresAt: string | null;
}

export interface SignalFile {
  storagePath: string;
  payloadNonce: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sealedDataKey?: string | null;
  sealedNonce?: string | null;
  senderEphemeralPublicKey?: string | null;
  aadHash?: string | null;
}

export interface CreateSignalOptions {
  signalId?: string;
  walletTarget?: string;
  shareWithRecipient: boolean;
  mode: SignalMode;
  hasFile: boolean;
  hasMessage: boolean;
  cipherVersion: string;
  encryptedText?: string;
  payloadNonce?: string;
  sealedDataKey?: string;
  sealedNonce?: string;
  senderEphemeralPublicKey?: string;
  aadHash?: string;
  file?: {
    storagePath: string;
    payloadNonce: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    sealedDataKey?: string;
    sealedNonce?: string;
    senderEphemeralPublicKey?: string;
    aadHash?: string;
  };
  onChainNotification?: {
    enabled: boolean;
    network: string;
  };
  expiresAt?: string;
  expiresIn?: string;
}

export interface CreateSignalOptionsEncrypted {
  signalId?: string;
  walletTarget?: string;
  /**
   * @deprecated shareWithRecipient is automatically determined by mode.
   * - mode: "shared_wallet" → shareWithRecipient = true
   * - mode: "private" → shareWithRecipient = false
   * This field is ignored if provided.
   */
  shareWithRecipient?: boolean;
  mode: SignalMode;
  message?: string;
  file?: {
    data: ArrayBuffer | Uint8Array | Buffer;
    originalName: string;
    mimeType: string;
  };
  onChainNotification?: {
    enabled: boolean;
    network: string;
  };
  /**
   * Specific expiration date and time (ISO 8601 format).
   * Use this for custom expiration dates.
   * 
   * Either `expiresAt` OR `expiresIn` must be provided (not both).
   * 
   * @example "2026-12-31T23:59:59.000Z" - New Year's Eve 2026
   * @example new Date("2026-12-31").toISOString() - Specific date
   */
  expiresAt?: string;
  /**
   * Expiration time from now (relative).
   * 
   * Format: "{number}{unit}" where unit is one of: s (seconds), m (minutes), h (hours), d (days)
   * 
   * Either `expiresAt` OR `expiresIn` must be provided (not both).
   * 
   * @example "24h" - 24 hours from now
   * @example "7d" - 7 days from now
   * @example "1h" - 1 hour from now
   * @example "30m" - 30 minutes from now
   * @example "5s" - 5 seconds from now
   */
  expiresIn?: string;
}

export interface CreateSignalResponse {
  signalId: string;
  expiresAt: string;
}

export interface CreateSignalResponseEncrypted extends CreateSignalResponse {
  keyBase64: string;
  shareableLink: string;
}

export interface OpenSignalResponse {
  encryptedText: string | null;
  payloadNonce: string | null;
  sealedDataKey: string | null;
  sealedNonce: string | null;
  senderEphemeralPublicKey: string | null;
  aadHash: string | null;
  walletCreator: string | null;
  walletTarget: string | null;
  shareWithRecipient: boolean;
  file: {
    payloadNonce: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    sealedDataKey?: string | null;
    sealedNonce?: string | null;
    senderEphemeralPublicKey?: string | null;
    aadHash?: string | null;
  } | null;
  expiresAt: string;
  onChainNotification: OnChainNotification | null;
  cipherVersion: string;
}

export interface OpenSignalResponseDecrypted {
  message: string | null;
  file: {
    data: ArrayBuffer;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
  } | null;
  expiresAt: string;
  onChainNotification: OnChainNotification | null;
  keySource: "derived" | "provided";
}

export interface SignalListItem {
  signalId: string;
  shareWithRecipient: boolean;
  hasFile: boolean;
  hasMessage: boolean;
  createdAt: string;
  expiresAt: string;
  used: boolean;
  status: SignalStatus;
  file: {
    originalName: string;
  } | null;
}

export interface ListMySignalsResponse {
  signals: SignalListItem[];
  count: number;
}

export interface UploadFileOptions {
  file: string;
  originalName: string;
  mimeType: string;
}

export interface UploadFileResponse {
  storagePath: string;
  sizeBytes: number;
}

export interface DownloadFileResponse {
  file: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface SignalErrorResponse {
  status: "error";
  code: "WALLET_NOT_ALLOWED" | "SIGNAL_EXPIRED" | "SIGNAL_ALREADY_USED" | "SIGNAL_NOT_FOUND" | "VALIDATION_ERROR";
  message: string;
}

export interface WalletAuth {
  address: string;
  signMessage: (message: string) => Promise<string>;
}

export interface RateLimitConfig {
  enabled?: boolean;
  maxRequests?: number;
  windowMs?: number;
}

export interface MorseSDKConfig {
  apiKey: string;
  apiVersion?: string;
  onRequest?: (url: string, options: RequestInit) => void;
  onResponse?: (url: string, response: Response) => void;
  onError?: (error: Error) => void;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  rateLimit?: RateLimitConfig;
}

export interface MorseSDKConfigV1 extends MorseSDKConfig {
  apiVersion?: "v1";
}
