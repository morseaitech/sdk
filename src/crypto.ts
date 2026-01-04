const CIPHER_VERSION = "aes-gcm-256-v1";

function getCrypto(): Crypto {
    if (typeof globalThis !== 'undefined' && globalThis.crypto) {
        return globalThis.crypto;
    }
    if (typeof window !== 'undefined' && window.crypto) {
        return window.crypto;
    }
    throw new Error('Web Crypto API is not available. Requires Node.js 15+ or a browser with Web Crypto support.');
}

function toBase64(data: Uint8Array | ArrayBuffer): string {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64');
    }
    if (typeof btoa !== 'undefined') {
        return btoa(String.fromCharCode(...bytes));
    }
    throw new Error('Base64 encoding not available. Requires Node.js Buffer or browser btoa.');
}

function fromBase64(base64: string): Uint8Array {
    if (typeof Buffer !== 'undefined') {
        return Uint8Array.from(Buffer.from(base64, 'base64'));
    }
    if (typeof atob !== 'undefined') {
        return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    }
    throw new Error('Base64 decoding not available. Requires Node.js Buffer or browser atob.');
}

export function getCipherVersion(): string {
    return CIPHER_VERSION;
}

export async function generateKey(): Promise<CryptoKey> {
    const crypto = getCrypto();
    if (!crypto.subtle) {
        throw new Error('Web Crypto API (crypto.subtle) is not available.');
    }
    return crypto.subtle.generateKey(
        {
            name: "AES-GCM",
            length: 256,
        },
        true,
        ["encrypt", "decrypt"]
    );
}

export async function exportKey(key: CryptoKey): Promise<string> {
    const crypto = getCrypto();
    const exported = await crypto.subtle.exportKey("raw", key);
    const keyArray = new Uint8Array(exported);
    return toBase64(keyArray);
}

export async function importKey(keyBase64: string): Promise<CryptoKey> {
    const crypto = getCrypto();
    const keyArray = fromBase64(keyBase64);
    const keyBuffer = keyArray.buffer.slice(keyArray.byteOffset, keyArray.byteOffset + keyArray.byteLength) as ArrayBuffer;
    return crypto.subtle.importKey(
        "raw",
        keyBuffer,
        {
            name: "AES-GCM",
            length: 256,
        },
        true,
        ["encrypt", "decrypt"]
    );
}

function generateIV(): Uint8Array {
    const crypto = getCrypto();
    return crypto.getRandomValues(new Uint8Array(12));
}

export async function encryptText(
    text: string,
    key: CryptoKey
): Promise<{ encrypted: string; iv: string }> {
    const crypto = getCrypto();
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const iv = generateIV();
    const ivArray = new Uint8Array(iv);

    const encrypted = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: ivArray,
        },
        key,
        data
    );

    return {
        encrypted: toBase64(new Uint8Array(encrypted)),
        iv: toBase64(iv),
    };
}

export async function decryptText(
    encryptedBase64: string,
    ivBase64: string,
    key: CryptoKey
): Promise<string> {
    const crypto = getCrypto();
    const encrypted = fromBase64(encryptedBase64);
    const iv = fromBase64(ivBase64);

    const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
    const encryptedBuffer = encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.byteLength) as ArrayBuffer;

    const decrypted = await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: ivBuffer,
        },
        key,
        encryptedBuffer
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
}

export async function encryptFile(
    fileData: ArrayBuffer | Uint8Array | Buffer,
    key: CryptoKey
): Promise<{ encrypted: ArrayBuffer; iv: string }> {
    const crypto = getCrypto();
    let data: ArrayBuffer;
    if (fileData instanceof Buffer) {
        data = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer;
    } else if (fileData instanceof Uint8Array) {
        data = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer;
    } else {
        data = fileData;
    }
    const iv = generateIV();
    const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;

    const encrypted = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: ivBuffer,
        },
        key,
        data
    );

    return {
        encrypted,
        iv: toBase64(iv),
    };
}

export async function decryptFile(
    encryptedData: ArrayBuffer,
    ivBase64: string,
    key: CryptoKey
): Promise<ArrayBuffer> {
    const crypto = getCrypto();
    const iv = fromBase64(ivBase64);

    if (iv.length !== 12) {
        throw new Error(`Invalid IV length: ${iv.length} bytes. Expected 12 bytes for AES-GCM.`);
    }

    const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
    const dataBuffer = encryptedData as ArrayBuffer;

    const decrypted = await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: ivBuffer,
        },
        key,
        dataBuffer
    );

    return decrypted;
}

export async function deriveKeyFromWallet(
    walletAddress: string,
    salt?: Uint8Array
): Promise<CryptoKey> {
    const crypto = getCrypto();

    const normalizedAddress = walletAddress.toLowerCase();

    const defaultSalt = new TextEncoder().encode("MORSE_KEY_DERIVATION_v1");
    const finalSalt = salt ? new Uint8Array(salt) : defaultSalt;

    const addressBytes = new TextEncoder().encode(normalizedAddress);
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        addressBytes.buffer.slice(addressBytes.byteOffset, addressBytes.byteOffset + addressBytes.byteLength) as ArrayBuffer,
        "PBKDF2",
        false,
        ["deriveKey"]
    );

    const saltBuffer = finalSalt.buffer.slice(finalSalt.byteOffset, finalSalt.byteOffset + finalSalt.byteLength) as ArrayBuffer;

    const derivedKey = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: saltBuffer,
            iterations: 100000,
            hash: "SHA-256",
        },
        keyMaterial,
        {
            name: "AES-GCM",
            length: 256,
        },
        true,
        ["encrypt", "decrypt"]
    );

    return derivedKey;
}

export function generateShareableLink(
    baseUrl: string,
    signalId: string,
    keyBase64?: string
): string {
    // Security: Don't include key in URL fragment
    // Key should be distributed separately through a secure channel
    return `${baseUrl}/view/${signalId}`;
}

