import { IdeaWeather, ThemeMode, WeatherKind } from "../types";

export interface HourAtmosphereStyle {
  background: string;
  textColor: string;
  mutedColor: string;
  badgeBg: string;
  isNight: boolean;
  periodLabel: string;
}

/**
 * 24 distinct hourly atmospheric sky gradients (00:00 -> 23:00).
 * Night hours remain deep & dark across all themes; daytime hours adapt cleanly to Dark vs Light/Paper.
 */
const DARK_24H_GRADIENTS: [string, string, string][] = [
  ["#0c101d", "#12172a", "午夜"], // 00
  ["#0b0f1b", "#111628", "深夜"], // 01
  ["#0d111e", "#14192d", "凌晨"], // 02
  ["#101424", "#181d34", "凌晨"], // 03
  ["#16192c", "#24223d", "破晓前"], // 04
  ["#231f35", "#3c2b44", "微明"], // 05
  ["#3b2836", "#583738", "晨曦"], // 06
  ["#46312d", "#5e4334", "日出"], // 07
  ["#213347", "#2b455e", "清晨"], // 08
  ["#1d354d", "#244766", "上午"], // 09
  ["#1b3852", "#224c6e", "上午"], // 10
  ["#1a3b57", "#235175", "午间"], // 11
  ["#1b3e5b", "#26567a", "正午"], // 12
  ["#1e3b55", "#294f6e", "午后"], // 13
  ["#223950", "#2f4a64", "午后"], // 14
  ["#28374a", "#3a4658", "下午"], // 15
  ["#333544", "#4b3e47", "傍晚"], // 16
  ["#463032", "#613d32", "日落"], // 17
  ["#422a33", "#52323d", "晚霞"], // 18
  ["#28243d", "#342b4d", "暮色"], // 19
  ["#1c1e36", "#252645", "初夜"], // 20
  ["#15182b", "#1c2038", "夜晚"], // 21
  ["#111524", "#171c30", "夜深"], // 22
  ["#0e1220", "#14182b", "子夜"], // 23
];

const LIGHT_24H_GRADIENTS: [string, string, string, boolean][] = [
  ["#151a2e", "#1e2540", "午夜", true], // 00 (dark night)
  ["#13182b", "#1c223b", "深夜", true], // 01
  ["#161b30", "#202742", "凌晨", true], // 02
  ["#1b2038", "#272c4a", "凌晨", true], // 03
  ["#272742", "#393459", "破晓前", true], // 04
  ["#e8dce8", "#f3e2df", "微明", false], // 05
  ["#f6e0d8", "#fae9d7", "晨曦", false], // 06
  ["#faead3", "#fdf2d8", "日出", false], // 07
  ["#e2eff8", "#edf6fc", "清晨", false], // 08
  ["#d9ecfa", "#e7f3fc", "上午", false], // 09
  ["#d2e8fa", "#e2f1fc", "上午", false], // 10
  ["#cde5fa", "#dfeffc", "午间", false], // 11
  ["#c9e3fa", "#dceefc", "正午", false], // 12
  ["#d2e6f7", "#e3effa", "午后", false], // 13
  ["#dbe9f4", "#eaf0f6", "午后", false], // 14
  ["#e5ebf0", "#f0ece6", "下午", false], // 15
  ["#f0e5dc", "#f7e6d4", "傍晚", false], // 16
  ["#f5dcd0", "#fae0c8", "日落", false], // 17
  ["#ebd4d8", "#e3d2e4", "晚霞", false], // 18
  ["#d7d4ea", "#c8c9e6", "暮色", false], // 19
  ["#2b2e4a", "#353759", "初夜", true], // 20 (night transitions dark)
  ["#21253d", "#292e4a", "夜晚", true], // 21
  ["#1a1e33", "#222740", "夜深", true], // 22
  ["#161a2d", "#1e243b", "子夜", true], // 23
];

export function getHourAtmosphere(
  isoDate: string,
  theme: ThemeMode
): HourAtmosphereStyle {
  const dt = new Date(isoDate);
  const hour = Number.isNaN(dt.getTime()) ? new Date().getHours() : dt.getHours();
  const safeHour = ((hour % 24) + 24) % 24;
  const isNight = safeHour >= 20 || safeHour <= 4;

  if (theme === "dark") {
    const [c1, c2, periodLabel] = DARK_24H_GRADIENTS[safeHour];
    return {
      background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
      textColor: "#f4f4f5",
      mutedColor: "rgba(244, 244, 245, 0.68)",
      badgeBg: "rgba(255, 255, 255, 0.1)",
      isNight,
      periodLabel,
    };
  }

  const [c1, c2, periodLabel, darkCard] = LIGHT_24H_GRADIENTS[safeHour];
  return {
    background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
    textColor: darkCard ? "#f4f4f5" : "#27272a",
    mutedColor: darkCard
      ? "rgba(244, 244, 245, 0.72)"
      : "rgba(39, 39, 42, 0.65)",
    badgeBg: darkCard
      ? "rgba(255, 255, 255, 0.12)"
      : "rgba(24, 24, 27, 0.07)",
    isNight,
    periodLabel,
  };
}

const WEATHER_CACHE_KEY = "shibaplan_weather_cache_v1";
const WEATHER_TTL_MS = 30 * 60 * 1000;

let cachedWeather: { data: IdeaWeather; fetchedAt: number } | null = null;
let inflightWeather: Promise<IdeaWeather | null> | null = null;

function mapWmoCodeToWeather(code: number): IdeaWeather {
  if (code === 0 || code === 1) return { kind: "clear", label: "晴" };
  if (code === 2 || code === 3) return { kind: "cloudy", label: "多云" };
  if (code === 45 || code === 48) return { kind: "fog", label: "雾" };
  if (
    (code >= 51 && code <= 67) ||
    (code >= 80 && code <= 82)
  ) {
    return { kind: "rain", label: code >= 63 || code >= 81 ? "大雨" : "小雨" };
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return { kind: "snow", label: "雪" };
  }
  if (code >= 95) return { kind: "storm", label: "雷雨" };
  return { kind: "cloudy", label: "阴" };
}

function mapWttrCodeToWeather(code: number): IdeaWeather {
  if (code === 113) return { kind: "clear", label: "晴" };
  if (code === 116 || code === 119 || code === 122)
    return { kind: "cloudy", label: "多云" };
  if (code === 143 || code === 248 || code === 260)
    return { kind: "fog", label: "雾" };
  if (code === 200 || code === 386 || code === 389 || code === 392 || code === 395)
    return { kind: "storm", label: "雷雨" };
  if (
    code === 179 ||
    code === 182 ||
    code === 185 ||
    code === 227 ||
    code === 230 ||
    (code >= 320 && code <= 338) ||
    (code >= 368 && code <= 377)
  ) {
    return { kind: "snow", label: "雪" };
  }
  if (
    code === 176 ||
    (code >= 263 && code <= 314) ||
    (code >= 353 && code <= 365)
  ) {
    return { kind: "rain", label: code >= 302 ? "中大雨" : "小雨" };
  }
  return { kind: "cloudy", label: "多云" };
}

export function getCachedWeatherSync(): IdeaWeather | null {
  if (cachedWeather && Date.now() - cachedWeather.fetchedAt < WEATHER_TTL_MS) {
    return cachedWeather.data;
  }
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        data: IdeaWeather;
        fetchedAt: number;
      };
      if (parsed?.data?.kind && Date.now() - parsed.fetchedAt < WEATHER_TTL_MS) {
        cachedWeather = parsed;
        return parsed.data;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function saveWeatherCache(data: IdeaWeather): void {
  cachedWeather = { data, fetchedAt: Date.now() };
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cachedWeather));
  } catch {
    // ignore
  }
}

export async function fetchCurrentWeather(): Promise<IdeaWeather | null> {
  const existing = getCachedWeatherSync();
  if (existing) return existing;
  if (inflightWeather) return inflightWeather;

  inflightWeather = (async () => {
    // Primary: Open-Meteo via GeoJS IP geolocation (fast, reliable, zero key)
    try {
      const geoRes = await fetch("https://get.geojs.io/v1/ip/geo.json");
      if (geoRes.ok) {
        const geo = (await geoRes.json()) as {
          latitude?: string;
          longitude?: string;
        };
        const lat = Number(geo.latitude);
        const lon = Number(geo.longitude);
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
          const wRes = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
          );
          if (wRes.ok) {
            const wJson = (await wRes.json()) as {
              current_weather?: { weathercode?: number; temperature?: number };
            };
            const cw = wJson.current_weather;
            if (cw && typeof cw.weathercode === "number") {
              const base = mapWmoCodeToWeather(cw.weathercode);
              const result: IdeaWeather = {
                ...base,
                tempC:
                  typeof cw.temperature === "number"
                    ? Math.round(cw.temperature)
                    : undefined,
              };
              saveWeatherCache(result);
              return result;
            }
          }
        }
      }
    } catch {
      // try fallback
    }

    // Fallback: wttr.in JSON
    try {
      const res = await fetch("https://wttr.in/?format=j1");
      if (res.ok) {
        const json = (await res.json()) as {
          current_condition?: { weatherCode?: string; temp_C?: string }[];
        };
        const cur = json.current_condition?.[0];
        if (cur?.weatherCode) {
          const base = mapWttrCodeToWeather(Number(cur.weatherCode));
          const result: IdeaWeather = {
            ...base,
            tempC: cur.temp_C ? Math.round(Number(cur.temp_C)) : undefined,
          };
          saveWeatherCache(result);
          return result;
        }
      }
    } catch {
      // offline or blocked
    }

    return null;
  })().finally(() => {
    inflightWeather = null;
  });

  return inflightWeather;
}

export function getWeatherClassName(kind?: WeatherKind, isNight?: boolean): string {
  if (!kind) return isNight ? "atmo-starlight" : "";
  switch (kind) {
    case "rain":
      return "atmo-rain";
    case "storm":
      return "atmo-storm";
    case "snow":
      return "atmo-snow";
    case "fog":
      return "atmo-fog";
    case "cloudy":
      return "atmo-cloudy";
    case "clear":
      return isNight ? "atmo-starlight" : "atmo-clear-day";
    default:
      return "";
  }
}
