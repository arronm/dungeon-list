import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Link2, Loader2, Unlink } from "lucide-react";
import type { CollaborationStateDto } from "@dungeon-list/shared";
import {
  createCollaborationInvite,
  endCollaboration,
  getCollaboration,
  joinCollaboration,
  leaveCollaboration,
  previewCollaborationInvite,
  previewCollaborationTarget,
  revokeCollaborationInvite
} from "./api.js";

interface CollaborationPanelProps {
  token: string;
  helixToken: string;
  onQueueIdentityChanged(): Promise<void>;
}

export function CollaborationPanel({
  token,
  helixToken,
  onQueueIdentityChanged
}: CollaborationPanelProps) {
  const isLocalMock = token.startsWith("local-dev-token:");
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<CollaborationStateDto>();
  const [login, setLogin] = useState("");
  const [targetName, setTargetName] = useState<string>();
  const [code, setCode] = useState("");
  const [hostName, setHostName] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    const response = await getCollaboration(token);
    setState(response.collaboration);
  }, [token]);

  useEffect(() => {
    refresh().catch((cause) => setError(getMessage(cause)));
  }, [refresh]);

  async function run(action: string, callback: () => Promise<void>) {
    setBusy(action);
    setError(undefined);
    try {
      await callback();
    } catch (cause) {
      setError(getMessage(cause));
      setExpanded(true);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className="collaboration-module" aria-label="Shared queue collaboration">
      <button
        className="collaboration-toggle"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="collaboration-toggle-icon"><Link2 size={16} /></span>
        <span className="collaboration-toggle-copy">
          <strong>Collaboration</strong>
          <span>{getCollaborationSummary(state)}</span>
        </span>
        {state ? null : <Loader2 className="spin" size={15} />}
        {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
      </button>

      {expanded ? (
        <div className="collaboration-content">
          {error ? <div className="notice error">{error}</div> : null}
          {!state ? (
            <p className="muted">Loading collaboration controls.</p>
          ) : state.state === "pending-host-invite" ? (
            <div className="collaboration-state-card">
              <p className="eyebrow">
                {isLocalMock ? "Local mock invitation" : "Invitation"} for {state.collaboratorDisplayName}
              </p>
              <button
                className="invite-code"
                type="button"
                title="Copy collaboration code"
                onClick={() => void copyText(state.code).catch(() => setError("The code could not be copied."))}
              >
                <strong>{state.code}</strong><Copy size={15} />
              </button>
              <p className="muted">
                Expires {formatExpiration(state.expiresAt)}. It only works on {state.collaboratorDisplayName}'s channel.
                {isLocalMock ? " This deterministic code is only used by the local mock." : null}
              </p>
              <button
                className="danger"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void run("revoke", async () => {
                  setState((await revokeCollaborationInvite(token)).collaboration);
                })}
              >
                Revoke invitation
              </button>
            </div>
          ) : state.state === "active" ? (
            <div className="collaboration-state-card active-collaboration">
              <div>
                <strong>{state.hostDisplayName} + {state.collaboratorDisplayName}</strong>
                <p className="muted">Active shared queue. Submissions return to their source channels when it ends.</p>
              </div>
              <button
                className="danger"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void run("split", async () => {
                  const response = state.role === "host"
                    ? await endCollaboration(token)
                    : await leaveCollaboration(token);
                  setState(response.collaboration);
                  setExpanded(false);
                  await onQueueIdentityChanged();
                })}
              >
                <Unlink size={15} />
                {state.role === "host" ? "End collaboration" : "Leave collaboration"}
              </button>
            </div>
          ) : (
            <div className="config-grid">
              <section className="config-card">
                <h2>Share my queue</h2>
                <p className="muted">Resolve the collaborator's Twitch login before creating a bound invitation.</p>
                <label>
                  <span>Collaborator login</span>
                  <input
                    value={login}
                    maxLength={25}
                    autoComplete="off"
                    onChange={(event) => {
                      setLogin(event.target.value);
                      setTargetName(undefined);
                    }}
                  />
                </label>
                {targetName ? (
                  <div className="confirmation">
                    <p>Share with <strong>{targetName}</strong>?</p>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void run("create", async () => {
                        setState((await createCollaborationInvite(token, helixToken, { login })).collaboration);
                      })}
                    >
                      Confirm and create code
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!login.trim() || Boolean(busy)}
                    onClick={() => void run("target", async () => {
                      setTargetName((await previewCollaborationTarget(token, helixToken, { login })).target.displayName);
                    })}
                  >
                    Preview broadcaster
                  </button>
                )}
              </section>

              <section className="config-card">
                <h2>Join a shared queue</h2>
                <p className="muted">Joining requires no active entries or key offers on this channel.</p>
                <label>
                  <span>Invitation code</span>
                  <input
                    className="code-input"
                    value={code}
                    maxLength={6}
                    autoComplete="off"
                    onChange={(event) => {
                      setCode(event.target.value.toUpperCase());
                      setHostName(undefined);
                    }}
                  />
                </label>
                {hostName ? (
                  <div className="confirmation">
                    <p>Join <strong>{hostName}</strong>'s queue?</p>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void run("join", async () => {
                        setState((await joinCollaboration(token, { code })).collaboration);
                        setExpanded(false);
                        await onQueueIdentityChanged();
                      })}
                    >
                      Confirm joining
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={code.length !== 6 || Boolean(busy)}
                    onClick={() => void run("code", async () => {
                      setHostName((await previewCollaborationInvite(token, { code })).invite.hostDisplayName);
                    })}
                  >
                    Preview host
                  </button>
                )}
              </section>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function getCollaborationSummary(state: CollaborationStateDto | undefined): string {
  if (!state) return "Loading status…";
  if (state.state === "standalone") return "Not sharing this queue";
  if (state.state === "pending-host-invite") return `Invite pending for ${state.collaboratorDisplayName}`;
  return `${state.hostDisplayName} + ${state.collaboratorDisplayName}`;
}

function formatExpiration(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function getMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The collaboration request failed.";
}

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
  await navigator.clipboard.writeText(value);
}
