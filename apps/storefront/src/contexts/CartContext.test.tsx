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

  it('#245:SESSION_KEY 被污染成非 UUID + 有品項 → 丟棄污染值、mount 補生合法 uuid 並覆寫(自癒)', () => {
    // 模擬使用者亂改 localStorage / 未來誤寫路徑寫進非 UUID 值
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ productId: 'a', qty: 1, variantId: 'v1' }]),
    );
    window.localStorage.setItem(SESSION_KEY, 'not-a-uuid-garbage');
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.items).toHaveLength(1);
    // 污染值被丟棄、補生合法 uuid(非原污染字串)
    expect(result.current.cartSessionId).toMatch(UUID_RE);
    expect(result.current.cartSessionId).not.toBe('not-a-uuid-garbage');
    // 自癒持久化:localStorage SESSION_KEY 已被合法 uuid 覆寫 → 重整不再讀回污染值、結帳不卡死
    expect(window.localStorage.getItem(SESSION_KEY)).toMatch(UUID_RE);
  });

  it('#245:SESSION_KEY 被污染 + 空車 → cartSessionId 維持 null(不無中生有 key)', () => {
    window.localStorage.setItem(SESSION_KEY, 'garbage');
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.items).toHaveLength(0);
    expect(result.current.cartSessionId).toBeNull();
  });
});

describe('CartContext / V-2a 車款欄(setItemVehicle / setAllItemsVehicle / readVehicle 分驗)', () => {
  const DICT = { kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'picker' } as const;
  const FREE = { kind: 'free', raw: '我的紅色小車', source: 'freetext' } as const;

  it('setItemVehicle 只設命中列、不動別列 / 不改 qty / vehicle 非 line key', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: 2, variantId: 'v1' });
      result.current.addItem({ productId: 'b', qty: 1 });
    });
    act(() => {
      result.current.setItemVehicle({ productId: 'a', variantId: 'v1' }, DICT);
    });
    expect(result.current.items).toHaveLength(2); // vehicle 非 discriminator、不分裂列
    expect(result.current.items.find((i) => i.productId === 'a')!.vehicle).toEqual(DICT);
    expect(result.current.items.find((i) => i.productId === 'a')!.qty).toBe(2);
    expect(result.current.items.find((i) => i.productId === 'b')!.vehicle).toBeUndefined();
  });

  it('setItemVehicle(null) 清除該列車款欄', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: 1 });
      result.current.setItemVehicle({ productId: 'a' }, FREE);
    });
    expect(result.current.items[0]!.vehicle).toEqual(FREE);
    act(() => {
      result.current.setItemVehicle({ productId: 'a' }, null);
    });
    expect(result.current.items[0]!.vehicle).toBeUndefined();
  });

  it('setAllItemsVehicle 整車套用全列、覆蓋既有', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: 1 });
      result.current.addItem({ productId: 'b', qty: 1, variantId: 'v2' });
      result.current.setItemVehicle({ productId: 'a' }, FREE); // 先各自改
    });
    act(() => {
      result.current.setAllItemsVehicle(DICT); // 整車套用覆蓋
    });
    expect(result.current.items.every((i) => JSON.stringify(i.vehicle) === JSON.stringify(DICT))).toBe(true);
    act(() => {
      result.current.setAllItemsVehicle(null);
    });
    expect(result.current.items.every((i) => i.vehicle === undefined)).toBe(true);
  });

  it('readStorage:合法 dict/free vehicle 還原持久化', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { productId: 'a', qty: 1, vehicle: DICT },
        { productId: 'b', qty: 1, vehicle: FREE },
      ]),
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.items.find((i) => i.productId === 'a')!.vehicle).toEqual(DICT);
    expect(result.current.items.find((i) => i.productId === 'b')!.vehicle).toEqual(FREE);
  });

  it('readStorage:壞 vehicle(未知 kind / dict 缺 brand / free 缺 raw / 非法 source)丟棄該欄、不擋整筆', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { productId: 'a', qty: 1, vehicle: { kind: 'bogus', brand: 'X' } },
        { productId: 'b', qty: 1, vehicle: { kind: 'dict', model: 'M', source: 'picker' } }, // 缺 brand
        { productId: 'c', qty: 1, vehicle: { kind: 'free', source: 'freetext' } }, // 缺 raw
        { productId: 'd', qty: 1, vehicle: { kind: 'dict', brand: 'Y', model: 'M', source: 'evil' } }, // 非法 source
      ]),
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.items).toHaveLength(4); // 品項保留
    expect(result.current.items.every((i) => i.vehicle === undefined)).toBe(true); // 車款欄全丟
  });

  it('readStorage:dict vehicle year 非整數 → year 掉、其餘保留', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ productId: 'a', qty: 1, vehicle: { kind: 'dict', brand: 'Y', model: 'M', year: 'abc', source: 'search' } }]),
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.items[0]!.vehicle).toEqual({ kind: 'dict', brand: 'Y', model: 'M', year: undefined, source: 'search' });
  });
});
