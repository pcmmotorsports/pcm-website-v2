// @vitest-environment jsdom
//
// CartContext smoke + behavior test — M-1-13e-b 新建、M-3-S2-b2-c 改 variant_id 線契約。
// 核心行為 regression(addItem 同 line 累加 / 不同 variantId 分 line / remove/update line key 對齊 add /
// localStorage 持久化 v2 / qty guard / 舊 v1 無 variantId 資料丟棄)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

// 🔴 ~~原本這裡 mock `@/lib/supabase/browser` 的 `onAuthStateChange`~~ —— **已移除(2026-08-23)**。
//   那個 mock 讓 A1 那三格全綠,而**真瀏覽器裡那段碼一次都沒跑過**:登入是 server action,
//   瀏覽器端的 supabase 實例從頭到尾沒執行過登入 ⇒ 事件永遠不會來。
//   📌 **一個自己扮演呼叫端的測試,永遠不會發現沒有呼叫端。**
//   ⇒ 主人現在由 `app/layout.tsx` 從 server 交下來(prop `serverOwnerId`),
//     所以這三格改成【換 prop + rerender】—— 那才是真實世界會發生的事。
//   ⚠️ 而這三格仍**不是**這一片的最終證人:證人是 runbook 那條真瀏覽器序列
//     (訪客 4 件 → 登甲留著 → 重整留著 → 換乙清空 → 按登出鈕清空),2026-08-23 實跑過。

import { CartProvider, useCart, clampDrop } from './CartContext';

const STORAGE_KEY = 'pcm-cart-mock-v2';
const SESSION_KEY = 'pcm-cart-session-v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const wrapper = ({ children }: { children: ReactNode }) => (
  <CartProvider>{children}</CartProvider>
);

/** 現在坐在這台電腦前的人 = server 交下來的那個值;改它再 rerender = 真實世界的「換人」。 */
let currentOwner: string | null | undefined = null;
const ownerWrapper = ({ children }: { children: ReactNode }) => (
  <CartProvider serverOwnerId={currentOwner}>{children}</CartProvider>
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

  // ── ⟦b4-NOVARIANT-OLDCART⟧ 2026-09-02 ────────────────────────────────────────
  // 🔴 **那一列問的第三格逐字:「客人自己刪得掉嗎」** —— 而在本片之前, `removeItem` /
  //    `updateQty` 的每一格【都帶著一個真的 `variantId`】⇒ **無變體那條路一格都沒有。**
  // 🔴 而它靠的是 `sameLine` 的 `a.variantId === b.variantId` 在【兩邊都是 `undefined`】時成立
  //    ⇒ 那是一個**很容易在重構時消失**的性質(例如有人改成 `a.variantId && a.variantId === b.variantId`)
  //    ⇒ 而消失的後果是:**客人刪不掉那一筆, 而畫面上沒有任何錯誤** —— 他只會一直按。
  // 📌 **為什麼這件事今天不是理論**:購物車存 localStorage, 而顧客站只擋【加入】
  //    ⇒ 曾經加進去的那一筆**不會被清掉**(那一列自己寫的)。
  it('🔴 無變體那一筆刪得掉(⟦b4-NOVARIANT-OLDCART⟧ 第三格)', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'no-variant-1', qty: 2 });
    });
    expect(result.current.items).toHaveLength(1);
    act(() => {
      result.current.removeItem({ productId: 'no-variant-1' });
    });
    expect(result.current.items).toHaveLength(0);
    expect(result.current.totalQty).toBe(0);
  });

  it('🔴 無變體那一筆改得動數量, 而它不會誤殺同商品的變體行', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.addItem({ productId: 'mix-1', qty: 1 }); // 無變體
      result.current.addItem({ productId: 'mix-1', qty: 1, variantId: 'v-silver' });
    });
    expect(result.current.items).toHaveLength(2); // 🔵 正對照:它們本來就是兩行
    act(() => {
      result.current.updateQty({ productId: 'mix-1' }, 5);
    });
    expect(result.current.items.find((i) => i.variantId === undefined)!.qty).toBe(5);
    // 🔵 **負對照:變體那一行不准被動到** —— 沒有這一行, 一個「把兩行都改掉」的實作也會過
    expect(result.current.items.find((i) => i.variantId === 'v-silver')!.qty).toBe(1);
    act(() => {
      result.current.removeItem({ productId: 'mix-1' });
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]!.variantId).toBe('v-silver'); // 🔵 刪對了那一行
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

// ── A1:車不跟人走 ────────────────────────────────────────────────────────────
// 🔴 這三格是**一組**:前兩格是「該清有沒有清」,第三格是「不該清的有沒有被誤清」。
//   只留前兩格的話,一個「userId 一動就清」的錯實作會**全綠通過**,
//   而它會在訪客結帳登入的那一刻把他的車倒掉。
describe('A1:換人 / 登出要清車,訪客登入不清', () => {
  beforeEach(() => { currentOwner = null; });

  it('登出(A → null)清空品項與 cart session', () => {
    currentOwner = 'user-a';
    const { result, rerender } = renderHook(() => useCart(), { wrapper: ownerWrapper });
    act(() => { result.current.addItem({ productId: 'lightech-1', qty: 2 }); });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.cartSessionId).toMatch(UUID_RE);

    currentOwner = null;
    act(() => { rerender(); });
    expect(result.current.items).toEqual([]);
    expect(result.current.totalQty).toBe(0);
    expect(result.current.cartSessionId).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('[]');
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('換人(A → B)清空品項**與去重子** —— 車行共用一台電腦的那個病', () => {
    currentOwner = 'user-a';
    const { result, rerender } = renderHook(() => useCart(), { wrapper: ownerWrapper });
    act(() => { result.current.addItem({ productId: 'lightech-1', qty: 3 }); });
    expect(result.current.totalQty).toBe(3);
    const aSessionId = result.current.cartSessionId;
    expect(aSessionId).toMatch(UUID_RE);

    currentOwner = 'user-b';
    act(() => { rerender(); });
    expect(result.current.items).toEqual([]);
    // 🔴 R2 nit F3:**第四種錯實作** =「`A → B` 只清品項、留著 A 的 `cartSessionId`」。
    //   少了下面兩行它會**三格全綠**,而去重子外洩恰好就是 `A → B` 這個情境:
    //   B 的第一次結帳會帶著 A 的去重把手送 server。
    expect(result.current.cartSessionId).toBeNull();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  // 🔴 R1 must-fix(主視窗問的那題):`undefined` = **這次沒讀到**,不是「登出了」。
  //   兩條路都會產生假的 `null`(getUser 丟例外 / 回 `{user:null,error}` 網路抖),
  //   而 `null` 在下游的意思是「他登出了」⇒ 會把一個【還登著的人】的車清掉。
  it('讀不到主人(undefined)**不清車** —— 一次網路抖不該把還登著的人的車倒掉', () => {
    currentOwner = 'user-a';
    const { result, rerender } = renderHook(() => useCart(), { wrapper: ownerWrapper });
    act(() => { result.current.addItem({ productId: 'lightech-1', qty: 2 }); });
    const before = result.current.cartSessionId;

    currentOwner = undefined;
    act(() => { rerender(); });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.cartSessionId).toBe(before);
  });

  // 🔴 活性訊號(R3 nit):`undefined` 一路安靜下去 = 清車永遠不發生,而畫面正常。
  //   ⚠️ 這一格**不能**寫成「連續 N 次才吼」—— 那個 effect 的依賴是 `[ownerId]`,
  //     一連串 `undefined` 之間值沒變、effect 不會再跑。第一版就是那樣寫的,**而這一格當場紅**。
  it('讀得到主人時**不吼**(該綠那半先跑)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    currentOwner = 'user-a';
    const { rerender } = renderHook(() => useCart(), { wrapper: ownerWrapper });
    currentOwner = 'user-b';
    act(() => { rerender(); });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('讀不到主人 ⇒ 吼一次,而且只吼一次', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    currentOwner = 'user-a';
    const { rerender } = renderHook(() => useCart(), { wrapper: ownerWrapper });
    currentOwner = undefined;
    act(() => { rerender(); });
    expect(warn).toHaveBeenCalledTimes(1);

    currentOwner = 'user-b';
    act(() => { rerender(); });
    currentOwner = undefined;
    act(() => { rerender(); });
    expect(warn).toHaveBeenCalledTimes(1); // 同一次掛載不重複吼
    warn.mockRestore();
  });

  it('讀不到之後又讀到【同一個人】⇒ 仍不清 —— undefined 不得污染「前一個人」', () => {
    currentOwner = 'user-a';
    const { result, rerender } = renderHook(() => useCart(), { wrapper: ownerWrapper });
    act(() => { result.current.addItem({ productId: 'lightech-1', qty: 2 }); });

    currentOwner = undefined;
    act(() => { rerender(); });
    currentOwner = 'user-a';
    act(() => { rerender(); });
    expect(result.current.items).toHaveLength(1);

    // 而真的換人時照樣要清(證明上面不是「壞掉所以永遠不清」)。
    currentOwner = 'user-b';
    act(() => { rerender(); });
    expect(result.current.items).toEqual([]);
    expect(result.current.cartSessionId).toBeNull();
  });

  // 🔴 承重理由是 `INITIAL_SESSION`(R2 更正):**每一次重整都是 `null → A`**
  //   ⇒ 清它 = 每個回頭客每次開頁被倒車。「訪客先逛後登入」只是方向相同的次要理由(未量)。
  it('訪客登入 / 每次重整(null → A)**不清** —— 否則回頭客每次開頁被倒車', () => {
    currentOwner = null;
    const { result, rerender } = renderHook(() => useCart(), { wrapper: ownerWrapper });
    act(() => { result.current.addItem({ productId: 'lightech-1', qty: 2 }); });
    const before = result.current.cartSessionId;

    currentOwner = 'user-a';
    act(() => { rerender(); });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.totalQty).toBe(2);
    expect(result.current.cartSessionId).toBe(before);
  });
});

// ── A5:上限夾值要「少了幾件」算得出來(補洞窗)────────────────────────────────
describe('clampDrop —— 因為上限而被丟掉幾件', () => {
  it('沒滿 ⇒ 0(負對照:平常不得冒出提示)', () => {
    expect(clampDrop(0, 1)).toBe(0);
    expect(clampDrop(90, 9)).toBe(0); // 剛好 99,還沒溢出
  });

  it('提示詞裡那個情境:車裡 90 再加 20 ⇒ 少了 11 件', () => {
    expect(clampDrop(90, 20)).toBe(11);
  });

  it('已經滿了再加 ⇒ 加多少丟多少', () => {
    expect(clampDrop(99, 1)).toBe(1);
    expect(clampDrop(99, 50)).toBe(50);
  });
});
