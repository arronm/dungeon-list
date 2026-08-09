import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { LiveConfigApp } from "./LiveConfigApp.js";
import { isLiveConfigView } from "./view.js";
import "./styles.css";

const rootElement = document.getElementById("root");

function renderFatalError(error: unknown) {
  if (document.getElementById("fatal-error-overlay")) return;

  const message = error instanceof Error
    ? error.message
    : typeof error === "string" && error
      ? error
      : "The extension failed before it could render.";
  const overlay = document.createElement("div");
  overlay.id = "fatal-error-overlay";
  overlay.className = "fatal-error-overlay";
  overlay.innerHTML = `
      <div class="notice error">
        Dungeon List failed to load: ${escapeHtml(message)}
      </div>
  `;
  document.body.appendChild(overlay);
}

window.addEventListener("error", (event) => {
  renderFatalError(event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  renderFatalError(event.reason);
});

try {
  if (!rootElement) {
    throw new Error("Missing #root element.");
  }

  const isLiveConfig = isLiveConfigView(window.location.search);
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      {isLiveConfig ? <LiveConfigApp /> : <App />}
    </React.StrictMode>
  );
} catch (error) {
  renderFatalError(error);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
