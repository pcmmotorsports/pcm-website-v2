// @vitest-environment jsdom
//
// ProductCard 快速加購接線 — Sean 2026-08-08 回報「商品目錄、首頁…加入購物車都沒反應」。
// 根因=`pcard-quick-btn` 的 onClick 只有 `preventDefault + stopPropagation`,加購邏輯**從未接線**。
// 五個掛載面共用這一顆鈕(`/products` 商品目錄 / 首頁 rail / 品牌頁 / 會員中心推薦 / 相關商品)
// ⇒ 一處接線五面同時好。拍板:**有規格 → 導商品頁選規格 / 無規格 → 直接加入**(Sean 中午拍 A,
// ~~取代晨間 Q1=A「卡片自動加第一個變體」~~ —— 那版會做出幽靈品項,見下方該族註解)/
// Q2=A(1.5 秒「✓ 已加入」)/ Q3=A(手機可達性另開視覺片)。
// 🔴 2026-10-01 計畫甲(Sean 批):改成**只有一個規格 → 直接加入(帶規格編號)/ 多規格與零規格 → 導商品頁**,
//    卡片按下去才問伺服器(`app/api/catalog/quick-add/route.ts`)。
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
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CartProvider, useCart, type CartItem } from '@/contexts/CartContext';
import { writeVehicleContext, VEHICLE_CONTEXT_KEY } from '@/lib/vehicle-context';
import { ProductCard } from './ProductCard';
import { MOCK_PRODUCTS } from '@/data/mock-products';
import type { QuickAddTarget } from '@/app/api/catalog/quick-add/route';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

// 2026-10-01 計畫甲(Sean 批):卡片按下去才問伺服器「這件能不能直接加」。測試裡把那支伺服器動作換成假的,
// 每格自己決定伺服器回什麼(`resolveMock` 收到的是網址上的 slug);伺服器那一端另有 app/api/catalog/quick-add/route.test.ts。
const resolveMock = vi.fn<(slug: string | null) => Promise<QuickAddTarget>>();
const fetchStub = vi.fn(async (url: string) => {
  const body = await resolveMock(new URL(url, 'http://localhost').searchParams.get('slug'));
  return { ok: true, json: async () => body };
});

// 🔴 明確給 `variantCount`:fixture 不准靠「剛好沒這個欄位」決定走哪條路(R1 抓過那種恆綠)。
const VARIANT_ID = 'aaaaaaaa-1111-4222-8333-444444444444';
const single = { ...MOCK_PRODUCTS[0]!, variantCount: 1 };
const product = single; // MobileTabBar 那段沿用這個名字

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

const quickBtn = (container: HTMLElement) => {
  const btn = container.querySelector('.pcard-quick-btn') as HTMLElement;
  expect(btn, '找不到 .pcard-quick-btn ⇒ 本檔前提失效').not.toBeNull();
  return btn;
};

/** 點一下並等伺服器那一趟回來(假的伺服器動作是 resolved promise ⇒ 一次 async act 就夠)。 */
const clickQuickAdd = async (container: HTMLElement) => {
  const btn = quickBtn(container);
  await act(async () => void fireEvent.click(btn));
  return btn;
};

beforeEach(() => {
  observed = { items: [], totalQty: 0 };
  window.localStorage.clear();
  window.sessionStorage.removeItem(VEHICLE_CONTEXT_KEY);
  resolveMock.mockReset();
  resolveMock.mockResolvedValue({ kind: 'add', variantId: VARIANT_ID });
  vi.stubGlobal('fetch', fetchStub);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * 🔴 2026-10-01:這一檔原本有 10 格 `it.skip`(前提是「卡片直加只服務零變體, 而零變體不賣」⇒ 對 0 個商品有效)。
 *    Sean 批計畫甲 ⇒ 卡片直加改服務【只有一個規格】的商品 ⇒ 那 10 格照新前提【重寫】(帶規格編號、要等伺服器回來),
 *    不是把 skip 拿掉重跑。零變體「不賣」那個前提沒變, 守它的那幾格留著。
 */
describe('ProductCard 快速加購', () => {
  it('🔴 單一規格 → 點「+ 加入購物車」真的加進購物車, 而且帶著規格編號', async () => {
    const { container } = renderCard(<ProductCard p={single} />);
    expect(quickBtn(container).textContent).toBe('+ 加入購物車');
    await clickQuickAdd(container);
    expect(resolveMock).toHaveBeenCalledWith(single.slug);
    expect(observed.totalQty).toBe(1);
    expect(observed.items[0]).toMatchObject({ productId: single.slug, variantId: VARIANT_ID, qty: 1 });
  });

  it('🔴 伺服器說「去商品頁」(其實有多個規格)→ 不加購, 改點外層 <a> 導到商品頁', async () => {
    resolveMock.mockResolvedValue({ kind: 'page' });
    const { container } = renderCard(
      <ProductCard p={{ ...single, variantCount: undefined }} href={`/products/${single.slug}`} />,
    );
    const anchor = container.querySelector('a')!;
    // jsdom 不會真的換頁, 這裡只記「<a> 自己有沒有被點」。只算 target 是 <a> 的那一發:
    // 按鈕那一下的原生事件也會冒泡經過 <a>(React 在根節點才 stopPropagation), 那一發不算導頁。
    const followed = vi.fn();
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      if (e.target === anchor) followed();
    });
    await clickQuickAdd(container);
    expect(observed.totalQty).toBe(0);
    expect(followed).toHaveBeenCalledTimes(1);
  });

  it('伺服器回錯誤(非 2xx)→ 不加購, 改導到商品頁(不讓卡片自己猜規格)', async () => {
    fetchStub.mockImplementationOnce(async () => ({ ok: false, json: async () => ({ kind: 'add', variantId: VARIANT_ID }) }));
    const onClick = vi.fn();
    const { container } = renderCard(<ProductCard p={single} onClick={onClick} />);
    await clickQuickAdd(container);
    expect(observed.totalQty).toBe(0);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('沒有 href 的卡片, 伺服器說「去商品頁」→ 改呼叫 onClick(HomeSelect 那種用法)', async () => {
    resolveMock.mockResolvedValue({ kind: 'page' });
    const onClick = vi.fn();
    const { container } = renderCard(<ProductCard p={single} onClick={onClick} />);
    await clickQuickAdd(container);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(observed.totalQty).toBe(0);
  });

  it('伺服器那一趟還沒回來 → 鈕寫「加入中…」, 再按也不會多問一次', async () => {
    let release!: (t: QuickAddTarget) => void;
    resolveMock.mockImplementation(() => new Promise((r) => (release = r)));
    const { container } = renderCard(<ProductCard p={single} />);
    const btn = quickBtn(container);
    act(() => void fireEvent.click(btn));
    expect(btn.textContent).toBe('加入中…');
    act(() => void fireEvent.click(btn));
    expect(resolveMock).toHaveBeenCalledTimes(1);
    await act(async () => release({ kind: 'add', variantId: VARIANT_ID }));
    expect(observed.totalQty).toBe(1);
  });

  // ── 有規格 ⇒ 導商品頁(Sean 2026-08-08 中午拍板 A;2026-10-01 計畫甲維持)──
  // 🔴 列表讀路徑不帶規格編號 ⇒ 多規格若在卡片直加, 會做出「顯示已加入、車裡卻沒有」的幽靈品項。
  it('🔴 多規格 → 不加購, 也不去問伺服器', async () => {
    const { container } = renderCard(<ProductCard p={{ ...single, variantCount: 2 }} />);
    await clickQuickAdd(container);
    expect(resolveMock).not.toHaveBeenCalled();
    expect(observed.totalQty).toBe(0);
  });

  // 導頁靠「不攔截點擊」讓外層 <Link> 自己走 ⇒ 觀測點=`defaultPrevented === false`。
  it('多規格 → 不擋原生導航(讓外層 <Link> 導去商品頁)', () => {
    const { container } = renderCard(
      <ProductCard p={{ ...single, variantCount: 2 }} href={`/products/${single.slug}`} />,
    );
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => void quickBtn(container).dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(false);
    expect(observed.totalQty).toBe(0);
  });

  it('多規格 → 鈕字面是「選擇規格」不是「+ 加入購物車」', () => {
    const { container } = renderCard(<ProductCard p={{ ...single, variantCount: 2 }} />);
    expect(quickBtn(container).textContent).toBe('選擇規格');
  });

  /**
   * 🔴 零變體「不賣」(Sean 2026-08-31, 板 ⟦b4-NOVARIANT1⟧)—— 2026-10-01 計畫甲沒有改這一條。
   * ⛔ ~~`it('無規格 → 照舊直加、variantId 不帶(line key 退回 productId)')`~~ 那是 2026-08-31 以前的契約。
   */
  it('無規格 → **不直加**、而是讓外層 <a> 導到商品頁(Sean 2026-08-31 拍「不賣」)', async () => {
    const { container } = renderCard(<ProductCard p={{ ...single, variants: undefined, variantCount: 0 }} />);
    await clickQuickAdd(container);
    expect(resolveMock).not.toHaveBeenCalled();
    expect(observed.totalQty, '零變體被加進購物車了 ⇒ Sean 2026-08-31「零變體不賣」被翻開了').toBe(0);
  });

  it('無規格 → 鈕字面是「查看商品」, 不得是「+ 加入購物車」', () => {
    const { container } = renderCard(<ProductCard p={{ ...single, variants: undefined, variantCount: 0 }} />);
    expect(quickBtn(container).textContent).toBe('查看商品');
  });

  it('沒有價格 → 鈕字面是「查看商品」, 不問伺服器、不加購', async () => {
    const { container } = renderCard(<ProductCard p={{ ...single, price: null }} />);
    expect(quickBtn(container).textContent).toBe('查看商品');
    await clickQuickAdd(container);
    expect(resolveMock).not.toHaveBeenCalled();
    expect(observed.totalQty).toBe(0);
  });

  /**
   * 🔴 2026-10-01 翻面:`variantCount` 未知(`/products` 與品牌頁)。
   * ⛔ ~~未知 → 鈕寫「查看商品」、點了導頁不加購~~(2026-08-08 F2 / R2 的安全側)。
   * ⇒ Sean 批計畫甲:那兩頁也寫「+ 加入購物車」, 按下去由伺服器判斷。安全側沒有丟:
   *   伺服器拿不準就回「去商品頁」(見上面那兩格), 卡片從不自己猜規格。
   */
  it('variantCount 未知 → 鈕字面是「+ 加入購物車」, 按下去問伺服器(單一規格就加入)', async () => {
    const { container } = renderCard(<ProductCard p={{ ...single, variantCount: undefined }} />);
    expect(quickBtn(container).textContent).toBe('+ 加入購物車');
    await clickQuickAdd(container);
    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(observed.items[0]).toMatchObject({ variantId: VARIANT_ID });
  });

  it('選車鏡名稱字面齊全 → 帶車款(kind dict / source search)', async () => {
    writeVehicleContext({
      brandId: 'yamaha',
      modelId: 'mt-09',
      year: 2022,
      label: 'YAMAHA MT-09 2022',
      brandName: 'YAMAHA',
      modelName: 'MT-09',
    });
    const { container } = renderCard(<ProductCard p={single} />);
    await clickQuickAdd(container);
    expect(observed.items[0]?.vehicle).toMatchObject({
      kind: 'dict',
      brand: 'YAMAHA',
      model: 'MT-09',
      year: 2022,
      source: 'search',
    });
  });

  // 車種鐵律零猜:名稱欄不齊(舊鏡)⇒ 整欄不帶,而不是拿 label 反解析。
  it('選車鏡缺名稱字面欄 → vehicle 整欄不帶(零猜)', async () => {
    writeVehicleContext({ brandId: 'yamaha', modelId: 'mt-09', label: 'YAMAHA MT-09' });
    const { container } = renderCard(<ProductCard p={single} />);
    await clickQuickAdd(container);
    expect(observed.items[0]?.vehicle).toBeUndefined();
    expect(observed.totalQty).toBe(1); // 沒車不擋加購
  });

  // 有 href 時加購:擋掉外層 <a> 的導航(否則加完同時跳去商品頁)。
  it('有 href 時點加購 → 加進購物車**且**不觸發外層 <a> 導航', async () => {
    const { container } = renderCard(<ProductCard p={single} href={`/products/${single.slug}`} />);
    const btn = quickBtn(container);
    expect(btn.closest('a'), '前提:鈕在 <a> 內').not.toBeNull();
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => void btn.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(observed.totalQty).toBe(1);
  });

  describe('Q2=A 加購回饋', () => {
    it('點下去 → 鈕文字變「✓ 已加入」', async () => {
      const { container } = renderCard(<ProductCard p={single} />);
      const btn = await clickQuickAdd(container);
      expect(btn.textContent).toBe('✓ 已加入');
    });

    it('1.5 秒後自動復原成「+ 加入購物車」', async () => {
      vi.useFakeTimers();
      const { container } = renderCard(<ProductCard p={single} />);
      const btn = await clickQuickAdd(container);
      expect(btn.textContent).toBe('✓ 已加入');
      act(() => void vi.advanceTimersByTime(1499));
      expect(btn.textContent).toBe('✓ 已加入'); // 還沒到
      act(() => void vi.advanceTimersByTime(1));
      expect(btn.textContent).toBe('+ 加入購物車');
    });

    // 🔴 「存時間戳而非布林」的存在理由:布林在連點時值沒變 ⇒ effect 不重跑 ⇒ 第二次的回饋提早消失。
    it('連點兩次 → 第二次的回饋從第二次起算 1.5 秒(計時器有重置)', async () => {
      vi.useFakeTimers();
      const { container } = renderCard(<ProductCard p={single} />);
      const btn = await clickQuickAdd(container);
      act(() => void vi.advanceTimersByTime(1000)); // 第一次已過 1 秒
      await clickQuickAdd(container);
      act(() => void vi.advanceTimersByTime(1000)); // 距第一次 2 秒、距第二次 1 秒
      expect(btn.textContent, '布林版本會在這裡已經復原').toBe('✓ 已加入');
      act(() => void vi.advanceTimersByTime(500));
      expect(btn.textContent).toBe('+ 加入購物車');
      expect(observed.totalQty).toBe(2); // 兩次點擊=兩件
    });
  });

  // 同一個規格加兩次 ⇒ 走 CartContext 既有去重、qty 累加(不是兩列)。
  it('同商品點兩次 → 同一列 qty=2(走既有去重、不產生第二列)', async () => {
    const { container } = renderCard(<ProductCard p={single} />);
    await clickQuickAdd(container);
    await clickQuickAdd(container);
    expect(observed.items).toHaveLength(1);
    expect(observed.items[0]?.qty).toBe(2);
  });
});

// ── 全站連動:手機底欄徽章(Sean 2026-08-08 逐字「購物車的數字也要全站連動」)──────────
// 桌機 Header 的數字早就接了(`Header.tsx:58,170,219`);手機底欄這顆從來沒有徽章 = 唯一缺口。
// (`next/navigation` 的 mock 在檔頭、對整檔生效,見上方說明。)
// 本 import 依賴檔頭那個被 hoist 的 vi.mock  ⟵ 原為 eslint-disable(那條規則本 repo 沒在跑)⇒ 指令拆掉、理由留著
import { MobileTabBar } from './MobileTabBar';

describe('MobileTabBar 購物車件數徽章', () => {
  // 突變:拿掉 `t.id === 'cart' && totalQty > 0 && …` 那段 ⇒ 只紅這族
  it('購物車有東西 → 底欄購物車 tab 顯示件數', async () => {
    render(
      <CartProvider>
        <ProductCard p={product} />
        <MobileTabBar />
      </CartProvider>,
    );
    expect(document.querySelector('.mobile-tabbar-cart-dot')).toBeNull(); // 空車不顯
    await act(async () => void fireEvent.click(document.querySelector('.pcard-quick-btn') as HTMLElement));
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
  it('徽章只出現一次、且在購物車那顆 tab 上', async () => {
    render(
      <CartProvider>
        <ProductCard p={product} />
        <MobileTabBar />
      </CartProvider>,
    );
    await act(async () => void fireEvent.click(document.querySelector('.pcard-quick-btn') as HTMLElement));
    const dots = document.querySelectorAll('.mobile-tabbar-cart-dot');
    expect(dots).toHaveLength(1);
    expect(dots[0]!.closest('a')?.getAttribute('href')).toBe('/cart');
  });
});
