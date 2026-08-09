import { z } from "zod";
import {
  dungeonNameSchema,
  specificDungeonNameSchema,
  type DungeonCatalogDto
} from "./dungeons.js";
import { northAmericanRealms } from "./realms.js";

export const queueRoles = ["tank", "healer", "dps"] as const;
export const keyIntents = ["need", "offer"] as const;
export const queueEntryStatuses = ["waiting", "invited", "completed", "skipped"] as const;
export const extensionRoles = ["viewer", "moderator", "broadcaster", "external"] as const;

export const queueRoleSchema = z.enum(queueRoles);
export const keyIntentSchema = z.enum(keyIntents);
export const queueEntryStatusSchema = z.enum(queueEntryStatuses);
export const extensionRoleSchema = z.enum(extensionRoles);
export const collaborationRoleSchema = z.enum(["standalone", "host", "collaborator"]);
export const collaborationMemberRoleSchema = z.enum(["host", "collaborator"]);
export const northAmericanRealmSchema = z.enum(northAmericanRealms);

export type QueueRole = z.infer<typeof queueRoleSchema>;
export type KeyIntent = z.infer<typeof keyIntentSchema>;
export type QueueEntryStatus = z.infer<typeof queueEntryStatusSchema>;
export type ExtensionRole = z.infer<typeof extensionRoleSchema>;
export type CollaborationRole = z.infer<typeof collaborationRoleSchema>;
export type CollaborationMemberRole = z.infer<typeof collaborationMemberRoleSchema>;

const selectedRolesSchema = z
  .array(queueRoleSchema)
  .min(1, "Select at least one role.")
  .max(queueRoles.length)
  .refine((roles) => new Set(roles).size === roles.length, "Each role can only be selected once.");

const signupDetailsFields = {
  roles: selectedRolesSchema.optional(),
  role: queueRoleSchema.optional(),
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
};

export const joinQueueRequestSchema = normalizeSignupRoles(z.object({
  ...signupDetailsFields,
  keyIntent: z.literal("need"),
  dungeon: dungeonNameSchema
}));

export const offerKeyRequestSchema = normalizeSignupRoles(z.object({
  ...signupDetailsFields,
  keyIntent: z.literal("offer"),
  dungeon: specificDungeonNameSchema
}));

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
  recipientChannelId: z.string().min(1),
  canonicalQueueId: z.string().min(1).optional(),
  revision: z.string().regex(/^\d+$/)
});

const twitchLoginSchema = z.string().trim().min(1).max(25).regex(/^[A-Za-z0-9_]+$/, "Enter a valid Twitch login.");
export const collaborationTargetPreviewRequestSchema = z.object({ login: twitchLoginSchema });
export const createCollaborationInviteRequestSchema = collaborationTargetPreviewRequestSchema;
export const collaborationCodeRequestSchema = z.object({
  code: z.string().trim().length(6).regex(/^[A-Za-z0-9]+$/, "Enter the six-character collaboration code.")
});

export type JoinQueueRequest = z.infer<typeof joinQueueRequestSchema>;
export type OfferKeyRequest = z.infer<typeof offerKeyRequestSchema>;
export type SetQueueSettingsRequest = z.infer<typeof setQueueSettingsRequestSchema>;
export type SetEntryStatusRequest = z.infer<typeof setEntryStatusRequestSchema>;
export type MoveEntryRequest = z.infer<typeof moveEntryRequestSchema>;
export type QueueEvent = z.infer<typeof queueEventSchema>;
export type CollaborationTargetPreviewRequest = z.infer<typeof collaborationTargetPreviewRequestSchema>;
export type CreateCollaborationInviteRequest = z.infer<typeof createCollaborationInviteRequestSchema>;
export type CollaborationCodeRequest = z.infer<typeof collaborationCodeRequestSchema>;

function normalizeSignupRoles<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .superRefine((input: { roles?: QueueRole[]; role?: QueueRole }, context) => {
      if (!input.roles && !input.role) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["roles"],
          message: "Select at least one role."
        });
      }
    })
    .transform((input: z.output<T> & { roles?: QueueRole[]; role?: QueueRole }) => {
      const { role, ...details } = input;
      return {
        ...details,
        roles: input.roles ?? [role!]
      };
    });
}

export function getCharacterIdentityKey(
  character: { realm: string; characterName: string }
): string {
  return JSON.stringify([
    character.realm.toLowerCase(),
    character.characterName.trim().toLowerCase()
  ]);
}

export interface QueueViewer {
  role: ExtensionRole;
  isLinked: boolean;
  canModerate: boolean;
  permissions: {
    moderateEntries: boolean;
    manageSettings: boolean;
    clearQueue: boolean;
  };
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
  displayName: string | null;
  /** @deprecated Use roles. Retained during the multi-role API rollout. */
  role: QueueRole;
  roles: QueueRole[];
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
  sourceRole: CollaborationMemberRole | null;
  raiderIo?: RaiderIoSummary | null;
}

export interface KeyOfferDto {
  id: string;
  displayName: string | null;
  /** @deprecated Use roles. Retained during the multi-role API rollout. */
  role: QueueRole;
  roles: QueueRole[];
  realm: string;
  characterName: string;
  keyIntent: "offer";
  dungeon: string;
  keyLevel: number | null;
  createdAt: string;
  updatedAt: string;
  isCurrentViewer: boolean;
  sourceRole: CollaborationMemberRole | null;
  raiderIo?: RaiderIoSummary | null;
}

export interface QueueStateDto {
  channelId: string;
  signupsOpen: boolean;
  revision: string;
  collaboration: null | {
    role: Exclude<CollaborationRole, "standalone">;
    hostDisplayName: string;
    collaboratorDisplayName: string;
  };
  dungeonCatalog: DungeonCatalogDto;
  viewer: QueueViewer;
  entries: QueueEntryDto[];
  offers: KeyOfferDto[];
}

export type CollaborationStateDto =
  | { state: "standalone" }
  | {
      state: "pending-host-invite";
      collaboratorDisplayName: string;
      code: string;
      expiresAt: string;
    }
  | {
      state: "active";
      role: Exclude<CollaborationRole, "standalone">;
      hostDisplayName: string;
      collaboratorDisplayName: string;
    };

export interface CollaborationStateResponse { collaboration: CollaborationStateDto; }
export interface CollaborationTargetPreviewResponse {
  target: { displayName: string };
}
export interface CollaborationInvitePreviewResponse {
  invite: { hostDisplayName: string };
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
