import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
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
  type QueueEntryDto,
  type QueueEntryStatus,
  type JoinQueueRequest,
  type NorthAmericanRealm,
  type QueueRole,
  type QueueStateDto,
  northAmericanRealms,
  queueEventSchema
} from "@dungeon-list/shared";
import {
  ApiClientError,
  clearQueue,
  getQueue,
  joinQueue,
  leaveQueue,
  moveEntry,
  removeEntry,
  updateEntryStatus,
  updateQueueSettings
} from "./api.js";
import { formatInviteCommand } from "./invite.js";
import { requestIdentityShare, useTwitchAuth } from "./twitch.js";

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

const queuePollIntervalMs = 15_000;

export function App() {
  const twitch = useTwitchAuth();
  const token = twitch.authorization?.token;
  const helixToken = twitch.authorization?.helixToken;
  const [queue, setQueue] = useState<QueueStateDto | undefined>();
  const [role, setRole] = useState<QueueRole>("dps");
  const [realm, setRealm] = useState<NorthAmericanRealm | "">("");
  const [characterName, setCharacterName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busyAction, setBusyAction] = useState<string | undefined>();
  const [copiedEntryId, setCopiedEntryId] = useState<string | undefined>();
  const queueRequestGeneration = useRef(0);
  const copyResetTimer = useRef<number | undefined>();

  const sortedEntries = useMemo(() => {
    return [...(queue?.entries ?? [])].sort((a, b) => {
      const statusDelta = statusOrder[a.status] - statusOrder[b.status];
      return statusDelta || a.position - b.position || a.joinedAt.localeCompare(b.joinedAt);
    });
  }, [queue?.entries]);

  const activeEntries = sortedEntries.filter((entry) => entry.status !== "completed");
  const completedEntries = sortedEntries.filter((entry) => entry.status === "completed").slice(0, 4);
  const currentEntry = queue?.entries.find((entry) => entry.isCurrentViewer);
  const hasCharacterDetails = Boolean(realm && characterName.trim().length >= 2);
  const canJoin = Boolean(queue?.viewer.isLinked && queue.signupsOpen && !currentEntry && hasCharacterDetails);

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

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshQueue().catch((cause) => setError(errorMessage(cause)));
      }
    };

    const intervalId = window.setInterval(refreshWhenVisible, queuePollIntervalMs);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [helixToken, refreshQueue, token]);

  useEffect(() => {
    if (!token || !window.Twitch?.ext) {
      return;
    }

    const listener = (_target: string, _contentType: string, message: string) => {
      const payload = parsePubSubPayload(message);
      if (!payload) {
        return;
      }

      const parsed = queueEventSchema.safeParse(payload);
      if (parsed.success && parsed.data.channelId === twitch.authorization?.channelId) {
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

  function submitJoin() {
    const normalizedCharacterName = characterName.trim();
    if (!token || !helixToken || !realm || normalizedCharacterName.length < 2) {
      return;
    }

    void runAction("join", async () => {
      const body: JoinQueueRequest = {
        role,
        realm,
        characterName: normalizedCharacterName
      };
      const response = await joinQueue(token, helixToken, body);
      applyActionQueue(response.queue);
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
      const response = await callback();
      applyActionQueue(response.queue);
    });
  }

  function copyInvite(entry: QueueEntryDto) {
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

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Dungeon List</h1>
          <p>{queue?.signupsOpen ? "Signups open" : "Signups closed"}</p>
        </div>
        <div className="top-actions">
          {queue?.viewer.canModerate ? (
            <button
              className="icon-button"
              type="button"
              title={queue.signupsOpen ? "Close signups" : "Open signups"}
              disabled={Boolean(busyAction)}
              onClick={() =>
                submitModeration("settings", () =>
                  updateQueueSettings(token, { signupsOpen: !queue.signupsOpen })
                )
              }
            >
              {queue.signupsOpen ? <Unlock size={17} /> : <Lock size={17} />}
            </button>
          ) : null}
          <button
            className="icon-button"
            type="button"
            title="Refresh queue"
            disabled={busyAction === "refresh"}
            onClick={() => void runAction("refresh", refreshQueue)}
          >
            <RefreshCw className={busyAction === "refresh" ? "spin" : undefined} size={17} />
          </button>
        </div>
      </header>

      {error ? <div className="notice error">{error}</div> : null}

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
          <button className="danger" type="button" disabled={busyAction === "leave"} onClick={submitLeave}>
            <LogOut size={16} />
            Leave queue
          </button>
        ) : (
          <>
            <div className="role-group" aria-label="Dungeon role">
              {(["tank", "healer", "dps"] as QueueRole[]).map((nextRole) => (
                <button
                  key={nextRole}
                  type="button"
                  className={role === nextRole ? "selected" : undefined}
                  onClick={() => setRole(nextRole)}
                >
                  {roleLabels[nextRole]}
                </button>
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
            <button type="button" disabled={!canJoin || busyAction === "join"} onClick={submitJoin}>
              <LogIn size={16} />
              Join queue
            </button>
          </>
        )}
      </section>

      {currentEntry ? (
        <section className="my-spot">
          <span>Position {currentEntry.position}</span>
          <strong>{statusLabels[currentEntry.status]}</strong>
        </section>
      ) : null}

      <QueueList
        entries={activeEntries}
        canModerate={Boolean(queue?.viewer.canModerate)}
        busyAction={busyAction}
        copiedEntryId={copiedEntryId}
        onCopy={copyInvite}
        onStatus={(entryId, status) =>
          submitModeration(`status:${entryId}:${status}`, () => updateEntryStatus(token, entryId, { status }))
        }
        onMove={(entryId, direction) =>
          submitModeration(`move:${entryId}:${direction}`, () => moveEntry(token, entryId, { direction }))
        }
        onRemove={(entryId) => submitModeration(`remove:${entryId}`, () => removeEntry(token, entryId))}
      />

      {completedEntries.length ? (
        <section className="completed">
          <h2>Completed</h2>
          {completedEntries.map((entry) => (
            <EntrySummary key={entry.id} entry={entry} showRaiderIo={Boolean(queue?.viewer.canModerate)} />
          ))}
        </section>
      ) : null}

      {queue?.viewer.canModerate && queue.entries.length ? (
        <button
          className="clear-button"
          type="button"
          disabled={busyAction === "clear"}
          onClick={() => submitModeration("clear", () => clearQueue(token))}
        >
          <Trash2 size={16} />
          Clear queue
        </button>
      ) : null}
    </main>
  );
}

interface QueueListProps {
  entries: QueueEntryDto[];
  canModerate: boolean;
  busyAction: string | undefined;
  copiedEntryId: string | undefined;
  onCopy(entry: QueueEntryDto): void;
  onStatus(entryId: string, status: QueueEntryStatus): void;
  onMove(entryId: string, direction: "up" | "down"): void;
  onRemove(entryId: string): void;
}

function QueueList({
  entries,
  canModerate,
  busyAction,
  copiedEntryId,
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
          <EntrySummary entry={entry} showRaiderIo={canModerate} />
          {canModerate ? (
            <div className="moderation">
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
              <button
                type="button"
                title="Move up"
                disabled={index === 0 || Boolean(busyAction)}
                onClick={() => onMove(entry.id, "up")}
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                title="Move down"
                disabled={index === entries.length - 1 || Boolean(busyAction)}
                onClick={() => onMove(entry.id, "down")}
              >
                <ArrowDown size={15} />
              </button>
              <button type="button" title="Mark invited" disabled={Boolean(busyAction)} onClick={() => onStatus(entry.id, "invited")}>
                <ShieldCheck size={15} />
              </button>
              <button type="button" title="Skip" disabled={Boolean(busyAction)} onClick={() => onStatus(entry.id, "skipped")}>
                <SkipForward size={15} />
              </button>
              <button type="button" title="Complete" disabled={Boolean(busyAction)} onClick={() => onStatus(entry.id, "completed")}>
                <CheckCircle2 size={15} />
              </button>
              <button type="button" title="Remove" disabled={Boolean(busyAction)} onClick={() => onRemove(entry.id)}>
                <Trash2 size={15} />
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}

function EntrySummary({ entry, showRaiderIo }: { entry: QueueEntryDto; showRaiderIo: boolean }) {
  const label = entry.displayName ?? `Viewer ${entry.twitchUserId.slice(-4)}`;

  return (
    <div className="entry-main">
      <span className="position">{entry.position}</span>
      <div className="entry-copy">
        <div className="entry-line">
          <strong title={label}>{label}</strong>
          <span className={`badge ${entry.role}`}>{roleLabels[entry.role]}</span>
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
      </div>
    </div>
  );
}

function RaiderIoScore({ entry }: { entry: QueueEntryDto }) {
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

function parsePubSubPayload(message: string): unknown {
  try {
    return JSON.parse(message);
  } catch {
    return undefined;
  }
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Some extension iframe policies reject Clipboard API writes; use the user-activated fallback below.
    }
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();

  if (!copied) {
    throw new Error("Clipboard write failed.");
  }
}
