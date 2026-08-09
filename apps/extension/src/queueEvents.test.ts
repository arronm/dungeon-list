import { describe, expect, it } from "vitest";
import { isQueueEventForChannel } from "./queueEvents.js";

describe("queue PubSub recipient validation", () => {
  it("accepts only a queue update addressed to the authorized channel", () => {
    const event = JSON.stringify({
      type: "queue.updated",
      recipientChannelId: "collaborator-channel",
      canonicalQueueId: "host-channel",
      revision: "42"
    });
    expect(isQueueEventForChannel(event, "collaborator-channel")).toBe(true);
    expect(isQueueEventForChannel(event, "host-channel")).toBe(false);
  });

  it("rejects malformed and legacy messages", () => {
    expect(isQueueEventForChannel("not-json", "channel-1")).toBe(false);
    expect(isQueueEventForChannel(JSON.stringify({ type: "queue.updated", channelId: "channel-1", revision: "1" }), "channel-1")).toBe(false);
  });
});
