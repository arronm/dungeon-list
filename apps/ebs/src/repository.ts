import { Prisma, PrismaClient } from "@prisma/client";
import {
  canModerateRole,
  type JoinQueueRequest,
  type MoveEntryRequest,
  type QueueEntryDto,
  type QueueEntryStatus,
  type QueueStateDto,
  type SetQueueSettingsRequest
} from "@dungeon-list/shared";
import { requireLinkedViewer, type ExtensionPrincipal } from "./auth.js";
import { ApiError } from "./errors.js";

type TransactionClient = Prisma.TransactionClient;

export class QueueRepository {
  constructor(private readonly prisma = new PrismaClient()) {}

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getQueueState(principal: ExtensionPrincipal): Promise<QueueStateDto> {
    return this.prisma.$transaction(async (tx) => {
      const channel = await this.ensureChannel(tx, principal.channelId);
      return this.getQueueStateInTransaction(tx, principal, channel.updatedAt.toISOString());
    });
  }

  async join(
    principal: ExtensionPrincipal,
    input: JoinQueueRequest,
    verifiedDisplayName: string
  ): Promise<QueueStateDto> {
    const twitchUserId = requireLinkedViewer(principal);

    return this.prisma.$transaction(async (tx) => {
      const channel = await this.ensureChannel(tx, principal.channelId);
      if (!channel.signupsOpen && !canModerateRole(principal.role)) {
        throw new ApiError(409, "queue_closed", "The waitlist is currently closed.");
      }

      const existing = await tx.queueEntry.findUnique({
        where: {
          channelId_twitchUserId: {
            channelId: principal.channelId,
            twitchUserId
          }
        }
      });

      const nextPosition = await this.nextActivePosition(tx, principal.channelId);
      const position = existing && existing.status !== "completed" ? existing.position : nextPosition;
      const displayName = verifiedDisplayName || existing?.displayName || null;

      const entry = existing
        ? await tx.queueEntry.update({
            where: { id: existing.id },
            data: {
              role: input.role,
              note: input.note,
              displayName,
              status: "waiting",
              position,
              joinedAt: existing.status === "completed" ? new Date() : existing.joinedAt
            }
          })
        : await tx.queueEntry.create({
            data: {
              channelId: principal.channelId,
              twitchUserId,
              displayName,
              role: input.role,
              note: input.note,
              status: "waiting",
              position
            }
          });

      await this.writeEvent(tx, principal, "entry.joined", entry.id, {
        role: input.role,
        hadExistingEntry: Boolean(existing)
      });
      const revision = await this.touchChannel(tx, principal.channelId);
      return this.getQueueStateInTransaction(tx, principal, revision);
    });
  }

  async syncCurrentViewerDisplayName(principal: ExtensionPrincipal, displayName: string): Promise<void> {
    const twitchUserId = requireLinkedViewer(principal);
    await this.prisma.queueEntry.updateMany({
      where: {
        channelId: principal.channelId,
        twitchUserId,
        OR: [{ displayName: null }, { displayName: { not: displayName } }]
      },
      data: { displayName }
    });
  }

  async leave(principal: ExtensionPrincipal): Promise<QueueStateDto> {
    const twitchUserId = requireLinkedViewer(principal);

    return this.prisma.$transaction(async (tx) => {
      await this.ensureChannel(tx, principal.channelId);
      const existing = await tx.queueEntry.findUnique({
        where: {
          channelId_twitchUserId: {
            channelId: principal.channelId,
            twitchUserId
          }
        }
      });

      if (existing) {
        await this.detachEntryEvents(tx, existing.id);
        await tx.queueEntry.delete({ where: { id: existing.id } });
        await this.writeEvent(tx, principal, "entry.left", undefined, { removedEntryId: existing.id });
        await this.normalizeActivePositions(tx, principal.channelId);
      }

      const revision = await this.touchChannel(tx, principal.channelId);
      return this.getQueueStateInTransaction(tx, principal, revision);
    });
  }

  async setEntryStatus(
    principal: ExtensionPrincipal,
    entryId: string,
    status: QueueEntryStatus
  ): Promise<QueueStateDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.requireEntryInChannel(tx, principal, entryId);
      await tx.queueEntry.update({
        where: { id: entryId },
        data: { status }
      });
      await this.writeEvent(tx, principal, "entry.status_changed", entryId, { status });
      await this.normalizeActivePositions(tx, principal.channelId);
      const revision = await this.touchChannel(tx, principal.channelId);
      return this.getQueueStateInTransaction(tx, principal, revision);
    });
  }

  async moveEntry(
    principal: ExtensionPrincipal,
    entryId: string,
    input: MoveEntryRequest
  ): Promise<QueueStateDto> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await this.requireEntryInChannel(tx, principal, entryId);
      if (entry.status === "completed") {
        throw new ApiError(409, "entry_not_moveable", "Completed entries cannot be reordered.");
      }

      const activeEntries = await tx.queueEntry.findMany({
        where: {
          channelId: principal.channelId,
          status: { not: "completed" }
        },
        orderBy: [{ position: "asc" }, { joinedAt: "asc" }]
      });
      const index = activeEntries.findIndex((activeEntry) => activeEntry.id === entryId);
      const swapIndex = input.direction === "up" ? index - 1 : index + 1;

      if (index >= 0 && swapIndex >= 0 && swapIndex < activeEntries.length) {
        const current = activeEntries[index]!;
        const target = activeEntries[swapIndex]!;
        await tx.queueEntry.update({ where: { id: current.id }, data: { position: target.position } });
        await tx.queueEntry.update({ where: { id: target.id }, data: { position: current.position } });
        await this.writeEvent(tx, principal, "entry.moved", entryId, { direction: input.direction });
      }

      await this.normalizeActivePositions(tx, principal.channelId);
      const revision = await this.touchChannel(tx, principal.channelId);
      return this.getQueueStateInTransaction(tx, principal, revision);
    });
  }

  async removeEntry(principal: ExtensionPrincipal, entryId: string): Promise<QueueStateDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.requireEntryInChannel(tx, principal, entryId);
      await this.detachEntryEvents(tx, entryId);
      await tx.queueEntry.delete({ where: { id: entryId } });
      await this.writeEvent(tx, principal, "entry.removed", undefined, { removedEntryId: entryId });
      await this.normalizeActivePositions(tx, principal.channelId);
      const revision = await this.touchChannel(tx, principal.channelId);
      return this.getQueueStateInTransaction(tx, principal, revision);
    });
  }

  async clear(principal: ExtensionPrincipal): Promise<QueueStateDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureChannel(tx, principal.channelId);
      await tx.queueEvent.updateMany({
        where: {
          channelId: principal.channelId,
          entryId: { not: null }
        },
        data: { entryId: null }
      });
      await tx.queueEntry.deleteMany({ where: { channelId: principal.channelId } });
      await this.writeEvent(tx, principal, "queue.cleared");
      const revision = await this.touchChannel(tx, principal.channelId);
      return this.getQueueStateInTransaction(tx, principal, revision);
    });
  }

  async setSettings(principal: ExtensionPrincipal, input: SetQueueSettingsRequest): Promise<QueueStateDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureChannel(tx, principal.channelId);
      await tx.channel.update({
        where: { id: principal.channelId },
        data: { signupsOpen: input.signupsOpen }
      });
      await this.writeEvent(tx, principal, "queue.settings_changed", undefined, input);
      const revision = await this.touchChannel(tx, principal.channelId);
      return this.getQueueStateInTransaction(tx, principal, revision);
    });
  }

  private async ensureChannel(tx: TransactionClient, channelId: string) {
    return tx.channel.upsert({
      where: { id: channelId },
      update: {},
      create: { id: channelId }
    });
  }

  private async nextActivePosition(tx: TransactionClient, channelId: string): Promise<number> {
    const aggregate = await tx.queueEntry.aggregate({
      where: {
        channelId,
        status: { not: "completed" }
      },
      _max: { position: true }
    });

    return (aggregate._max.position ?? 0) + 1;
  }

  private async requireEntryInChannel(tx: TransactionClient, principal: ExtensionPrincipal, entryId: string) {
    const entry = await tx.queueEntry.findFirst({
      where: {
        id: entryId,
        channelId: principal.channelId
      }
    });

    if (!entry) {
      throw new ApiError(404, "entry_not_found", "Queue entry was not found.");
    }

    return entry;
  }

  private async detachEntryEvents(tx: TransactionClient, entryId: string): Promise<void> {
    await tx.queueEvent.updateMany({
      where: { entryId },
      data: { entryId: null }
    });
  }

  private async normalizeActivePositions(tx: TransactionClient, channelId: string): Promise<void> {
    const entries = await tx.queueEntry.findMany({
      where: {
        channelId,
        status: { not: "completed" }
      },
      orderBy: [{ position: "asc" }, { joinedAt: "asc" }]
    });

    await Promise.all(
      entries.map((entry, index) =>
        tx.queueEntry.update({
          where: { id: entry.id },
          data: { position: index + 1 }
        })
      )
    );
  }

  private async writeEvent(
    tx: TransactionClient,
    principal: ExtensionPrincipal,
    action: string,
    entryId?: string,
    metadata?: unknown
  ): Promise<void> {
    await tx.queueEvent.create({
      data: {
        channelId: principal.channelId,
        entryId: entryId ?? null,
        actorTwitchUserId: principal.userId ?? null,
        actorRole: principal.role,
        action,
        metadata: metadata === undefined ? Prisma.DbNull : (metadata as Prisma.InputJsonValue)
      }
    });
  }

  private async touchChannel(tx: TransactionClient, channelId: string): Promise<string> {
    const channel = await tx.channel.update({
      where: { id: channelId },
      data: { updatedAt: new Date() }
    });

    return channel.updatedAt.toISOString();
  }

  private async getQueueStateInTransaction(
    tx: TransactionClient,
    principal: ExtensionPrincipal,
    revision: string
  ): Promise<QueueStateDto> {
    const channel = await this.ensureChannel(tx, principal.channelId);
    const entries = await tx.queueEntry.findMany({
      where: { channelId: principal.channelId },
      orderBy: [{ position: "asc" }, { joinedAt: "asc" }]
    });

    const viewer: QueueStateDto["viewer"] = {
      opaqueUserId: principal.opaqueUserId,
      role: principal.role,
      isLinked: Boolean(principal.userId),
      canModerate: canModerateRole(principal.role)
    };

    if (principal.userId) {
      viewer.userId = principal.userId;
    }

    return {
      channelId: principal.channelId,
      signupsOpen: channel.signupsOpen,
      revision,
      viewer,
      entries: entries.map((entry): QueueEntryDto => {
        return {
          id: entry.id,
          twitchUserId: entry.twitchUserId,
          displayName: entry.displayName,
          role: entry.role,
          note: entry.note,
          status: entry.status,
          position: entry.position,
          joinedAt: entry.joinedAt.toISOString(),
          updatedAt: entry.updatedAt.toISOString(),
          isCurrentViewer: principal.userId === entry.twitchUserId
        };
      })
    };
  }
}
