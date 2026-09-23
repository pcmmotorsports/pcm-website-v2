// @vitest-environment jsdom
// url-writer.test.tsx — :901 唯一送網址出口與落地分類(plan `docs/plans/2026-09-22-catalog-url-writer-plan.md` §3-3、§3-4)。
// 這裡只驗純邏輯(router 用假的、網址列用 jsdom 真的 history);整頁連點的驗收在片 3 / 片 8 的 T1 ~ T15。
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import {
  latestTarget,
  processLanding,
  processNavigationIdle,
  processPopState,
  pushNavigation,
  registerLinkTarget,
  currentSeq,
  resetUrlWriterForTests,
  sentForTests,
  setLandingHandler,
  writeSearch,
} from './url-writer';
import { resetVehicleIntentForTests, setVehicleIntent, getVehicleIntent } from './vehicle-intent';
import { CatalogLink } from '@/components/CatalogLink';

// Next `Link` 的替身:點擊處理順序照 Next 16.3.0 `client/app-dir/link.js`(onClick ⇒ 已取消就停 ⇒
// 修飾鍵 / 中鍵 / target / download 就交給瀏覽器 ⇒ onNavigate ⇒ onNavigate 取消就不導航)。
vi.mock('next/link', () => ({
  default: ({
    href,
    onClick,
    onNavigate,
    children,
    ...rest
  }: {
    href: string;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
    onNavigate?: (e: { preventDefault: () => void }) => void;
    children?: React.ReactNode;
  } & Record<string, unknown>) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        const target = e.currentTarget.getAttribute('target');
        const modified = (target && target !== '_self') || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.nativeEvent.which === 2;
        if (modified || e.currentTarget.hasAttribute('download')) return;
        e.preventDefault();
        onNavigate?.({ preventDefault: () => {} });
      }}
    >
      {children}
    </a>
  ),
}));

const R7 = { kind: 'vehicle', segment: 'yamaha:yzf-r7', brandName: 'Yamaha', modelName: 'YZF-R7' } as const;

function fakeRouter() {
  return { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
}
const here = () => window.location.pathname + window.location.search;
const go = (href: string) => window.history.replaceState(null, '', href);

beforeEach(() => {
  resetUrlWriterForTests();
  resetVehicleIntentForTests();
  setLandingHandler(() => {}); // 頁面已掛好(沒掛好的情況另有一格)
  go('/products?vehicle=yamaha:mt-07&page=3');
});
afterEach(cleanup);

describe('writeSearch', () => {
  it('以最新目標為底連寫兩發:第二發帶著第一發的改動;車款由意圖覆寫;replace 先預寫網址列', () => {
    const router = fakeRouter();
    setVehicleIntent(R7);
    writeSearch(router, () => {});
    writeSearch(router, (p) => p.set('sort', 'price'));
    expect(router.replace.mock.calls.map((c) => c[0])).toEqual([
      '/products?page=3&vehicle=yamaha%3Ayzf-r7',
      '/products?page=3&sort=price&vehicle=yamaha%3Ayzf-r7',
    ]);
    expect(here()).toBe('/products?page=3&sort=price&vehicle=yamaha%3Ayzf-r7');
    expect(latestTarget().get('sort')).toBe('price');
  });

  it('🔴 負對照:底若是網址列以外的舊網址(沒預寫)就會帶回 MT-07 —— 這裡證明底確實是最新目標', () => {
    const router = fakeRouter();
    setVehicleIntent(R7);
    writeSearch(router, () => {});
    go('/products?vehicle=yamaha:mt-07&page=3'); // Next 把較早一發落地時改回網址列的情況
    writeSearch(router, (p) => p.set('sort', 'price'));
    expect(router.replace.mock.calls.at(-1)?.[0]).toContain('vehicle=yamaha%3Ayzf-r7');
  });

  it('意圖是 none ⇒ 清掉短版與長版車款;意圖還沒初始化 ⇒ 不動車款', () => {
    const router = fakeRouter();
    writeSearch(router, (p) => p.set('sort', 'price'));
    expect(router.replace.mock.calls[0]?.[0]).toContain('vehicle=yamaha%3Amt-07');
    setVehicleIntent({ kind: 'none' });
    writeSearch(router, () => {});
    expect(router.replace.mock.calls.at(-1)?.[0]).toBe('/products?page=3&sort=price');
  });

  it('🔴 結果與最新目標相同 ⇒ 不送(網址列是 `yamaha:mt-07`、重新編碼後是 `yamaha%3Amt-07`,仍算相同)', () => {
    const router = fakeRouter();
    writeSearch(router, () => {});
    expect(router.replace).not.toHaveBeenCalled();
    expect(sentForTests()).toHaveLength(0);
  });

  it('push 不預寫網址列(實測:預寫會讓上一筆紀錄留著舊畫面)', () => {
    const router = fakeRouter();
    writeSearch(router, (p) => p.delete('page'), { method: 'push' });
    expect(router.push).toHaveBeenCalledWith('/products?vehicle=yamaha%3Amt-07', { scroll: false });
    expect(here()).toBe('/products?vehicle=yamaha:mt-07&page=3');
  });
});

describe('processLanding', () => {
  it('自己送的較早一發落地 ⇒ 移掉它與更早的;網址列寫回最新目標;不動意圖', () => {
    const router = fakeRouter();
    setVehicleIntent(R7);
    writeSearch(router, () => {});
    writeSearch(router, (p) => p.set('sort', 'price'));
    const [first, second] = sentForTests().map((s) => s.href);
    go(first!); // Next 落地第一發時把網址列改回它
    processLanding(router, first!);
    expect(sentForTests().map((s) => s.href)).toEqual([second]);
    expect(here()).toBe(second);
    expect(getVehicleIntent()).toEqual(R7);
  });

  it('同一個已落地重複出現(卸載再掛載)⇒ 不做事', () => {
    const router = fakeRouter();
    const handler = vi.fn();
    setLandingHandler(handler);
    processLanding(router, '/products?x=1');
    processLanding(router, '/products?x=1');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('不在清單裡的網址落地 ⇒ 清單清空、交給頁面、意圖有車而網址沒車 ⇒ 補寫', () => {
    const router = fakeRouter();
    setVehicleIntent(R7);
    writeSearch(router, (p) => p.set('sort', 'price'));
    const handler = vi.fn();
    setLandingHandler(handler);
    go('/products?filter=new');
    processLanding(router, '/products?filter=new');
    expect(handler).toHaveBeenCalledWith(expect.any(URLSearchParams), 'external');
    expect(router.replace.mock.calls.at(-1)?.[0]).toBe('/products?filter=new&vehicle=yamaha%3Ayzf-r7');
    expect(sentForTests().map((s) => s.href)).toEqual(['/products?filter=new&vehicle=yamaha%3Ayzf-r7']);
  });

  it('頁面依網址改了意圖(外部帶 MT-07)⇒ 網址與意圖一致 ⇒ 不補寫', () => {
    const router = fakeRouter();
    setVehicleIntent(R7);
    setLandingHandler(() => setVehicleIntent({ kind: 'vehicle', segment: 'yamaha:mt-07', brandName: 'Yamaha', modelName: 'MT-07' }));
    go('/products?vehicle=yamaha%3Amt-07');
    processLanding(router, '/products?vehicle=yamaha%3Amt-07');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('登記過的連結目標落地 ⇒ 走外部落地(補寫車款),之後的操作以它為底', () => {
    const router = fakeRouter();
    setVehicleIntent(R7);
    registerLinkTarget('/products');
    expect(latestTarget().toString()).toBe('');
    writeSearch(router, (p) => p.set('sort', 'price'));
    expect(router.replace.mock.calls.at(-1)?.[0]).toBe('/products?sort=price&vehicle=yamaha%3Ayzf-r7');
  });

  // 🔴 Fable 片 6 R3 必修 B1:舊條件是「清單是空的、而且目的地等於現在這頁」才跳過登記。
  //   客人先點「新品上架」(production 會把還沒完成的那一發丟掉 ⇒ 永遠不落地)、再點「商品目錄」
  //   (目的地就是現在這一頁)⇒ 清單不是空的 ⇒ 第二筆照樣登記進去,而兩筆都等不到落地來消
  //   ⇒ 之後客人點分類永遠寫不進網址。把修法改回舊條件,這格會紅。
  it('片 6 R3 必修 B1:點了沒落地的連結, 再點「就是現在這頁」的連結 ⇒ 分類照樣寫得進網址', () => {
    const router = fakeRouter();
    setVehicleIntent({ kind: 'none' });
    go('/products');
    processLanding(router, '/products');
    registerLinkTarget('/products?filter=new'); // 點「新品上架」,這一發不會落地
    registerLinkTarget('/products'); // 再點「商品目錄」= 現在這一頁
    expect(sentForTests(), '目的地就是現在這頁 ⇒ 連前面沒落地的一起作廢').toEqual([]);
    writeSearch(router, (p) => p.set('category', '排氣系統'));
    expect(router.replace.mock.calls.at(-1)?.[0], '客人點分類寫不進網址').toBe('/products?category=%E6%8E%92%E6%B0%A3%E7%B3%BB%E7%B5%B1');
  });
});

describe('Codex 片 2 R1 必修', () => {
  it('① 落地處理當下補送的一發,不會被同一輪的「導航完成」清掉', () => {
    const router = fakeRouter();
    setVehicleIntent(R7);
    const before = currentSeq();
    go('/products?filter=new');
    processLanding(router, '/products?filter=new'); // 外部落地 ⇒ 補送帶 R7 的一發
    processNavigationIdle('/products?filter=new', before);
    expect(sentForTests().map((s) => s.href)).toEqual(['/products?filter=new&vehicle=yamaha%3Ayzf-r7']);
    expect(here()).toBe('/products?filter=new&vehicle=yamaha%3Ayzf-r7'); // 網址列不被改回沒車款
  });

  it('② 頁面還沒登記落地處理(loading 畫面)⇒ 先擱著、不補寫;登記時才處理一次', () => {
    resetUrlWriterForTests();
    const router = fakeRouter();
    setVehicleIntent(R7);
    go('/products?vehicle=yamaha%3Amt-07');
    processLanding(router, '/products?vehicle=yamaha%3Amt-07');
    expect(router.replace).not.toHaveBeenCalled(); // 不會先用 R7 蓋掉網址上的 MT-07
    const handler = vi.fn(() => setVehicleIntent({ kind: 'vehicle', segment: 'yamaha:mt-07', brandName: 'Yamaha', modelName: 'MT-07' }));
    setLandingHandler(handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.any(URLSearchParams), 'external');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('③ 不在列表頁時按上一頁回到列表頁 ⇒ 照「上一頁」處理(不補回車款、refresh)', async () => {
    const router = fakeRouter();
    setVehicleIntent(R7);
    const handler = vi.fn(() => setVehicleIntent({ kind: 'none' }));
    setLandingHandler(handler);
    // 首頁(沒有掛 useUrlWriter)按上一頁回到沒有車款的 /products
    go('/products');
    window.dispatchEvent(new PopStateEvent('popstate'));
    processLanding(router, '/products');
    expect(handler).toHaveBeenCalledWith(expect.any(URLSearchParams), 'history');
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('③ 之後改走一般連結到別的網址 ⇒ 那筆上一頁紀錄作廢,照外部落地', () => {
    const router = fakeRouter();
    const handler = vi.fn();
    setLandingHandler(handler);
    go('/products?a=1');
    window.dispatchEvent(new PopStateEvent('popstate'));
    processLanding(router, '/products?b=2');
    expect(handler).toHaveBeenLastCalledWith(expect.any(URLSearchParams), 'external');
  });
});

describe('導航完成、上一頁', () => {
  it('導航完成 ⇒ 清單清空、網址列對齊已落地(被丟棄的舊一發不殘留)', () => {
    const router = fakeRouter();
    setVehicleIntent(R7);
    writeSearch(router, () => {});
    processNavigationIdle('/products?vehicle=yamaha%3Amt-07');
    expect(sentForTests()).toHaveLength(0);
    expect(here()).toBe('/products?vehicle=yamaha%3Amt-07');
  });

  it('上一頁 ⇒ 清單清空、交給頁面(history)、一律 refresh,不補寫車款', () => {
    const router = fakeRouter();
    setVehicleIntent(R7);
    writeSearch(router, () => {});
    const handler = vi.fn(() => setVehicleIntent({ kind: 'none' }));
    setLandingHandler(handler);
    go('/products?search=abc');
    processPopState(router);
    expect(handler).toHaveBeenCalledWith(expect.any(URLSearchParams), 'history');
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(sentForTests()).toHaveLength(0);
    processLanding(router, '/products?search=abc'); // 之後 Next 落地同一個網址 ⇒ 不再處理
    expect(router.replace).toHaveBeenCalledTimes(1); // 只有上面那一發選車
  });

  it('pushNavigation 帶車款的交接:清單尾端加目的網址,落地算自己送的', () => {
    const router = fakeRouter();
    pushNavigation(router, '/products?vehicle=yamaha:yzf-r7', { external: false });
    expect(router.push).toHaveBeenCalledWith('/products?vehicle=yamaha%3Ayzf-r7');
    const handler = vi.fn();
    setLandingHandler(handler);
    processLanding(router, '/products?vehicle=yamaha:yzf-r7');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('CatalogLink(R4 必修 ②)', () => {
  // jsdom 不支援真的換頁:React 的 onClick 跑完之後(document 冒泡階段)才取消,不影響被測的判斷
  const stopJsdomNavigation = (e: Event) => e.preventDefault();
  beforeEach(() => document.addEventListener('click', stopJsdomNavigation));
  afterEach(() => document.removeEventListener('click', stopJsdomNavigation));
  const click = (init: MouseEventInit, attrs: Record<string, string> = {}) => {
    const { getByText } = render(
      <CatalogLink href="/products" {...attrs}>
        商品目錄
      </CatalogLink>,
    );
    fireEvent.click(getByText('商品目錄'), init);
  };

  it('一般左鍵 ⇒ 登記', () => {
    click({ button: 0 });
    expect(sentForTests()).toEqual([{ href: '/products', external: true }]);
  });

  it.each([
    ['Command', { button: 0, metaKey: true }, {}],
    ['Ctrl', { button: 0, ctrlKey: true }, {}],
    ['Shift', { button: 0, shiftKey: true }, {}],
    ['Alt', { button: 0, altKey: true }, {}],
    ['target=_blank', { button: 0 }, { target: '_blank' }],
    ['download', { button: 0 }, { download: '' }],
  ])('%s ⇒ 目前分頁不導航 ⇒ 不登記', (_name, init, attrs) => {
    click(init, attrs);
    expect(sentForTests()).toHaveLength(0);
  });

  it('④ 呼叫端的 onNavigate 取消了 ⇒ Next 不導航 ⇒ 不登記', () => {
    const { getByText } = render(
      <CatalogLink href="/products?filter=new" onNavigate={(e) => e.preventDefault()}>
        新品上架
      </CatalogLink>,
    );
    fireEvent.click(getByText('新品上架'), { button: 0 });
    expect(sentForTests()).toHaveLength(0);
  });

  it('呼叫端的 onClick 取消了 ⇒ 不登記', () => {
    const { getByText } = render(
      <CatalogLink href="/products" onClick={(e) => e.preventDefault()}>
        商品目錄
      </CatalogLink>,
    );
    fireEvent.click(getByText('商品目錄'), { button: 0 });
    expect(sentForTests()).toHaveLength(0);
  });
});
