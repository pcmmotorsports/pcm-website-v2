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

import { AuditLogTable } from './audit-log-table';
import type { AuditListRow } from '../../lib/audit/audit-list-view';

// audit-log-table.test.tsx — `#27` D1c-2a。
//
// 🔴 **本檔只驗「三態有沒有被畫對」,不驗格式化** —— 代碼→中文、slug→姓名、時區
//    全在 `lib/audit/audit-list-view.ts`,那裡有自己的測試。**一件事一個守門。**
//
// 🔴 **`target` 三態是本檔的重點**,因為「有沒有連結」是最容易被做成假的那一態:
//    渲染一個空 href 的 `<a>`,員工點下去停在原地 ⇒ **看起來像這頁壞了**,
//    而不是「這筆沒有可去的地方」。

const row = (over: Partial<AuditListRow>): AuditListRow => ({
  id: 'r1',
  at: '2026-08-15 09:23',
  actor: '阿祥',
  action: '取消訂單',
  target: { label: '—', href: null },
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
