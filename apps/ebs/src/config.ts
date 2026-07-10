import { z } from "zod";

const booleanFromEnvSchema = z
  .string()
  .optional()
  .transform((value, context) => {
    if (value === undefined) {
      return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }

    if (normalized === "false" || normalized === "0") {
      return false;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expected a boolean env value: true, false, 1, or 0."
    });
    return z.NEVER;
  });

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  TWITCH_EXTENSION_CLIENT_ID: z.string().min(1),
  TWITCH_EXTENSION_SECRET: z.string().min(1),
  TWITCH_EXTENSION_OWNER_ID: z.string().min(1).optional(),
  TWITCH_PUBSUB_ENABLED: booleanFromEnvSchema.default("true"),
  TWITCH_PUBSUB_ENDPOINT: z
    .string()
    .url()
    .default("https://api.twitch.tv/helix/extensions/pubsub"),
  FRONTEND_ORIGIN: z.string().optional()
});

export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  twitchExtensionClientId: string;
  twitchExtensionSecret: string;
  twitchExtensionOwnerId?: string;
  twitchPubSubEnabled: boolean;
  twitchPubSubEndpoint: string;
  frontendOrigin?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const config: AppConfig = {
    nodeEnv: parsed.NODE_ENV ?? "development",
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    twitchExtensionClientId: parsed.TWITCH_EXTENSION_CLIENT_ID,
    twitchExtensionSecret: parsed.TWITCH_EXTENSION_SECRET,
    twitchPubSubEnabled: parsed.TWITCH_PUBSUB_ENABLED,
    twitchPubSubEndpoint: parsed.TWITCH_PUBSUB_ENDPOINT
  };

  if (parsed.TWITCH_EXTENSION_OWNER_ID) {
    config.twitchExtensionOwnerId = parsed.TWITCH_EXTENSION_OWNER_ID;
  }

  if (parsed.FRONTEND_ORIGIN) {
    config.frontendOrigin = parsed.FRONTEND_ORIGIN;
  }

  return config;
}
