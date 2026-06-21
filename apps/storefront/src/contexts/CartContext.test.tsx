// @vitest-environment jsdom
//
// CartContext smoke + behavior test — M-1-13e-b 新建、M-3-S2-b2-c 改 variant_id 線契約。
// 核心行為 regression(addItem 同 line 累加 / 不同 variantId 分 line / remove/update line key 對齊 add /
// localStorage 持久化 v2 / qty guard / 舊 v1 無 variantId 資料丟棄)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import { CartProvider, useCart } from './CartContext';

const STORAGE_KEY = 'pcm-cart-mock-v2';
const SESSION_KEY = 'pcm-cart-session-v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      result.current.addItem({ productId: 'lightech-1', qty: 2, variantId: 'v-silver' });
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ productId: 'lightech-1', variantId: 'v-silver', qty: 2 });
    expect(result.current.totalQty).toBe(2);
  });

  it('addItem same productId + variantId accumulates qty(not duplicate line)', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 1, variantId: 'v-silver' });
    });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 3, variantId: 'v-silver' });
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]!.qty).toBe(4);
    expect(result.current.totalQty).toBe(4);
  });

  it('addItem different variantId = different line(變體分行)', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 1, variantId: 'v-silver' });
    });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 2, variantId: 'v-black' });
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.totalQty).toBe(3);
  });

  it('無變體商品(variantId undefined)以 productId 分行、不誤併', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'no-variant-1', qty: 1 });
      result.current.addItem({ productId: 'no-variant-2', qty: 2 });
    });
    expect(result.current.items).toHaveLength(2);
    act(() => {
      result.current.addItem({ productId: 'no-variant-1', qty: 3 });
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.find((p) => p.productId === 'no-variant-1')!.qty).toBe(4);
  });

  it('removeItem only removes matching variant(不誤殺其他 variant)', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 1, variantId: 'v-silver' });
      result.current.addItem({ productId: 'lightech-1', qty: 2, variantId: 'v-black' });
    });
    act(() => {
      result.current.removeItem({ productId: 'lightech-1', variantId: 'v-silver' });
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]!.variantId).toBe('v-black');
    expect(result.current.totalQty).toBe(2);
  });

  it('updateQty only updates matching variant', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 1, variantId: 'v-silver' });
      result.current.addItem({ productId: 'lightech-1', qty: 1, variantId: 'v-black' });
    });
    act(() => {
      result.current.updateQty({ productId: 'lightech-1', variantId: 'v-silver' }, 5);
    });
    const silver = result.current.items.find((p) => p.variantId === 'v-silver');
    const black = result.current.items.find((p) => p.variantId === 'v-black');
    expect(silver?.qty).toBe(5);
    expect(black?.qty).toBe(1);
  });

  it('updateQty with 0 or negative removes the line', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 3, variantId: 'v-silver' });
    });
    act(() => {
      result.current.updateQty({ productId: 'lightech-1', variantId: 'v-silver' }, 0);
    });
    expect(result.current.items).toHaveLength(0);
  });

  it('clear empties cart', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'lightech-1', qty: 1, variantId: 'v-silver' });
      result.current.addItem({ productId: 'lightech-2', qty: 2, variantId: 'v-red' });
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.items).toHaveLength(0);
    expect(result.current.totalQty).toBe(0);
  });

  it('persists to localStorage(v2)and re-hydrates on remount', () => {
    const first = renderHook(() => useCart(), { wrapper });
    act(() => {
      first.result.current.addItem({ productId: 'lightech-1', qty: 2, variantId: 'v-silver' });
    });
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ productId: 'lightech-1', variantId: 'v-silver', qty: 2 });

    cleanup();
    const second = renderHook(() => useCart(), { wrapper });
    expect(second.result.current.items).toHaveLength(1);
    expect(second.result.current.items[0]!.qty).toBe(2);
  });

  it('qty guard:rejects non-integer / Infinity / NaN / negative', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: Number.NaN, variantId: 'v1' });
      result.current.addItem({ productId: 'a', qty: Number.POSITIVE_INFINITY, variantId: 'v1' });
      result.current.addItem({ productId: 'a', qty: -3, variantId: 'v1' });
      result.current.addItem({ productId: 'a', qty: 0, variantId: 'v1' });
    });
    expect(result.current.items).toHaveLength(0);
  });

  it('qty guard:floors decimals and clamps to MAX_QTY 99', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: 2.7, variantId: 'v1' });
    });
    expect(result.current.items[0]!.qty).toBe(2);

    act(() => {
      result.current.updateQty({ productId: 'a', variantId: 'v1' }, 9999);
    });
    expect(result.current.items[0]!.qty).toBe(99);
  });

  it('readStorage 丟棄 malformed / 空 productId / 壞 qty;舊 v1 color/size 不解析(只認 variantId)', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { productId: 'good-1', qty: 1, variantId: 'v-silver' },
        { productId: 'good-2', qty: 2 }, // 無變體商品、合法(variantId undefined)
        { productId: 'legacy', qty: 1, color: 'silver', size: null }, // 舊 v1 hack 欄、color/size 不解析 → 當無變體 good 行收(productId 合法)
        { productId: '', qty: 1, variantId: 'v1' }, // 空 productId、丟棄
        { productId: 'bad-qty', qty: 'oops', variantId: 'v1' }, // 非數字 qty、丟棄
        { productId: 'bad-qty-2', qty: 1e309, variantId: 'v1' }, // Infinity、丟棄
        'not-an-object',
        null,
      ])
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    // good-1 / good-2 / legacy(productId 合法、color/size 忽略)= 3 筆;空/壞 qty/非物件全丟
    expect(result.current.items).toHaveLength(3);
    expect(result.current.items.map((i) => i.productId).sort()).toEqual(['good-1', 'good-2', 'legacy']);
    // 舊 v1 hack 欄不解析:legacy 行無 variantId(color 不被當 variantId)
    expect(result.current.items.find((i) => i.productId === 'legacy')!.variantId).toBeUndefined();
  });
});

describe('CartContext / cartSessionId(3DS-7 7a)', () => {
  it('空車(無品項)mount 後 cartSessionId 為 null', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.cartSessionId).toBeNull();
  });

  it('加第一件 → 生成合法 uuid cartSessionId', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: 1, variantId: 'v1' });
    });
    expect(result.current.cartSessionId).toMatch(UUID_RE);
  });

  it('cartSessionId 跨多次 addItem / updateQty 穩定不變(同一購物車生命週期)', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: 1, variantId: 'v1' });
    });
    const first = result.current.cartSessionId;
    act(() => {
      result.current.addItem({ productId: 'b', qty: 1, variantId: 'v2' });
      result.current.updateQty({ productId: 'a', variantId: 'v1' }, 3);
    });
    expect(result.current.cartSessionId).toBe(first);
  });

  it('regenerateCartSession 換新 key(合法 uuid 且與舊不同)', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: 1, variantId: 'v1' });
    });
    const first = result.current.cartSessionId;
    act(() => {
      result.current.regenerateCartSession();
    });
    expect(result.current.cartSessionId).toMatch(UUID_RE);
    expect(result.current.cartSessionId).not.toBe(first);
  });

  it('持久化到 localStorage(SESSION_KEY)且 remount 還原同一 key', () => {
    const first = renderHook(() => useCart(), { wrapper });
    act(() => {
      first.result.current.addItem({ productId: 'a', qty: 1, variantId: 'v1' });
    });
    const key = first.result.current.cartSessionId;
    expect(window.localStorage.getItem(SESSION_KEY)).toBe(key);

    cleanup();
    const second = renderHook(() => useCart(), { wrapper });
    expect(second.result.current.cartSessionId).toBe(key);
  });

  it('還原舊車(有品項、無 session key)→ mount 補生一把 key(既有車納入去重)', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ productId: 'a', qty: 1, variantId: 'v1' }]),
    );
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.cartSessionId).toMatch(UUID_RE);
  });

  it('手動 clear() 保留 cartSessionId(Q4=A:手動清車/模糊態不換 key)', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: 1, variantId: 'v1' });
    });
    const key = result.current.cartSessionId;
    act(() => {
      result.current.clear();
    });
    expect(result.current.items).toHaveLength(0);
    expect(result.current.cartSessionId).toBe(key);
  });
});
