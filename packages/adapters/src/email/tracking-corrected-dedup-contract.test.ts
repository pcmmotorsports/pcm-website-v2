// 🔴 跨檔契約測試:更正信的 `dedup_key` 有【兩份實作】, 而這一格是唯一在守「兩份寫的是同一個格式」的東西。
//
// 🔵 **整支照 `shipped-email-dedup-contract.test.ts` 做** —— 同一個病、同一種量具。
//    ⇒ 📌 而它的存在理由是 codex 對抗審查 2026-09-04 抓的:
//      我在兩邊各寫了一份鍵, **而兩份漂掉的症狀是【重複寄信】不是報錯**, 三綠不會紅。
//    ⚠️ **鍵的形狀在同一夜換過兩次**(號碼 ⇒ 更正時點 ⇒ 箱:單:更正時點)——
//      所以本檔一律**從 migration 的釘樁反推**, 不在這裡寫死任何一段字面。
//
// 這一格會紅的兩種改法(**任一側單獨改就紅**):
//   · SQL 側改格式  ⇒ migration 釘樁的期望字面變了 ⇒ 與 adapter 算出的不合
//   · TS 側改格式   ⇒ adapter 算出的變了 ⇒ 與 migration 的期望字面不合
//
// ⚠️ 它**不會**抓到「兩邊同時被改成同一個新格式」—— 那是刻意變更, 不是漂移。
// ⚠️ 而它**不保證正式庫那支函式真的是這一版**(migration 可能還沒 apply)。
//    那要 apply 期的釘樁, 在 migration 那個 `DO $$` 裡。
import { describe, it, expect, vi } from 'vitest';

// adapter 檔頭 import 'server-only'(鏡像兄弟檔)。
vi.mock('server-only', () => ({}));

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { SupabaseEmailOutboxAdapter, type EmailOutboxClient } from './SupabaseEmailOutboxAdapter';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(
  HERE,
  '../../../../supabase/migrations/20260904220000_m4b_outbox_shipment_tracking_corrected_event.sql',
);

/**
 * 從 migration 的字面釘樁撈出「輸入 uuid + 輸入號碼 + 期望輸出」。
 *
 * 🔴 **撈不到就 throw, 不回預設值。** 回預設值的話, migration 改名或那段被刪掉時
 * 本格會**照樣綠** —— 而那正是它要防的情況(母題:恆真守門)。
 */
function readSqlPin(): { shipmentId: string; orderId: string; correctedAt: string; expected: string } {
  const sql = readFileSync(MIGRATION, 'utf8');
  const m = sql.match(
    /public\.pcm_tracking_corrected_dedup_key\(\s*'([0-9a-fA-F-]+)'::uuid,\s*'([0-9a-fA-F-]+)'::uuid,\s*'([^']+)'::timestamptz\s*\);\s*IF v <> '([^']+)'/,
  );
  if (
    m === null ||
    m[1] === undefined ||
    m[2] === undefined ||
    m[3] === undefined ||
    m[4] === undefined
  ) {
    throw new Error(
      `讀不到 migration 的 dedup 釘樁(檔案:${MIGRATION})—— ` +
        '本測試無法在「讀不到」的情況下宣稱兩邊一致, 故直接失敗。',
    );
  }
  return { shipmentId: m[1], orderId: m[2], correctedAt: m[3], expected: m[4] };
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

describe('更正信 dedup_key 跨檔契約(SQL migration ↔ TS adapter)', () => {
  it('🔴 migration 撈得到釘樁 —— 撈不到就是量具沒接上, 不是「一致」', () => {
    const pin = readSqlPin();
    expect(pin.shipmentId).toMatch(/^[0-9a-fA-F-]{36}$/);
    expect(pin.correctedAt.length).toBeGreaterThan(0);
    // 期望字面必須真的長成「箱 id : 訂單 id : 20 位數字」, 不是隨便一段字。
    expect(pin.expected.split(':')).toHaveLength(3);
    expect(pin.expected.split(':')[0]).toBe(pin.shipmentId);
    expect(pin.expected.split(':')[1]).toBe(pin.orderId);
    expect(pin.expected.split(':')[2]).toMatch(/^\d{20}$/);
  });

  it('🔴 TS adapter 算出來的 key, 逐字等於 migration 釘住的期望值', async () => {
    const pin = readSqlPin();
    const { client, calls } = captureInsert();
    await new SupabaseEmailOutboxAdapter(client, { isSyntheticEmail: () => false }).enqueue({
      eventType: 'shipment_tracking_corrected',
      orderId: pin.orderId,
      displayId: 'PCM-2026-0001',
      shipmentId: pin.shipmentId,
      shipmentReference: 'BCDF23',
      trackingNumber: 'ANY-NUMBER-0001',
      // 🔴 **key 從 migration 釘住的期望值反推** —— 而那正是契約的一半:
      //    SQL 把時點算成這 20 位數字, TS 只負責把三段用冒號接起來。
      trackingCorrectedKey: pin.expected.split(':')[2]!,
      recipientEmail: 'customer@example.com',
      requestId: null,
    });

    expect(calls).toHaveLength(1);
    // ⬇️ 這一行就是契約。任一側單獨改格式, 它就紅。
    expect(calls[0]?.dedup_key).toBe(pin.expected);
  });

  it('🔴 它與出貨線那條【不同形】—— 而那是刻意的, 不是漂掉', () => {
    const pin = readSqlPin();
    // 出貨線是 `箱:單`(兩段);本條是 `箱:單:更正時點`(三段)。
    // 🔴 承重:哪天有人「統一」成同一形狀, 這一格會紅 ——
    //    而那個統一會讓同一箱同一單的第二次更正撞到第一次的鍵 ⇒ 第二封安靜地不寄。
    expect(pin.expected.split(':')).toHaveLength(3);
    expect(pin.expected.split(':')[2]).not.toMatch(/^[0-9a-fA-F-]{36}$/);
  });

  it('🔴🔴 【號碼】不在鍵裡 —— 同一個號碼改回來時必須是一把新鑰匙', async () => {
    const pin = readSqlPin();
    const key = pin.expected.split(':')[2]!;
    const run = async (trackingNumber: string) => {
      const { client, calls } = captureInsert();
      await new SupabaseEmailOutboxAdapter(client, { isSyntheticEmail: () => false }).enqueue({
        eventType: 'shipment_tracking_corrected',
        orderId: pin.orderId,
        displayId: 'PCM-2026-0001',
        shipmentId: pin.shipmentId,
        shipmentReference: 'BCDF23',
        trackingNumber,
        trackingCorrectedKey: key,
        recipientEmail: 'customer@example.com',
        requestId: null,
      });
      return calls[0]?.dedup_key;
    };
    // 🔴 承重:一個把號碼接回鍵裡的實作(舊做法), 這兩個值會不同 ⇒ 這一格紅。
    //    而舊做法的病正是它的反面:改回一個**用過的號碼** ⇒ 鍵撞到 ⇒ 最新那封安靜地不寄。
    expect(await run('B-0002')).toBe(await run('C-0003'));
  });

  it('🔴 【訂單 id】在鍵裡 —— 一箱兩單必須是兩把鑰匙(codex R2 抓的)', async () => {
    const pin = readSqlPin();
    const key = pin.expected.split(':')[2]!;
    const run = async (orderId: string) => {
      const { client, calls } = captureInsert();
      await new SupabaseEmailOutboxAdapter(client, { isSyntheticEmail: () => false }).enqueue({
        eventType: 'shipment_tracking_corrected',
        orderId,
        displayId: 'PCM-2026-0001',
        shipmentId: pin.shipmentId,
        shipmentReference: 'BCDF23',
        trackingNumber: 'B-0002',
        trackingCorrectedKey: key,
        recipientEmail: 'customer@example.com',
        requestId: null,
      });
      return calls[0]?.dedup_key;
    };
    // 🔴 承重:少了 orderId 的實作(上一版)這兩個值會相同
    //    ⇒ 第二張單那封 enqueue 回 duplicate ⇒ **安靜地不寄**, 而那個客人永遠拿著錯號碼。
    expect(await run('00000000-0000-0000-0000-00000000aaaa')).not.toBe(
      await run('00000000-0000-0000-0000-00000000bbbb'),
    );
  });
});