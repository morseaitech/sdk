export function isValidSignalId(signalId: string): boolean {
  if (!signalId || typeof signalId !== 'string') {
    return false;
  }
  if (signalId.length < 8 || signalId.length > 64) {
    return false;
  }
  return /^[a-zA-Z0-9_-]+$/.test(signalId);
}

export function isValidWalletAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function validateSignalId(signalId: string): void {
  if (!isValidSignalId(signalId)) {
    throw new Error(`Invalid signal ID: ${signalId}. Must be 8-64 alphanumeric characters.`);
  }
}

export function validateWalletAddress(address: string): void {
  if (!isValidWalletAddress(address)) {
    throw new Error(`Invalid wallet address: ${address}. Must be a valid Ethereum address.`);
  }
}

export function formatExpiration(expiresAt: string): string {
  const date = new Date(expiresAt);
  return date.toLocaleString();
}

export function isSignalExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

export function getTimeUntilExpiration(expiresAt: string): number {
  return Math.max(0, new Date(expiresAt).getTime() - Date.now());
}

export function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid expiresIn format: ${expiresIn}. Use format like "24h", "7d", "30m"`);
  }
  
  const value = parseInt(match[1], 10);
  const unit = match[2];
  
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  
  return value * multipliers[unit];
}

export function filterActiveSignals<T extends { status: string; expiresAt: string }>(
  signals: T[]
): T[] {
  const now = new Date();
  return signals.filter(
    (signal) => signal.status === "active" && new Date(signal.expiresAt) > now
  );
}

export function sortSignalsByDate<T extends { createdAt: string }>(
  signals: T[],
  order: "asc" | "desc" = "desc"
): T[] {
  return [...signals].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime();
    const dateB = new Date(b.createdAt).getTime();
    return order === "desc" ? dateB - dateA : dateA - dateB;
  });
}

export function getSignalUrl(baseUrl: string, signalId: string, keyBase64?: string): string {
  const url = `${baseUrl}/#/signal/${signalId}`;
  if (keyBase64) {
    return `${url}#k=${encodeURIComponent(keyBase64)}`;
  }
  return url;
}

export function extractSignalIdFromUrl(url: string): string | null {
  const match = url.match(/\/signal\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}
