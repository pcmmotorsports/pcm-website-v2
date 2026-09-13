// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OrdersStickyOffset } from './orders-sticky-offset';

// 三個字面(attr / CSS 變數)分住三支檔(server component 不能從 'use client' 模組 import 常數)⇒ 這裡釘它們一致。
const SRC = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--orders-sticky-top');
});

describe('凍結:工具列高度 → --orders-sticky-top → thead top', () => {
  it('🔴 三支檔用同一個 attr 與同一個 CSS 變數字面', () => {
    const client = SRC('./orders-sticky-offset.tsx');
    const page = SRC('../../app/orders/page.tsx');
    const table = SRC('./orders-table.tsx');
    expect(client).toContain("'data-orders-sticky-head'");
    expect(page).toContain("data-orders-sticky-head=''");
    expect(client).toContain("'--orders-sticky-top'");
    expect(table).toContain("top: 'var(--orders-sticky-top, 0px)'");
    // 頁面那塊與表頭都是 sticky;表頭 z 在列(z-10)之上、工具列(z-30)之下
    expect(page).toMatch(/data-orders-sticky-head=''[\s\S]{0,200}sticky top-0 z-30/);
    expect(table).toMatch(/<thead className='bg-card sticky z-20'/);
  });

  it('掛上去就量一次、寫進根元素;沒有那個區塊就什麼都不寫', () => {
    render(<OrdersStickyOffset />);
    expect(document.documentElement.style.getPropertyValue('--orders-sticky-top')).toBe('');
    cleanup();
    const head = document.createElement('div');
    head.setAttribute('data-orders-sticky-head', '');
    Object.defineProperty(head, 'getBoundingClientRect', { value: () => ({ height: 123.4 }) });
    document.body.appendChild(head);
    const { unmount } = render(<OrdersStickyOffset />);
    expect(document.documentElement.style.getPropertyValue('--orders-sticky-top')).toBe('123px');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--orders-sticky-top')).toBe('');
    head.remove();
  });
});
