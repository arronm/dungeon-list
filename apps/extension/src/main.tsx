import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

const rootElement = document.getElementById("root");

function renderFatalError(error: unknown) {
  if (!rootElement) {
    return;
  }

  const message = error instanceof Error ? error.message : "The extension failed before it could render.";
  rootElement.innerHTML = `
    <main class="shell centered">
      <div class="notice error">
        Dungeon List failed to load: ${escapeHtml(message)}
      </div>
    </main>
  `;
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

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
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
