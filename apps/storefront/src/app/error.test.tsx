// @vitest-environment jsdom
//
// error boundary smoke test(500;Sean 2026-09-01 拍甲「錯誤頁現在做」)——
// 鏡像 not-found.test.tsx 的慣例,逐格對齊。
// 驗四件:①design 500 字面 ②兩顆 CTA 的 href ③err-support 段【有】(這是 500 與 404 的分野)
//        ④🔴 不把 error 的內容印到畫面上。
//
// 🔴 ④那一格是本檔真正承重的斷言,而它的形狀是【兩個世界會印不同的東西】:
//    今天它綠,是因為 error.tsx 根本不收 props;
//    哪天有人加了 `{error.message}` 或 `{error.digest}`,這一格【當場紅】。
//    ⇒ 而 404 那支測不到它(404 沒有 error 物件)⇒ 這是本檔存在的理由之一。

// ══════════════════════════════════════════════════════════════════════════════
// 🔴🔴 **這一段比下面那 5 支測試更有可能救到你(2026-09-01, 兩輪 code-reviewer 換來的)**
//
// 這支檔裡那把「有沒有把 error 洩漏出去」的尺, **今天被加寬三次, 每一次都是別人指出來的**:
//     textContent(只看得到文字節點)
//  ⇒ body.innerHTML(body 那一側的屬性也進來)
//  ⇒ documentElement.innerHTML(head 也進來 —— 因為這一片加了一顆 <title>)
//
// 🛑 **而我每一次都以為自己這次夠寬了 —— 而每一次我手上都有一發「突變殺掉了」當證據。**
//
// 📌 **⇒ 所以那個證據的效力要講清楚**:
//    一發成功的突變**證明【尺會動】, 它不證明【尺有多寬】** ——
//    🔴 **而這兩件事在報告裡長得一模一樣。**
//
// 🛑🛑 **⇒ 而更狠的一格:那些突變是【我自己造的】。**
//    ⇒ 我造得出來的突變, 天然落在我想得到的範圍裡
//    ⇒ ⇒ **一發自造的突變, 量的是【我的想像力】, 不是【尺的射程】。**
//
// ⇒ 所以下一個動這支檔的人:**不要因為「突變殺掉了」就停下來。**
//   先問一句 —— **error 還可以從哪裡出去, 而那條路在不在這把尺的射程裡?**
//   已知還在射程外的:`reportError()`、自訂 logger、送到外部服務的網路請求。
// ══════════════════════════════════════════════════════════════════════════════

import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render as rtlRender, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/boom',
  useSearchParams: () => new URLSearchParams(),
}));

import GlobalRouteError from './error';
import { CartProvider } from '../contexts/CartContext';

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: CartProvider });

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList));
});

afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined') window.localStorage.clear();
});

describe('error boundary (500)', () => {
  it('renders design ErrorPage 500 variant with CTA links', () => {
    render(<GlobalRouteError />);
    expect(screen.getByText('500')).toBeDefined();
    expect(screen.getByText('N°500 · Server Error')).toBeDefined();
    expect(screen.getByText('服務暫時無法使用')).toBeDefined();
    expect(screen.getByText('我們正在處理、請稍後再試。如持續發生、請聯絡客服。')).toBeDefined();

    const home = screen.getByText('回首頁').closest('a')!;
    expect(home.getAttribute('href')).toBe('/');
    const catalog = document.querySelector('.err-cta a.btn-outline')!;
    expect(catalog.getAttribute('href')).toBe('/products');
  });

  it('500 變體【有】err-support 段, 而 404 那支斷言它是 null —— 兩支合起來才分得出變體', () => {
    render(<GlobalRouteError />);
    const support = document.querySelector('.err-support');
    expect(support).not.toBeNull();
    // 那條「聯絡客服」指到實存路由 /stores(design onNav('stores') 的 harness 轉譯)
    // 🔴 一定要【限定在 .err-support 裡面】找 —— 這一頁上有【兩個】「聯絡客服」:
    //    一個是本段(design 500 變體帶來的),一個在 HomeFooter 裡(Sean 2026-08-29 拍甲接 LINE)。
    //    第一版沒限定範圍 ⇒ getByText 撞到兩個 ⇒ 當場紅。**那個紅是真的,不是測試寫壞。**
    const contact = support!.querySelector('a')!;
    expect(contact.getAttribute('href')).toBe('/stores');
    // 🛑 把那個重複【量出來釘住】,而不是讓它安靜地留在畫面上:
    //    今天是 2(err-support 一個 + 頁尾一個),而它們指到【不同的地方】。
    //    ⇒ 已端給 Sean 裁(要不要統一)。他改了之後這一格會紅,那正是我們要的。
    const allContacts = screen.getAllByText('聯絡客服');
    expect(allContacts).toHaveLength(2);
    const hrefs = allContacts.map((n) => n.closest('a')?.getAttribute('href'));
    expect(hrefs.filter((h) => h === '/stores')).toHaveLength(1);
    // 🔴 頁尾那一條【本檔不驗它的值】(code-reviewer F3):
    //    第一版寫 `h !== '/stores'` ⇒ 那對頁尾【零判別力】—— LINE 短網址掉成空字串或 '#'
    //    這一格照樣過。真正的守門在 HomeFooter.test.tsx:122(它釘 SOCIAL_URLS.line)。
    //    ⇒ 這裡只驗「它不是 /stores」這件事本身, 而【不假裝】自己在驗那條連結對不對。
    const footerOne = hrefs.filter((h) => h !== '/stores');
    expect(footerOne).toHaveLength(1);
  });

  it('🔴 不把 error 的內容印到畫面上(有人加 error.message 或 digest ⇒ 這一格會紅)', () => {
    // 刻意用 error boundary 真正會拿到的形狀餵它:Next 傳 { error, reset }。
    const props = {
      error: Object.assign(new Error('boundary-should-not-render-this-message'), {
        digest: 'boundary-should-not-render-this-digest',
      }),
      reset: () => {},
    };
    const Component = GlobalRouteError as unknown as (p: typeof props) => ReactElement;
    render(<Component {...props} />);

    // 🔴 用 innerHTML 不用 textContent(code-reviewer F2 must-fix, 而它是量到的不是猜的):
    //    textContent **只看得到文字節點** ⇒ 植進 title / aria-label / data-* / href 的 error
    //    在 textContent 底下【四種全部看不到】, 而 innerHTML 四種全部看得到。
    //    ⇒ 📌 我第一版那次突變(把 error.message 印成文字)之所以會紅, 是因為那個植入點
    //      【本來就在 textContent 的射程內】—— 它證明了尺會動, 沒有證明尺有多寬。
    // 🔴 `documentElement` 不是 `body`(code-reviewer R2 N1, 而它是量到的):
    //    `<title>` 會被 React hoist 進 `document.head` ⇒ **body 那一側看不到它**。
    //    而這一片剛好新增了一顆 `<title>` ⇒ 有人把 digest 放進去 ⇒ 兩把尺【全綠】。
    //    ⇒ 📌 尺一路加寬三次:textContent(只有文字)⇒ body.innerHTML(body 的屬性)
    //      ⇒ documentElement.innerHTML(head 也進來)。**每一次加寬都是別人指出來的。**
    const html = document.documentElement.innerHTML;
    expect(html.length).toBeGreaterThan(200); // 防 '' 對 '' 的空斷言
    expect(html).not.toContain('boundary-should-not-render-this-message');
    expect(html).not.toContain('boundary-should-not-render-this-digest');
    // 🟢 正對照:同一份 html 裡, design 那句中文【要在】—— 證明我量到的是真的畫面
    expect(html).toContain('服務暫時無法使用');
  });

  it('🔴 也不把 error 交給 console(Next 官方 error.tsx 範本就是 console.error(error))', () => {
    // code-reviewer F2 點名的【最可能】那條漏法:照官方範本加
    //   useEffect(() => { console.error(error); }, [error])
    // ⇒ error 物件進了瀏覽器 console, 而畫面上一個字都沒多 ⇒ 上面那三格【全綠】。
    // ⇒ 📌 所以這一格量的不是畫面, 是【副作用】—— 兩種漏法住在兩個地方, 要兩把尺。
    // 🔴 四個都掛(code-reviewer R2 N4):官方範本用 console.error, 而 log/warn/info 一樣漏。
    //    ⚠️ 仍不涵蓋 `reportError()` 與自訂 logger —— 具名缺口, 不假裝這把尺是全的。
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spies = [
      errorSpy,
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
    ];
    const props = {
      error: Object.assign(new Error('boundary-should-not-console-this-message'), {
        digest: 'boundary-should-not-console-this-digest',
      }),
      reset: () => {},
    };
    const Component = GlobalRouteError as unknown as (p: typeof props) => ReactElement;
    render(<Component {...props} />);

    const logged = spies.flatMap((sp) => sp.mock.calls).map((c) => c.map(String).join(' ')).join('\n');
    expect(logged).not.toContain('boundary-should-not-console-this-message');
    expect(logged).not.toContain('boundary-should-not-console-this-digest');
    // 🟢 正對照:證明這把 spy 真的攔得到 —— 自己餵一發, 它必須看得見
    console.error('spy-liveness-probe');
    const after = errorSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(after).toContain('spy-liveness-probe');
    spies.forEach((sp) => sp.mockRestore());
  });
});
