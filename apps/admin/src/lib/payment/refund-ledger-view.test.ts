import { describe, expect, it } from 'vitest';
import { refundStatusLabel } from './refund-ledger-view';

// refund-ledger-view.test.ts —— 🔴 **本檔 2026-09-07 新建, 而理由是量到的**:
//   我在 `REFUND_STATUS_LABEL` 加了新態 `voided`, 跑三綠 ⇒ **6821 格全過, 零紅**。
//   去問「誰在看那張表」:`grep -rln refundStatusLabel apps/admin/src` ⇒ 兩支測試檔有引用
//   (`refund-ledger-section.test.tsx` / `refund-exceptions/page.test.tsx`)
//   ⇒ 🛑 **所以不是「沒有人測」** —— 而 `grep -c voided` 對那兩支 ⇒ **各 0**。
//   ⚠️ 而它們的形狀是 `expect(text).toContain(refundStatusLabel('confirmed'))`
//      —— **拿標籤去比標籤** ⇒ 那幾格對「文案改成什麼」是恆真的
//      (那支檔自己 `:133` 就記著這件事:「改回舊字面不會有任何一格紅」)。
//   ⇒ 📌 **一張查表加一個值, 既有的覆蓋一格都幫不上忙** —— 而它印在員工看錢的畫面上。

describe('🔴 ⟦b4-TAPPAYDIRECT⟧ voided:作廢的補登列', () => {
  it('有自己的中文標籤(不是原樣印出 voided 五個字母)', () => {
    expect(refundStatusLabel('voided')).not.toBe('voided');
    expect(refundStatusLabel('voided')).toContain('作廢');
  });

  it('🔴🔴 那句話要說出【不計入退款金額】—— 員工看的是錢, 不是狀態名', () => {
    // 病:寫成「已作廢」而不說錢 ⇒ 員工不知道這一列還算不算在「退了多少」裡,
    //    而那正是他打開這個畫面要回答的問題。
    expect(refundStatusLabel('voided')).toMatch(/不計入|不算/);
  });

  it('🛑 而它不得說成「已退款」或「錢沒有動」—— 那筆錢在 TapPay 那邊可能真的動過', () => {
    // 作廢的意思是【我們這一列記錯了】, 不是「錢退回來了」, 也不是「錢從來沒動」。
    const s = refundStatusLabel('voided');
    expect(s).not.toMatch(/退款完成|錢沒有動/);
  });

  it('🔵 正對照:既有四態的標籤一個字都沒變(本片不得順手改別人的文案)', () => {
    expect(refundStatusLabel('processing')).toContain('處理中');
    expect(refundStatusLabel('confirmed')).toContain('退款完成');
    expect(refundStatusLabel('failed')).toContain('錢沒有動');
    expect(refundStatusLabel('deferred')).toContain('尚未請款');
  });

  it('🔵 負對照:未知態仍然原樣印出 —— 這條 fallback 是本片能只加一行的前提', () => {
    // 🔬 而它也是我判「A2 的 TS 面只需要一行」的依據:那張表是 Record<string,string>
    //    不是 union ⇒ 新增 status 不會有 typecheck 連鎖。
    expect(refundStatusLabel('zzz_never_exists')).toBe('zzz_never_exists');
  });
});
