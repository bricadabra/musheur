/**
 * Where the data comes from: bricadabra/musheur-cdn, served by GitHub Pages
 * next to the application (same origin in production, so no CORS question),
 * produced by a separate pipeline and refreshed every day for the weather.
 * `VITE_CDN` points elsewhere, e.g. a local copy:
 *
 *   VITE_CDN=http://localhost:4000 pnpm dev
 *
 * Two layers that join on `id`, and never mix:
 *
 *   forests.pmtiles         the outlines, as vector tiles. The map reads
 *                           them by HTTP range request and only ever
 *                           fetches the tiles on screen.
 *   indicators/<dept>.json  everything measurable about each forest,
 *                           indexed by id, one file per department.
 *
 * That split is why picking a department costs one small fetch instead of a
 * national download, and why colouring the map by a different indicator never
 * reloads a single outline.
 *
 * `manifest.json` describes the fields, the sources and the departments.
 * `weather/<dept>.json` is read by weather.js.
 */

export const CDN = import.meta.env?.VITE_CDN ?? "https://bricadabra.github.io/musheur-cdn";
const ROOT = CDN;

export const TILES_URL = `${ROOT}/forests.pmtiles`;

let manifest = null;
const departments = new Map(); // dept code -> { id -> indicators }

export async function getJSON(url, { signal } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.json();
}

export async function loadManifest() {
  manifest ??= await getJSON(`${ROOT}/manifest.json`);
  return manifest;
}

/** Department codes that hold at least one forest, in natural order. */
export function departmentCodes() {
  return Object.keys(departmentTable()).sort();
}

const departmentTable = () =>
  manifest?.layers?.find((l) => l.departments)?.departments ?? {};

export const departmentCount = (code) => departmentTable()[code]?.forests ?? 0;

/**
 * The extent of a department's forests, as [west, south, east, north].
 *
 * Produced by the pipeline from the outlines themselves, so it frames the
 * massifs and not the dots that stand for them — and it is known before the
 * department is loaded, which is what lets the map move the moment you choose.
 */
export const departmentBBox = (code) => departmentTable()[code]?.bbox ?? null;

/** Field descriptions, straight from the manifest: labels, units, sources. */
export const fields = () => manifest?.fields ?? {};

/**
 * Load one department's indicators, cached for the session.
 *
 * Returns an array of forests rather than the raw index, because every caller
 * wants to sort and filter them; `id` is folded into each record so a forest
 * carries its own key once it leaves the map.
 */
export async function loadDepartment(code) {
  if (!departments.has(code)) {
    const index = await getJSON(`${ROOT}/indicators/${code}.json`);
    departments.set(
      code,
      Object.entries(index).map(([id, record]) => ({ id, ...record })),
    );
  }
  return departments.get(code);
}

/**
 * The species knowledge table, for the enthusiasts' section of the sheet.
 *
 * Loaded once, in the background: the rest of the application does not wait
 * for it, and when it cannot be had the section simply does not appear.
 */
let species = null;

export async function loadSpecies() {
  species ??= await getJSON(`${ROOT}/species.json`);
  return species;
}

export const speciesTable = () => species;
