import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const baseEnv = {
  DATABASE_URL: "postgresql://example",
  TWITCH_EXTENSION_CLIENT_ID: "client-id",
  TWITCH_EXTENSION_SECRET: Buffer.from("secret").toString("base64")
};

describe("EBS config", () => {
  it("accepts uppercase boolean env values from deployment dashboards", () => {
    expect(
      loadConfig({
        ...baseEnv,
        TWITCH_PUBSUB_ENABLED: "FALSE"
      }).twitchPubSubEnabled
    ).toBe(false);

    expect(
      loadConfig({
        ...baseEnv,
        TWITCH_PUBSUB_ENABLED: "TRUE"
      }).twitchPubSubEnabled
    ).toBe(true);
  });

  it("rejects invalid boolean env values", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        TWITCH_PUBSUB_ENABLED: "disabled"
      })
    ).toThrow("Expected a boolean env value");
  });
});

