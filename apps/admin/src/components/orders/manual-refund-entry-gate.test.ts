import { describe, expect, it } from 'vitest';
import { shouldShowManualRefundEntry } from './manual-refund-entry-gate';
import type { PaymentListData } from './payment-list';
// 🔴 **路徑是抄受測檔第 1 行的, 不是我猜的** —— 第一版我猜成 `../../lib/payment/payment-read`,
//    而 **7 格全綠**:vitest 不做型別解析, 只有 `typecheck` 會紅。
//    📌 一個壞掉的 type-only import, 在測試那把尺上是**看不見的**。

// ═══════════════════════════════════════════════════════════════════════════
// ⟦b4-ZEROREMAININGSHOWSFORM⟧ 2026-09-08 —— 那道閘的**純函式層**守門。
//
// 🔴🔴 **本檔存在的理由是一個【全綠】** —— 我把那道閘從「只擋負數」改成「只放行正數」
//    (`null` 與 `0` 從放行改成擋), 而 `refund-wiring.test.tsx` 的 **65 格一格都沒紅**。
// 🛑 ⇒ 📌 **既有測試對這一整個維度是【失明】的。**
//
// ⛔ ~~「它們餵的 `refundUnregisteredAmount` 永遠是同一種值(正數或 877), 而常數維度不會紅」~~
// 🔴 **2026-09-08 codex `gpt-6-astra` R1 駁回這句, 而它是對的 —— 我的機制解釋是錯的。**
//    🔬 當場數那支檔的分佈(`grep -o … | sort | uniq -c`, 不是印象):
//       `877`×6 · `1000`×4 · **`null`×1 —— 而那一發是 `beforeEach` 的【預設值】(`:207`)** ·
//       `0`×1(我剛加的)· `-1000`×1(`:475`)
//    ⇒ 📌 **那一維【不是常數】** —— `null` 甚至是預設, 而負值也有人餵。
// ✅ **真正的機制是**:**測那張表單的那幾格【才會覆寫】, 而它們一律覆寫成正數**;
//    其餘用預設 `null` 的格**根本不在問那張表單**(它們在測帳本區塊、狀態列…)
//    ⇒ 所以我把 `null` 從放行改成擋, 它們一格都不會紅。
// 🎯 **⇒ 這一格本身就是教訓**:**一個正確的觀察(改了沒紅)配上一個錯的機制解釋,
//    而【結論對的時候沒有人查理由】** —— 抓到它的是換一個角度的審查者, 不是更多格子。
// ⇒ 🎯 **所以本檔一次釘死【四個 bucket】** —— 正數 / 0 / 負 / null,
//    而不是只補「0 那一格」:只補命中的那一格, 下次換另一格再來一次。
//
// 🔵 **這一片是刻意的行為改變, 而方向寫在這裡**(取捨要寫得下來, 否則與 bug 在 diff 上同形):
//    `null` 舊行為 = **放行**, 新行為 = **擋**。理由不是「感覺安全」, 是**跟 DB 對齊** ——
//    `20260905280000:273-276` 對 `NULL` 是 fail-closed(檔內逐字:「這與『額度不足』不同:
//    那是金額問題, 這是**看不到帳本**」), `:277` 對 `0` 之上的任何正金額一律拒。
//    📌 **兩道閘看同一件事就不會分岔** —— 而分岔的代價是員工按下去才知道。
//
// ⚠️ **本檔證不到的**:`refundUnregisteredAmount` 那個值**本身**對不對
//    (它來自 `pcm_order_refundable_remaining`, 而那支只反映**本系統帳本** ——
//     Sean 直接在 TapPay Portal 退的錢不在裡面, 見 `refund-ledger-view.ts:10-14` 的措辭鐵律)。
//    本檔只問:**給定那個值, 那張表單該不該出現。**
// ═══════════════════════════════════════════════════════════════════════════

const rails = (...list: string[]): PaymentListData =>
  ({ status: 'ok', rows: list.map((rail) => ({ rail })) }) as unknown as PaymentListData;

function show(over: {
  amount?: number | null;
  failed?: boolean;
  payments?: PaymentListData;
}): boolean {
  return shouldShowManualRefundEntry({
    payments: over.payments ?? rails('cash'),
    refundUnregisteredFailed: over.failed ?? false,
    refundUnregisteredAmount: over.amount === undefined ? 1000 : over.amount,
  });
}

describe('⟦b4-ZEROREMAININGSHOWSFORM⟧ 帳本未登記額的四個 bucket', () => {
  it('🟢 正數 ⇒ 顯示(正對照 —— 少了這格, 一個【永遠回 false】的實作會讓下面三格全綠)', () => {
    expect(show({ amount: 1000 }), '正常單看不到登記表單 ⇒ 這片把功能關掉了').toBe(true);
  });

  it('🟢 最小正數 1 ⇒ 顯示(邊界;codex R1 nit 補的)', () => {
    // 🛑 少了這一格:把門檻改成「至少 1000」⇒ 上面那格(餵 1000)照樣綠,
    //    而**一張只剩 1 元可登記的單會被錯擋** ⇒ 員工登記不了那 1 元。
    // 📌 只餵一個正數 = 那一側只有一個點, 而「大於 0」與「大於等於 1000」在那個點上同值。
    expect(show({ amount: 1 }), '只剩 1 元的單看不到表單 ⇒ 門檻被寫成某個大於 1 的數').toBe(true);
  });

  it('🔴 0(帳本已記走全額)⇒ 不顯示', () => {
    // 舊行為:顯示。而 DB `:277` 是 `IF p_refund_amount > v_remaining THEN RAISE`
    // ⇒ remaining=0 時**任何正金額都被拒** ⇒ 那張表單沒有一個他填得出來的值會成功。
    expect(show({ amount: 0 }), '0 仍顯示 ⇒ 員工拿到一張填什麼都會被擋的表單').toBe(false);
  });

  it('🔴 null(查無此單 / 帳本讀不到)⇒ 不顯示', () => {
    // 舊行為:**顯示**(舊條件是 `!(amount !== null && amount < 0)` ⇒ null 走 `!(false)`)。
    // 🛑 而 DB `:273-276` 對 NULL 是 fail-closed ⇒ 兩道閘原本在這一格是分岔的。
    expect(show({ amount: null }), 'null 仍顯示 ⇒ 前端放行而 DB 擋 ⇒ 兩道閘分岔').toBe(false);
  });

  it('🔴 負數(超退)⇒ 不顯示(這一格舊版就擋, 釘著防回歸)', () => {
    expect(show({ amount: -1 })).toBe(false);
  });
});

describe('⟦b4-ZEROREMAININGSHOWSFORM⟧ 其餘三個條件沒被這次改動碰到(防回歸)', () => {
  it('🔴 帳本健康閘紅 ⇒ 不顯示', () => {
    expect(show({ failed: true })).toBe(false);
  });

  it('🔴 收款清單讀不到 ⇒ 不顯示', () => {
    expect(show({ payments: { status: 'error' } as unknown as PaymentListData })).toBe(false);
  });

  it('🔴 純刷卡單(無非卡軌)⇒ 不顯示;🟢 而混合單要顯示', () => {
    expect(show({ payments: rails('card') }), '純刷卡單不該有非卡退款登記入口').toBe(false);
    expect(show({ payments: rails('cash', 'card') }), '混合單看不到 ⇒ ⟦b4-MIXEDRAILMANUALREFUND⟧ 白做了').toBe(
      true,
    );
    expect(show({ payments: rails('bank_transfer') }), '匯款單也要顯示').toBe(true);
  });
});
