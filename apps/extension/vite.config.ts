import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const repositoryRoot = resolve(import.meta.dirname, "../..");

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, repositoryRoot, "VITE_");

  if (command === "build" && !(process.env.VITE_EBS_BASE_URL || env.VITE_EBS_BASE_URL)) {
    throw new Error("VITE_EBS_BASE_URL is required when building Twitch extension assets.");
  }

  return {
    base: "./",
    envDir: repositoryRoot,
    plugins: [react()],
    build: {
      outDir: "dist",
      sourcemap: false
    },
    server: {
      port: 5173,
      strictPort: false
    },
    preview: {
      cors: true,
      headers: {
        "Access-Control-Allow-Private-Network": "true"
      }
    }
  };
});
