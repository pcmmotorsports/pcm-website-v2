// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';

// `next/link` 需要 app router context 才 render 得起來;本元件只用它做站內導航。
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { AuditLogTable, type AuditTableRow } from './audit-log-table';

// audit-log-table.test.tsx — `#27` D1c-2a。
//
// 🔴 **本檔只驗「三態有沒有被畫對」,不驗格式化** —— 代碼→中文、slug→姓名、時區
//    全在 `lib/audit/audit-list-view.ts`,那裡有自己的測試。**一件事一個守門。**
//
// 🔴 **`target` 三態是本檔的重點**,因為「有沒有連結」是最容易被做成假的那一態:
//    渲染一個空 href 的 `<a>`,員工點下去停在原地 ⇒ **看起來像這頁壞了**,
//    而不是「這筆沒有可去的地方」。

const row = (over: Partial<AuditTableRow>): AuditTableRow => ({
  id: 'r1',
  at: '2026-08-15 09:23',
  actor: '阿祥',
  action: '取消訂單',
  target: { label: '—', href: null },
  // 🔴 預設**沒填原因** —— 那是實際上最常見的那一種(實查正式庫最近 15 筆裡只有 3 筆有值)。
  //    ⇒ 要測「有原因」的格子自己覆寫這一個。
  reason: null,
  // 🔴 D1c-2b:預設**零變動** —— 展開檢視的行為在 `audit-detail.test.tsx` 有自己的一族,
  //    本檔只確認「那一欄有被接上」,不重複驗它的內容(一件事一個守門)。
  changes: [],
  ...over,
});

afterEach(cleanup);

describe('AuditLogTable — target 三態', () => {
  it('🔴 有頁面可去 ⇒ 畫成連結,且 href 就是給的那個', () => {
    const { container } = render(
      <AuditLogTable rows={[row({ target: { label: 'PCM-001', href: '/orders/abc' } })]} />,
    );
    const link = container.querySelector('a[href="/orders/abc"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe('PCM-001');
  });

  it('🔴 沒有頁面可去 ⇒ 顯示文字但**不得**有連結(負向對照)', () => {
    // 沒有這一格,把 `href` 判斷拿掉、一律渲染 `<Link href={href ?? ''}>` 也會全綠 ——
    // 而那正是「點了沒反應」的來源。
    const { container } = render(
      <AuditLogTable rows={[row({ target: { label: '員工 阿祥', href: null } })]} />,
    );
    expect(container.textContent).toContain('員工 阿祥');
    expect(container.querySelector('a')).toBeNull();
  });

  it('解析不出來的 target ⇒ 原樣顯示,也不給連結', () => {
    const { container } = render(
      <AuditLogTable rows={[row({ target: { label: 'weird:xyz', href: null } })]} />,
    );
    expect(container.textContent).toContain('weird:xyz');
    expect(container.querySelector('a')).toBeNull();
  });
});

describe('AuditLogTable — 四欄與空狀態', () => {
  it('四欄的值都畫出來(時間 / 操作人 / 做了什麼 / 對象)', () => {
    const { container } = render(
      <AuditLogTable rows={[row({ target: { label: 'PCM-001', href: '/orders/abc' } })]} />,
    );
    const text = container.textContent ?? '';
    for (const value of ['2026-08-15 09:23', '阿祥', '取消訂單', 'PCM-001']) {
      expect(text, `四欄少了「${value}」`).toContain(value);
    }
  });

  it('🔴 空清單 ⇒ 空狀態要說明「為什麼這是正常的」,不能只寫沒有資料', () => {
    // Sean 第一眼幾乎一定看到空的(這張表目前幾乎沒有資料)⇒ **空狀態不能長得像壞掉。**
    const { container } = render(<AuditLogTable rows={[]} />);
    const text = container.textContent ?? '';
    expect(text).toContain('目前沒有操作紀錄');
    expect(text).toContain('這裡就會出現紀錄');
  });
});

describe('AuditLogTable — 展開檢視那一欄有被接上(D1c-2b)', () => {
  it('🔴 有變動 ⇒ 出現摘要行「N 個欄位有變動」,而收合時不含值', () => {
    // 這一格擋的是「元件寫好了但沒接進表格」—— 那種漏接在 audit-detail.test.tsx 全綠時完全看不到。
    const { container } = render(
      <AuditLogTable
        rows={[row({ changes: [{ key: 'phone', from: '0912-345-678', to: '0987-654-321' }] })]}
      />,
    );
    const summary = container.querySelector('summary');
    expect(summary?.textContent).toBe('1 個欄位有變動');
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it('零變動 ⇒ 顯示說明文字,不畫 details', () => {
    const { container } = render(<AuditLogTable rows={[row({})]} />);
    expect(container.textContent).toContain('沒有記錄欄位變動');
    expect(container.querySelector('details')).toBeNull();
  });
});

// ══ 2026-09-17「為什麼」那一欄 ═════════════════════════════════════════════
// 🔴 **它接的是一個從 2026-07-12 就一直在寫、而畫面一個字沒印的欄位**
//    (`admin_audit_log.reason`;實查正式庫 690 筆裡 538 筆有值)。
describe('🔴「為什麼」那一欄', () => {
  it('🔴 有填 ⇒ 原文印出來', () => {
    const { container } = render(<AuditLogTable rows={[row({ reason: '客人打電話說不要了' })]} />);
    expect(container.textContent).toContain('客人打電話說不要了');
  });

  // 🛑 **沒填印「—」不印空白** —— 空白讀起來像「這一欄壞了」, `—` 讀起來是「這一筆沒填」。
  //    (同本檔 target 那三態的理由:兩種空不能長一樣。)
  it('🔴 沒填 ⇒ 印「—」, 不是空白', () => {
    const { container } = render(<AuditLogTable rows={[row({ reason: null })]} />);
    expect(container.textContent).toContain('—');
  });

  // 🔵 **負對照:欄頭本身要在** —— 沒有它, 把整欄拿掉而上面兩格用別欄的「—」也會綠。
  it('🔵 負對照:欄頭「為什麼」在表格上', () => {
    const { container } = render(<AuditLogTable rows={[row({ reason: null })]} />);
    expect(container.textContent).toContain('為什麼');
  });
});
