export interface TodayCalendarInfo {
  dateLabel: string; // e.g. "11月26日 周四"
  lunarLabel: string; // e.g. "十月十七"
  festivalLabel: string | null; // e.g. "清明" / "中秋节" / "国庆节"
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const LUNAR_DAYS = [
  "",
  "初一",
  "初二",
  "初三",
  "初四",
  "初五",
  "初六",
  "初七",
  "初八",
  "初九",
  "初十",
  "十一",
  "十二",
  "十三",
  "十四",
  "十五",
  "十六",
  "十七",
  "十八",
  "十九",
  "二十",
  "廿一",
  "廿二",
  "廿三",
  "廿四",
  "廿五",
  "廿六",
  "廿七",
  "廿八",
  "廿九",
  "三十",
];

const LUNAR_MONTH_MAP: Record<string, { num: number; label: string }> = {
  一月: { num: 1, label: "正月" },
  正月: { num: 1, label: "正月" },
  二月: { num: 2, label: "二月" },
  三月: { num: 3, label: "三月" },
  四月: { num: 4, label: "四月" },
  五月: { num: 5, label: "五月" },
  六月: { num: 6, label: "六月" },
  七月: { num: 7, label: "七月" },
  八月: { num: 8, label: "八月" },
  九月: { num: 9, label: "九月" },
  十月: { num: 10, label: "十月" },
  十一月: { num: 11, label: "冬月" },
  冬月: { num: 11, label: "冬月" },
  十二月: { num: 12, label: "腊月" },
  腊月: { num: 12, label: "腊月" },
};

const GREGORIAN_FESTIVALS: Record<string, string> = {
  "1-1": "元旦",
  "2-14": "情人节",
  "3-8": "妇女节",
  "4-1": "愚人节",
  "5-1": "劳动节",
  "5-4": "青年节",
  "6-1": "儿童节",
  "9-10": "教师节",
  "10-1": "国庆节",
  "12-24": "平安夜",
  "12-25": "圣诞节",
};

const LUNAR_FESTIVALS: Record<string, string> = {
  "1-1": "春节",
  "1-15": "元宵节",
  "2-2": "龙抬头",
  "5-5": "端午节",
  "7-7": "七夕",
  "7-15": "中元节",
  "8-15": "中秋节",
  "9-9": "重阳节",
  "12-8": "腊八节",
  "12-23": "小年",
};

// 24 Solar Terms C constants for 21st century (2000-2099)
const SOLAR_TERMS: { month: number; name: string; c: number }[] = [
  { month: 1, name: "小寒", c: 5.4055 },
  { month: 1, name: "大寒", c: 20.12 },
  { month: 2, name: "立春", c: 3.87 },
  { month: 2, name: "雨水", c: 18.73 },
  { month: 3, name: "惊蛰", c: 5.63 },
  { month: 3, name: "春分", c: 20.646 },
  { month: 4, name: "清明", c: 4.81 },
  { month: 4, name: "谷雨", c: 20.1 },
  { month: 5, name: "立夏", c: 5.52 },
  { month: 5, name: "小满", c: 21.04 },
  { month: 6, name: "芒种", c: 5.678 },
  { month: 6, name: "夏至", c: 21.37 },
  { month: 7, name: "小暑", c: 7.108 },
  { month: 7, name: "大暑", c: 22.83 },
  { month: 8, name: "立秋", c: 7.5 },
  { month: 8, name: "处暑", c: 23.13 },
  { month: 9, name: "白露", c: 7.646 },
  { month: 9, name: "秋分", c: 23.042 },
  { month: 10, name: "寒露", c: 8.318 },
  { month: 10, name: "霜降", c: 23.438 },
  { month: 11, name: "立冬", c: 7.438 },
  { month: 11, name: "小雪", c: 22.36 },
  { month: 12, name: "大雪", c: 7.18 },
  { month: 12, name: "冬至", c: 21.94 },
];

function getSolarTerm(date: Date): string | null {
  const year = date.getFullYear();
  if (year < 2000 || year > 2099) return null;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const y = year % 100;
  const leapOffset = Math.floor((y - 1) / 4);
  for (const term of SOLAR_TERMS) {
    if (term.month !== month) continue;
    const termDay = Math.floor(y * 0.2422 + term.c) - leapOffset;
    if (termDay === day) return term.name;
  }
  return null;
}

function getLunarParts(date: Date): {
  monthNum: number;
  monthLabel: string;
  dayNum: number;
  dayLabel: string;
  isLeap: boolean;
} | null {
  try {
    const fmt = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
      month: "long",
      day: "numeric",
    });
    const parts = fmt.formatToParts(date);
    const rawMonth = parts.find((p) => p.type === "month")?.value ?? "";
    const rawDay = parts.find((p) => p.type === "day")?.value ?? "";
    const dayNum = parseInt(rawDay, 10);
    if (!rawMonth || Number.isNaN(dayNum) || dayNum < 1 || dayNum > 30) {
      return null;
    }
    const isLeap = rawMonth.startsWith("闰");
    const baseMonth = isLeap ? rawMonth.slice(1) : rawMonth;
    const mapped = LUNAR_MONTH_MAP[baseMonth];
    const monthNum = mapped?.num ?? parseInt(baseMonth, 10) ?? 0;
    const monthLabel = `${isLeap ? "闰" : ""}${mapped?.label ?? baseMonth}`;
    const dayLabel = LUNAR_DAYS[dayNum] || `${dayNum}日`;
    return { monthNum, monthLabel, dayNum, dayLabel, isLeap };
  } catch {
    return null;
  }
}

export function getTodayCalendarInfo(date: Date = new Date()): TodayCalendarInfo {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = WEEKDAYS[date.getDay()];
  const dateLabel = `${month}月${day}日 ${weekday}`;

  const lunar = getLunarParts(date);
  const lunarLabel = lunar ? `${lunar.monthLabel}${lunar.dayLabel}` : "";

  // Determine festival priority: Lunar festival (incl. 除夕) -> Gregorian festival -> 24 Solar Term
  let festivalLabel: string | null = null;
  if (lunar && !lunar.isLeap) {
    const tomorrow = new Date(date);
    tomorrow.setDate(date.getDate() + 1);
    const tomorrowLunar = getLunarParts(tomorrow);
    if (tomorrowLunar && !tomorrowLunar.isLeap && tomorrowLunar.monthNum === 1 && tomorrowLunar.dayNum === 1) {
      festivalLabel = "除夕";
    } else {
      festivalLabel = LUNAR_FESTIVALS[`${lunar.monthNum}-${lunar.dayNum}`] ?? null;
    }
  }

  if (!festivalLabel) {
    festivalLabel = GREGORIAN_FESTIVALS[`${month}-${day}`] ?? null;
  }

  if (!festivalLabel) {
    festivalLabel = getSolarTerm(date);
  }

  return { dateLabel, lunarLabel, festivalLabel };
}
