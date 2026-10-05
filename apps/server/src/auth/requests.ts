interface Bucket {
  /** One request costs 60,000 credits, avoiding fractional-token rounding. */
  credits: number;
  at: number;
}

/**
 * A token bucket, charged before starting work (including concurrent requests).
 * Idle clients expire; a full map shares one overflow bucket instead of evicting
 * live clients and letting an attacker buy a fresh burst by rotating identities.
 */
export class RequestLimiter {
  readonly #entries = new Map<string, Bucket>();
  #overflow?: Bucket;
  #pruned = 0;

  constructor(
    private readonly burst: number,
    private readonly perMinute: number,
    private readonly maxClients = 1024,
    private readonly now: () => number = Date.now,
  ) {}

  /** Milliseconds until a request can start, or zero when this request was admitted. */
  take(client: string): number {
    const now = this.now();
    const capacity = this.burst * 60_000;
    if (now - this.#pruned >= 60_000) {
      for (const [key, bucket] of this.#entries) {
        if (bucket.credits + Math.max(0, now - bucket.at) * this.perMinute >= capacity)
          this.#entries.delete(key);
      }
      this.#pruned = now;
    }
    let bucket = this.#entries.get(client);
    if (!bucket) {
      if (this.#entries.size < this.maxClients) {
        bucket = { credits: capacity, at: now };
        this.#entries.set(client, bucket);
      } else {
        this.#overflow ??= { credits: capacity, at: now };
        bucket = this.#overflow;
      }
    }
    bucket.credits = Math.min(
      capacity,
      bucket.credits + Math.max(0, now - bucket.at) * this.perMinute,
    );
    // A clock adjustment cannot refill the same elapsed time twice.
    bucket.at = Math.max(bucket.at, now);
    if (bucket.credits < 60_000) return Math.ceil((60_000 - bucket.credits) / this.perMinute);
    bucket.credits -= 60_000;
    return 0;
  }
}

/** One set for proven local browsers and one for everyone else, preserving local recovery. */
export class GatewayRequestLimits {
  readonly #requests = new RequestLimiter(300, 1200);
  readonly #allRequests = new RequestLimiter(1000, 6000, 1);
  readonly #credentials = new RequestLimiter(10, 60);
  readonly #allCredentials = new RequestLimiter(20, 120, 1);
  readonly #writes = new RequestLimiter(30, 120);

  incoming(client: string): number {
    return this.#requests.take(client) || this.#allRequests.take('all');
  }

  credentials(client: string): number {
    return this.#credentials.take(client) || this.#allCredentials.take('all');
  }

  write(principal: string): number {
    return this.#writes.take(principal);
  }
}
