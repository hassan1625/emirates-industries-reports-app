// Where finished reports are kept and how they are downloaded (Dev Plan Step 28).
//
// Two modes, chosen by the environment:
//   * S3    when REPORT_S3_BUCKET is set: the finished file is uploaded to the
//           bucket and downloads use a short-lived presigned link straight from S3.
//           Credentials come from the usual AWS settings (AWS_ACCESS_KEY_ID /
//           AWS_SECRET_ACCESS_KEY, or an IAM role on the server) and the region
//           from REPORT_S3_REGION (or AWS_REGION).
//   * local otherwise (development): the file stays under the storage folder and
//           downloads use the app's own signed link (see download-token.js).
//
// A job's `resultFileUrl` says which: "local:<path under the storage root>" or
// "s3://<bucket>/<key>". The rest of the app only calls this module.
//
// The bulk exports (orders, events, products) are working files and stay on the
// server's disk; only the finished report must outlive a restart.
import { createDownloadPath } from "./download-token.js";
import { fromLocalUrl, toLocalUrl } from "./storage.js";
import { reportFileName } from "./report-file.js";
import { unlink } from "node:fs/promises";

export const S3_LINK_TTL_SECONDS = 10 * 60;
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const parseS3Url = (url) => {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(url ?? "");
  return match ? { bucket: match[1], key: match[2] } : null;
};
export const toS3Url = (bucket, key) => `s3://${bucket}/${key}`;

// The real S3 calls, loaded only when S3 is in use so local development never
// needs the AWS packages at runtime.
export function createAwsS3({ region, loader = () => Promise.all([import("@aws-sdk/client-s3"), import("@aws-sdk/lib-storage"), import("@aws-sdk/s3-request-presigner")]) } = {}) {
  let ready;
  const sdk = () =>
    (ready ??= loader().then(([s3, storage, presigner]) => ({ ...s3, Upload: storage.Upload, getSignedUrl: presigner.getSignedUrl, client: new s3.S3Client(region ? { region } : {}) })));
  return {
    async upload({ bucket, key, filePath, contentType }) {
      const { createReadStream } = await import("node:fs");
      const { Upload, client } = await sdk();
      // Multipart upload, so a large report is streamed instead of held in memory.
      await new Upload({ client, params: { Bucket: bucket, Key: key, Body: createReadStream(filePath), ContentType: contentType } }).done();
    },
    async presign({ bucket, key, fileName, expiresIn }) {
      const { GetObjectCommand, getSignedUrl, client } = await sdk();
      const command = new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentType: XLSX_TYPE, ResponseContentDisposition: `attachment; filename="${fileName}"` });
      return getSignedUrl(client, command, { expiresIn });
    },
    async remove({ bucket, key }) {
      const { DeleteObjectCommand, client } = await sdk();
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

// env  the environment (process.env by default)
// s3   { upload, presign, remove }, injectable for tests
export function createReportStore({ env = process.env, s3 } = {}) {
  const bucket = env.REPORT_S3_BUCKET || null;
  const region = env.REPORT_S3_REGION || env.AWS_REGION || undefined;
  let client = s3;
  const aws = () => (client ??= createAwsS3({ region }));

  return {
    mode: bucket ? "s3" : "local",
    bucket,

    // Keeps the finished file at `localPath`; resolves to the job's resultFileUrl.
    // In S3 mode the local copy is removed once the upload succeeded.
    async save({ jobId, localPath, fileName }) {
      if (!bucket) return toLocalUrl(localPath);
      const key = `reports/${jobId}/${fileName}`;
      await aws().upload({ bucket, key, filePath: localPath, contentType: XLSX_TYPE });
      await unlink(localPath).catch(() => {});
      return toS3Url(bucket, key);
    },

    // { url } a browser can follow to download the job's report, valid a few
    // minutes. For S3 it is a presigned S3 link; for local files, the app's own.
    async downloadLink({ job, secret, now = Date.now() }) {
      const s3Location = parseS3Url(job.resultFileUrl);
      if (s3Location) {
        const url = await aws().presign({ ...s3Location, fileName: reportFileName(job), expiresIn: S3_LINK_TTL_SECONDS });
        return { url };
      }
      if (fromLocalUrl(job.resultFileUrl)) return { url: createDownloadPath({ jobId: job.id, secret, now }) };
      throw new Error("The report file is not available");
    },

    // Deletes a report file (used by the retention cleanup). Missing files are fine.
    async remove(resultFileUrl) {
      const s3Location = parseS3Url(resultFileUrl);
      if (s3Location) return aws().remove(s3Location);
      const path = fromLocalUrl(resultFileUrl);
      if (path) await unlink(path).catch(() => {});
      return undefined;
    },
  };
}

// The store the app uses, built from the environment on first use.
let shared;
export const reportStore = () => (shared ??= createReportStore());
