import { describe, expect, it, vi } from "vitest";
import { RaiderIoClient } from "../src/raiderIo.js";

const profileResponse = {
  profile_url: "https://raider.io/characters/us/area-52/Softblock",
  last_crawled_at: "2026-07-18T20:00:00.000Z",
  mythic_plus_scores_by_season: [
    {
      scores: { all: 2418.7 }
    }
  ]
};

describe("RaiderIoClient", () => {
  it("requests and maps the current US mythic plus score", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(profileResponse));
    const client = new RaiderIoClient(fetchImpl);

    await expect(client.getCharacterProfile("Softblock", "Area 52")).resolves.toEqual({
      score: 2418.7,
      profileUrl: "https://raider.io/characters/us/area-52/Softblock",
      lastCrawledAt: "2026-07-18T20:00:00.000Z"
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    const requestedUrl = new URL(url.toString());
    expect(requestedUrl.searchParams.get("region")).toBe("us");
    expect(requestedUrl.searchParams.get("realm")).toBe("Area 52");
    expect(requestedUrl.searchParams.get("name")).toBe("Softblock");
    expect(requestedUrl.searchParams.get("fields")).toBe("mythic_plus_scores_by_season:current");
    expect(init?.headers).toEqual({ Accept: "application/json" });
  });

  it("caches successful results for two hours", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(profileResponse));
    const client = new RaiderIoClient(fetchImpl, undefined, 2 * 60 * 60 * 1000, 5_000, () => now);

    await client.getCharacterProfile("Softblock", "Area 52");
    now += 2 * 60 * 60 * 1000 - 1;
    await client.getCharacterProfile("softblock", "area 52");
    expect(fetchImpl).toHaveBeenCalledOnce();

    now += 2;
    await client.getCharacterProfile("Softblock", "Area 52");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caches profiles that Raider.IO cannot find", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    const client = new RaiderIoClient(fetchImpl);

    await expect(client.getCharacterProfile("Missing", "Illidan")).resolves.toBeNull();
    await expect(client.getCharacterProfile("Missing", "Illidan")).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("deduplicates concurrent lookups", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>().mockReturnValue(responsePromise);
    const client = new RaiderIoClient(fetchImpl);

    const first = client.getCharacterProfile("Softblock", "Area 52");
    const second = client.getCharacterProfile("Softblock", "Area 52");
    expect(fetchImpl).toHaveBeenCalledOnce();

    resolveResponse!(Response.json(profileResponse));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("does not cache transient failures", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(Response.json(profileResponse));
    const client = new RaiderIoClient(fetchImpl);

    await expect(client.getCharacterProfile("Softblock", "Area 52")).rejects.toThrow("status 500");
    await expect(client.getCharacterProfile("Softblock", "Area 52")).resolves.toMatchObject({ score: 2418.7 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("backs off subsequent lookups after a rate limit response", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { "Retry-After": "30" }
      })
    );
    const client = new RaiderIoClient(fetchImpl, undefined, undefined, undefined, () => now);

    await expect(client.getCharacterProfile("Softblock", "Area 52")).rejects.toThrow("rate limited");
    await expect(client.getCharacterProfile("Another", "Illidan")).rejects.toThrow("rate limited");
    expect(fetchImpl).toHaveBeenCalledOnce();

    now += 30_001;
    await expect(client.getCharacterProfile("Another", "Illidan")).rejects.toThrow("rate limited");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects profile links outside Raider.IO", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ...profileResponse,
        profile_url: "https://example.com/not-a-raider-io-profile"
      })
    );
    const client = new RaiderIoClient(fetchImpl);

    await expect(client.getCharacterProfile("Softblock", "Area 52")).rejects.toThrow("invalid profile URL");
  });
});
