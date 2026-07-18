import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  joinQueueRequestSchema,
  moveEntryRequestSchema,
  setEntryStatusRequestSchema,
  setQueueSettingsRequestSchema
} from "@dungeon-list/shared";
import { getPrincipal, requireLinkedViewer, requireQueueManager } from "./auth.js";
import { ApiError } from "./errors.js";
import type { TwitchPubSubPublisher } from "./pubsub.js";
import type { QueueRepository } from "./repository.js";
import type { TwitchUserClient } from "./twitchUser.js";

export interface RouteDependencies {
  repository: QueueRepository;
  pubsub: TwitchPubSubPublisher;
  twitchUsers: TwitchUserClient;
}

export function registerRoutes(app: FastifyInstance, dependencies: RouteDependencies): void {
  const { repository, pubsub, twitchUsers } = dependencies;

  async function publishMutation(queue: Awaited<ReturnType<QueueRepository["getQueueState"]>>, app: FastifyInstance) {
    try {
      const published = await pubsub.publishQueueUpdated(queue);
      if (!published) {
        app.log.debug({ channelId: queue.channelId }, "queue mutation completed without PubSub publish");
      }
    } catch (error) {
      app.log.error({ error }, "failed to publish queue update");
    }

    return { queue };
  }

  app.get("/health", async () => ({ ok: true }));

  app.get("/api/queue", async (request) => {
    const principal = getPrincipal(request);
    const helixToken = getHelixToken(request);
    if (principal.userId && helixToken) {
      try {
        const displayName = await twitchUsers.getDisplayName(principal.userId, helixToken);
        await repository.syncCurrentViewerDisplayName(principal, displayName);
      } catch (error) {
        request.log.warn({ error, userId: principal.userId }, "failed to synchronize Twitch display name");
      }
    }
    return { queue: await repository.getQueueState(principal) };
  });

  app.post("/api/queue/join", async (request) => {
    const principal = getPrincipal(request);
    const userId = requireLinkedViewer(principal);
    const helixToken = requireHelixToken(request);
    const displayName = await twitchUsers.getDisplayName(userId, helixToken);
    const input = joinQueueRequestSchema.parse(request.body);
    const queue = await repository.join(principal, input, displayName);
    return publishMutation(queue, app);
  });

  app.post("/api/queue/leave", async (request) => {
    const principal = getPrincipal(request);
    const queue = await repository.leave(principal);
    return publishMutation(queue, app);
  });

  app.post("/api/moderation/entries/:entryId/status", async (request) => {
    const principal = getPrincipal(request);
    requireQueueManager(principal);
    const { entryId } = request.params as { entryId: string };
    const input = setEntryStatusRequestSchema.parse(request.body);
    const queue = await repository.setEntryStatus(principal, entryId, input.status);
    return publishMutation(queue, app);
  });

  app.post("/api/moderation/entries/:entryId/move", async (request) => {
    const principal = getPrincipal(request);
    requireQueueManager(principal);
    const { entryId } = request.params as { entryId: string };
    const input = moveEntryRequestSchema.parse(request.body);
    const queue = await repository.moveEntry(principal, entryId, input);
    return publishMutation(queue, app);
  });

  app.delete("/api/moderation/entries/:entryId", async (request) => {
    const principal = getPrincipal(request);
    requireQueueManager(principal);
    const { entryId } = request.params as { entryId: string };
    const queue = await repository.removeEntry(principal, entryId);
    return publishMutation(queue, app);
  });

  app.post("/api/moderation/clear", async (request) => {
    const principal = getPrincipal(request);
    requireQueueManager(principal);
    const queue = await repository.clear(principal);
    return publishMutation(queue, app);
  });

  app.post("/api/moderation/settings", async (request) => {
    const principal = getPrincipal(request);
    requireQueueManager(principal);
    const input = setQueueSettingsRequestSchema.parse(request.body);
    const queue = await repository.setSettings(principal, input);
    return publishMutation(queue, app);
  });
}

function getHelixToken(request: { headers: Record<string, unknown> }): string | undefined {
  const value = request.headers["x-twitch-helix-token"];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireHelixToken(request: { headers: Record<string, unknown> }): string {
  const token = getHelixToken(request);
  if (!token) {
    throw new ApiError(400, "missing_helix_token", "Refresh the extension before joining the waitlist.");
  }
  return token;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message
        }
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "validation_failed",
          message: error.issues[0]?.message ?? "Request validation failed."
        }
      });
    }

    app.log.error({ error }, "unhandled request error");
    return reply.status(500).send({
      error: {
        code: "internal_server_error",
        message: "The waitlist service could not complete the request."
      }
    });
  });
}
