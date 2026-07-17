import { request } from "./admin-api";

export type PricingDayType = "WEEKDAY" | "WEEKEND";
export type PricingTimeType = "PEAK" | "OFF_PEAK";

export interface PricingCourtConfig {
  id: string;
  sport: string;
  size: string;
  label: string;
}
export interface PricingRule {
  id: string;
  courtConfigId: string;
  dayType: PricingDayType;
  timeType: PricingTimeType;
  pricePerSlot: number;
}
export interface TimeBand {
  id: string;
  startHour: number;
  endHour: number;
  dayType: PricingDayType;
  timeType: PricingTimeType;
}
export interface ArenaHours {
  openHour: number;
  closeHour: number;
}
/** "Rain doesn't slow us down" homepage/booking banner (ArenaSettings).
 *  AUTO = weather-driven (shows only when it's raining in Mathura). */
export type RainBannerMode = "AUTO" | "ON" | "OFF";
export interface RainBannerConfig {
  mode: RainBannerMode;
  /** Custom body copy; null = server default. */
  text: string | null;
}
export interface PricingData {
  configs: PricingCourtConfig[];
  rules: PricingRule[];
  classifications: TimeBand[];
  arena: ArenaHours;
  rainBanner: RainBannerConfig;
}

export interface PriceUpdate {
  courtConfigId: string;
  dayType: PricingDayType;
  timeType: PricingTimeType;
  pricePerSlot: number;
}

export interface BandInput {
  startHour: number;
  endHour: number;
  dayType: PricingDayType;
  timeType: PricingTimeType;
}

export const adminPricingApi = {
  get: () =>
    request<PricingData>("/api/mobile/admin/pricing", { method: "GET" }),
  savePrices: (updates: PriceUpdate[]) =>
    request<{ ok: true }>("/api/mobile/admin/pricing", {
      method: "POST",
      body: { action: "prices", updates },
    }),
  saveArena: (openHour: number, closeHour: number) =>
    request<{ ok: true }>("/api/mobile/admin/pricing", {
      method: "POST",
      body: { action: "arena", openHour, closeHour },
    }),
  // Create / edit a PEAK/OFF_PEAK band. (startHour, dayType) is the unique key,
  // so reusing an existing startHour edits that band. Hours are half-open
  // [startHour, endHour); 0..29 where ≥24 = next day.
  saveBand: (band: BandInput) =>
    request<{ ok: true }>("/api/mobile/admin/pricing", {
      method: "POST",
      body: { action: "band-save", ...band },
    }),
  deleteBand: (id: string) =>
    request<{ ok: true }>("/api/mobile/admin/pricing", {
      method: "POST",
      body: { action: "band-delete", id },
    }),
  saveRainBanner: (mode: RainBannerMode, text: string | null) =>
    request<{ ok: true }>("/api/mobile/admin/pricing", {
      method: "POST",
      body: { action: "rain-banner", mode, text },
    }),
};
