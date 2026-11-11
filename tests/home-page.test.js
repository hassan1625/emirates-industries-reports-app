// The front page of the app's address: no template text or sign-in form, and Shopify's
// ?shop=... visits still go straight to the app. Renders the real route through Vite.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("..", import.meta.url));
let vite;
let route;

before(async () => {
  vite = await createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: "automatic" } });
  route = await vite.ssrLoadModule("/app/routes/_index/route.jsx");
});
after(async () => {
  await vite.close();
});

test("the front page names the app and says where to open it, with no template text or sign-in form", () => {
  const html = renderToStaticMarkup(createElement(route.default));
  assert.match(html, /Emirates Custom Report App/);
  assert.match(html, /Open the app from the\s+Shopify admin/);
  assert.doesNotMatch(html, /\[your app\]|Product feature|Shop domain|<form|<input/);
});

test("a visit with ?shop= (how Shopify opens the app) is sent to /app with the same query", async () => {
  const request = new Request("https://reporting.emiratesind.com/?shop=emirates-industries.myshopify.com&host=abc");
  const thrown = await route.loader({ request }).then(() => null, (response) => response);
  assert.equal(thrown.status, 302);
  assert.equal(thrown.headers.get("Location"), "/app?shop=emirates-industries.myshopify.com&host=abc");
});

test("a plain visit just shows the page", async () => {
  assert.equal(await route.loader({ request: new Request("https://reporting.emiratesind.com/") }), null);
});
