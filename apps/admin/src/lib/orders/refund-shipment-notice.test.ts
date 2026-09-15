import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OrderShipmentGroup } from '../shipping/order-shipments';
import { REFUND_SHIPMENT_MESSAGE as M, refundShipmentNotice } from './refund-shipment-notice';

// P0-1 片 5:退款前出貨提醒的分類要跟 SQL 自動取消第 2 代同一套(檔頭)。每格印的是員工會看到的那句話。

function box(
  ref: string,
  over: { shippedAt?: string | null; voidedAt?: string | null; attempted?: boolean } = {},
): OrderShipmentGroup {
  return {
    hctStatus: 'draft',
    hctPlaceholderStuck: false,
    hctLabelRefetchable: false,
    hctDispatchAttempted: over.attempted ?? false,
    hctDispatched: false,
    shipment: {
      id: `sid-${ref}`,
      shipmentReference: ref,
      customerUserId: 'uid',
      carrierCode: 'hct',
      carrierNote: null,
      trackingNumber: null,
      shippedAt: over.shippedAt ?? null,
      voidedAt: over.voidedAt ?? null,
      voidReason: null,
      recipientSnapshot: { name: '', phone: '', line: '' },
    },
    lines: [],
  } as unknown as OrderShipmentGroup;
}

const plain = { cancelled: false, partiallyCancelled: false, mixedRail: false };
const notice = (groups: readonly OrderShipmentGroup[] | null, over: Partial<typeof plain> = {}) =>
  refundShipmentNotice({ groups, ...plain, ...over });
const T = '2026-09-15T00:00:00Z';

describe('refundShipmentNotice', () => {
  it('讀不到 ⇒ 說讀不到, 不靜靜不提醒', () => {
    expect(notice(null)).toEqual([M.unreadable]);
    expect(notice(null, { cancelled: true, mixedRail: true })).toEqual([M.unreadable]);
  });

  it('沒有箱子、沒有 skip 條件 ⇒ 不提醒', () => {
    expect(notice([])).toEqual([]);
  });

  it('只有沒叫車也沒出貨的箱 ⇒ 全額退完會自動取消, 點名要作廢的箱', () => {
    expect(notice([box('BCDFGH'), box('BCDFGJ')])).toEqual([M.live('BCDFGH、BCDFGJ')]);
  });

  it('叫過車沒出貨 ⇒ 不會自動取消, 點名那一箱(沒叫車的箱不說「會自動取消」)', () => {
    expect(notice([box('BCDFGH', { attempted: true }), box('BCDFGJ')])).toEqual([M.dispatched('BCDFGH')]);
  });

  it('有出貨 ⇒ 已出貨那句;叫過車的也一起說', () => {
    expect(notice([box('BCDFGH', { shippedAt: T, attempted: true }), box('BCDFGJ', { attempted: true })])).toEqual([
      M.dispatched('BCDFGJ'),
      M.shipped,
    ]);
  });

  it('作廢的箱不算', () => {
    expect(notice([box('BCDFGH', { voidedAt: T, shippedAt: T })])).toEqual([]);
  });

  it('已取消的單 ⇒ 不說「會自動取消」, 只提醒作廢箱子', () => {
    expect(notice([box('BCDFGH')], { cancelled: true })).toEqual([M.cancelledLive('BCDFGH')]);
    expect(notice([], { cancelled: true })).toEqual([]);
  });

  it('有部分取消紀錄 ⇒ 不會自動取消(SQL skipped:partially_cancelled)', () => {
    expect(notice([box('BCDFGH')], { partiallyCancelled: true })).toEqual([M.partiallyCancelled]);
    expect(notice([], { partiallyCancelled: true, mixedRail: true })).toEqual([M.partiallyCancelled]);
  });

  it('混合軌 ⇒ 不說「會自動取消」, 改說刷卡加人工那句', () => {
    expect(notice([box('BCDFGH')], { mixedRail: true })).toEqual([M.cardPlusManual]);
    expect(notice([], { mixedRail: true })).toEqual([M.cardPlusManual]);
  });
});

describe('對 SQL 第 2 代逐字(改 SQL 的分類或順序 ⇒ 這格紅, 回來看 TS 那份)', () => {
  const HERE = fileURLToPath(new URL('.', import.meta.url));
  const SQL = readFileSync(
    resolve(HERE, '../../../../../supabase/migrations/20260916010000_m4b_p01_auto_cancel_split_by_shipment_state.sql'),
    'utf8',
  )
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .replace(/\s+/g, ' ');

  it('讀箱子的三個分類與「未作廢」條件', () => {
    expect(SQL).toContain('pg_catalog.bool_or(b.hct_dispatch_attempted_at IS NOT NULL AND b.shipped_at IS NULL) AS dispatched');
    expect(SQL).toContain('pg_catalog.bool_or(b.shipped_at IS NOT NULL) AS shipped');
    expect(SQL).toContain('pg_catalog.bool_or(b.hct_dispatch_attempted_at IS NULL AND b.shipped_at IS NULL) AS live');
    expect(SQL).toContain('AND s.deleted_at IS NULL');
    expect(SQL).toContain('m.voided_at IS NULL) THEN RETURN \'skipped:mixed_rail\'');
  });

  it('skip 順序:已取消 → 部分取消 → 混合軌 → 叫過車', () => {
    const at = (s: string) => SQL.indexOf(s);
    const order = [
      "RETURN 'skipped:already_cancelled'",
      "RETURN 'skipped:partially_cancelled'",
      "RETURN 'skipped:mixed_rail'",
      "RETURN 'skipped:hct_dispatched'",
    ].map(at);
    expect(order.every((i) => i > -1), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
