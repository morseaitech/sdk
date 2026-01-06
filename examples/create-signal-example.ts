import { MorseSDK, createWalletFromPrivateKey, Expiration } from "../src";

async function example() {
    // Get API key from environment variable
    const apiKey = process.env.MORSE_API_KEY;

    if (!apiKey || apiKey === "sk_your_api_key_here") {
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
        console.log("\nCreating SHARED encrypted signal with X25519...");

        // Option 1: Use relative time (expiresIn)
        const walletTarget = process.env.WALLET_TARGET;
        if (!walletTarget) {
            console.error("\n❌ Please set WALLET_TARGET environment variable");
            console.error("   export WALLET_TARGET=0x...");
            return;
        }

        const result = await sdk.createSignalEncrypted(wallet, {
            walletTarget,
            mode: "shared_wallet",
            message: "Secret message shared with X25519! 🔐",
            expiresIn: Expiration.ONE_DAY, // "24h" - 24 hours from now
        });

        console.log("\n✅ Signal created successfully!");
        console.log("Signal ID:", result.signalId);
        console.log("Expires at:", result.expiresAt);
        console.log("\n📎 Shareable link:");
        console.log(result.shareableLink);

        // Option 2: Use specific date (expiresAt)
        // Uncomment to try:
        /*
        const walletTarget2 = process.env.WALLET_TARGET;
        if (!walletTarget2) {
            console.error("\n❌ Please set WALLET_TARGET environment variable");
            return;
        }
        const customDate = new Date("2026-12-31T23:59:59.000Z");
        const result2 = await sdk.createSignalEncrypted(wallet, {
            walletTarget: walletTarget2,
            mode: "shared_wallet",
            message: "Secret message that expires on New Year's Eve! 🎉",
            expiresAt: customDate.toISOString(), // Specific date and time
        });
        console.log("Custom expiration signal:", result2.signalId);
        */

    } catch (error: any) {
        console.error("\n❌ Error:", error.message || error);
    }
}

example().catch(console.error);
