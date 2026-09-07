// @vitest-environment jsdom
//
// ⟦acct-LOGOUTTESTBLIND⟧ 片 1 —— 2026-09-07 線【帳號】`account`。
//
// 🔴🔴 **為什麼要【另開一支檔】,而不是修 `CartView.test.tsx` 裡那一格。**
//   那支檔對 `@/contexts/CartContext` 下了 `vi.mock`,把 `useCart` 換成一個手捏的物件
//   ⇒ 🎯 **`CartProvider` 一行都沒跑** ⇒ **改 `CartContext` 對那支檔【結構上】看不見。**
//   🔬 實測(2026-09-03 開列 28 格 · 2026-09-07 複驗 30 格,結論相同):
//     把 `CartContext` 那兩行登出清空**整段拿掉** ⇒ 那支檔 **一格都沒紅**。
//   ⛔ ~~板上原本寫「修法:一行」(把 helper 的 `??` 改成 `in`)~~ ⇒ **改完仍然 30 格全綠**
//     ——`??` 那個洞是真的、也修了(`43c431095`),而它**不是**這一格假綠的成因。
//   ⇒ 📌 **兩個各自正確的診斷,而只有第二個能讓突變紅。**
//
// ✅ 本檔的做法:**不 mock `useCart`**,掛真的 `<CartProvider>`,
//   用它真正的觸發器 —— `serverOwnerId` 從 `'user-A'` 變成 `null` —— 去演一次登出。
//   ⇒ 這樣 `CartContext.tsx` 那兩行才在測試裡**真的被執行**。
//
// 🛑 **本檔【不改】 `CartContext.tsx` / `CartView.tsx` 本體**(主視窗 B 2026-09-07 的約束)。

import type React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { CartProvider } from '@/contexts/CartContext';
import type { CartItem } from '@/contexts/CartContext';
import type { ResolvedCartLine } from '@/app/cart/actions';

const { resolveMock, pushMock } = vi.hoisted(() => ({
  resolveMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock('@/app/cart/actions', () => ({ resolveCartLines: resolveMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

import { CartView } from './CartView';

// ── mock 邊界都收在這裡,不散在格子裡 ──────────────────────────────
//
// 🔴 這兩個字面是 `CartContext.tsx:76-77` 的 `STORAGE_KEY` / `SESSION_KEY`,而**它們沒有 export**
//   ⇒ 這裡只能抄。抄來的字面會腐爛,所以**不靠它們自己證明自己**:
//   每一格都先 `await screen.findByText(...)` 等真的品項出現 —— 鍵名若被改掉,
//   種不進去 ⇒ 車是空的 ⇒ 那一發 `findByText` 當場 timeout,**不會安靜地綠**。
const STORAGE_KEY = 'pcm-cart-mock-v2';
const SESSION_KEY = 'pcm-cart-session-v1';
// 🔴 `readSessionId` 只信 UUID 格式(`CartContext.tsx:264-270`)—— 隨便一個字串會被丟棄視同無 key。
const SEED_SESSION_ID = '11111111-2222-4333-8444-555555555555';

function seedCart(items: CartItem[], sessionId: string | null = SEED_SESSION_ID) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  if (sessionId) window.localStorage.setItem(SESSION_KEY, sessionId);
  else window.localStorage.removeItem(SESSION_KEY);
}

function resolvedLine(over: Partial<ResolvedCartLine> & { productId: string }): ResolvedCartLine {
  return {
    variantId: undefined,
    found: true,
    slug: over.productId,
    brand: 'RPM',
    name: '碳纖維車台護蓋',
    image: 'https://cdn.example/img.jpg',
    fits: 'Aprilia RSV4',
    variantLabel: null,
    sku: null,
    unitPrice: 14600,
    fitments: [],
    ...over,
  };
}

function ownerTree(ownerId: string | null | undefined) {
  return (
    <CartProvider serverOwnerId={ownerId}>
      <CartView />
    </CartProvider>
  );
}

function renderAsOwner(ownerId: string | null | undefined) {
  return render(ownerTree(ownerId));
}

// 🔴 換手 = server 端 `getUser()` 換了答案, layout 把新的 `serverOwnerId` 交下來。
//   收成一支, 是因為片 2 有四格都要做同一件事 —— 散在格子裡就會有人少帶一個 prop。
function switchOwner(
  rerender: (ui: React.ReactElement) => void,
  ownerId: string | null | undefined,
) {
  rerender(ownerTree(ownerId));
}

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  resolveMock.mockReset();
  pushMock.mockReset();
});

describe('⟦acct-LOGOUTTESTBLIND⟧ 登出清車 —— 掛真的 CartProvider', () => {
  it('🔴🔴 登出(serverOwnerId A → null)⇒ 車清空,而「已為您移除」那句話【不得】出現', async () => {
    // 世界:一個登入中的客人(user-A),車裡兩件,localStorage 有這一車的去重子。
    seedCart([
      { productId: 'rpm-1', variantId: 'v1', qty: 1 },
      { productId: 'rpm-2', variantId: 'v2', qty: 1 },
    ]);
    resolveMock.mockResolvedValue([
      resolvedLine({ productId: 'rpm-1', variantId: 'v1' }),
      resolvedLine({ productId: 'rpm-2', variantId: 'v2', name: '第二件' }),
    ]);

    const { rerender } = renderAsOwner('user-A');
    // 🔴 這一發同時是**種子有沒有種進去**的檢查(見檔頭 STORAGE_KEY 那段)。
    await screen.findByText('第二件');

    // 登出 = server 端 `getUser()` 回 null ⇒ layout 把 `serverOwnerId` 改成 null 交下來。
    //   真正做事的是 `CartContext.tsx` 那支 `[ownerId]` effect:`setItems([]); setCartSessionId(null);`
    switchOwner(rerender, null);

    // ── 兩個斷言,而**它們被兩發【不同的】突變殺死** ────────────────
    // ① 車真的空了 ⇒ 殺死「整段拿掉」那一發(那一發下品項原封不動,這裡會 timeout)
    await waitFor(() => expect(screen.getByText('購物車是空的')).toBeTruthy());
    // ② 那句話不得出現。
    //   🟢🟢 **[2026-09-07 08:1x 訂正] 這一行【現在有牙齒了】。**
    //   ⛔ ~~本行原本標著「在這個世界殺不死任何突變, 不是一道已驗證的守門」~~ —— **那句話當時是真的**,
    //     而它不成立的原因不在本檔:`⟦acct-PRUNEBASELINEWIPE⟧` 修好之後(`CartView.tsx` 那道
    //     `prevSessionRef.current === null` 判準), `baselineRef` 不再被 hydrate 清掉
    //     ⇒ 差額算得出來 ⇒ **這一行才問得出問題。**
    //   🧬 現在的突變讀數(每發只退回一件事, 還原逐字相同):
    //     · 只拿掉 `setCartSessionId(null)`(品項清了而去重子沒收)⇒ 🔴 **本格紅**
    //     · ⛔ ~~整段拿掉 `setItems([]) + setCartSessionId(null)` ⇒ 本格紅~~ ⇒ 🔴 **記錯了**
    //       (code-reviewer 2026-09-07 nit-4):那一發紅的是 **①**(車沒清 ⇒ 等不到「購物車是空的」),
    //       不是本格。**本格真正殺得掉的是上下這兩發。** 📌 把別人的牙齒記在自己帳上,
    //       日後刪掉 ① 的人會以為這裡還有守門。
    //     · 把那道新判準的 `prevSessionRef` 更新拿掉 ⇒ 🔴 **本格紅**(下一次真的換車會被跳過)
    //     · 把那道新判準【整行】拿掉 ⇒ 🟢 本格綠,而**下面那格正對照紅** ⇒ 兩格分工不同。
    //   📌 **留這段刪除線是刻意的** —— 一個「我量到它沒作用」的誠實標記, 與一個「它其實有用」的
    //     結論長得很像;不留字面, 下一個人會以為當初那句話是寫錯的。
    expect(screen.queryByText(/已為您移除/)).toBeNull();
  });
  it('🟢 正對照:一筆查無被自我修復掉 ⇒ 那句話【要】出現(⟦acct-PRUNEBASELINEWIPE⟧)', async () => {
    // 🔴 這一格在修 `CartView.tsx:156` 之前是**紅的** —— 那正是 ⟦acct-PRUNEBASELINEWIPE⟧:
    //   `cartSessionId` 在 hydrate 由 `null` 變成 UUID ⇒ 歸零 effect 把 `baselineRef` 清掉
    //   ⇒ 差額永遠算成 0 ⇒ Sean 2026-09-03 拍板(題 25 甲)要說的那句話一次都不出現。
    // 📌 它與上面那格是**同一支碼的兩個方向**:這裡要它出現, 上面要它不出現。
    seedCart([
      { productId: 'rpm-1', variantId: 'v1', qty: 1 },
      { productId: 'gone-1', variantId: 'v9', qty: 1 },
    ]);
    resolveMock.mockResolvedValue([
      resolvedLine({ productId: 'rpm-1', variantId: 'v1' }),
      resolvedLine({ productId: 'gone-1', variantId: 'v9', name: '查無這件', found: false }),
    ]);
    renderAsOwner('user-A');
    await screen.findByText('碳纖維車台護蓋');
    // 🔴 **驗【筆數】不只驗那句話在**(code-reviewer nit-5):本片修的正是「算成 0」,
    //   而**算成 2 也會讓 `/已為您移除/` 綠** ⇒ 只認那個 regex 對這一片零判別力。
    await waitFor(() => expect(screen.getByText(/1 件商品已不再供應/)).toBeTruthy());
  });

  it('🟢 正對照(沒有去重子那個世界):hydrate 當場補生一把 UUID ⇒ 那句話一樣要出現', async () => {
    // 🔴 **這一格補 code-reviewer nit-6**:我在註解裡宣稱「兩個世界都量了」,
    //   而**當時只有一個世界有格子** —— `seedCart` 的 `sessionId: null` 分支兩個呼叫端都沒用到。
    //   📌 **量過 ≠ 守住。** 那個世界才是新客人的常態:localStorage 沒有去重子,
    //   而 `CartContext.tsx:305-307` 在車非空時**當場補生一把** ⇒ 一樣發生 `null → UUID`。
    seedCart(
      [
        { productId: 'rpm-1', variantId: 'v1', qty: 1 },
        { productId: 'gone-1', variantId: 'v9', qty: 1 },
      ],
      null,
    );
    resolveMock.mockResolvedValue([
      resolvedLine({ productId: 'rpm-1', variantId: 'v1' }),
      resolvedLine({ productId: 'gone-1', variantId: 'v9', name: '查無這件', found: false }),
    ]);
    renderAsOwner('user-A');
    await screen.findByText('碳纖維車台護蓋');
    await waitFor(() => expect(screen.getByText(/1 件商品已不再供應/)).toBeTruthy());
  });

  // ═══ 片 2:三個世界 + 對照(⟦acct-LOGOUTTESTBLIND⟧, 2026-09-07 主視窗 B 派)═══
  //   三格問的是同一支碼的三條分支 —— `contexts/CartContext.tsx:394`:
  //     `if (prev === null || prev === ownerId) return;`  接著 `setItems([]); setCartSessionId(null);`
  //   🔴 **它們不是同一件事的三種寫法**:兩格要它【清】, 兩格要它【別清】,
  //     而**要它別清的那兩格, 是這支碼唯一會被「順手多清一次」害到的證人**。

  it('🔴 換帳號 A → B ⇒ 車要清空, 而「已為您移除」那句話【不得】出現', async () => {
    // 🎯 換人與登出走同一段碼, 而**客人面的後果不同**:B 看到的是自己的空車,
    //   若那句話跟著出現, 我們等於對 B 說「你有 2 件商品已不再供應」—— 那 2 件是 A 的。
    seedCart([
      { productId: 'rpm-1', variantId: 'v1', qty: 1 },
      { productId: 'rpm-2', variantId: 'v2', qty: 1 },
    ]);
    resolveMock.mockResolvedValue([
      resolvedLine({ productId: 'rpm-1', variantId: 'v1' }),
      resolvedLine({ productId: 'rpm-2', variantId: 'v2', name: '第二件' }),
    ]);
    const { rerender } = renderAsOwner('user-A');
    await screen.findByText('第二件');
    switchOwner(rerender, 'user-B');
    await waitFor(() => expect(screen.getByText('購物車是空的')).toBeTruthy());
    expect(screen.queryByText(/已為您移除/)).toBeNull();
  });

  it('🟢 同一個人重新整理(A → A)⇒ 車【原封不動】', async () => {
    // ⚠️⚠️ **這一格【守不到】它原本宣稱要守的東西, 量到了照寫。**
    //   ⛔ ~~我原本寫「這一格擋的是順手多清一次:`prev === ownerId` 那半若不見了…」~~
    //   🔬 **突變讀數**:拿掉 `prev === ownerId` 那半 ⇒ **七格一格都沒紅**。
    //   成因:那支 effect 的依賴是 `[ownerId]` ⇒ **值沒變, effect 不會再跑** ⇒ 這條路碰不到那個比較。
    //   ✅ **真正的證人在下一格**(`A → undefined → A`)—— 那條路才回得到同一個值。
    //   📌 **那這一格留著幹嘛**:它釘的是「重新整理不會把車弄不見」這個**客人面事實**,
    //   而那是讀這支檔的人第一個會問的問題。**它是文件, 不是守門** —— 兩者不要混帳。
    seedCart([
      { productId: 'rpm-1', variantId: 'v1', qty: 1 },
      { productId: 'rpm-2', variantId: 'v2', qty: 1 },
    ]);
    resolveMock.mockResolvedValue([
      resolvedLine({ productId: 'rpm-1', variantId: 'v1' }),
      resolvedLine({ productId: 'rpm-2', variantId: 'v2', name: '第二件' }),
    ]);
    const { rerender } = renderAsOwner('user-A');
    await screen.findByText('第二件');
    switchOwner(rerender, 'user-A');
    // 給它一拍去做「錯的那件事」—— 沒等就斷言, 兩個世界都會印一樣的東西。
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.getByText('第二件')).toBeTruthy();
    expect(screen.queryByText('購物車是空的')).toBeNull();
  });

  it('🟢 A → 讀不到(undefined)→ A 又讀到了 ⇒ 車【要留著】', async () => {
    // 🔴🔴 **這一格是 `prev === ownerId` 那半個判準【唯一】的證人, 而它是量出來的不是想出來的。**
    //   我原本以為上面那格「同一個人重新整理(A → A)」在守它 ⇒ 🛑 **突變證明沒有**:
    //   拿掉 `prev === ownerId` 那半 ⇒ **七格一格都沒紅**。
    //   成因:那支 effect 的依賴是 `[ownerId]` ⇒ **值沒變, effect 根本不會再跑**
    //   ⇒ 「同一個人再 render 一次」這條路**碰不到那個比較**。
    //   ✅ 碰得到的是這條:`A → undefined → A`。中間那一發 `undefined` 會**提早 return 且不更新**
    //     `prevOwnerRef`(`CartContext.tsx` 那段自己的設計)⇒ 回到 A 時 `prev` 還是 `'user-A'`
    //     ⇒ **`prev === ownerId` 成立** ⇒ 車留著。少了那半 ⇒ 🔴 **車被清空。**
    //   🎯 **失敗情境**:`getUser()` 抖一下(網路/env 讀不到)再恢復 ⇒ **客人的車在他什麼都沒做的情況下空了。**
    seedCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    const { rerender } = renderAsOwner('user-A');
    await screen.findByText('碳纖維車台護蓋');
    switchOwner(rerender, undefined);
    await new Promise((r) => setTimeout(r, 30));
    switchOwner(rerender, 'user-A');
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.getByText('碳纖維車台護蓋')).toBeTruthy();
    expect(screen.queryByText('購物車是空的')).toBeNull();
  });

  it('🟢 對照:訪客先加了東西才登入(null → A)⇒ 車【要留著】', async () => {
    // 🎯 這是 `prev === null` 那半個判準的證人, 而它是**商業行為**不是技術細節:
    //   訪客挑好東西才登入結帳是常態動線, 清掉 = 客人挑的東西在登入那一刻消失。
    seedCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    const { rerender } = renderAsOwner(null);
    await screen.findByText('碳纖維車台護蓋');
    switchOwner(rerender, 'user-A');
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.getByText('碳纖維車台護蓋')).toBeTruthy();
    expect(screen.queryByText('購物車是空的')).toBeNull();
  });

  it('🟢 對照:讀不到主人是誰(undefined)⇒ 車【要留著】, 而且要吼一聲', async () => {
    // 🔴 `undefined` 不是「沒登入」是「這一次沒讀到」(`CartContext.tsx` 那段自己寫的)。
    //   把它當成登出 ⇒ **env 壞掉的那一天, 每個客人的車都會被清空**。
    //   而畫面在「裝了而生效」與「裝了而沒生效」兩個世界長得一樣 ⇒ 那一聲 warn 是唯一的訊號,
    //   所以這一格**連那一聲一起釘**。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    renderAsOwner(undefined);
    await screen.findByText('碳纖維車台護蓋');
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.getByText('碳纖維車台護蓋')).toBeTruthy();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('讀不到購物車主人是誰'))).toBe(true);
    warn.mockRestore();
  });
});
