import { createHmac, timingSafeEqual } from 'node:crypto';
import { isValidLineUserId } from '@/lib/auth/line';

// lib/line/friend-webhook.ts — LINE Messaging API webhook 的純函式層(S3,2026-09-14;plan §1-5)。
//
// 🔴 **簽章一定要驗**:`x-line-signature` = base64(HMAC-SHA256(channel secret, raw body bytes))。不驗 = 任何人 POST 一包
//    `{events:[{type:'unfollow',source:{userId:'U…'}}]}` 就能把客人的好友狀態竄掉(之後推播就靜靜不寄)。
//    對【原始 bytes】算(`req.arrayBuffer()`),不是 `req.text()`(那會吃掉 BOM, codex R1 nit);比對走 timingSafeEqual
//    (長度不等先回 false —— 它要求等長 Buffer, 否則 throw)。
// 🔴 只認 `follow` / `unfollow` 兩種;其餘事件(message / postback / …)回 `other`, route 收 200 忽略。
// 🔴 userId 過 `isValidLineUserId`(U + 32 hex, 與登入那條同一把尺)—— 不合格式的一律當沒有(不查 DB)。
// 🔴 事件 timestamp 是承重的:它是「亂序重送不把舊狀態寫回」的判準(LINE 官方明講重送可能亂序)⇒
//    缺 / 不是有限整數 / 不在合理範圍(2020-01-01 ~ 現在 + 1 天)⇒ 當 `other`(codex R1 nit:1e20 會讓 Date 拋 RangeError;
//    缺 timestamp 若用 now() 重送就不冪等)。
// 🔴 這一層零 I/O:寫入在 `friend-repository.ts`(service_role 受控小門)。

export const LINE_SIGNATURE_HEADER = 'x-line-signature';
/** LINE 一包最多 ~ 幾百個事件, 每個 < 1KB;1 MB 是上限的十倍以上(Vercel 平台自己還有 4.5 MB)。 */
export const LINE_WEBHOOK_MAX_BYTES = 1_000_000;

export function verifyLineSignature(rawBody: Uint8Array | string, signature: string | null, channelSecret: string): boolean {
  if (signature === null || signature === '' || channelSecret === '') return false;
  const bytes = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : Buffer.from(rawBody);
  const expected = createHmac('sha256', channelSecret).update(bytes).digest('base64');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type LineFriendEvent =
  | { kind: 'follow'; userId: string; eventAt: string }
  | { kind: 'unfollow'; userId: string; eventAt: string }
  | { kind: 'other' };

const TS_MIN = Date.parse('2020-01-01T00:00:00Z');
function eventIso(ts: unknown, now: number): string | null {
  if (typeof ts !== 'number' || !Number.isSafeInteger(ts)) return null;
  if (ts < TS_MIN || ts > now + 86_400_000) return null;
  return new Date(ts).toISOString();
}

/**
 * raw body → 事件清單。整包不是 `{events:[…]}` ⇒ null(route 回 400)。
 * 空 `events` 是合法的(LINE 在後台按「驗證」時送的就是空陣列)⇒ []。
 * `eventAt` = 事件自己的 timestamp(ms)轉 ISO —— 同一個事件被 LINE 重送時算出同一個值 ⇒ 寫入天然冪等,
 * 而且它是 repository 拒絕舊事件的判準。
 */
export function parseLineWebhookEvents(rawBody: string, now: number = Date.now()): LineFriendEvent[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const events = (parsed as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;
  const out: LineFriendEvent[] = [];
  for (const e of events) {
    const ev = e as { type?: unknown; timestamp?: unknown; source?: { type?: unknown; userId?: unknown } } | null;
    const userId = typeof ev?.source?.userId === 'string' && isValidLineUserId(ev.source.userId) ? ev.source.userId : null;
    const eventAt = eventIso(ev?.timestamp, now);
    if ((ev?.type === 'follow' || ev?.type === 'unfollow') && userId !== null && eventAt !== null) {
      out.push({ kind: ev.type, userId, eventAt });
    } else {
      out.push({ kind: 'other' });
    }
  }
  return out;
}
