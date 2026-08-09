import { randomInt } from "node:crypto";
import { Prisma, PrismaClient, type CollaborationInvite } from "@prisma/client";
import {
  canModerateRole,
  getCharacterIdentityKey,
  type CollaborationCodeRequest,
  type CollaborationMemberRole,
  type CollaborationRole,
  type CollaborationStateDto,
  type JoinQueueRequest,
  type KeyOfferDto,
  type MoveEntryRequest,
  type OfferKeyRequest,
  type QueueEntryDto,
  type QueueEntryStatus,
  type QueueRole,
  type QueueStateDto,
  type SetQueueSettingsRequest
} from "@dungeon-list/shared";
import { requireLinkedViewer, type ExtensionPrincipal } from "./auth.js";
import { parseCharacterDetails, serializeCharacterDetails } from "./characterDetails.js";
import { currentDungeonCatalog } from "./dungeonCatalog.js";
import { ApiError } from "./errors.js";

type TransactionClient = Prisma.TransactionClient;

const inviteLifetimeMs = 20 * 60 * 1000;
const failedAttemptWindowMs = 20 * 60 * 1000;
const maxFailedAttempts = 10;
const inviteAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export interface QueueAccessContext {
  authenticatedChannelId: string;
  canonicalQueueId: string;
  sourceChannelId: string;
  membershipRole: CollaborationRole;
  collaborationId?: string;
  hostChannelId?: string;
  collaboratorChannelId?: string;
  hostDisplayName?: string;
  collaboratorDisplayName?: string;
}

export interface QueueInvalidation {
  recipientChannelId: string;
  canonicalQueueId: string;
  revision: string;
}

export interface CollaborationMutationResult {
  collaboration: CollaborationStateDto;
  invalidations: QueueInvalidation[];
}

type InviteCheckResult =
  | { kind: "valid"; invite: CollaborationInvite }
  | { kind: "invalid" }
  | { kind: "rate-limited"; retryAfter: number };

export class QueueRepository {
  constructor(private readonly prisma = new PrismaClient()) {}

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getQueueState(principal: ExtensionPrincipal): Promise<QueueStateDto> {
    return this.prisma.$transaction(async (tx) => {
      const access = await this.resolveQueueAccess(tx, principal);
      return this.getQueueStateInTransaction(tx, principal, access);
    });
  }

  async getQueueRecipients(canonicalQueueId: string): Promise<string[]> {
    const collaboration = await this.prisma.collaboration.findFirst({
      where: { hostChannelId: canonicalQueueId, endedAt: null },
      include: { memberships: { where: { leftAt: null } } }
    });
    return collaboration?.memberships.map((member) => member.channelId) ?? [canonicalQueueId];
  }

  async join(
    principal: ExtensionPrincipal,
    input: JoinQueueRequest,
    verifiedDisplayName: string
  ): Promise<QueueStateDto> {
    const twitchUserId = requireLinkedViewer(principal);
    return this.runSerializableTransaction(async (tx) => {
      const access = await this.resolveQueueAccess(tx, principal);
      const channel = await this.ensureChannel(tx, access.canonicalQueueId);
      if (!channel.signupsOpen && !canModerateRole(principal.role)) {
        throw new ApiError(409, "queue_closed", "The waitlist is currently closed.");
      }

      const existing = await tx.queueEntry.findFirst({
        where: {
          channelId: access.canonicalQueueId,
          twitchUserId,
          status: { not: "completed" }
        }
      });
      const position = existing?.position ?? await this.nextActivePosition(tx, access.canonicalQueueId);
      const characterDetails = serializeCharacterDetails(input);
      const entry = existing
        ? await tx.queueEntry.update({
            where: { id: existing.id },
            data: {
              role: getPrimaryRole(input.roles),
              note: characterDetails,
              displayName: verifiedDisplayName || existing.displayName,
              status: "waiting",
              position
            }
          })
        : await tx.queueEntry.create({
            data: {
              channelId: access.canonicalQueueId,
              submittedViaChannelId: access.sourceChannelId,
              twitchUserId,
              displayName: verifiedDisplayName || null,
              role: getPrimaryRole(input.roles),
              note: characterDetails,
              status: "waiting",
              position
            }
          });

      await this.saveSignupDefaults(tx, access.authenticatedChannelId, twitchUserId, input);
      await this.writeEvent(tx, principal, access.canonicalQueueId, "entry.joined", entry.id, {
        roles: input.roles,
        realm: input.realm,
        characterName: input.characterName,
        keyIntent: input.keyIntent,
        dungeon: input.dungeon,
        keyLevel: input.keyLevel,
        hadExistingEntry: Boolean(existing)
      });
      await this.incrementRevision(tx, access.canonicalQueueId);
      return this.getQueueStateInTransaction(tx, principal, access);
    });
  }

  async offerKey(
    principal: ExtensionPrincipal,
    input: OfferKeyRequest,
    verifiedDisplayName: string
  ): Promise<QueueStateDto> {
    const twitchUserId = requireLinkedViewer(principal);
    return this.runSerializableTransaction(async (tx) => {
      const access = await this.resolveQueueAccess(tx, principal);
      const channel = await this.ensureChannel(tx, access.canonicalQueueId);
      if (!channel.signupsOpen && !canModerateRole(principal.role)) {
        throw new ApiError(409, "queue_closed", "Key submissions are currently closed.");
      }

      const characterKey = getCharacterIdentityKey(input);
      const viewerOffers = await tx.keyOffer.findMany({
        where: { channelId: access.canonicalQueueId, twitchUserId }
      });
      const replacedOfferIds = viewerOffers
        .filter((offer) => getCharacterIdentityKey(parseCharacterDetails(offer.note)) === characterKey)
        .map((offer) => offer.id);
      if (replacedOfferIds.length) {
        await tx.keyOffer.deleteMany({ where: { id: { in: replacedOfferIds } } });
      }

      const offer = await tx.keyOffer.create({
        data: {
          channelId: access.canonicalQueueId,
          submittedViaChannelId: access.sourceChannelId,
          twitchUserId,
          displayName: verifiedDisplayName || null,
          role: getPrimaryRole(input.roles),
          note: serializeCharacterDetails(input)
        }
      });
      await this.saveSignupDefaults(tx, access.authenticatedChannelId, twitchUserId, input);
      await this.writeEvent(tx, principal, access.canonicalQueueId, "offer.created", undefined, {
        offerId: offer.id,
        roles: input.roles,
        realm: input.realm,
        characterName: input.characterName,
        dungeon: input.dungeon,
        keyLevel: input.keyLevel,
        replacedOfferIds
      });
      await this.incrementRevision(tx, access.canonicalQueueId);
      return this.getQueueStateInTransaction(tx, principal, access);
    });
  }

  async syncCurrentViewerDisplayName(principal: ExtensionPrincipal, displayName: string): Promise<void> {
    const twitchUserId = requireLinkedViewer(principal);
    await this.runSerializableTransaction(async (tx) => {
      const access = await this.resolveQueueAccess(tx, principal);
      const where = {
        channelId: access.canonicalQueueId,
        twitchUserId,
        OR: [{ displayName: null }, { displayName: { not: displayName } }]
      };
      const updates = await Promise.all([
        tx.queueEntry.updateMany({ where, data: { displayName } }),
        tx.keyOffer.updateMany({ where, data: { displayName } })
      ]);
      if (updates.some((update) => update.count > 0)) {
        await this.incrementRevision(tx, access.canonicalQueueId);
      }
    });
  }

  async leave(principal: ExtensionPrincipal): Promise<QueueStateDto> {
    const twitchUserId = requireLinkedViewer(principal);
    return this.runSerializableTransaction(async (tx) => {
      const access = await this.resolveQueueAccess(tx, principal);
      const existing = await tx.queueEntry.findFirst({
        where: { channelId: access.canonicalQueueId, twitchUserId, status: { not: "completed" } }
      });
      if (existing) {
        await this.detachEntryEvents(tx, existing.id);
        await tx.queueEntry.delete({ where: { id: existing.id } });
        await this.writeEvent(tx, principal, access.canonicalQueueId, "entry.left", undefined, {
          removedEntryId: existing.id
        });
        await this.normalizeActivePositions(tx, access.canonicalQueueId);
      }
      await this.incrementRevision(tx, access.canonicalQueueId);
      return this.getQueueStateInTransaction(tx, principal, access);
    });
  }

  async removeOffer(principal: ExtensionPrincipal, offerId: string, expectedRevision?: string): Promise<QueueStateDto> {
    return this.runSerializableTransaction(async (tx) => {
      const access = await this.resolveQueueAccess(tx, principal);
      await this.assertSharedRevision(tx, access, expectedRevision);
      const offer = await tx.keyOffer.findFirst({ where: { id: offerId, channelId: access.canonicalQueueId } });
      if (!offer) throw new ApiError(404, "offer_not_found", "Key offer was not found.");
      const ownsOffer = Boolean(principal.userId && principal.userId === offer.twitchUserId);
      if (!ownsOffer && !this.canModerateEntries(principal, access)) {
        throw new ApiError(403, "forbidden", "Only the offer owner or a queue manager can remove this key.");
      }
      await tx.keyOffer.delete({ where: { id: offer.id } });
      await this.writeEvent(tx, principal, access.canonicalQueueId, "offer.removed", undefined, {
        removedOfferId: offer.id
      });
      await this.incrementRevision(tx, access.canonicalQueueId);
      return this.getQueueStateInTransaction(tx, principal, access);
    });
  }

  async setEntryStatus(
    principal: ExtensionPrincipal,
    entryId: string,
    status: QueueEntryStatus,
    expectedRevision?: string
  ): Promise<QueueStateDto> {
    return this.moderateEntry(principal, expectedRevision, async (tx, access) => {
      await this.requireEntryInChannel(tx, access, entryId);
      await tx.queueEntry.update({ where: { id: entryId }, data: { status } });
      await this.writeEvent(tx, principal, access.canonicalQueueId, "entry.status_changed", entryId, { status });
      await this.normalizeActivePositions(tx, access.canonicalQueueId);
    });
  }

  async moveEntry(
    principal: ExtensionPrincipal,
    entryId: string,
    input: MoveEntryRequest,
    expectedRevision?: string
  ): Promise<QueueStateDto> {
    return this.moderateEntry(principal, expectedRevision, async (tx, access) => {
      const entry = await this.requireEntryInChannel(tx, access, entryId);
      if (entry.status === "completed") {
        throw new ApiError(409, "entry_not_moveable", "Completed entries cannot be reordered.");
      }
      const active = await tx.queueEntry.findMany({
        where: { channelId: access.canonicalQueueId, status: { not: "completed" } },
        orderBy: [{ position: "asc" }, { joinedAt: "asc" }]
      });
      const index = active.findIndex((candidate) => candidate.id === entryId);
      const swapIndex = input.direction === "up" ? index - 1 : index + 1;
      if (index >= 0 && swapIndex >= 0 && swapIndex < active.length) {
        const current = active[index]!;
        const target = active[swapIndex]!;
        const temporaryPosition = -Math.max(current.position, target.position) - 1;
        await tx.queueEntry.update({ where: { id: current.id }, data: { position: temporaryPosition } });
        await tx.queueEntry.update({ where: { id: target.id }, data: { position: current.position } });
        await tx.queueEntry.update({ where: { id: current.id }, data: { position: target.position } });
        await this.writeEvent(tx, principal, access.canonicalQueueId, "entry.moved", entryId, input);
      }
      await this.normalizeActivePositions(tx, access.canonicalQueueId);
    });
  }

  async removeEntry(principal: ExtensionPrincipal, entryId: string, expectedRevision?: string): Promise<QueueStateDto> {
    return this.moderateEntry(principal, expectedRevision, async (tx, access) => {
      await this.requireEntryInChannel(tx, access, entryId);
      await this.detachEntryEvents(tx, entryId);
      await tx.queueEntry.delete({ where: { id: entryId } });
      await this.writeEvent(tx, principal, access.canonicalQueueId, "entry.removed", undefined, {
        removedEntryId: entryId
      });
      await this.normalizeActivePositions(tx, access.canonicalQueueId);
    });
  }

  async clear(principal: ExtensionPrincipal, expectedRevision?: string): Promise<QueueStateDto> {
    return this.runSerializableTransaction(async (tx) => {
      const access = await this.resolveQueueAccess(tx, principal);
      await this.assertSharedRevision(tx, access, expectedRevision);
      if (!this.canClearQueue(principal, access)) {
        throw new ApiError(403, "forbidden", "Only the host broadcaster can clear a shared queue.");
      }
      await tx.queueEvent.updateMany({
        where: { channelId: access.canonicalQueueId, entryId: { not: null } },
        data: { entryId: null }
      });
      await tx.queueEntry.deleteMany({ where: { channelId: access.canonicalQueueId } });
      await this.writeEvent(tx, principal, access.canonicalQueueId, "queue.cleared");
      await this.incrementRevision(tx, access.canonicalQueueId);
      return this.getQueueStateInTransaction(tx, principal, access);
    });
  }

  async setSettings(
    principal: ExtensionPrincipal,
    input: SetQueueSettingsRequest,
    expectedRevision?: string
  ): Promise<QueueStateDto> {
    return this.runSerializableTransaction(async (tx) => {
      const access = await this.resolveQueueAccess(tx, principal);
      await this.assertSharedRevision(tx, access, expectedRevision);
      if (!this.canManageSettings(principal, access)) {
        throw new ApiError(403, "forbidden", "Only a participating broadcaster can change shared signups.");
      }
      await tx.channel.update({ where: { id: access.canonicalQueueId }, data: { signupsOpen: input.signupsOpen } });
      await this.writeEvent(tx, principal, access.canonicalQueueId, "queue.settings_changed", undefined, input);
      await this.incrementRevision(tx, access.canonicalQueueId);
      return this.getQueueStateInTransaction(tx, principal, access);
    });
  }

  async getCollaborationState(principal: ExtensionPrincipal): Promise<CollaborationStateDto> {
    this.requireBroadcaster(principal);
    return this.runSerializableTransaction(async (tx) => {
      await this.ensureChannel(tx, principal.channelId);
      await this.clearExpiredInvites(tx);
      return this.getCollaborationStateInTransaction(tx, principal.channelId);
    });
  }

  async validateCollaborationTarget(principal: ExtensionPrincipal, targetChannelId: string): Promise<void> {
    this.requireBroadcaster(principal);
    await this.runSerializableTransaction(async (tx) => {
      await Promise.all([this.ensureChannel(tx, principal.channelId), this.ensureChannel(tx, targetChannelId)]);
      await this.clearExpiredInvites(tx);
      await this.assertChannelsCanCollaborate(tx, principal.channelId, targetChannelId);
    });
  }

  async createCollaborationInvite(
    principal: ExtensionPrincipal,
    target: { channelId: string; displayName: string },
    hostDisplayName: string
  ): Promise<CollaborationStateDto> {
    this.requireBroadcaster(principal);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = createInviteCode();
      try {
        return await this.runSerializableTransaction(async (tx) => {
          await Promise.all([this.ensureChannel(tx, principal.channelId), this.ensureChannel(tx, target.channelId)]);
          await this.clearExpiredInvites(tx);
          await this.assertChannelsCanCollaborate(tx, principal.channelId, target.channelId);
          const now = new Date();
          await tx.collaborationInvite.updateMany({
            where: { hostChannelId: principal.channelId, code: { not: null }, consumedAt: null, revokedAt: null },
            data: { code: null, revokedAt: now }
          });
          await tx.collaborationInvite.create({
            data: {
              hostChannelId: principal.channelId,
              collaboratorChannelId: target.channelId,
              hostDisplayName,
              collaboratorDisplayName: target.displayName,
              code,
              createdAt: now,
              expiresAt: new Date(now.getTime() + inviteLifetimeMs)
            }
          });
          return {
            state: "pending-host-invite",
            collaboratorDisplayName: target.displayName,
            code,
            expiresAt: new Date(now.getTime() + inviteLifetimeMs).toISOString()
          };
        });
      } catch (error) {
        if (isUniqueConstraintError(error) && attempt < 4) continue;
        throw error;
      }
    }
    throw new ApiError(503, "invite_code_unavailable", "A collaboration code could not be created. Try again.");
  }

  async revokeCollaborationInvite(principal: ExtensionPrincipal): Promise<CollaborationStateDto> {
    this.requireBroadcaster(principal);
    return this.runSerializableTransaction(async (tx) => {
      await this.ensureChannel(tx, principal.channelId);
      const now = new Date();
      await tx.collaborationInvite.updateMany({
        where: { hostChannelId: principal.channelId, code: { not: null }, consumedAt: null, revokedAt: null },
        data: { code: null, revokedAt: now }
      });
      return { state: "standalone" };
    });
  }

  async previewCollaborationInvite(
    principal: ExtensionPrincipal,
    input: CollaborationCodeRequest
  ): Promise<{ hostDisplayName: string }> {
    this.requireBroadcaster(principal);
    const result = await this.runSerializableTransaction(async (tx) => {
      await this.ensureChannel(tx, principal.channelId);
      return this.checkInvite(tx, principal.channelId, input.code.toUpperCase());
    });
    if (result.kind === "rate-limited") throw rateLimitedError(result.retryAfter);
    if (result.kind === "invalid" || !result.invite) throw invalidInviteError();
    return { hostDisplayName: result.invite.hostDisplayName };
  }

  async joinCollaboration(
    principal: ExtensionPrincipal,
    input: CollaborationCodeRequest
  ): Promise<CollaborationMutationResult> {
    this.requireBroadcaster(principal);
    const result = await this.runSerializableTransaction(async (tx) => {
      await this.ensureChannel(tx, principal.channelId);
      const checked = await this.checkInvite(tx, principal.channelId, input.code.toUpperCase());
      if (checked.kind !== "valid") return checked;
      const invite = checked.invite;
      await this.assertChannelsCanCollaborate(tx, invite.hostChannelId, principal.channelId);
      const [activeEntries, offers] = await Promise.all([
        tx.queueEntry.count({ where: { channelId: principal.channelId, status: { not: "completed" } } }),
        tx.keyOffer.count({ where: { channelId: principal.channelId } })
      ]);
      if (activeEntries || offers) {
        throw new ApiError(
          409,
          "collaborator_queue_not_empty",
          "Finish or remove active queue entries and key offers before joining."
        );
      }
      const now = new Date();
      const collaboration = await tx.collaboration.create({
        data: {
          hostChannelId: invite.hostChannelId,
          startedAt: now,
          memberships: {
            create: [
              {
                channelId: invite.hostChannelId,
                role: "host",
                displayName: invite.hostDisplayName,
                joinedAt: now
              },
              {
                channelId: principal.channelId,
                role: "collaborator",
                displayName: invite.collaboratorDisplayName,
                joinedAt: now
              }
            ]
          }
        }
      });
      await tx.collaborationInvite.update({
        where: { id: invite.id },
        data: { code: null, consumedAt: now }
      });
      await this.revokeInvitesForChannels(tx, [invite.hostChannelId, principal.channelId], now);
      await this.writeEvent(tx, principal, invite.hostChannelId, "collaboration.joined", undefined, {
        collaborationId: collaboration.id
      });
      const revision = await this.incrementRevision(tx, invite.hostChannelId);
      return {
        kind: "joined" as const,
        state: {
          state: "active" as const,
          role: "collaborator" as const,
          hostDisplayName: invite.hostDisplayName,
          collaboratorDisplayName: invite.collaboratorDisplayName
        },
        invalidations: [invite.hostChannelId, principal.channelId].map((recipientChannelId) => ({
          recipientChannelId,
          canonicalQueueId: invite.hostChannelId,
          revision
        }))
      };
    });

    if (result.kind === "rate-limited") throw rateLimitedError(result.retryAfter);
    if (result.kind === "invalid") throw invalidInviteError();
    return { collaboration: result.state, invalidations: result.invalidations };
  }

  async splitCollaboration(
    principal: ExtensionPrincipal,
    initiator: "host" | "collaborator"
  ): Promise<CollaborationMutationResult> {
    this.requireBroadcaster(principal);
    return this.runSerializableTransaction(async (tx) => {
      const access = await this.resolveQueueAccess(tx, principal);
      if (access.membershipRole === "standalone" || access.membershipRole !== initiator) {
        throw new ApiError(403, "forbidden", initiator === "host"
          ? "Only the host broadcaster can end this collaboration."
          : "Only the collaborator broadcaster can leave this collaboration.");
      }
      const hostChannelId = access.hostChannelId!;
      const collaboratorChannelId = access.collaboratorChannelId!;
      const collaborationId = access.collaborationId!;
      const now = new Date();
      const movedEntries = await tx.queueEntry.findMany({
        where: {
          channelId: hostChannelId,
          submittedViaChannelId: collaboratorChannelId,
          status: { not: "completed" }
        },
        orderBy: [{ position: "asc" }, { joinedAt: "asc" }]
      });
      const completedEntries = await tx.queueEntry.findMany({
        where: {
          channelId: hostChannelId,
          submittedViaChannelId: collaboratorChannelId,
          status: "completed"
        },
        select: { id: true }
      });
      if (completedEntries.length) {
        await tx.queueEvent.updateMany({
          where: { entryId: { in: completedEntries.map((entry) => entry.id) } },
          data: { entryId: null }
        });
        await tx.queueEntry.deleteMany({ where: { id: { in: completedEntries.map((entry) => entry.id) } } });
      }
      for (const [index, entry] of movedEntries.entries()) {
        await tx.queueEntry.update({
          where: { id: entry.id },
          data: {
            channelId: collaboratorChannelId,
            status: "waiting",
            position: index + 1,
            updatedAt: entry.updatedAt
          }
        });
      }
      const movedOffers = await tx.keyOffer.findMany({
        where: { channelId: hostChannelId, submittedViaChannelId: collaboratorChannelId }
      });
      for (const offer of movedOffers) {
        await tx.keyOffer.update({
          where: { id: offer.id },
          data: { channelId: collaboratorChannelId, updatedAt: offer.updatedAt }
        });
      }
      await this.normalizeActivePositions(tx, hostChannelId, true);
      await tx.collaborationMembership.updateMany({
        where: { collaborationId, leftAt: null }, data: { leftAt: now }
      });
      await tx.collaboration.update({ where: { id: collaborationId }, data: { endedAt: now } });
      await this.revokeInvitesForChannels(tx, [hostChannelId, collaboratorChannelId], now);
      await this.writeEvent(tx, principal, hostChannelId, "collaboration.split", undefined, {
        collaborationId,
        movedEntryCount: movedEntries.length,
        movedOfferCount: movedOffers.length,
        deletedCompletedCount: completedEntries.length,
        destinationChannelId: collaboratorChannelId
      });
      await this.writeEvent(tx, principal, collaboratorChannelId, "collaboration.split_received", undefined, {
        collaborationId,
        movedEntryCount: movedEntries.length,
        movedOfferCount: movedOffers.length
      });
      const [hostRevision, collaboratorRevision] = await Promise.all([
        this.incrementRevision(tx, hostChannelId),
        this.incrementRevision(tx, collaboratorChannelId)
      ]);
      return {
        collaboration: { state: "standalone" },
        invalidations: [
          { recipientChannelId: hostChannelId, canonicalQueueId: hostChannelId, revision: hostRevision },
          {
            recipientChannelId: collaboratorChannelId,
            canonicalQueueId: collaboratorChannelId,
            revision: collaboratorRevision
          }
        ]
      };
    });
  }

  private async moderateEntry(
    principal: ExtensionPrincipal,
    expectedRevision: string | undefined,
    mutation: (tx: TransactionClient, access: QueueAccessContext) => Promise<void>
  ): Promise<QueueStateDto> {
    return this.runSerializableTransaction(async (tx) => {
      const access = await this.resolveQueueAccess(tx, principal);
      await this.assertSharedRevision(tx, access, expectedRevision);
      if (!this.canModerateEntries(principal, access)) {
        throw new ApiError(403, "forbidden", "Only a participating queue manager can moderate this queue.");
      }
      await mutation(tx, access);
      await this.incrementRevision(tx, access.canonicalQueueId);
      return this.getQueueStateInTransaction(tx, principal, access);
    });
  }

  private async runSerializableTransaction<T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(callback, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });
      } catch (error) {
        if (!isSerializationFailure(error) || attempt === 4) throw error;
      }
    }
    throw new Error("Serializable transaction retry limit reached.");
  }

  private async resolveQueueAccess(
    tx: TransactionClient,
    principal: ExtensionPrincipal
  ): Promise<QueueAccessContext> {
    await this.ensureChannel(tx, principal.channelId);
    const membership = await tx.collaborationMembership.findFirst({
      where: { channelId: principal.channelId, leftAt: null, collaboration: { endedAt: null } },
      include: {
        collaboration: { include: { memberships: { where: { leftAt: null } } } }
      }
    });
    if (!membership) {
      return {
        authenticatedChannelId: principal.channelId,
        canonicalQueueId: principal.channelId,
        sourceChannelId: principal.channelId,
        membershipRole: "standalone"
      };
    }
    const host = membership.collaboration.memberships.find((member) => member.role === "host");
    const collaborator = membership.collaboration.memberships.find((member) => member.role === "collaborator");
    if (!host || !collaborator) {
      throw new ApiError(409, "invalid_collaboration", "The shared queue membership is incomplete.");
    }
    await this.ensureChannel(tx, membership.collaboration.hostChannelId);
    return {
      authenticatedChannelId: principal.channelId,
      canonicalQueueId: membership.collaboration.hostChannelId,
      sourceChannelId: principal.channelId,
      membershipRole: membership.role,
      collaborationId: membership.collaborationId,
      hostChannelId: host.channelId,
      collaboratorChannelId: collaborator.channelId,
      hostDisplayName: host.displayName,
      collaboratorDisplayName: collaborator.displayName
    };
  }

  private async getQueueStateInTransaction(
    tx: TransactionClient,
    principal: ExtensionPrincipal,
    access: QueueAccessContext
  ): Promise<QueueStateDto> {
    const channel = await this.ensureChannel(tx, access.canonicalQueueId);
    const [entries, offers, signupDefaults] = await Promise.all([
      tx.queueEntry.findMany({
        where: { channelId: access.canonicalQueueId },
        orderBy: [{ position: "asc" }, { joinedAt: "asc" }]
      }),
      tx.keyOffer.findMany({ where: { channelId: access.canonicalQueueId }, orderBy: [{ createdAt: "desc" }] }),
      principal.userId
        ? tx.viewerSignupPreference.findUnique({
            where: {
              channelId_twitchUserId: {
                channelId: access.authenticatedChannelId,
                twitchUserId: principal.userId
              }
            }
          })
        : Promise.resolve(null)
    ]);
    const moderateEntries = this.canModerateEntries(principal, access);
    const viewer: QueueStateDto["viewer"] = {
      role: principal.role,
      isLinked: Boolean(principal.userId),
      canModerate: moderateEntries,
      permissions: {
        moderateEntries,
        manageSettings: this.canManageSettings(principal, access),
        clearQueue: this.canClearQueue(principal, access)
      }
    };
    if (signupDefaults) {
      viewer.signupDefaults = { realm: signupDefaults.realm, characterName: signupDefaults.characterName };
    }
    const sourceRole = (submittedViaChannelId: string): CollaborationMemberRole | null => {
      if (access.membershipRole === "standalone") return null;
      return submittedViaChannelId === access.hostChannelId ? "host" : "collaborator";
    };
    return {
      channelId: access.canonicalQueueId,
      signupsOpen: channel.signupsOpen,
      revision: channel.revision.toString(),
      collaboration: access.membershipRole === "standalone" ? null : {
        role: access.membershipRole,
        hostDisplayName: access.hostDisplayName!,
        collaboratorDisplayName: access.collaboratorDisplayName!
      },
      dungeonCatalog: currentDungeonCatalog,
      viewer,
      entries: entries.map((entry): QueueEntryDto => {
        const details = parseCharacterDetails(entry.note);
        return {
          id: entry.id,
          displayName: entry.displayName,
          role: entry.role,
          roles: details.roles.length ? details.roles : [entry.role],
          realm: details.realm,
          characterName: details.characterName,
          keyIntent: details.keyIntent,
          dungeon: details.dungeon,
          keyLevel: details.keyLevel,
          status: entry.status,
          position: entry.position,
          joinedAt: entry.joinedAt.toISOString(),
          updatedAt: entry.updatedAt.toISOString(),
          isCurrentViewer: principal.userId === entry.twitchUserId && entry.status !== "completed",
          sourceRole: sourceRole(entry.submittedViaChannelId)
        };
      }),
      offers: offers.map((offer): KeyOfferDto => {
        const details = parseCharacterDetails(offer.note);
        return {
          id: offer.id,
          displayName: offer.displayName,
          role: offer.role,
          roles: details.roles.length ? details.roles : [offer.role],
          realm: details.realm,
          characterName: details.characterName,
          keyIntent: "offer",
          dungeon: details.dungeon,
          keyLevel: details.keyLevel,
          createdAt: offer.createdAt.toISOString(),
          updatedAt: offer.updatedAt.toISOString(),
          isCurrentViewer: principal.userId === offer.twitchUserId,
          sourceRole: sourceRole(offer.submittedViaChannelId)
        };
      })
    };
  }

  private async getCollaborationStateInTransaction(
    tx: TransactionClient,
    channelId: string
  ): Promise<CollaborationStateDto> {
    const principal: ExtensionPrincipal = { channelId, role: "broadcaster", token: "internal" };
    const access = await this.resolveQueueAccess(tx, principal);
    if (access.membershipRole !== "standalone") {
      return {
        state: "active",
        role: access.membershipRole,
        hostDisplayName: access.hostDisplayName!,
        collaboratorDisplayName: access.collaboratorDisplayName!
      };
    }
    const invite = await tx.collaborationInvite.findFirst({
      where: {
        hostChannelId: channelId,
        code: { not: null },
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: "desc" }
    });
    return invite?.code ? {
      state: "pending-host-invite",
      collaboratorDisplayName: invite.collaboratorDisplayName,
      code: invite.code,
      expiresAt: invite.expiresAt.toISOString()
    } : { state: "standalone" };
  }

  private async checkInvite(
    tx: TransactionClient,
    channelId: string,
    code: string
  ): Promise<InviteCheckResult> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - failedAttemptWindowMs);
    await tx.collaborationInviteAttempt.deleteMany({ where: { attemptedAt: { lt: windowStart } } });
    await this.clearExpiredInvites(tx, now);
    const attempts = await tx.collaborationInviteAttempt.findMany({
      where: { channelId, attemptedAt: { gte: windowStart } },
      orderBy: { attemptedAt: "asc" }
    });
    if (attempts.length >= maxFailedAttempts) {
      const retryAfter = Math.max(1, Math.ceil((attempts[0]!.attemptedAt.getTime() + failedAttemptWindowMs - now.getTime()) / 1000));
      return { kind: "rate-limited", retryAfter };
    }
    const invite = await tx.collaborationInvite.findFirst({
      where: {
        code,
        collaboratorChannelId: channelId,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now }
      }
    });
    if (!invite) {
      await tx.collaborationInviteAttempt.create({ data: { channelId, attemptedAt: now } });
      return { kind: "invalid" };
    }
    return { kind: "valid", invite };
  }

  private async assertChannelsCanCollaborate(
    tx: TransactionClient,
    hostChannelId: string,
    collaboratorChannelId: string
  ): Promise<void> {
    if (hostChannelId === collaboratorChannelId) {
      throw new ApiError(409, "same_channel", "A channel cannot collaborate with itself.");
    }
    const active = await tx.collaborationMembership.findFirst({
      where: { channelId: { in: [hostChannelId, collaboratorChannelId] }, leftAt: null }
    });
    if (active) {
      throw new ApiError(409, "active_membership_conflict", "One of these channels is already collaborating.");
    }
  }

  private async clearExpiredInvites(tx: TransactionClient, now = new Date()): Promise<void> {
    await tx.collaborationInvite.updateMany({
      where: { code: { not: null }, consumedAt: null, revokedAt: null, expiresAt: { lte: now } },
      data: { code: null }
    });
  }

  private async revokeInvitesForChannels(tx: TransactionClient, channelIds: string[], now: Date): Promise<void> {
    await tx.collaborationInvite.updateMany({
      where: {
        code: { not: null },
        consumedAt: null,
        revokedAt: null,
        OR: [{ hostChannelId: { in: channelIds } }, { collaboratorChannelId: { in: channelIds } }]
      },
      data: { code: null, revokedAt: now }
    });
  }

  private async assertSharedRevision(
    tx: TransactionClient,
    access: QueueAccessContext,
    expectedRevision: string | undefined
  ): Promise<void> {
    if (access.membershipRole === "standalone") return;
    const channel = await this.ensureChannel(tx, access.canonicalQueueId);
    if (expectedRevision === undefined || channel.revision.toString() !== expectedRevision) {
      throw new ApiError(409, "stale_queue_revision", "The shared queue changed. Refresh and try again.");
    }
  }

  private canModerateEntries(principal: ExtensionPrincipal, access: QueueAccessContext): boolean {
    return canModerateRole(principal.role) && (access.membershipRole === "standalone" || Boolean(access.collaborationId));
  }

  private canManageSettings(principal: ExtensionPrincipal, access: QueueAccessContext): boolean {
    return access.membershipRole === "standalone"
      ? canModerateRole(principal.role)
      : principal.role === "broadcaster";
  }

  private canClearQueue(principal: ExtensionPrincipal, access: QueueAccessContext): boolean {
    return access.membershipRole === "standalone"
      ? canModerateRole(principal.role)
      : principal.role === "broadcaster" && access.membershipRole === "host";
  }

  private requireBroadcaster(principal: ExtensionPrincipal): void {
    if (principal.role !== "broadcaster") {
      throw new ApiError(403, "broadcaster_required", "Only the channel broadcaster can manage collaboration.");
    }
  }

  private async ensureChannel(tx: TransactionClient, channelId: string) {
    return tx.channel.upsert({ where: { id: channelId }, update: {}, create: { id: channelId } });
  }

  private async incrementRevision(tx: TransactionClient, channelId: string): Promise<string> {
    const channel = await tx.channel.update({ where: { id: channelId }, data: { revision: { increment: 1 } } });
    return channel.revision.toString();
  }

  private async nextActivePosition(tx: TransactionClient, channelId: string): Promise<number> {
    const aggregate = await tx.queueEntry.aggregate({
      where: { channelId, status: { not: "completed" } }, _max: { position: true }
    });
    return (aggregate._max.position ?? 0) + 1;
  }

  private async requireEntryInChannel(tx: TransactionClient, access: QueueAccessContext, entryId: string) {
    const entry = await tx.queueEntry.findFirst({ where: { id: entryId, channelId: access.canonicalQueueId } });
    if (!entry) throw new ApiError(404, "entry_not_found", "Queue entry was not found.");
    return entry;
  }

  private async detachEntryEvents(tx: TransactionClient, entryId: string): Promise<void> {
    await tx.queueEvent.updateMany({ where: { entryId }, data: { entryId: null } });
  }

  private async normalizeActivePositions(
    tx: TransactionClient,
    channelId: string,
    preserveTimestamps = false
  ): Promise<void> {
    const entries = await tx.queueEntry.findMany({
      where: { channelId, status: { not: "completed" } },
      orderBy: [{ position: "asc" }, { joinedAt: "asc" }]
    });
    for (const [index, entry] of entries.entries()) {
      if (entry.position !== index + 1) {
        await tx.queueEntry.update({
          where: { id: entry.id },
          data: preserveTimestamps
            ? { position: index + 1, updatedAt: entry.updatedAt }
            : { position: index + 1 }
        });
      }
    }
  }

  private async writeEvent(
    tx: TransactionClient,
    principal: ExtensionPrincipal,
    channelId: string,
    action: string,
    entryId?: string,
    metadata?: unknown
  ): Promise<void> {
    await tx.queueEvent.create({
      data: {
        channelId,
        entryId: entryId ?? null,
        actorTwitchUserId: principal.userId ?? null,
        actorChannelId: principal.channelId,
        actorRole: principal.role,
        action,
        metadata: metadata === undefined ? Prisma.DbNull : metadata as Prisma.InputJsonValue
      }
    });
  }

  private async saveSignupDefaults(
    tx: TransactionClient,
    channelId: string,
    twitchUserId: string,
    input: Pick<JoinQueueRequest | OfferKeyRequest, "realm" | "characterName">
  ): Promise<void> {
    await tx.viewerSignupPreference.upsert({
      where: { channelId_twitchUserId: { channelId, twitchUserId } },
      update: { realm: input.realm, characterName: input.characterName },
      create: { channelId, twitchUserId, realm: input.realm, characterName: input.characterName }
    });
  }
}

function getPrimaryRole(roles: QueueRole[]): QueueRole {
  return roles[0] ?? "dps";
}

function createInviteCode(): string {
  return Array.from({ length: 6 }, () => inviteAlphabet[randomInt(inviteAlphabet.length)]).join("");
}

function isSerializationFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function invalidInviteError(): ApiError {
  return new ApiError(400, "invalid_or_expired_invite", "The collaboration code is invalid or expired.");
}

function rateLimitedError(retryAfter: number): ApiError {
  return new ApiError(429, "invite_rate_limited", "Too many failed collaboration codes. Try again later.", {
    retryAfter
  });
}
