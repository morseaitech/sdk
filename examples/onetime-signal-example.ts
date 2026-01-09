import { MorseSDK, createWalletFromPrivateKey, Expiration } from "../src";

async function example() {
    // Get API key from environment variable
    const apiKey = process.env.MORSE_API_KEY || "sk_your_api_key_here";

    if (!apiKey || apiKey === "sk_your_api_key_here") {
        console.error("\n❌ Please set MORSE_API_KEY environment variable");
        console.error("   export MORSE_API_KEY=sk_your_actual_api_key");
        return;
    }

    const sdk = new MorseSDK({
        apiKey,
    });

    // Get private key from environment variable
    const privateKey = process.env.PRIVATE_KEY || "your_private_key_hex";

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
        console.log("\n=== Creating Onetime Signal ===");
        console.log("Creating a one-time use link that burns after first access...\n");

        // Example 1: Create Onetime Signal with message only
        const result1 = await sdk.createOnetimeSignal(wallet, {
            message: "This is a secret message that will be deleted after first view! 🔐",
            expiresIn: Expiration.ONE_DAY, // "24h" - 24 hours from now
        });

        console.log("✅ Onetime Signal created successfully!");
        console.log("Link ID:", result1.linkId);
        console.log("Expires at:", result1.expiresAt);
        console.log("\n📎 Shareable link:");
        console.log(result1.shareableLink);
        if (result1.password) {
            console.log("\n🔑 Passphrase (share separately):");
            console.log(result1.password);
        }

        // Example 2: Create Onetime Signal with password protection
        console.log("\n\n=== Creating Password-Protected Onetime Signal ===");
        const result2 = await sdk.createOnetimeSignal(wallet, {
            message: "This message is protected with a passphrase! 🔒",
            password: "my-secret-passphrase-123",
            expiresIn: "7d", // 7 days
        });

        console.log("✅ Password-protected Onetime Signal created!");
        console.log("Link ID:", result2.linkId);
        console.log("Shareable link:", result2.shareableLink);
        console.log("Passphrase:", result2.password);

        // Example 3: Create Onetime Signal with file
        console.log("\n\n=== Creating Onetime Signal with File ===");
        const fileContent = new TextEncoder().encode("This is a secret file content!");
        const result3 = await sdk.createOnetimeSignal(wallet, {
            file: {
                data: fileContent,
                originalName: "secret-document.txt",
                mimeType: "text/plain",
            },
            password: "file-passphrase",
            expiresIn: "1h", // 1 hour
        });

        console.log("✅ File Onetime Signal created!");
        console.log("Link ID:", result3.linkId);
        console.log("Shareable link:", result3.shareableLink);
        console.log("Passphrase:", result3.password);

        // Example 4: Open Onetime Signal (no wallet required!)
        console.log("\n\n=== Opening Onetime Signal ===");
        console.log("Opening signal (this will burn it - one-time use only)...\n");

        // Open the first signal (no password)
        const opened1 = await sdk.openOnetimeSignal({
            linkId: result1.linkId,
        });

        console.log("✅ Signal opened successfully!");
        console.log("Message:", opened1.message);
        console.log("File:", opened1.file ? `${opened1.file.originalName} (${opened1.file.sizeBytes} bytes)` : "None");

        // Try to open again (should fail - already burned)
        console.log("\n\n=== Trying to open burned signal ===");
        try {
            await sdk.openOnetimeSignal({
                linkId: result1.linkId,
            });
        } catch (error: any) {
            console.log("❌ Expected error (signal already burned):", error.message);
        }

        // Open password-protected signal
        console.log("\n\n=== Opening Password-Protected Signal ===");
        const opened2 = await sdk.openOnetimeSignal({
            linkId: result2.linkId,
            password: "my-secret-passphrase-123",
        });

        console.log("✅ Password-protected signal opened!");
        console.log("Message:", opened2.message);

        // Open file signal
        console.log("\n\n=== Opening File Signal ===");
        const opened3 = await sdk.openOnetimeSignal({
            linkId: result3.linkId,
            password: "file-passphrase",
        });

        console.log("✅ File signal opened!");
        if (opened3.file) {
            const decoder = new TextDecoder();
            const fileContent = decoder.decode(opened3.file.data);
            console.log("File name:", opened3.file.originalName);
            console.log("File size:", opened3.file.sizeBytes, "bytes");
            console.log("File content:", fileContent);
        }

        console.log("\n\n=== Summary ===");
        console.log("✅ Created 3 Onetime Signals");
        console.log("✅ Opened all 3 signals (they are now burned)");
        console.log("✅ Demonstrated password protection");
        console.log("✅ Demonstrated file sharing");
        console.log("\n💡 Note: Onetime Signals can be opened WITHOUT wallet authentication!");
        console.log("   Anyone with the link (and password if set) can open them.");

    } catch (error: any) {
        console.error("\n❌ Error:", error.message || error);
        if (error.stack) {
            console.error(error.stack);
        }
    }
}

example().catch(console.error);

