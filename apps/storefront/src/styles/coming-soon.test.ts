// coming-soon.test.ts — 「即將上線」三條路由的文字層守門(全站重設計 第2批;2026-08-06)
//
// 🔴 **這支存在的理由**:這一頁的視覺幾乎全由「幾個彼此獨立、單看都不起眼的值」撐起來 ——
//    純黑底、opacity 0.09-0.26、grayscale、radial 遮罩。設計端 §四 逐字:「四個手段疊起來,
//    少一個就會變成普通的 logo 列」。任一個被改掉都不會有測試紅,而症狀是「看起來還行,
//    但不對了」—— 那種東西沒人會回報。
//
// ⚠️ **它擋不住什麼**:文字層看不到 cascade 的實際勝負,也看不到動畫真的在跑。
//    本片實測到的兩個 bug(手機底部 70px 白條、頁尾少一欄)**文字層與三綠全都是綠的**,
//    是真瀏覽器量出來的 —— 那兩個修法的守門寫在下面,但它們的「被發現」不歸這支。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const CSS = strip(read('coming-soon.css'));
const AUTH = strip(read('auth.css'));
const PAGE_SITEWIDE = read('../app/coming-soon/page.tsx');
const PAGE_STORES = read('../app/stores/page.tsx');
const PAGE_INSTALL = read('../app/install/page.tsx');
const PAGE_LOGOUT = read('../app/logout/page.tsx');

function block(src: string, selector: string): string {
  const i = src.indexOf(selector);
  expect(i, `找不到選擇器 ${selector}(被改名或刪了?)`).toBeGreaterThan(-1);
  const open = src.indexOf('{', i);
  const close = src.indexOf('}', open);
  expect(close, `${selector} 區塊沒有閉合`).toBeGreaterThan(open);
  const body = src.slice(open + 1, close);
  expect(body, `${selector} 區塊內出現巢狀 {(平規則前提已失效)`).not.toMatch(/\{/);
  return body;
}

describe('第2批 · 「隱隱約約」的四個手段(少一個就變成普通 logo 列)', () => {
  it('🔴 ① 極低透明度 + ③ 錯落呼吸:基礎 0.14、區間 0.09 → 0.26', () => {
    const img = block(CSS, '.cs-wall img');
    expect(img, 'logo 牆的基礎透明度不是 0.14').toMatch(/opacity:\s*0\.14\b/);
    expect(img, 'logo 牆沒有掛呼吸動畫').toMatch(/animation:\s*cs-breathe\s+14s/);
    // keyframes 的兩端是「隱隱約約」的實際定義 —— 把 0.09/0.26 拉高就變成普通的 logo 列。
    const kf = CSS.slice(CSS.indexOf('@keyframes cs-breathe'));
    expect(kf.slice(0, 200), '呼吸的下限不是 0.09').toMatch(/0%,\s*100%\s*\{\s*opacity:\s*0\.09/);
    expect(kf.slice(0, 200), '呼吸的上限不是 0.26').toMatch(/50%\s*\{\s*opacity:\s*0\.26/);
  });

  it('🔴 ② 去彩:grayscale(1),不讓任何品牌色跳出來搶主標', () => {
    expect(block(CSS, '.cs-wall img'), 'logo 牆沒有去彩 ⇒ 20 個品牌色會一起跳出來').toMatch(
      /filter:\s*grayscale\(1\)/,
    );
  });

  it('🔴 ④ 四周遮罩淡出:radial mask,而且 `-webkit-` 前綴版**兩條都要在**', () => {
    const wall = block(CSS, '.cs-wall');
    expect(wall, '牆沒有 mask ⇒ 會看到一個方形邊界').toMatch(/[^-]mask-image:\s*radial-gradient/);
    // Safari 直到近期仍只認前綴版;只留無前綴的那條 = 在 Sean 的 Mac 上看得到方框。
    expect(wall, '少了 -webkit-mask-image ⇒ Safari 會看到方形邊界').toMatch(
      /-webkit-mask-image:\s*radial-gradient/,
    );
  });

  it('🔴 五種 animation-delay 相位齊全(少一種 ⇒ 那一欄同步閃、看起來像壞掉)', () => {
    for (let n = 1; n <= 5; n++) {
      expect(CSS, `少了 nth-child(5n + ${n}) 的相位`).toMatch(
        new RegExp(`\\.cs-wall img:nth-child\\(5n \\+ ${n}\\)`),
      );
    }
  });

  it('🔴 減少動態效果時:不呼吸、固定 0.16(不是變成完全看不見或全亮)', () => {
    const rm = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm, 'reduced-motion 沒關掉呼吸').toMatch(/\.cs-wall img\s*\{[^}]*animation:\s*none/);
    expect(rm, 'reduced-motion 的固定亮度不是 0.16').toMatch(/\.cs-wall img\s*\{[^}]*opacity:\s*0\.16/);
  });
});

describe('第2批 · 底色必須是純黑(設計端實測踩過的坑)', () => {
  it('🔴 .cs-page 的底是 #000,不是石墨', () => {
    const page = block(CSS, '.cs-page {');
    expect(page, '純黑 token 不見了').toMatch(/--cs-ink:\s*#000\b/);
    expect(page, '.cs-page 沒吃 --cs-ink').toMatch(/background:\s*var\(--cs-ink\)/);
    // 反面:改成全站的石墨 / 深底 token。底色差一階,logo 牆那層灰就會浮出一片濁色。
    expect(page, '底色被改成站台的深色 token ⇒ logo 牆會浮出濁色方塊').not.toMatch(
      /background:\s*var\(--c-(bg|surface|text)\)/,
    );
  });

  it('🔴 熔橘吃站台 token(不是再寫死一次 #f26722)', () => {
    const page = block(CSS, '.cs-page {');
    expect(page, '熔橘沒接站台 --c-red ⇒ 換色時這頁會被漏掉').toMatch(
      /--cs-ember:\s*var\(--c-red\)/,
    );
    expect(page, '深熔橘沒接站台 --c-red-dark').toMatch(/--cs-ember-ink:\s*var\(--c-red-dark\)/);
  });

  it('🔴 色票 scope 在 .cs-page、不進 :root(通用字名進全站語彙會撞名)', () => {
    expect(CSS, 'coming-soon.css 出現 :root ⇒ --cs-ink/--cs-line 這種通用名進了全站語彙')
      .not.toMatch(/:root\s*\{/);
  });
});

describe('第2批 · 手機底部那 70px 白條(真瀏覽器實測抓到的)', () => {
  // `mobile-tabbar.css` 在 ≤1079px 給 body 加 padding-bottom 讓位給固定 TabBar;
  // 整站版把 TabBar 藏了 ⇒ 那段 padding 變死空間,而 .cs-page 純黑、body 白 ⇒ 露出白條。
  it('🔴 整站版(無天地)把 body 的讓位 padding 歸零', () => {
    expect(CSS, '少了 body padding 歸零 ⇒ 手機版純黑頁底部會露出 70px 白條').toMatch(
      /body:has\(\.cs-page:not\(\.cs-has-nav\)\)\s*\{\s*padding-bottom:\s*0/,
    );
  });

  it('🔴 前提 — 那段 padding 真的存在於 mobile-tabbar.css(前提沒了,上面那條就是無用的死規則)', () => {
    // 🔴 R1 抓到:讓位 padding **有兩個來源**,初版只斷言了 @media 那一條 ⇒ 前提被子集滿足。
    //    (刪掉 @media 那條、留下 data-mobile 那條:測試轉紅但結論「歸零可以刪」是錯的;
    //     反過來刪 data-mobile 那條則完全靜默。)兩條都要在。
    const tabbar = strip(read('mobile-tabbar.css'));
    expect(tabbar, '@media 版的 body padding 不見了').toMatch(
      /@media \(max-width:\s*1079px\)[\s\S]*?body\s*\{[^}]*padding-bottom:\s*calc\(70px/,
    );
    expect(tabbar, '[data-mobile] 版的 body padding 不見了(它沒有 media query、全寬度生效)').toMatch(
      /\[data-mobile="true"\]\s*body\s*\{[^}]*padding-bottom:\s*calc\(70px/,
    );
  });

  it('🔴 歸零那條**不得**包在 @media 裡(另一個 padding 來源沒有 media query)', () => {
    // 手機 UA + viewport >=1080px(Android 平板橫放)時,`html[data-mobile="true"] body` 那條
    // 照樣生效 ⇒ 把歸零包進 @media (max-width:1079px) 會讓白條在那個組合原樣回來。
    const i = CSS.indexOf('body:has(.cs-page:not(.cs-has-nav))');
    expect(i, '找不到歸零那條').toBeGreaterThan(-1);
    // 往前找最近的 `{`,確認它不是某個 @media 的內部。
    const before = CSS.slice(0, i);
    const opens = (before.match(/\{/g) ?? []).length;
    const closes = (before.match(/\}/g) ?? []).length;
    expect(opens, '歸零那條被包在一層 @media 裡 ⇒ 手機 UA + 寬視窗時白條會回來').toBe(closes);
  });

  it('🔴 反面 — 歸零**只**套在沒有天地的變體;/stores /install 有 TabBar、padding 要留著', () => {
    const m = /body:has\(([^)]*\)[^{]*)\)\s*\{\s*padding-bottom:\s*0/.exec(CSS);
    expect(m?.[1], '歸零的條件不再排除 .cs-has-nav ⇒ /stores /install 的 TabBar 會蓋住頁尾').toContain(
      ':not(.cs-has-nav)',
    );
  });
});

describe('第2批 · 頁尾只能有一個(R1 抓到的 must-fix)', () => {
  // 第一版:`<ComingSoon>` 內部**無條件**渲染自己的頁尾,而 `/stores` `/install` 又 import
  // 了 `<HomeFooter>` ⇒ 門市地址 / 營業時間 / 社群 / 版權列 / 統編**各出現兩次**
  // (真瀏覽器 innerText count 實測 = 2)。文字層、三綠、43 測全綠時它就在那裡。
  it('🔴 元件的頁尾包在 !hasNav 裡(有天地時交給頁面自己的 HomeFooter)', () => {
    const src = read('../components/ComingSoon.tsx');
    // `.cs-foot` 與 `.cs-base` 都必須落在 `{!hasNav && (` 這個區塊內。
    const guard = src.indexOf('{!hasNav && (\n        <>');
    expect(guard, '找不到 !hasNav 的頁尾區塊 ⇒ 頁尾可能又變成無條件渲染').toBeGreaterThan(-1);
    expect(src.indexOf('className="cs-foot"'), '.cs-foot 排在 !hasNav 區塊之前 ⇒ 會渲染兩個頁尾')
      .toBeGreaterThan(guard);
    expect(src.indexOf('className="cs-base"'), '.cs-base 排在 !hasNav 區塊之前 ⇒ 版權列會出現兩次')
      .toBeGreaterThan(guard);
  });

  it('🔴 「快速前往」那一欄整個不存在(HomeFooter 的三欄已經涵蓋,而且更完整)', () => {
    const src = read('../components/ComingSoon.tsx');
    expect(src, '.cs-foot-nav 的 markup 又被搬回來了 ⇒ 那是重複頁尾的來源').not.toMatch(
      /className="[^"]*cs-foot-nav/,
    );
    // CSS 側:跟著錯誤 markup 長出來的那兩條規則也不該復活(死規則會讓人以為那個欄還在用)。
    expect(CSS, 'coming-soon.css 又出現 .cs-foot-nav 的規則 ⇒ 死規則').not.toMatch(
      /^\.cs-foot-nav/m,
    );
    expect(CSS, '.cs-has-nav 的四欄格線又回來了 ⇒ 有天地時根本不渲染 .cs-foot').not.toMatch(
      /\.cs-has-nav \.cs-foot\s*\{/,
    );
  });

  // 🔴 2026-08-09 單位更新(斷言跟著行為改、不是遷就實作):`.cs-page` 由 `100vh` 改 `100svh`。
  //    **意圖沒變** —— 整站版仍然「滿一個視窗高」;變的是用哪個視窗高度。
  //    iOS 的 `100vh` 是工具列**收起時**的高度,工具列露出時會多撐一段空白
  //    (本檔下方那條 `.cs-has-nav { min-height: 0 }` 的註解描述的就是同一個機制的另一半)。
  //    斷言改成釘 `100svh`(更緊、不是放寬):寫回 `100vh` 一樣會紅。詳 `viewport-units.test.ts`。
  it('🔴 有天地時不吃滿版高(否則 Header + 滿版 + HomeFooter 一定多出一段捲動)', () => {
    expect(CSS, '.cs-has-nav 沒把 min-height 收掉').toMatch(/\.cs-has-nav\s*\{\s*min-height:\s*0/);
    expect(block(CSS, '.cs-page {'), '整站版不再是滿版 ⇒ 它真的是整頁,滿版高要留著').toMatch(
      /min-height:\s*100svh/,
    );
  });
});

describe('第2批 · 三條路由各自的殼與 robots(整站版 vs 站內頁的分岔)', () => {
  it('🔴 整站版**不** import Header / HomeFooter(本站的殼是逐頁 import,不 import 就真的沒有)', () => {
    expect(PAGE_SITEWIDE, '/coming-soon import 了 Header ⇒ 整站上線前會出現點了 404 的導航').not.toMatch(
      /from '@\/components\/(Header|HomeFooter)'/,
    );
  });

  it('🔴 整站版必須顯式 hasNav={false}(這是 M12 的鏡像面 —— 我只補了 /stores 那一半)', () => {
    // 把這行改成 shorthand `hasNav` ⇒ 驗收 #14(整站版不得有站內連結)、#15(不重複大 logo)、
    // 以及 `body:has(:not(.cs-has-nav))` 的白條修法**三條一起失效**,而原本沒有任何測試會紅。
    expect(PAGE_SITEWIDE, '/coming-soon 的 hasNav 不是顯式 false').toMatch(/hasNav\s*=\s*\{false\}/);
    expect(PAGE_SITEWIDE, '/coming-soon 用了 shorthand hasNav(= true)⇒ 整站上線前會冒出站內連結')
      .not.toMatch(/\n\s*hasNav\s*\n/);
  });

  it.each([
    ['/stores', PAGE_STORES],
    ['/install', PAGE_INSTALL],
  ])('🔴 %s **要** import Header + HomeFooter(站內頁保留天地,不然客人回不去)', (_route, src) => {
    expect(src, '少了 Header').toMatch(/import \{ Header \} from '@\/components\/Header'/);
    expect(src, '少了 HomeFooter').toMatch(/import \{ HomeFooter \} from '@\/components\/HomeFooter'/);
    // 🔴 初版寫成 `toMatch(/hasNav\b/)`,而突變實測:把這裡改成 `hasNav={false}`,**43 測全綠**。
    //    「字串出現過」不等於「值是真的」—— 這是我自己犯的「斷言量錯東西」。
    //    改成兩面都釘:必須是 shorthand(或顯式 true),而且明確不得是 false。
    expect(src, '沒有把 hasNav 打開 ⇒ 頁尾少一欄、主區會多一顆與頂欄重複的大 logo').toMatch(
      /\n\s*hasNav(\s*=\s*\{true\})?\s*\n/,
    );
    expect(src, 'hasNav 被接成 false ⇒ 這是站內頁,天地不能拿掉').not.toMatch(
      /hasNav\s*=\s*\{false\}/,
    );
  });

  it('🔴 robots:整站版 noindex、兩個功能版都不要(設計端 §三「兩個 meta 差異(容易漏)」)', () => {
    expect(PAGE_SITEWIDE, '/coming-soon 少了 noindex ⇒ 會被收錄成 PCM 的正式內容').toMatch(
      /robots:\s*\{\s*index:\s*false/,
    );
    for (const [route, src] of [
      ['/stores', PAGE_STORES],
      ['/install', PAGE_INSTALL],
    ] as const) {
      // ⚠️ 只掃 metadata 物件、不掃註解:`stores/page.tsx` 檔頭那段講「不 noindex」的說明
      //    只要哪天寫成 `robots:` 就會假紅(與下面對 import 行過濾的紀律一致)。
      const meta = /export const metadata: Metadata = \{([\s\S]*?)\n\};/.exec(src)?.[1] ?? '';
      expect(meta.length, `${route} 抽不到 metadata 物件 ⇒ 本條前提失效`).toBeGreaterThan(0);
      expect(meta, `${route} 沿用了整站版的 noindex ⇒ 站內頁不該被擋索引`).not.toMatch(/robots:/);
    }
  });

  it('🔴 沒有編造任何金額 / 電話 / 店名(待補資料 Sean 還沒給)', () => {
    for (const [route, src] of [
      ['/stores', PAGE_STORES],
      ['/install', PAGE_INSTALL],
    ] as const) {
      expect(src, `${route} 出現了金額字面 ⇒ 工時費率沒有任何來源`).not.toMatch(/\d\s*元|NT\$|\$\s?\d/);
      expect(src, `${route} 出現了電話號碼`).not.toMatch(/0\d{1,3}-\d{3,4}-\d{3,4}/);
    }
  });
});

describe('第2批 · /logout 道別頁(2026-08-18 已接線,見本 describe 最後一格)', () => {
  it('🔴 `.lo-*` 的響應式提權到 .auth-card.lo-card(裸 .lo-card 會被 [data-mobile] 兜底蓋掉)', () => {
    // `[data-mobile="true"] .auth-card`(0,2,0)贏過裸 `.lo-card`(0,1,0),**與順序無關** ⇒
    // 照設計稿字面搬,手機上的內距與標題字級會被靜默蓋掉。
    expect(AUTH, '平板段的 .lo-card 沒提權').toMatch(/\.auth-card\.lo-card\s*\{\s*padding:\s*44px/);
    expect(AUTH, '手機段的 .lo-card 沒提權').toMatch(/\.auth-card\.lo-card\s*\{\s*padding:\s*32px/);
    // 🔴 2026-08-09 H1=A:字級 24→22(工具級)。本條守的是**提權這件事**(測試名就這麼寫),
    //    字級的「值」現在由 `h1-scale.test.ts` 的三級守門擁有 —— 兩邊都釘同一個數字 =
    //    改一次拍板要改兩處、而且漏改哪一處都只有一半會紅。這裡放寬成「有提權 + 有宣告字級」,
    //    值多少交給那支專責的。
    expect(AUTH, '手機段的標題字級沒提權').toMatch(/\.auth-card\.lo-card h1\s*\{\s*font-size:\s*\d+px/);
  });

  it('🔴 前提 — 那組 [data-mobile] 兜底還在(它沒了,上面的提權就是多餘的複雜度)', () => {
    expect(AUTH, '[data-mobile] 的 .auth-card 兜底不見了 ⇒ 回頭把 .lo-card 的提權拆掉').toMatch(
      /\[data-mobile="true"\] \.auth-card\s*\{/,
    );
  });

  it('🔴 `.lo-*` 整組排在 auth.css 的手機覆寫**之後**(同 specificity 時靠順序取勝)', () => {
    expect(AUTH.indexOf('.lo-card'), 'auth.css 裡找不到 .lo-card').toBeGreaterThan(-1);
    expect(
      AUTH.indexOf('.lo-card'),
      '.lo-* 被移到 .auth-card 的手機覆寫之前 ⇒ 手機版的卡片內距會被蓋掉',
    ).toBeGreaterThan(AUTH.indexOf('[data-mobile="true"] .auth-card'));
  });

  it('🔴 登出的 redirect 目的地是 `/logout` 道別頁(接線已完成、且不准被改回去)', () => {
    // 🔴 這一格【翻過面】(2026-08-18)。它原本釘的是「**沒有人可以在沒過對抗審查的情況下接線**」——
    //    它的紅**就是那張傳票**,不是「redirect 必須永遠是 /login」。傳票收到了、鐵則 12② 對抗審查
    //    跑完了、接線完成 ⇒ 它改守新的不變式:**目的地是 /logout**(有人改回 /login 或改到第三個地方會紅)。
    //    出處與身分見 `docs/specs/2026-08-18-g3-logout-wiring-plan.md` §2
    //    (「要接線」= Sean 2026-08-06 Q2=A;「現在做」= 主視窗代裁)。
    // 🔴 收割確認輪 MF1 的坑照舊防著:整檔比對會被**註解裡的字面**餵成恆真(改了真碼照樣綠)⇒
    //    先剝註解、再錨定「行首縮排 + 分號」的語句形。
    //    ⚠️ 接線那次檔頭改成了 `/** */` 區塊註解 —— 只剝 `//` 行【擋不住它】,故兩種註解都要剝。
    //    🔴 codex 關卡2 R1 nit:整檔剝註解仍可能誤刪(字串/template literal 裡的 `/*`)⇒
    //    再收斂一層:**只看 `logoutAction` 函式本體**。壞法「別的函式裡有 redirect('/logout')」
    //    現在也騙不過它。
    const wholeFile = read('../app/account/actions.ts');
    const fnStart = wholeFile.indexOf('export async function logoutAction');
    expect(fnStart, 'actions.ts 裡找不到 logoutAction ⇒ 它被改名或搬走了').toBeGreaterThan(-1);
    //    🔴 R2 抓到的靜默通過:`indexOf` 找不到結尾會回 `-1`,而 `slice(fnStart, -1)` **照樣切得出東西**
    //    ⇒ 只要後面別的地方有 `redirect('/logout')` 就會誤判通過。先斷言結尾在起點【之後】。
    const fnEnd = wholeFile.indexOf('\n}', fnStart);
    expect(fnEnd, 'logoutAction 找不到函式結尾 ⇒ 下面的切片會靜默吃到整支檔的後半').toBeGreaterThan(fnStart);
    const fnBody = wholeFile.slice(fnStart, fnEnd);
    const actions = fnBody
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l))
      .join('\n');
    expect(actions, 'logoutAction 沒有導到 /logout ⇒ 接線被改掉了').toMatch(
      /^\s*redirect\('\/logout'\);/m,
    );
    expect(actions, 'logoutAction 又導回 /login ⇒ 道別頁被繞過了(Sean 2026-08-06 Q2=A 要的是道別頁)').not.toMatch(
      /^\s*redirect\('\/login'\);/m,
    );
    // ⚠️ 對整支檔比 `/logoutAction/` 會命中**檔頭註解**(那裡逐字解釋了接線的出處)——
    //    第1批的 nit N8 是同一族的錯。只比 import 陳述,對註解免疫。
    //    道別頁自己**不該**再去呼叫登出 action(它是登出【之後】才到得了的頁,再登出一次是迴圈)。
    const imports = PAGE_LOGOUT.split('\n').filter((l) => /^\s*import\b/.test(l));
    expect(imports.join('\n'), '/logout 道別頁 import 了登出 server action ⇒ 它是登出後才到的頁,不該再登出一次').not.toMatch(
      /actions|logoutAction/,
    );
  });
});
