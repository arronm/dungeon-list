import {
  anyMythicPlusDungeon,
  canModerateRole,
  collaborationCodeRequestSchema,
  collaborationTargetPreviewRequestSchema,
  dungeonCatalogSchema,
  getCharacterIdentityKey,
  isDungeonInCatalog,
  joinQueueRequestSchema,
  moveEntryRequestSchema,
  offerKeyRequestSchema,
  setEntryStatusRequestSchema,
  setQueueSettingsRequestSchema,
  type ExtensionRole,
  type CollaborationCodeRequest,
  type CollaborationStateDto,
  type CollaborationTargetPreviewRequest,
  type JoinQueueRequest,
  type KeyOfferDto,
  type MoveEntryRequest,
  type OfferKeyRequest,
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
const localDungeonCatalog = dungeonCatalogSchema.parse({
  seasonId: "local-test-season",
  seasonName: "Local Test Season",
  dungeons: [
    { name: "Mock Terrace", shortName: "Terrace" },
    { name: "Mock Caverns", shortName: "Caverns" },
    { name: "Mock Academy", shortName: "Academy" },
    { name: "Mock Spire", shortName: "Spire" }
  ]
});

interface MockQueueEntry extends QueueEntryDto {
  ownerUserId: string;
}

interface MockKeyOffer extends KeyOfferDto {
  ownerUserId: string;
}

let mockLinked = getInitialLinkedState();
let mockRevision = 1;
let collaborationState: CollaborationStateDto = getInitialCollaborationState();
let signupsOpen = true;
let signupDefaults: NonNullable<QueueStateDto["viewer"]["signupDefaults"]> = {
  realm: "Maelstrom",
  characterName: "Taz"
};
let entries: MockQueueEntry[] = [
  createEntry("mock-1", "mock-tank", "Shieldstack", ["tank", "dps"], "Bulwark", "Area 52", "waiting", 1, 2847),
  createEntry("mock-2", "mock-healer", "Lightwell", ["healer"], "Sunmender", "Stormrage", "invited", 2, 2312),
  createEntry("mock-3", "mock-dps", "Burstwindow", ["healer", "dps"], "Critstorm", "Illidan", "waiting", 3, 0),
  createEntry("mock-4", "mock-done", "Keyholder", ["dps"], "Quickblade", "Sargeras", "completed", 4, 1975)
];
let offers: MockKeyOffer[] = [
  createOffer("offer-1", "mock-key-owner", "Keyrunner", ["tank", "dps"], "Wallbuilder", "Area 52", "offer", "Mock Spire", 10, 2610),
  createOffer("offer-2", "mock-key-owner", "Keyrunner", ["healer", "dps"], "Fastcast", "Area 52", "offer", "Mock Terrace", 10, 2395)
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
    mode: new URLSearchParams(window.location.search).get("view") === "live-config" ? "config" : "viewer"
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
  requireMockDungeon(input.dungeon, true);
  const viewer = getQueueState().viewer;

  if (!mockLinked) {
    throw new Error("Share Twitch identity before joining the waitlist.");
  }

  if (!signupsOpen && !viewer.canModerate) {
    throw new Error("The waitlist is currently closed.");
  }

  signupDefaults = {
    realm: input.realm,
    characterName: input.characterName
  };

  const existing = entries.find(
    (entry) => entry.ownerUserId === mockViewerUserId && entry.status !== "completed"
  );
  if (existing) {
    existing.role = input.roles[0]!;
    existing.roles = [...input.roles];
    existing.realm = input.realm;
    existing.characterName = input.characterName;
    existing.keyIntent = input.keyIntent;
    existing.dungeon = input.dungeon;
    existing.keyLevel = input.keyLevel;
    existing.displayName = mockDisplayName;
    existing.status = "waiting";
    existing.updatedAt = now();
  } else {
    const entry = createEntry(
      `mock-${Date.now()}`,
      mockViewerUserId,
      mockDisplayName,
      input.roles,
      input.characterName,
      input.realm,
      "waiting",
      nextActivePosition()
    );
    entry.keyIntent = input.keyIntent;
    entry.dungeon = input.dungeon;
    entry.keyLevel = input.keyLevel;
    entries.push(entry);
  }

  touchQueue();
  return { queue: getQueueState() };
}

export async function mockLeaveQueue(): Promise<{ queue: QueueStateDto }> {
  if (mockLinked) {
    entries = entries.filter(
      (entry) => entry.ownerUserId !== mockViewerUserId || entry.status === "completed"
    );
    normalizeActivePositions();
    touchQueue();
  }

  return { queue: getQueueState() };
}

export async function mockOfferKey(body: OfferKeyRequest): Promise<{ queue: QueueStateDto }> {
  const input = offerKeyRequestSchema.parse(body);
  requireMockDungeon(input.dungeon, false);
  const viewer = getQueueState().viewer;

  if (!mockLinked) {
    throw new Error("Share Twitch identity before offering a key.");
  }

  if (!signupsOpen && !viewer.canModerate) {
    throw new Error("Key submissions are currently closed.");
  }

  signupDefaults = {
    realm: input.realm,
    characterName: input.characterName
  };

  const characterKey = getCharacterIdentityKey(input);
  offers = offers.filter(
    (offer) =>
      offer.ownerUserId !== mockViewerUserId ||
      getCharacterIdentityKey(offer) !== characterKey
  );
  offers.unshift(
    createOffer(
      `offer-${Date.now()}`,
      mockViewerUserId,
      mockDisplayName,
      input.roles,
      input.characterName,
      input.realm,
      input.keyIntent,
      input.dungeon,
      input.keyLevel
    )
  );
  touchQueue();
  return { queue: getQueueState() };
}

export async function mockRemoveOffer(offerId: string, revision?: string): Promise<{ queue: QueueStateDto }> {
  requireMockRevision(revision);
  const viewer = getQueueState().viewer;
  const offer = offers.find((candidate) => candidate.id === offerId);
  if (!offer) {
    throw new Error("Key offer was not found.");
  }

  if (!viewer.canModerate && (!mockLinked || offer.ownerUserId !== mockViewerUserId)) {
    throw new Error("Only the offer owner or a queue manager can remove this key.");
  }

  offers = offers.filter((candidate) => candidate.id !== offerId);
  touchQueue();
  return { queue: getQueueState() };
}

export async function mockUpdateEntryStatus(
  entryId: string,
  body: SetEntryStatusRequest,
  revision?: string
): Promise<{ queue: QueueStateDto }> {
  requireMockRevision(revision);
  requireMockModerator();
  const input = setEntryStatusRequestSchema.parse(body);
  const entry = findEntry(entryId);
  entry.status = input.status;
  entry.updatedAt = now();
  normalizeActivePositions();
  touchQueue();
  return { queue: getQueueState() };
}

export async function mockMoveEntry(entryId: string, body: MoveEntryRequest, revision?: string): Promise<{ queue: QueueStateDto }> {
  requireMockRevision(revision);
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

export async function mockRemoveEntry(entryId: string, revision?: string): Promise<{ queue: QueueStateDto }> {
  requireMockRevision(revision);
  requireMockModerator();
  findEntry(entryId);
  entries = entries.filter((entry) => entry.id !== entryId);
  normalizeActivePositions();
  touchQueue();
  return { queue: getQueueState() };
}

export async function mockClearQueue(revision?: string): Promise<{ queue: QueueStateDto }> {
  requireMockRevision(revision);
  requireMockModerator();
  entries = [];
  touchQueue();
  return { queue: getQueueState() };
}

export async function mockUpdateQueueSettings(body: SetQueueSettingsRequest, revision?: string): Promise<{ queue: QueueStateDto }> {
  requireMockRevision(revision);
  requireMockModerator();
  const input = setQueueSettingsRequestSchema.parse(body);
  signupsOpen = input.signupsOpen;
  touchQueue();
  return { queue: getQueueState() };
}

export async function mockGetCollaboration(): Promise<{ collaboration: CollaborationStateDto }> {
  return { collaboration: collaborationState };
}

export async function mockPreviewCollaborationTarget(
  body: CollaborationTargetPreviewRequest
): Promise<{ target: { displayName: string } }> {
  const input = collaborationTargetPreviewRequestSchema.parse(body);
  if (input.login.toLowerCase() === "missing") throw new Error("Twitch could not find that broadcaster.");
  return { target: { displayName: formatMockDisplayName(input.login) } };
}

export async function mockCreateCollaborationInvite(
  body: CollaborationTargetPreviewRequest
): Promise<{ collaboration: CollaborationStateDto }> {
  const input = collaborationTargetPreviewRequestSchema.parse(body);
  collaborationState = {
    state: "pending-host-invite",
    collaboratorDisplayName: formatMockDisplayName(input.login),
    code: "HOST42",
    expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString()
  };
  return { collaboration: collaborationState };
}

export async function mockRevokeCollaborationInvite(): Promise<{ collaboration: CollaborationStateDto }> {
  collaborationState = { state: "standalone" };
  return { collaboration: collaborationState };
}

export async function mockPreviewCollaborationInvite(
  body: CollaborationCodeRequest
): Promise<{ invite: { hostDisplayName: string } }> {
  const input = collaborationCodeRequestSchema.parse(body);
  if (input.code.toUpperCase() !== "HOST42") throw new Error("The collaboration code is invalid or expired.");
  return { invite: { hostDisplayName: "DungeonHost" } };
}

export async function mockJoinCollaboration(
  body: CollaborationCodeRequest
): Promise<{ collaboration: CollaborationStateDto }> {
  await mockPreviewCollaborationInvite(body);
  collaborationState = {
    state: "active",
    role: "collaborator",
    hostDisplayName: "DungeonHost",
    collaboratorDisplayName: "Local Tester"
  };
  touchQueue();
  return { collaboration: collaborationState };
}

export async function mockLeaveCollaboration(): Promise<{ collaboration: CollaborationStateDto }> {
  if (collaborationState.state !== "active" || collaborationState.role !== "collaborator") {
    throw new Error("Only the collaborator can leave this shared queue.");
  }
  collaborationState = { state: "standalone" };
  touchQueue();
  return { collaboration: collaborationState };
}

export async function mockEndCollaboration(): Promise<{ collaboration: CollaborationStateDto }> {
  if (collaborationState.state !== "active" || collaborationState.role !== "host") {
    throw new Error("Only the host can end this shared queue.");
  }
  collaborationState = { state: "standalone" };
  touchQueue();
  return { collaboration: collaborationState };
}

function getQueueState(): QueueStateDto {
  const role = getMockRole();
  const activeCollaboration = collaborationState.state === "active" ? collaborationState : undefined;
  const canModerate = canModerateRole(role);
  const viewer: QueueStateDto["viewer"] = {
    role,
    isLinked: mockLinked,
    canModerate,
    permissions: {
      moderateEntries: canModerate,
      manageSettings: activeCollaboration ? role === "broadcaster" : canModerate,
      clearQueue: activeCollaboration
        ? role === "broadcaster" && activeCollaboration.role === "host"
        : canModerate
    }
  };

  if (mockLinked) {
    viewer.signupDefaults = { ...signupDefaults };
  }

  return {
    channelId: mockChannelId,
    signupsOpen,
    revision: String(mockRevision),
    collaboration: activeCollaboration ? {
      role: activeCollaboration.role,
      hostDisplayName: activeCollaboration.hostDisplayName,
      collaboratorDisplayName: activeCollaboration.collaboratorDisplayName
    } : null,
    dungeonCatalog: localDungeonCatalog,
    viewer,
    entries: entries.map(({ ownerUserId, ...entry }, index) => ({
      ...entry,
      sourceRole: activeCollaboration ? (index % 2 ? "collaborator" as const : "host" as const) : null,
      isCurrentViewer: mockLinked && ownerUserId === mockViewerUserId && entry.status !== "completed"
    })),
    offers: offers.map(({ ownerUserId, ...offer }, index) => ({
      ...offer,
      sourceRole: activeCollaboration ? (index % 2 ? "collaborator" as const : "host" as const) : null,
      isCurrentViewer: mockLinked && ownerUserId === mockViewerUserId
    }))
  };
}

function requireMockDungeon(dungeon: string, allowAny: boolean): void {
  if (!isDungeonInCatalog(dungeon, localDungeonCatalog, allowAny)) {
    throw new Error("Select a dungeon from the local test catalog.");
  }
}

function createEntry(
  id: string,
  ownerUserId: string,
  displayName: string,
  roles: QueueEntryDto["roles"],
  characterName: string,
  realm: string,
  status: QueueEntryDto["status"],
  position: number,
  raiderIoScore?: number
): MockQueueEntry {
  const timestamp = now();

  const entry: MockQueueEntry = {
    id,
    ownerUserId,
    displayName,
    role: roles[0]!,
    roles,
    characterName,
    realm,
    keyIntent: "need",
    dungeon: anyMythicPlusDungeon,
    keyLevel: 10,
    status,
    position,
    joinedAt: timestamp,
    updatedAt: timestamp,
    isCurrentViewer: false,
    sourceRole: null
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

function createOffer(
  id: string,
  ownerUserId: string,
  displayName: string,
  roles: KeyOfferDto["roles"],
  characterName: string,
  realm: string,
  keyIntent: "offer",
  dungeon: string,
  keyLevel: number,
  raiderIoScore?: number
): MockKeyOffer {
  const timestamp = now();
  const offer: MockKeyOffer = {
    id,
    ownerUserId,
    displayName,
    role: roles[0]!,
    roles,
    characterName,
    realm,
    keyIntent,
    dungeon,
    keyLevel,
    createdAt: timestamp,
    updatedAt: timestamp,
    isCurrentViewer: false,
    sourceRole: null
  };

  if (raiderIoScore !== undefined) {
    offer.raiderIo = {
      score: raiderIoScore,
      profileUrl: `https://raider.io/characters/us/${encodeURIComponent(realm.toLowerCase().replaceAll(" ", "-"))}/${encodeURIComponent(characterName)}`,
      lastCrawledAt: timestamp
    };
  }

  return offer;
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

function getInitialCollaborationState(): CollaborationStateDto {
  if (typeof window === "undefined") return { state: "standalone" };
  const state = new URLSearchParams(window.location.search).get("mockCollaboration");
  if (state === "host" || state === "collaborator") {
    return {
      state: "active",
      role: state,
      hostDisplayName: "DungeonHost",
      collaboratorDisplayName: "PartyPartner"
    };
  }
  if (state === "pending") {
    return {
      state: "pending-host-invite",
      collaboratorDisplayName: "PartyPartner",
      code: "HOST42",
      expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString()
    };
  }
  return { state: "standalone" };
}

function requireMockRevision(revision: string | undefined): void {
  if (collaborationState.state === "active" && revision !== String(mockRevision)) {
    const error = new Error("The shared queue changed. Refresh and try again.") as Error & { code: string };
    error.code = "stale_queue_revision";
    throw error;
  }
}

function formatMockDisplayName(login: string): string {
  return login.slice(0, 1).toUpperCase() + login.slice(1);
}

function findEntry(entryId: string): MockQueueEntry {
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
