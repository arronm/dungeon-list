import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  Trash2,
  Unlock
} from "lucide-react";
import {
  anyMythicPlusDungeon,
  type DungeonOptionDto,
  type QueueEntryDto,
  type QueueEntryStatus,
  type JoinQueueRequest,
  type KeyIntent,
  type KeyRequestDungeon,
  type KeyOfferDto,
  type NorthAmericanRealm,
  type OfferKeyRequest,
  type QueueRole,
  type QueueStateDto,
  getMythicPlusDungeonShortName,
  northAmericanRealms,
  queueRoles
} from "@dungeon-list/shared";
import {
  ApiClientError,
  clearOffers,
  clearQueue,
  getQueue,
  joinQueue,
  leaveQueue,
  moveEntry,
  offerKey,
  removeEntry,
  removeOffer,
  updateEntryStatus,
  updateQueueSettings
} from "./api.js";
import { formatInviteCommand } from "./invite.js";
import {
  getAvailableKeyOffers,
  getKeyAvailability,
  type KeyAvailability,
  isMatchableKeyRequest
} from "./keyMatching.js";
import { requestIdentityShare, useTwitchAuth } from "./twitch.js";
import { isQueueEventForChannel } from "./queueEvents.js";
import { CollaborationPanel } from "./CollaborationPanel.js";
import { copyToClipboard } from "./clipboard.js";

const roleLabels: Record<QueueRole, string> = {
  tank: "Tank",
  healer: "Healer",
  dps: "DPS"
};

const statusLabels: Record<QueueEntryStatus, string> = {
  waiting: "Waiting",
  invited: "Invited",
  skipped: "Skipped",
  completed: "Done"
};

const statusOrder: Record<QueueEntryStatus, number> = {
  invited: 0,
  waiting: 1,
  skipped: 2,
  completed: 3
};

const keyAvailabilityLabels: Record<KeyAvailability, string> = {
  exact: "Exact-level key available",
  higher: "Higher-level key available",
  none: "No matching key available"
};

const queuePollIntervalMs = 15_000;
const noDungeonOptions: readonly DungeonOptionDto[] = [];

export function App({ showCollaborationPanel = false }: { showCollaborationPanel?: boolean } = {}) {
  const twitch = useTwitchAuth();
  const token = twitch.authorization?.token;
  const helixToken = twitch.authorization?.helixToken;
  const [queue, setQueue] = useState<QueueStateDto | undefined>();
  const [roles, setRoles] = useState<QueueRole[]>(["dps"]);
  const [realm, setRealm] = useState<NorthAmericanRealm | "">("");
  const [characterName, setCharacterName] = useState("");
  const [signupStep, setSignupStep] = useState<"character" | "key">("character");
  const [keyIntent, setKeyIntent] = useState<KeyIntent>("need");
  const [dungeon, setDungeon] = useState<KeyRequestDungeon | "">(anyMythicPlusDungeon);
  const [keyLevel, setKeyLevel] = useState("10");
  const [listView, setListView] = useState<"queue" | "offers">("queue");
  const [selectedEntryId, setSelectedEntryId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busyAction, setBusyAction] = useState<string | undefined>();
  const [copiedEntryId, setCopiedEntryId] = useState<string | undefined>();
  const queueRequestGeneration = useRef(0);
  const copyResetTimer = useRef<number | undefined>();
  const hydratedDefaultsForChannel = useRef<string | undefined>();

  const sortedEntries = useMemo(() => {
    return [...(queue?.entries ?? [])].sort((a, b) => {
      const statusDelta = statusOrder[a.status] - statusOrder[b.status];
      return statusDelta || a.position - b.position || a.joinedAt.localeCompare(b.joinedAt);
    });
  }, [queue?.entries]);

  const activeEntries = sortedEntries.filter((entry) => entry.status !== "completed");
  const completedEntries = [...(queue?.entries ?? [])]
    .filter((entry) => entry.status === "completed")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);
  const currentEntry = queue?.entries.find((entry) => entry.isCurrentViewer);
  const selectedEntry = queue?.entries.find(
    (entry) => entry.id === selectedEntryId && isMatchableKeyRequest(entry)
  );
  const selectedEntryIndex = selectedEntry
    ? activeEntries.findIndex((entry) => entry.id === selectedEntry.id)
    : -1;
  const availableOffers = useMemo(
    () => selectedEntry ? getAvailableKeyOffers(selectedEntry, queue?.offers ?? []) : [],
    [queue?.offers, selectedEntry]
  );
  const dungeonOptions = queue?.dungeonCatalog?.dungeons ?? noDungeonOptions;
  const hasCharacterDetails = Boolean(realm && characterName.trim().length >= 2);
  const normalizedKeyLevel = Number(keyLevel);
  const specificDungeon = dungeonOptions.find((candidate) => candidate.name === dungeon)?.name;
  const hasKeyDetails = Boolean(
    (keyIntent === "need" ? dungeon === anyMythicPlusDungeon || specificDungeon : specificDungeon) &&
      Number.isInteger(normalizedKeyLevel) &&
      normalizedKeyLevel >= 2 &&
      normalizedKeyLevel <= 99
  );
  const canUseIntent = keyIntent === "offer" || !currentEntry;
  const canContinue = Boolean(
    queue?.viewer.isLinked &&
      queue.signupsOpen &&
      canUseIntent &&
      roles.length &&
      hasCharacterDetails
  );
  const canJoin = canContinue && hasKeyDetails;

  const applyActionQueue = useCallback((nextQueue: QueueStateDto) => {
    queueRequestGeneration.current += 1;
    setQueue(nextQueue);
  }, []);

  const refreshQueue = useCallback(async () => {
    if (!token || !helixToken) {
      return;
    }

    setError(undefined);
    const requestGeneration = ++queueRequestGeneration.current;
    const response = await getQueue(token, helixToken);
    if (requestGeneration === queueRequestGeneration.current) {
      setQueue(response.queue);
    }
  }, [helixToken, token]);

  useEffect(() => {
    refreshQueue().catch((cause) => setError(errorMessage(cause)));
  }, [refreshQueue]);

  useEffect(() => {
    if (!token || !helixToken) {
      return;
    }

    let pollInFlight = false;
    const pollQueue = () => {
      if (pollInFlight) {
        return;
      }

      pollInFlight = true;
      refreshQueue()
        .catch((cause) => setError(errorMessage(cause)))
        .finally(() => {
          pollInFlight = false;
        });
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        pollQueue();
      }
    };

    const intervalId = window.setInterval(pollQueue, queuePollIntervalMs);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", pollQueue);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", pollQueue);
    };
  }, [helixToken, refreshQueue, token]);

  useEffect(() => {
    if (!token || !window.Twitch?.ext) {
      return;
    }

    const listener = (_target: string, _contentType: string, message: string) => {
      if (isQueueEventForChannel(message, twitch.authorization?.channelId)) {
        refreshQueue().catch((cause) => setError(errorMessage(cause)));
      }
    };

    window.Twitch.ext.listen("broadcast", listener);
    return () => window.Twitch?.ext.unlisten("broadcast", listener);
  }, [refreshQueue, token, twitch.authorization?.channelId]);

  useEffect(() => {
    document.documentElement.dataset.theme = twitch.context.theme ?? "dark";
  }, [twitch.context.theme]);

  useEffect(() => {
    if (
      dungeon &&
      dungeon !== anyMythicPlusDungeon &&
      !dungeonOptions.some((candidate) => candidate.name === dungeon)
    ) {
      setDungeon(keyIntent === "need" ? anyMythicPlusDungeon : "");
    }
  }, [dungeon, dungeonOptions, keyIntent]);

  useEffect(() => {
    const defaults = queue?.viewer.signupDefaults;
    if (!queue || !defaults) {
      return;
    }

    if (hydratedDefaultsForChannel.current === queue.channelId) {
      return;
    }

    if (isNorthAmericanRealm(defaults.realm)) {
      setRealm(defaults.realm);
    }
    setCharacterName(defaults.characterName);
    hydratedDefaultsForChannel.current = queue.channelId;
  }, [queue?.channelId, queue?.viewer.signupDefaults]);

  useEffect(() => {
    if (currentEntry) {
      setSignupStep("character");
    }
  }, [currentEntry?.id]);

  useEffect(() => {
    return () => {
      if (copyResetTimer.current !== undefined) {
        window.clearTimeout(copyResetTimer.current);
      }
    };
  }, []);

  async function runAction(action: string, callback: () => Promise<void>) {
    setBusyAction(action);
    setError(undefined);
    try {
      await callback();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyAction(undefined);
    }
  }

  function submitSignup() {
    const normalizedCharacterName = characterName.trim();
    if (
      !token ||
      !helixToken ||
      !realm ||
      !dungeon ||
      (keyIntent === "offer" && !specificDungeon) ||
      normalizedCharacterName.length < 2 ||
      !hasKeyDetails
    ) {
      return;
    }

    void runAction(keyIntent === "need" ? "join" : "offer", async () => {
      const details = {
        roles,
        realm,
        characterName: normalizedCharacterName,
        keyLevel: normalizedKeyLevel
      };

      const response =
        keyIntent === "need"
          ? await joinQueue(
              token,
              helixToken,
              { ...details, keyIntent: "need", dungeon } satisfies JoinQueueRequest
            )
          : await offerKey(
              token,
              helixToken,
              { ...details, keyIntent: "offer", dungeon: specificDungeon! } satisfies OfferKeyRequest
            );
      applyActionQueue(response.queue);

      if (keyIntent === "offer") {
        setSignupStep("character");
        setDungeon("");
        setKeyLevel("10");
      } else {
        setListView("queue");
      }
    });
  }

  function selectListView(view: "queue" | "offers") {
    setListView(view);
  }

  function selectKeyIntent(intent: KeyIntent) {
    setKeyIntent(intent);
    if (intent === "offer" && dungeon === anyMythicPlusDungeon) {
      setDungeon("");
    } else if (intent === "need" && !dungeon) {
      setDungeon(anyMythicPlusDungeon);
    }
    if (!keyLevel) {
      setKeyLevel("10");
    }
  }

  function toggleRole(nextRole: QueueRole) {
    setRoles((currentRoles) => {
      const selectedRoles = new Set(currentRoles);
      if (selectedRoles.has(nextRole)) {
        selectedRoles.delete(nextRole);
      } else {
        selectedRoles.add(nextRole);
      }
      return queueRoles.filter((candidate) => selectedRoles.has(candidate));
    });
  }

  function submitLeave() {
    if (!token) {
      return;
    }

    void runAction("leave", async () => {
      const response = await leaveQueue(token);
      applyActionQueue(response.queue);
    });
  }

  function submitModeration(action: string, callback: () => Promise<{ queue: QueueStateDto }>) {
    void runAction(action, async () => {
      try {
        const response = await callback();
        applyActionQueue(response.queue);
      } catch (cause) {
        if (getErrorCode(cause) === "stale_queue_revision") {
          await refreshQueue();
          return;
        }
        throw cause;
      }
    });
  }

  function copyInvite(entry: Pick<QueueEntryDto, "id" | "characterName" | "realm">) {
    if (!entry.characterName || !entry.realm) {
      return;
    }

    const command = formatInviteCommand(entry.characterName, entry.realm);
    setError(undefined);
    void copyToClipboard(command)
      .then(() => {
        setCopiedEntryId(entry.id);
        if (copyResetTimer.current !== undefined) {
          window.clearTimeout(copyResetTimer.current);
        }
        copyResetTimer.current = window.setTimeout(() => setCopiedEntryId(undefined), 2_000);
      })
      .catch(() => setError("The invite command could not be copied."));
  }

  if (!twitch.isAvailable) {
    return (
      <main className="shell centered">
        <p className="muted">Open this UI from the Twitch Extension test view.</p>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="shell centered">
        <Loader2 className="spin" size={22} />
        <p className="muted">Waiting for Twitch authorization.</p>
      </main>
    );
  }

  if (queue && queue.viewer.canModerate && selectedEntry) {
    return (
      <main className="shell">
        <header className="detail-topbar">
          <button
            className="icon-button"
            type="button"
            title="Back to queue"
            aria-label="Back to queue"
            onClick={() => setSelectedEntryId(undefined)}
          >
            <ArrowLeft size={17} />
          </button>
          <div>
            <h1>{getViewerLabel(selectedEntry)}</h1>
            <p>{formatKeyNeed(selectedEntry, dungeonOptions)}</p>
          </div>
          <button
            className="icon-button refresh-button"
            type="button"
            title="Refresh queue"
            disabled={busyAction === "refresh"}
            onClick={() => void runAction("refresh", refreshQueue)}
          >
            <RefreshCw className={busyAction === "refresh" ? "spin" : undefined} size={17} />
          </button>
        </header>

        {error ? <div className="notice error">{error}</div> : null}

        <section className="entry detail-entry" aria-label="Selected viewer">
          <EntrySummary entry={selectedEntry} showRaiderIo dungeons={dungeonOptions} />
          <EntryActions
            entry={selectedEntry}
            canMoveUp={selectedEntryIndex > 0}
            canMoveDown={selectedEntryIndex >= 0 && selectedEntryIndex < activeEntries.length - 1}
            busyAction={busyAction}
            copiedEntryId={copiedEntryId}
            onCopy={copyInvite}
            onStatus={(entryId, status) =>
              submitModeration(`status:${entryId}:${status}`, () =>
                updateEntryStatus(token, entryId, { status }, queue.revision)
              )
            }
            onMove={(entryId, direction) =>
              submitModeration(`move:${entryId}:${direction}`, () =>
                moveEntry(token, entryId, { direction }, queue.revision)
              )
            }
            onRemove={(entryId) =>
              submitModeration(`remove:${entryId}`, () => removeEntry(token, entryId, queue.revision))
            }
          />
        </section>

        <div className="detail-section-heading">
          <h2>Matching and higher keys</h2>
          <span>{availableOffers.length}</span>
        </div>
        <OfferList
          offers={availableOffers}
          canModerate
          busyAction={busyAction}
          copiedEntryId={copiedEntryId}
          dungeons={dungeonOptions}
          emptyMessage={formatNoAvailableKeys(selectedEntry, dungeonOptions)}
          onCopy={copyInvite}
          onRemove={(offerId) =>
            submitModeration(`remove-offer:${offerId}`, () => removeOffer(token, offerId, queue.revision))
          }
        />
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Dungeon List</h1>
          <p>{queue?.signupsOpen ? "Signups open" : "Signups closed"}</p>
        </div>
        <div className="top-actions">
          {queue?.viewer.permissions.manageSettings ? (
            <button
              className="icon-button"
              type="button"
              title={queue.signupsOpen ? "Close signups" : "Open signups"}
              disabled={Boolean(busyAction)}
              onClick={() =>
                submitModeration("settings", () =>
                  updateQueueSettings(token, { signupsOpen: !queue.signupsOpen }, queue.revision)
                )
              }
            >
              {queue.signupsOpen ? <Unlock size={17} /> : <Lock size={17} />}
            </button>
          ) : null}
          <button
            className="icon-button refresh-button"
            type="button"
            title="Refresh queue"
            disabled={busyAction === "refresh"}
            onClick={() => void runAction("refresh", refreshQueue)}
          >
            <RefreshCw className={busyAction === "refresh" ? "spin" : undefined} size={17} />
          </button>
        </div>
      </header>

      {showCollaborationPanel && helixToken && queue?.viewer.role === "broadcaster" ? (
        <CollaborationPanel
          token={token}
          helixToken={helixToken}
          queueRevision={queue.revision}
          onQueueIdentityChanged={refreshQueue}
        />
      ) : null}

      {error ? <div className="notice error">{error}</div> : null}

      {queue?.collaboration ? (
        <section className="shared-banner">
          <strong>Shared queue: {queue.collaboration.hostDisplayName} + {queue.collaboration.collaboratorDisplayName}</strong>
          <p>Both streamers can manage submissions. If the collaboration ends, submissions return to their source channel.</p>
        </section>
      ) : null}

      {queue && !queue.viewer.isLinked ? (
        <section className="identity-panel">
          <ShieldCheck size={22} />
          <div>
            <strong>Share identity to join</strong>
            <p>Twitch requires this before the waitlist can track your spot.</p>
          </div>
          <button type="button" onClick={requestIdentityShare}>
            <LogIn size={16} />
            Share
          </button>
        </section>
      ) : null}

      <section className="signup">
        {currentEntry ? (
          <button
            className="danger"
            type="button"
            aria-label="Leave queue"
            disabled={busyAction === "leave"}
            onClick={submitLeave}
          >
            <LogOut size={16} />
            <span className="leave-label-full">Leave queue</span>
            <span className="leave-label-compact" aria-hidden="true">
              Leave
            </span>
          </button>
        ) : (
          signupStep === "character" ? (
            <>
              <div className="role-group" role="group" aria-label="Dungeon roles">
                {queueRoles.map((nextRole) => (
                  <label
                    key={nextRole}
                    className={`role-checkbox ${roles.includes(nextRole) ? "selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={roles.includes(nextRole)}
                      onChange={() => toggleRole(nextRole)}
                    />
                    {roleLabels[nextRole]}
                  </label>
                ))}
              </div>
              <div className="character-fields">
                <label>
                  <span>Server</span>
                  <select
                    value={realm}
                    required
                    onChange={(event) => setRealm(event.target.value as NorthAmericanRealm | "")}
                  >
                    <option value="">Select server</option>
                    {northAmericanRealms.map((nextRealm) => (
                      <option key={nextRealm} value={nextRealm}>
                        {nextRealm}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Character</span>
                  <input
                    type="text"
                    value={characterName}
                    minLength={2}
                    maxLength={12}
                    placeholder="Character name"
                    autoComplete="off"
                    required
                    onChange={(event) => setCharacterName(event.target.value)}
                  />
                </label>
              </div>
              <button type="button" disabled={!canContinue} onClick={() => setSignupStep("key")}>
                Next
                <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <>
              <div className="role-group key-intent-group" aria-label="Key preference">
                {(["need", "offer"] as KeyIntent[]).map((nextIntent) => (
                  <button
                    key={nextIntent}
                    type="button"
                    className={keyIntent === nextIntent ? "selected" : undefined}
                    onClick={() => selectKeyIntent(nextIntent)}
                  >
                    {nextIntent === "need" ? "Need Key" : "Offer Key"}
                  </button>
                ))}
              </div>
              <div className="key-fields">
                <label>
                  <span>Dungeon</span>
                  <select
                    value={dungeon}
                    required
                    onChange={(event) => setDungeon(event.target.value as KeyRequestDungeon | "")}
                  >
                    {keyIntent === "need" ? (
                      <option value={anyMythicPlusDungeon}>{anyMythicPlusDungeon}</option>
                    ) : (
                      <option value="">Select dungeon</option>
                    )}
                    {dungeonOptions.map((nextDungeon) => (
                      <option key={nextDungeon.name} value={nextDungeon.name}>
                        {nextDungeon.shortName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Level</span>
                  <input
                    type="number"
                    value={keyLevel}
                    min={2}
                    max={99}
                    step={1}
                    inputMode="numeric"
                    placeholder="10"
                    required
                    onChange={(event) => setKeyLevel(event.target.value)}
                  />
                </label>
              </div>
              <div className="signup-actions">
                <button className="secondary-action" type="button" onClick={() => setSignupStep("character")}>
                  <ArrowLeft size={16} />
                  Back
                </button>
                <button
                  type="button"
                  disabled={!canJoin || busyAction === "join" || busyAction === "offer"}
                  onClick={submitSignup}
                >
                  {keyIntent === "need" ? <LogIn size={16} /> : <KeyRound size={16} />}
                  {keyIntent === "need" ? "Join queue" : "Offer key"}
                </button>
              </div>
            </>
          )
        )}
      </section>

      {currentEntry ? (
        <section className="my-spot">
          <span>Position {currentEntry.position}</span>
          <strong>{statusLabels[currentEntry.status]}</strong>
        </section>
      ) : null}

      {queue?.viewer.canModerate ? (
        <nav className="view-tabs" aria-label="Key lists">
          <button
            type="button"
            className={listView === "queue" ? "selected" : undefined}
            onClick={() => selectListView("queue")}
          >
            Need Keys
          </button>
          <button
            type="button"
            className={listView === "offers" ? "selected" : undefined}
            onClick={() => selectListView("offers")}
          >
            Available Keys
          </button>
        </nav>
      ) : null}

      {!queue?.viewer.canModerate || listView === "queue" ? (
        <>
          <QueueList
            entries={activeEntries}
            offers={queue?.offers ?? []}
            canModerate={Boolean(queue?.viewer.canModerate)}
            busyAction={busyAction}
            copiedEntryId={copiedEntryId}
            dungeons={dungeonOptions}
            onSelect={queue?.viewer.canModerate ? (entry) => setSelectedEntryId(entry.id) : undefined}
            onCopy={copyInvite}
            onStatus={(entryId, status) =>
              submitModeration(`status:${entryId}:${status}`, () =>
                updateEntryStatus(token, entryId, { status }, queue?.revision)
              )
            }
            onMove={(entryId, direction) =>
              submitModeration(`move:${entryId}:${direction}`, () => moveEntry(token, entryId, { direction }, queue?.revision))
            }
            onRemove={(entryId) => submitModeration(`remove:${entryId}`, () => removeEntry(token, entryId, queue?.revision))}
          />

          {completedEntries.length ? (
            <section className="completed-list">
              <h2>Completed</h2>
              {completedEntries.map((entry) => (
                <EntrySummary
                  key={entry.id}
                  entry={entry}
                  showRaiderIo={Boolean(queue?.viewer.canModerate)}
                  dungeons={dungeonOptions}
                />
              ))}
            </section>
          ) : null}

          {queue?.viewer.permissions.clearQueue && queue.entries.length ? (
            <button
              className="clear-button"
              type="button"
              disabled={busyAction === "clear"}
              onClick={() => submitModeration("clear", () => clearQueue(token, queue.revision))}
            >
              <Trash2 size={16} />
              Clear queue
            </button>
          ) : null}
        </>
      ) : (
        <>
          <OfferList
            offers={queue?.offers ?? []}
            canModerate={Boolean(queue?.viewer.canModerate)}
            busyAction={busyAction}
            copiedEntryId={copiedEntryId}
            dungeons={dungeonOptions}
            onCopy={copyInvite}
            onRemove={(offerId) =>
              submitModeration(`remove-offer:${offerId}`, () => removeOffer(token, offerId, queue?.revision))
            }
          />

          {queue?.viewer.permissions.clearQueue && queue.offers.length ? (
            <button
              className="clear-button"
              type="button"
              disabled={busyAction === "clear-offers"}
              onClick={() => submitModeration("clear-offers", () => clearOffers(token, queue.revision))}
            >
              <Trash2 size={16} />
              Clear available keys
            </button>
          ) : null}
        </>
      )}
    </main>
  );
}

interface QueueListProps {
  entries: QueueEntryDto[];
  offers: KeyOfferDto[];
  dungeons: readonly DungeonOptionDto[];
  canModerate: boolean;
  busyAction: string | undefined;
  copiedEntryId: string | undefined;
  onSelect: ((entry: QueueEntryDto) => void) | undefined;
  onCopy(entry: QueueEntryDto): void;
  onStatus(entryId: string, status: QueueEntryStatus): void;
  onMove(entryId: string, direction: "up" | "down"): void;
  onRemove(entryId: string): void;
}

function QueueList({
  entries,
  offers,
  dungeons,
  canModerate,
  busyAction,
  copiedEntryId,
  onSelect,
  onCopy,
  onStatus,
  onMove,
  onRemove
}: QueueListProps) {
  if (!entries.length) {
    return <p className="empty">No one is waiting yet.</p>;
  }

  return (
    <section className="queue-list" aria-label="Dungeon waitlist">
      {entries.map((entry, index) => (
        <article key={entry.id} className={entry.isCurrentViewer ? "entry mine" : "entry"}>
          <EntrySummary
            entry={entry}
            showRaiderIo={canModerate}
            dungeons={dungeons}
            keyAvailability={getKeyAvailability(entry, offers)}
            onSelect={
              onSelect && isMatchableKeyRequest(entry)
                ? () => onSelect(entry)
                : undefined
            }
          />
          {canModerate ? (
            <EntryActions
              entry={entry}
              mode="queue"
              canMoveUp={index > 0}
              canMoveDown={index < entries.length - 1}
              busyAction={busyAction}
              copiedEntryId={copiedEntryId}
              onCopy={onCopy}
              onStatus={onStatus}
              onMove={onMove}
              onRemove={onRemove}
            />
          ) : null}
        </article>
      ))}
    </section>
  );
}

interface OfferListProps {
  offers: KeyOfferDto[];
  dungeons: readonly DungeonOptionDto[];
  canModerate: boolean;
  busyAction: string | undefined;
  copiedEntryId: string | undefined;
  emptyMessage?: string;
  onCopy(offer: KeyOfferDto): void;
  onRemove(offerId: string): void;
}

function OfferList({
  offers,
  dungeons,
  canModerate,
  busyAction,
  copiedEntryId,
  emptyMessage = "No keys are available yet.",
  onCopy,
  onRemove
}: OfferListProps) {
  if (!offers.length) {
    return <p className="empty">{emptyMessage}</p>;
  }

  return (
    <section className="queue-list" aria-label="Available dungeon keys">
      {offers.map((offer) => {
        const label = offer.displayName ?? "Unknown viewer";
        const dungeonLabel = getMythicPlusDungeonShortName(offer.dungeon, dungeons);
        const canRemove = canModerate || offer.isCurrentViewer;

        return (
          <article key={offer.id} className={offer.isCurrentViewer ? "entry mine" : "entry"}>
            <div className="entry-main">
              <span className="position">{offer.keyLevel === null ? "?" : `+${offer.keyLevel}`}</span>
              <div className="entry-copy">
                <div className="entry-line">
                  <strong title={label}>{label}</strong>
                  <RoleBadges entry={offer} />
                  {canModerate ? <SourceBadge sourceRole={offer.sourceRole} /> : null}
                </div>
                <div className="character-line">
                  <p title={`${offer.characterName}${offer.realm ? ` - ${offer.realm}` : ""}`}>
                    {offer.characterName || "Unknown character"}
                    {offer.realm ? ` - ${offer.realm}` : null}
                  </p>
                  {canModerate && offer.raiderIo !== undefined ? <RaiderIoScore entry={offer} /> : null}
                </div>
                <p title={offer.dungeon}>Offers {dungeonLabel}</p>
              </div>
            </div>
            {canModerate || canRemove ? (
              <div className="offer-actions">
                {canModerate ? (
                  <button
                    type="button"
                    className={copiedEntryId === offer.id ? "copied" : undefined}
                    title={`Copy ${formatInviteCommand(offer.characterName, offer.realm)}`}
                    disabled={!offer.characterName || !offer.realm}
                    onClick={() => onCopy(offer)}
                  >
                    {copiedEntryId === offer.id ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                ) : null}
                {canRemove ? (
                  <button
                    type="button"
                    title="Remove key offer"
                    disabled={Boolean(busyAction)}
                    onClick={() => onRemove(offer.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

interface EntryActionsProps {
  entry: QueueEntryDto;
  mode?: "full" | "queue";
  canMoveUp: boolean;
  canMoveDown: boolean;
  busyAction: string | undefined;
  copiedEntryId: string | undefined;
  onCopy(entry: QueueEntryDto): void;
  onStatus(entryId: string, status: QueueEntryStatus): void;
  onMove(entryId: string, direction: "up" | "down"): void;
  onRemove(entryId: string): void;
}

function EntryActions({
  entry,
  mode = "full",
  canMoveUp,
  canMoveDown,
  busyAction,
  copiedEntryId,
  onCopy,
  onStatus,
  onMove,
  onRemove
}: EntryActionsProps) {
  return (
    <div className={`moderation ${mode === "queue" ? "queue-actions" : ""}`}>
      {mode === "full" ? (
        <button
          type="button"
          className={copiedEntryId === entry.id ? "copied" : undefined}
          title={
            entry.characterName && entry.realm
              ? `Copy ${formatInviteCommand(entry.characterName, entry.realm)}`
              : "Character details unavailable"
          }
          disabled={!entry.characterName || !entry.realm}
          onClick={() => onCopy(entry)}
        >
          {copiedEntryId === entry.id ? <Check size={15} /> : <Copy size={15} />}
        </button>
      ) : null}
      <button
        type="button"
        title="Move up"
        disabled={!canMoveUp || Boolean(busyAction)}
        onClick={() => onMove(entry.id, "up")}
      >
        <ArrowUp size={15} />
      </button>
      <button
        type="button"
        title="Move down"
        disabled={!canMoveDown || Boolean(busyAction)}
        onClick={() => onMove(entry.id, "down")}
      >
        <ArrowDown size={15} />
      </button>
      {mode === "full" ? (
        <button
          type="button"
          title="Mark invited"
          disabled={Boolean(busyAction)}
          onClick={() => onStatus(entry.id, "invited")}
        >
          <ShieldCheck size={15} />
        </button>
      ) : null}
      <button
        type="button"
        title="Skip"
        disabled={Boolean(busyAction)}
        onClick={() => onStatus(entry.id, "skipped")}
      >
        <SkipForward size={15} />
      </button>
      {mode === "full" ? (
        <button
          type="button"
          title="Complete"
          disabled={Boolean(busyAction)}
          onClick={() => onStatus(entry.id, "completed")}
        >
          <CheckCircle2 size={15} />
        </button>
      ) : null}
      <button
        type="button"
        title="Remove"
        disabled={Boolean(busyAction)}
        onClick={() => onRemove(entry.id)}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function EntrySummary({
  entry,
  showRaiderIo,
  dungeons,
  keyAvailability,
  onSelect
}: {
  entry: QueueEntryDto;
  showRaiderIo: boolean;
  dungeons: readonly DungeonOptionDto[];
  keyAvailability?: KeyAvailability | null;
  onSelect?: (() => void) | undefined;
}) {
  const label = getViewerLabel(entry);
  const keyDetails =
    entry.keyIntent && entry.dungeon && entry.keyLevel !== null
      ? `${entry.keyIntent === "need" ? "Needs" : "Offers"} ${getMythicPlusDungeonShortName(entry.dungeon, dungeons)} +${entry.keyLevel}`
      : undefined;

  return (
    <div className="entry-main">
      <span
        className={`position${keyAvailability ? ` key-${keyAvailability}` : ""}`}
        title={keyAvailability ? keyAvailabilityLabels[keyAvailability] : undefined}
        aria-label={
          keyAvailability
            ? `Queue position ${entry.position}: ${keyAvailabilityLabels[keyAvailability]}`
            : `Queue position ${entry.position}`
        }
      >
        {entry.position}
      </span>
      <div className="entry-copy">
        <div className="entry-line">
          {onSelect ? (
            <button
              className="entry-view-button"
              type="button"
              title={`View matching keys for ${label}`}
              onClick={onSelect}
            >
              <strong>{label}</strong>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          ) : (
            <strong title={label}>{label}</strong>
          )}
          <RoleBadges entry={entry} />
          {showRaiderIo ? <SourceBadge sourceRole={entry.sourceRole} /> : null}
          <span className={`status ${entry.status}`}>{statusLabels[entry.status]}</span>
        </div>
        {entry.characterName || entry.realm ? (
          <div className="character-line">
            <p title={`${entry.characterName}${entry.realm ? ` - ${entry.realm}` : ""}`}>
              {entry.characterName || "Unknown character"}
              {entry.realm ? ` - ${entry.realm}` : null}
            </p>
            {showRaiderIo && entry.raiderIo !== undefined ? (
              <RaiderIoScore entry={entry} />
            ) : null}
          </div>
        ) : null}
        {keyDetails ? <p title={keyDetails}>{keyDetails}</p> : null}
      </div>
    </div>
  );
}

function getViewerLabel(entry: Pick<QueueEntryDto, "displayName">): string {
  return entry.displayName ?? "Unknown viewer";
}

function RoleBadges({
  entry
}: {
  entry: Pick<QueueEntryDto, "role" | "roles"> | Pick<KeyOfferDto, "role" | "roles">;
}) {
  const roles = entry.roles?.length ? entry.roles : [entry.role];
  return (
    <span className="role-badges" aria-label={`Roles: ${roles.map((role) => roleLabels[role]).join(", ")}`}>
      {roles.map((role) => (
        <span key={role} className={`badge ${role}`}>
          {roleLabels[role]}
        </span>
      ))}
    </span>
  );
}

function SourceBadge({ sourceRole }: { sourceRole: QueueEntryDto["sourceRole"] }) {
  if (!sourceRole) return null;
  return <span className={`source-badge ${sourceRole}`}>{sourceRole === "host" ? "Host" : "Collaborator"}</span>;
}

function formatKeyNeed(
  entry: Pick<QueueEntryDto, "dungeon" | "keyLevel">,
  dungeons: readonly DungeonOptionDto[]
): string {
  const dungeon = getMythicPlusDungeonShortName(entry.dungeon, dungeons);
  return `Needs ${dungeon} +${entry.keyLevel ?? "?"}`;
}

function formatNoAvailableKeys(
  entry: Pick<QueueEntryDto, "dungeon" | "keyLevel">,
  dungeons: readonly DungeonOptionDto[]
): string {
  const dungeon =
    entry.dungeon === anyMythicPlusDungeon
      ? ""
      : `${getMythicPlusDungeonShortName(entry.dungeon, dungeons)} `;
  return `No available ${dungeon}+${entry.keyLevel ?? "?"} or higher keys match this request.`;
}

function RaiderIoScore({
  entry
}: {
  entry: Pick<QueueEntryDto, "characterName" | "raiderIo"> | Pick<KeyOfferDto, "characterName" | "raiderIo">;
}) {
  if (!entry.raiderIo) {
    return (
      <span className="raider-io unavailable" title="Raider.IO profile not found">
        RIO -
      </span>
    );
  }

  const score = Math.round(entry.raiderIo.score);
  const label = score > 0 ? `RIO ${score.toLocaleString("en-US")}` : "RIO Unranked";

  return (
    <a
      className="raider-io"
      href={entry.raiderIo.profileUrl}
      target="_blank"
      rel="noreferrer"
      title={`Open ${entry.characterName} on Raider.IO (external site)`}
    >
      {label}
      <ExternalLink size={11} aria-hidden="true" />
    </a>
  );
}

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiClientError) {
    return cause.message;
  }

  if (cause instanceof Error) {
    return cause.message;
  }

  return "Something went wrong.";
}

function getErrorCode(cause: unknown): string | undefined {
  if (cause instanceof ApiClientError) return cause.code;
  if (cause instanceof Error && "code" in cause && typeof cause.code === "string") return cause.code;
  return undefined;
}

function isNorthAmericanRealm(value: string): value is NorthAmericanRealm {
  return (northAmericanRealms as readonly string[]).includes(value);
}
