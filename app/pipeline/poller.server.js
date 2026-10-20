// Runs the Step 16 recovery pass on a timer inside the (long-lived) server
// process: once at startup, so a restart recovers interrupted jobs, then every
// minute. Disable with JOB_POLLER=off; change the cadence with
// JOB_POLLER_INTERVAL_MS.
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { recoverStuckJobs } from "./job-recovery";
import { reportStore } from "./report-store";
import { expireOldReports } from "./retention";

const DEFAULT_INTERVAL_MS = 60 * 1000;

const getAdmin = async (shop) => (await unauthenticated.admin(shop)).admin;

export async function runRecoveryPass() {
  const outcomes = await recoverStuckJobs({ db, getAdmin });
  for (const outcome of outcomes) {
    if (outcome.action !== "waiting" && outcome.action !== "still-running") {
      console.log(`Job recovery: ${outcome.jobId} (${outcome.stage}) -> ${outcome.action}${outcome.error ? `: ${outcome.error}` : ""}`);
    }
  }
  return outcomes;
}

// Deletes reports past the retention period; runs about once an hour.
export async function runRetentionPass() {
  const expired = await expireOldReports({ db, store: reportStore() });
  if (expired) console.log(`Retention: expired ${expired} old report(s)`);
  return expired;
}

export function startJobPoller() {
  // eslint-disable-next-line no-undef
  const env = process.env;
  if (env.JOB_POLLER === "off") return;
  // The dev server reloads modules; keep one timer per process.
  /* eslint-disable no-undef */
  if (globalThis.__jobPollerStarted) return;
  globalThis.__jobPollerStarted = true;
  /* eslint-enable no-undef */

  let running = false;
  const tick = async () => {
    if (running) return; // never overlap passes
    running = true;
    try {
      await runRecoveryPass();
    } catch (error) {
      console.error("Job recovery pass failed:", error);
    } finally {
      running = false;
    }
  };

  const interval = Number(env.JOB_POLLER_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  const retention = () => runRetentionPass().catch((error) => console.error("Retention pass failed:", error));
  setTimeout(retention, 30 * 1000).unref?.();
  setInterval(retention, 60 * 60 * 1000).unref?.();
  setTimeout(tick, 5000).unref?.();
  setInterval(tick, interval).unref?.();
  console.log(`Job poller started (every ${Math.round(interval / 1000)}s)`);
}
