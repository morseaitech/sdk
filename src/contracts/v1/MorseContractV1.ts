import type { MorseContract } from "../MorseContract";
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
} from "../../types";

export interface MorseContractV1 extends MorseContract {
    readonly version: "v1";

    createSignal(wallet: WalletAuth, options: CreateSignalOptions): Promise<CreateSignalResponse>;
    createSignalEncrypted(wallet: WalletAuth, options: CreateSignalOptionsEncrypted): Promise<CreateSignalResponseEncrypted>;
    openSignal(wallet: WalletAuth, signalId: string): Promise<OpenSignalResponse>;
    openSignalDecrypted(wallet: WalletAuth, signalId: string, keyBase64?: string): Promise<OpenSignalResponseDecrypted>;
    listMySignals(wallet: WalletAuth): Promise<ListMySignalsResponse>;
    uploadFile(wallet: WalletAuth, options: UploadFileOptions): Promise<UploadFileResponse>;
    uploadFileEncrypted(wallet: WalletAuth, fileData: ArrayBuffer | Uint8Array | Buffer, originalName: string, mimeType: string, key: CryptoKey): Promise<UploadFileResponse>;
    downloadFile(wallet: WalletAuth, signalId: string): Promise<DownloadFileResponse>;
    downloadFileDecrypted(wallet: WalletAuth, signalId: string, keyBase64: string): Promise<{ data: ArrayBuffer; originalName: string; mimeType: string; sizeBytes: number }>;
    burnSignal(wallet: WalletAuth, signalId: string): Promise<{ success: boolean }>;
}

