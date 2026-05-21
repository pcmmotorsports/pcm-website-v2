// @vitest-environment jsdom
//
// CartContext smoke + behavior test — M-1-13e-b 新建。
// Codex M-1-13e-b review P2-2 要求:補核心行為 regression(addItem 同 line 累加 / 不同 variant 分 line /
// remove/update line key 對齊 add / localStorage 持久化 / qty guard)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import { CartProvider, useCart } from './CartContext';

const STORAGE_KEY = 'pcm-cart-mock-v1';

const wrapper = ({ children }: { children: ReactNode }) => (
  <CartProvider>{children}</CartProvider>
);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('CartContext / useCart', () => {
  it('initial state is empty, totalQty = 0, isHydrated true after mount', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.items).toEqual([]);
    expect(result.current.totalQty).toBe(0);
    expect(result.current.isHydrated).toBe(true);
  });

  it('addItem appends new line', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 2, color: 'silver', size: null });
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ productId: 'lightech-1', qty: 2 });
    expect(result.current.totalQty).toBe(2);
  });

  it('addItem same productId + color + size accumulates qty(not duplicate line)', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 1, color: 'silver', size: null });
    });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 3, color: 'silver', size: null });
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]!.qty).toBe(4);
    expect(result.current.totalQty).toBe(4);
  });

  it('addItem different color = different line(variant 分行)', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 1, color: 'silver', size: null });
    });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 2, color: 'black', size: null });
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.totalQty).toBe(3);
  });

  it('removeItem only removes matching variant(不誤殺其他 variant)', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 1, color: 'silver', size: null });
      result.current.addItem({ productId: 'lightech-1', qty: 2, color: 'black', size: null });
    });
    act(() => {
      result.current.removeItem({ productId: 'lightech-1', color: 'silver', size: null });
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]!.color).toBe('black');
    expect(result.current.totalQty).toBe(2);
  });

  it('updateQty only updates matching variant', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 1, color: 'silver', size: null });
      result.current.addItem({ productId: 'lightech-1', qty: 1, color: 'black', size: null });
    });
    act(() => {
      result.current.updateQty({ productId: 'lightech-1', color: 'silver', size: null }, 5);
    });
    const silver = result.current.items.find((p) => p.color === 'silver');
    const black = result.current.items.find((p) => p.color === 'black');
    expect(silver?.qty).toBe(5);
    expect(black?.qty).toBe(1);
  });

  it('updateQty with 0 or negative removes the line', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 3, color: 'silver', size: null });
    });
    act(() => {
      result.current.updateQty({ productId: 'lightech-1', color: 'silver', size: null }, 0);
    });
    expect(result.current.items).toHaveLength(0);
  });

  it('clear empties cart', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 1, color: 'silver', size: null });
      result.current.addItem({ productId: 'lightech-2', qty: 2, color: 'red', size: null });
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.items).toHaveLength(0);
    expect(result.current.totalQty).toBe(0);
  });

  it('persists to localStorage and re-hydrates on remount', () => {
    const first = renderHook(() => useCart(), { wrapper });
    act(() => {
      first.result.current.addItem({
        productId: 'lightech-1',
        qty: 2,
        color: 'silver',
        size: null,
      });
    });
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ productId: 'lightech-1', qty: 2 });

    cleanup();
    const second = renderHook(() => useCart(), { wrapper });
    expect(second.result.current.items).toHaveLength(1);
    expect(second.result.current.items[0]!.qty).toBe(2);
  });

  it('qty guard:rejects non-integer / Infinity / NaN / negative', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: Number.NaN, color: 'silver' });
      result.current.addItem({ productId: 'a', qty: Number.POSITIVE_INFINITY, color: 'silver' });
      result.current.addItem({ productId: 'a', qty: -3, color: 'silver' });
      result.current.addItem({ productId: 'a', qty: 0, color: 'silver' });
    });
    expect(result.current.items).toHaveLength(0);
  });

  it('qty guard:floors decimals and clamps to MAX_QTY 99', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: 2.7, color: 'silver' });
    });
    expect(result.current.items[0]!.qty).toBe(2);

    act(() => {
      result.current.updateQty({ productId: 'a', color: 'silver', size: undefined }, 9999);
    });
    expect(result.current.items[0]!.qty).toBe(99);
  });

  it('readStorage ignores malformed / numeric-id / missing-productId entries', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { productId: 'good-1', qty: 1, color: 'silver', size: null },
        { id: 999, qty: 1, color: 'red' }, // 舊格式 number id、應被丟棄
        { productId: '', qty: 1 }, // 空 productId、應被丟棄
        { productId: 'bad-qty', qty: 'oops' }, // 非數字 qty、應被丟棄
        { productId: 'bad-qty-2', qty: 1e309 }, // Infinity、應被丟棄
        'not-an-object',
        null,
      ])
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]!.productId).toBe('good-1');
  });
});
