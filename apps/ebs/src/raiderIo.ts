import { z } from "zod";
import type { RaiderIoSummary } from "@dungeon-list/shared";

const twoHoursMs = 2 * 60 * 60 * 1000;
const maxCacheEntries = 2_000;

const raiderIoResponseSchema = z.object({
  profile_url: z.string().url(),
  last_crawled_at: z.string().nullable().optional(),
  mythic_plus_scores_by_season: z
    .array(
      z.object({
        scores: z.object({
          all: z.number().finite().nonnegative()
        })
      })
    )
    .default([])
});

interface CachedProfile {
  value: RaiderIoSummary | null;
  expiresAt: number;
}

export class RaiderIoClient {
  private readonly cache = new Map<string, CachedProfile>();
  private readonly inFlight = new Map<string, Promise<RaiderIoSummary | null>>();
  private rateLimitedUntil = 0;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly endpoint = "https://raider.io/api/v1/characters/profile",
    private readonly cacheTtlMs = twoHoursMs,
    private readonly timeoutMs = 5_000,
    private readonly now: () => number = Date.now
  ) {}

  async getCharacterProfile(characterName: string, realm: string): Promise<RaiderIoSummary | null> {
    const key = `${realm.trim().toLocaleLowerCase("en-US")}:${characterName.trim().toLocaleLowerCase("en-US")}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      return cached.value;
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      return pending;
    }

    const lookup = this.fetchCharacterProfile(characterName, realm).then((value) => {
      this.cache.set(key, {
        value,
        expiresAt: this.now() + this.cacheTtlMs
      });
      if (this.cache.size > maxCacheEntries) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) {
          this.cache.delete(oldestKey);
        }
      }
      return value;
    });
    this.inFlight.set(key, lookup);

    try {
      return await lookup;
    } finally {
      if (this.inFlight.get(key) === lookup) {
        this.inFlight.delete(key);
      }
    }
  }

  private async fetchCharacterProfile(characterName: string, realm: string): Promise<RaiderIoSummary | null> {
    if (this.rateLimitedUntil > this.now()) {
      throw new Error("Raider.IO lookup is temporarily rate limited.");
    }

    const url = new URL(this.endpoint);
    url.searchParams.set("region", "us");
    url.searchParams.set("realm", realm);
    url.searchParams.set("name", characterName);
    url.searchParams.set("fields", "mythic_plus_scores_by_season:current");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 400 || response.status === 404) {
      return null;
    }

    if (response.status === 429) {
      this.rateLimitedUntil = this.now() + retryAfterMs(response.headers.get("Retry-After"), this.now());
      throw new Error("Raider.IO lookup is temporarily rate limited.");
    }

    if (!response.ok) {
      throw new Error(`Raider.IO lookup failed with status ${response.status}.`);
    }

    const parsed = raiderIoResponseSchema.parse(await response.json());
    const profileUrl = validateProfileUrl(parsed.profile_url);
    const currentSeason = parsed.mythic_plus_scores_by_season[0];

    return {
      score: currentSeason?.scores.all ?? 0,
      profileUrl,
      lastCrawledAt: parsed.last_crawled_at ?? null
    };
  }
}

function retryAfterMs(value: string | null, now: number): number {
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }

    const date = Date.parse(value);
    if (Number.isFinite(date) && date > now) {
      return date - now;
    }
  }

  return 60_000;
}

function validateProfileUrl(value: string): string {
  const url = new URL(value);
  const isRaiderIoHost = url.hostname === "raider.io" || url.hostname.endsWith(".raider.io");
  if (url.protocol !== "https:" || !isRaiderIoHost) {
    throw new Error("Raider.IO returned an invalid profile URL.");
  }

  return url.toString();
}
