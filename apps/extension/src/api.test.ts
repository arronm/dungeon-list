import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearQueue,
  createCollaborationInvite,
  getCollaboration,
  getQueue,
  joinQueue,
  leaveQueue,
  offerKey,
  removeOffer,
  updateEntryStatus
} from "./api.js";

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
    expect(init?.cache).toBe("no-store");
  });

  it("submits only queue fields when joining", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await joinQueue("extension-jwt", "helix-jwt", {
      roles: ["tank", "dps"],
      realm: "Area 52",
      characterName: "Bulwark",
      keyIntent: "need",
      dungeon: "Skyreach",
      keyLevel: 12
    });

    const [requestPath, init] = fetchMock.mock.calls[0]!;
    expect(requestPath).toBe("/api/queue/join");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      roles: ["tank", "dps"],
      role: "tank",
      realm: "Area 52",
      characterName: "Bulwark",
      keyIntent: "need",
      dungeon: "Skyreach",
      keyLevel: 12
    });
  });

  it("submits key offers separately with the Helix JWT", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await offerKey("extension-jwt", "helix-jwt", {
      roles: ["healer", "dps"],
      realm: "Area 52",
      characterName: "Keyrunner",
      keyIntent: "offer",
      dungeon: "Windrunner Spire",
      keyLevel: 12
    });

    const [requestPath, init] = fetchMock.mock.calls[0]!;
    expect(requestPath).toBe("/api/offers");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      roles: ["healer", "dps"],
      role: "healer",
      realm: "Area 52",
      characterName: "Keyrunner",
      keyIntent: "offer",
      dungeon: "Windrunner Spire",
      keyLevel: 12
    });
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

  it("sends the observed revision with shared moderation mutations", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    await updateEntryStatus("extension-jwt", "entry-1", { status: "invited" }, "9223372036854775806");

    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).get("X-Queue-Revision")).toBe("9223372036854775806");
  });

  it("uses the broadcaster collaboration endpoints and Helix JWT", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ collaboration: { state: "standalone" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ collaboration: { state: "pending-host-invite" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    vi.stubGlobal("fetch", fetchMock);

    await getCollaboration("extension-jwt");
    await createCollaborationInvite("extension-jwt", "helix-jwt", { login: "party_partner" });

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/collaboration");
    const [path, init] = fetchMock.mock.calls[1]!;
    expect(path).toBe("/api/collaboration/invites");
    expect(new Headers(init?.headers).get("X-Twitch-Helix-Token")).toBe("helix-jwt");
    expect(JSON.parse(String(init?.body))).toEqual({ login: "party_partner" });
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
