import type { FastifyInstance, FastifyRequest } from "fastify";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { canModerateRole, extensionRoleSchema, type ExtensionRole } from "@dungeon-list/shared";
import { ApiError } from "./errors.js";

export interface ExtensionPrincipal {
  channelId: string;
  opaqueUserId: string;
  role: ExtensionRole;
  token: string;
  userId?: string;
}

export interface JwtOptions {
  extensionSecret: string;
  clientId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    principal?: ExtensionPrincipal;
  }
}

function getSharedSecretKey(extensionSecret: string): Uint8Array {
  const decoded = Buffer.from(extensionSecret, "base64");
  if (decoded.length === 0) {
    throw new ApiError(500, "invalid_extension_secret", "The Twitch Extension secret is not valid base64.");
  }

  return decoded;
}

function requireStringClaim(payload: JWTPayload, claim: string): string {
  const value = payload[claim];
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiError(401, "invalid_extension_token", `Extension JWT is missing ${claim}.`);
  }

  return value;
}

function assertAudienceIfPresent(payload: JWTPayload, clientId: string): void {
  if (!payload.aud) {
    return;
  }

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(clientId)) {
    throw new ApiError(401, "invalid_extension_token", "Extension JWT audience does not match this extension.");
  }
}

export async function verifyExtensionJwt(token: string, options: JwtOptions): Promise<ExtensionPrincipal> {
  try {
    const { payload } = await jwtVerify(token, getSharedSecretKey(options.extensionSecret), {
      algorithms: ["HS256"]
    });

    assertAudienceIfPresent(payload, options.clientId);

    const role = extensionRoleSchema.parse(requireStringClaim(payload, "role"));
    const channelId = requireStringClaim(payload, "channel_id");
    const opaqueUserId = requireStringClaim(payload, "opaque_user_id");
    const userId = typeof payload.user_id === "string" && payload.user_id.length > 0 ? payload.user_id : undefined;

    const principal: ExtensionPrincipal = {
      channelId,
      opaqueUserId,
      role,
      token
    };

    if (userId) {
      principal.userId = userId;
    }

    return principal;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(401, "invalid_extension_token", "Extension JWT could not be verified.");
  }
}

export async function createExternalPubSubJwt(
  channelId: string,
  options: JwtOptions & { ownerId?: string }
): Promise<string> {
  const userId = options.ownerId ?? options.clientId;

  return new SignJWT({
    channel_id: channelId,
    role: "external",
    user_id: userId,
    pubsub_perms: {
      send: ["broadcast"]
    }
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(getSharedSecretKey(options.extensionSecret));
}

export function getPrincipal(request: FastifyRequest): ExtensionPrincipal {
  if (!request.principal) {
    throw new ApiError(401, "missing_extension_token", "A Twitch Extension JWT is required.");
  }

  return request.principal;
}

export function requireLinkedViewer(principal: ExtensionPrincipal): string {
  if (!principal.userId) {
    throw new ApiError(403, "identity_required", "Share Twitch identity before joining the waitlist.");
  }

  return principal.userId;
}

export function requireQueueManager(principal: ExtensionPrincipal): void {
  if (!canModerateRole(principal.role)) {
    throw new ApiError(403, "forbidden", "Only the broadcaster or moderators can manage the waitlist.");
  }
}

export function registerAuth(app: FastifyInstance, options: JwtOptions): void {
  app.addHook("preHandler", async (request) => {
    if (!request.url.startsWith("/api/")) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new ApiError(401, "missing_extension_token", "A Twitch Extension JWT is required.");
    }

    const token = authHeader.slice("Bearer ".length).trim();
    request.principal = await verifyExtensionJwt(token, options);
  });
}

