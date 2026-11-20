/**
 * The pure logic, checked without a network.
 *
 * The smoke test needs a browser, a built site and the published data. These
 * need none of that, so they run in a second, on any machine, offline.
 *
 *   pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { windowDates, blocksFor, PAST_DAYS, FORECAST_DAYS } from "../src/weather.js";
import { seasonFit, speciesIndex, speciesFor } from "../src/species.js";
import {
  MODEL, OPTIMIST, ramp, trapezoid, band, BANDS, scoreForDay, detectTriggers, expectedFlush, addDays,
} from "../src/score.js";

// ------------------------------------------------------------- weather file

test("the window puts today right after the past days", () => {
  const days = windowDates("2026-11-20");
  assert.equal(days.length, PAST_DAYS + FORECAST_DAYS);
  assert.equal(days[PAST_DAYS], "2026-11-20");
  assert.equal(days[PAST_DAYS - 1], "2026-11-19");
  assert.equal(days.at(-1), "2026-11-26");
});

test("the window crosses a daylight-saving change without skipping a day", () => {
  const days = windowDates("2026-11-01"); // the clocks went back on 25 October
  assert.ok(days.includes("2026-10-25") && days.includes("2026-10-26"));
  assert.equal(new Set(days).size, days.length, "no day twice");
});

/** `n` dates from `first`. */
const daysFrom = (first, n) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${first}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

/** A file whose days run from `first`, one value per day: its own day of month. */
function file(first, n) {
  const daily = daysFrom(first, n);
  return {
    generated: `${first}T04:00:00Z`,
    time: { daily, hourly: daily.map((d) => `${d}T00:00`) },
    forests: { a: "48.1,-1.6", b: "48.1,-1.6", c: "48.2,-1.7" },
    cells: {
      "48.1,-1.6": {
        daily: { precipitation_sum: daily.map((d) => Number(d.slice(8))) },
        hourly: { soil_moisture_3_to_9cm: daily.map(() => 0.2) },
      },
      "48.2,-1.7": {
        daily: { precipitation_sum: daily.map(() => 0) },
        hourly: { soil_moisture_3_to_9cm: daily.map(() => 0.3) },
      },
    },
  };
}

test("a fresh file lands today at PAST_DAYS", () => {
  const today = "2026-11-20";
  const f = file(windowDates(today)[0], PAST_DAYS + FORECAST_DAYS);
  const [a] = blocksFor(f, [{ id: "a" }], today);
  assert.equal(a.daily.time[PAST_DAYS], today);
  assert.equal(a.daily.precipitation_sum[PAST_DAYS], 20);
});

test("a file a day late shifts by one and loses its last forecast day", () => {
  const today = "2026-11-20";
  const f = file(windowDates("2026-11-19")[0], PAST_DAYS + FORECAST_DAYS);
  const [a] = blocksFor(f, [{ id: "a" }], today);
  assert.equal(a.daily.time[PAST_DAYS], today, "today stays where the views expect it");
  assert.equal(a.daily.precipitation_sum[PAST_DAYS], 20, "and carries today's value");
  assert.equal(a.daily.precipitation_sum.at(-1), null, "the day the file never had is missing");
});

test("forests share their cell's block, and an unknown forest gets an empty one", () => {
  const today = "2026-11-20";
  const f = file(windowDates(today)[0], PAST_DAYS + FORECAST_DAYS);
  const [a, b, c, x] = blocksFor(f, [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "x" }], today);
  assert.equal(a, b, "same cell, same block");
  assert.notEqual(a, c);
  assert.equal(c.hourly.soil_moisture_3_to_9cm[0], 0.3);
  assert.equal(x.daily.time.length, PAST_DAYS + FORECAST_DAYS);
  assert.equal(x.daily.precipitation_sum, undefined, "no values for a forest the file lacks");
});

// ------------------------------------------------------------------ the model

test("ramps and trapezoids hold at their bounds", () => {
  assert.equal(ramp(0, 10, 40), 0);
  assert.equal(ramp(40, 10, 40), 1);
  assert.equal(ramp(25, 10, 40), 0.5);
  const t = MODEL.soilTemp;
  assert.equal(trapezoid(t.dead, t), 0, "dormant at the cold edge");
  assert.equal(trapezoid(t.hot, t), 0, "dormant at the hot edge");
  assert.equal(trapezoid((t.min + t.max) / 2, t), 1, "full on the plateau");
});

test("bands cover the whole range in order", () => {
  assert.equal(band(100).key, "excellent");
  assert.equal(band(0).key, "none");
  assert.equal(band(null).key, "unknown");
  for (const b of BANDS) assert.equal(band(b.min).key, b.key, `${b.key} starts at its own floor`);
});

/** A series of `n` days, every field constant unless overridden per day. */
function series(n, base, overrides = {}) {
  return Array.from({ length: n }, (_, i) => ({
    date: addDays("2026-08-01", i),
    ...base,
    ...(overrides[i] ?? {}),
  }));
}

const IDEAL = { precip: 0, tmin: 10, soilTemp: 15, soilTempFit: 1, moisture: 0.3, moistureDeep: 0.35 };

test("no incubation rain means no index, however perfect the rest", () => {
  const s = series(40, IDEAL);
  const entry = scoreForDay(s, 39);
  assert.equal(entry.score, 0, "Liebig: one factor at zero zeroes the whole thing");
  assert.equal(entry.factors.rain, 0);
});

test("rain in the response window produces an index", () => {
  const wet = Object.fromEntries(
    [25, 26, 27].map((i) => [i, { precip: 20 }]), // about two weeks before day 39
  );
  const entry = scoreForDay(series(40, IDEAL, wet), 39);
  assert.ok(entry.score > 40, `an index of ${entry.score} from a real episode`);
});

test("rain too recent to have worked does not count", () => {
  const justNow = Object.fromEntries([37, 38, 39].map((i) => [i, { precip: 20 }]));
  assert.equal(scoreForDay(series(40, IDEAL, justNow), 39).score, 0);
});

test("frost in the last days destroys the index", () => {
  const wet = Object.fromEntries([25, 26, 27].map((i) => [i, { precip: 20 }]));
  const frozen = { ...wet, 38: { tmin: MODEL.frost.threshold - 1 } };
  assert.ok(scoreForDay(series(40, IDEAL, wet), 39).score > 0);
  assert.equal(scoreForDay(series(40, IDEAL, frozen), 39).score, 0);
});

test("a dry spell since the trigger rain costs index", () => {
  const wet = Object.fromEntries([25, 26, 27].map((i) => [i, { precip: 20 }]));
  const dried = { ...wet };
  for (let i = 30; i < 36; i++) dried[i] = { moisture: 0.05, moistureDeep: 0.1 };
  const wetScore = scoreForDay(series(40, IDEAL, wet), 39).score;
  const dryScore = scoreForDay(series(40, IDEAL, dried), 39).score;
  assert.ok(dryScore < wetScore, `${dryScore} below ${wetScore}`);
});

test("days without their own response window cannot be scored", () => {
  assert.equal(scoreForDay(series(40, IDEAL), MODEL.kernel.max - 1), null);
  assert.notEqual(scoreForDay(series(40, IDEAL), MODEL.kernel.max), null);
});

test("trigger episodes are found, and their flush window follows the rain", () => {
  const s = series(20, IDEAL, { 5: { precip: 12 }, 6: { precip: 15 } });
  const [episode] = detectTriggers(s);
  assert.equal(episode.mm, 27);
  assert.equal(episode.start, s[5].date);
  assert.equal(episode.end, s[6].date);
  assert.equal(episode.flushStart, addDays(s[6].date, MODEL.trigger.flush[0]));
});

test("a drizzle is not an episode", () => {
  assert.deepEqual(detectTriggers(series(20, IDEAL, { 5: { precip: 2 } })), []);
});

test("the optimists' index counts a light rain the cautious one ignores", () => {
  const light = Object.fromEntries([25, 26].map((i) => [i, { precip: 3 }]));
  const s = series(40, IDEAL, light);
  assert.equal(scoreForDay(s, 39).score, 0);
  assert.ok(scoreForDay(s, 39, OPTIMIST).score > 0);
});

test("the optimists' index never reads below the cautious one", () => {
  const wet = Object.fromEntries([25, 26, 27].map((i) => [i, { precip: 8 }]));
  const s = series(40, IDEAL, wet);
  assert.ok(scoreForDay(s, 39, OPTIMIST).score >= scoreForDay(s, 39).score);
});

test("a recent downpour announces its flush while the index is still nil", () => {
  const s = series(40, IDEAL, { 37: { precip: 15 }, 38: { precip: 15 } });
  assert.equal(scoreForDay(s, 39).score, 0);
  const flush = expectedFlush(s, 39);
  assert.equal(flush.flushStart, addDays(s[38].date, MODEL.trigger.flush[0]));
});

test("a flush whose window has passed is not expected any more", () => {
  const s = series(40, IDEAL, { 5: { precip: 15 }, 6: { precip: 15 } });
  assert.equal(expectedFlush(s, 39), null);
});

// ------------------------------------------------------------------ species

test("the season wraps over the new year and softens at its edges", () => {
  assert.equal(seasonFit(10, [9, 10, 11]), 1);
  assert.equal(seasonFit(12, [9, 10, 11]), 0.5, "the month after");
  assert.equal(seasonFit(1, [10, 11, 12]), 0.5, "across the new year");
  assert.ok(seasonFit(4, [9, 10, 11]) < 0.5, "far off");
  assert.ok(seasonFit(4, [9, 10, 11]) > 0, "but not impossible");
});

/** A month of damp, mild days ending on `last`: the general index is high. */
function goodSeries(last, soilTemp = 14) {
  const n = 40;
  return Array.from({ length: n }, (_, i) => ({
    date: addDays(last, i - n + 1),
    precip: n - 1 - i >= 12 && n - 1 - i <= 15 ? 8 : 0,
    tmin: 8,
    soilTemp,
    soilTempFit: null,
    moisture: 0.26,
    moistureDeep: 0.33,
  }));
}

const cepe = { id: "cepe", soil_temp: { dead: 8, min: 11, max: 16, hot: 21 }, season: [8, 9, 10, 11] };

test("a species with no host scores nothing, whatever the weather", () => {
  const series = goodSeries("2026-10-15");
  assert.equal(speciesIndex(series, series.length - 1, cepe, 0).score, 0);
});

test("host share and season weigh the species index down, never up", () => {
  const series = goodSeries("2026-10-15");
  const i = series.length - 1;
  const full = speciesIndex(series, i, cepe, 1);
  assert.ok(full.score > 50, `good weather, full host, in season (${full.score})`);
  assert.ok(full.score <= full.weather, "never above the weather alone");
  assert.ok(speciesIndex(series, i, cepe, 0.2).score < full.score, "fewer hosts, lower");
  const spring = goodSeries("2026-04-15");
  assert.ok(speciesIndex(spring, i, cepe, 1).score < full.score, "off season, lower");
});

test("the species' own thermal window is the one applied", () => {
  const series = goodSeries("2026-10-15", 23); // too warm for the cèpe, fine for a warm species
  const i = series.length - 1;
  const warm = { ...cepe, soil_temp: { dead: 12, min: 16, max: 24, hot: 28 } };
  assert.equal(speciesIndex(series, i, cepe, 1).score, 0);
  assert.ok(speciesIndex(series, i, warm, 1).score > 0);
});

test("a forest of unknown composition gets no answer rather than zeros", () => {
  const table = { species: [cepe] };
  assert.equal(speciesFor({ hosts: null, series: goodSeries("2026-10-15") }, table, 39), null);
  const rows = speciesFor({ hosts: { cepe: 0.8 }, series: goodSeries("2026-10-15") }, table, 39);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].species.id, "cepe");
});
