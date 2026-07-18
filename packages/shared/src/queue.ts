import { z } from "zod";
import { northAmericanRealms } from "./realms.js";

export const queueRoles = ["tank", "healer", "dps"] as const;
export const queueEntryStatuses = ["waiting", "invited", "completed", "skipped"] as const;
export const extensionRoles = ["viewer", "moderator", "broadcaster", "external"] as const;

export const queueRoleSchema = z.enum(queueRoles);
export const queueEntryStatusSchema = z.enum(queueEntryStatuses);
export const extensionRoleSchema = z.enum(extensionRoles);
export const northAmericanRealmSchema = z.enum(northAmericanRealms);

export type QueueRole = z.infer<typeof queueRoleSchema>;
export type QueueEntryStatus = z.infer<typeof queueEntryStatusSchema>;
export type ExtensionRole = z.infer<typeof extensionRoleSchema>;

export const joinQueueRequestSchema = z.object({
  role: queueRoleSchema,
  realm: northAmericanRealmSchema,
  characterName: z
    .string()
    .trim()
    .min(2, "Character name must be at least 2 characters.")
    .max(12, "Character name must be 12 characters or fewer.")
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
  status: QueueEntryStatus;
  position: number;
  joinedAt: string;
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
