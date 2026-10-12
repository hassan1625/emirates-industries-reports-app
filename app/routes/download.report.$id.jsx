// Serves a finished report file to a signed, short-lived link (made by
// app.report-download-link.$id.jsx). It has no Shopify login of its own: the
// signature is the proof. When reports move to S3 (Step 28) this redirects to a
// presigned URL instead of streaming from disk.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import db from "../db.server";
import { STAGES } from "../pipeline/job-stages";
import { verifyDownload } from "../pipeline/download-token";
import { reportFileName } from "../pipeline/report-file";
import { fromLocalUrl } from "../pipeline/storage";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const loader = async ({ request, params }) => {
  const url = new URL(request.url);
  // eslint-disable-next-line no-undef
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!verifyDownload({ jobId: params.id, expires: url.searchParams.get("expires"), sig: url.searchParams.get("sig"), secret })) {
    throw new Response("This download link is invalid or has expired. Open the report again to get a new one.", { status: 403 });
  }
  const job = await db.reportJob.findUnique({ where: { id: params.id } });
  const filePath = job && job.stage === STAGES.READY ? fromLocalUrl(job.resultFileUrl) : null;
  const size = filePath ? await stat(filePath).then((s) => s.size).catch(() => null) : null;
  if (size === null) throw new Response("The report file is not available", { status: 404 });

  return new Response(Readable.toWeb(createReadStream(filePath)), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${reportFileName(job)}"`,
      "Cache-Control": "private, no-store",
    },
  });
};
