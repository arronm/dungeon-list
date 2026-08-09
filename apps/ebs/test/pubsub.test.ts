import { afterEach, describe, expect, it, vi } from "vitest";
import { TwitchPubSubPublisher } from "../src/pubsub.js";

describe("TwitchPubSubPublisher shared queue delivery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("signs and addresses an event to the explicit recipient channel", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const publisher = new TwitchPubSubPublisher({
      clientId: "client-id",
      extensionSecret: Buffer.from("secret").toString("base64"),
      ownerId: "owner-id",
      enabled: true,
      endpoint: "https://example.test/pubsub"
    });

    await expect(publisher.publishQueueUpdated("collaborator-channel", "17", "host-channel")).resolves.toBe(true);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body.broadcaster_id).toBe("collaborator-channel");
    expect(JSON.parse(body.message)).toEqual({
      type: "queue.updated",
      recipientChannelId: "collaborator-channel",
      canonicalQueueId: "host-channel",
      revision: "17"
    });
  });
});
