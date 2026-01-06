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

export async function deriveKeyPairFromWalletSignature(
    walletAddress: string,
    domain: string,
    chainId: number,
    signMessage: (message: string) => Promise<string>
): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
    await getSodium();

    const message = `MORSE: derive encryption seed v1 | ${domain} | ${chainId} | ${walletAddress.toLowerCase()}`;
    const signature = await signMessage(message);

    const sigBytes = ethers.utils.arrayify(signature);

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
            x25519PublicKey: ethers.utils.hexZeroPad(
                ethers.utils.hexlify(Buffer.from(x25519PublicKey, "base64")),
                32
            ),
            keyId: `0x${keyId}`,
            issuedAt: issuedAt,
            expiresAt: expiresAt,
            domain: domain,
        },
    };
}

export async function createKeyCertificate(
    walletAddress: string,
    x25519PublicKey: string,
    domain: string,
    chainId: number,
    expiresAt: number,
    signTypedData: (domain: any, types: any, value: any) => Promise<string>
): Promise<MorseKeyCert> {
    const issuedAt = Date.now();

    const abiCoder = ethers.utils.defaultAbiCoder;
    const keyIdInput = abiCoder.encode(
        ["address", "bytes32", "uint64", "string", "uint256"],
        [
            walletAddress.toLowerCase(),
            ethers.utils.hexZeroPad(
                ethers.utils.hexlify(Buffer.from(x25519PublicKey, "base64")),
                32
            ),
            expiresAt,
            domain,
            chainId,
        ]
    );
    const keyId = ethers.utils.keccak256(keyIdInput).slice(2);

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

        const messageTypes = typedData.types;

        const recovered = ethers.utils.verifyTypedData(
            typedData.domain,
            messageTypes,
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

export async function createSharedSignal(
    payloadBytes: Uint8Array,
    recipientPubKey: Uint8Array,
    walletTarget: string,
    walletCreator: string,
    expiresAt: number,
    signalId: string
): Promise<CreateSharedSignalResult> {
    await getSodium();

    const dataKey = sodium.randombytes_buf(32);

    const payloadNonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const encryptedPayload = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        payloadBytes,
        null,
        null,
        payloadNonce,
        dataKey
    );

    const senderKeypair = sodium.crypto_box_keypair();

    const sharedSecret = sodium.crypto_scalarmult(
        senderKeypair.privateKey,
        recipientPubKey
    );

    const salt = `MORSE_SEAL_${signalId}_v1`;
    const info = "wrap_datakey";
    const wrappingKey = await hkdfSha256(sharedSecret, salt, info, 32);

    const sealedNonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);

    const expiresAtInt = Math.floor(Number(expiresAt));
    const abiCoder = ethers.utils.defaultAbiCoder;
    const senderEphemeralPubKeyHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(senderKeypair.publicKey), 32);
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
    const aadBytes = ethers.utils.arrayify(aad);
    const aadHash = ethers.utils.keccak256(aad).slice(2);

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

    const recipientKeypair = await deriveKeyPairFromWalletSignature(
        walletAddress,
        domain,
        chainId,
        signMessage
    );

    const senderEphemeralPub = ethers.utils.arrayify(
        `0x${Buffer.from(senderEphemeralPublicKeyBase64, "base64").toString("hex")}`
    );

    if (senderEphemeralPub.length !== 32) {
        throw new Error(
            `Invalid senderEphemeralPublicKey length: expected 32 bytes, got ${senderEphemeralPub.length} bytes. ` +
            `Base64 input: ${senderEphemeralPublicKeyBase64.substring(0, 20)}...`
        );
    }

    const sharedSecret = sodium.crypto_scalarmult(
        recipientKeypair.privateKey,
        senderEphemeralPub
    );

    const salt = `MORSE_SEAL_${signalId}_v1`;
    const info = "wrap_datakey";
    const wrappingKey = await hkdfSha256(sharedSecret, salt, info, 32);

    const sealedDataKey = ethers.utils.arrayify(`0x${Buffer.from(sealedDataKeyBase64, "base64").toString("hex")}`);
    const sealedNonce = ethers.utils.arrayify(`0x${Buffer.from(sealedNonceBase64, "base64").toString("hex")}`);

    const expectedNonceLength = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
    if (sealedNonce.length !== expectedNonceLength) {
        throw new Error(
            `Invalid sealedNonce length: expected ${expectedNonceLength} bytes, got ${sealedNonce.length} bytes. ` +
            `Base64 input: ${sealedNonceBase64.substring(0, 20)}...`
        );
    }

    const expiresAtInt = Math.floor(Number(expiresAt));
    const abiCoder = ethers.utils.defaultAbiCoder;
    const senderEphemeralPubKeyHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(senderEphemeralPub), 32);

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
    const aadBytes = ethers.utils.arrayify(aad);
    const computedAadHash = ethers.utils.keccak256(aad).slice(2);

    if (computedAadHash !== aadHash) {
        throw new Error(`AAD hash mismatch - possible tampering. Expected: ${aadHash}, Got: ${computedAadHash}`);
    }

    const dataKey = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        sealedDataKey,
        aadBytes,
        sealedNonce,
        wrappingKey
    );

    const encryptedPayload = new Uint8Array(Buffer.from(encryptedPayloadBase64, "base64"));
    const payloadNonceBytes = Buffer.from(payloadNonceBase64, "base64");
    const payloadNonce = new Uint8Array(payloadNonceBytes);

    if (payloadNonce.length !== expectedNonceLength) {
        throw new Error(
            `Invalid payloadNonce length: expected ${expectedNonceLength} bytes, got ${payloadNonce.length} bytes. ` +
            `Base64 input: ${payloadNonceBase64.substring(0, 20)}...`
        );
    }

    const payload = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        encryptedPayload,
        null,
        payloadNonce,
        dataKey
    );

    return payload;
}

export async function sealDataKey(
    dataKeyBytes: Uint8Array,
    walletTarget: string,
    walletCreator: string,
    expiresAt: number,
    signalId: string,
    recipientPubKey: Uint8Array
): Promise<{
    sealedDataKey: string;
    sealedNonce: string;
    senderEphemeralPublicKey: string;
    aadHash: string;
}> {
    await getSodium();

    const senderKeypair = sodium.crypto_box_keypair();

    const sharedSecret = sodium.crypto_scalarmult(
        senderKeypair.privateKey,
        recipientPubKey
    );

    const salt = `MORSE_SEAL_${signalId}_v1`;
    const info = "wrap_datakey";
    const wrappingKey = await hkdfSha256(sharedSecret, salt, info, 32);

    const sealedNonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);

    const expiresAtInt = Math.floor(Number(expiresAt));
    const abiCoder = ethers.utils.defaultAbiCoder;
    const senderEphemeralPubKeyHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(senderKeypair.publicKey), 32);
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
    const aadBytes = ethers.utils.arrayify(aad);
    const aadHash = ethers.utils.keccak256(aad).slice(2);

    const sealedDataKey = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        dataKeyBytes,
        aadBytes,
        null,
        sealedNonce,
        wrappingKey
    );

    return {
        sealedDataKey: Buffer.from(sealedDataKey).toString("base64"),
        sealedNonce: Buffer.from(sealedNonce).toString("base64"),
        senderEphemeralPublicKey: Buffer.from(senderKeypair.publicKey).toString("base64"),
        aadHash,
    };
}

export async function unsealDataKey(
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

    const recipientKeypair = await deriveKeyPairFromWalletSignature(
        walletAddress,
        domain,
        chainId,
        signMessage
    );

    const senderEphemeralPubHexString = `0x${Buffer.from(senderEphemeralPublicKeyBase64, "base64").toString("hex")}`;
    const senderEphemeralPub = ethers.utils.arrayify(senderEphemeralPubHexString);

    if (senderEphemeralPub.length !== 32) {
        throw new Error(
            `Invalid senderEphemeralPublicKey length: expected 32 bytes, got ${senderEphemeralPub.length} bytes. ` +
            `Base64 input: ${senderEphemeralPublicKeyBase64.substring(0, 20)}...`
        );
    }

    const sharedSecret = sodium.crypto_scalarmult(
        recipientKeypair.privateKey,
        senderEphemeralPub
    );

    const salt = `MORSE_SEAL_${signalId}_v1`;
    const info = "wrap_datakey";
    const wrappingKey = await hkdfSha256(sharedSecret, salt, info, 32);

    const sealedDataKey = ethers.utils.arrayify(`0x${Buffer.from(sealedDataKeyBase64, "base64").toString("hex")}`);
    const sealedNonce = ethers.utils.arrayify(`0x${Buffer.from(sealedNonceBase64, "base64").toString("hex")}`);

    const expectedSealedNonceLength = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
    if (sealedNonce.length !== expectedSealedNonceLength) {
        throw new Error(
            `Invalid sealedNonce length: expected ${expectedSealedNonceLength} bytes, got ${sealedNonce.length} bytes. ` +
            `Base64 input: ${sealedNonceBase64.substring(0, 20)}...`
        );
    }

    const expiresAtInt = Math.floor(Number(expiresAt));
    const abiCoder = ethers.utils.defaultAbiCoder;
    const senderEphemeralPubKeyHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(senderEphemeralPub), 32);

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
    const aadBytes = ethers.utils.arrayify(aad);
    const computedAadHash = ethers.utils.keccak256(aad).slice(2);

    if (computedAadHash !== aadHash) {
        throw new Error(`AAD hash mismatch - possible tampering. Expected: ${aadHash}, Got: ${computedAadHash}`);
    }

    const dataKey = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        sealedDataKey,
        aadBytes,
        sealedNonce,
        wrappingKey
    );

    if (!dataKey || dataKey.length !== 32) {
        throw new Error(`Failed to unseal data key - invalid length or decryption failed. Length: ${dataKey?.length || 0}`);
    }

    return dataKey;
}

export function generateSignalId(): string {
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return hex.substring(0, 20);
}

