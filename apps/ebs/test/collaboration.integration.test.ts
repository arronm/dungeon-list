import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { ExtensionPrincipal } from "../src/auth.js";
import { QueueRepository } from "../src/repository.js";

const runIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const describeIntegration = runIntegration ? describe : describe.skip;
const prisma = new PrismaClient();
const repository = new QueueRepository(prisma);
const host: ExtensionPrincipal = { channelId: "integration-host", role: "broadcaster", token: "host-token" };
const collaborator: ExtensionPrincipal = {
  channelId: "integration-collaborator",
  role: "broadcaster",
  token: "collaborator-token"
};

describeIntegration("PostgreSQL shared collaboration queue", () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.channel.createMany({ data: [{ id: host.channelId }, { id: collaborator.channelId }] });
  });

  afterAll(async () => {
    if (runIntegration) await resetDatabase();
    await repository.disconnect();
  });

  it("enforces one active membership per channel and one active member per role", async () => {
    const first = await prisma.collaboration.create({ data: { hostChannelId: host.channelId } });
    const second = await prisma.collaboration.create({ data: { hostChannelId: collaborator.channelId } });
    await prisma.collaborationMembership.create({
      data: {
        collaborationId: first.id,
        channelId: host.channelId,
        role: "host",
        displayName: "Host"
      }
    });

    await expect(prisma.collaborationMembership.create({
      data: {
        collaborationId: second.id,
        channelId: host.channelId,
        role: "collaborator",
        displayName: "Host Again"
      }
    })).rejects.toMatchObject({ code: "P2002" });
    await expect(prisma.collaborationMembership.create({
      data: {
        collaborationId: first.id,
        channelId: collaborator.channelId,
        role: "host",
        displayName: "Second Host"
      }
    })).rejects.toMatchObject({ code: "P2002" });

    const now = new Date();
    await prisma.collaborationInvite.create({
      data: {
        hostChannelId: host.channelId,
        collaboratorChannelId: collaborator.channelId,
        hostDisplayName: "Host",
        collaboratorDisplayName: "Collaborator",
        code: "FIRST1",
        expiresAt: new Date(now.getTime() + 60_000)
      }
    });
    await expect(prisma.collaborationInvite.create({
      data: {
        hostChannelId: host.channelId,
        collaboratorChannelId: collaborator.channelId,
        hostDisplayName: "Host",
        collaboratorDisplayName: "Collaborator",
        code: "SECOND",
        expiresAt: new Date(now.getTime() + 60_000)
      }
    })).rejects.toMatchObject({ code: "P2002" });
  });

  it("consumes a collaborator-bound code once and rejects a stale shared revision", async () => {
    await createInvite("ABC123");
    const joins = await Promise.allSettled([
      repository.joinCollaboration(collaborator, { code: "abc123" }),
      repository.joinCollaboration(collaborator, { code: "ABC123" })
    ]);
    expect(joins.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const queue = await repository.getQueueState(collaborator);
    expect(queue.collaboration).toMatchObject({ role: "collaborator", hostDisplayName: "DungeonHost" });

    const updated = await repository.setSettings(collaborator, { signupsOpen: false }, queue.revision);
    expect(BigInt(updated.revision)).toBe(BigInt(queue.revision) + 1n);
    await expect(repository.setSettings(collaborator, { signupsOpen: true }, queue.revision)).rejects.toMatchObject({
      statusCode: 409,
      code: "stale_queue_revision"
    });
  });

  it("enforces collaborator binding, expiration cleanup, and the PostgreSQL failed-attempt window", async () => {
    const intruder: ExtensionPrincipal = {
      channelId: "integration-intruder",
      role: "broadcaster",
      token: "intruder-token"
    };
    await prisma.channel.create({ data: { id: intruder.channelId } });
    await createInvite("BOUND1");
    await expect(repository.previewCollaborationInvite(intruder, { code: "BOUND1" })).rejects.toMatchObject({
      code: "invalid_or_expired_invite"
    });
    await expect(repository.previewCollaborationInvite(collaborator, { code: "BOUND1" })).resolves.toEqual({
      hostDisplayName: "DungeonHost"
    });
    const invite = await prisma.collaborationInvite.findFirstOrThrow({ where: { code: "BOUND1" } });
    await prisma.collaborationInvite.update({
      where: { id: invite.id },
      data: { expiresAt: new Date(Date.now() - 1) }
    });
    await expect(repository.previewCollaborationInvite(collaborator, { code: "BOUND1" })).rejects.toMatchObject({
      code: "invalid_or_expired_invite"
    });
    expect((await prisma.collaborationInvite.findUniqueOrThrow({ where: { id: invite.id } })).code).toBeNull();

    for (let attempt = 0; attempt < 9; attempt += 1) {
      await expect(repository.previewCollaborationInvite(collaborator, { code: "BAD999" })).rejects.toMatchObject({
        code: "invalid_or_expired_invite"
      });
    }
    await expect(repository.previewCollaborationInvite(collaborator, { code: "BAD999" })).rejects.toMatchObject({
      statusCode: 429,
      code: "invite_rate_limited",
      retryAfter: expect.any(Number)
    });
  });

  it("splits source-attributed content without recreating records or disturbing standalone history", async () => {
    await prisma.channel.update({ where: { id: collaborator.channelId }, data: { signupsOpen: false } });
    const standaloneHistory = await prisma.queueEntry.create({
      data: {
        channelId: collaborator.channelId,
        submittedViaChannelId: collaborator.channelId,
        twitchUserId: "old-viewer",
        displayName: "Old Viewer",
        role: "dps",
        status: "completed",
        position: 99
      }
    });
    await createInvite("SPLIT1");
    await repository.joinCollaboration(collaborator, { code: "SPLIT1" });

    const viewer: ExtensionPrincipal = {
      channelId: collaborator.channelId,
      userId: "new-viewer",
      role: "viewer",
      token: "viewer-token"
    };
    const first = await repository.join(viewer, signup("Firstchar"), "New Viewer");
    const active = first.entries.find((entry) => entry.isCurrentViewer)!;
    const storedBefore = await prisma.queueEntry.findUniqueOrThrow({ where: { id: active.id } });
    await repository.offerKey(viewer, offer("Offerchar"), "New Viewer");

    const completedViewer: ExtensionPrincipal = {
      channelId: collaborator.channelId,
      userId: "completed-viewer",
      role: "viewer",
      token: "completed-token"
    };
    const completedQueue = await repository.join(completedViewer, signup("Donechar"), "Done Viewer");
    const completed = completedQueue.entries.find((entry) => entry.isCurrentViewer)!;
    await repository.setEntryStatus(collaborator, completed.id, "completed", completedQueue.revision);

    const splitResults = await Promise.allSettled([
      repository.splitCollaboration(host, "host"),
      repository.splitCollaboration(collaborator, "collaborator")
    ]);
    expect(splitResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const result = splitResults.find((candidate) => candidate.status === "fulfilled")!.value;
    expect(result.invalidations.map((entry) => entry.recipientChannelId).sort()).toEqual(
      [host.channelId, collaborator.channelId].sort()
    );
    const moved = await prisma.queueEntry.findUniqueOrThrow({ where: { id: active.id } });
    expect(moved).toMatchObject({
      id: storedBefore.id,
      channelId: collaborator.channelId,
      twitchUserId: storedBefore.twitchUserId,
      status: "waiting",
      position: 1,
      joinedAt: storedBefore.joinedAt,
      updatedAt: storedBefore.updatedAt
    });
    expect(await prisma.queueEntry.findUnique({ where: { id: completed.id } })).toBeNull();
    expect(await prisma.queueEntry.findUnique({ where: { id: standaloneHistory.id } })).not.toBeNull();
    expect(await prisma.keyOffer.count({ where: { channelId: collaborator.channelId } })).toBe(1);
    expect((await prisma.channel.findUniqueOrThrow({ where: { id: collaborator.channelId } })).signupsOpen).toBe(false);
  });
});

async function createInvite(code: string): Promise<void> {
  const now = new Date();
  await prisma.collaborationInvite.create({
    data: {
      hostChannelId: host.channelId,
      collaboratorChannelId: collaborator.channelId,
      hostDisplayName: "DungeonHost",
      collaboratorDisplayName: "PartyPartner",
      code,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 20 * 60 * 1000)
    }
  });
}

function signup(characterName: string) {
  return {
    roles: ["dps"] as const,
    realm: "Area 52" as const,
    characterName,
    keyIntent: "need" as const,
    dungeon: "Skyreach",
    keyLevel: 10
  };
}

function offer(characterName: string) {
  return {
    roles: ["dps"] as const,
    realm: "Area 52" as const,
    characterName,
    keyIntent: "offer" as const,
    dungeon: "Skyreach",
    keyLevel: 10
  };
}

async function resetDatabase(): Promise<void> {
  await prisma.collaborationInviteAttempt.deleteMany();
  await prisma.collaborationInvite.deleteMany();
  await prisma.collaborationMembership.deleteMany();
  await prisma.collaboration.deleteMany();
  await prisma.queueEvent.deleteMany();
  await prisma.queueEntry.deleteMany();
  await prisma.keyOffer.deleteMany();
  await prisma.viewerSignupPreference.deleteMany();
  await prisma.channel.deleteMany();
}
