export class MorseSDKError extends Error {
  constructor(message: string, public code?: string, public statusCode?: number) {
    super(message);
    this.name = "MorseSDKError";
    Object.setPrototypeOf(this, MorseSDKError.prototype);
  }
}

export class SignalNotFoundError extends MorseSDKError {
  constructor(message: string = "Signal not found") {
    super(message, "SIGNAL_NOT_FOUND", 404);
    this.name = "SignalNotFoundError";
    Object.setPrototypeOf(this, SignalNotFoundError.prototype);
  }
}

export class SignalExpiredError extends MorseSDKError {
  constructor(message: string = "Signal has expired") {
    super(message, "SIGNAL_EXPIRED", 400);
    this.name = "SignalExpiredError";
    Object.setPrototypeOf(this, SignalExpiredError.prototype);
  }
}

export class SignalAlreadyUsedError extends MorseSDKError {
  constructor(message: string = "Signal has already been used") {
    super(message, "SIGNAL_ALREADY_USED", 400);
    this.name = "SignalAlreadyUsedError";
    Object.setPrototypeOf(this, SignalAlreadyUsedError.prototype);
  }
}

export class WalletNotAllowedError extends MorseSDKError {
  constructor(message: string = "Wallet not allowed to access this signal") {
    super(message, "WALLET_NOT_ALLOWED", 401);
    this.name = "WalletNotAllowedError";
    Object.setPrototypeOf(this, WalletNotAllowedError.prototype);
  }
}

export class ValidationError extends MorseSDKError {
  constructor(message: string = "Validation error") {
    super(message, "VALIDATION_ERROR", 400);
    this.name = "ValidationError";
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class NetworkError extends MorseSDKError {
  constructor(message: string = "Network error", public originalError?: Error) {
    super(message, "NETWORK_ERROR", 0);
    this.name = "NetworkError";
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

export { RateLimitError } from "./rate-limiter";

export function mapErrorResponse(error: any): MorseSDKError {
  if (error.code) {
    switch (error.code) {
      case "SIGNAL_NOT_FOUND":
        return new SignalNotFoundError(error.message);
      case "SIGNAL_EXPIRED":
        return new SignalExpiredError(error.message);
      case "SIGNAL_ALREADY_USED":
        return new SignalAlreadyUsedError(error.message);
      case "WALLET_NOT_ALLOWED":
        return new WalletNotAllowedError(error.message);
      case "VALIDATION_ERROR":
        return new ValidationError(error.message);
      default:
        return new MorseSDKError(error.message || "Unknown error", error.code);
    }
  }
  return new MorseSDKError(error.message || "Unknown error");
}

