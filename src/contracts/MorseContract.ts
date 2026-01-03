import type {
    CreateSignalOptions,
    CreateSignalResponse,
    OpenSignalResponse,
    ListMySignalsResponse,
    UploadFileOptions,
    UploadFileResponse,
    DownloadFileResponse,
    WalletAuth,
} from "../types";

export interface MorseContract {
    createSignal(wallet: WalletAuth, options: CreateSignalOptions): Promise<CreateSignalResponse>;
    openSignal(wallet: WalletAuth, signalId: string): Promise<OpenSignalResponse>;
    listMySignals(wallet: WalletAuth): Promise<ListMySignalsResponse>;
    uploadFile(wallet: WalletAuth, options: UploadFileOptions): Promise<UploadFileResponse>;
    downloadFile(wallet: WalletAuth, signalId: string): Promise<DownloadFileResponse>;
    burnSignal(wallet: WalletAuth, signalId: string): Promise<{ success: boolean }>;
}