// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// 🔴 與 `orders-status-visibility-browser.test.tsx` 同因:本檔渲染真元件, 而真元件載入
//    `@/lib/session/session`(帶 `import 'server-only'`)⇒ 不 mock 的話整檔紅。逐檔 mock = 本 repo 既有處置。
vi.mock('server-only', () => ({}));
import { renderToStaticMarkup } from 'react-dom/server';
import { requireFreshBuild } from '@/lib/build-stamp';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { serveHtmlAndVisit } from '@/lib/test-support/serve-html-and-visit';
import { RealIdentityWarning } from './real-identity-warning';

// real-identity-warning-browser.test.tsx — ⟦b4-MGRENV1⟧ 那一列**自己列的缺口①**。
//
// 🔴🔴 **這一格補的是【那一列自己寫下來說它答不出來】的東西**
//    `real-identity-warning.tsx` 檔頭逐字:「**祖先把它藏起來, 本檔的守門看不到**(codex R2):
//    測試只驗這個元件自己沒有 `hidden`;有人在 layout 外包一層 `hidden` 或 `display:none`,
//    **11 格照樣全綠而畫面上什麼都沒有**。⇒ 那要真瀏覽器量, 不是單元測試的射程。」
//
// 🔬 **我複驗過那句成立, 不是照抄**:`real-identity-warning.test.tsx:108-111` 三行斷言的受詞
//    都是**元件自己**(`el?.hasAttribute('hidden')` / `el?.className` 兩條)
//    ⇒ 祖先上的 `hidden` 對那三行**零判別力**。
//    而全 admin 用 `chromium` 的測試檔裡, 提到 `real-identity` 的 = **0 支**(2026-09-07 量;
//    repo 有 14 支 chromium 測試檔當先例 ⇒ 那個 0 不是尺壞了)。
//
// 🛑 **這一格【不會】關掉 ⟦b4-MGRENV1⟧**。那一列轉 `done` 的條件逐字是
//    「那個放行**真的被擋住**(而不是只有人看得到)」—— 那是動授權路徑, 屬 B7 權限題。
//    **本檔只保證:它出聲的時候, 人真的看得見。**
//
// 🔴🔴 **CSS 從哪來 —— 這是本檔判別力的全部來源**
//    量 computed style 而餵無樣式的 DOM = 恆綠(那個 div 預設就可見)。所以本檔吃 `.next` 裡
//    **編譯後的真 CSS**。⚠️ 檔名是 build 產生的雜湊、會變 ⇒ 動態掃, 不寫死。
//    🔴 **找不到就【紅】, 不是 skip** —— 「沒有 CSS 所以跳過」與「CSS 正常所以通過」在報表上長得一樣。

/** 掃 `.next` 找那支含本元件用到的 Tailwind 規則的編譯後 CSS。找不到 ⇒ throw(整檔紅)。 */
function findCompiledCss(): string {
  // 🔴 `next build` 可以 rc=1 而照樣寫出產物 ⇒「產物存在」在【成功】與【失敗但寫了一半】
  //    兩個世界印同一個綠。`requireFreshBuild()` 是那道戳記閘(單一權威在 `@/lib/build-stamp`)。
  requireFreshBuild();
  const roots = [join(__dirname, '../../../.next')];
  const hits: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full, depth + 1);
      else if (name.endsWith('.css')) hits.push(full);
    }
  };
  for (const r of roots) walk(r, 0);
  for (const f of hits) {
    const css = readFileSync(f, 'utf8');
    // 🔴🔴 **標記要帶 `{` —— 我第一版寫 `css.includes('mx-4')` 而它配到了【不是規則】的東西**:
    //    那支 `globals_*.css` 的 `.mx-4{` 實數 = **0**, 而裸字串 `mx-4` 命中 1
    //    ⇒ 我挑中了一支沒有那條規則的檔, 三格當場紅在 `marginLeft = 0px`。
    //    📌 **一個裸字串在【規則存在】與【只是被提到】兩個世界印同一個 1。**
    //    ✅ 2026-09-07 逐支實測(`grep -c`):`3eg5slv6odht7.css` ⇒ `.mx-4{`=1 · `.text-amber-700{`=1
    //       · `--spacing:`=1;其餘 6 支大於 20k 的 CSS 三項全 0(負對照 `zzz-no-class` = 0)。
    if (css.includes('.text-amber-700{') && css.includes('.mx-4{') && css.includes('--spacing:'))
      return css;
  }
  throw new Error(
    `找不到同時含 .text-amber-700{ / .mx-4{ / --spacing: 的編譯後 CSS(掃到 ${hits.length} 支 .css)。` +
      `本檔量的是真瀏覽器 computed style,沒有真 CSS 就沒有判別力 ⇒ 這裡刻意【紅】而不是 skip。` +
      `修法:先跑 TURBO_FORCE=1 pnpm build,或只建這個 app:pnpm --filter @pcm/admin build。`,
  );
}

let browser: Browser;
let compiledCss: string;
beforeAll(async () => {
  compiledCss = findCompiledCss();
  browser = await chromium.launch();
}, 120_000);
// 🔴 `afterAll` 的 timeout 要跟 `beforeAll` 一樣長 —— 不對稱會在機器忙的時候變成
//    「檔案紅、零個測試紅」的收尾逾時, 而且重跑就綠 ⇒ 最容易被誤記成 flake。
//    (2026-09-07 同一夜在 repo 裡修掉同型的第四、五支。)
afterAll(async () => {
  await browser?.close();
}, 120_000);

/**
 * 把 `RealIdentityWarning` 渲染進一個【有祖先】的殼裡, 掛真編譯 CSS, 量它在瀏覽器裡的樣子。
 *
 * @param ancestorAttrs 加在**祖先**上的屬性 —— 這就是本檔存在的理由:
 *   單元測試那三行只看元件自己, 而真正會發生的事是有人在 layout 的外層包一件東西。
 * @param extraCss 追加樣式 —— 量具自檢用。
 */
async function measureWarning(
  ancestorAttrs = '',
  extraCss = '',
): Promise<{
  display: string;
  visibility: string;
  width: number;
  height: number;
  rendered: boolean;
} | null> {
  // 🔴 元件有兩道 early return ⇒ 不設這兩顆 env 它回 `null`, 而**空的 DOM 會讓本檔恆綠**。
  //    `resolveEnvTag()` 走白名單(`VERCEL_ENV` 認得出來才回值);`requireRealIdentity()` 是 `=== '1'`。
  process.env.VERCEL_ENV = 'production';
  delete process.env.ADMIN_REQUIRE_REAL_IDENTITY;
  const html = renderToStaticMarkup(<RealIdentityWarning />);
  const doc =
    `<html><head><style>${compiledCss}\n${extraCss}</style></head>` +
    `<body><div id='shell' ${ancestorAttrs}>${html}</div></body></html>`;
  return await serveHtmlAndVisit(
    browser,
    doc,
    async (page) =>
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="real-identity-warning"]');
        if (!el) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        // 🔴🔴 **`getComputedStyle(子孫).display` 量不到「祖先 display:none」** ——
        //    它回的是那個元素【自己】的 display(仍是 `block`), 不是「它有沒有被渲染」。
        //    ⇒ 我第一版就是這樣寫的, 而兩格缺口測試當場紅在 `expected 'block' to be 'none'`
        //    ⇒ 📌 **那個紅是對的:它在說我的尺量錯了東西, 不是說碼壞了。**
        //    ✅ 會跨祖先的量法:`checkVisibility()`(瀏覽器自己走整條鏈)+ 尺寸為 0。
        const rendered =
          typeof el.checkVisibility === 'function' ? el.checkVisibility() : r.width > 0;
        return {
          display: cs.display,
          visibility: cs.visibility,
          width: r.width,
          height: r.height,
          rendered,
        };
      }),
    { label: 'real-identity-warning-browser' },
  );
}

describe('⟦b4-MGRENV1⟧ 缺口① — 那條警示在真瀏覽器裡看得見', () => {
  it('🟢 正對照:祖先乾淨時, 警示帶 computed style 可見且有尺寸', async () => {
    const m = await measureWarning();
    expect(m, '渲染不出那個元素 ⇒ 兩道 early return 有一道踩到了, 不是「它被藏起來」').not.toBeNull();
    expect(m?.rendered, 'checkVisibility() 說它沒被渲染出來').toBe(true);
    expect(m?.display).not.toBe('none');
    expect(m?.visibility).not.toBe('hidden');
    expect(m?.width).toBeGreaterThan(0);
    expect(m?.height).toBeGreaterThan(0);
  }, 60_000);

  /**
   * 🔴🔴 **這一格就是那個缺口本身 —— 也是本檔唯一的存在理由。**
   * 祖先帶 `hidden` ⇒ 單元測試那三行**一格都不會紅**(它們的受詞是元件自己),
   * 而這把尺必須當場讀到它不見了。
   */
  it('🔴 缺口①:祖先包一層 hidden ⇒ 這把尺【要量得到】它不見了', async () => {
    const m = await measureWarning('hidden');
    expect(m).not.toBeNull();
    expect(m?.rendered, '祖先 hidden 而尺仍說可見 ⇒ 這把尺量不到那個世界, 等於沒有守門').toBe(false);
    expect(m?.width, '被藏起來的東西不該有寬度').toBe(0);
  }, 60_000);

  it('🔴 缺口①(另一種形狀):祖先 display:none ⇒ 一樣要量得到', async () => {
    const m = await measureWarning("id='shell'", '#shell{display:none}');
    expect(m).not.toBeNull();
    expect(m?.rendered).toBe(false);
    expect(m?.width).toBe(0);
  }, 60_000);

  /**
   * 🔬 **證明「真 CSS 真的載進去了」** —— 沒有這一格, 上面三格在「CSS 沒載到」的世界也會通過
   * (那個 div 裸著也是可見的)⇒ 正對照會變成恆真格。
   */
  it('🔬 自檢:編譯後 CSS 真的生效(`mx-4` 的左右外距不是 0)', async () => {
    process.env.VERCEL_ENV = 'production';
    delete process.env.ADMIN_REQUIRE_REAL_IDENTITY;
    const html = renderToStaticMarkup(<RealIdentityWarning />);
    const doc = `<html><head><style>${compiledCss}</style></head><body>${html}</body></html>`;
    const margin = await serveHtmlAndVisit(
      browser,
      doc,
      async (page) =>
        await page.evaluate(() => {
          const el = document.querySelector('[data-testid="real-identity-warning"]');
          return el ? getComputedStyle(el).marginLeft : null;
        }),
      { label: 'real-identity-warning-browser:css-loaded' },
    );
    expect(margin, 'marginLeft 是 0px ⇒ Tailwind 那份 CSS 沒有生效 ⇒ 上面三格沒有判別力').not.toBe(
      '0px',
    );
  }, 60_000);
});
