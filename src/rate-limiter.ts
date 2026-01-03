export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private maxRequests: number;
  private windowMs: number;

  constructor(config: RateLimitConfig) {
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
  }

  async checkLimit(identifier: string = "default"): Promise<void> {
    const now = Date.now();
    const requests = this.requests.get(identifier) || [];

    const recentRequests = requests.filter(timestamp => now - timestamp < this.windowMs);

    if (recentRequests.length >= this.maxRequests) {
      const oldestRequest = Math.min(...recentRequests);
      const waitTime = this.windowMs - (now - oldestRequest);
      throw new RateLimitError(
        `Rate limit exceeded. Maximum ${this.maxRequests} requests per ${this.windowMs}ms. Retry after ${Math.ceil(waitTime / 1000)}s.`,
        waitTime
      );
    }

    recentRequests.push(now);
    this.requests.set(identifier, recentRequests);

    this.cleanup(identifier, now);
  }

  private cleanup(identifier: string, now: number): void {
    const requests = this.requests.get(identifier);
    if (requests) {
      const validRequests = requests.filter(timestamp => now - timestamp < this.windowMs);
      if (validRequests.length === 0) {
        this.requests.delete(identifier);
      } else {
        this.requests.set(identifier, validRequests);
      }
    }
  }

  reset(identifier: string = "default"): void {
    this.requests.delete(identifier);
  }

  resetAll(): void {
    this.requests.clear();
  }

  getRemainingRequests(identifier: string = "default"): number {
    const now = Date.now();
    const requests = this.requests.get(identifier) || [];
    const recentRequests = requests.filter(timestamp => now - timestamp < this.windowMs);
    return Math.max(0, this.maxRequests - recentRequests.length);
  }
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

