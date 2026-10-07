// Time helpers shared by the Worker and the SPA. Times are UTC epoch ms; the
// community lives in KST (PRD 10).

const KST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/**
 * The KST week containing `now` as UTC epoch ms: Monday 00:00 KST (inclusive)
 * to the next Monday 00:00 KST (exclusive). KST has no DST.
 */
export function kstWeekRange(now: number): { start: number; end: number } {
  const kstDay = Math.floor((now + KST_OFFSET_MS) / DAY_MS);
  // Epoch day 0 (1970-01-01) was a Thursday: (day + 3) % 7 = days since Monday.
  const monday = kstDay - ((kstDay + 3) % 7);
  const start = monday * DAY_MS - KST_OFFSET_MS;
  return { start, end: start + 7 * DAY_MS };
}
