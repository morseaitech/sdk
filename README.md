# MORSE SDK

[![npm version](https://badge.fury.io/js/%40morseai%2Fsdk.svg)](https://badge.fury.io/js/%40morseai%2Fsdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

TypeScript SDK for creating and accessing encrypted signals in the MORSE platform.

**Version:** 0.1.0-beta.5 (Beta Release)

> ⚠️ **Beta Notice**: This is a beta release. The API is stable but may have minor changes before the 1.0.0 release. Please report any issues you encounter.

## Features

- ✅ Full TypeScript support with autocomplete
- ✅ Automatic encryption/decryption (AES-GCM and X25519)
- ✅ Wallet authentication (browser, private key, custom)
- ✅ X25519 + XChaCha20-Poly1305 for shared signals
- ✅ Rate limiting (configurable)
- ✅ Request retry logic
- ✅ Comprehensive error handling
- ✅ Input validation
- ✅ Security-first design

## Installation

```bash
npm install @morseai/sdk
# or
pnpm add @morseai/sdk
# or
yarn add @morseai/sdk
```

## Prerequisites

This SDK requires `ethers` v6+ as a peer dependency for wallet signature functionality.

```bash
npm install ethers
```

## Authentication

MORSE uses **wallet signature authentication** - you sign a message with your Ethereum wallet to authenticate requests. See [AUTHENTICATION.md](./docs/AUTHENTICATION.md) for complete details.

**Quick summary:**
- ✅ API Key (required for SDK usage)
- ✅ Wallet signature (for frontend/operations)
- ✅ Private key (for backend/server)
- ✅ Custom implementation

## Quick Start

```typescript
import { MorseSDK, createWalletFromPrivateKey, Expiration } from "@morseai/sdk";

// Initialize SDK (only apiKey is required)
const sdk = new MorseSDK({
  apiKey: process.env.MORSE_API_KEY!,
});

// Create wallet from private key
const wallet = createWalletFromPrivateKey({
  privateKey: process.env.PRIVATE_KEY!,
});

// Create a shared signal (X25519 encryption)
const result = await sdk.createSignalEncrypted(wallet, {
  walletTarget: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  mode: "shared_wallet",
  message: "Secret message! 🔐",
  expiresIn: Expiration.ONE_DAY, // or "24h", "7d", etc.
});

console.log("Signal ID:", result.signalId);
console.log("Shareable link:", result.shareableLink);

// Open and decrypt signal
const decrypted = await sdk.openSignalDecrypted(wallet, result.signalId);
console.log("Message:", decrypted.message);
```

## Configuration

### Basic Setup

```typescript
import { MorseSDK } from "@morseai/sdk";

// Simple initialization (only apiKey is required)
const sdk = new MorseSDK({
  apiKey: "sk_your_api_key_here", // REQUIRED
});
```

**Note:** `baseUrl` and `frontendUrl` are internal constants. The SDK automatically uses the correct API endpoints.

### Advanced Configuration

```typescript
const sdk = new MorseSDK({
  apiKey: "sk_your_api_key_here", // REQUIRED
  apiVersion: "v1", // Optional, defaults to "v1"
  timeout: 30000, // Request timeout in ms (default: 30000)
  retries: 3, // Number of retries on failure (default: 0)
  retryDelay: 1000, // Delay between retries in ms (default: 1000)
  rateLimit: {
    enabled: true, // Enable rate limiting (default: true)
    maxRequests: 100, // Maximum requests per window (default: 100)
    windowMs: 60000, // Time window in milliseconds (default: 60000 = 1 minute)
  },
  onRequest: (url, options) => {
    console.log("Making request to:", url);
  },
  onResponse: (url, response) => {
    console.log("Response received from:", url, response.status);
  },
  onError: (error) => {
    console.error("Request error:", error);
  },
});
```

## Wallet Authentication

The SDK supports multiple ways to authenticate, depending on your use case:

### 1. Browser/Web3 Wallet (Frontend)

```typescript
import { MorseSDK, createBrowserWallet } from "@morseai/sdk";

const sdk = new MorseSDK({
  apiKey: process.env.MORSE_API_KEY!,
});

// For MetaMask or other browser wallets
const wallet = await createBrowserWallet(window.ethereum);
```

### 2. Private Key (Backend/Server)

```typescript
import { MorseSDK, createWalletFromPrivateKey } from "@morseai/sdk";

const sdk = new MorseSDK({
  apiKey: process.env.MORSE_API_KEY!,
});

// For backend applications with a private key
const wallet = createWalletFromPrivateKey({
  privateKey: process.env.PRIVATE_KEY!, // Keep this secure!
});
```

### 3. Custom Implementation

```typescript
import { MorseSDK, type WalletAuth } from "@morseai/sdk";

const sdk = new MorseSDK({
  apiKey: process.env.MORSE_API_KEY!,
});

// Implement your own wallet auth
const wallet: WalletAuth = {
  address: "0x...",
  signMessage: async (message: string) => {
    // Your custom signing logic
    return signature;
  },
};
```

## Creating Signals

### Automatic Encryption (Recommended)

The SDK can handle encryption automatically. This is the recommended approach:

```typescript
import { MorseSDK, Expiration } from "@morseai/sdk";

// Create a private signal (AES-GCM, key in URL)
const privateSignal = await sdk.createSignalEncrypted(wallet, {
  mode: "private",
  message: "Private message - key will be in URL",
  expiresIn: Expiration.ONE_DAY,
});

// Create a shared signal (X25519, recipient decrypts with wallet)
const sharedSignal = await sdk.createSignalEncrypted(wallet, {
  walletTarget: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  mode: "shared_wallet", // shareWithRecipient is automatically true
  message: "Shared message - recipient decrypts with wallet",
  expiresIn: Expiration.ONE_DAY,
});
```

### Signal Modes

- **`mode: "private"`** - Private signal, key stored in URL fragment (`#k=...`)
  - Uses AES-GCM encryption
  - `shareWithRecipient` is automatically `false`
  - Key is derived from wallet (deterministic) or random (for URL sharing)

- **`mode: "shared_wallet"`** - Shared signal, recipient decrypts with their wallet
  - Uses X25519 + XChaCha20-Poly1305 encryption
  - `shareWithRecipient` is automatically `true`
  - Requires `walletTarget` (recipient's wallet address)
  - No key in URL needed

### Expiration

You can specify expiration in two ways:

#### Option 1: Relative Time (`expiresIn`)

```typescript
import { Expiration } from "@morseai/sdk";

await sdk.createSignalEncrypted(wallet, {
  mode: "shared_wallet",
  walletTarget: "0x...",
  message: "...",
  expiresIn: Expiration.ONE_DAY, // Use constants for autocomplete
  // Or use string format: "24h", "7d", "1h", "30m", "5s"
});
```

**Available Constants:**
- `Expiration.FIVE_SECONDS` → `"5s"`
- `Expiration.ONE_MINUTE` → `"1m"`
- `Expiration.ONE_HOUR` → `"1h"`
- `Expiration.ONE_DAY` → `"24h"`
- `Expiration.ONE_WEEK` → `"7d"`
- `Expiration.ONE_MONTH` → `"30d"`
- And more...

#### Option 2: Specific Date (`expiresAt`)

```typescript
// Specific date and time
const customDate = new Date("2026-12-31T23:59:59.000Z");
await sdk.createSignalEncrypted(wallet, {
  mode: "shared_wallet",
  walletTarget: "0x...",
  message: "...",
  expiresAt: customDate.toISOString(), // ISO 8601 format
});

// Or calculate from now
const futureDate = new Date();
futureDate.setHours(futureDate.getHours() + 2); // 2 hours from now
await sdk.createSignalEncrypted(wallet, {
  mode: "shared_wallet",
  walletTarget: "0x...",
  message: "...",
  expiresAt: futureDate.toISOString(),
});
```

**Note:** Either `expiresIn` OR `expiresAt` must be provided (not both).

### Creating Signals with Files

```typescript
import * as fs from "fs";

const fileData = fs.readFileSync("./document.pdf");

const result = await sdk.createSignalEncrypted(wallet, {
  walletTarget: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  mode: "shared_wallet",
  message: "Check out this document!",
  file: {
    data: fileData,
    originalName: "document.pdf",
    mimeType: "application/pdf",
  },
  expiresIn: Expiration.ONE_DAY,
});
```

## Opening Signals

### Automatic Decryption

The SDK automatically detects the encryption type and decrypts accordingly:

```typescript
// Open and decrypt signal (automatic detection)
const decrypted = await sdk.openSignalDecrypted(wallet, signalId);

console.log("Message:", decrypted.message);
console.log("File:", decrypted.file);
console.log("Key source:", decrypted.keySource); // "derived" (X25519) or "provided" (URL key)
```

**For X25519 signals:**
- No key needed - recipient decrypts with their wallet
- SDK automatically derives the key from wallet signature

**For private signals (AES-GCM):**
- Key is in the URL fragment (`#k=...`)
- Or you can provide it manually:

```typescript
const decrypted = await sdk.openSignalDecrypted(wallet, signalId, keyFromUrl);
```

### Raw Encrypted Data

If you need the raw encrypted data (for manual decryption):

```typescript
const encrypted = await sdk.openSignal(wallet, signalId);

console.log("Encrypted text:", encrypted.encryptedText);
console.log("Payload nonce:", encrypted.payloadNonce);
console.log("Cipher version:", encrypted.cipherVersion);
```

## Listing Signals

```typescript
const mySignals = await sdk.listMySignals(wallet);

console.log(`You have ${mySignals.count} signals`);
mySignals.signals.forEach((signal) => {
  console.log(`- ${signal.signalId}: ${signal.status}`);
  console.log(`  Created: ${signal.createdAt}`);
  console.log(`  Expires: ${signal.expiresAt}`);
});
```

## Burning Signals

```typescript
await sdk.burnSignal(wallet, "signal-id-here");
```

**Note:** Only the signal creator or recipient can burn a signal.

## Encryption Methods

### X25519 (Shared Signals)

For `mode: "shared_wallet"` signals:
- **Encryption:** X25519 ECDH + XChaCha20-Poly1305
- **Key Exchange:** Ephemeral sender key + recipient's static key
- **Decryption:** Recipient uses their wallet to derive key
- **No key in URL:** Recipient decrypts with their wallet signature

### AES-GCM (Private Signals)

For `mode: "private"` signals:
- **Encryption:** AES-GCM-256
- **Key:** Derived from wallet or random (for URL sharing)
- **Key in URL:** For shareable links, key is in URL fragment (`#k=...`)

## Error Handling

The SDK throws specific error types for better error handling:

```typescript
import {
  MorseSDKError,
  SignalNotFoundError,
  SignalExpiredError,
  SignalAlreadyUsedError,
  WalletNotAllowedError,
  ValidationError,
  NetworkError,
  RateLimitError,
} from "@morseai/sdk";

try {
  const signal = await sdk.openSignalDecrypted(wallet, signalId);
} catch (error) {
  if (error instanceof SignalExpiredError) {
    console.log("Signal expired");
  } else if (error instanceof SignalAlreadyUsedError) {
    console.log("Signal already used");
  } else if (error instanceof WalletNotAllowedError) {
    console.log("Wallet not allowed");
  } else if (error instanceof RateLimitError) {
    console.log(`Rate limit exceeded. Retry after ${error.retryAfterMs}ms`);
  } else {
    console.error("Unknown error:", error);
  }
}
```

## Examples

See the `examples/` directory for complete working examples:

- `create-signal-example.ts` - Creating signals
- `open-signal-example.ts` - Opening and decrypting signals
- `backend-to-backend.ts` - Backend-to-backend communication
- `browser-example.ts` - Browser/Web3 wallet usage
- `custom-expiration-example.ts` - Custom expiration dates
- `advanced-config.ts` - Advanced configuration options

**Running examples:**

```bash
# Set environment variables
export MORSE_API_KEY=sk_your_api_key
export PRIVATE_KEY=your_private_key_hex

# Run examples
npx tsx examples/create-signal-example.ts
npx tsx examples/open-signal-example.ts <signalId>
```

## API Reference

### `MorseSDK`

The main SDK class for creating and accessing encrypted signals.

#### Constructor

```typescript
new MorseSDK(config: MorseSDKConfig)
```

**Config Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | **Required** | Your MORSE API key (starts with `sk_`) |
| `apiVersion` | `string` | `"v1"` | API version to use |
| `timeout` | `number` | `30000` | Request timeout in milliseconds |
| `retries` | `number` | `0` | Number of retries on failure |
| `retryDelay` | `number` | `1000` | Delay between retries in ms |
| `rateLimit` | `RateLimitConfig` | `{ enabled: true, maxRequests: 100, windowMs: 60000 }` | Rate limiting config |
| `onRequest` | `function` | - | Callback before each request |
| `onResponse` | `function` | - | Callback after each response |
| `onError` | `function` | - | Callback on errors |

#### Methods

##### `createSignalEncrypted(wallet, options): Promise<CreateSignalResponseEncrypted>`

Create a signal with automatic encryption. **Recommended method.**

**Parameters:**
- `wallet: WalletAuth` - Wallet authentication object
- `options: CreateSignalOptionsEncrypted` - Signal creation options

**Returns:** `Promise<CreateSignalResponseEncrypted>` - Created signal with shareable link

**Example:**
```typescript
const result = await sdk.createSignalEncrypted(wallet, {
  walletTarget: "0x...", // Required for shared_wallet mode
  mode: "shared_wallet", // or "private"
  message: "Secret message",
  expiresIn: Expiration.ONE_DAY,
});

console.log("Signal ID:", result.signalId);
console.log("Shareable link:", result.shareableLink);
console.log("Key (for private signals):", result.keyBase64);
```

##### `openSignalDecrypted(wallet, signalId, keyBase64?): Promise<OpenSignalResponseDecrypted>`

Open and decrypt a signal automatically.

**Parameters:**
- `wallet: WalletAuth` - Wallet authentication object
- `signalId: string` - Signal ID to open
- `keyBase64?: string` - Optional key for private signals (from URL fragment)

**Returns:** `Promise<OpenSignalResponseDecrypted>` - Decrypted signal data

**Example:**
```typescript
const decrypted = await sdk.openSignalDecrypted(wallet, signalId);
console.log("Message:", decrypted.message);
console.log("File:", decrypted.file);
```

##### `createSignal(wallet, options): Promise<CreateSignalResponse>`

Create a signal with pre-encrypted data (manual encryption).

**Parameters:**
- `wallet: WalletAuth` - Wallet authentication object
- `options: CreateSignalOptions` - Signal creation options with encrypted data

**Returns:** `Promise<CreateSignalResponse>` - Created signal info

##### `openSignal(wallet, signalId): Promise<OpenSignalResponse>`

Open a signal and return encrypted data (for manual decryption).

**Parameters:**
- `wallet: WalletAuth` - Wallet authentication object
- `signalId: string` - Signal ID to open

**Returns:** `Promise<OpenSignalResponse>` - Encrypted signal data

##### `listMySignals(wallet): Promise<ListMySignalsResponse>`

List all signals accessible by the wallet.

**Parameters:**
- `wallet: WalletAuth` - Wallet authentication object

**Returns:** `Promise<ListMySignalsResponse>` - List of signals

##### `burnSignal(wallet, signalId): Promise<{ success: boolean }>`

Manually burn a signal (mark as used).

**Parameters:**
- `wallet: WalletAuth` - Wallet authentication object
- `signalId: string` - Signal ID to burn

**Returns:** `Promise<{ success: boolean }>`

## TypeScript Support

The SDK is fully typed. All types are exported:

```typescript
import type {
  CreateSignalOptions,
  CreateSignalOptionsEncrypted,
  CreateSignalResponse,
  CreateSignalResponseEncrypted,
  OpenSignalResponse,
  OpenSignalResponseDecrypted,
  SignalMode,
  SignalStatus,
  WalletAuth,
  MorseSDKConfig,
  ExpirationValue,
} from "@morseai/sdk";

import { Expiration } from "@morseai/sdk";
```

## Helper Functions

### Signal Validation

```typescript
import { isValidSignalId, isValidWalletAddress } from "@morseai/sdk";

isValidSignalId("abc123"); // true
isValidWalletAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"); // true
```

### Expiration Utilities

```typescript
import {
  formatExpiration,
  isSignalExpired,
  getTimeUntilExpiration,
  parseExpiresIn,
} from "@morseai/sdk";

formatExpiration("2025-12-31T23:59:59Z");
isSignalExpired("2025-12-31T23:59:59Z");
getTimeUntilExpiration("2025-12-31T23:59:59Z");
parseExpiresIn("24h");
```

### Expiration Constants

```typescript
import { Expiration } from "@morseai/sdk";

// Use constants for autocomplete and type safety
Expiration.ONE_DAY    // "24h"
Expiration.ONE_WEEK   // "7d"
Expiration.ONE_HOUR   // "1h"
Expiration.ONE_MONTH  // "30d"
// ... and more
```

## License

MIT
