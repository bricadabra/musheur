/**
 * A weather file, made up on purpose.
 *
 * The browser test serves this instead of the published `weather/<dept>.json`,
 * so its numbers are known: it runs the same every day, and it can assert an
 * exact index rather than "more than forty".
 *
 * The shape is the published one (see src/weather.js), with one cell per
 * forest. The weather is not real: one clean rain episode two weeks back over
 * damp, mild ground, which is the case worth having a known answer for.
 */

import { CDN } from "../src/data.js";
import { windowDates, PAST_DAYS } from "../src/weather.js";

/** One cell's rows, over `days`. */
function cell(days, seed) {
  const daily = { precipitation_sum: [], temperature_2m_min: [] };
  const hourly = {
    soil_temperature_6cm: [],
    soil_moisture_3_to_9cm: [],
    soil_moisture_9_to_27cm: [],
  };

  days.forEach((_, i) => {
    // The rain that matters fell between 12 and 15 days ago: inside the
    // response kernel, which peaks at 14.
    const lag = PAST_DAYS - i;
    const wet = lag >= 12 && lag <= 15;
    daily.precipitation_sum.push(wet ? 6 + (seed % 3) : lag % 9 === 0 ? 1.2 : 0);
    daily.temperature_2m_min.push(7 + ((i + seed) % 4));

    for (let h = 0; h < 24; h += 3) {
      // A diurnal swing around 15 °C, which sits on the thermal plateau.
      hourly.soil_temperature_6cm.push(15 + 3 * Math.sin(((h - 6) / 24) * 2 * Math.PI));
      hourly.soil_moisture_3_to_9cm.push(lag > 15 ? 0.2 : 0.22);
      hourly.soil_moisture_9_to_27cm.push(0.33);
    }
  });

  return { daily, hourly };
}

/** The weather file for one department, for the forests the CDN lists in it. */
export async function weatherFile(code, cdn = CDN) {
  const response = await fetch(`${cdn}/indicators/${code}.json`);
  if (!response.ok) throw new Error(`indicators/${code}.json → HTTP ${response.status}`);
  const ids = Object.keys(await response.json());

  const days = windowDates();
  const hours = days.flatMap((d) =>
    Array.from({ length: 8 }, (_, k) => `${d}T${String(k * 3).padStart(2, "0")}:00`),
  );

  return {
    generated: new Date().toISOString(),
    time: { daily: days, hourly: hours },
    forests: Object.fromEntries(ids.map((id) => [id, id])),
    cells: Object.fromEntries(ids.map((id, i) => [id, cell(days, i)])),
  };
}
