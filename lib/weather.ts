/**
 * Live weather for the venue — powers the "Rain doesn't slow us down"
 * banner. Uses Open-Meteo (free, no API key) for Mathura's coordinates,
 * cached 15 minutes at the fetch layer so we hit their API a few times an
 * hour at most. Every failure path returns `isRaining: false` — the banner
 * must NEVER take a page down or false-positive on a network blip.
 */

// Mathura, UP.
const LAT = 27.4924;
const LON = 77.6737;

// WMO weather codes that mean active precipitation (drizzle → thunderstorm).
// https://open-meteo.com/en/docs (Weather variable documentation).
const RAIN_CODES = new Set([
  51, 53, 55, 56, 57, // drizzle / freezing drizzle
  61, 63, 65, 66, 67, // rain / freezing rain
  80, 81, 82, // rain showers
  95, 96, 99, // thunderstorm
]);

export interface RainNow {
  /** True if it's raining now OR rain is likely within the next ~3 hours. */
  isRaining: boolean;
  /** Short human label for the banner subtext. */
  label: string;
}

const NO_RAIN: RainNow = { isRaining: false, label: "" };

export async function getMathuraRain(): Promise<RainNow> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&current=weather_code,rain,showers&hourly=precipitation_probability` +
    `&forecast_hours=3&timezone=Asia%2FKolkata`;

  try {
    const res = await fetch(url, {
      // Cache 15 min. Open-Meteo has no key; this keeps calls minimal.
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return NO_RAIN;

    const data = (await res.json()) as {
      current?: { weather_code?: number; rain?: number; showers?: number };
      hourly?: { precipitation_probability?: number[] };
    };

    const cur = data.current ?? {};
    const rainingNow =
      (cur.rain ?? 0) > 0 ||
      (cur.showers ?? 0) > 0 ||
      (cur.weather_code != null && RAIN_CODES.has(cur.weather_code));

    // Rain likely soon: any of the next few hours ≥ 65% chance.
    const probs = data.hourly?.precipitation_probability ?? [];
    const soon = probs.slice(0, 3).some((p) => (p ?? 0) >= 65);

    if (rainingNow) {
      return { isRaining: true, label: "It's raining in Mathura right now" };
    }
    if (soon) {
      return { isRaining: true, label: "Rain expected shortly in Mathura" };
    }
    return NO_RAIN;
  } catch {
    return NO_RAIN;
  }
}
