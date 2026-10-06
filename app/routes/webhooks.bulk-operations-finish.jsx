import { authenticate } from "../shopify.server";
import db from "../db.server";
import { handleBulkOperationsFinish } from "../pipeline/bulk-finish";
import { advanceAndGenerate } from "../pipeline/job-runner";

export const action = async ({ request }) => {
  // Verifies the HMAC; throws 401 for a bad signature.
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // No session means the app was uninstalled: nothing to look up, but answer
  // 200 so Shopify does not keep retrying.
  if (!admin) return new Response();

  // The webhook must be answered quickly, but downloading and parsing an
  // export takes a while. The chain therefore runs in the background (this is
  // a long-lived Node process). If it dies mid-way the job keeps its last
  // stage and the Step 16 poller recovers it.
  const onFinished = (result) => {
    advanceAndGenerate({ db, admin, result })
      .then((outcome) => console.log(`Job ${result.job.id} (${result.which} export): ${outcome.action}`))
      .catch((error) => console.error(`Job ${result.job.id} chain failed:`, error));
  };

  const result = await handleBulkOperationsFinish({ shop, payload, admin, db, onFinished });
  if (!result.handled) {
    console.log(`Ignored ${topic} for ${shop}: ${result.reason}`);
  } else {
    console.log(`Bulk operation ${result.operation.id} (${result.which}) is ${result.operation.status}`);
  }

  return new Response();
};
