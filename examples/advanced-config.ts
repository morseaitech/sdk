import { MorseSDK, createBrowserWallet, createWalletFromPrivateKey, Expiration } from "../src";

async function advancedExample() {
    // Get API key from environment variable
    const apiKey = process.env.MORSE_API_KEY || "sk_your_api_key_here";

    if (apiKey === "sk_your_api_key_here") {
        console.warn("⚠️  Using placeholder API key. Set MORSE_API_KEY environment variable.");
    }

    // Example 1: Basic configuration (only apiKey required)
    const basicSdk = new MorseSDK({
        apiKey,
    });

    // Example 2: Advanced configuration with callbacks and retries
    const advancedSdk = new MorseSDK({
        apiKey,
        timeout: 30000,
        retries: 3,
        retryDelay: 1000,
        onRequest: (url, options) => {
            console.log(`[SDK] Request: ${options.method || "GET"} ${url}`);
        },
        onResponse: (url, response) => {
            console.log(`[SDK] Response: ${response.status} ${url}`);
        },
        onError: (error) => {
            console.error(`[SDK] Error:`, error.message);
        },
    });

    // Example 3: Backend configuration with private key
    const backendSdk = new MorseSDK({
        apiKey,
        timeout: 60000,
        retries: 5,
        retryDelay: 2000,
        onError: (error) => {
            console.error("MorseSDK Error:", error);
        },
    });

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        console.warn("⚠️  PRIVATE_KEY not set. Some examples will fail.");
        console.warn("   Set PRIVATE_KEY environment variable to test wallet-based examples.");
        return;
    }

    const wallet = createWalletFromPrivateKey({
        privateKey,
    });

    // Example 4: Creating a private signal (AES-GCM with key in URL)
    try {
        const privateSignal = await advancedSdk.createSignalEncrypted(wallet, {
            mode: "private",
            message: "Private message - key will be in URL",
            expiresIn: Expiration.ONE_DAY,
        });

        console.log("Private signal created:", privateSignal.signalId);
        console.log("Link (with key):", privateSignal.shareableLink);
    } catch (error) {
        console.error("Failed to create private signal:", error);
    }

    // Example 5: Creating a shared signal (X25519 encryption)
    try {
        const walletTarget = process.env.WALLET_TARGET || "0x0000000000000000000000000000000000000000";
        const sharedSignal = await advancedSdk.createSignalEncrypted(wallet, {
            walletTarget,
            mode: "shared_wallet",
            message: "Shared message - recipient decrypts with wallet",
            expiresIn: Expiration.ONE_DAY,
        });

        console.log("Shared signal created:", sharedSignal.signalId);
        console.log("Link (no key needed):", sharedSignal.shareableLink);
    } catch (error) {
        console.error("Failed to create shared signal:", error);
    }

    // Example 6: Accessing configuration
    const config = advancedSdk.getConfig();
    console.log("Current config:", config);
    console.log("API Version:", advancedSdk.getApiVersion());
}

advancedExample().catch(console.error);
