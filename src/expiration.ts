/**
 * Common expiration time constants for signals
 * 
 * Use these constants to ensure correct format and get autocomplete support
 * 
 * @example
 * ```typescript
 * await sdk.createSignalEncrypted(wallet, {
 *   mode: "shared_wallet",
 *   walletTarget: "0x...",
 *   message: "...",
 *   expiresIn: Expiration.ONE_DAY, // "24h"
 * });
 * ```
 */
export const Expiration = {
  /** 5 seconds */
  FIVE_SECONDS: "5s",
  /** 30 seconds */
  THIRTY_SECONDS: "30s",
  /** 1 minute */
  ONE_MINUTE: "1m",
  /** 5 minutes */
  FIVE_MINUTES: "5m",
  /** 30 minutes */
  THIRTY_MINUTES: "30m",
  /** 1 hour */
  ONE_HOUR: "1h",
  /** 6 hours */
  SIX_HOURS: "6h",
  /** 12 hours */
  TWELVE_HOURS: "12h",
  /** 24 hours (1 day) */
  ONE_DAY: "24h",
  /** 7 days (1 week) */
  ONE_WEEK: "7d",
  /** 30 days (1 month) */
  ONE_MONTH: "30d",
} as const;

/**
 * Type for expiration values
 */
export type ExpirationValue = typeof Expiration[keyof typeof Expiration] | string;

