import { describe, expect, it, vi } from "vitest";
import { TwitchUserClient } from "../src/twitchUser.js";

describe("TwitchUserClient", () => {
  it("resolves and caches the verified Twitch display name", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "1234", display_name: "DungeonRunner" }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const client = new TwitchUserClient("extension-client", fetchImpl);

    await expect(client.getDisplayName("1234", "helix-jwt")).resolves.toBe("DungeonRunner");
    await expect(client.getDisplayName("1234", "another-jwt")).resolves.toBe("DungeonRunner");

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.twitch.tv/helix/users?id=1234");
    expect(init?.headers).toEqual({
      Authorization: "Extension helix-jwt",
      "Client-Id": "extension-client"
    });
  });

  it("rejects a Twitch response that does not contain the verified user", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "9999", display_name: "SomeoneElse" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const client = new TwitchUserClient("extension-client", fetchImpl);

    await expect(client.getDisplayName("1234", "helix-jwt")).rejects.toMatchObject({
      statusCode: 502,
      code: "twitch_user_lookup_failed"
    });
  });
});
