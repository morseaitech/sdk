/**
 * Wallet Key Registry Service
 * 
 * Fetches and publishes X25519 public keys from/to the backend registry
 */

import type { MorseKeyCert } from "./crypto-x25519";

export interface GetPublicKeyResponse {
    walletAddress: string;
    certificate: MorseKeyCert | null;
    exists: boolean;
}

export class WalletKeyService {
    private baseUrl: string;
    private apiKey: string;
    private apiVersion: string;

    constructor(baseUrl: string, apiKey: string, apiVersion: string = "v1") {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.apiVersion = apiVersion;
    }

    private getApiUrl(path: string): string {
        return `${this.baseUrl}/${this.apiVersion}${path}`;
    }

    async getPublicKey(walletAddress: string): Promise<GetPublicKeyResponse> {
        const url = this.getApiUrl(`/wallet-key-registry/${walletAddress.toLowerCase()}`);

        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": this.apiKey,
            },
        });

        if (!response.ok) {
            if (response.status === 404) {
                return {
                    walletAddress: walletAddress.toLowerCase(),
                    certificate: null,
                    exists: false,
                };
            }
            throw new Error(`Failed to fetch public key: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return {
            walletAddress: data.walletAddress,
            certificate: data.certificate || null,
            exists: !!data.certificate,
        };
    }

    async publishPublicKey(certificate: MorseKeyCert): Promise<void> {
        const url = this.getApiUrl("/wallet-key-registry");

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": this.apiKey,
            },
            body: JSON.stringify({ certificate }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: "Unknown error" }));
            throw new Error(`Failed to publish public key: ${error.message || response.statusText}`);
        }
    }
}
