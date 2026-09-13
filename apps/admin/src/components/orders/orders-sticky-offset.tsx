'use client';

import { useEffect } from 'react';

// orders-sticky-offset.tsx — 量「凍結區」(工具列)的高度,寫進 `--orders-sticky-top`,表頭 `<thead>` 的 `top` 吃它。
//    Sean 2026-09-13 拍:「這邊以上全部凍結,我要捲動訂單時候保留上面的功能」⇒ 工具列 sticky top-0,
//    表頭 sticky 在工具列**底下**;工具列高度會變(第一列折行、搜尋中多一段)⇒ 不能寫死,要量。
//
// 🔴 為什麼不用 CSS 就好:`position: sticky` 的 `top` 是一個長度,沒有「貼在上一個 sticky 底下」的語法;
//    兩個 sticky 疊起來要自己給第二個 offset。`ResizeObserver` 量第一個、寫 CSS 變數,是最少的碼。
// 🔴 `ResizeObserver` 在 jsdom 不存在(`orders-cutoff-notice.tsx` 記過)⇒ 沒有就只量一次,不拋。
// 🔴 只寫在 `document.documentElement`,不寫 body(表格與工具列在不同子樹,都讀得到根)。

// 🔴 兩個字面**不 export 給 server component 用**(從 'use client' 模組 import 出去會變 client reference、server 端一碰就炸);
//    `orders/page.tsx` 與 `orders-table.tsx` 各自寫同一個字面,本檔的測試釘住它們一致。
const ORDERS_STICKY_HEAD_ATTR = 'data-orders-sticky-head';
const ORDERS_STICKY_TOP_VAR = '--orders-sticky-top';

export function OrdersStickyOffset() {
  useEffect(() => {
    const head = document.querySelector<HTMLElement>(`[${ORDERS_STICKY_HEAD_ATTR}]`);
    if (head === null) return;
    const root = document.documentElement;
    const write = () => root.style.setProperty(ORDERS_STICKY_TOP_VAR, `${Math.round(head.getBoundingClientRect().height)}px`);
    write();
    // 🔴 沒有 ResizeObserver(jsdom)也要回 cleanup —— 第一版在這裡 `return` 掉,卸載後變數留在根元素(測試抓到)。
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(write);
    ro?.observe(head);
    return () => {
      ro?.disconnect();
      root.style.removeProperty(ORDERS_STICKY_TOP_VAR);
    };
  }, []);
  return null;
}
