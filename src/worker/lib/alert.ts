// 5xx alerts to the ops Discord webhook, at most one per 10 minutes (TSD 9.4, TD-19).
// The throttle state lives in D1 (`ops_state`) because the Cache API does not
// work on workers.dev. Message carries only path, code and request id (no PII).

export const ALERT_INTERVAL_MS = 10 * 60 * 1000;
const KEY = "last_alert_at";

export interface AlertInfo {
  method: string;
  path: string;
  code: string;
  requestId: string;
}

/**
 * Atomically claims the alert slot. Returns true when the caller should send.
 * One statement: insert, or update only if the previous alert is old enough.
 */
export async function claimAlertSlot(db: D1Database, now: number): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO ops_state (key, value, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
       WHERE CAST(ops_state.value AS INTEGER) <= ?4
       RETURNING key`,
    )
    .bind(KEY, String(now), now, now - ALERT_INTERVAL_MS)
    .first();
  return row !== null;
}

export async function maybeSendAlert(
  env: Env,
  info: AlertInfo,
  fetchImpl: typeof fetch,
  now: number,
): Promise<boolean> {
  if (!env.ALERT_WEBHOOK_URL) return false;
  if (!(await claimAlertSlot(env.DB, now))) return false;
  const content =
    `[jungle5] 서버 오류 ${info.code} — ${info.method} ${info.path} ` +
    `(request ${info.requestId}). 10분 안의 추가 오류는 묶어서 생략합니다.`;
  const res = await fetchImpl(env.ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
  return res.ok;
}
