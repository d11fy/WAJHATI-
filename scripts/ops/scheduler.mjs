import { spawn } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { validateEnv } from "./validate-env.mjs";

const heartbeat = join(tmpdir(), "dar-scheduler-heartbeat");
const minute = 60000;
const jobs = { billing: 5 * minute, media: 10 * minute, orders: 24 * 60 * minute,
  notifications: 3 * minute, maintenance: 24 * 60 * minute, inspect: 5 * minute };

async function scheduler() {
  if (process.argv.includes("--health")) {
    const age = Date.now() - (await stat(heartbeat)).mtimeMs;
    return age < 5 * minute ? 0 : 1;
  }
  const failures = validateEnv(process.env, "worker");
  if (failures.length) {
    console.error(JSON.stringify({ event: "invalid_worker_environment", fields: failures }));
    return 1;
  }
  const mode = process.argv[2];
  const selected = process.argv[3];
  if (mode && (mode !== "--once" || !selected || !Object.hasOwn(jobs, selected))) return 1;
  const controller = new AbortController();
  let child;
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
    controller.abort();
    child?.kill("SIGTERM");
  });
  function run(name) {
    return new Promise((done) => {
      child = spawn(process.execPath, ["--conditions=react-server","--import","tsx","scripts/catalog-cleanup.ts",`--${name}`],
        { stdio: "inherit", windowsHide: true });
      const watchdog = setTimeout(() => child?.kill("SIGKILL"), 120000);
      child.once("error", () => { clearTimeout(watchdog); done(false); });
      child.once("exit", (code) => { clearTimeout(watchdog); child = undefined; done(code === 0); });
    });
  }
  if (mode === "--once") return await run(selected) ? 0 : 1;
  const due = new Map(Object.keys(jobs).map((name) => [name, 0]));
  while (!controller.signal.aborted) {
    await writeFile(heartbeat, "running\n", { mode: 0o600 });
    for (const [name, interval] of Object.entries(jobs)) {
      if (controller.signal.aborted || (due.get(name) ?? 0) > Date.now()) continue;
      const ok = await run(name);
      due.set(name, Date.now() + (ok ? interval : Math.min(interval, minute)));
      await writeFile(heartbeat, "running\n", { mode: 0o600 });
    }
    await delay(15000, undefined, { signal: controller.signal }).catch(() => {});
  }
  return 0;
}

scheduler().then((code) => { process.exitCode = code; }).catch(() => {
  console.error(JSON.stringify({ event: "scheduler_failed" }));
  process.exitCode = 1;
});
