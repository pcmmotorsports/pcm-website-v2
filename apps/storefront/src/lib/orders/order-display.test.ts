// order-display.test.ts — 訂單顯示工具測試
//
// - orderStatusLabel:20 組 exhaustive(5 payment × 4 fulfillment 全列)逐一斷言中文(codex N1);
//   🔴 **這張表證的是「付款狀態不受出貨軸影響」,證不了「partiallyPaid 一定是收了訂金」** ——
//   它沒有那個維度(沒有『部分收款 / 付清後沖銷 / 部分退款 / 超收』這幾種來源的案例)。
//   codex 關卡2 2026-08-18 指出這一點;為什麼今天仍可以這樣寫、以及那張欠條,見 order-display.ts 的 JSDoc。
//   明確鎖 partiallyPaid→「已收訂金」(2026-08-18 Sean Q06=甲,原「付款確認中」)、refunded→「已退款」、partiallyRefunded→「已退部分」、
//   paid→(任意 fulfillment)「處理中」(A9f row47:stale 出貨軸下架、第 1 批固定文案)、絕不空字串。
// - formatOrderDate:ISO → YYYY-MM-DD(Asia/Taipei、含跨日 UTC 邊界)。

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { PaymentStatus, FulfillmentStatus } from '@pcm/domain';
import { orderStatusLabel, formatOrderDate, paymentMethodLabel } from './order-display';

/**
 * 沒有取消的單(`#249` 加的第三個參數)。
 *
 * 🔴 **下面那 20 組全部餵這個值** —— 因為它們證的是**付款軸**,而取消軸會壓過付款軸。
 *    餵一張取消單進去,那 20 組會全部變成「已取消」而**表還是綠的**(它們只是不再證原本要證的事)。
 */
const NOT_CANCELLED = 'none' as const;

// 20 組 = 5 payment × 4 fulfillment(全列、不寫「或等價」弱化、codex N1)
// 🔴 M-3 RF2a 加 partiallyRefunded 後由 16 → 20:本檔的 toHaveLength 是**獨立硬斷言**、
//    不從型別衍生 ⇒ 漏改會轉紅(這正是要的:加 enum 值不該靜默通過)。
const STATUS_CASES: Array<[PaymentStatus, FulfillmentStatus, string]> = [
  ['refunded', 'notOrdered', '已退款'],
  ['refunded', 'ordered', '已退款'],
  ['refunded', 'inStock', '已退款'],
  ['refunded', 'shipped', '已退款'],
  ['unpaid', 'notOrdered', '待付款'],
  ['unpaid', 'ordered', '待付款'],
  ['unpaid', 'inStock', '待付款'],
  ['unpaid', 'shipped', '待付款'],
  ['partiallyPaid', 'notOrdered', '已收訂金'],
  ['partiallyPaid', 'ordered', '已收訂金'],
  ['partiallyPaid', 'inStock', '已收訂金'],
  ['partiallyPaid', 'shipped', '已收訂金'],
  ['partiallyRefunded', 'notOrdered', '已退部分'],
  ['partiallyRefunded', 'ordered', '已退部分'],
  ['partiallyRefunded', 'inStock', '已退部分'],
  ['partiallyRefunded', 'shipped', '已退部分'],
  // 🔴 A9f(E10 master plan v2 §5.1 row47):paid 一律「處理中」、不再細分 stale 出貨軸;
  //    四列仍全列(釘「任意 fulfillment 皆同值」,漏一列 = 出貨軸悄悄回來也抓得到)。
  ['paid', 'notOrdered', '處理中'],
  ['paid', 'ordered', '處理中'],
  ['paid', 'inStock', '處理中'],
  ['paid', 'shipped', '處理中'],
];

describe('orderStatusLabel(20 組 exhaustive 雙軸映射、Q2=A)', () => {
  it.each(STATUS_CASES)('payment=%s fulfillment=%s → %s', (payment, fulfillment, expected) => {
    expect(orderStatusLabel(payment, fulfillment, NOT_CANCELLED)).toBe(expected);
  });

  it('恰 20 組(5 payment × 4 fulfillment 全覆蓋)', () => {
    expect(STATUS_CASES).toHaveLength(20);
  });

  it('關鍵狀態鎖定 + 絕不回空字串', () => {
    expect(orderStatusLabel('partiallyPaid', 'notOrdered', NOT_CANCELLED)).toBe('已收訂金');
    expect(orderStatusLabel('refunded', 'shipped', NOT_CANCELLED)).toBe('已退款');
    expect(orderStatusLabel('paid', 'shipped', NOT_CANCELLED)).toBe('處理中'); // A9f:paid 不再顯出貨階段
    for (const [payment, fulfillment] of STATUS_CASES) {
      expect(orderStatusLabel(payment, fulfillment, NOT_CANCELLED)).not.toBe('');
    }
  });
});

// ── `#249`(2026-08-24):取消軸 ────────────────────────────────────────────────
// Sean 拍板逐字(他看到的選項字面):「甲 也顯示, 但標清楚「已取消」/「已逾期」, 不能點去付款」
describe('orderStatusLabel · 取消軸壓過付款軸(`#249`)', () => {
  const CANCELLED = 'cancelled' as const;
  const EXPIRED = 'expired' as const;

  it('🔴🔴 這片的**核心斷言**:一張已取消的單是 `unpaid` ⇒ 舊碼會印「待付款」⇒ 客人去付一張作廢單', () => {
    // 🔴 `unpaid` 不是隨手挑的值 —— 取消**不動** `payment_status`
    //    (`20260804180000_..._admin_cancel_order.sql:253-254` audit before/after 同值;
    //     `20260809160000_..._expire_unpaid_orders_fn.sql:18` 逐字「不動 payment_status」)
    //    ⇒ **每一張取消單走到這裡時都是 `unpaid`**。這一格紅掉 = `#249` 的傷害回來了。
    expect(orderStatusLabel('unpaid', 'notOrdered', CANCELLED)).toBe('已取消');
    expect(orderStatusLabel('unpaid', 'notOrdered', EXPIRED)).toBe('已逾期');
    // 負對照:同樣的付款軸、**沒有取消** ⇒ 仍是「待付款」(證上面那兩格是取消軸造成的)
    expect(orderStatusLabel('unpaid', 'notOrdered', NOT_CANCELLED)).toBe('待付款');
  });

  it('取消軸壓過【每一個】付款狀態,不是只壓 unpaid', () => {
    // 已付款後才取消(退款線)⇒ 客人看到的仍必須是「已取消」,不是「處理中」
    for (const [payment, fulfillment] of STATUS_CASES) {
      expect(orderStatusLabel(payment, fulfillment, CANCELLED)).toBe('已取消');
      expect(orderStatusLabel(payment, fulfillment, EXPIRED)).toBe('已逾期');
    }
  });

  // 📌 ~~原本這裡有兩格在測「reason 為 null」與「只准等於 payment_expired」~~ ——
  //    codex must-fix(2026-08-24)之後**這一層拿不到原始欄位了**(第三參數是枚舉),
  //    那兩格的對象整個搬到 `packages/domain/src/order/order-cancel-reason.test.ts`。
  //    🔴 **是搬走,不是刪掉** —— 那兩件事仍然要有人守,只是守的位置變了。
});

describe('formatOrderDate(ISO → YYYY-MM-DD、Asia/Taipei)', () => {
  it('同日:UTC 10:00 + 8h = 同日 18:00 台灣', () => {
    expect(formatOrderDate('2099-04-15T10:00:00Z')).toBe('2099-04-15');
  });

  it('跨日:UTC 16:30 + 8h = 隔日 00:30 台灣 → 進位隔日(非退前一日 off-by-one)', () => {
    expect(formatOrderDate('2099-04-15T16:30:00Z')).toBe('2099-04-16');
  });

  it('午夜邊界:UTC 00:00 + 8h = 同日 08:00 台灣', () => {
    expect(formatOrderDate('2099-04-15T00:00:00Z')).toBe('2099-04-15');
  });
});

describe('paymentMethodLabel', () => {
  it('tappay → 信用卡(客人結帳時看到的就是這四個字,同一件事同一個詞)', () => {
    expect(paymentMethodLabel('tappay')).toBe('信用卡');
  });

  // 🔴 這一格是本組的**理由**,不是補充:`payment_method` 沒有 CHECK 約束
  //    ⇒ 值域無法窮舉 ⇒ 認不得的值必須**原樣印出**。
  //    窮舉表遇到沒列到的值會印 undefined/空白,而**空白與「這張單沒有付款方式」長得一樣**
  //    ⇒ 客人會以為那一格是壞的,而我們會以為那一格是空的。
  it('認不得的值 → 原樣印出,不吞成空白', () => {
    expect(paymentMethodLabel('linepay')).toBe('linepay');
    expect(paymentMethodLabel('qqx7bogus4930')).toBe('qqx7bogus4930');
  });

  it('空字串 → 原樣回空字串(由呼叫端的 dash() 決定印什麼,本函式不越權)', () => {
    expect(paymentMethodLabel('')).toBe('');
  });

  // 🔴🔴 **分母守門** —— 上面三格證的是「函式行為對」,證不了「我們有沒有漏翻一個值」。
  //    這一格去**掃 migrations 裡所有真的被寫進 payment_method 的字面**,
  //    要求每一個都翻得出中文(= 翻譯結果不等於原值)。
  //    ⇒ 有人新增一種付款方式而忘了補對照時,**這一格會紅**;
  //      沒有它的話,客人會在訂單頁上再看到一次原始代號,而三綠全綠。
  //    ⚠️ 射程:它掃的是 `supabase/migrations` 的**字面寫入**。
  //       app 層若有別的寫入點、或正式庫有歷史殘值,**不在這個分母裡**。
  it('分母:migrations 裡每一個寫進 payment_method 的字面,都翻得出中文', () => {
    const dir = join(__dirname, '../../../../../supabase/migrations');
    const found = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
      const sql = readFileSync(join(dir, f), 'utf8');
      for (const m of sql.matchAll(/payment_method\s*=\s*'([^']+)'/g)) {
        const v = m[1];
        if (v !== undefined) found.add(v);
      }
    }
    // 🔴 正對照:掃不到任何值 = 尺瞎了(regex 壞了 / 路徑錯了),那時上面的迴圈會「全過」而什麼都沒證。
    expect(found.size, '一個值都沒掃到 ⇒ 這把尺沒有接上,不是「沒有漏翻」').toBeGreaterThan(0);
    for (const v of found) {
      expect(paymentMethodLabel(v), `payment_method 的字面「${v}」沒有中文對照`).not.toBe(v);
    }
  });
});
