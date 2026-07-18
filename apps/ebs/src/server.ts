import cors from "@fastify/cors";
import Fastify from "fastify";
import { pathToFileURL } from "node:url";
import { loadConfig, type AppConfig } from "./config.js";
import { registerAuth } from "./auth.js";
import { TwitchPubSubPublisher } from "./pubsub.js";
import { RaiderIoClient } from "./raiderIo.js";
import { QueueRepository } from "./repository.js";
import { registerErrorHandler, registerRoutes } from "./routes.js";
import { TwitchUserClient } from "./twitchUser.js";

export async function buildServer(config: AppConfig = loadConfig()) {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "test" ? "warn" : "info"
    }
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (config.frontendOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      if (isLocalTestOrigin(origin)) {
        callback(null, true);
        return;
      }

      if (origin.endsWith(".ext-twitch.tv") || origin.endsWith(".twitch.tv")) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: false
  });

  registerErrorHandler(app);
  registerAuth(app, {
    clientId: config.twitchExtensionClientId,
    extensionSecret: config.twitchExtensionSecret
  });
  const pubsubConfig = {
    clientId: config.twitchExtensionClientId,
    extensionSecret: config.twitchExtensionSecret,
    enabled: config.twitchPubSubEnabled,
    endpoint: config.twitchPubSubEndpoint
  };

  if (config.twitchExtensionOwnerId) {
    Object.assign(pubsubConfig, { ownerId: config.twitchExtensionOwnerId });
  }

  registerRoutes(app, {
    repository: new QueueRepository(),
    pubsub: new TwitchPubSubPublisher(pubsubConfig),
    twitchUsers: new TwitchUserClient(config.twitchExtensionClientId),
    raiderIo: new RaiderIoClient()
  });

  return app;
}

function isLocalTestOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1")
    );
  } catch {
    return false;
  }
}

async function start(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);
  await app.listen({ host: "0.0.0.0", port: config.port });
}

const currentFileUrl = pathToFileURL(process.argv[1] ?? "").href;
if (import.meta.url === currentFileUrl) {
  start().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
