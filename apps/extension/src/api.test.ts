import { afterEach, describe, expect, it, vi } from "vitest";
import { getQueue, joinQueue } from "./api.js";

describe("extension API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the Helix JWT when loading the queue", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await getQueue("extension-jwt", "helix-jwt");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/queue",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer extension-jwt",
          "X-Twitch-Helix-Token": "helix-jwt"
        })
      })
    );
  });

  it("submits only queue fields when joining", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await joinQueue("extension-jwt", "helix-jwt", { role: "tank", note: "Ready" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/queue/join",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ role: "tank", note: "Ready" })
      })
    );
  });
});

function jsonResponse(): Response {
  return new Response(JSON.stringify({ queue: {} }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
