// 🔴 跨檔契約測試:`dedup_key` 有【兩份實作】,而這一格是唯一在守「兩份寫的是同一個格式」的東西。
//
// 背景(2026-08-22 codex R1 → R2):
//   R1 我標「這一格沒解掉、沒有便宜的量具」。**R2 codex 指出那個判斷是錯的** ——
//   讀 migration 裡的固定向量、拿去比 adapter 實際算出來的鍵,**不需要任何 DB**。
//   📌 教訓本身值得留:「我判它做不到」與「它真的做不到」是兩件事。
//
// 這一格會紅的兩種改法(**任一側單獨改就紅**):
//   · SQL 側改格式  ⇒ migration §4b 的期望字面變了 ⇒ 與 adapter 算出的不合
//   · TS 側改格式   ⇒ adapter 算出的變了 ⇒ 與 migration 的期望字面不合
//
// ⚠️ 它**不會**抓到「兩邊同時被改成同一個新格式」—— 那是刻意變更,不是漂移。
// 🔴 而它抓不到的另一半更該講:**這一格只比對「格式」,不保證正式庫那支函式真的是這一版**
//    (migration 可能還沒 apply、或被人手改過)。那要 apply 期的釘樁,在 migration §4b。
import { describe, it, expect, vi } from 'vitest';

// adapter 檔頭 import 'server-only'(鏡像 SupabaseEmailOutboxAdapter.test.ts:4)。
vi.mock('server-only', () => ({}));

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { SupabaseEmailOutboxAdapter, type EmailOutboxClient } from './SupabaseEmailOutboxAdapter';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/adapters/src/email → repo root
const MIGRATION = resolve(
  HERE,
  '../../../../supabase/migrations/20260822010000_m4b_e4a_shipped_email_scan_view.sql',
);

/**
 * 從 migration §4b 撈出「兩個輸入 uuid + 期望輸出字面」。
 *
 * 🔴 **撈不到就 throw,不回預設值。** 回預設值的話,migration 改名或那段被刪掉時
 * 本格會**照樣綠** —— 而那正是它要防的情況(母題:恆真守門)。
 */
function readSqlPin(): { shipmentId: string; orderId: string; expected: string } {
  const sql = readFileSync(MIGRATION, 'utf8');
  const m = sql.match(
    /v_key := public\.pcm_shipped_email_dedup_key\(\s*'([0-9a-fA-F-]+)'::uuid,\s*'([0-9a-fA-F-]+)'::uuid\s*\);\s*IF v_key <> '([^']+)'/,
  );
  if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) {
    throw new Error(
      `讀不到 migration §4b 的 dedup 釘樁(檔案:${MIGRATION})—— ` +
        '本測試無法在「讀不到」的情況下宣稱兩邊一致,故直接失敗。',
    );
  }
  return { shipmentId: m[1], orderId: m[2], expected: m[3] };
}

function captureInsert() {
  const calls: Array<Record<string, unknown>> = [];
  const builder = {
    insert(row: Record<string, unknown>) {
      calls.push(row);
      return { select: async () => ({ data: [{ id: 'x' }], error: null }) };
    },
  };
  const client = { from: () => builder } as unknown as EmailOutboxClient;
  return { client, calls };
}

describe('dedup_key 跨檔契約(SQL migration ↔ TS adapter)', () => {
  it('🔴 migration 撈得到釘樁 —— 撈不到就是量具沒接上,不是「一致」', () => {
    const pin = readSqlPin();
    expect(pin.shipmentId).toMatch(/^[0-9a-fA-F-]{36}$/);
    expect(pin.orderId).toMatch(/^[0-9a-fA-F-]{36}$/);
    // 期望字面必須真的長得像「兩個 uuid 用某個東西接起來」,不是隨便一段字。
    expect(pin.expected.length).toBeGreaterThanOrEqual(pin.shipmentId.length + pin.orderId.length);
  });

  it('🔴 TS adapter 算出來的 key,逐字等於 migration 釘住的期望值', async () => {
    const pin = readSqlPin();
    const { client, calls } = captureInsert();
    await new SupabaseEmailOutboxAdapter(client, {
      // `#858` 片0-a:改注入判斷式;本檔測的是 dedup_key,gate 一律回 false(不影響本檔斷言)。
      isSyntheticEmail: () => false,
    }).enqueue({
      eventType: 'order_shipped',
      orderId: pin.orderId,
      displayId: 'PCM-2026-0001',
      shipmentId: pin.shipmentId,
      shipmentReference: 'BCDF23',
      shippedAt: '2026-08-22T02:00:00Z',
      recipientEmail: 'customer@example.com',
      requestId: null,
    });

    expect(calls).toHaveLength(1);
    // ⬇️ 這一行就是契約。任一側單獨改格式,它就紅。
    expect(calls[0]?.dedup_key).toBe(pin.expected);
  });
});
