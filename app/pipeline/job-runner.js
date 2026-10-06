// The whole chain for a finished Shopify export: advance the job (download,
// start the next export) and, once all data is in, build the report file. Used
// by the webhook route, the recovery pass and the debug page, so they all do
// the same thing.
import { advanceJob } from "./job-chain.js";
import { generateReport } from "./report-generation.js";

export async function advanceAndGenerate({ db, admin, result, deps = {} }) {
  const outcome = await (deps.advanceJob ?? advanceJob)({ db, admin, result, deps: deps.chain });
  if (outcome.action !== "data-ready") return outcome;
  const generated = await (deps.generateReport ?? generateReport)({ db, jobId: result.job.id, deps: deps.generate });
  return { ...outcome, action: generated.action === "ready" ? "ready" : `data-ready:${generated.action}`, generated };
}
