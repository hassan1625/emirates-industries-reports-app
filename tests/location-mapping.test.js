import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAPPINGS,
  DEFAULT_TARGET_LOCATION_NAME,
  normalizeName,
  findLocationByName,
  ensureDefaultMappings,
  setLocationMapping,
  loadMappings,
  resolveOrderLocation,
  attachLocations,
  summarizeLocations,
} from "../app/pipeline/location-mapping.js";

const HEAD = { id: "gid://shopify/Location/1", name: "Emirates Industries L.L.C,  Head office", isActive: true }; // two spaces, as Shopify stores it
const ALAIN = { id: "gid://shopify/Location/2", name: "Al Ain", isActive: true };
const LOCATIONS = [ALAIN, HEAD];

// In-memory stand-in for the LocationMapping table.
function fakeDb(rows = []) {
  const table = [...rows];
  return {
    table,
    locationMapping: {
      findMany: async ({ where }) => table.filter((r) => r.shop === where.shop),
      create: async ({ data }) => {
        if (table.some((r) => r.shop === data.shop && r.sourceName === data.sourceName)) throw new Error("Unique constraint");
        table.push({ ...data });
        return data;
      },
      upsert: async ({ where, create, update }) => {
        const key = where.shop_sourceName;
        const row = table.find((r) => r.shop === key.shop && r.sourceName === key.sourceName);
        if (row) return Object.assign(row, update);
        table.push({ ...create });
        return create;
      },
    },
  };
}

describe("names", () => {
  test("normalizeName ignores case and repeated spaces", () => {
    assert.equal(normalizeName("Emirates Industries L.L.C,  Head office"), normalizeName("emirates industries l.l.c, head office"));
  });

  test("findLocationByName matches Shopify's double-spaced name to the single-spaced default", () => {
    assert.equal(findLocationByName(LOCATIONS, DEFAULT_TARGET_LOCATION_NAME).id, HEAD.id);
  });

  test("returns null for an unknown name and prefers an active duplicate", () => {
    assert.equal(findLocationByName(LOCATIONS, "Nowhere"), null);
    const inactive = { ...HEAD, id: "old", isActive: false };
    assert.equal(findLocationByName([inactive, HEAD], HEAD.name).id, HEAD.id);
  });
});

describe("ensureDefaultMappings", () => {
  const fetchLocationsImpl = async () => LOCATIONS;

  test("seeds Online Store and Mobile App to the Head office location id", async () => {
    const db = fakeDb();
    const result = await ensureDefaultMappings({ db, admin: {}, shop: "s", fetchLocationsImpl });
    assert.deepEqual(result.created.sort(), ["304980787201", "web"]);
    assert.deepEqual(db.table.map((r) => [r.sourceName, r.locationId, r.locationName]).sort(), [
      ["304980787201", HEAD.id, HEAD.name],
      ["web", HEAD.id, HEAD.name],
    ]);
  });

  test("running it again changes nothing", async () => {
    const db = fakeDb();
    await ensureDefaultMappings({ db, admin: {}, shop: "s", fetchLocationsImpl });
    const second = await ensureDefaultMappings({ db, admin: {}, shop: "s", fetchLocationsImpl });
    assert.deepEqual(second.created, []);
    assert.equal(db.table.length, 2);
  });

  test("never overwrites a mapping someone edited", async () => {
    const db = fakeDb([{ shop: "s", sourceName: "web", locationId: ALAIN.id, locationName: "Al Ain" }]);
    await ensureDefaultMappings({ db, admin: {}, shop: "s", fetchLocationsImpl });
    assert.equal(db.table.find((r) => r.sourceName === "web").locationId, ALAIN.id);
    assert.equal(db.table.length, 2); // only the missing Mobile App row was added
  });

  test("does not call Shopify when nothing is missing", async () => {
    const db = fakeDb(DEFAULT_MAPPINGS.map((m) => ({ shop: "s", sourceName: m.sourceName, locationId: HEAD.id, locationName: HEAD.name })));
    let calls = 0;
    await ensureDefaultMappings({ db, admin: {}, shop: "s", fetchLocationsImpl: async () => { calls += 1; return LOCATIONS; } });
    assert.equal(calls, 0);
  });

  test("a target that does not exist fails loudly and writes nothing", async () => {
    const db = fakeDb();
    await assert.rejects(ensureDefaultMappings({ db, admin: {}, shop: "s", targetName: "Al Quoz", fetchLocationsImpl }), /"Al Quoz" was not found/);
    assert.equal(db.table.length, 0);
  });

  test("mappings are per shop", async () => {
    const db = fakeDb();
    await ensureDefaultMappings({ db, admin: {}, shop: "a", fetchLocationsImpl });
    await ensureDefaultMappings({ db, admin: {}, shop: "b", fetchLocationsImpl });
    assert.equal(db.table.length, 4);
    assert.equal((await loadMappings(db, "a")).size, 2);
  });
});

describe("setLocationMapping", () => {
  test("adds a new channel mapping and changes an existing one (data edit, no code change)", async () => {
    const db = fakeDb();
    await setLocationMapping({ db, shop: "s", sourceName: "shopify_draft_order", locationId: ALAIN.id, locationName: "Al Ain" });
    await setLocationMapping({ db, shop: "s", sourceName: "shopify_draft_order", locationId: HEAD.id, locationName: HEAD.name });
    assert.equal(db.table.length, 1);
    assert.equal(db.table[0].locationId, HEAD.id);
  });
});

describe("resolveOrderLocation", () => {
  const mappings = new Map([
    ["web", { locationId: HEAD.id, locationName: HEAD.name }],
    ["304980787201", { locationId: HEAD.id, locationName: HEAD.name }],
  ]);

  test("a POS order keeps its own location", () => {
    assert.deepEqual(resolveOrderLocation({ sourceName: "pos", retailLocation: { id: ALAIN.id, name: "Al Ain" } }, mappings), { locationId: ALAIN.id, locationName: "Al Ain", via: "retail" });
  });

  test("Online Store and Mobile App orders go to the mapped location", () => {
    for (const sourceName of ["web", "304980787201"]) {
      assert.deepEqual(resolveOrderLocation({ sourceName, retailLocation: null }, mappings), { locationId: HEAD.id, locationName: HEAD.name, via: "mapped" });
    }
  });

  test("an order's own location wins even if its channel is mapped", () => {
    assert.equal(resolveOrderLocation({ sourceName: "web", retailLocation: { id: ALAIN.id, name: "Al Ain" } }, mappings).via, "retail");
  });

  test("an unmapped channel (draft orders) gets no location, not a guess", () => {
    assert.deepEqual(resolveOrderLocation({ sourceName: "shopify_draft_order", retailLocation: null }, mappings), { locationId: null, locationName: null, via: "unmapped" });
  });

  test("POS and mapped online orders at Head office share one location id", () => {
    const pos = resolveOrderLocation({ sourceName: "pos", retailLocation: { id: HEAD.id, name: HEAD.name } }, mappings);
    const web = resolveOrderLocation({ sourceName: "web", retailLocation: null }, mappings);
    assert.equal(pos.locationId, web.locationId);
  });
});

describe("attachLocations and summarizeLocations", () => {
  const mappings = new Map([["web", { locationId: HEAD.id, locationName: HEAD.name }]]);
  async function* orders() {
    yield { id: "1", sourceName: "pos", retailLocation: { id: ALAIN.id, name: "Al Ain" } };
    yield { id: "2", sourceName: "web", retailLocation: null };
    yield { id: "3", sourceName: "pos", retailLocation: { id: HEAD.id, name: HEAD.name } };
    yield { id: "4", sourceName: "shopify_draft_order", retailLocation: null };
  }

  test("attachLocations adds `location` without changing the order", async () => {
    const out = [];
    for await (const o of attachLocations(orders(), mappings)) out.push(o);
    assert.deepEqual(out.map((o) => o.location.via), ["retail", "mapped", "retail", "unmapped"]);
    assert.equal(out[1].sourceName, "web");
  });

  test("summarizeLocations merges POS and mapped orders under one location id", async () => {
    const stats = await summarizeLocations(orders(), mappings);
    assert.deepEqual(stats.via, { retail: 2, mapped: 1, unmapped: 1 });
    assert.deepEqual(stats.unmappedBySource, { shopify_draft_order: 1 });
    assert.equal(stats.byLocation[HEAD.id].orders, 2);
  });
});
