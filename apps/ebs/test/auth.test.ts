import { jwtVerify, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createExternalPubSubJwt, verifyExtensionJwt } from "../src/auth.js";

const extensionSecret = Buffer.from("test-extension-secret").toString("base64");
const clientId = "test-client-id";

async function signViewerToken(payload: Record<string, unknown>) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(Buffer.from(extensionSecret, "base64"));
}

describe("Twitch Extension JWT auth", () => {
  it("verifies linked viewer claims", async () => {
    const token = await signViewerToken({
      channel_id: "1234",
      opaque_user_id: "U123",
      user_id: "5678",
      role: "viewer"
    });

    await expect(verifyExtensionJwt(token, { extensionSecret, clientId })).resolves.toMatchObject({
      channelId: "1234",
      opaqueUserId: "U123",
      userId: "5678",
      role: "viewer"
    });
  });

  it("rejects unsupported roles", async () => {
    const token = await signViewerToken({
      channel_id: "1234",
      opaque_user_id: "U123",
      user_id: "5678",
      role: "admin"
    });

    await expect(verifyExtensionJwt(token, { extensionSecret, clientId })).rejects.toMatchObject({
      code: "invalid_extension_token"
    });
  });

  it("rejects mismatched audiences when aud is present", async () => {
    const token = await signViewerToken({
      aud: "other-client-id",
      channel_id: "1234",
      opaque_user_id: "U123",
      role: "viewer"
    });

    await expect(verifyExtensionJwt(token, { extensionSecret, clientId })).rejects.toMatchObject({
      code: "invalid_extension_token"
    });
  });

  it("creates short-lived external PubSub JWTs", async () => {
    const token = await createExternalPubSubJwt("1234", {
      extensionSecret,
      clientId,
      ownerId: "9999"
    });

    const { payload } = await jwtVerify(token, Buffer.from(extensionSecret, "base64"), {
      algorithms: ["HS256"]
    });

    expect(payload).toMatchObject({
      channel_id: "1234",
      role: "external",
      user_id: "9999",
      pubsub_perms: {
        send: ["broadcast"]
      }
    });
  });
});
