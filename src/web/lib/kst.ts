// KST (UTC+9, no DST) date/time helpers for rounds (PRD 10: all times shown in KST).
// Inputs use <input type="date"> ("YYYY-MM-DD") and <input type="time"> ("HH:MM").

const KST_OFFSET_MS = 9 * 60 * 60_000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "YYYY-MM-DD" + "HH:MM" in KST → UTC epoch ms. null when either part is missing or invalid. */
export function kstToEpochMs(date: string, time: string): number | null {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) return null;
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const utc = Date.UTC(y, mo - 1, da, Number(t[1]), Number(t[2]));
  const check = new Date(utc);
  // Reject impossible dates such as 2026-02-30.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== da) return null;
  return utc - KST_OFFSET_MS;
}

interface KstParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
}

export function kstParts(ms: number): KstParts {
  const d = new Date(ms + KST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC epoch ms → { date: "YYYY-MM-DD", time: "HH:MM" } in KST, for form inputs. */
export function epochMsToKst(ms: number): { date: string; time: string } {
  const p = kstParts(ms);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

export const kstTime = (ms: number) => {
  const p = kstParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
};

/** "목요일" */
export const kstWeekdayLong = (ms: number) => `${WEEKDAYS[kstParts(ms).weekday]}요일`;

/** "목 21:00" */
export const kstWeekdayTime = (ms: number) => `${WEEKDAYS[kstParts(ms).weekday]} ${kstTime(ms)}`;

/** "10월 9일 (목) 21:00", with the year when it differs from `now`'s. */
export function formatMeeting(ms: number, now = Date.now()): string {
  const p = kstParts(ms);
  const year = p.year !== kstParts(now).year ? `${p.year}년 ` : "";
  return `${year}${p.month}월 ${p.day}일 (${WEEKDAYS[p.weekday]}) ${kstTime(ms)}`;
}

/** "10월 9일 (목)" */
export function formatKstDate(ms: number, now = Date.now()): string {
  const p = kstParts(ms);
  const year = p.year !== kstParts(now).year ? `${p.year}년 ` : "";
  return `${year}${p.month}월 ${p.day}일 (${WEEKDAYS[p.weekday]})`;
}

/** A "YYYY-MM-DD" KST date as "10월 3일" (year added when not `now`'s year). */
function formatDateOnly(s: string, now: number): string {
  const m = DATE_RE.exec(s);
  if (!m) return s;
  const year = Number(m[1]) !== kstParts(now).year ? `${Number(m[1])}년 ` : "";
  return `${year}${Number(m[2])}월 ${Number(m[3])}일`;
}

/** Study period: "10월 3일 – 10월 9일", "10월 3일부터", "10월 9일까지", or null. */
export function formatPeriod(start: string | null, end: string | null, now = Date.now()): string | null {
  if (start && end) return `${formatDateOnly(start, now)} – ${formatDateOnly(end, now)}`;
  if (start) return `${formatDateOnly(start, now)}부터`;
  if (end) return `${formatDateOnly(end, now)}까지`;
  return null;
}
