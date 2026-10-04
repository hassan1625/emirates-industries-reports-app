// Location attribution for Report 1 and the location-based reports (Dev Plan
// Step 20).
//
// An order is reported under:
//   1. its own POS location (`retailLocation`), when it has one;
//   2. otherwise the location its sales channel is mapped to. Online Store
//      (`web`) and Mobile App (`304980787201`) both map to the Head office
//      location, as the client confirmed;
//   3. otherwise no location (null), counted as "unmapped". Draft orders
//      (`shopify_draft_order`) are in this group until the client decides.
//
// The channel -> location mapping is DATA (the LocationMapping table), not
// code, so adding a physical location or changing the target is a row edit.
// Locations are identified by Shopify id; names are display only. Any two
// spellings of the same location (Shopify's name contains a double space) are
// the same bucket because grouping uses the id.

// Seed values only: used to create missing rows, never to overwrite edits.
export const DEFAULT_MAPPINGS = Object.freeze([
  { sourceName: "web", label: "Online Store" },
  { sourceName: "304980787201", label: "Mobile App" },
]);
export const DEFAULT_TARGET_LOCATION_NAME = "Emirates Industries L.L.C, Head office";

// Collapses runs of whitespace and trims, so "L.L.C,  Head office" (two
// spaces, as Shopify stores it) matches "L.L.C, Head office".
export const normalizeName = (name) => String(name ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const LOCATIONS_QUERY = `#graphql
  query locationsForMapping {
    locations(first: 250, includeInactive: true) {
      edges { node { id name isActive } }
    }
  }`;

export async function fetchLocations(admin) {
  const response = await admin.graphql(LOCATIONS_QUERY);
  const { data, errors } = await response.json();
  if (errors?.length) throw new Error(`Location lookup failed: ${JSON.stringify(errors)}`);
  return data.locations.edges.map((edge) => edge.node);
}

// Finds a location by name, ignoring case and repeated spaces. Prefers an
// active location if two share a name. Null when there is none.
export function findLocationByName(locations, name) {
  const wanted = normalizeName(name);
  const matches = locations.filter((location) => normalizeName(location.name) === wanted);
  return matches.find((location) => location.isActive) ?? matches[0] ?? null;
}

// Creates the default rows that are missing for `shop`; rows that already
// exist (possibly edited) are left alone. Throws if the target location does
// not exist in Shopify, so a typo is loud and nothing half-written remains.
export async function ensureDefaultMappings({ db, admin, shop, targetName = DEFAULT_TARGET_LOCATION_NAME, fetchLocationsImpl = fetchLocations }) {
  const existing = await db.locationMapping.findMany({ where: { shop } });
  const have = new Set(existing.map((row) => row.sourceName));
  const missing = DEFAULT_MAPPINGS.filter((mapping) => !have.has(mapping.sourceName));
  if (missing.length === 0) return { created: [], existing: existing.length };

  const target = findLocationByName(await fetchLocationsImpl(admin), targetName);
  if (!target) throw new Error(`Location "${targetName}" was not found in Shopify; no mappings were created`);

  const created = [];
  for (const mapping of missing) {
    await db.locationMapping.create({ data: { shop, sourceName: mapping.sourceName, locationId: target.id, locationName: target.name } });
    created.push(mapping.sourceName);
  }
  return { created, existing: existing.length };
}

// Adds or changes one mapping (the hook for a future settings screen).
export function setLocationMapping({ db, shop, sourceName, locationId, locationName }) {
  return db.locationMapping.upsert({
    where: { shop_sourceName: { shop, sourceName } },
    create: { shop, sourceName, locationId, locationName },
    update: { locationId, locationName },
  });
}

// Map<sourceName, { locationId, locationName }> for one shop.
export async function loadMappings(db, shop) {
  const rows = await db.locationMapping.findMany({ where: { shop } });
  return new Map(rows.map((row) => [row.sourceName, { locationId: row.locationId, locationName: row.locationName }]));
}

// { locationId, locationName, via } for an order. `via` says why:
// "retail" (its own POS location), "mapped" (channel mapping) or "unmapped".
export function resolveOrderLocation(order, mappings) {
  if (order.retailLocation?.id) {
    return { locationId: order.retailLocation.id, locationName: order.retailLocation.name, via: "retail" };
  }
  const mapped = mappings.get(order.sourceName);
  if (mapped) return { locationId: mapped.locationId, locationName: mapped.locationName, via: "mapped" };
  return { locationId: null, locationName: null, via: "unmapped" };
}

// Yields each order with `location` set. Input orders are left untouched.
export async function* attachLocations(orders, mappings) {
  for await (const order of orders) yield { ...order, location: resolveOrderLocation(order, mappings) };
}

// Counts how orders resolved, per channel and per location id. Counts only.
export async function summarizeLocations(orders, mappings) {
  const stats = { orders: 0, via: { retail: 0, mapped: 0, unmapped: 0 }, unmappedBySource: {}, byLocation: {} };
  for await (const order of orders) {
    stats.orders += 1;
    const { locationId, locationName, via } = resolveOrderLocation(order, mappings);
    stats.via[via] += 1;
    if (via === "unmapped") stats.unmappedBySource[order.sourceName ?? "null"] = (stats.unmappedBySource[order.sourceName ?? "null"] ?? 0) + 1;
    else {
      const entry = (stats.byLocation[locationId] ??= { names: new Set(), orders: 0 });
      entry.names.add(locationName);
      entry.orders += 1;
    }
  }
  return {
    ...stats,
    byLocation: Object.fromEntries(Object.entries(stats.byLocation).map(([id, v]) => [id, { orders: v.orders, names: [...v.names] }])),
  };
}
