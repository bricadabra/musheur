/**
 * The weather, read from a static file per department.
 *
 * Fetched once a day upstream and published next to the other data
 * (`weather/<dept>.json`), so the application asks no weather service at all:
 * no quota to run into, no third party seeing visitors, and one small download
 * per department, cached by the browser.
 *
 * The file holds one block per grid cell of 0.1°, requested at the
 * area-weighted centre of the forests it covers, and says which cell stands
 * for which forest. Dates are stored once per file:
 *
 *   { generated, time: { daily, hourly }, forests: { id: cellKey },
 *     cells: { cellKey: { daily: { var: [...] }, hourly: { var: [...] } } } }
 *
 * Weather data by Open-Meteo.com, CC BY 4.0.
 */

import { CDN, getJSON } from "./data.js";
import { MODEL } from "./score.js";

// Days of history the charts show.
export const HISTORY_DAYS = 31;
// The index for a given day needs the rain that fell up to `kernel.max` days
// earlier, so the series reaches that much further back than the charts
// display. Without this warm-up the oldest weeks of every chart would be blank.
export const PAST_DAYS = HISTORY_DAYS + MODEL.kernel.max;
// Soil moisture and soil temperature stop being forecast around day +7, and the
// index needs both. This count includes today, hence offsets 0 to
// FORECAST_DAYS - 1.
export const FORECAST_DAYS = 7;

// Past this age the file is shown as late. Published around 05:00 Paris time,
// so a normal day never sees more than ~30 hours.
export const STALE_MS = 36 * 3600 * 1000;

/** Today in France, as YYYY-MM-DD, whatever the reader's clock zone. */
export const parisDate = (date = new Date()) =>
  date.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

/** The dates the application works on: PAST_DAYS before today, the forecast after. */
export function windowDates(today = parisDate()) {
  const base = new Date(`${today}T12:00:00Z`);
  return Array.from({ length: PAST_DAYS + FORECAST_DAYS }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i - PAST_DAYS);
    return d.toISOString().slice(0, 10);
  });
}

/** One department's weather file. */
export const loadWeather = (code, { signal } = {}) =>
  getJSON(`${CDN}/weather/${code}.json`, { signal });

/**
 * One block per forest, in the shape `buildSeries` reads (Open-Meteo's).
 *
 * The daily rows are laid on today's window rather than the file's own: today
 * must sit at index PAST_DAYS whatever day the file was produced, so a file a
 * day late shifts by one and its last forecast day shows as missing instead of
 * every day being labelled wrong. Hourly rows are bucketed by date downstream,
 * so they pass through as they are.
 *
 * A forest the file does not know gets an empty block: it lists without an
 * index rather than breaking its department.
 */
export function blocksFor(file, forests, today = parisDate()) {
  const days = windowDates(today);
  const at = new Map(file.time.daily.map((d, i) => [d, i]));
  const built = new Map();

  const block = (key) => {
    const cell = file.cells[key];
    if (!cell) return null;
    const daily = { time: days };
    for (const [name, values] of Object.entries(cell.daily)) {
      daily[name] = days.map((d) => (at.has(d) ? values[at.get(d)] : null));
    }
    return { daily, hourly: { time: file.time.hourly, ...cell.hourly } };
  };

  const empty = { daily: { time: days }, hourly: { time: [] } };
  return forests.map((forest) => {
    const key = file.forests[forest.id];
    if (!built.has(key)) built.set(key, block(key));
    return built.get(key) ?? empty;
  });
}
