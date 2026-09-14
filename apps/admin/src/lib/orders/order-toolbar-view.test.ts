import { describe, expect, it, vi } from 'vitest';

// `order-list-count.ts` 是 server-only(它 import next/headers);這裡只用它的兩支純函式。
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('./order-repository', () => ({ getAdminOrderRepository: () => ({}) }));
import type { AdminOrderFilter } from '@pcm/domain';
import { parseOrderListSearchParams } from './order-list-view';
import { hrefToRaw, frozenListHref } from './order-list-count';
import {
  STATUS_CHIPS,
  VIEW_CHIPS,
  applyStatusChip,
  applyViewChip,
  currentTaipeiMonth,
  monthFilterRange,
  monthOfFilter,
  monthYmdRange,
  shiftMonth,
  statusChipActive,
  viewChipActive,
} from './order-toolbar-view';

const NOW = new Date('2026-09-13T04:00:00Z');
const byKey = (k: string) => STATUS_CHIPS.find((c) => c.key === k)!;
const viewByKey = (k: string) => VIEW_CHIPS.find((c) => c.key === k)!;

describe('狀態 chip(第一列)= 既有 URL 參數的映射', () => {
  // 🔬 突變對照(主視窗:「改掉一個篩選 ⇒ 那個數字的測試要紅」):把 `open` 的 goodsAxes 少一值 / `unpaid` 拿掉 pendingOnly
  //    / `instock` 改 'ordered' ⇒ 對應那一格紅。
  it('六顆各釘一個 filter;未完成 = 三值、待收款 = unpaid × pending、已完成 = shipped', () => {
    expect(applyStatusChip({}, byKey('open')).goodsAxes).toEqual(['none', 'ordered', 'instock']);
    expect(applyStatusChip({}, byKey('unpaid'))).toMatchObject({ paymentStatus: 'unpaid', pendingOnly: true });
    expect(applyStatusChip({}, byKey('to-order')).goodsAxes).toEqual(['none']);
    expect(applyStatusChip({}, byKey('ordered')).goodsAxes).toEqual(['ordered']);
    expect(applyStatusChip({}, byKey('instock')).goodsAxes).toEqual(['instock']);
    expect(applyStatusChip({}, byKey('shipped')).goodsAxes).toEqual(['shipped']);
  });

  it('🔴 換 chip 先清三個共有鍵:從「待收款」按「待下訂」⇒ paymentStatus / pendingOnly 不得殘留', () => {
    const f1 = applyStatusChip({ orderSources: ['web'] }, byKey('unpaid'));
    const f2 = applyStatusChip(f1, byKey('to-order'));
    expect(f2.paymentStatus).toBeUndefined();
    expect(f2.pendingOnly).toBeUndefined();
    expect(f2.goodsAxes).toEqual(['none']);
    expect(f2.orderSources, '不屬於 chip 的軸要原樣帶著走').toEqual(['web']);
  });

  it('🔴 往返:套 chip → 產網址 → 用列表頁 parser 讀回 ⇒ 同一顆 chip 判成選中(而且只有它)', () => {
    for (const chip of STATUS_CHIPS) {
      const href = frozenListHref(applyStatusChip({}, chip), NOW);
      const back = parseOrderListSearchParams(hrefToRaw(href), { now: NOW }).filter;
      const active = STATUS_CHIPS.filter((c) => statusChipActive(c, back)).map((c) => c.key);
      expect(active, `${chip.label} 往返後亮的 chip`).toEqual([chip.key]);
    }
  });

  it('沒有任何狀態鍵 ⇒ 六顆都不亮(舊書籤 payment_status=paid 也不會誤亮)', () => {
    expect(STATUS_CHIPS.filter((c) => statusChipActive(c, {}))).toEqual([]);
    expect(STATUS_CHIPS.filter((c) => statusChipActive(c, { paymentStatus: 'paid' }))).toEqual([]);
  });
});

describe('只看 chip(第三列)', () => {
  it('全部 = 清掉本列四個鍵、不動第一列的貨品軸', () => {
    const f: AdminOrderFilter = { goodsAxes: ['none'], paymentStatus: 'partiallyPaid', orderSources: ['web'], includeUnpaidCardOrders: true };
    const out = applyViewChip(f, viewByKey('all'));
    expect(out.goodsAxes).toEqual(['none']);
    expect(out.paymentStatus).toBeUndefined();
    expect(out.orderSources).toBeUndefined();
    expect(out.includeUnpaidCardOrders).toBeUndefined();
    expect(viewChipActive(viewByKey('all'), out)).toBe(true);
    expect(viewChipActive(viewByKey('all'), f)).toBe(false);
  });

  it('選中的再按一次 = 取消那一鍵;來源與管道可以疊', () => {
    let f = applyViewChip({}, viewByKey('src-web'));
    expect(f.orderSources).toEqual(['web']);
    f = applyViewChip(f, viewByKey('ch-bank_transfer'));
    expect(f).toMatchObject({ orderSources: ['web'], paymentChannels: ['bank_transfer'] });
    f = applyViewChip(f, viewByKey('src-web'));
    expect(f.orderSources).toBeUndefined();
    expect(f.paymentChannels).toEqual(['bank_transfer']);
  });

  it('尾款未收 = partiallyPaid,會讓第一列「待收款」熄掉(兩者互斥,是對的)', () => {
    const f = applyViewChip(applyStatusChip({}, byKey('unpaid')), viewByKey('partial'));
    expect(f.paymentStatus).toBe('partiallyPaid');
    expect(statusChipActive(byKey('unpaid'), f)).toBe(false);
    expect(viewChipActive(viewByKey('partial'), f)).toBe(true);
  });

  it('含刷卡未付款 chip 的字面要與 page.tsx 的提示一致(page.test 另有一道對原始碼的守門)', () => {
    expect(viewByKey('show-unpaid-card').label).toBe('含刷卡未付款');
    expect(applyViewChip({}, viewByKey('show-unpaid-card')).includeUnpaidCardOrders).toBe(true);
  });
});

describe('月份切換', () => {
  it('台北整月:2 月 28 天、12 月跨年、date_to 是含的最後一天', () => {
    expect(monthYmdRange({ y: 2026, m: 2 })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthYmdRange({ y: 2028, m: 2 })).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(shiftMonth({ y: 2026, m: 12 }, 1)).toEqual({ y: 2027, m: 1 });
    expect(shiftMonth({ y: 2026, m: 1 }, -1)).toEqual({ y: 2025, m: 12 });
    expect(currentTaipeiMonth(new Date('2026-09-30T16:30:00Z')), 'UTC 9/30 16:30 = 台北 10/1').toEqual({ y: 2026, m: 10 });
  });

  it('🔴 往返:整月 filter → 網址 → parser 讀回 ⇒ 仍判成同一個月;近半年 / 自訂 ⇒ null', () => {
    const f = { ...monthFilterRange({ y: 2026, m: 9 }) };
    const back = parseOrderListSearchParams(hrefToRaw(frozenListHref(f, NOW)), { now: NOW }).filter;
    expect(monthOfFilter(back)).toEqual({ y: 2026, m: 9 });
    const halfYear = parseOrderListSearchParams({}, { now: NOW }).filter;
    expect(monthOfFilter(halfYear)).toBeNull();
    const custom = parseOrderListSearchParams({ date_from: '2026-09-01', date_to: '2026-09-15' }, { now: NOW }).filter;
    expect(monthOfFilter(custom)).toBeNull();
    expect(monthOfFilter({})).toBeNull();
  });
});

describe('Q5 乙(2026-09-14):只看 · 車行 / 直客 / 經銷', () => {
  it('三顆各釘一級;疊在來源 / 管道上不互相清;再按一次取消', () => {
    expect(applyViewChip({}, viewByKey('tier-store')).customerTiers).toEqual(['store']);
    expect(applyViewChip({}, viewByKey('tier-general')).customerTiers).toEqual(['general']);
    expect(applyViewChip({}, viewByKey('tier-premiumStore')).customerTiers).toEqual(['premiumStore']);
    let f = applyViewChip({ orderSources: ['web'] }, viewByKey('tier-store'));
    expect(f).toMatchObject({ orderSources: ['web'], customerTiers: ['store'] });
    expect(viewChipActive(viewByKey('tier-store'), f)).toBe(true);
    f = applyViewChip(f, viewByKey('tier-store'));
    expect(f.customerTiers).toBeUndefined();
    expect(f.orderSources).toEqual(['web']);
  });

  it('「全部」也清掉 tier;與第一列狀態 chip 不相交(套狀態 chip 不動 tier)', () => {
    const f = applyViewChip({ customerTiers: ['store'], goodsAxes: ['none'] }, viewByKey('all'));
    expect(f.customerTiers).toBeUndefined();
    expect(f.goodsAxes).toEqual(['none']);
    expect(applyStatusChip({ customerTiers: ['store'] }, byKey('shipped')).customerTiers).toEqual(['store']);
  });
});

describe('Q5 乙(2026-09-14):只看 · 多樣的單', () => {
  it('開 / 再按取消;與 tier、狀態 chip 可疊;「全部」清掉', () => {
    let f = applyViewChip({ customerTiers: ['store'] }, viewByKey('multi-item'));
    expect(f).toMatchObject({ customerTiers: ['store'], multiItemOnly: true });
    expect(viewChipActive(viewByKey('multi-item'), f)).toBe(true);
    f = applyViewChip(f, viewByKey('multi-item'));
    expect(f.multiItemOnly).toBeUndefined();
    expect(applyStatusChip({ multiItemOnly: true }, byKey('instock')).multiItemOnly).toBe(true);
    expect(applyViewChip({ multiItemOnly: true }, viewByKey('all')).multiItemOnly).toBeUndefined();
  });
});

describe('只看 · 已取消(Sean 2026-09-14 線上:預設「未完成」把已取消藏掉、沒地方叫出來)', () => {
  it('🔴 按「已取消」⇒ cancelledOnly + 六顆狀態鍵全清(全不亮);往返網址 ⇒ 仍是它、六顆仍不亮', () => {
    const fromOpen = applyStatusChip({}, byKey('open'));
    const f = applyViewChip(fromOpen, viewByKey('cancelled'));
    expect(f.cancelledOnly).toBe(true);
    expect(f.goodsAxes, '留著未完成的貨品軸 ⇒ adapter 加 cancelled_at IS NULL ⇒ 空集合').toBeUndefined();
    expect(STATUS_CHIPS.every((c) => !statusChipActive(c, f))).toBe(true);
    expect(viewChipActive(viewByKey('cancelled'), f)).toBe(true);
    const back = parseOrderListSearchParams(hrefToRaw(frozenListHref(f, NOW)), { now: NOW }).filter;
    expect(back.cancelledOnly).toBe(true);
    expect(STATUS_CHIPS.every((c) => !statusChipActive(c, back))).toBe(true);
  });
  it('🔴 互斥的另一半:在「已取消」上按任一狀態 chip ⇒ cancelledOnly 關掉;再按一次「已取消」= 取消;「全部」清掉', () => {
    const f = applyViewChip({}, viewByKey('cancelled'));
    expect(applyStatusChip(f, byKey('instock')).cancelledOnly).toBeUndefined();
    expect(applyViewChip(f, viewByKey('cancelled')).cancelledOnly).toBeUndefined();
    expect(applyViewChip(f, viewByKey('all')).cancelledOnly).toBeUndefined();
  });
  it('「已退款」同一條互斥:從「未完成」按它 ⇒ 貨品軸清掉(否則 goods_axis + <> refunded + = refunded 恆空)', () => {
    const f = applyViewChip(applyStatusChip({}, byKey('open')), viewByKey('refunded'));
    expect(f.paymentStatus).toBe('refunded');
    expect(f.goodsAxes).toBeUndefined();
  });
  it('「全部」在沒有狀態 chip 亮時 = 零篩選(含已取消 / 已退款都看得到)', () => {
    const f = applyViewChip({ cancelledOnly: true, paymentStatus: 'refunded' }, viewByKey('all'));
    expect(Object.values(f).every((v) => v === undefined)).toBe(true);
  });
});
