// @vitest-environment jsdom
//
// CartContext smoke + behavior test — M-1-13e-b 新建、M-3-S2-b2-c 改 variant_id 線契約。
// 核心行為 regression(addItem 同 line 累加 / 不同 variantId 分 line / remove/update line key 對齊 add /
// localStorage 持久化 v2 / qty guard / 舊 v1 無 variantId 資料丟棄)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  // 🔴 非安全環境測試會整組替換 crypto global;不還原會污染後續測試(vitest.config.ts 無 restoreMocks)。
  vi.unstubAllGlobals();
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

// 🔴 非安全環境(區域網路 HTTP)cart_session_id fallback(2026-07-22)。
//
//   背景:`crypto.randomUUID` 是 secure-context-only API。真機驗收走 `http://<LAN-IP>:3001` 時
//   `isSecureContext=false`、該函式不存在 → 舊版 addItem 直接 throw、整頁 crash、購物車完全不能用
//   (實測重現)。正式站 HTTPS 不受影響。
//
//   🔴 stub 手法(codex 關卡1 R1/R2 must-fix):必須用 `vi.stubGlobal` **整組替換** crypto 並讓
//   `randomUUID: undefined` —— jsdom 26 原生同時具備 randomUUID 與 getRandomValues,
//   若改用 `vi.spyOn(crypto,'randomUUID').mockReturnValue(undefined)`,屬性仍是 function、
//   會走進「有 randomUUID」那條分支 = 測到錯的路;且 `vi.unstubAllGlobals()` 不還原 spy、
//   本專案 vitest.config.ts 亦無 restoreMocks → 會污染後續測試。
//
//   🔴 用**固定 entropy + 固定期望向量**斷言,而非「格式對就好」或「N 次不重複」:
//   後兩者無法抓出 version/variant 位元設錯或 slice 邊界錯位(那會產出格式合法但非 v4 的值)。
const FIXED_ENTROPY = new Uint8Array([
  0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
  0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
]);
// b[6]=0xcd → (0xcd & 0x0f) | 0x40 = 0x4d;b[8]=0xfe → (0xfe & 0x3f) | 0x80 = 0xbe
const EXPECTED_FALLBACK_ID = '01234567-89ab-4def-bedc-ba9876543210';

/** 以任意固定 entropy 模擬非安全環境(供逐 bit 鎖定用)。 */
function stubInsecureCryptoWith(fill: number) {
  const getRandomValues = vi.fn((arr: Uint8Array) => {
    arr.fill(fill);
    return arr;
  });
  vi.stubGlobal('crypto', { randomUUID: undefined, getRandomValues });
  return { getRandomValues };
}

/** 模擬非安全環境:randomUUID 不存在、getRandomValues 可用(真實 LAN HTTP 的行為,已實測)。
 *  ⚠️ 本 stub 以 `randomUUID: undefined` 的 **own property** 模擬,真實環境是**屬性完全不存在**。
 *     現行實作用 `typeof crypto.randomUUID === 'function'` 守門,兩者行為一致;
 *     但若日後有人改成 `'randomUUID' in crypto`,會出現「測試紅、真機綠」的錯位 —— 改守門寫法時請一併改本 stub。 */
function stubInsecureCrypto() {
  const getRandomValues = vi.fn((arr: Uint8Array) => {
    arr.set(FIXED_ENTROPY.slice(0, arr.length));
    return arr;
  });
  vi.stubGlobal('crypto', { randomUUID: undefined, getRandomValues });
  return { getRandomValues };
}

describe('CartContext / cartSessionId 非安全環境 fallback(2026-07-22)', () => {
  // 🔴 逐 bit 鎖定(codex 關卡2 must-fix):單一固定向量**擋不住降熵突變**。
  //    實證:在 getRandomValues 之後加一行 `b[0] &= 0x0f`(有效熵 122 → 118 bits),
  //    因既有向量首 byte 恰為 0x01、被遮罩後不變 → 32 條測試**全綠**、降熵無聲通過。
  //    改用全 0xff / 全 0x00 兩組極端向量:前者抓「任何 bit 被清掉」、後者抓「任何 bit 被設起來」,
  //    合起來把 version/variant 之外的 122 bits 全部釘死。
  it('🔴 逐 bit 保真:全 0xff entropy → 只有 version/variant 兩處被改寫,其餘 bit 原樣', () => {
    stubInsecureCryptoWith(0xff);
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: 1, variantId: 'v1' });
    });
    expect(result.current.cartSessionId).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('🔴 逐 bit 保真:全 0x00 entropy → 只有 version/variant 兩處被設起,其餘 bit 維持 0', () => {
    stubInsecureCryptoWith(0x00);
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: 1, variantId: 'v1' });
    });
    expect(result.current.cartSessionId).toBe('00000000-0000-4000-8000-000000000000');
  });

  // 🔴 one-hot 逐 bit 走查(codex 關卡2 R2 must-fix):固定 / 全 0xff / 全 0x00 三組向量**仍不足以**
  //    宣稱「122 bits 全部釘死」。實證:突變 `b[0] = (b[0] & 0xfd) | ((b[0] & 0x04) >> 1)`
  //    (丟掉 bit1、複製 bit2、熵 122 → 121)對 0x01 / 0xff / 0x00 三個輸入的輸出**完全相同** → 全綠躲過。
  //    本測試對「除 version/variant 之外的每一個 bit」各送一次 one-hot entropy,
  //    斷言輸出恰好只有同一個 bit 被設起 —— 任何 bit 被丟棄、複製或位移都會當場轉紅。
  //    ⚠️ 這是**性質斷言**(輸入 one-hot → 輸出 one-hot 且位置相同),不是把實作在測試裡重寫一遍。
  it('🔴 one-hot:除 version/variant 外的 122 個 bit 逐一走查,無丟棄/複製/位移', () => {
    const RESERVED: Record<number, number> = { 6: 0xf0, 8: 0xc0 }; // byte6 高 4 bits、byte8 高 2 bits
    let checked = 0;

    for (let byteIdx = 0; byteIdx < 16; byteIdx += 1) {
      for (let bit = 0; bit < 8; bit += 1) {
        const mask = 1 << bit;
        if ((RESERVED[byteIdx] ?? 0) & mask) continue; // 被 version/variant 覆寫的位元不參與

        const oneHot = new Uint8Array(16);
        oneHot[byteIdx] = mask;
        vi.stubGlobal('crypto', {
          randomUUID: undefined,
          getRandomValues: (arr: Uint8Array) => { arr.set(oneHot.slice(0, arr.length)); return arr; },
        });
        window.localStorage.clear();

        const { result } = renderHook(() => useCart(), { wrapper });
        act(() => {
          result.current.addItem({ productId: 'a', qty: 1, variantId: 'v1' });
        });
        const uuid = result.current.cartSessionId!;
        cleanup();

        // 還原成 16 bytes,再把 version/variant 兩處固定位元清掉,剩下的應該恰好只有輸入那一個 bit
        const hex = uuid.replace(/-/g, '');
        expect(hex).toHaveLength(32);
        const out = new Uint8Array(16);
        for (let i = 0; i < 16; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        out[6] = out[6]! & 0x0f;
        out[8] = out[8]! & 0x3f;

        const expected = new Uint8Array(16);
        expected[byteIdx] = mask & ~(RESERVED[byteIdx] ?? 0);
        expect(Array.from(out)).toEqual(Array.from(expected));
        checked += 1;
      }
    }

    expect(checked).toBe(122); // 128 - 4(version)- 2(variant)
  });

  it('🔴 addItem 空車首件:randomUUID 不存在時不再 crash,產出固定向量且通過 UUID_RE', () => {
    const { getRandomValues } = stubInsecureCrypto();
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: 1, variantId: 'v1' });
    });
    expect(result.current.cartSessionId).toBe(EXPECTED_FALLBACK_ID);
    expect(result.current.cartSessionId).toMatch(UUID_RE);
    // 🔴 熵源必須真的被用到(Fable 對抗審查 C1):否則「把 fallback 寫死回傳固定字串」
    //    這個突變會讓全部測試綠,但真實世界所有非安全環境使用者共用同一把 key = 跨結帳誤判同筆。
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    // 持久化也要是同一把(server 之後讀的就是它)
    expect(window.localStorage.getItem(SESSION_KEY)).toBe(EXPECTED_FALLBACK_ID);
  });

  it('🔴 hydrate 補舊車(有品項、無 session key):同樣走 fallback、不 crash', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ productId: 'a', qty: 1, variantId: 'v1' }]),
    );
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    const { getRandomValues } = stubInsecureCrypto();
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.cartSessionId).toBe(EXPECTED_FALLBACK_ID);
    expect(result.current.cartSessionId).toMatch(UUID_RE);
    expect(getRandomValues).toHaveBeenCalledTimes(1); // 熵源真的被用到(Fable C1)
  });

  it('🔴 regenerateCartSession:同樣走 fallback、不 crash', () => {
    const { getRandomValues } = stubInsecureCrypto();
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: 1, variantId: 'v1' });
    });
    act(() => {
      result.current.regenerateCartSession();
    });
    expect(result.current.cartSessionId).toBe(EXPECTED_FALLBACK_ID);
    expect(result.current.cartSessionId).toMatch(UUID_RE);
    // addItem 生一把 + regenerate 再生一把 = 熵源恰被呼叫 2 次(Fable C1)
    expect(getRandomValues).toHaveBeenCalledTimes(2);
  });

  it('🔴 安全環境維持原路:走 randomUUID、完全不碰 getRandomValues fallback', () => {
    const SAFE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const randomUUID = vi.fn(() => SAFE_ID);
    const getRandomValues = vi.fn((arr: Uint8Array) => arr);
    vi.stubGlobal('crypto', { randomUUID, getRandomValues });

    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'a', qty: 1, variantId: 'v1' });
    });
    expect(result.current.cartSessionId).toBe(SAFE_ID);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    // 🔴 正式站(HTTPS)行為零變動的機械證據:fallback 一次都沒被走到
    expect(getRandomValues).not.toHaveBeenCalled();
  });
});
