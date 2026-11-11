// Prints how many reports are still being built and exits with 1 when there are any.
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
} finally {
  await db.$disconnect();
}
