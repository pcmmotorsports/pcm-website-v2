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

function renderAsOwner(ownerId: string | null) {
  return render(
    <CartProvider serverOwnerId={ownerId}>
      <CartView />
    </CartProvider>,
  );
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
    rerender(
      <CartProvider serverOwnerId={null}>
        <CartView />
      </CartProvider>,
    );

    // ── 兩個斷言,而**它們被兩發【不同的】突變殺死** ────────────────
    // ① 車真的空了 ⇒ 殺死「整段拿掉」那一發(那一發下品項原封不動,這裡會 timeout)
    await waitFor(() => expect(screen.getByText('購物車是空的')).toBeTruthy());
    // ② 那句話不得出現。
    //   🛑🛑 **而我量到它在這個世界【殺不死任何突變】, 照寫 —— 這不是一道已驗證的守門。**
    //   🔬 突變「只拿掉 `setCartSessionId(null)`」(品項清了而去重子沒收)⇒ **本格仍然綠**。
    //     等 60ms 再印整個畫面 ⇒ 只有「購物車是空的」, **那句話從頭到尾沒出現過**。
    //   🎯 **成因看起來在別的地方, 而它是一個【比本格更大】的發現**(⟦acct-PRUNEBASELINEWIPE⟧):
    //     掛真的 `CartProvider` 時, `cartSessionId` 在 hydrate 那一刻由 `null` 變成
    //     localStorage 還原的 UUID ⇒ `CartView:134-142` 那支歸零 effect **當場把 `baselineRef` 清成 null**
    //     ⇒ 之後 `pruned` 再也算不出來。⚠️ **機制未證實, 而【結果】是量到的**:
    //     真 provider + 一筆查無被修復掉 ⇒ **畫面上沒有那句話**, 而 mock 版那一格斷言它會出現。
    //   ⇒ 📌 **留著這一行不是因為它有牙齒, 是因為它是這一列要防的那句話** —— 牙齒在 ① 那行。
    expect(screen.queryByText(/已為您移除/)).toBeNull();
  });
});
