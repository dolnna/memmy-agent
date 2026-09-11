export interface RecapRange {
  startDate: string;
  endDate: string;
  /** Absolute dates remain meaningful when a saved recap is reopened later. */
  label: string;
}

export type RecapRangeResult =
  | { ok: true; range: RecapRange; truncated: boolean }
  | { ok: false; error: string };

function localDate(year: number, month: number, day: number): Date | null {
  const date = new Date(0);
  // Noon avoids midnight clock changes; setFullYear also handles years below 100.
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return year >= 1 && year <= 9999 && date.getFullYear() === year &&
      date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

function formatDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Calendar validation is local, without UTC conversion of user-entered dates. */
export function isRecapDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return parts !== null && localDate(Number(parts[1]), Number(parts[2]), Number(parts[3])) !== null;
}

export function recapRangeLabel(startDate: string, endDate: string): string {
  return startDate === endDate ? startDate : `${startDate} — ${endDate}`;
}

export function parseRecapRange(text: string, now = new Date()): RecapRangeResult {
  if (!Number.isFinite(now.getTime())) return { ok: false, error: "当前日期无效，请重试。" };
  const input = text.trim().replace(/\s+/g, "");
  const today = localDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  if (!today) return { ok: false, error: "当前日期无效，请重试。" };
  let start = new Date(today);
  let end = new Date(today);

  if (input === "今日" || input === "今天") {
    // The defaults already describe today.
  } else if (input === "昨日" || input === "昨天") {
    start.setDate(start.getDate() - 1);
    end = new Date(start);
  } else if (input === "本周") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  } else if (input === "本月") {
    start.setDate(1);
  } else {
    const recent = /^最近([1-9]\d*)(天|周)$/.exec(input);
    const fullDates = /^(\d{4})-(\d{2})-(\d{2})(?:到|至|~|～|—)(\d{4})-(\d{2})-(\d{2})$/.exec(input);
    const monthDates = /^(\d{1,2})月(\d{1,2})日(?:到|至|~|～|—)(\d{1,2})月(\d{1,2})日$/.exec(input);
    const singleDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
    if (recent) {
      const count = Number(recent[1]) * (recent[2] === "周" ? 7 : 1);
      if (!Number.isSafeInteger(count)) return { ok: false, error: "请输入有效的天数或周数。" };
      start.setDate(start.getDate() - count + 1);
    } else if (fullDates || monthDates || singleDate) {
      const match = fullDates ?? singleDate;
      const startDate = match
        ? localDate(Number(match[1]), Number(match[2]), Number(match[3]))
        : localDate(today.getFullYear(), Number(monthDates![1]), Number(monthDates![2]));
      const endDate = fullDates
        ? localDate(Number(fullDates[4]), Number(fullDates[5]), Number(fullDates[6]))
        : monthDates
          ? localDate(today.getFullYear(), Number(monthDates[3]), Number(monthDates[4]))
          : startDate;
      if (!startDate || !endDate) return { ok: false, error: "日期不存在，请检查月份和日期。" };
      start = startDate;
      end = endDate;
    } else {
      return { ok: false, error: "请填写明确时间，例如最近 7 天，或 2026-09-01 到 2026-09-09。" };
    }
  }

  if (!Number.isFinite(start.getTime()) || start.getFullYear() < 1) {
    return { ok: false, error: "时间范围过长，请缩小范围。" };
  }
  if (start > end) return { ok: false, error: "开始日期不能晚于结束日期；跨年请填写完整年份。" };
  if (start > today) return { ok: false, error: "开始日期不能晚于今天。" };
  const truncated = end > today;
  if (truncated) end = today;
  const startDate = formatDate(start);
  const endDate = formatDate(end);
  return { ok: true, range: { startDate, endDate, label: recapRangeLabel(startDate, endDate) }, truncated };
}
