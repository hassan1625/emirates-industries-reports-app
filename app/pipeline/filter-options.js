// Choices offered by the request screen's select filters. The filters
// themselves come from the report config; this file only knows where each
// filter's choices come from.
//   salesChannel -> the channels in app/config/store.js
//   posLocation  -> the store's Shopify locations (by id)
//   collection   -> the store's Shopify collections (by title; rows carry names)
//   posStaff     -> staff who sold at the POS, from ShopifyQL (by name)
// A store has dozens of each at most, so one page of 250 is enough.
import { SALES_CHANNEL_NAMES } from "../config/store.js";
import { addDays, todayInZone } from "./dates.js";
import { STORE_TIME_ZONE } from "../config/store.js";
import { fetchStaffNames } from "./staff.js";

const OPTIONS_QUERY = `#graphql
  query reportFilterOptions {
    locations(first: 250, includeInactive: true) { edges { node { id name isActive } } }
    collections(first: 250) { edges { node { id title } } }
  }`;

const byLabel = (a, b) => a.label.localeCompare(b.label);

export const channelOptions = (names = SALES_CHANNEL_NAMES) => Object.entries(names).map(([value, label]) => ({ value, label })).sort(byLabel);

// Shopify spells one location with a double space; show it tidily (grouping
// elsewhere uses the id, never the name).
const tidy = (name) => String(name).replace(/\s+/g, " ").trim();

export function toOptions({ locations, collections }) {
  return {
    posLocation: locations
      .map((l) => ({ value: l.id, label: l.isActive ? tidy(l.name) : `${tidy(l.name)} (inactive)` }))
      .sort(byLabel),
    collection: [...new Set(collections.map((c) => c.title))].map((title) => ({ value: title, label: title })).sort(byLabel),
  };
}

// Staff names come from ShopifyQL, which is slower than the other lookups and
// rarely changes: keep them for a few minutes. A failure leaves the filter with
// no choices rather than breaking the whole screen.
const STAFF_CACHE_MS = 10 * 60 * 1000;
const STAFF_LOOKBACK_DAYS = 400;
const staffCache = new Map();

export async function loadStaffOptions(admin, shop, { now = Date.now(), fetchNames = fetchStaffNames } = {}) {
  const cached = staffCache.get(shop);
  if (cached && now - cached.at < STAFF_CACHE_MS) return cached.options;
  try {
    const today = todayInZone(STORE_TIME_ZONE, new Date(now));
    const names = await fetchNames(admin, addDays(today, -STAFF_LOOKBACK_DAYS), today);
    const options = names.map((name) => ({ value: name, label: name }));
    staffCache.set(shop, { at: now, options });
    return options;
  } catch (error) {
    console.error("POS staff options could not be loaded:", error.message);
    return cached?.options ?? [];
  }
}

// Options for every select filter, keyed by filter key.
export async function loadFilterOptions(admin, shop) {
  const response = await admin.graphql(OPTIONS_QUERY);
  const { data, errors } = await response.json();
  if (errors?.length) throw new Error(`Filter options lookup failed: ${JSON.stringify(errors)}`);
  const nodes = (connection) => connection.edges.map((edge) => edge.node);
  return { salesChannel: channelOptions(), ...toOptions({ locations: nodes(data.locations), collections: nodes(data.collections) }), posStaff: shop ? await loadStaffOptions(admin, shop) : [] };
}

// { filterKey: [values] }, for server-side validation of a submitted request.
export const allowedValues = (options) => Object.fromEntries(Object.entries(options).map(([key, list]) => [key, list.map((o) => o.value)]));
