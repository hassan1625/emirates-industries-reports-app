// Status (and, for testing, a preview) of one report job. Polled by the request
// screen. Only the shop that started the job can read it.
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { STAGES, STAGE_INFO } from "../pipeline/job-stages";
import { previewEnabled, previewJob } from "../pipeline/report-preview";

const previewCache = new Map();

const parseParams = (text) => {
  try {
    return JSON.parse(text ?? "{}");
  } catch {
    return {};
  }
};

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const job = await db.reportJob.findUnique({ where: { id: params.id } });
  if (!job || job.shop !== session.shop) throw new Response("Not found", { status: 404 });

  const info = STAGE_INFO[job.stage] ?? STAGE_INFO[STAGES.FAILED];
  const requested = parseParams(job.params);
  const result = {
    job: { id: job.id, stage: job.stage, label: info.label, detail: info.detail, progress: info.progress, error: job.error, createdAt: job.createdAt, updatedAt: job.updatedAt },
    request: { reportKey: requested.reportKey, range: requested.localRange ?? null, filters: requested.filters ?? {}, fields: requested.fields ?? null },
  };

  if (new URL(request.url).searchParams.get("preview") === "1" && job.stage === STAGES.READY && previewEnabled()) {
    try {
      const key = `${job.id}:${job.updatedAt.toISOString()}`;
      if (!previewCache.has(key)) {
        previewCache.set(key, await previewJob({ db, job, filters: requested.filters, fields: requested.fields, reportKey: requested.reportKey ?? "generalSales", sampleSize: 50 }));
      }
      result.preview = previewCache.get(key);
    } catch (error) {
      result.previewError = error.message;
    }
  }
  return result;
};
