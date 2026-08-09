import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CHECKOUT_CSS = readFileSync(new URL('./checkout.css', import.meta.url), 'utf8');

// 🔴 註解會污染 anchor 切片:檔頭註解若提到 `.co-steps {` 或 `@media (max-width: 900px)`,
//   下面的 indexOf/match 會切到註解而誤判(本片實際踩過)。先剝掉所有 /* */ 區塊再比對。
const CSS = CHECKOUT_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

// 🔴 U1(M-3 兩步結帳):.co-steps 的 grid 欄數是硬編碼、不會自動跟隨步數。
//   codex 唯讀審查抓到 `repeat(3, 1fr)` 配兩顆鈕 = 留下空的幽靈第三欄(步驟只佔 2/3 寬)。
//   桌機與 mobile 兩處規則必須同時是 2 欄;本測試把兩處都鎖住,增減步驟時會當場轉紅。
describe('checkout 步驟列欄數 guard(U1 兩步)', () => {
  it('桌機 .co-steps 為 2 欄(不得留幽靈第三欄)', () => {
    const base = CSS.slice(0, CSS.indexOf('@media'));
    const rule = base.match(/\.co-steps\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/grid-template-columns:\s*repeat\(2,\s*1fr\)/);
    expect(rule).not.toMatch(/repeat\(3,/);
  });

  it('mobile breakpoint .co-steps 同步為 2 欄', () => {
    const mobileStart = CSS.indexOf('@media (max-width: 900px)');
    const nextBreakpoint = CSS.indexOf('@media (max-width: 720px)', mobileStart);
    const mobileCss = CSS.slice(mobileStart, nextBreakpoint);
    const rule = mobileCss.match(/\.co-steps\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/grid-template-columns:\s*1fr\s+1fr\s*;/);
    expect(rule).not.toMatch(/1fr\s+1fr\s+1fr/);
  });
});

// 🔴 U2b:收件摘要地址的單行截短**只能靠 CSS**。若有人改成 JS slice,
//   CheckoutStep2ReviewSections.test.tsx 會抓到「完整字面不見了」,本測試則抓到「三條規則被拿掉」。
//   兩邊各守一半,缺一都補不上(規則還在但沒套用 / 套用了但字面被 JS 砍掉)。
describe('checkout 收件摘要地址截短 guard(U2b)', () => {
  it('.co-shipping-summary-address 三條 CSS 截短宣告齊備', () => {
    const rule = CSS.match(/\.co-shipping-summary-address\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/overflow:\s*hidden\s*;/);
    expect(rule).toMatch(/text-overflow:\s*ellipsis\s*;/);
    expect(rule).toMatch(/white-space:\s*nowrap\s*;/);
  });
});

describe('checkout mobile CSS guard', () => {
  it('通知 Email input 在 mobile breakpoint 至少 16px，避免 iOS Safari 聚焦自動放大', () => {
    const mobileStart = CSS.indexOf('@media (max-width: 900px)');
    const nextBreakpoint = CSS.indexOf('@media (max-width: 720px)', mobileStart);
    const mobileCss = CSS.slice(mobileStart, nextBreakpoint);

    expect(mobileStart).toBeGreaterThanOrEqual(0);
    expect(nextBreakpoint).toBeGreaterThan(mobileStart);
    expect(mobileCss).toMatch(/\.co-notification-email input\s*\{[^}]*font-size:\s*16px\s*;/);
  });
});

// 🔴 U5:付款中遮罩靠原生 <dialog> ::backdrop 蓋整頁 + dialog 本身去邊框透明讓 backdrop 全屏。
//   若有人拿掉 backdrop 深色背景 / 忘了清 dialog 預設邊框,遮罩會變成一個有框小白盒 = 蓋不住頁面。
describe('checkout 付款中遮罩 CSS guard(U5)', () => {
  it('.co-pay-overlay::backdrop 具深色半透明背景(遮罩蓋整頁)', () => {
    const rule = CSS.match(/\.co-pay-overlay::backdrop\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/background:\s*rgba\(/);
  });

  it('.co-pay-overlay 去除 dialog 預設邊框與背景(讓 backdrop 全屏)', () => {
    const rule = CSS.match(/\.co-pay-overlay\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/border:\s*none/);
    expect(rule).toMatch(/background:\s*transparent/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 第5批(2026-08-06)· 平板段 / 主 CTA 熔橘 / TabBar 讓位 padding
// ══════════════════════════════════════════════════════════════════════════════

/** 取一個 @media 條件的整段內文(大括號走訪 —— `[^}]*` 跨不過內層 `{`)。 */
function mediaBlock(src: string, cond: string): string {
  const at = src.indexOf(cond);
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return '';
}

/** 某個位置的大括號巢狀深度(0 = 不在任何 @media 內)。 */
function depthAt(src: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
  }
  return depth;
}

const TABLET = '@media (min-width: 600px) and (max-width: 1079px)';
const CART = readFileSync(new URL('./cart.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const LAYOUT_CSS_IMPORTS = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8')
  .split('\n')
  .map((l) => /^\s*import\s+'\.\.\/styles\/([\w.-]+\.css)'\s*;/.exec(l)?.[1])
  .filter((f): f is string => f !== undefined);

describe('第5批 · 平板段(600-1079px;搬 OD pcm-checkout.css:724-747)', () => {
  it('平板段存在,且把 900↓ 的手機值撈回中間值', () => {
    const seg = mediaBlock(CSS, TABLET);
    expect(seg, 'checkout.css 沒有平板段 ⇒ iPad 整頁吃 390px 的手機值').not.toBe('');
    expect(seg, '主標沒從手機的 28px 撈回').toMatch(/\.co-head h1\s*\{[^}]*font-size:\s*32px/);
    expect(seg, '步驟標沒從手機的 12px 撈回').toMatch(/\.co-step-label\s*\{[^}]*font-size:\s*14px/);
    expect(seg, '發票 tab 沒回到三欄並排').toMatch(
      /\.co-inv-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*1fr\)/,
    );
    expect(seg, '發票欄位沒回到兩欄').toMatch(/\.co-inv-grid\s*\{[^}]*1fr 1fr/);
    expect(seg, '信用卡列沒回到兩欄').toMatch(/\.co-card-row\s*\{[^}]*1fr 1fr/);
    expect(seg, 'TapPay 欄高沒放大到 48px').toMatch(/\.tpfield\s*\{[^}]*height:\s*48px/);
  });

  // 🔴 這條守的是「位置」,不是「值」。上面那條在平板段被搬到 720↓ 之前時**照樣全綠**,
  //    而視覺會靜默倒退成單欄(平板段與 720↓ 同 specificity、平手只看原始碼順序)。
  it('🔴 平板段的位置必須在 720↓ 與 600↓ 之後(順序即規格)', () => {
    const tablet = CSS.indexOf(TABLET);
    const b720 = CSS.indexOf('@media (max-width: 720px)');
    const b600 = CSS.indexOf('@media (max-width: 600px)');
    expect(b720, '找不到 720↓ 段 ⇒ 本條前提失效').toBeGreaterThan(-1);
    expect(b600, '找不到 600↓ 段 ⇒ 本條前提失效').toBeGreaterThan(-1);
    expect(tablet, '平板段被移到 720↓ 之前 ⇒ 620px 時發票區靜默塌回單欄').toBeGreaterThan(b720);
    expect(tablet, '平板段被移到 600↓ 之前 ⇒ 步驟列文字的覆寫關係反轉').toBeGreaterThan(b600);
  });

  // 搬死規則的症狀是「看起來有守到、實際什麼都沒發生」,下一個人會以為已經處理過了。
  it('🔴 設計稿那 2 條死規則沒有被一起搬進來(且它們仍然是死的)', () => {
    const seg = mediaBlock(CSS, TABLET);
    expect(seg, '.co-tp-ph 被搬進來了 —— 真站的 placeholder 是 TapPay iframe 自帶的').not.toMatch(
      /\.co-tp-ph\b/,
    );
    expect(seg, '.co-mobile-buybar-sub 被搬進來了 —— R1 U4 的 markup 還沒做').not.toMatch(
      /\.co-mobile-buybar-sub\b/,
    );
    // 前提:兩個 class 在真站 markup 仍是 0 命中。哪天 U4/U3 把 markup 做出來了,
    // 這條會紅 —— 那就是「回來把這兩條規則補進平板段」的提醒,而不是靜默少兩條。
    const buybar = readFileSync(new URL('../components/CheckoutMobileBuybar.tsx', import.meta.url), 'utf8');
    const tp = readFileSync(new URL('../components/TapPayCardFields.tsx', import.meta.url), 'utf8');
    expect(
      buybar,
      'U4 底欄副標的 markup 做出來了 ⇒ ①刪掉本斷言與上面那條 not-in-segment ②把 .co-mobile-buybar-sub 的兩條規則補進平板段與手機段 ③**回 checkout.css 手機段重量頁尾讓位的 80px**(多一行會把 buybar 推高約 15px)',
    ).not.toContain('co-mobile-buybar-sub');
    expect(
      tp,
      'U3 卡欄 placeholder 的 markup 做出來了 ⇒ 刪掉本斷言與上面那條 not-in-segment、把 .co-tp-ph 的規則補進平板段(不是刪 CSS 規則)',
    ).not.toContain('co-tp-ph');
  });
});

describe('第5批 · 結帳主 CTA 熔橘(交接單 §五 驗收 #3)', () => {
  // 🔴 R1 F2:`:disabled` 這條**不能指望 `.btn-primary`** —— 全樹 `btn-primary:disabled`
  //    零命中(設計稿有、真站 cart.css 從來沒有)。翻成熔橘之後,一顆滿飽和卻按不下去的
  //    「確認付款」在付款頁上誤導更強,所以照設計稿字面補在這裡並釘住。
  it('四顆主 CTA 的底色 / hover / disabled 三態齊備', () => {
    expect(CSS, '主 CTA 沒熔橘化 ⇒ 驗收 #3 FAIL').toMatch(
      /\.co-btn-next,\s*\.co-btn-pay,\s*\.co-mobile-buybar-btn\s*\{[^}]*background:\s*var\(--c-red\)/,
    );
    expect(CSS, '停用態沒有降透明 ⇒ 付款頁上按不下去的鈕看起來和可按的一模一樣').toMatch(
      /\.co-btn-next:disabled,\s*\.co-btn-pay:disabled,\s*\.co-mobile-buybar-btn:disabled\s*\{[^}]*opacity:\s*0\.5[^}]*cursor:\s*not-allowed/,
    );
    // R2 nit:F4 的 transition 原本零守門(刪掉全綠) —— 一起釘進來。
    expect(CSS, '主 CTA 的 background transition 被拿掉 ⇒ hover 變硬切').toMatch(
      /\.co-btn-next,\s*\.co-btn-pay,\s*\.co-mobile-buybar-btn\s*\{[^}]*transition:\s*background 0\.2s/,
    );
    expect(CSS, 'hover 沒跟著走深熔橘 ⇒ hover 時反而變亮').toMatch(
      /\.co-btn-next:hover,\s*\.co-btn-pay:hover,\s*\.co-mobile-buybar-btn:hover\s*\{[^}]*background:\s*var\(--c-red-dark\)/,
    );
  });

  // 🔴 兩個前提:白字與 disabled 都沒有在這裡重複宣告,完全倚賴 .btn-primary。
  it('前提① — cart.css 的 .btn-primary 仍是墨黑,且白字仍由它提供', () => {
    const rule = CART.match(/\.btn-primary\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule, '.btn-primary 已被全域熔橘化 ⇒ 這裡四條變成重複宣告,且購物車空車鈕被連坐').toMatch(
      /background:\s*var\(--c-text\)/,
    );
    // 🔴 2026-08-09 Q4=B:白字改由 `var(--c-text-inverse)` 提供(底色是 `var(--c-text)`、
    //    兩顆是 token 表裡唯一的反相配對,深色模式要一起翻才不會變成白底白字)。
    //    本條守的是「**白字還在**」、不是「白字用 # 開頭寫」⇒ 兩種寫法都收,
    //    但**不收第三種顏色**:有人把它改成墨黑/熔橘,這裡照樣紅。
    expect(rule, '.btn-primary 不再提供白字 ⇒ 四顆主 CTA 會變成熔橘底配深色字').toMatch(
      /color:\s*(#fff\b|var\(\s*--c-text-inverse\s*\))/i,
    );
  });

  it('前提② — layout.tsx 的 import 序:checkout.css 必須晚於 cart.css', () => {
    // 兩邊同為 (0,1,0),平手時後載勝。有人重排 import = 四顆 CTA 靜默變回墨黑,而值斷言照樣全綠。
    const cart = LAYOUT_CSS_IMPORTS.indexOf('cart.css');
    const checkout = LAYOUT_CSS_IMPORTS.indexOf('checkout.css');
    expect(cart, 'layout.tsx 抽不到 cart.css 的 import 陳述').toBeGreaterThan(-1);
    expect(checkout, 'layout.tsx 抽不到 checkout.css 的 import 陳述').toBeGreaterThan(-1);
    expect(checkout, 'checkout.css 被排到 cart.css 前面 ⇒ 墨黑會蓋掉四顆主 CTA 的熔橘').toBeGreaterThan(
      cart,
    );
  });
});

describe('第5批 · TapPay 欄框線(R1 U3)', () => {
  it('.tpfield 框線是 --c-border-strong(不是旁邊文字框的 --c-border)', () => {
    const rule = CSS.match(/\.tpfield\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule, '.tpfield 框線退回 --c-border ⇒ iframe 容器沒有游標也沒有 placeholder,淡到看不出要填').toMatch(
      /border:\s*1px solid var\(--c-border-strong\)/,
    );
    expect(rule).not.toMatch(/border:\s*1px solid var\(--c-border\)/);
  });
});

describe('第5批 · TabBar 讓位 padding 歸零(Q5=A 的另一半)', () => {
  // 🔴 R1 F3:初版這裡**只比對選擇器字面、從沒斷言宣告值** —— 把 `padding-bottom: 0`
  //    改成 `70px` 跑全套是 15/15 全綠(實測)。整條規則的目的(歸零)零守門。
  //    這是本片家族第二次寫出恆真斷言(前一次是 products-mobile 的 N2),
  //    共同形狀都是「守門檢查了規則的**存在**,沒檢查規則**做了什麼**」。
  it('兩條選擇器都在,且值真的是 0(只寫一條會被 html[data-mobile] 那條的 (0,1,2) 蓋掉)', () => {
    expect(CSS, '歸零規則的選擇器或值不對').toMatch(
      /body:has\(\.co-page\),\s*html\[data-mobile="true"\] body:has\(\.co-page\)\s*\{[^}]*padding-bottom:\s*0\s*;/,
    );
    expect(CSS, '缺 data-mobile 兜底那一路的歸零 ⇒ 真手機上整條失效').toMatch(
      /html\[data-mobile="true"\] body:has\(\.co-page\)/,
    );
  });

  // 🔴 R1 F1(Critical):歸零不能歸過頭 —— 頁尾是 `</main>` 的**後兄弟**,
  //    `.co-main { padding-bottom: 120px }` 保護不到它,而 ≤900px 的 buybar 是 fixed。
  it('🔴 有 buybar 的那個畫面必須把頁尾讓位補回來(否則版權列壓在 fixed buybar 底下)', () => {
    const seg = mediaBlock(CSS, '@media (max-width: 900px)');
    expect(seg, '900↓ 段找不到 ⇒ 前提失效').not.toBe('');
    expect(seg, 'buybar 畫面的頁尾讓位沒補回來').toMatch(
      /body:has\(\.co-mobile-buybar\),\s*html\[data-mobile="true"\] body:has\(\.co-mobile-buybar\)\s*\{[^}]*padding-bottom:\s*calc\(80px \+ env\(safe-area-inset-bottom\)\)/,
    );
    // 條件必須是 buybar 而不是 .co-page:另外三個結帳畫面沒有 buybar,補回去就變成死空間。
    expect(seg, '讓位條件寫成 .co-page ⇒ Success/Redirecting/CartNotice 又長回死空間').not.toMatch(
      /body:has\(\.co-page\)[^}]*padding-bottom:\s*calc/,
    );
  });

  // 🔴 coming-soon 那輪 R1 抓到的洞,原樣適用:包進 @media 只擋得住兩個來源之一。
  it('🔴 歸零規則不得被包進任何 @media(第二個來源沒有 media query)', () => {
    const at = CSS.indexOf('body:has(.co-page)');
    expect(at, '找不到歸零規則').toBeGreaterThan(-1);
    expect(
      depthAt(CSS, at),
      '歸零規則被包進 @media ⇒ 手機 UA 但 viewport ≥1080px 時死空間原樣回來',
    ).toBe(0);
  });
});
