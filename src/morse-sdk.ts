import type {
    CreateSignalOptions,
    CreateSignalOptionsEncrypted,
    CreateSignalResponse,
    CreateSignalResponseEncrypted,
    OpenSignalResponse,
    OpenSignalResponseDecrypted,
    ListMySignalsResponse,
    UploadFileOptions,
    UploadFileResponse,
    DownloadFileResponse,
    WalletAuth,
    MorseSDKConfig,
} from "./types";
import type { MorseContract } from "./contracts/MorseContract";
import { MorseSDKV1 } from "./implementations/v1/MorseSDKV1";

export interface MorseSDKCallbacks {
    onRequest?: (url: string, options: RequestInit) => void;
    onResponse?: (url: string, response: Response) => void;
    onError?: (error: Error) => void;
}

export class MorseSDK implements MorseContract {
    private contract: MorseContract;
    private apiVersion: string;
    private config: MorseSDKConfig;

    constructor(config: MorseSDKConfig) {
        if (!config.apiKey) {
            throw new Error("apiKey is required. Please provide an API key in the SDK configuration.");
        }

        this.config = config;
        this.apiVersion = config.apiVersion || "v1";

        switch (this.apiVersion) {
            case "v1":
                this.contract = new MorseSDKV1(config);
                break;
            default:
                this.contract = new MorseSDKV1(config);
                this.apiVersion = "v1";
        }
    }

    getConfig(): Readonly<MorseSDKConfig> {
        return { ...this.config };
    }

    getApiVersion(): string {
        return this.apiVersion;
    }

    getContract(): MorseContract {
        return this.contract;
    }

    async createSignal(
        wallet: WalletAuth,
        options: CreateSignalOptions
    ): Promise<CreateSignalResponse> {
        return this.contract.createSignal(wallet, options);
    }

    async openSignal(
        wallet: WalletAuth,
        signalId: string
    ): Promise<OpenSignalResponse> {
        return this.contract.openSignal(wallet, signalId);
    }

    async listMySignals(wallet: WalletAuth): Promise<ListMySignalsResponse> {
        return this.contract.listMySignals(wallet);
    }

    async uploadFile(
        wallet: WalletAuth,
        options: UploadFileOptions
    ): Promise<UploadFileResponse> {
        return this.contract.uploadFile(wallet, options);
    }

    async downloadFile(
        wallet: WalletAuth,
        signalId: string
    ): Promise<DownloadFileResponse> {
        return this.contract.downloadFile(wallet, signalId);
    }

    async burnSignal(wallet: WalletAuth, signalId: string): Promise<{ success: boolean }> {
        return this.contract.burnSignal(wallet, signalId);
    }

    async createSignalEncrypted(
        wallet: WalletAuth,
        options: CreateSignalOptionsEncrypted
    ): Promise<CreateSignalResponseEncrypted> {
        const v1Contract = this.contract as any;
        if (v1Contract.createSignalEncrypted) {
            return v1Contract.createSignalEncrypted(wallet, options);
        }
        throw new Error("createSignalEncrypted is not available in this API version");
    }

    async openSignalDecrypted(
        wallet: WalletAuth,
        signalId: string,
        keyBase64?: string
    ): Promise<OpenSignalResponseDecrypted> {
        const v1Contract = this.contract as any;
        if (v1Contract.openSignalDecrypted) {
            return v1Contract.openSignalDecrypted(wallet, signalId, keyBase64);
        }
        throw new Error("openSignalDecrypted is not available in this API version");
    }

    async uploadFileEncrypted(
        wallet: WalletAuth,
        fileData: ArrayBuffer | Uint8Array | Buffer,
        originalName: string,
        mimeType: string,
        key: CryptoKey
    ): Promise<UploadFileResponse> {
        const v1Contract = this.contract as any;
        if (v1Contract.uploadFileEncrypted) {
            return v1Contract.uploadFileEncrypted(wallet, fileData, originalName, mimeType, key);
        }
        throw new Error("uploadFileEncrypted is not available in this API version");
    }

    async downloadFileDecrypted(
        wallet: WalletAuth,
        signalId: string,
        keyBase64: string
    ): Promise<{ data: ArrayBuffer; originalName: string; mimeType: string; sizeBytes: number }> {
        const v1Contract = this.contract as any;
        if (v1Contract.downloadFileDecrypted) {
            return v1Contract.downloadFileDecrypted(wallet, signalId, keyBase64);
        }
        throw new Error("downloadFileDecrypted is not available in this API version");
    }
}

