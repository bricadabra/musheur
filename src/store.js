/**
 * Local persistence.
 *
 * Everything lives in this browser: no account, no server, nothing to leak.
 * Foraging spots are the kind of thing people keep to themselves, so the design
 * choice is deliberate rather than incidental.
 *
 * Every access is guarded: localStorage throws in private windows and when the
 * browser is set to block site data, and the application must work without it.
 */

const PREFS_KEY = "musheur.prefs";
// The weather cache of earlier versions, which asked the weather service from
// the browser. Up to a few megabytes, and nothing reads it any more.
try {
  localStorage.removeItem("musheur.conditions.v3");
} catch {
  /* storage blocked: nothing to clean */
}

const DEFAULTS = {
  dept: null,
  ownership: ["domaniale", "departementale", "communale", "regionale", "autre-publique"],
  minArea: 20,
  minScore: 0,
  sort: "score",
  favourites: [],
  selected: null,
  day: 0, // offset in days from today, 0 = today
  mode: "browse", // browse a department, or follow the forests you picked
  index: "cautious", // which index is shown: "cautious" or "optimist"
  // The band last shown for each followed forest, so the next visit can say
  // what changed. Without a server this is the only alert the application can
  // raise, and it covers the real need: not missing a window for want of
  // opening the page on the right day.
  lastSeen: {},
};

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // quota exceeded or storage blocked: not worth failing over
  }
}

let prefs = { ...DEFAULTS, ...(read(PREFS_KEY) || {}) };

export const getPrefs = () => prefs;

export function setPrefs(patch) {
  prefs = { ...prefs, ...patch };
  write(PREFS_KEY, prefs);
  return prefs;
}

export const isFavourite = (id) => prefs.favourites.includes(id);

export function toggleFavourite(id) {
  const favourites = isFavourite(id)
    ? prefs.favourites.filter((f) => f !== id)
    : [...prefs.favourites, id];
  setPrefs({ favourites });
  return favourites.includes(id);
}

export const getLastSeen = (id) => prefs.lastSeen[id] ?? null;

/** Remember the bands just shown, so the next visit can report the change. */
export function rememberSeen(entries) {
  setPrefs({ lastSeen: { ...prefs.lastSeen, ...entries } });
}

