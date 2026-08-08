// @vitest-environment jsdom
//
// ProductCard 快速加購接線 — Sean 2026-08-08 回報「商品目錄、首頁…加入購物車都沒反應」。
// 根因=`pcard-quick-btn` 的 onClick 只有 `preventDefault + stopPropagation`,加購邏輯**從未接線**。
// 五個掛載面共用這一顆鈕(`/products` 商品目錄 / 首頁 rail / 品牌頁 / 會員中心推薦 / 相關商品)
// ⇒ 一處接線五面同時好。拍板:**有規格 → 導商品頁選規格 / 無規格 → 直接加入**(Sean 中午拍 A,
// ~~取代晨間 Q1=A「卡片自動加第一個變體」~~ —— 那版會做出幽靈品項,見下方該族註解)/
// Q2=A(1.5 秒「✓ 已加入」)/ Q3=A(手機可達性另開視覺片)。
//
// 🔴 本檔與既有 `ProductCard.test.tsx` 分開:那支是 smoke test(自陳「驗 render 不報錯」),
//    本檔驗的是**行為**——`addItem` 收到什麼。混在一起會讓那支的定位變模糊。
//
// ⚠️ 測不到、如實申報:真瀏覽器零覆蓋(worktree 無 `.env.local`);
//    hover-only 的可達性是 CSS + 觸控事件的事,jsdom 量不到(Q3=A 已另開片)。

// 🔴 `next/navigation` 的 mock 放在**檔頭**且**對整檔生效**(`vi.mock` 會被 hoist 到 import 之前,
//    不是寫在哪一段就只作用於那一段;第一版把它擺在下半部、註解擺位會讓人誤以為有作用域)。
//    只有 `MobileTabBar` 用得到它(讀 `usePathname` 決定哪顆 tab is-active);`ProductCard` 不碰路由。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CartProvider, useCart, type CartItem } from '@/contexts/CartContext';
import { writeVehicleContext, VEHICLE_CONTEXT_KEY } from '@/lib/vehicle-context';
import { ProductCard } from './ProductCard';
import { MOCK_PRODUCTS } from '@/data/mock-products';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

// 🔴 **明確給 `variantCount: 0`**:未知(缺欄)走的是「有規格 → 導頁」那一側(安全側),
//    所以「無規格直加」這族的前提必須寫出來,不能靠 fixture 剛好沒這個欄位。
//    (R1 抓過反過來的形狀:fixture 給了 `variants` 卻沒給 `variantCount`、守門讀 `?? 0` 照樣全綠。)
const product = { ...MOCK_PRODUCTS[0]!, variantCount: 0 };

/** 把 provider 內的真 cart 內容暴露出來給斷言看(不 mock CartContext=驗到真的去重/clamp 行為)。 */
let observed: { items: CartItem[]; totalQty: number } = { items: [], totalQty: 0 };
function Probe() {
  const { items, totalQty } = useCart();
  observed = { items, totalQty };
  return null;
}

function renderCard(node: ReactNode) {
  return render(
    <CartProvider>
      {node}
      <Probe />
    </CartProvider>,
  );
}

const clickQuickAdd = (container: HTMLElement) => {
  const btn = container.querySelector('.pcard-quick-btn') as HTMLElement;
  expect(btn, '找不到 .pcard-quick-btn ⇒ 本檔前提失效').not.toBeNull();
  fireEvent.click(btn);
  return btn;
};

beforeEach(() => {
  observed = { items: [], totalQty: 0 };
  window.localStorage.clear();
  window.sessionStorage.removeItem(VEHICLE_CONTEXT_KEY);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ProductCard 快速加購', () => {
  // 突變:把 quickAdd 的 body 換回只有 preventDefault+stopPropagation(=修復前的字面)⇒ 只紅這族
  it('點「+ 加入購物車」→ 真的加進購物車(修復前:零反應)', () => {
    const { container } = renderCard(<ProductCard p={product} />);
    expect(observed.totalQty).toBe(0);
    clickQuickAdd(container);
    expect(observed.totalQty).toBe(1);
    expect(observed.items[0]).toMatchObject({ productId: product.slug, qty: 1 });
  });

  // ── 有規格 ⇒ 導商品頁(Sean 2026-08-08 中午拍板 A,取代晨間 Q1=A「自動加第一個變體」)──
  //
  // 🔴 **這族是本片存在的理由**:列表讀路徑不帶變體資料 ⇒ 卡片若直加,`variantId` 恆 undefined,
  //    購物車 server 端 fail-closed 丟掉整行 ⇒ 客人看到「✓ 已加入」+ 徽章 +1、進購物車卻沒那筆
  //    (幽靈品項,比原本的沒反應更糟)。
  // ⚠️ 判定必須看 `variantCount` 而非 `variants.length` —— 第一版測試就是栽在這裡:
  //    fixture 給了 `variants` 卻沒給 `variantCount`,守門讀 `?? 0` 走直加分支、**照樣全綠**。
  //    這是「fixture 讓守門恆真」的活體;以下每一格都明確給 `variantCount`。
  it('🔴 有規格 → 不加購(幽靈品項回歸格:plan §6-7)', () => {
    const { container } = renderCard(<ProductCard p={{ ...product, variantCount: 2 }} />);
    clickQuickAdd(container);
    expect(observed.items).toHaveLength(0);
    expect(observed.totalQty).toBe(0);
  });

  // 導頁靠「不攔截點擊」讓外層 <Link> 自己走 ⇒ 觀測點=`defaultPrevented === false`。
  // 突變:把 `if (hasVariants) return;` 挪到 preventDefault 之後 ⇒ 只紅這條
  it('有規格 → 不擋原生導航(讓外層 <Link> 導去商品頁)', () => {
    const { container } = renderCard(
      <ProductCard p={{ ...product, variantCount: 2 }} href={`/products/${product.slug}`} />,
    );
    const btn = container.querySelector('.pcard-quick-btn') as HTMLElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => void btn.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(false);
    expect(observed.totalQty).toBe(0);
  });

  // 字面必須符合行為(主視窗裁定:正確性不是調性)。突變:鈕文字改成恆為加購字面 ⇒ 只紅這條
  it('有規格 → 鈕字面是「選擇規格」不是「+ 加入購物車」', () => {
    const { container } = renderCard(<ProductCard p={{ ...product, variantCount: 2 }} />);
    expect((container.querySelector('.pcard-quick-btn') as HTMLElement).textContent).toBe('選擇規格');
  });

  it('無規格 → 照舊直加、variantId 不帶(line key 退回 productId)', () => {
    const { container } = renderCard(
      <ProductCard p={{ ...product, variants: undefined, variantCount: 0 }} />,
    );
    clickQuickAdd(container);
    expect(observed.totalQty).toBe(1);
    expect(observed.items[0]?.variantId).toBeUndefined();
  });

  // 🔴 R2 must-fix:`variantCount` 缺欄 = **不知道**,不是「沒有」。
  //   `/products` 商品目錄與品牌頁走 RPC → `catalog-page.ts` 的 mapper,那支沒有這個欄位 ⇒
  //   若把未知當「沒有」而直加,幽靈品項會在**正是 Sean 點名的那一面**原封復發。
  //   兩種猜錯的代價不對稱:猜「有規格」最差多跳一次商品頁;猜「沒規格」做出刪不掉的幽靈行。
  // 突變:把判定改回 `(p.variantCount ?? 0) > 0` ⇒ 只紅這條
  it('🔴 variantCount 缺欄(未知)→ 走安全側:當作有規格、導頁不加購', () => {
    const { container } = renderCard(<ProductCard p={{ ...product, variantCount: undefined }} />);
    clickQuickAdd(container);
    expect(observed.totalQty).toBe(0);
  });

  // 🔴 鈕字面是**三態**(主視窗 F2 裁定)。未知時不能寫「選擇規格」——走 RPC 的兩面恆為未知,
  //   零變體商品也會被那麼寫、點進去卻沒規格可選 = 字面小謊。「查看商品」誠實描述鈕實際的行為。
  // 突變:把 `quickLabel` 的 undefined 分支併回「選擇規格」⇒ 只紅這條
  it('variantCount 未知 → 鈕字面是「查看商品」(不是「選擇規格」)', () => {
    const { container } = renderCard(<ProductCard p={{ ...product, variantCount: undefined }} />);
    expect((container.querySelector('.pcard-quick-btn') as HTMLElement).textContent).toBe('查看商品');
  });

  // 突變:拿掉 `readSearchVehicle()` 那段 ⇒ 只紅這條
  it('選車鏡名稱字面齊全 → 帶車款(kind dict / source search)', () => {
    writeVehicleContext({
      brandId: 'yamaha',
      modelId: 'mt-09',
      year: 2022,
      label: 'YAMAHA MT-09 2022',
      brandName: 'YAMAHA',
      modelName: 'MT-09',
    });
    const { container } = renderCard(<ProductCard p={product} />);
    clickQuickAdd(container);
    expect(observed.items[0]?.vehicle).toMatchObject({
      kind: 'dict',
      brand: 'YAMAHA',
      model: 'MT-09',
      year: 2022,
      source: 'search',
    });
  });

  // 車種鐵律零猜:名稱欄不齊(舊鏡)⇒ 整欄不帶,而不是拿 label 反解析。
  // 突變:讓 readSearchVehicle 在名稱不齊時也回值 ⇒ 只紅這條
  it('選車鏡缺名稱字面欄 → vehicle 整欄不帶(零猜)', () => {
    writeVehicleContext({ brandId: 'yamaha', modelId: 'mt-09', label: 'YAMAHA MT-09' });
    const { container } = renderCard(<ProductCard p={product} />);
    clickQuickAdd(container);
    expect(observed.items[0]?.vehicle).toBeUndefined();
    expect(observed.totalQty).toBe(1); // 沒車不擋加購
  });

  // 🔴 既有行為不得回歸(`ProductCard.test.tsx` 那條的姊妹格:那支只驗 defaultPrevented、
  //    不驗有沒有加購;這條反過來——確認接了加購之後,擋導航那半邊還在)。
  // 突變:拿掉 quickAdd 裡的 preventDefault ⇒ 只紅這條
  it('有 href 時點加購 → 加進購物車**且**不觸發外層 <a> 導航', () => {
    const { container } = renderCard(
      <ProductCard p={product} href={`/products/${product.slug}`} />,
    );
    const btn = container.querySelector('.pcard-quick-btn') as HTMLElement;
    expect(btn.closest('a'), '前提:鈕在 <a> 內').not.toBeNull();
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    // 用原生 dispatchEvent(而非 fireEvent)才量得到 `defaultPrevented`=瀏覽器會不會執行 <a>
    // 的 default action;但它繞過 RTL 的 act 包裝 ⇒ 要自己包,否則 state 不 flush、Probe 讀到舊值。
    act(() => void btn.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(observed.totalQty).toBe(1);
  });

  describe('Q2=A 加購回饋', () => {
    // 突變:鈕文字改成恆為 '+ 加入購物車' ⇒ 只紅這條
    it('點下去 → 鈕文字變「✓ 已加入」', () => {
      const { container } = renderCard(<ProductCard p={product} />);
      const btn = clickQuickAdd(container);
      expect(btn.textContent).toBe('✓ 已加入');
    });

    // 突變:把 1500 改成 0、或拿掉 setTimeout ⇒ 只紅這條
    it('1.5 秒後自動復原成「+ 加入購物車」', () => {
      vi.useFakeTimers();
      const { container } = renderCard(<ProductCard p={product} />);
      const btn = clickQuickAdd(container);
      expect(btn.textContent).toBe('✓ 已加入');
      act(() => void vi.advanceTimersByTime(1499));
      expect(btn.textContent).toBe('✓ 已加入'); // 還沒到
      act(() => void vi.advanceTimersByTime(1));
      expect(btn.textContent).toBe('+ 加入購物車');
    });

    // 🔴 這條是「存時間戳而非布林」的存在理由:布林在連點時第二次 setState 值沒變
    //    ⇒ effect 不重跑 ⇒ 計時器不重置 ⇒ 第二次點的回饋會提早消失。
    // 突變:把 `addedAt` 換成 `useState(false)` + `setAdded(true)` ⇒ 只紅這條
    it('連點兩次 → 第二次的回饋從第二次起算 1.5 秒(計時器有重置)', () => {
      vi.useFakeTimers();
      const { container } = renderCard(<ProductCard p={product} />);
      const btn = clickQuickAdd(container);
      act(() => void vi.advanceTimersByTime(1000)); // 第一次已過 1 秒
      fireEvent.click(btn);
      act(() => void vi.advanceTimersByTime(1000)); // 距第一次 2 秒、距第二次 1 秒
      expect(btn.textContent, '布林版本會在這裡已經復原').toBe('✓ 已加入');
      act(() => void vi.advanceTimersByTime(500));
      expect(btn.textContent).toBe('+ 加入購物車');
      expect(observed.totalQty).toBe(2); // 兩次點擊=兩件
    });
  });

  // 加購兩次同一商品 ⇒ 走 CartContext 既有去重、qty 累加(不是兩列)。
  // 這條不是本片新行為,是釘住「卡片直加走的是同一條去重路徑」。
  it('同商品點兩次 → 同一列 qty=2(走既有去重、不產生第二列)', () => {
    const { container } = renderCard(<ProductCard p={product} />);
    clickQuickAdd(container);
    clickQuickAdd(container);
    expect(observed.items).toHaveLength(1);
    expect(observed.items[0]?.qty).toBe(2);
  });
});

// ── 全站連動:手機底欄徽章(Sean 2026-08-08 逐字「購物車的數字也要全站連動」)──────────
// 桌機 Header 的數字早就接了(`Header.tsx:58,170,219`);手機底欄這顆從來沒有徽章 = 唯一缺口。
// (`next/navigation` 的 mock 在檔頭、對整檔生效,見上方說明。)
// eslint-disable-next-line import/first -- 本 import 依賴檔頭那個被 hoist 的 vi.mock
import { MobileTabBar } from './MobileTabBar';

describe('MobileTabBar 購物車件數徽章', () => {
  // 突變:拿掉 `t.id === 'cart' && totalQty > 0 && …` 那段 ⇒ 只紅這族
  it('購物車有東西 → 底欄購物車 tab 顯示件數', () => {
    render(
      <CartProvider>
        <ProductCard p={product} />
        <MobileTabBar />
      </CartProvider>,
    );
    expect(document.querySelector('.mobile-tabbar-cart-dot')).toBeNull(); // 空車不顯
    fireEvent.click(document.querySelector('.pcard-quick-btn') as HTMLElement);
    expect(document.querySelector('.mobile-tabbar-cart-dot')?.textContent).toBe('1');
  });

  // `totalQty > 0` 守門(沿用 Header 同款):空車不顯 = SSR/hydrate 前不會閃一個 0。
  // 突變:把守門改成 `totalQty >= 0` ⇒ 只紅這條
  it('空車 → 不渲染徽章(不顯示 0)', () => {
    render(
      <CartProvider>
        <MobileTabBar />
      </CartProvider>,
    );
    expect(document.querySelector('.mobile-tabbar-cart-dot')).toBeNull();
  });

  // 徽章只掛購物車那顆,不是每顆 tab 都長一個。
  // 突變:拿掉 `t.id === 'cart' &&` ⇒ 只紅這條
  it('徽章只出現一次、且在購物車那顆 tab 上', () => {
    render(
      <CartProvider>
        <ProductCard p={product} />
        <MobileTabBar />
      </CartProvider>,
    );
    fireEvent.click(document.querySelector('.pcard-quick-btn') as HTMLElement);
    const dots = document.querySelectorAll('.mobile-tabbar-cart-dot');
    expect(dots).toHaveLength(1);
    expect(dots[0]!.closest('a')?.getAttribute('href')).toBe('/cart');
  });
});
