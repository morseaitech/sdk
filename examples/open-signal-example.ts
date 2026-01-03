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

    // Signal ID to open (replace with a real signal ID)
    const signalId = process.argv[2] || "YOUR_SIGNAL_ID_HERE";
    // Optional: key for private signals (from URL fragment #k=...)
    const keyBase64 = process.argv[3];

    if (signalId === "YOUR_SIGNAL_ID_HERE") {
        console.error("\n❌ Please provide a signal ID as argument:");
        console.error("   npx tsx examples/open-signal-example.ts <signalId> [keyBase64]");
        console.error("\nExamples:");
        console.error("   # X25519 shared signal (no key needed):");
        console.error("   npx tsx examples/open-signal-example.ts abc123xyz");
        console.error("\n   # Private signal (key from URL):");
        console.error("   npx tsx examples/open-signal-example.ts abc123xyz 'base64KeyHere'");
        return;
    }

    try {
        console.log(`\nOpening signal: ${signalId}...`);

        // Open and decrypt signal
        const result = await sdk.openSignalDecrypted(wallet, signalId);

        console.log("\n✅ Signal opened and decrypted successfully!");
        console.log("Key source:", result.keySource); // "derived" (X25519) or "provided" (URL key)
        console.log("Expires at:", result.expiresAt);

        // Show decrypted message
        if (result.message) {
            console.log("\n📨 Message:");
            console.log("─".repeat(40));
            console.log(result.message);
            console.log("─".repeat(40));
        } else {
            console.log("\n📨 No message in this signal");
        }

        // Show file info if present
        if (result.file) {
            console.log("\n📎 File:");
            console.log("   Name:", result.file.originalName);
            console.log("   Type:", result.file.mimeType);
            console.log("   Size:", result.file.sizeBytes, "bytes");
        }

    } catch (error: any) {
        console.error("\n❌ Error:", error.message || error);
        if (error.code) {
            console.error("Error code:", error.code);
        }
    }
}

example().catch(console.error);
