// Display helpers. Times are stored as epoch ms and shown in KST (PRD 10).
import type { MemberSummary } from "../../shared/api";

const KST = "Asia/Seoul";

const dateFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: KST, year: "numeric", month: "long", day: "numeric" });
const fullFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST,
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "2026년 10월 7일 14:05 (KST)" */
export function formatFull(ms: number): string {
  return `${fullFmt.format(ms)} (KST)`;
}

/** "방금 전", "5분 전", "3시간 전", "2일 전", then a KST date. */
export function formatRelative(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return dateFmt.format(ms);
}

export const WITHDRAWN_NAME = "탈퇴한 멤버";

export function memberName(m: Pick<MemberSummary, "displayName" | "withdrawn">): string {
  return m.withdrawn || m.displayName === null ? WITHDRAWN_NAME : m.displayName;
}

const KST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** This week (Monday–Sunday, KST) as "10월 6일 – 10월 12일". */
export function formatWeekRange(now: number): string {
  const kst = new Date(now + KST_OFFSET_MS);
  const sinceMonday = (kst.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - sinceMonday * DAY_MS);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  const md = (d: Date) => `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
  return `${md(monday)} – ${md(sunday)}`;
}
