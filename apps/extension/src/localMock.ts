import {
  canModerateRole,
  joinQueueRequestSchema,
  moveEntryRequestSchema,
  setEntryStatusRequestSchema,
  setQueueSettingsRequestSchema,
  type ExtensionRole,
  type JoinQueueRequest,
  type MoveEntryRequest,
  type QueueEntryDto,
  type QueueStateDto,
  type SetEntryStatusRequest,
  type SetQueueSettingsRequest
} from "@dungeon-list/shared";

const mockAuthChangedEvent = "dungeon-list:mock-auth-changed";
const mockChannelId = "local-channel";
const mockOpaqueUserId = "opaque-local-viewer";
const mockViewerUserId = "local-viewer-1";
const mockDisplayName = "Local Tester";

let mockLinked = getInitialLinkedState();
let mockRevision = 1;
let signupsOpen = true;
let entries: QueueEntryDto[] = [
  createEntry("mock-1", "mock-tank", "Shieldstack", "tank", "Bulwark", "Area 52", "waiting", 1, 2847),
  createEntry("mock-2", "mock-healer", "Lightwell", "healer", "Sunmender", "Stormrage", "invited", 2, 2312),
  createEntry("mock-3", "mock-dps", "Burstwindow", "dps", "Critstorm", "Illidan", "waiting", 3, 0),
  createEntry("mock-4", "mock-done", "Keyholder", "dps", "Quickblade", "Sargeras", "completed", 4, 1975)
];

export interface LocalMockAuthorization {
  channelId: string;
  clientId: string;
  helixToken: string;
  token: string;
  userId?: string;
}

export interface LocalMockViewer {
  id?: string;
  opaqueId: string;
  role: ExtensionRole;
  isLinked: boolean;
}

export interface LocalMockContext {
  theme: "light" | "dark";
  language: string;
  mode: string;
}

export function isLocalMockRuntime(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return false;
  }

  const mockOverride = new URLSearchParams(window.location.search).get("mock");
  if (mockOverride === "false") {
    return false;
  }

  if (mockOverride === "true") {
    return true;
  }

  return isStandaloneBrowser();
}

export function getLocalMockAuthorization(): LocalMockAuthorization | undefined {
  if (!isLocalMockRuntime()) {
    return undefined;
  }

  const auth: LocalMockAuthorization = {
    channelId: mockChannelId,
    clientId: "local-mock-client",
    helixToken: "local-mock-helix-token",
    token: `local-dev-token:${mockLinked ? "linked" : "opaque"}`
  };

  if (mockLinked) {
    auth.userId = mockViewerUserId;
  }

  return auth;
}

export function getLocalMockViewer(): LocalMockViewer | undefined {
  if (!isLocalMockRuntime()) {
    return undefined;
  }

  const viewer: LocalMockViewer = {
    opaqueId: mockOpaqueUserId,
    role: getMockRole(),
    isLinked: mockLinked
  };

  if (mockLinked) {
    viewer.id = mockViewerUserId;
  }

  return viewer;
}

export function getLocalMockContext(): LocalMockContext | undefined {
  if (!isLocalMockRuntime()) {
    return undefined;
  }

  return {
    theme: getMockTheme(),
    language: "en",
    mode: "viewer"
  };
}

export function subscribeToLocalMockAuth(callback: () => void): () => void {
  if (!isLocalMockRuntime()) {
    return () => {};
  }

  window.addEventListener(mockAuthChangedEvent, callback);
  return () => window.removeEventListener(mockAuthChangedEvent, callback);
}

export function requestLocalMockIdentityShare(): void {
  if (!isLocalMockRuntime()) {
    return;
  }

  mockLinked = true;
  window.dispatchEvent(new Event(mockAuthChangedEvent));
}

export async function mockGetQueue(): Promise<{ queue: QueueStateDto }> {
  return { queue: getQueueState() };
}

export async function mockJoinQueue(body: JoinQueueRequest): Promise<{ queue: QueueStateDto }> {
  const input = joinQueueRequestSchema.parse(body);
  const viewer = getQueueState().viewer;

  if (!viewer.userId) {
    throw new Error("Share Twitch identity before joining the waitlist.");
  }

  if (!signupsOpen && !viewer.canModerate) {
    throw new Error("The waitlist is currently closed.");
  }

  const existing = entries.find(
    (entry) => entry.twitchUserId === viewer.userId && entry.status !== "completed"
  );
  if (existing) {
    existing.role = input.role;
    existing.realm = input.realm;
    existing.characterName = input.characterName;
    existing.displayName = mockDisplayName;
    existing.status = "waiting";
    existing.updatedAt = now();
  } else {
    entries.push(
      createEntry(
        `mock-${Date.now()}`,
        viewer.userId,
        mockDisplayName,
        input.role,
        input.characterName,
        input.realm,
        "waiting",
        nextActivePosition()
      )
    );
  }

  touchQueue();
  return { queue: getQueueState() };
}

export async function mockLeaveQueue(): Promise<{ queue: QueueStateDto }> {
  const userId = getQueueState().viewer.userId;

  if (userId) {
    entries = entries.filter((entry) => entry.twitchUserId !== userId || entry.status === "completed");
    normalizeActivePositions();
    touchQueue();
  }

  return { queue: getQueueState() };
}

export async function mockUpdateEntryStatus(
  entryId: string,
  body: SetEntryStatusRequest
): Promise<{ queue: QueueStateDto }> {
  requireMockModerator();
  const input = setEntryStatusRequestSchema.parse(body);
  const entry = findEntry(entryId);
  entry.status = input.status;
  entry.updatedAt = now();
  normalizeActivePositions();
  touchQueue();
  return { queue: getQueueState() };
}

export async function mockMoveEntry(entryId: string, body: MoveEntryRequest): Promise<{ queue: QueueStateDto }> {
  requireMockModerator();
  const input = moveEntryRequestSchema.parse(body);
  const activeEntries = entries
    .filter((entry) => entry.status !== "completed")
    .sort((a, b) => a.position - b.position || a.joinedAt.localeCompare(b.joinedAt));
  const index = activeEntries.findIndex((entry) => entry.id === entryId);
  const swapIndex = input.direction === "up" ? index - 1 : index + 1;

  if (index >= 0 && swapIndex >= 0 && swapIndex < activeEntries.length) {
    const current = activeEntries[index]!;
    const target = activeEntries[swapIndex]!;
    const currentPosition = current.position;
    current.position = target.position;
    target.position = currentPosition;
    current.updatedAt = now();
    target.updatedAt = now();
  }

  normalizeActivePositions();
  touchQueue();
  return { queue: getQueueState() };
}

export async function mockRemoveEntry(entryId: string): Promise<{ queue: QueueStateDto }> {
  requireMockModerator();
  findEntry(entryId);
  entries = entries.filter((entry) => entry.id !== entryId);
  normalizeActivePositions();
  touchQueue();
  return { queue: getQueueState() };
}

export async function mockClearQueue(): Promise<{ queue: QueueStateDto }> {
  requireMockModerator();
  entries = [];
  touchQueue();
  return { queue: getQueueState() };
}

export async function mockUpdateQueueSettings(body: SetQueueSettingsRequest): Promise<{ queue: QueueStateDto }> {
  requireMockModerator();
  const input = setQueueSettingsRequestSchema.parse(body);
  signupsOpen = input.signupsOpen;
  touchQueue();
  return { queue: getQueueState() };
}

function getQueueState(): QueueStateDto {
  const role = getMockRole();
  const viewer: QueueStateDto["viewer"] = {
    opaqueUserId: mockOpaqueUserId,
    role,
    isLinked: mockLinked,
    canModerate: canModerateRole(role)
  };

  if (mockLinked) {
    viewer.userId = mockViewerUserId;
  }

  return {
    channelId: mockChannelId,
    signupsOpen,
    revision: String(mockRevision),
    viewer,
    entries: entries.map((entry) => ({
      ...entry,
      isCurrentViewer: mockLinked && entry.twitchUserId === mockViewerUserId && entry.status !== "completed"
    }))
  };
}

function createEntry(
  id: string,
  twitchUserId: string,
  displayName: string,
  role: QueueEntryDto["role"],
  characterName: string,
  realm: string,
  status: QueueEntryDto["status"],
  position: number,
  raiderIoScore?: number
): QueueEntryDto {
  const timestamp = now();

  const entry: QueueEntryDto = {
    id,
    twitchUserId,
    displayName,
    role,
    characterName,
    realm,
    status,
    position,
    joinedAt: timestamp,
    updatedAt: timestamp,
    isCurrentViewer: false
  };

  if (raiderIoScore !== undefined) {
    entry.raiderIo = {
      score: raiderIoScore,
      profileUrl: `https://raider.io/characters/us/${encodeURIComponent(realm.toLowerCase().replaceAll(" ", "-"))}/${encodeURIComponent(characterName)}`,
      lastCrawledAt: timestamp
    };
  }

  return entry;
}

function getMockRole(): ExtensionRole {
  const role = new URLSearchParams(window.location.search).get("mockRole");
  if (role === "viewer" || role === "moderator" || role === "broadcaster") {
    return role;
  }

  return "broadcaster";
}

function getMockTheme(): "light" | "dark" {
  return new URLSearchParams(window.location.search).get("mockTheme") === "light" ? "light" : "dark";
}

function getInitialLinkedState(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  return new URLSearchParams(window.location.search).get("mockLinked") !== "false";
}

function findEntry(entryId: string): QueueEntryDto {
  const entry = entries.find((nextEntry) => nextEntry.id === entryId);
  if (!entry) {
    throw new Error("Queue entry was not found.");
  }

  return entry;
}

function requireMockModerator(): void {
  if (!getQueueState().viewer.canModerate) {
    throw new Error("Only the broadcaster or moderators can manage the waitlist.");
  }
}

function nextActivePosition(): number {
  return entries
    .filter((entry) => entry.status !== "completed")
    .reduce((maxPosition, entry) => Math.max(maxPosition, entry.position), 0) + 1;
}

function normalizeActivePositions(): void {
  entries
    .filter((entry) => entry.status !== "completed")
    .sort((a, b) => a.position - b.position || a.joinedAt.localeCompare(b.joinedAt))
    .forEach((entry, index) => {
      entry.position = index + 1;
    });
}

function touchQueue(): void {
  mockRevision += 1;
}

function now(): string {
  return new Date().toISOString();
}

function isStandaloneBrowser(): boolean {
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}
