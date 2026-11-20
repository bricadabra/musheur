/**
 * The ranked list — the reason the page exists.
 *
 * A row carries one large numeral and three short lines: what the forest is,
 * what holds its index back, and the shape of its month. The numeral is set in
 * the display serif at a size nothing else on the page reaches, because the
 * whole question is "which wood, how good, right now" and a reader should be
 * able to answer it while scrolling past.
 *
 * In follow mode a fourth line appears — what changed since the last visit —
 * which is the only reason the follow list exists.
 */

import { esc, num } from "./html.js";
import { t, locale } from "./i18n.js";
import { limiting } from "./score.js";
import { sparkline } from "./charts.js";
import { state, visibleForests, entryFor, bandOf, flushFor, TODAY_INDEX, CHART_FROM } from "./state.js";
import { getPrefs } from "./store.js";
import { STALE_MS } from "./weather.js";

const shortDate = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "short" });

/** "Flush expected from 12 to 17 Oct", or "" when no rain has set one off. */
export function flushText(forest) {
  const flush = flushFor(forest);
  return flush
    ? t("flush.expected", { start: shortDate(flush.flushStart), end: shortDate(flush.flushEnd) })
    : "";
}

/** The cautious / optimists' index switch, shared by the rail and the board. */
export function indexToggleHTML() {
  const current = getPrefs().index;
  return (
    `<span class="flex items-center gap-2 text-sm">` +
    `<span class="text-soft">${t("index.label")}</span>` +
    `<span class="flex gap-1 rounded-sm bg-raised p-0.5" role="group" aria-label="${t("index.label")}">` +
    ["cautious", "optimist"]
      .map(
        (k) =>
          `<button type="button" data-index="${k}" aria-pressed="${k === current}" ` +
          `class="rounded-sm px-2.5 py-1 ${k === current ? "bg-primary font-semibold text-shell" : "text-soft hover:text-text"}">` +
          `${t(`index.${k}`)}</button>`,
      )
      .join("") +
    `</span></span>`
  );
}

function row(forest) {
  const entry = entryFor(forest);
  const key = bandOf(forest).key;
  const hold = entry ? limiting(entry) : null;
  const selected = state.selected === forest.id;
  const flush = flushText(forest);

  // "Communale, 29 ha" reads as a sentence fragment; the same facts joined by
  // middle dots read as machine output.
  const what = [
    t(`ownership.${forest.ownership}`),
    num(forest.area_ha, 0, "ha", locale()),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    `<li data-forest data-id="${esc(forest.id)}">` +
    `<button type="button" class="flex w-full items-start gap-4 border-b border-line py-4 pr-4 pl-3.5 text-left ` +
    `edge-band-${key} hover:bg-raised ${selected ? "bg-raised" : ""}">` +
    `<span data-score class="index-figure w-14 shrink-0 text-[2.625rem] band-${key}">` +
    `${entry?.score ?? "–"}</span>` +
    `<span class="min-w-0 flex-1">` +
    `<span data-name class="block text-base leading-snug font-semibold">${esc(forest.name)}</span>` +
    `<span class="mt-1 block text-sm text-soft">${esc(what)}</span>` +
    (hold
      ? `<span class="mt-1 block text-sm text-faint">` +
        `${t("limiting.prefix")} ${t(`limiting.${hold.key}`)}</span>`
      : "") +
    (flush ? `<span data-flush class="mt-1 block text-sm text-rain">${esc(flush)}</span>` : "") +
    `<span data-spark class="mt-2.5 block">${sparkline(forest.scores, TODAY_INDEX, { from: CHART_FROM, height: 32 })}</span>` +
    `</span></button></li>`
  );
}

/**
 * When the weather on screen was produced, and by whom.
 *
 * The weather is fetched once a day upstream, so a reader deserves to know
 * which day; past STALE_MS it says so in the warning colour, because a late
 * forecast still reads like a fresh one. The credit is the licence's due
 * (Open-Meteo, CC BY 4.0) and sits here so the board, which has no map and so
 * no attribution control, carries it too.
 */
export function weatherLineHTML() {
  if (!state.weatherAt) return "";
  const at = new Date(state.weatherAt);
  const late = Date.now() - at.getTime() > STALE_MS;
  const date = at.toLocaleDateString(locale(), {
    day: "numeric", month: "long", timeZone: "Europe/Paris",
  });
  return (
    `<p data-weather-at class="mt-2.5 text-xs ${late ? "text-band-poor" : "text-faint"}">` +
    `${t(late ? "weather.late" : "weather.asOf", { date })} · ` +
    `<a href="https://open-meteo.com/" target="_blank" rel="noopener" ` +
    `class="underline decoration-dotted hover:text-text">Open-Meteo</a></p>`
  );
}

const notice = (text, tone = "text-soft") =>
  `<p class="px-4 py-5 text-sm leading-relaxed ${tone}">${text}</p>`;

export function listHTML() {
  if (state.status === "loading") return notice(t("panel.loading"));
  if (state.status === "error")
    return notice(esc(t("error.data", { reason: state.error })), "text-band-poor");
  if (state.status === "idle") return notice(t("panel.pickDepartment"));

  const forests = visibleForests();
  if (!forests.length) return notice(t("panel.noResults"));
  return `<ul>${forests.map(row).join("")}</ul>`;
}
