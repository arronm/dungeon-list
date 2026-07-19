import { describe, expect, it, vi } from "vitest";
import type { KeyOffer, PrismaClient, QueueEntry } from "@prisma/client";
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
    expect(joinedQueue.viewer.signupDefaults).toEqual({
      realm: "Area 52",
      characterName: "Bulwark"
    });

    const leftQueue = await repository.leave(principal);

    expect(leftQueue.entries).toHaveLength(1);
    expect(leftQueue.entries[0]).toMatchObject({ id: "completed-1", status: "completed", isCurrentViewer: false });
    expect(leftQueue.viewer.signupDefaults).toEqual({
      realm: "Area 52",
      characterName: "Bulwark"
    });
    expect(database.entries()).toHaveLength(1);
  });
});

describe("QueueRepository key offers", () => {
  it("allows one viewer to offer multiple characters and remove a single offer", async () => {
    const database = createTestDatabase([]);
    const repository = new QueueRepository(database.prisma);

    await repository.offerKey(
      principal,
      {
        role: "tank",
        realm: "Area 52",
        characterName: "Wallbuilder",
        keyIntent: "offer",
        dungeon: "Windrunner Spire",
        keyLevel: 12
      },
      "QueueViewer"
    );
    const offeredKeys = await repository.offerKey(
      principal,
      {
        role: "dps",
        realm: "Illidan",
        characterName: "Fastcast",
        keyIntent: "offer",
        dungeon: "Magisters' Terrace",
        keyLevel: 8
      },
      "QueueViewer"
    );

    expect(offeredKeys.entries).toHaveLength(0);
    expect(offeredKeys.offers).toHaveLength(2);
    expect(offeredKeys.offers.map((offer) => offer.characterName)).toEqual(["Fastcast", "Wallbuilder"]);
    expect(offeredKeys.viewer.signupDefaults).toEqual({
      realm: "Illidan",
      characterName: "Fastcast"
    });

    const remaining = await repository.removeOffer(principal, offeredKeys.offers[0]!.id);

    expect(remaining.offers).toHaveLength(1);
    expect(remaining.offers[0]?.characterName).toBe("Wallbuilder");
    expect(remaining.viewer.signupDefaults).toEqual({
      realm: "Illidan",
      characterName: "Fastcast"
    });
    expect(database.offers()).toHaveLength(1);
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

function createOffer(overrides: Partial<KeyOffer> = {}): KeyOffer {
  const timestamp = new Date("2026-07-18T20:00:00.000Z");
  return {
    id: "offer-1",
    channelId: "channel-1",
    twitchUserId: "viewer-1",
    displayName: "QueueViewer",
    role: "dps",
    note: 'character:v2:["Area 52","Keyrunner","offer","Skyreach",10]',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function createTestDatabase(initialEntries: QueueEntry[]) {
  let entries = [...initialEntries];
  let offers: KeyOffer[] = [];
  let signupPreference: {
    channelId: string;
    twitchUserId: string;
    realm: string;
    characterName: string;
    updatedAt: Date;
  } | null = null;
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

  const keyOffer = {
    create: vi.fn(async ({ data }: any) => {
      const timestamp = nextTimestamp();
      const offer = createOffer({
        ...data,
        id: `offer-${offers.length + 1}`,
        displayName: data.displayName ?? null,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      offers.push(offer);
      return offer;
    }),
    findFirst: vi.fn(async ({ where }: any) =>
      offers.find(
        (offer) => offer.id === where.id && offer.channelId === where.channelId
      ) ?? null
    ),
    findMany: vi.fn(async ({ where }: any) =>
      offers
        .filter((offer) => offer.channelId === where.channelId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    ),
    delete: vi.fn(async ({ where }: any) => {
      const offer = offers.find((candidate) => candidate.id === where.id)!;
      offers = offers.filter((candidate) => candidate.id !== where.id);
      return offer;
    })
  };

  const viewerSignupPreference = {
    upsert: vi.fn(async ({ update, create }: any) => {
      signupPreference = signupPreference
        ? { ...signupPreference, ...update, updatedAt: nextTimestamp() }
        : { ...create, updatedAt: nextTimestamp() };
      return signupPreference;
    }),
    findUnique: vi.fn(async ({ where }: any) => {
      const identity = where.channelId_twitchUserId;
      if (
        signupPreference?.channelId === identity.channelId &&
        signupPreference.twitchUserId === identity.twitchUserId
      ) {
        return signupPreference;
      }
      return null;
    })
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
    keyOffer,
    viewerSignupPreference,
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
    },
    keyOffer: {
      updateMany: vi.fn(async () => ({ count: 0 }))
    }
  } as unknown as PrismaClient;

  return {
    prisma,
    entries: () => entries,
    offers: () => offers,
    signupPreference: () => signupPreference
  };
}
