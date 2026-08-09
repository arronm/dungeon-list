import type {
  CollaborationCodeRequest,
  CollaborationInvitePreviewResponse,
  CollaborationStateResponse,
  CollaborationTargetPreviewResponse,
  CollaborationTargetPreviewRequest,
  JoinQueueRequest,
  MoveEntryRequest,
  OfferKeyRequest,
  QueueStateResponse,
  SetEntryStatusRequest,
  SetQueueSettingsRequest
} from "@dungeon-list/shared";
import {
  isLocalMockRuntime,
  mockClearQueue,
  mockCreateCollaborationInvite,
  mockEndCollaboration,
  mockGetCollaboration,
  mockGetQueue,
  mockJoinCollaboration,
  mockJoinQueue,
  mockLeaveCollaboration,
  mockLeaveQueue,
  mockMoveEntry,
  mockOfferKey,
  mockPreviewCollaborationInvite,
  mockPreviewCollaborationTarget,
  mockRemoveOffer,
  mockRemoveEntry,
  mockRevokeCollaborationInvite,
  mockUpdateEntryStatus,
  mockUpdateQueueSettings
} from "./localMock.js";

const ebsBaseUrl = import.meta.env.VITE_EBS_BASE_URL ?? "";

export class ApiClientError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${ebsBaseUrl}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { code?: string; message?: string } }
      | undefined;
    throw new ApiClientError(
      body?.error?.code ?? "request_failed",
      body?.error?.message ?? "The waitlist service rejected the request."
    );
  }

  return (await response.json()) as T;
}

export function getQueue(token: string, helixToken: string): Promise<QueueStateResponse> {
  if (shouldUseLocalMock(token)) {
    return mockGetQueue();
  }

  return request<QueueStateResponse>("/api/queue", token, {
    cache: "no-store",
    headers: { "X-Twitch-Helix-Token": helixToken }
  });
}

export function joinQueue(token: string, helixToken: string, body: JoinQueueRequest): Promise<QueueStateResponse> {
  if (shouldUseLocalMock(token)) {
    return mockJoinQueue(body);
  }

  return request<QueueStateResponse>("/api/queue/join", token, {
    method: "POST",
    headers: { "X-Twitch-Helix-Token": helixToken },
    body: JSON.stringify(withLegacyPrimaryRole(body))
  });
}

export function leaveQueue(token: string): Promise<QueueStateResponse> {
  if (shouldUseLocalMock(token)) {
    return mockLeaveQueue();
  }

  return request<QueueStateResponse>("/api/queue/leave", token, {
    method: "POST"
  });
}

export function offerKey(
  token: string,
  helixToken: string,
  body: OfferKeyRequest
): Promise<QueueStateResponse> {
  if (shouldUseLocalMock(token)) {
    return mockOfferKey(body);
  }

  return request<QueueStateResponse>("/api/offers", token, {
    method: "POST",
    headers: { "X-Twitch-Helix-Token": helixToken },
    body: JSON.stringify(withLegacyPrimaryRole(body))
  });
}

export function removeOffer(token: string, offerId: string, revision?: string): Promise<QueueStateResponse> {
  if (shouldUseLocalMock(token)) {
    return mockRemoveOffer(offerId, revision);
  }

  return request<QueueStateResponse>(`/api/offers/${offerId}`, token, {
    method: "DELETE",
    headers: revisionHeader(revision)
  });
}

export function updateEntryStatus(
  token: string,
  entryId: string,
  body: SetEntryStatusRequest,
  revision?: string
): Promise<QueueStateResponse> {
  if (shouldUseLocalMock(token)) {
    return mockUpdateEntryStatus(entryId, body, revision);
  }

  return request<QueueStateResponse>(`/api/moderation/entries/${entryId}/status`, token, {
    method: "POST",
    headers: revisionHeader(revision),
    body: JSON.stringify(body)
  });
}

export function moveEntry(token: string, entryId: string, body: MoveEntryRequest, revision?: string): Promise<QueueStateResponse> {
  if (shouldUseLocalMock(token)) {
    return mockMoveEntry(entryId, body, revision);
  }

  return request<QueueStateResponse>(`/api/moderation/entries/${entryId}/move`, token, {
    method: "POST",
    headers: revisionHeader(revision),
    body: JSON.stringify(body)
  });
}

export function removeEntry(token: string, entryId: string, revision?: string): Promise<QueueStateResponse> {
  if (shouldUseLocalMock(token)) {
    return mockRemoveEntry(entryId, revision);
  }

  return request<QueueStateResponse>(`/api/moderation/entries/${entryId}`, token, {
    method: "DELETE",
    headers: revisionHeader(revision)
  });
}

export function clearQueue(token: string, revision?: string): Promise<QueueStateResponse> {
  if (shouldUseLocalMock(token)) {
    return mockClearQueue(revision);
  }

  return request<QueueStateResponse>("/api/moderation/clear", token, {
    method: "POST",
    headers: revisionHeader(revision)
  });
}

export function updateQueueSettings(token: string, body: SetQueueSettingsRequest, revision?: string): Promise<QueueStateResponse> {
  if (shouldUseLocalMock(token)) {
    return mockUpdateQueueSettings(body, revision);
  }

  return request<QueueStateResponse>("/api/moderation/settings", token, {
    method: "POST",
    headers: revisionHeader(revision),
    body: JSON.stringify(body)
  });
}

export function getCollaboration(token: string): Promise<CollaborationStateResponse> {
  return shouldUseLocalMock(token)
    ? mockGetCollaboration()
    : request("/api/collaboration", token, { cache: "no-store" });
}

export function previewCollaborationTarget(
  token: string,
  helixToken: string,
  body: CollaborationTargetPreviewRequest
): Promise<CollaborationTargetPreviewResponse> {
  return shouldUseLocalMock(token)
    ? mockPreviewCollaborationTarget(body)
    : request("/api/collaboration/targets/preview", token, {
        method: "POST",
        headers: { "X-Twitch-Helix-Token": helixToken },
        body: JSON.stringify(body)
      });
}

export function createCollaborationInvite(
  token: string,
  helixToken: string,
  body: CollaborationTargetPreviewRequest
): Promise<CollaborationStateResponse> {
  return shouldUseLocalMock(token)
    ? mockCreateCollaborationInvite(body)
    : request("/api/collaboration/invites", token, {
        method: "POST",
        headers: { "X-Twitch-Helix-Token": helixToken },
        body: JSON.stringify(body)
      });
}

export function revokeCollaborationInvite(token: string): Promise<CollaborationStateResponse> {
  return shouldUseLocalMock(token)
    ? mockRevokeCollaborationInvite()
    : request("/api/collaboration/invites", token, { method: "DELETE" });
}

export function previewCollaborationInvite(
  token: string,
  body: CollaborationCodeRequest
): Promise<CollaborationInvitePreviewResponse> {
  return shouldUseLocalMock(token)
    ? mockPreviewCollaborationInvite(body)
    : request("/api/collaboration/invites/preview", token, {
        method: "POST",
        body: JSON.stringify(body)
      });
}

export function joinCollaboration(token: string, body: CollaborationCodeRequest): Promise<CollaborationStateResponse> {
  return shouldUseLocalMock(token)
    ? mockJoinCollaboration(body)
    : request("/api/collaboration/join", token, { method: "POST", body: JSON.stringify(body) });
}

export function leaveCollaboration(token: string): Promise<CollaborationStateResponse> {
  return shouldUseLocalMock(token)
    ? mockLeaveCollaboration()
    : request("/api/collaboration/leave", token, { method: "POST" });
}

export function endCollaboration(token: string): Promise<CollaborationStateResponse> {
  return shouldUseLocalMock(token)
    ? mockEndCollaboration()
    : request("/api/collaboration/end", token, { method: "POST" });
}

function shouldUseLocalMock(token: string): boolean {
  return isLocalMockRuntime() && token.startsWith("local-dev-token:");
}

function revisionHeader(revision: string | undefined): HeadersInit {
  return revision ? { "X-Queue-Revision": revision } : {};
}

function withLegacyPrimaryRole<T extends JoinQueueRequest | OfferKeyRequest>(body: T) {
  return {
    ...body,
    role: body.roles[0]
  };
}
