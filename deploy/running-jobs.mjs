// Prints how many reports are still being built. Exit code 0 = none, 1 = some are in progress,
// 2 = it could not check (for example on a first deploy, before the database tables exist).
// deploy.sh runs it first: restarting the app in the middle of a report loses its
// working files, and that report would have to be started again.
//   node --env-file=.env deploy/running-jobs.mjs
import { PrismaClient } from "@prisma/client";
import { isTerminalStage } from "../app/pipeline/job-stages.js";

const db = new PrismaClient();
try {
  const jobs = await db.reportJob.findMany({ select: { id: true, reportType: true, stage: true } });
  const running = jobs.filter((job) => !isTerminalStage(job.stage));
  for (const job of running) console.log(`  ${job.reportType} ${job.id} (${job.stage})`);
  console.log(`${running.length} report(s) in progress`);
  process.exitCode = running.length ? 1 : 0;
} catch (error) {
  console.log(`Could not check for reports in progress: ${String(error.message).split("\n").pop()}`);
  process.exitCode = 2;
} finally {
  await db.$disconnect();
}
