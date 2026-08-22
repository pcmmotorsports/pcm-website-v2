// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { AuditDetail } from './audit-detail';

// audit-detail.test.tsx — `#27` D1c-2b。
//
// 🔴 **本檔的 must = 收合摘要行不得含任何值。**
//   員工不做動作就不該看到客戶資料 / 成本 —— 那是 plan 驗收 9 的實作。
//
// ⚠️⚠️ **誠實邊界(與元件檔頭同一份,不要讀成「收合行為已驗證」)**:
//   · **測得到**:`<summary>` 的文字內容、`<details>` 有沒有預設展開(`open` 屬性)。
//   · **測不到**:真實瀏覽器把內容藏起來這件事 —— **內容在收合時仍在 DOM 裡**
//     (`<details>` 本來就這樣),「看不見」是**繪製行為**不是 DOM 狀態。
//   ⇒ **所以本檔驗的是「摘要行寫了什麼」與「預設是收合的」,不是「使用者看不到值」。**
//   📎 **「globals.css 不得蓋掉 details 行為」那一族在 `audit-detail-css.test.ts`**
//     —— 分開檔是因為**本檔是 jsdom,而 jsdom 下 `import.meta.url` 不是 `file:` scheme**
//     ⇒ `fileURLToPath` 直接丟 `TypeError: The URL must be of scheme file`(實測,不是推測)。
//     repo 既有三支掃 CSS 的守門也都是 `.test.ts`(node 環境),不是 jsdom。
//     有人用 CSS 蓋掉 `details` 預設行為 ⇒ **本檔一格都不會紅。** 那要真瀏覽器,本片沒做。

const CHANGES = [
  { key: 'phone', from: '0912-345-678', to: '0987-654-321' },
  { key: 'note', from: null, to: '客人要求改號' },
];

afterEach(cleanup);

describe('AuditDetail — 收合時不得洩漏值(本片 must)', () => {
  it('🔴 摘要行只寫「N 個欄位有變動」,不含任何欄名或值', () => {
    const { container } = render(<AuditDetail changes={CHANGES} />);
    const summary = container.querySelector('summary');
    expect(summary?.textContent).toBe('2 個欄位有變動');
    // 🔴 負向對照逐項列:任何一個值或欄名跑進摘要行都要紅。
    for (const leak of ['0912-345-678', '0987-654-321', 'phone', 'note', '客人要求改號']) {
      expect(summary?.textContent, `摘要行不得含「${leak}」`).not.toContain(leak);
    }
  });

  it('🔴 預設是收合的(沒有 open 屬性)', () => {
    // 沒有這一格,把 `<details open>` 寫死也會全綠 —— 而那等於「不需要任何動作就看得到」。
    const { container } = render(<AuditDetail changes={CHANGES} />);
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it('正向對照:值確實有被渲染出來(證明上面兩格不是因為根本沒畫)', () => {
    // 少了這格,把整張表刪掉、只留 summary 也會讓上面兩格全綠。
    const { container } = render(<AuditDetail changes={CHANGES} />);
    const text = container.textContent ?? '';
    expect(text).toContain('0912-345-678');
    expect(text).toContain('0987-654-321');
  });
});

describe('AuditDetail — 三欄與沒有值的那一側', () => {
  it('沒有值顯示「(無)」而不是空白(空白會讀成這格壞了)', () => {
    const { container } = render(<AuditDetail changes={[{ key: 'note', from: null, to: 'x' }]} />);
    expect(container.textContent).toContain('(無)');
  });

  it('表頭三欄:欄位 / 原本 / 改成', () => {
    const { container } = render(<AuditDetail changes={CHANGES} />);
    const headers = [...container.querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toEqual(['欄位', '原本', '改成']);
  });

  it('🔴 零變動 ⇒ 顯示說明文字,而且不畫出 details(沒有東西可展開)', () => {
    const { container } = render(<AuditDetail changes={[]} />);
    expect(container.textContent).toContain('沒有記錄欄位變動');
    // 畫一個點得開卻是空的 details,員工會以為自己漏看了什麼。
    expect(container.querySelector('details')).toBeNull();
  });
});

describe('🔴🔴 中文化:未對照要看得見、識別碼不准被翻(2026-08-22 Sean 提)', () => {
  it('已登記的欄位與列舉值都變成中文,而且英文原文不再出現', () => {
    const { container } = render(
      <AuditDetail changes={[{ key: 'kind', from: 'full', to: 'partial' }]} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('退款範圍');
    expect(text).toContain('全額退款');
    expect(text).toContain('部分退款');
    // 🔴 負向對照:英文**不得同時出現**。少了這三條,把中文「附加」在英文旁邊
    //    (而不是取代它)照樣讓上面全綠,而 Sean 螢幕上仍然是一堆英文。
    expect(text).not.toContain('kind');
    expect(text).not.toContain('full');
    expect(text).not.toContain('partial');
  });

  it('🔴 未登記的欄位:原代碼仍在,而且旁邊有【可見的】未對照標記', () => {
    // 🔴 這格擋的是「靜靜印原文」—— 那正是今天的行為,而它看起來完全正常。
    //    ⚠️ 標記必須在**文字內容**裡,不能是 `title` / `aria-label`
    //    (`title` 由 OS 畫、不進 paint tree ⇒ 截圖與 DOM 都抓不到)。
    const { container } = render(
      <AuditDetail changes={[{ key: 'brand_new_column', from: null, to: '1' }]} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('brand_new_column');
    expect(text).toContain('還沒對照成中文');
  });

  it('🔴 對照組:已登記的欄位【不得】出現那個標記(否則上一格是恆真的)', () => {
    // 少了這格,把標記寫成無條件渲染(每一列都印)也會讓上一格全綠 ——
    // 而那會讓整張表都寫著「還沒對照成中文」,標記等於沒有。
    const { container } = render(
      <AuditDetail changes={[{ key: 'refund_amount', from: '100', to: '200' }]} />,
    );
    expect(container.textContent).not.toContain('還沒對照成中文');
  });

  it('🔴🔴 識別碼原樣輸出 —— 一個字都不准變(要拿去跟銀行/TapPay 對帳)', () => {
    const RAW = 'D20260819P8ZewM';
    const { container } = render(
      <AuditDetail changes={[{ key: 'bank_refund_id', from: null, to: RAW }]} />,
    );
    expect(container.textContent).toContain(RAW);
  });

  it('🔴🔴 識別碼剛好長得像列舉值時,仍原樣輸出', () => {
    // 值字典是 per-欄位的,所以 `bank_refund_id` 底下的 `partial` 不會被查到。
    // 若有人改成全域字典,這格會紅、而上一格不會。
    const { container } = render(
      <AuditDetail changes={[{ key: 'bank_refund_id', from: null, to: 'partial' }]} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('partial');
    expect(text).not.toContain('部分退款');
  });
});
