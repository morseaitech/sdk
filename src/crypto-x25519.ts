/**
 * MORSE SDK - X25519 + XChaCha20-Poly1305 Encryption
 * 
 * Compatible with morse-frontend's crypto-x25519.ts
 * 
 * Security Model:
 * - X25519 for ECDH key exchange
 * - XChaCha20-Poly1305 for authenticated encryption
 * - HKDF-SHA-256 for key derivation
 * - Ephemeral sender keys (forward secrecy)
 */

import _sodium from "libsodium-wrappers";
import { ethers } from "ethers";

let sodium: typeof _sodium;

async function getSodium(): Promise<typeof _sodium> {
    if (!sodium) {
        await _sodium.ready;
        sodium = _sodium;
    }
    return sodium;
}

export const X25519_CIPHER_VERSION = "morse-x25519-xchacha20poly1305-v2";

/**
 * HKDF-SHA-256 implementation
 */
async function hkdfSha256(
    ikm: Uint8Array,
    salt: string | Uint8Array,
    info: string | Uint8Array,
    length: number = 32
): Promise<Uint8Array> {
    const saltBytes = typeof salt === "string"
        ? new TextEncoder().encode(salt)
        : new Uint8Array(salt);
    const infoBytes = typeof info === "string"
        ? new TextEncoder().encode(info)
        : new Uint8Array(info);

    const ikmCopy = new Uint8Array(ikm.length);
    ikmCopy.set(ikm);
    const saltCopy = new Uint8Array(saltBytes.length);
    saltCopy.set(saltBytes);
    const infoCopy = new Uint8Array(infoBytes.length);
    infoCopy.set(infoBytes);

    const crypto = globalThis.crypto;
    
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        ikmCopy.buffer,
        "HKDF",
        false,
        ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: saltCopy.buffer,
            info: infoCopy.buffer,
        },
        keyMaterial,
        length * 8
    );

    return new Uint8Array(derivedBits);
}

/**
 * Derive deterministic X25519 keypair from wallet signature
 */
export async function deriveKeyPairFromWalletSignature(
    walletAddress: string,
    domain: string,
    chainId: number,
    signMessage: (message: string) => Promise<string>
): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
    await getSodium();

    const message = `MORSE: derive encryption seed v1 | ${domain} | ${chainId} | ${walletAddress.toLowerCase()}`;
    const signature = await signMessage(message);

    const sigBytes = ethers.getBytes(signature);

    const seed = await hkdfSha256(
        sigBytes,
        "MORSE_SEED_v1",
        walletAddress.toLowerCase(),
        32
    );

    const keypair = sodium.crypto_box_seed_keypair(seed);

    return {
        publicKey: keypair.publicKey,
        privateKey: keypair.privateKey,
    };
}

/**
 * Key Certificate interface
 */
export interface MorseKeyCert {
    walletAddress: string;
    x25519PublicKey: string;
    keyId: string;
    expiresAt: number;
    issuedAt: number;
    domain: string;
    chainId: number;
    signature: string;
}

/**
 * Create EIP-712 typed data for key certificate
 */
function createKeyCertTypedData(
    walletAddress: string,
    x25519PublicKey: string,
    keyId: string,
    issuedAt: number,
    expiresAt: number,
    domain: string,
    chainId: number
) {
    return {
        domain: {
            name: "MORSE",
            version: "1",
            chainId: chainId,
        },
        types: {
            MorseKeyCert: [
                { name: "walletAddress", type: "address" },
                { name: "x25519PublicKey", type: "bytes32" },
                { name: "keyId", type: "bytes32" },
                { name: "issuedAt", type: "uint64" },
                { name: "expiresAt", type: "uint64" },
                { name: "domain", type: "string" },
            ],
        },
        primaryType: "MorseKeyCert" as const,
        message: {
            walletAddress: walletAddress.toLowerCase(),
            x25519PublicKey: ethers.zeroPadValue(
                ethers.hexlify(Buffer.from(x25519PublicKey, "base64")),
                32
            ),
            keyId: `0x${keyId}`,
            issuedAt: issuedAt,
            expiresAt: expiresAt,
            domain: domain,
        },
    };
}

/**
 * Create and sign a key certificate
 */
export async function createKeyCertificate(
    walletAddress: string,
    x25519PublicKey: string,
    domain: string,
    chainId: number,
    expiresAt: number,
    signTypedData: (domain: any, types: any, value: any) => Promise<string>
): Promise<MorseKeyCert> {
    const issuedAt = Date.now();

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const keyIdInput = abiCoder.encode(
        ["address", "bytes32", "uint64", "string", "uint256"],
        [
            walletAddress.toLowerCase(),
            ethers.zeroPadValue(
                ethers.hexlify(Buffer.from(x25519PublicKey, "base64")),
                32
            ),
            expiresAt,
            domain,
            chainId,
        ]
    );
    const keyId = ethers.keccak256(keyIdInput).slice(2);

    const typedData = createKeyCertTypedData(
        walletAddress,
        x25519PublicKey,
        keyId,
        issuedAt,
        expiresAt,
        domain,
        chainId
    );

    const signature = await signTypedData(
        typedData.domain,
        typedData.types,
        typedData.message
    );

    return {
        walletAddress: walletAddress.toLowerCase(),
        x25519PublicKey,
        keyId,
        expiresAt,
        issuedAt,
        domain,
        chainId,
        signature,
    };
}

/**
 * Verify a key certificate signature
 */
export function verifyKeyCertificate(cert: MorseKeyCert): boolean {
    try {
        const typedData = createKeyCertTypedData(
            cert.walletAddress,
            cert.x25519PublicKey,
            cert.keyId,
            cert.issuedAt,
            cert.expiresAt,
            cert.domain,
            cert.chainId
        );

        const recovered = ethers.verifyTypedData(
            typedData.domain,
            typedData.types,
            typedData.message,
            cert.signature
        );

        return recovered.toLowerCase() === cert.walletAddress.toLowerCase();
    } catch {
        return false;
    }
}

export interface CreateSharedSignalResult {
    cipherVersion: string;
    encryptedPayload: string;
    payloadNonce: string;
    sealedDataKey: string;
    sealedNonce: string;
    senderEphemeralPublicKey: string;
    aadHash: string;
}

/**
 * Create shared signal (sender side)
 */
export async function createSharedSignal(
    payloadBytes: Uint8Array,
    recipientPubKey: Uint8Array,
    walletTarget: string,
    walletCreator: string,
    expiresAt: number,
    signalId: string
): Promise<CreateSharedSignalResult> {
    await getSodium();

    // 1. Generate random data key (32 bytes)
    const dataKey = sodium.randombytes_buf(32);

    // 2. Encrypt payload using XChaCha20-Poly1305
    const payloadNonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const encryptedPayload = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        payloadBytes,
        null,
        null,
        payloadNonce,
        dataKey
    );

    // 3. Generate ephemeral sender keypair
    const senderKeypair = sodium.crypto_box_keypair();

    // 4. Derive shared secret via X25519
    const sharedSecret = sodium.crypto_scalarmult(
        senderKeypair.privateKey,
        recipientPubKey
    );

    // 5. Derive wrapping key via HKDF
    const salt = `MORSE_SEAL_${signalId}_v1`;
    const info = "wrap_datakey";
    const wrappingKey = await hkdfSha256(sharedSecret, salt, info, 32);

    // 6. Seal data key with AAD
    const sealedNonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);

    const expiresAtInt = Math.floor(Number(expiresAt));
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const senderEphemeralPubKeyHex = ethers.zeroPadValue(ethers.hexlify(senderKeypair.publicKey), 32);
    const aad = abiCoder.encode(
        ["string", "address", "address", "uint64", "string", "bytes32"],
        [
            signalId,
            walletTarget.toLowerCase(),
            walletCreator.toLowerCase(),
            expiresAtInt,
            X25519_CIPHER_VERSION,
            senderEphemeralPubKeyHex,
        ]
    );
    const aadBytes = ethers.getBytes(aad);
    const aadHash = ethers.keccak256(aad).slice(2);

    const sealedDataKey = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        dataKey,
        aadBytes,
        null,
        sealedNonce,
        wrappingKey
    );

    return {
        cipherVersion: X25519_CIPHER_VERSION,
        encryptedPayload: Buffer.from(encryptedPayload).toString("base64"),
        payloadNonce: Buffer.from(payloadNonce).toString("base64"),
        sealedDataKey: Buffer.from(sealedDataKey).toString("base64"),
        sealedNonce: Buffer.from(sealedNonce).toString("base64"),
        senderEphemeralPublicKey: Buffer.from(senderKeypair.publicKey).toString("base64"),
        aadHash,
    };
}

/**
 * Open shared signal (recipient side)
 */
export async function openSharedSignal(
    encryptedPayloadBase64: string,
    payloadNonceBase64: string,
    sealedDataKeyBase64: string,
    sealedNonceBase64: string,
    senderEphemeralPublicKeyBase64: string,
    signalId: string,
    walletTarget: string,
    walletCreator: string,
    expiresAt: number,
    aadHash: string,
    walletAddress: string,
    domain: string,
    chainId: number,
    signMessage: (message: string) => Promise<string>
): Promise<Uint8Array> {
    await getSodium();

    // 1. Derive recipient's static keypair
    const recipientKeypair = await deriveKeyPairFromWalletSignature(
        walletAddress,
        domain,
        chainId,
        signMessage
    );

    // 2. Import sender's ephemeral public key
    const senderEphemeralPub = ethers.getBytes(
        `0x${Buffer.from(senderEphemeralPublicKeyBase64, "base64").toString("hex")}`
    );

    // 3. Derive shared secret
    const sharedSecret = sodium.crypto_scalarmult(
        recipientKeypair.privateKey,
        senderEphemeralPub
    );

    // 4. Derive wrapping key
    const salt = `MORSE_SEAL_${signalId}_v1`;
    const info = "wrap_datakey";
    const wrappingKey = await hkdfSha256(sharedSecret, salt, info, 32);

    // 5. Unseal data key with AAD verification
    const sealedDataKey = ethers.getBytes(`0x${Buffer.from(sealedDataKeyBase64, "base64").toString("hex")}`);
    const sealedNonce = ethers.getBytes(`0x${Buffer.from(sealedNonceBase64, "base64").toString("hex")}`);

    const expiresAtInt = Math.floor(Number(expiresAt));
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const aad = abiCoder.encode(
        ["string", "address", "address", "uint64", "string", "bytes32"],
        [
            signalId,
            walletTarget.toLowerCase(),
            walletCreator.toLowerCase(),
            expiresAtInt,
            X25519_CIPHER_VERSION,
            ethers.zeroPadValue(ethers.hexlify(senderEphemeralPub), 32),
        ]
    );
    const aadBytes = ethers.getBytes(aad);
    const computedAadHash = ethers.keccak256(aad).slice(2);

    if (computedAadHash !== aadHash) {
        throw new Error("AAD hash mismatch - possible tampering");
    }

    const dataKey = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        sealedDataKey,
        aadBytes,
        sealedNonce,
        wrappingKey
    );

    // 6. Decrypt payload
    const encryptedPayload = new Uint8Array(Buffer.from(encryptedPayloadBase64, "base64"));
    const payloadNonce = new Uint8Array(Buffer.from(payloadNonceBase64, "base64"));

    const payload = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        encryptedPayload,
        null,
        payloadNonce,
        dataKey
    );

    return payload;
}

/**
 * Generate a random UUID for signal ID
 */
export function generateSignalId(): string {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return hex.substring(0, 20);
}

