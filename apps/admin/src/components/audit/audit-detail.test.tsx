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
