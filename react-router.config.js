// React Router refuses a POST (a form submit or "Generate report") when the Origin header's host
// differs from the host the server believes it runs on. Behind the web server's proxy the server
// sees 127.0.0.1:3000, so without this every POST from the public address fails with
// "400 Bad Request". The app's own public address (SHOPIFY_APP_URL) is therefore an allowed origin.
// It is read when the app is BUILT (deploy/deploy.sh gives the build the .env settings).
// eslint-disable-next-line no-undef
const appUrl = process.env.SHOPIFY_APP_URL;
const publicHost = appUrl ? new URL(appUrl).host : null;

export default {
  allowedActionOrigins: publicHost ? [publicHost] : [],
};
