export type TtlCacheOptions = {
  /** How long an entry stays valid after it is written. */
  ttlMs: number;
  /** Hard ceiling on retained entries; the oldest are dropped first. */
  maxEntries: number;
  /** Clock seam for tests. */
  now?: () => number;
};

/**
 * A Map with an expiry and a ceiling.
 *
 * Written for cached authorization decisions, where a plain Map is the wrong
 * shape twice over: an entry that never expires keeps honoring a credential
 * the user has already revoked upstream, and one that is never evicted retains
 * every distinct token the process has ever seen. Both only end at restart.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: TtlCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = Math.max(1, options.maxEntries);
    this.now = options.now ?? (() => Date.now());
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    // Re-insert so the eviction order below is by write time.
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    this.evict();
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private evict(): void {
    // Map iterates in insertion order, so this drops the oldest writes — which
    // are also the entries closest to expiring. Expired ones that never get
    // read again leave this way rather than lingering to the process's end.
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) {
        break;
      }
      this.entries.delete(key);
    }
  }
}
