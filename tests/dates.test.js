import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isValidDateString, zonedTimeToUtc, startOfDayUtc, endOfDayUtc, todayInZone, addDays, daysBetween } from "../app/pipeline/dates.js";

describe("isValidDateString", () => {
  test("accepts real dates", () => {
    for (const d of ["2026-09-30", "2024-02-29", "2026-01-01"]) assert.equal(isValidDateString(d), true, d);
  });
  test("rejects impossible or malformed dates", () => {
    for (const d of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-9-1", "26-09-30", "", null, undefined, 20260930, "2026-09-30T00:00:00Z"]) assert.equal(isValidDateString(d), false, String(d));
  });
});

describe("store-day boundaries (Asia/Muscat, UTC+4, no daylight saving)", () => {
  test("a store day starts at 20:00 UTC the evening before", () => {
    assert.equal(startOfDayUtc("2026-09-01", "Asia/Muscat").toISOString(), "2026-08-31T20:00:00.000Z");
  });
  test("a store day ends at 19:59:59 UTC", () => {
    assert.equal(endOfDayUtc("2026-09-30", "Asia/Muscat").toISOString(), "2026-09-30T19:59:59.000Z");
  });
  test("an order at 00:30 local on 1 Sept (20:30 UTC on 31 Aug) falls inside September", () => {
    const order = new Date("2026-08-31T20:30:00Z");
    assert.ok(order >= startOfDayUtc("2026-09-01", "Asia/Muscat") && order <= endOfDayUtc("2026-09-30", "Asia/Muscat"));
  });
  test("an order at 23:59:59 local on 30 Sept is inside, one second later is not", () => {
    const end = endOfDayUtc("2026-09-30", "Asia/Muscat");
    assert.ok(new Date("2026-09-30T19:59:59Z") <= end);
    assert.ok(new Date("2026-09-30T20:00:00Z") > end);
  });
});

describe("zonedTimeToUtc in other zones", () => {
  test("UTC is a no-op", () => assert.equal(zonedTimeToUtc("2026-09-01", "12:00:00", "UTC").toISOString(), "2026-09-01T12:00:00.000Z"));
  test("a zone behind UTC (New York, summer)", () => assert.equal(zonedTimeToUtc("2026-07-01", "00:00:00", "America/New_York").toISOString(), "2026-07-01T04:00:00.000Z"));
  test("the same zone in winter", () => assert.equal(zonedTimeToUtc("2026-01-01", "00:00:00", "America/New_York").toISOString(), "2026-01-01T05:00:00.000Z"));
  test("a half-hour zone (India)", () => assert.equal(zonedTimeToUtc("2026-09-01", "00:00:00", "Asia/Kolkata").toISOString(), "2026-08-31T18:30:00.000Z"));
  test("across a daylight-saving change the day still starts at local midnight", () => {
    // New York springs forward on 2026-03-08; midnight that day is still EST (UTC-5).
    assert.equal(zonedTimeToUtc("2026-03-08", "00:00:00", "America/New_York").toISOString(), "2026-03-08T05:00:00.000Z");
    assert.equal(zonedTimeToUtc("2026-03-09", "00:00:00", "America/New_York").toISOString(), "2026-03-09T04:00:00.000Z");
  });
});

describe("day arithmetic", () => {
  test("todayInZone follows the zone's clock, not UTC's", () => {
    const now = new Date("2026-09-30T21:00:00Z"); // 01:00 on 1 Oct in Muscat
    assert.equal(todayInZone("Asia/Muscat", now), "2026-10-01");
    assert.equal(todayInZone("UTC", now), "2026-09-30");
  });
  test("addDays crosses month and year ends", () => {
    assert.equal(addDays("2026-09-01", -29), "2026-08-03");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  });
  test("daysBetween", () => {
    assert.equal(daysBetween("2026-09-01", "2026-09-30"), 29);
    assert.equal(daysBetween("2026-09-01", "2026-09-01"), 0);
  });
});
