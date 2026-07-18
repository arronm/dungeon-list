import type {
  JoinQueueRequest,
  MoveEntryRequest,
  QueueStateResponse,
  SetEntryStatusRequest,
  SetQueueSettingsRequest
} from "@dungeon-list/shared";
import {
  isLocalMockRuntime,
  mockClearQueue,
  mockGetQueue,
  mockJoinQueue,
  mockLeaveQueue,
  mockMoveEntry,
  mockRemoveEntry,
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
  const response = await fetch(`${ebsBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers
    }
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
    body: JSON.stringify(body)
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

export function updateEntryStatus(
  token: string,
  entryId: string,
  body: SetEntryStatusRequest
): Promise<QueueStateResponse> {
  if (shouldUseLocalMock(token)) {
    return mockUpdateEntryStatus(entryId, body);
  }

  return request<QueueStateResponse>(`/api/moderation/entries/${entryId}/status`, token, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function moveEntry(token: string, entryId: string, body: MoveEntryRequest): Promise<QueueStateResponse> {
  if (shouldUseLocalMock(token)) {
    return mockMoveEntry(entryId, body);
  }

  return request<QueueStateResponse>(`/api/moderation/entries/${entryId}/move`, token, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function removeEntry(token: string, entryId: string): Promise<QueueStateResponse> {
  if (shouldUseLocalMock(token)) {
    return mockRemoveEntry(entryId);
  }

  return request<QueueStateResponse>(`/api/moderation/entries/${entryId}`, token, {
    method: "DELETE"
  });
}

export function clearQueue(token: string): Promise<QueueStateResponse> {
  if (shouldUseLocalMock(token)) {
    return mockClearQueue();
  }

  return request<QueueStateResponse>("/api/moderation/clear", token, {
    method: "POST"
  });
}

export function updateQueueSettings(token: string, body: SetQueueSettingsRequest): Promise<QueueStateResponse> {
  if (shouldUseLocalMock(token)) {
    return mockUpdateQueueSettings(body);
  }

  return request<QueueStateResponse>("/api/moderation/settings", token, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

function shouldUseLocalMock(token: string): boolean {
  return isLocalMockRuntime() && token.startsWith("local-dev-token:");
}
