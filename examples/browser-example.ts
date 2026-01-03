import { MorseSDK, createBrowserWallet, Expiration } from "../src";

async function example() {
    // Get API key from environment variable or use placeholder
    const apiKey = process.env.MORSE_API_KEY || "sk_your_api_key_here";

    if (apiKey === "sk_your_api_key_here") {
        console.warn("⚠️  Using placeholder API key. Set MORSE_API_KEY environment variable for production.");
    }

    const sdk = new MorseSDK({
        apiKey,
    });

    const ethereum = (window as any).ethereum;
    if (!ethereum) {
        throw new Error("MetaMask not installed");
    }

    const wallet = await createBrowserWallet(ethereum);

    try {
        const signal = await sdk.createSignalEncrypted(wallet, {
            mode: "private",
            message: "Private secret message! 🔐",
            expiresIn: Expiration.ONE_DAY,
        });

        console.log("Signal created:", signal.signalId);
        console.log("Shareable link:", signal.shareableLink);

        const mySignals = await sdk.listMySignals(wallet);
        console.log("My signals:", mySignals.count);

    } catch (error) {
        console.error("Error:", error);
    }
}

example().catch(console.error);
