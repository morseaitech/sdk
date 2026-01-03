# Authentication - MORSE SDK

MORSE uses **wallet signature authentication** - you sign a message with your Ethereum wallet to authenticate requests. This provides a secure, decentralized authentication method without requiring API keys, passwords, or JWT tokens.

## How It Works

1. **Generate Message**: SDK generates a unique message for each request (includes action, context, and timestamp)
2. **Sign Message**: Your wallet signs the message using your private key
3. **Send Request**: SDK sends the request with your wallet address, signature, and the original message
4. **Verify Signature**: Backend verifies the signature matches the message and wallet address

## Supported Authentication Methods

### 1. Browser Wallets (MetaMask, WalletConnect, etc.)

For frontend applications using browser wallets:

```typescript
import { MorseSDK, createBrowserWallet, Expiration } from "@morseai/sdk";

const sdk = new MorseSDK({
  apiKey: process.env.MORSE_API_KEY!,
});

const wallet = await createBrowserWallet(window.ethereum);

// Now use the wallet with SDK methods
const signal = await sdk.createSignalEncrypted(wallet, {
  mode: "private",
  message: "Hello!",
  expiresIn: Expiration.ONE_DAY,
});
```

**How it works:**
- Uses `window.ethereum.request({ method: "personal_sign" })` to sign messages
- User approves each signature request in their wallet
- No private keys exposed to your application

### 2. Private Key (Backend/Server)

For backend applications with a private key:

```typescript
import { MorseSDK, createWalletFromPrivateKey, Expiration } from "@morseai/sdk";

const sdk = new MorseSDK({
  apiKey: process.env.MORSE_API_KEY!,
});

const wallet = createWalletFromPrivateKey({
  privateKey: process.env.PRIVATE_KEY!, // Always use environment variables!
});

const signal = await sdk.createSignalEncrypted(wallet, {
  mode: "shared_wallet",
  walletTarget: "0x...",
  message: "Hello!",
  expiresIn: Expiration.ONE_DAY,
});
```

**Security Notes:**
- Private keys remain in memory (JavaScript limitation)
- Wallet objects are created only when signing (lazy initialization)
- Use environment variables, never hardcode keys
- Consider using key management systems (AWS KMS, HashiCorp Vault) for production

### 3. Pre-signed Messages (One-time Use)

For one-time operations where you already have a signature:

```typescript
import { MorseSDK, createWalletFromPreSigned, Expiration } from "@morseai/sdk";

const sdk = new MorseSDK({
  apiKey: process.env.MORSE_API_KEY!,
});

const wallet = createWalletFromPreSigned({
  address: "0x...",
  signature: "0x...",
  message: "MORSE: create signal ...",
});

const signal = await sdk.createSignalEncrypted(wallet, {
  mode: "private",
  message: "Hello!",
  expiresIn: Expiration.ONE_DAY,
});
```

**Use cases:**
- Batch operations with pre-signed messages
- Offline signing workflows
- Integration with external signing services

**Note:** Pre-signed wallets can only sign the exact message they were created with.

### 4. Custom Implementation

For custom wallet integrations (mobile wallets, hardware wallets, etc.):

```typescript
import { MorseSDK, type WalletAuth, Expiration } from "@morseai/sdk";

const sdk = new MorseSDK({
  apiKey: process.env.MORSE_API_KEY!,
});

const wallet: WalletAuth = {
  address: "0x...",
  signMessage: async (message: string) => {
    // Your custom signing logic
    return await yourWalletSDK.signMessage(message);
  },
};

const signal = await sdk.createSignalEncrypted(wallet, {
  mode: "private",
  message: "Hello!",
  expiresIn: Expiration.ONE_DAY,
});
```

## Message Format

The SDK generates authentication messages in the following format:

```
MORSE: {action} {context} at {timestamp}
```

**Examples:**
- `MORSE: create signal temp-1234567890 at 1704067200000`
- `MORSE: open signal abc123 at 1704067200000`
- `MORSE: burn signal abc123 at 1704067200000`
- `MORSE: view abc123 at 1704067200000`

**Components:**
- `action`: The operation being performed (create, open, burn, view)
- `context`: Additional context (usually signal ID or temporary ID)
- `timestamp`: Unix timestamp in milliseconds

## Security Considerations

### ✅ Best Practices

1. **Never log private keys or signatures**
2. **Use environment variables for private keys**
3. **Store private keys securely** (key management systems)
4. **Use hardware wallets for high-security scenarios**
5. **Validate wallet addresses** before use


## Error Handling

Authentication errors are thrown as specific error types:

```typescript
import { WalletNotAllowedError, ValidationError } from "@morseai/sdk";

try {
  const signal = await sdk.openSignal(wallet, signalId);
} catch (error) {
  if (error instanceof WalletNotAllowedError) {
    // Wallet address doesn't match signal's walletTarget
  } else if (error instanceof ValidationError) {
    // Invalid wallet address format
  }
}
```

## Examples

### Frontend (React)

```typescript
import { MorseSDK, createBrowserWallet, Expiration, type WalletAuth } from "@morseai/sdk";
import { useState } from "react";

function MyComponent() {
  const [wallet, setWallet] = useState<WalletAuth | null>(null);
  const sdk = new MorseSDK({
    apiKey: process.env.NEXT_PUBLIC_MORSE_API_KEY!,
  });

  const connectWallet = async () => {
    if (!window.ethereum) {
      alert("Please install MetaMask");
      return;
    }
    
    const wallet = await createBrowserWallet(window.ethereum);
    setWallet(wallet);
  };

  const createSignal = async () => {
    if (!wallet) return;
    
    const signal = await sdk.createSignalEncrypted(wallet, {
      mode: "private",
      message: "Hello from frontend!",
      expiresIn: Expiration.ONE_DAY,
    });
    
    console.log("Signal created:", signal.signalId);
  };

  return (
    <div>
      {!wallet ? (
        <button onClick={connectWallet}>Connect Wallet</button>
      ) : (
        <button onClick={createSignal}>Create Signal</button>
      )}
    </div>
  );
}
```

### Backend (Node.js)

```typescript
import { MorseSDK, createWalletFromPrivateKey, Expiration } from "@morseai/sdk";

const sdk = new MorseSDK({
  apiKey: process.env.MORSE_API_KEY!,
});

const wallet = createWalletFromPrivateKey({
  privateKey: process.env.PRIVATE_KEY!,
});

async function createSignal() {
  const result = await sdk.createSignalEncrypted(wallet, {
    walletTarget: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    mode: "shared_wallet", // shareWithRecipient is automatically true
    message: "Backend message",
    expiresIn: Expiration.ONE_DAY,
  });
  
  return result;
}
```

## Troubleshooting

### "User rejected the signing request"
- User clicked "Reject" in wallet popup
- Solution: Ask user to approve the signature

### "No wallet connected"
- Browser wallet not connected
- Solution: Call `ethereum.request({ method: "eth_requestAccounts" })` first

### "ethers is required for private key wallets"
- `ethers` package not installed
- Solution: `npm install ethers`

### "Invalid wallet address"
- Wallet address format is incorrect
- Solution: Ensure address is valid Ethereum address (0x followed by 40 hex characters)

## Additional Resources

- [Ethereum Signing](https://ethereum.org/en/developers/docs/signatures/)
- [MetaMask Documentation](https://docs.metamask.io/)
- [WalletConnect](https://docs.walletconnect.com/)

