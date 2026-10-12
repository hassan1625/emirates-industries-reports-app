// Creates a short-lived download link for a finished report. Only the shop that
// owns the job can ask for one; the link itself is then used by a plain browser
// download (see app/pipeline/download-token.js). Called with a plain fetch, so
// it answers with a JSON Response rather than route data.
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { STAGES } from "../pipeline/job-stages";
import { createDownloadPath } from "../pipeline/download-token";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const job = await db.reportJob.findUnique({ where: { id: params.id } });
  if (!job || job.shop !== session.shop) throw new Response("Not found", { status: 404 });
  if (job.stage !== STAGES.READY || !job.resultFileUrl) throw new Response("The report is not ready yet", { status: 409 });
  // eslint-disable-next-line no-undef
  return Response.json({ url: createDownloadPath({ jobId: job.id, secret: process.env.SHOPIFY_API_SECRET }) });
};
