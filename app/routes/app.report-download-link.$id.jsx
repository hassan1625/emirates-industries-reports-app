// Creates a short-lived download link for a finished report: a presigned S3 link
// in production, the app's own signed link in development (see report-store.js).
// Only the shop that owns the job can ask for one. Called with a plain fetch, so
// it answers with a JSON Response rather than route data.
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { STAGES } from "../pipeline/job-stages";
import { reportStore } from "../pipeline/report-store";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const job = await db.reportJob.findUnique({ where: { id: params.id } });
  if (!job || job.shop !== session.shop) throw new Response("Not found", { status: 404 });
  if (job.stage !== STAGES.READY || !job.resultFileUrl) throw new Response("The report is not ready yet", { status: 409 });
  try {
    // eslint-disable-next-line no-undef
    return Response.json(await reportStore().downloadLink({ job, secret: process.env.SHOPIFY_API_SECRET }));
  } catch (error) {
    throw new Response(error.message, { status: 404 });
  }
};
