import { afterEach, describe, expect, it, vi } from "vitest";
import { clearQueue, getQueue, joinQueue, leaveQueue, offerKey, removeOffer } from "./api.js";

describe("extension API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the Helix JWT when loading the queue", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await getQueue("extension-jwt", "helix-jwt");

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer extension-jwt");
    expect(headers.get("X-Twitch-Helix-Token")).toBe("helix-jwt");
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("submits only queue fields when joining", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await joinQueue("extension-jwt", "helix-jwt", {
      role: "tank",
      realm: "Area 52",
      characterName: "Bulwark",
      keyIntent: "need",
      dungeon: "Skyreach",
      keyLevel: 12
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/queue/join",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          role: "tank",
          realm: "Area 52",
          characterName: "Bulwark",
          keyIntent: "need",
          dungeon: "Skyreach",
          keyLevel: 12
        })
      })
    );
  });

  it("submits key offers separately with the Helix JWT", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await offerKey("extension-jwt", "helix-jwt", {
      role: "dps",
      realm: "Area 52",
      characterName: "Keyrunner",
      keyIntent: "offer",
      dungeon: "Windrunner Spire",
      keyLevel: 12
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/offers",
      expect.objectContaining({ method: "POST" })
    );
    expect(new Headers(init?.headers).get("X-Twitch-Helix-Token")).toBe("helix-jwt");
  });

  it("removes one key offer without sending an empty JSON body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await removeOffer("extension-jwt", "offer-1");

    const [requestPath, init] = fetchMock.mock.calls[0]!;
    expect(requestPath).toBe("/api/offers/offer-1");
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  });

  it.each([
    ["leave", leaveQueue, "/api/queue/leave"],
    ["clear", clearQueue, "/api/moderation/clear"]
  ])("does not declare an empty JSON body for %s", async (_name, action, path) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await action("extension-jwt");

    const [requestPath, init] = fetchMock.mock.calls[0]!;
    expect(requestPath).toBe(path);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  });
});

function jsonResponse(): Response {
  return new Response(JSON.stringify({ queue: {} }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
