import { z } from "zod";
import { anyMythicPlusDungeon, mythicPlusDungeons } from "./dungeons.js";
import { northAmericanRealms } from "./realms.js";

export const queueRoles = ["tank", "healer", "dps"] as const;
export const keyIntents = ["need", "offer"] as const;
export const queueEntryStatuses = ["waiting", "invited", "completed", "skipped"] as const;
export const extensionRoles = ["viewer", "moderator", "broadcaster", "external"] as const;

export const queueRoleSchema = z.enum(queueRoles);
export const keyIntentSchema = z.enum(keyIntents);
export const queueEntryStatusSchema = z.enum(queueEntryStatuses);
export const extensionRoleSchema = z.enum(extensionRoles);
export const northAmericanRealmSchema = z.enum(northAmericanRealms);
export const mythicPlusDungeonSchema = z.enum(mythicPlusDungeons);

export type QueueRole = z.infer<typeof queueRoleSchema>;
export type KeyIntent = z.infer<typeof keyIntentSchema>;
export type QueueEntryStatus = z.infer<typeof queueEntryStatusSchema>;
export type ExtensionRole = z.infer<typeof extensionRoleSchema>;

const signupDetailsSchema = z.object({
  role: queueRoleSchema,
  realm: northAmericanRealmSchema,
  characterName: z
    .string()
    .trim()
    .min(2, "Character name must be at least 2 characters.")
    .max(12, "Character name must be 12 characters or fewer."),
  keyLevel: z
    .number()
    .int("Key level must be a whole number.")
    .min(2, "Key level must be at least 2.")
    .max(99, "Key level must be 99 or lower.")
});

export const joinQueueRequestSchema = signupDetailsSchema.extend({
  keyIntent: z.literal("need"),
  dungeon: z.union([z.literal(anyMythicPlusDungeon), mythicPlusDungeonSchema])
});

export const offerKeyRequestSchema = signupDetailsSchema.extend({
  keyIntent: z.literal("offer"),
  dungeon: mythicPlusDungeonSchema
});

export const setQueueSettingsRequestSchema = z.object({
  signupsOpen: z.boolean()
});

export const setEntryStatusRequestSchema = z.object({
  status: queueEntryStatusSchema
});

export const moveEntryRequestSchema = z.object({
  direction: z.enum(["up", "down"])
});

export const queueEventSchema = z.object({
  type: z.literal("queue.updated"),
  channelId: z.string(),
  revision: z.string()
});

export type JoinQueueRequest = z.infer<typeof joinQueueRequestSchema>;
export type OfferKeyRequest = z.infer<typeof offerKeyRequestSchema>;
export type SetQueueSettingsRequest = z.infer<typeof setQueueSettingsRequestSchema>;
export type SetEntryStatusRequest = z.infer<typeof setEntryStatusRequestSchema>;
export type MoveEntryRequest = z.infer<typeof moveEntryRequestSchema>;
export type QueueEvent = z.infer<typeof queueEventSchema>;

export interface QueueViewer {
  opaqueUserId: string;
  userId?: string;
  role: ExtensionRole;
  isLinked: boolean;
  canModerate: boolean;
  signupDefaults?: {
    realm: string;
    characterName: string;
  };
}

export interface RaiderIoSummary {
  score: number;
  profileUrl: string;
  lastCrawledAt: string | null;
}

export interface QueueEntryDto {
  id: string;
  twitchUserId: string;
  displayName: string | null;
  role: QueueRole;
  realm: string;
  characterName: string;
  keyIntent: KeyIntent | null;
  dungeon: string;
  keyLevel: number | null;
  status: QueueEntryStatus;
  position: number;
  joinedAt: string;
  updatedAt: string;
  isCurrentViewer: boolean;
  raiderIo?: RaiderIoSummary | null;
}

export interface KeyOfferDto {
  id: string;
  twitchUserId: string;
  displayName: string | null;
  role: QueueRole;
  realm: string;
  characterName: string;
  keyIntent: "offer";
  dungeon: string;
  keyLevel: number | null;
  createdAt: string;
  updatedAt: string;
  isCurrentViewer: boolean;
  raiderIo?: RaiderIoSummary | null;
}

export interface QueueStateDto {
  channelId: string;
  signupsOpen: boolean;
  revision: string;
  viewer: QueueViewer;
  entries: QueueEntryDto[];
  offers: KeyOfferDto[];
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export interface QueueStateResponse {
  queue: QueueStateDto;
}

export function canModerateRole(role: ExtensionRole): boolean {
  return role === "broadcaster" || role === "moderator";
}
