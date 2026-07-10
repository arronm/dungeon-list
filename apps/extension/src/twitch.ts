import { useEffect, useMemo, useState } from "react";
import {
  getLocalMockAuthorization,
  getLocalMockContext,
  getLocalMockViewer,
  isLocalMockRuntime,
  requestLocalMockIdentityShare,
  subscribeToLocalMockAuth
} from "./localMock.js";

export interface TwitchAuthorization {
  channelId: string;
  clientId: string;
  helixToken: string;
  token: string;
  userId?: string;
}

export interface TwitchViewer {
  id?: string;
  opaqueId?: string;
  role?: string;
  isLinked?: boolean;
  displayName?: string;
}

export interface TwitchExtContext {
  theme?: "light" | "dark";
  language?: string;
  mode?: string;
}

export interface TwitchExt {
  onAuthorized(callback: (auth: TwitchAuthorization) => void): void;
  onContext(callback: (context: TwitchExtContext, changed: string[]) => void): void;
  listen(
    target: "broadcast" | "whisper-" | string,
    callback: (target: string, contentType: string, message: string) => void
  ): void;
  unlisten(
    target: "broadcast" | "whisper-" | string,
    callback: (target: string, contentType: string, message: string) => void
  ): void;
  actions: {
    requestIdShare(): void;
  };
  viewer?: TwitchViewer;
}

declare global {
  interface Window {
    Twitch?: {
      ext: TwitchExt;
    };
  }
}

export interface TwitchAuthState {
  authorization: TwitchAuthorization | undefined;
  viewer: TwitchViewer | undefined;
  context: TwitchExtContext;
  isAvailable: boolean;
}

export function useTwitchAuth(): TwitchAuthState {
  const [authorization, setAuthorization] = useState<TwitchAuthorization | undefined>(() =>
    getLocalMockAuthorization()
  );
  const [viewer, setViewer] = useState<TwitchViewer | undefined>(() => getLocalMockViewer());
  const [context, setContext] = useState<TwitchExtContext>(() => getLocalMockContext() ?? {});

  useEffect(() => {
    if (isLocalMockRuntime()) {
      const syncMockAuth = () => {
        setAuthorization(getLocalMockAuthorization());
        setViewer(getLocalMockViewer());
        setContext(getLocalMockContext() ?? {});
      };

      syncMockAuth();
      return subscribeToLocalMockAuth(syncMockAuth);
    }

    const twitch = window.Twitch?.ext;
    if (!twitch) {
      return;
    }

    twitch.onAuthorized((auth) => {
      setAuthorization(auth);
      const nextViewer: TwitchViewer = { ...twitch.viewer };
      const viewerId = auth.userId ?? twitch.viewer?.id;
      if (viewerId) {
        nextViewer.id = viewerId;
      }
      setViewer(nextViewer);
    });

    twitch.onContext((nextContext) => {
      setContext(nextContext);
    });
  }, []);

  return useMemo(
    () => ({
      authorization,
      viewer,
      context,
      isAvailable: Boolean(window.Twitch?.ext) || isLocalMockRuntime()
    }),
    [authorization, context, viewer]
  );
}

export function requestIdentityShare(): void {
  if (isLocalMockRuntime()) {
    requestLocalMockIdentityShare();
    return;
  }

  window.Twitch?.ext.actions.requestIdShare();
}

export function getViewerDisplayName(viewer?: TwitchViewer): string | undefined {
  return viewer?.displayName || viewer?.id;
}
