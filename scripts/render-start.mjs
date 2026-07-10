import { spawn } from "node:child_process";

const maxAttempts = Number.parseInt(process.env.RENDER_MIGRATION_MAX_ATTEMPTS ?? "6", 10);
const baseDelayMs = Number.parseInt(process.env.RENDER_MIGRATION_RETRY_DELAY_MS ?? "5000", 10);

async function main() {
  await runWithRetry(["npm", "run", "prisma:deploy"], maxAttempts);
  await run(["npm", "run", "start", "-w", "@dungeon-list/ebs"]);
}

async function runWithRetry(command, attempts) {
  let lastExitCode = 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`Running ${command.join(" ")} (attempt ${attempt}/${attempts})`);
    lastExitCode = await run(command, { allowFailure: true });

    if (lastExitCode === 0) {
      return;
    }

    if (attempt < attempts) {
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), 30000);
      console.log(`Migration command failed with ${lastExitCode}; retrying in ${delayMs}ms.`);
      await delay(delayMs);
    }
  }

  process.exit(lastExitCode);
}

async function run(command, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: "inherit",
      env: process.env
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command.join(" ")} exited from signal ${signal}`));
        return;
      }

      const exitCode = code ?? 1;
      if (exitCode !== 0 && !options.allowFailure) {
        reject(new Error(`${command.join(" ")} exited with code ${exitCode}`));
        return;
      }

      resolve(exitCode);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

