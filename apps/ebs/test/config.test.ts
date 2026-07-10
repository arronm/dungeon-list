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

  it("supports multiple frontend origins", () => {
    expect(
      loadConfig({
        ...baseEnv,
        FRONTEND_ORIGIN: "http://localhost:5173",
        FRONTEND_ORIGINS: "http://127.0.0.1:5173, https://example.ext-twitch.tv"
      }).frontendOrigins
    ).toEqual(["http://localhost:5173", "http://127.0.0.1:5173", "https://example.ext-twitch.tv"]);
  });
});
