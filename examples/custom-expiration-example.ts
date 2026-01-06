import { MorseSDK, createWalletFromPrivateKey } from "../src";

async function example() {
    // Get API key from environment variable
    const apiKey = process.env.MORSE_API_KEY || "sk_your_api_key_here";

    if (apiKey === "sk_your_api_key_here") {
        console.error("\n❌ Please set MORSE_API_KEY environment variable");
        console.error("   export MORSE_API_KEY=sk_your_actual_api_key");
        return;
    }

    const sdk = new MorseSDK({
        apiKey,
    });

    // Get private key from environment variable
    const privateKey = process.env.PRIVATE_KEY;

    if (!privateKey) {
        console.error("\n❌ Please set PRIVATE_KEY environment variable");
        console.error("   export PRIVATE_KEY=your_private_key_hex");
        return;
    }

    const wallet = createWalletFromPrivateKey({
        privateKey,
    });

    console.log("Wallet address:", wallet.address);

    try {
        // Example: Custom expiration date (2 hours from now)
        const customDate = new Date();
        customDate.setHours(customDate.getHours() + 2);

        console.log("\nCreating signal with custom expiration date...");
        console.log("Custom expiration:", customDate.toISOString());

        const walletTarget = process.env.WALLET_TARGET;
        if (!walletTarget) {
            console.error("\n❌ Please set WALLET_TARGET environment variable");
            console.error("   export WALLET_TARGET=0x...");
            return;
        }

        const result = await sdk.createSignalEncrypted(wallet, {
            walletTarget,
            mode: "shared_wallet",
            message: "This signal expires at a specific date and time! 🕐",
            expiresAt: customDate.toISOString(), // ISO 8601 format
        });

        console.log("\n✅ Signal created successfully!");
        console.log("Signal ID:", result.signalId);
        console.log("Expires at:", result.expiresAt);
        console.log("\n📎 Shareable link:");
        console.log(result.shareableLink);

    } catch (error: any) {
        console.error("\n❌ Error:", error.message || error);
    }
}

example().catch(console.error);
