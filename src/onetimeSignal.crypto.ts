/**
 * Cryptography utilities for Onetime Signal
 * Uses PBKDF2-SHA-256 to derive encryption key from linkId + password
 * All encryption/decryption happens on the client (zero-knowledge)
 */

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

function generateIV(): Uint8Array {
    const crypto = getCrypto();
    return crypto.getRandomValues(new Uint8Array(12));
}

/**
 * Derives an encryption key from linkId and optional password using PBKDF2-SHA-256
 * Note: Web Crypto API doesn't support HKDF, so we use PBKDF2 as an alternative
 */
async function deriveKeyFromLinkId(linkId: string, password?: string): Promise<CryptoKey> {
    const crypto = getCrypto();

    // Create salt from linkId + password info
    const saltData = password
        ? `${linkId}_MORSE_ONETIME_${password}`
        : `${linkId}_MORSE_ONETIME_NO_PASSWORD`;
    const salt = new TextEncoder().encode(saltData);

    // Use linkId as the password material for PBKDF2
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(linkId),
        "PBKDF2",
        false,
        ["deriveKey"]
    );

    const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;

    // Derive key using PBKDF2-SHA-256 (100,000 iterations for security)
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

/**
 * Encrypts text using AES-256-GCM for Onetime Signal
 */
export async function encryptOnetimeText(
    text: string,
    linkId: string,
    password?: string
): Promise<{ encrypted: string; iv: string }> {
    const crypto = getCrypto();
    const key = await deriveKeyFromLinkId(linkId, password);
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

/**
 * Decrypts text using AES-256-GCM for Onetime Signal
 */
export async function decryptOnetimeText(
    encryptedBase64: string,
    ivBase64: string,
    linkId: string,
    password?: string
): Promise<string> {
    const crypto = getCrypto();
    const key = await deriveKeyFromLinkId(linkId, password);

    const encrypted = fromBase64(encryptedBase64);
    const iv = fromBase64(ivBase64);

    if (iv.length !== 12) {
        throw new Error(`Invalid IV length: ${iv.length} bytes. Expected 12 bytes for AES-GCM.`);
    }

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

/**
 * Encrypts file using AES-256-GCM for Onetime Signal
 */
export async function encryptOnetimeFile(
    fileData: ArrayBuffer | Uint8Array | Buffer,
    linkId: string,
    password?: string
): Promise<{ encrypted: ArrayBuffer; iv: string }> {
    const crypto = getCrypto();
    const key = await deriveKeyFromLinkId(linkId, password);

    let data: ArrayBuffer;
    if (fileData instanceof Buffer) {
        data = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer;
    } else if (fileData instanceof Uint8Array) {
        data = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer;
    } else {
        data = fileData;
    }

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
        encrypted,
        iv: toBase64(iv),
    };
}

/**
 * Decrypts file using AES-256-GCM for Onetime Signal
 */
export async function decryptOnetimeFile(
    encryptedData: ArrayBuffer,
    ivBase64: string,
    linkId: string,
    password?: string
): Promise<ArrayBuffer> {
    const crypto = getCrypto();
    const key = await deriveKeyFromLinkId(linkId, password);

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

/**
 * Hashes a password using SHA-256 for Onetime Signal
 * This hash is sent to the backend for verification
 */
export async function hashOnetimePassword(password: string): Promise<string> {
    const crypto = getCrypto();
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    return hashHex;
}

