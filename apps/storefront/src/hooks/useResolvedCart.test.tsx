// @vitest-environment jsdom
//
// useResolvedCart 自我修復守門(#375 角標脫鉤 / #455 幽靈行刪不掉;2026-08-10)。
//
// 本檔只守一件事:**「什麼時候可以動客人的購物車」**。
//   ① resolve 成功、server 對某行明確判定 found:false → 那行(只有那行)被 removeItem 掉。
//   ② 🔴 resolve **reject** → removeItem 一次都不准被呼叫(items 一筆不少)。
//      這是本片的災難面:`.catch()` 會把 resolved 清成 []、每一行都長得像幽靈行,
//      移除邏輯若寫錯位置,一次網路抖動就清光客人整車。
//   ③ 🔴 resolvedMap 查無(server 沒回這一行)→ 不刪。與 ② 同一條紀律的另一個面:
//      「沒有明確判定」≠「判定為 false」。
//   ④ found:false 行不進 lines / 不計入小計(既有行為,一併釘住避免修的時候順手改壞)。
//
// 突變靶與**實跑量到的** kill-set(不是預期、是真跑的結果;每次跑完 md5 復原原檔)。
// 逐字寫出改法,照著貼就能重跑:
//   M1  `for (const l of lines) if (l.found === false) …`
//       → `const keep = new Set(lines.filter((l) => l.found).map((l) => lineMapKey(l)));`
//         `for (const it of items) if (!keep.has(lineMapKey(it))) removeItem({…it})`   → ③ ⑤ 紅(② 綠)
//   M2  在 `.catch()` 內加一行 `for (const it of items) removeItem({ productId: it.productId, variantId: it.variantId });`
//       ⚠️ 不能寫成 `for (const l of lines)`:`lines` 在 catch 裡會綁到 hook 層那個 useMemo const、
//          型別對不上,tsc 先擋下來、根本跑不到測試 —— 靶要用 `items` 才是可執行形狀。      → ② 紅
//   M3  整段 for 迴圈刪掉                                                                  → ① 紅
//   M4  `l.found === false` 改寫成 `!l.found`                                              → ⑤ 紅
//   MX3 `removeItem({…, variantId: l.variantId })` → `removeItem({ productId: l.productId })`  → ① 紅
//       🔴 R1 審查者用來打穿本檔的靶:**修正前 5 格全綠**(GHOST 沒 variantId +
//          toHaveBeenCalledWith 走 toEqual 語意 ⇒ 省略與 undefined 相等)。
//   MX4 `if (l.found === false)` → `if (l.found === false && l.variantId)`                     → ⑥ 紅
//       🔴 codex 關卡2 用來打穿「MX3 的修法」的靶:**⑥ 補進來之前 5 格全綠**。
//   MX5 拿掉 `if (healSeq === latestHealSeq)` 這層跨實例守衛                                   → ⑦ 紅
//
// 🔴 **這張表本身有一段值得記的歷史**:MX3 的修法(把所有幽靈 fixture 都補上 variantId)**直接製造了
//   MX4 那個洞** —— 修完之後「只刪有 variantId 的」變成全綠。折 finding 當下順手改的 fixture,
//   是整份 diff 裡最沒被驗過的東西;每次折完都要回頭問「我剛補的那一半,有沒有把另一半掏空」。
//   ⇒ 現在兩半都有 fixture:GHOST(有 variantId)守 ①、BARE_GHOST(無)守 ⑥。
//
// 全部 7 格 × 7 靶的對應關係(實跑,不是推的):
//   ①=M3,MX3   ②=M2   ③=M1   ⑤=M1,M4   ⑥=M3,MX4   ⑦=MX5   ④=無專屬靶(見上)
//
//   🔴 一條要講清楚的**反直覺**:M1 沒有紅 ② —— 因為 M1 仍然待在 `.then()` 裡,reject 時
//   那段根本不執行。⇒ **② 守的不是「條件寫得對不對」,是「這段程式住在哪個分支」**;
//   把 ② 當成「條件正確性」的證明會高估它。真正擋住「條件放寬」的是 ③,擋住「搬家」的是 ②,
//   兩條缺一不可(這也是為什麼 §4 那個災難面需要兩種靶,不是一種)。
//   ④ 沒有專屬突變靶:它釘的是**既有**過濾行為,放在這裡是防止修的時候順手改壞,不宣稱新判別力。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, cleanup, waitFor } from '@testing-library/react';
import type { CartItem } from '@/contexts/CartContext';
import type { ResolvedCartLine } from '@/app/cart/actions';

const { cartRef, resolveMock, removeItemMock } = vi.hoisted(() => ({
  cartRef: { current: { items: [] as CartItem[], isHydrated: true } },
  resolveMock: vi.fn(),
  removeItemMock: vi.fn(),
}));

vi.mock('@/contexts/CartContext', () => ({
  useCart: () => ({ ...cartRef.current, removeItem: removeItemMock }),
}));
vi.mock('@/app/cart/actions', () => ({
  resolveCartLines: resolveMock,
}));

import { useResolvedCart } from './useResolvedCart';

/** 真行 fixture。🔴 unitPrice 刻意非 0 —— 用 0 會讓 ④ 的小計斷言恆真、失去判別力。 */
function line(over: Partial<ResolvedCartLine> & Pick<ResolvedCartLine, 'productId'>): ResolvedCartLine {
  return {
    variantId: undefined,
    found: true,
    slug: over.productId,
    brand: 'RPM CARBON',
    name: '測試商品',
    image: null,
    fits: '',
    variantLabel: null,
    sku: null,
    unitPrice: 700,
    fitments: [],
    ...over,
  };
}

function setCart(items: CartItem[]) {
  cartRef.current = { items, isHydrated: true };
}

const REAL: CartItem = { productId: 'real-a', qty: 1 };
// 🔴 GHOST **必須帶 variantId**(R1 must-fix):第一版是 `{ productId: 'ghost-b', qty: 2 }`,
//   於是斷言只能寫成 `toHaveBeenCalledWith({ productId, variantId: undefined })` ——
//   而 `toHaveBeenCalledWith` 走 toEqual 語意,`{a, b:undefined}` 與 `{a}` **相等** ⇒
//   把移除呼叫改成只帶 productId(突變 MX3)時 5 格全綠 = variantId 那半邊從來沒被守過。
//   真實世界最大宗的幽靈行(變體已不存在,`actions.ts:151`)**一定帶 variantId**,
//   所以那正是最需要被釘住的一半。給真值 ⇒ 省略 variantId 立刻紅。
const GHOST: CartItem = { productId: 'ghost-b', variantId: 'v-ghost', qty: 2 };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useResolvedCart 自我修復(#375/#455)', () => {
  it('① resolve 成功 + server 明確 found:false → 只移除那一行', async () => {
    setCart([REAL, GHOST]);
    resolveMock.mockResolvedValue([
      line({ productId: 'real-a' }),
      line({ productId: 'ghost-b', variantId: 'v-ghost', found: false, unitPrice: 0 }),
    ]);

    renderHook(() => useResolvedCart());

    await waitFor(() => expect(removeItemMock).toHaveBeenCalled());
    // 只刪幽靈行,而且 line key **兩半都要逐字傳出**——variantId 那半是 R1 補的:
    // 帶真值 'v-ghost' 之後,「呼叫時省略 variantId」不再與本斷言相等(突變 MX3 會紅)。
    expect(removeItemMock).toHaveBeenCalledTimes(1);
    expect(removeItemMock).toHaveBeenCalledWith({ productId: 'ghost-b', variantId: 'v-ghost' });
  });

  it('② 🔴 resolve reject → removeItem 一次都不准被呼叫(整車不得被清)', async () => {
    setCart([REAL, GHOST]);
    resolveMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useResolvedCart());

    // 等 catch 真的跑完(status 落定成 empty),否則「還沒跑到」也會讓斷言假綠。
    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(removeItemMock).not.toHaveBeenCalled();
  });

  it('③ server 沒回某一行(查無 ≠ 判定 false)→ 不刪', async () => {
    setCart([REAL, GHOST]);
    // 只回 real-a;ghost-b 整行缺席(對應 actions.ts:102-119 的 `continue` 畸形行路徑)。
    resolveMock.mockResolvedValue([line({ productId: 'real-a' })]);

    const { result } = renderHook(() => useResolvedCart());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(removeItemMock).not.toHaveBeenCalled();
    // 缺席那行照舊不顯示(既有行為),但**留在 cart 裡**。
    expect(result.current.lines.map((l) => l.item.productId)).toEqual(['real-a']);
  });

  it('④ found:false 行不進 lines、不計入小計', async () => {
    setCart([REAL, GHOST]);
    resolveMock.mockResolvedValue([
      line({ productId: 'real-a' }),
      // 幽靈行給非 0 單價:若哪天過濾破了,小計會從 700 變成 2100 = 抓得到。
      // variantId 必須與 GHOST 逐字相同,否則 resolvedMap 的 key 對不上 ⇒ 這格會退化成
      // 測「查無」(= ③ 的情境)而不是測「found:false 被濾掉」,判別力悄悄跑掉。
      line({ productId: 'ghost-b', variantId: 'v-ghost', found: false, unitPrice: 700 }),
    ]);

    const { result } = renderHook(() => useResolvedCart());

    await waitFor(() => expect(result.current.lines.length).toBe(1));
    expect(result.current.lines.map((l) => l.item.productId)).toEqual(['real-a']);
    expect(result.current.subtotal).toBe(700);
  });

  it('⑥ 🔴 無 variantId 的幽靈行同樣要刪(商品下架 / 有變體卻沒帶規格那兩類)', async () => {
    // codex 關卡2 MF-B:①⑤ 修完之後,所有幽靈 fixture 都帶了 variantId ⇒ 把移除條件改成
    // 「只刪有 variantId 的 found:false」竟然五格全綠(實跑 MX4 證實),而 `actions.ts:127`
    // (商品找不到)與 `:174`(有變體卻沒帶有效 variantId)這兩類幽靈**本來就沒有 variantId**
    // —— 正是它們把結帳擋死。⇒ 兩半都要有 fixture,補這一格。
    const BARE_GHOST: CartItem = { productId: 'bare-c', qty: 1 };
    setCart([REAL, BARE_GHOST]);
    resolveMock.mockResolvedValue([
      line({ productId: 'real-a' }),
      line({ productId: 'bare-c', found: false, unitPrice: 0 }), // 無 variantId
    ]);

    renderHook(() => useResolvedCart());

    await waitFor(() => expect(removeItemMock).toHaveBeenCalled());
    expect(removeItemMock).toHaveBeenCalledTimes(1);
    expect(removeItemMock).toHaveBeenCalledWith({ productId: 'bare-c', variantId: undefined });
  });

  it('⑦ 🔴 同頁兩個實例:被較新解析推翻的舊 found:false 不准動 cart', async () => {
    // codex 關卡2 MF-A:`resolveSeq` 是 useRef、每個實例一份。CartView 與 CheckoutView 在路由
    // 過渡窗口可能同時掛著;若 server 在兩次請求之間把該行翻回 found:true,較舊實例仍會通過
    // 自己那把守衛、刪掉客人還要的行。模組層 latestHealSeq 就是為了擋這一格。
    setCart([REAL, GHOST]);
    const stale = [
      line({ productId: 'real-a' }),
      line({ productId: 'ghost-b', variantId: 'v-ghost', found: false, unitPrice: 0 }),
    ];
    const fresh = [line({ productId: 'real-a' }), line({ productId: 'ghost-b', variantId: 'v-ghost' })];
    // 第一個實例(較舊)慢回、且回的是已過期的 found:false;第二個實例(較新)立刻回 found:true。
    resolveMock
      .mockImplementationOnce(
        () => new Promise((resolve) => { setTimeout(() => resolve(stale), 30); }),
      )
      .mockImplementationOnce(() => Promise.resolve(fresh));

    renderHook(() => {
      useResolvedCart();
      useResolvedCart();
    });

    // 等到慢的那個一定已經回來(30ms + 餘裕)。
    await new Promise((resolve) => { setTimeout(resolve, 120); });
    expect(removeItemMock).not.toHaveBeenCalled();
  });

  it('⑤ 🔴 found 欄缺值(型別若鬆綁)→ 視為「沒有明確判定」、不刪', async () => {
    setCart([REAL]);
    // 刻意繞過型別餵出 found:undefined —— 釘住 `=== false` 而非 `!l.found`:
    // 前者往「留著」壞、後者往「刪光客人的車」壞,方向不同不可互換。
    const noVerdict = { ...line({ productId: 'real-a' }), found: undefined } as unknown as ResolvedCartLine;
    resolveMock.mockResolvedValue([noVerdict]);

    const { result } = renderHook(() => useResolvedCart());

    await waitFor(() => expect(result.current.status).toBe('empty')); // found 非 true → 不顯示
    expect(removeItemMock).not.toHaveBeenCalled();
  });
});
