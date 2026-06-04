/**
 * @module @pcm/domain/order/display-id — 人類可讀訂單編號 `PCM-YYYY-NNNN`
 *
 * 本片(M-3-S1)定**格式約定 + 驗證 / 組號 helper**;實際序號產生於後續 DB 片
 * (orders 表序列 / create_order RPC、plan v6 §3.1),本檔不接 DB、不保證唯一性。
 *
 * 格式:`PCM-` + 4 位西元年 + `-` + ≥ 4 位流水號(不足補前導 0、超過不截斷)。
 *   例:`PCM-2026-0001`、`PCM-2026-12345`。
 *
 * @see packages/domain/src/order/types.ts:DisplayId
 * @see docs/specs/2026-06-04-m3-checkout-plan.md(handoff §4 步驟 4)
 */

import type { DisplayId } from './types';
import { OrderError } from './errors';

/** displayId 格式 regex:`PCM-YYYY-NNNN`(年 4 位、序號 ≥ 4 位)。 */
const DISPLAY_ID_PATTERN = /^PCM-\d{4}-\d{4,}$/;

/** 流水號最小位數(不足前導補 0)。 */
const MIN_SEQ_DIGITS = 4;

/**
 * formatDisplayId:組人類可讀單號 `PCM-YYYY-NNNN`。
 *
 * @param year 西元年(4 位整數、1000–9999)
 * @param seq 流水號(正整數;不足 4 位前導補 0、超過 4 位不截斷)
 * @returns DisplayId(`PCM-YYYY-NNNN`)
 * @throws OrderError code `invalid_display_id` 若 year / seq 非法
 */
export function formatDisplayId(year: number, seq: number): DisplayId {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new OrderError(
      'invalid_display_id',
      `displayId year must be 4-digit integer (1000-9999), got ${year}`,
    );
  }
  if (!Number.isInteger(seq) || seq < 1) {
    throw new OrderError(
      'invalid_display_id',
      `displayId seq must be positive integer, got ${seq}`,
    );
  }
  const seqStr = String(seq).padStart(MIN_SEQ_DIGITS, '0');
  return `PCM-${year}-${seqStr}`;
}

/**
 * isValidDisplayId:檢查字串是否符合 `PCM-YYYY-NNNN` 格式(不 throw)。
 */
export function isValidDisplayId(value: string): boolean {
  return DISPLAY_ID_PATTERN.test(value);
}

/**
 * assertDisplayId:驗證並回傳 DisplayId;非法 throw。
 *
 * 先 typeof 守門:封 `new String('PCM-…')` wrapper —— `RegExp.test` 會把 wrapper 強制轉字串
 * 而誤判合法,但 wrapper 帶隱藏 toJSON 可在 `JSON.stringify(order)` 偷渡序列化字串(round3 收尾)。
 *
 * @throws OrderError code `invalid_display_id`
 */
export function assertDisplayId(value: string): DisplayId {
  if (typeof value !== 'string' || !isValidDisplayId(value)) {
    throw new OrderError(
      'invalid_display_id',
      `displayId must match PCM-YYYY-NNNN, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * parseDisplayId:拆 `PCM-YYYY-NNNN` 回 `{ year, seq }`;非法 throw。
 *
 * 注意:序號前導 0 解析後丟失(`PCM-2026-0001` → `{ year: 2026, seq: 1 }`)、
 * 僅供顯示 / 對帳語意還原、非 round-trip 唯一鍵。
 *
 * @throws OrderError code `invalid_display_id`
 */
export function parseDisplayId(value: string): { year: number; seq: number } {
  assertDisplayId(value);
  const [, yearStr, seqStr] = value.split('-');
  return { year: Number(yearStr), seq: Number(seqStr) };
}
