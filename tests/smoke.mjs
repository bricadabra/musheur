/**
 * What no unit test sees: does the application actually run in a browser?
 *
 * It loads the built site, picks a department, opens a forest and switches day
 * and language. It catches the things that only show up for real — a MapLibre
 * paint expression the style parser rejects, a module that throws on import, a
 * chart that paints nothing.
 *
 * Outlines and indicators come from the CDN for real; the weather file of the
 * department under test is answered by tests/fixture.mjs, so the index it
 * should produce is known.
 *
 * It skips itself cleanly when puppeteer-core or Chrome is absent, because it
 * is a useful check and not a gate.
 *
 *   pnpm build && pnpm preview &
 *   pnpm test:smoke
 */

const URL = process.env.SMOKE_URL || "http://localhost:4173/musheur/";
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const DEPT = process.env.SMOKE_DEPT || "35";
// SMOKE_LIVE=1 reads the published weather instead of the made-up one: the
// only check that the published file still has the shape the model reads.
const LIVE = process.env.SMOKE_LIVE === "1";
// Where the site under test reads its data, if not the published CDN
// (VITE_CDN at build time).
const CDN = process.env.VITE_CDN || "https://bricadabra.github.io/musheur-cdn";

const { weatherFile } = await import("./fixture.mjs");
const fixture = LIVE ? null : JSON.stringify(await weatherFile(DEPT, CDN));
// The index the fixture produces. Asserting the number rather than "more than
// forty" is the whole point of not reading live weather.
const EXPECTED_TODAY = 83;

let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.log("skip: puppeteer-core is not installed");
  process.exit(0);
}

const { existsSync } = await import("node:fs");
if (!existsSync(CHROME)) {
  console.log(`skip: no Chrome at ${CHROME}`);
  process.exit(0);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  // Headless Chrome has no GPU; without this MapLibre cannot get a context.
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
});

const problems = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}`);
  if (!ok) problems.push(what);
};

/**
 * A page that starts with no preferences, so a run never inherits the last
 * one's follow list, and whose weather for DEPT is the fixture.
 */
async function preparedPage() {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.removeItem("musheur.prefs");
    } catch {
      /* storage blocked */
    }
  });
  if (fixture) {
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.url().endsWith(`/weather/${DEPT}.json`)) {
        request.respond({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: fixture,
        });
      } else {
        request.continue();
      }
    });
  }
  return page;
}

try {
  const page = await preparedPage();
  // Pinned on purpose. The default 800x600 is what caught a centred header
  // control overlapping the mode buttons and swallowing their clicks, so the
  // widths this runs at are now a choice rather than a default.
  await page.setViewport({ width: 1280, height: 900 });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message.slice(0, 160)}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console error: ${m.text().slice(0, 160)}`);
  });

  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

  check((await page.$$eval("#dept option", (o) => o.length)) > 90, "every department is offered");
  check(
    /^\S+ \p{L}/u.test(await page.$eval("#dept option:nth-child(30)", (e) => e.textContent)),
    "the department picker names departments, not just numbers",
  );
  check((await page.$$("canvas")).length === 1, "the map has a rendering context");

  await page.select("#dept", DEPT);
  await page.waitForSelector("[data-forest]", { timeout: 60000 });
  const weatherAt = await page.$eval("[data-weather-at]", (e) => e.textContent).catch(() => "");
  check(/\d/.test(weatherAt), `the date of the weather is shown (${weatherAt.trim()})`);

  const rows = await page.$$eval("[data-forest]", (els) =>
    els.map((el) => ({
      score: el.querySelector("[data-score]")?.textContent.trim(),
      name: el.querySelector("[data-name]")?.textContent.trim(),
      bars: el.querySelectorAll("[data-spark] rect").length,
    })),
  );
  check(rows.length > 0, `department ${DEPT} lists ${rows.length} forests`);
  check(rows.every((r) => r.name), "every row is named");
  check(rows.every((r) => /^\d+$|^—$/.test(r.score)), "every row carries an index");
  check(rows.some((r) => r.bars > 0), "the sparklines paint bars");

  // The model must produce a range, not a constant: a chain that silently
  // returns zero everywhere looks exactly like a dry fortnight.
  const spread = await page.evaluate(() => {
    const { state, TODAY_INDEX } = window.__musheur;
    const all = state.forests.flatMap((f) => f.scores.filter(Boolean).map((s) => s.score));
    return { n: all.length, max: Math.max(...all), min: Math.min(...all) };
  });
  check(spread.n > 100, `${spread.n} days could be scored`);
  if (LIVE) {
    check(spread.max > 40, `the index reaches ${spread.max} over the history`);
  } else {
    // Exact, because the weather is known. A model that drifts by a point now
    // fails here instead of passing a "more than forty" that means nothing.
    check(
      spread.max === EXPECTED_TODAY,
      `the known weather scores exactly ${EXPECTED_TODAY} (got ${spread.max})`,
    );
    check(
      rows.every((r) => r.score !== "–"),
      "every forest in the department got a reading",
    );
  }

  // Choosing a department must move the map onto it. With the weather served
  // locally the ranking can appear before MapLibre has finished starting, so
  // wait for the engine — the application remembers the frame and applies it on
  // load, and that is what is being checked.
  await page.waitForFunction(() => window.__musheur?.mapReady(), { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 300));

  // The extent comes from the manifest, so this holds without any weather.
  const framing = await page.evaluate((code) => {
    const { view, departmentBBox } = window.__musheur;
    const v = view();
    const b = departmentBBox(code);
    if (!v || !b) return null;
    const [lon, lat] = v.centre;
    return {
      inside: lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3],
      zoom: v.zoom,
    };
  }, DEPT);
  check(framing?.inside, "choosing a department centres the map on it");
  check(framing && framing.zoom > 6, `the map zooms in to it (z${framing?.zoom.toFixed(1)})`);

  await page.click("[data-forest] button");
  await page.waitForSelector("[data-detail]", { timeout: 20000 });
  const detail = await page.$eval("[data-detail]", (el) => ({
    title: !!el.querySelector("h2")?.textContent.trim(),
    factors: el.querySelectorAll("[data-factors] tr").length,
    charts: el.querySelectorAll("svg.chart").length,
  }));
  check(detail.title, "the detail panel names the forest");
  check(detail.factors === 3, "the three factors are shown with their readings");
  check(detail.charts >= 4, "the index, rainfall, moisture and soil temperature are all drawn");

  // Laid out, not merely present. A stray global `header` rule once fixed the
  // panel's own header to the viewport, and the verdict underneath it kept
  // every property a test would think to assert while being invisible.
  const verdict = await page.evaluate(() => {
    const score = document.querySelector("[data-detail-score]");
    const head = document.querySelector("[data-detail-head]");
    if (!score || !head) return null;
    const a = score.getBoundingClientRect();
    const b = head.getBoundingClientRect();
    const overlaps = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return { text: score.textContent.trim(), width: a.width, height: a.height, overlaps };
  });
  check(verdict && verdict.width > 20 && verdict.height > 20, "the verdict shows the index at size");
  check(verdict && !verdict.overlaps, "the verdict is not hidden under the panel header");

  // The mushroom section: every line names its dangerous lookalikes.
  const lines = await page.$$eval("[data-species-row]", (els) =>
    els.map((el) => /:\s*[^:(]+\(/.test(el.textContent)),
  );
  check(lines.length > 0, `the sheet lists mushroom species (${lines.length})`);
  check(lines.every(Boolean), "every species line names its lookalikes");

  await page.click('[data-day="3"]');
  await new Promise((r) => setTimeout(r, 500));
  check(
    await page.$eval('[data-day="3"]', (e) => e.classList.contains("is-active")),
    "the day strip switches day",
  );

  // Following crosses departments, so it has to survive a reload of its own.
  await page.click("#favBtn");
  await new Promise((r) => setTimeout(r, 300));
  await page.click('[data-mode="follow"]');
  await page.waitForFunction(
    () => document.querySelectorAll("[data-forest]").length > 0,
    { timeout: 180000 },
  );
  const followed = await page.$$eval("[data-forest]", (els) =>
    els.map((el) => ({
      name: el.querySelector("[data-name]")?.textContent.trim(),
      change: el.querySelector("[data-change]")?.textContent.trim(),
    })),
  );
  check(followed.length === 1, "a followed forest appears on the follow board");
  check(!!followed[0]?.change, "the follow board says what changed since the last visit");
  // Follow answers "did anything move", not "where should I go": the map has
  // nothing to say there and should be gone, not merely ignored.
  check(
    await page.$eval("#map", (e) => e.classList.contains("hidden")),
    "the follow board drops the map entirely",
  );
  check(
    (await page.$$eval("#list", (els) => els[0].innerHTML.trim().length)) === 0,
    "the browse list is emptied rather than left hidden in the document",
  );

  await page.click('[data-mode="browse"]');
  await page.waitForFunction(() => document.querySelectorAll("[data-forest]").length > 1, { timeout: 180000 });

  // Header controls must be reachable, not merely present: an absolutely
  // centred element once sat on top of the mode buttons between roughly 800 and
  // 1100 px, where every other assertion still passed.
  for (const width of [820, 1000, 1280]) {
    await page.setViewport({ width, height: 900 });
    await new Promise((r) => setTimeout(r, 200));
    const reachable = await page.evaluate(() =>
      [...document.querySelectorAll(".mode-btn")].every((btn) => {
        const r = btn.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return btn.contains(top);
      }),
    );
    check(reachable, `the mode buttons are clickable at ${width} px`);
  }

  // On a phone the sheet covers the screen. It once opened under the header and
  // the ranking rail, present and laid out but impossible to touch.
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 200));
  await page.click("[data-forest] button");
  await new Promise((r) => setTimeout(r, 300));
  check(
    await page.evaluate(() => {
      const sheet = document.querySelector("#detail");
      return [[195, 40], [195, 600]].every(([x, y]) => sheet.contains(document.elementFromPoint(x, y)));
    }),
    "the detail sheet covers the screen at 390 px",
  );
  await page.goBack();
  await new Promise((r) => setTimeout(r, 300));
  check(
    await page.evaluate(() => window.__musheur.state.selected === null),
    "Back closes the detail sheet instead of leaving the page",
  );
  await page.setViewport({ width: 1280, height: 900 });

  // The race the fix is for: choose a department before MapLibre has finished
  // starting. The frame has to be remembered and applied on load, not dropped.
  // Waiting for readiness first, as the checks above do, would never exercise
  // it — so here the selection happens as early as the page allows.
  {
    const fresh = await preparedPage();
    await fresh.setViewport({ width: 1280, height: 900 });
    await fresh.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await fresh.waitForSelector("#dept option[value='" + DEPT + "']", { timeout: 30000 });
    const early = await fresh.evaluate(() => !window.__musheur?.mapReady());
    await fresh.select("#dept", DEPT);
    await fresh.waitForFunction(() => window.__musheur?.mapReady(), { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 900));
    const framed = await fresh.evaluate((code) => {
      const { view, departmentBBox } = window.__musheur;
      const v = view();
      const b = departmentBBox(code);
      const [lon, lat] = v.centre;
      return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
    }, DEPT);
    check(framed, `a department chosen before the map is ready is still framed${early ? "" : " (the map was already ready; the race did not occur)"}`);
    await fresh.close();
  }

  await page.click('[data-lang="en"]');
  await new Promise((r) => setTimeout(r, 500));
  check(
    /browse/i.test(await page.$eval('[data-mode="browse"]', (e) => e.textContent)),
    "the language switches to English",
  );
} finally {
  await browser.close();
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n` + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log("\nall good");
