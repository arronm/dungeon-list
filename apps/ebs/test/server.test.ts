import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { AppConfig } from "../src/config.js";

const testConfig: AppConfig = {
  nodeEnv: "test",
  port: 8080,
  databaseUrl: "postgresql://example",
  twitchExtensionClientId: "client-id",
  twitchExtensionSecret: Buffer.from("secret").toString("base64"),
  twitchPubSubEnabled: false,
  twitchPubSubEndpoint: "https://api.twitch.tv/helix/extensions/pubsub",
  frontendOrigins: []
};

describe("EBS server", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("allows Twitch extension origins to preflight DELETE moderation requests", async () => {
    app = await buildServer(testConfig);

    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/moderation/entries/entry-1",
      headers: {
        origin: "https://example.ext-twitch.tv",
        "access-control-request-method": "DELETE",
        "access-control-request-headers": "authorization"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://example.ext-twitch.tv");
    expect(response.headers["access-control-allow-methods"]).toContain("DELETE");
    expect(response.headers["access-control-allow-headers"]).toBe("authorization");
  });
});
