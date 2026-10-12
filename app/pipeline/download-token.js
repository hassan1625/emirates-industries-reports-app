// Short-lived, signed download links. A report is downloaded by a plain browser
// request (an <a href>), which cannot carry the embedded app's session token, so
// the signed link itself is the proof: the app creates it for a signed-in user of
// the right shop, and it stops working after a few minutes. When reports move to
// S3 (Step 28) the same endpoint hands out a presigned S3 URL instead.
import { createHmac, timingSafeEqual } from "node:crypto";

export const DOWNLOAD_LINK_TTL_MS = 10 * 60 * 1000;

const sign = (secret, jobId, expires) => createHmac("sha256", secret).update(`${jobId}.${expires}`).digest("hex");

// The path and query of a download link for a job, valid until `now + ttl`.
export function createDownloadPath({ jobId, secret, now = Date.now(), ttl = DOWNLOAD_LINK_TTL_MS }) {
  if (!secret) throw new Error("No signing secret is configured");
  const expires = now + ttl;
  return `/download/report/${encodeURIComponent(jobId)}?expires=${expires}&sig=${sign(secret, jobId, expires)}`;
}

// True when `sig` was made for this job and has not expired.
export function verifyDownload({ jobId, expires, sig, secret, now = Date.now() }) {
  if (!secret || !jobId || !sig) return false;
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
  const expected = Buffer.from(sign(secret, jobId, expiresAt));
  const given = Buffer.from(String(sig));
  return expected.length === given.length && timingSafeEqual(expected, given);
}
