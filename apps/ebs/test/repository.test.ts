import { describe, expect, it, vi } from "vitest";
import type { PrismaClient, QueueEntry } from "@prisma/client";
import type { ExtensionPrincipal } from "../src/auth.js";
import { QueueRepository } from "../src/repository.js";

const principal: ExtensionPrincipal = {
  channelId: "channel-1",
  opaqueUserId: "opaque-viewer-1",
  userId: "viewer-1",
  role: "viewer",
  token: "extension-token"
};

describe("QueueRepository completed history", () => {
  it("allows a completed viewer to rejoin and leaves only their active entry", async () => {
    const completedEntry = createEntry({ id: "completed-1", status: "completed", position: 1 });
    const database = createTestDatabase([completedEntry]);
    const repository = new QueueRepository(database.prisma);

    const joinedQueue = await repository.join(
      principal,
      {
        role: "tank",
        realm: "Area 52",
        characterName: "Bulwark",
        keyIntent: "need",
        dungeon: "Skyreach",
        keyLevel: 12
      },
      "QueueViewer"
    );

    expect(joinedQueue.entries).toHaveLength(2);
    expect(joinedQueue.entries.find((entry) => entry.id === "completed-1")?.isCurrentViewer).toBe(false);
    const activeEntry = joinedQueue.entries.find((entry) => entry.status !== "completed");
    expect(activeEntry).toMatchObject({
      twitchUserId: "viewer-1",
      isCurrentViewer: true,
      position: 1,
      keyIntent: "need",
      dungeon: "Skyreach",
      keyLevel: 12
    });

    const leftQueue = await repository.leave(principal);

    expect(leftQueue.entries).toHaveLength(1);
    expect(leftQueue.entries[0]).toMatchObject({ id: "completed-1", status: "completed", isCurrentViewer: false });
    expect(database.entries()).toHaveLength(1);
  });
});

function createEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  const timestamp = new Date("2026-07-18T20:00:00.000Z");
  return {
    id: "entry-1",
    channelId: "channel-1",
    twitchUserId: "viewer-1",
    displayName: "QueueViewer",
    role: "dps",
    note: 'character:v1:["Illidan","Oldrun"]',
    status: "waiting",
    position: 1,
    joinedAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function createTestDatabase(initialEntries: QueueEntry[]) {
  let entries = [...initialEntries];
  let revision = 0;
  const channel = {
    id: "channel-1",
    signupsOpen: true,
    createdAt: new Date("2026-07-18T19:00:00.000Z"),
    updatedAt: new Date("2026-07-18T20:00:00.000Z")
  };
  const nextTimestamp = () => new Date(Date.UTC(2026, 6, 18, 21, 0, revision++));

  const queueEntry = {
    findFirst: vi.fn(async ({ where }: any) =>
      entries.find(
        (entry) =>
          entry.channelId === where.channelId &&
          entry.twitchUserId === where.twitchUserId &&
          (where.status?.not ? entry.status !== where.status.not : true)
      ) ?? null
    ),
    aggregate: vi.fn(async () => ({
      _max: {
        position: entries
          .filter((entry) => entry.status !== "completed")
          .reduce<number | null>((max, entry) => Math.max(max ?? 0, entry.position), null)
      }
    })),
    create: vi.fn(async ({ data }: any) => {
      const timestamp = nextTimestamp();
      const entry = createEntry({
        ...data,
        id: `active-${entries.length + 1}`,
        displayName: data.displayName ?? null,
        status: data.status ?? "waiting",
        joinedAt: data.joinedAt ?? timestamp,
        updatedAt: timestamp
      });
      entries.push(entry);
      return entry;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const index = entries.findIndex((entry) => entry.id === where.id);
      entries[index] = { ...entries[index]!, ...data, updatedAt: nextTimestamp() };
      return entries[index]!;
    }),
    delete: vi.fn(async ({ where }: any) => {
      const entry = entries.find((candidate) => candidate.id === where.id)!;
      entries = entries.filter((candidate) => candidate.id !== where.id);
      return entry;
    }),
    findMany: vi.fn(async ({ where }: any) =>
      entries.filter(
        (entry) =>
          entry.channelId === where.channelId &&
          (where.status?.not ? entry.status !== where.status.not : true)
      )
    )
  };

  const transaction = {
    channel: {
      upsert: vi.fn(async () => channel),
      update: vi.fn(async () => {
        channel.updatedAt = nextTimestamp();
        return channel;
      })
    },
    queueEntry,
    queueEvent: {
      create: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 }))
    }
  };

  const prisma = {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    $disconnect: vi.fn(async () => undefined),
    queueEntry: {
      updateMany: vi.fn(async () => ({ count: 0 }))
    }
  } as unknown as PrismaClient;

  return {
    prisma,
    entries: () => entries
  };
}
