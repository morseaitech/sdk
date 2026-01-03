import { MorseSDK, createWalletFromPrivateKey, Expiration } from "../src";
import * as fs from "fs";

async function example() {
    const wallet = createWalletFromPrivateKey({
        privateKey: process.env.PRIVATE_KEY!,
    });

    const sdk = new MorseSDK({
        apiKey: process.env.MORSE_API_KEY || "sk_your_api_key",
    });

    const message = "This is a secret message from backend to backend";
    const fileData = fs.readFileSync("./example-file.pdf");

    const result = await sdk.createSignalEncrypted(wallet, {
        walletTarget: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
        mode: "shared_wallet",
        message,
        file: {
            data: fileData,
            originalName: "example-file.pdf",
            mimeType: "application/pdf",
        },
        expiresIn: Expiration.ONE_DAY, // Or use: "24h", "7d", "1h", etc.
    });

    // Option 2: Use specific date
    // const customDate = new Date();
    // customDate.setDate(customDate.getDate() + 7); // 7 days from now
    // const result = await sdk.createSignalEncrypted(wallet, {
    //     walletTarget: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    //     mode: "shared_wallet",
    //     message,
    //     file: { ... },
    //     expiresAt: customDate.toISOString(), // Specific date
    // });

    console.log("Signal created:", result.signalId);
    console.log("Shareable link:", result.shareableLink);

    // For X25519 signals, recipient decrypts with their wallet
    // No key in URL needed!
}

example().catch(console.error);
