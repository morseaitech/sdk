import type { WalletAuth } from "./types";

export interface PrivateKeyWalletConfig {
    privateKey: string;
}

export interface PreSignedWalletConfig {
    address: string;
    signature: string;
    message: string;
}

export function createWalletFromPrivateKey(config: PrivateKeyWalletConfig): WalletAuth {
    let ethersModule: any;

    try {
        ethersModule = require("ethers");
    } catch {
        try {
            throw new Error("ethers must be installed");
        } catch (error: any) {
            throw new Error(
                "ethers is required for private key wallets. Install it: npm install ethers"
            );
        }
    }

    const { Wallet } = ethersModule;

    const tempWallet = new Wallet(config.privateKey);
    const address = tempWallet.address;


    const privateKey = config.privateKey;

    return {
        address,
        signMessage: async (message: string) => {
            const wallet = new Wallet(privateKey);
            const signature = await wallet.signMessage(message);
            return signature;
        },
    };
}

export function createWalletFromPreSigned(config: PreSignedWalletConfig): WalletAuth {
    return {
        address: config.address,
        signMessage: async (message: string) => {
            if (message === config.message) {
                return config.signature;
            }
            throw new Error(
                "Pre-signed wallet can only sign the original message. " +
                "Expected: " + config.message + ", Got: " + message
            );
        },
    };
}

export async function createBrowserWallet(
    ethereum: any,
    address?: string
): Promise<WalletAuth> {
    let currentAddress: string = address || "";

    if (!currentAddress) {
        const accounts = await ethereum.request({ method: "eth_accounts" });
        if (accounts.length === 0) {
            throw new Error("No wallet connected. Please connect your wallet first.");
        }
        currentAddress = accounts[0];
    }

    return {
        address: currentAddress,
        signMessage: async (message: string) => {
            try {
                const signature = await ethereum.request({
                    method: "personal_sign",
                    params: [message, currentAddress],
                });
                return signature;
            } catch (error: any) {
                if (error.code === 4001) {
                    throw new Error("User rejected the signing request");
                }
                throw error;
            }
        },
    };
}

