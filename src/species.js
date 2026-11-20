/**
 * Conditions per mushroom species, for the enthusiasts' section of the sheet.
 *
 * The knowledge table (`species.json`, published with the data) says, for each
 * species, which trees it grows under, the soil temperatures it fruits at and
 * its months. The data side has already turned the first into a share of host
 * trees per forest (`forest.hosts`). What is left here is the day:
 *
 *   weather  the general index of score.js, with the species' own thermal
 *            trapezoid instead of the general one: same rain kernel, same
 *            moisture and continuity rules, same frost;
 *   host     share of the forest under its host trees, 0 to 1;
 *   season   1 in its months, 0.5 the month either side, little otherwise.
 *
 * The weather index is the base, and host and season can only lower it:
 *
 *   index = weather × √host × season
 *
 * Never above the weather alone — a weighted geometric mean of the three would
 * lift a weather index of 50 to 66 for a species with full hosts in season,
 * promising more than the general index does. No host or no weather means no
 * fruiting, whatever the rest says. The square root keeps a forest half under
 * host trees at 71 % rather than 50 %: half a forest of oaks is plenty.
 *
 * This says the conditions favour a species. It never says the species is
 * there, and it is no help to identify one — the sheet says so next to it.
 *
 * Pure, like score.js: no DOM, no fetch, no words.
 */

import { MODEL, scoreForDay } from "./score.js";

export const HOST_EXPONENT = 0.5;

// Off-season is not impossible (a mild December, an early summer storm), so it
// weighs the index down rather than zeroing it.
const SEASON = { in: 1, edge: 0.5, out: 0.15 };

/** How much `month` (1-12) belongs to `months`, wrapping over the new year. */
export function seasonFit(month, months) {
  if (months.includes(month)) return SEASON.in;
  const prev = month === 1 ? 12 : month - 1;
  const next = month === 12 ? 1 : month + 1;
  return months.includes(prev) || months.includes(next) ? SEASON.edge : SEASON.out;
}

/**
 * The series as the species model reads it.
 *
 * The general series carries an hourly thermal fitness computed against the
 * general trapezoid; it would win over the species' own. Without it the model
 * falls back on the daily mean, which for the index means at most a point or
 * two — see `thermalFitByDay` in score.js.
 */
const dailyOnly = (series) => series.map((row) => ({ ...row, soilTempFit: null }));

/** Index for one species on day `i`, or null when the day cannot be scored. */
export function speciesIndex(series, i, species, host) {
  if (!host) return { score: 0, weather: null, host: 0, season: null };
  const entry = scoreForDay(series, i, { ...MODEL, soilTemp: species.soil_temp });
  if (!entry) return null;
  const season = seasonFit(Number(entry.date.slice(5, 7)), species.season);
  const score = Math.round(entry.score * host ** HOST_EXPONENT * season);
  return { score, weather: entry.score, host, season };
}

/**
 * Every species with a host in the forest, best first, for day `i`.
 * Null when the forest's composition is unknown: no answer rather than zeros.
 */
export function speciesFor(forest, table, i) {
  if (!table || !forest.hosts) return null;
  const series = dailyOnly(forest.series);
  return table.species
    .filter((sp) => forest.hosts[sp.id] > 0)
    .map((sp) => ({ species: sp, ...speciesIndex(series, i, sp, forest.hosts[sp.id]) }))
    .filter((r) => r.score != null)
    .sort((a, b) => b.score - a.score);
}
