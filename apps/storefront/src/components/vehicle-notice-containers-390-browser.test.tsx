// @vitest-environment node
//
// vehicle-notice-containers-390-browser.test.tsx —— 板列 ⟦front-FULLPAGE390⟧。
//
// 🔴 **本檔補的是 `vehicle-notice-390-browser.test.tsx` 自己標出來的射程缺口**:
//    那支把 markup 放進一個 `width:390px` 的**裸 `div`** ⇒ 答的是「這句話自己會不會爆」,
//    **答不了「放進首頁那個 dock 裡會不會爆」**(祖先的 padding / flex 收縮 / cascade 都不在)。
//
// 🛑🛑 **本檔最大的弱點, 先講**:祖先鏈是我**照原始碼手抄的**, 不是真的把那四頁跑起來。
//    ⇒ 📌 **手抄的鏈會往我的結論漂** —— 所以下面每一條鏈都附**來源座標**,
//      而且有一格 `it` 專門去原始碼裡**驗那些 class 名今天還在**(鏈漂了它會紅)。
//    ⇒ 🔴 **它仍然答不了的**:祖先鏈上任何【不是 class 決定】的東西 ——
//      inline style、由 JS 算出來的寬度、以及**同層兄弟元素的 flex 競爭**(我只放通知這一個孩子)。
//
// ⚠️ **不決定性的【輸入】**(與 `statement-cascade-browser` 同一條):它讀**共用的** `.next` 產物
//    ⇒ 別的視窗同時 `pnpm build` 時腳下的 CSS 會變 ⇒ **紅要先問「剛剛有沒有人在 build」**,
//    連兩發同一格紅才當真。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, type Browser } from '@playwright/test';
import { VehicleTaxonomyNotice, TaxonomyNotice, CATEGORY_TAXONOMY_UNAVAILABLE } from './products-message-state';

const REPO = join(__dirname, '../../../..');
const CHUNKS = join(REPO, 'apps/storefront/.next/static/chunks');
const VIEWPORT = { width: 390, height: 844 }; // iPhone 12/13/14 直式

/** 編譯產物裡【全部】的 CSS 串起來。讀不到 ⇒ throw(不 skip、不 fallback 到原始檔)。 */
function compiledCss(): string {
  let files: string[];
  try {
    files = readdirSync(CHUNKS).filter((f) => f.endsWith('.css'));
  } catch {
    throw new Error(`讀不到 ${CHUNKS} —— 先跑 \`TURBO_FORCE=1 pnpm build\``);
  }
  if (files.length === 0) {
    throw new Error(`${CHUNKS} 裡零支 .css —— 先跑 \`TURBO_FORCE=1 pnpm build\``);
  }
  return files.map((f) => readFileSync(join(CHUNKS, f), 'utf8')).join('\n');
}

/**
 * 四個掛載點的祖先鏈(由外而內)。**每一條都附來源座標, 讓人可以自己核。**
 * 🔵 `catalog` 的鏈是**空的, 而那不是我漏抄** —— `ProductsPage.tsx:276` 的根是 `<>`(fragment),
 *    通知直接落在頁面層 ⇒ 它是四個裡唯一**沒有容器**的那個。
 */
const CONTAINERS = [
  { key: 'home-dock', chain: ['ed-page', 'b-hero', 'b-hero-inner', 'b-dock'],
    src: 'app/page.tsx:182,189 · HomeHero.tsx:119,154 · VehicleFinder.tsx:65,91' },
  { key: 'catalog', chain: [],
    src: 'ProductsPage.tsx:276(fragment 根), 281' },
  { key: 'pdp', chain: ['pcm-root', 'pd-page', 'pd-main'],
    src: 'ProductPage.tsx:230,233,239,256' },
  { key: 'cart', chain: ['ap-page', 'cart-main'],
    src: 'CartView.tsx:224,226,254' },
] as const;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
// 🔴 `afterAll` 也要 timeout —— 少了它會印 `Test Files N failed` 而 `Tests 0 failed`
//   (`vehicle-notice-390-browser.test.tsx` 檔頭記過那次:`Hook timed out in 10000ms`)。
afterAll(async () => {
  await browser?.close();
}, 60_000);

/** 把通知包進祖先鏈, 回傳量到的數字。 */
async function measure(chain: readonly string[], inner: string) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const open = chain.map((c) => `<div class="${c}">`).join('');
  const close = chain.map(() => '</div>').join('');
  await page.setContent(
    `<!doctype html><html><head><meta name="viewport" content="width=390"><style>${compiledCss()}</style></head>` +
      `<body>${open}<div id="probe">${inner}</div>${close}</body></html>`,
  );
  const out = await page.evaluate(() => {
    const el = document.getElementById('probe');
    if (!el) throw new Error('probe 不在 —— 這一發作廢, 不要讀下面的數字');
    const kid = el.firstElementChild as HTMLElement | null;
    return {
      available: Math.round(el.getBoundingClientRect().width),
      overflowPx: kid ? Math.round(kid.scrollWidth - kid.clientWidth) : -1,
      hasChild: kid !== null,
    };
  });
  await page.close();
  return out;
}

const NOTICE = renderToStaticMarkup(<VehicleTaxonomyNotice failed />);
// 🔵 不可斷行的長 ASCII = **正對照**(中日韓逐字可斷行 ⇒ 拿長中文當對照【紅不起來】;
//   那個坑寫在 `vehicle-notice-390-browser.test.tsx` 檔頭, 不在這裡重複)。
const UNBREAKABLE = renderToStaticMarkup(
  <TaxonomyNotice failed message={'A'.repeat(300)} />,
);

describe('⟦front-FULLPAGE390⟧ 四個真實容器在 390 寬底下的可用寬度', () => {
  it('🔬 量四個容器的可用寬度(這是開工第一動, 不是斷言)', async () => {
    const rows: string[] = [];
    for (const c of CONTAINERS) {
      const m = await measure(c.chain, NOTICE);
      rows.push(`${c.key.padEnd(10)} available=${m.available}px  overflow=${m.overflowPx}px  (${c.src})`);
      expect(m.hasChild, `${c.key}:通知沒渲染出來 ⇒ 這一發作廢`).toBe(true);
    }
    // 🔴 **印出來是本格的產出** —— 讓下一個人自己看到那四個數, 不必相信我的轉述。
    //   🛑 同時寫檔:vitest 把 `console.log` 吞掉時, 「量到了」與「沒量」印同一個畫面(空的)。
    console.log('\n' + rows.join('\n') + '\n');
    writeFileSync(join(REPO, 'apps/storefront/.next/container-widths-390.txt'), rows.join('\n') + '\n');
    expect(rows.length).toBe(4);
  }, 120_000);

  for (const c of CONTAINERS) {
    it(`🟢 ${c.key}:真的那句話放進真實祖先鏈【不得】水平溢出`, async () => {
      const m = await measure(c.chain, NOTICE);
      expect(m.available, `${c.key} 可用寬度是 0 ⇒ 鏈沒渲染, 這一格作廢`).toBeGreaterThan(0);
      expect(m.overflowPx, `${c.key} 溢出 ${m.overflowPx}px(可用 ${m.available}px)`).toBeLessThanOrEqual(0);
    }, 120_000);
  }

  it('🛑🛑 祖先鏈【真的有作用】—— 三個有容器的必須比 390 窄, 沒容器的必須剛好 390', async () => {
    // 🔴🔴 **這一格擋的是本檔最可能的恆綠形狀**:祖先鏈**整條**失效時,
    //   編譯 CSS 裡沒有任何對應規則 ⇒ 每個容器都量到 **390**(= 裸 body 寬)
    //   ⇒ 而 390 寬底下那句中文**永遠不會溢出** ⇒ 📌 **上面四格會【全綠】, 而它們什麼都沒量到。**
    //   ⇒ ⇒ 「祖先鏈生效了」與「祖先鏈整條失效」在那個世界裡印同一個畫面:一片綠。
    // 🛑🛑 **而【它抓不到「只錯一層」】—— 這是量到的, 不是我推的**(2026-09-07 兩發突變):
    //   · MU-1 只把 `b-dock` 改成 `b-dockX` ⇒ **本格照樣綠**(`.b-hero-inner` 自己就已經把寬度收掉了)
    //     ⇒ 紅的是下面那格**靜態 class 檢查**。
    //   · MU-2 整條鏈換成 `zzz*` ⇒ **本格紅**(`home-dock 量到 390px`)+ 正對照也紅。
    //   ⇒ 📌 **兩道各抓一半, 不可只留一道** —— 本格抓【整條死】, 靜態那格抓【一層漂】。
    for (const c of CONTAINERS) {
      const m = await measure(c.chain, NOTICE);
      if (c.chain.length === 0) {
        // catalog 是 fragment 根 ⇒ **它本來就沒有容器**, 剛好 390 是正確答案不是失效。
        expect(m.available, `${c.key} 應為裸頁寬 390`).toBe(VIEWPORT.width);
      } else {
        expect(m.available, `${c.key} 量到 ${m.available}px = 裸頁寬 ⇒ 祖先鏈沒生效, 這支檔的綠全部不算數`)
          .toBeLessThan(VIEWPORT.width);
      }
    }
  }, 120_000);

  it('🔵 正對照:不可斷行的 300 字元放進最窄的那個容器【必須】溢出', async () => {
    // 少了這一格, 上面四格「不溢出」可能只是因為量錯了東西。
    // 🔴 **「最窄」要用【量到的寬度】挑, 不能用祖先鏈長度挑** —— 第一版我寫了 `chain.length`,
    //   而它這次剛好挑對(home-dock 4 層也真的最窄 318px)⇒ 📌 **一個用錯判準而剛好答對的挑法,
    //   會在鏈變動的那一天安靜地把對照組跑到最寬的那個容器上。**
    const measured = [];
    for (const c of CONTAINERS) measured.push({ c, w: (await measure(c.chain, NOTICE)).available });
    const narrowest = measured.reduce((a, b) => (a.w <= b.w ? a : b)).c;
    const m = await measure(narrowest.chain, UNBREAKABLE);
    expect(m.overflowPx, `對照組沒有溢出 ⇒ 這把尺量不到溢出, 上面四格的綠不算數`).toBeGreaterThan(0);
  }, 120_000);

  it('🛑 祖先鏈的 class 名今天還在原始碼裡(鏈漂了這一格要紅)', () => {
    const files: Record<string, string> = {
      'app/page.tsx': readFileSync(join(REPO, 'apps/storefront/src/app/page.tsx'), 'utf8'),
      'HomeHero.tsx': readFileSync(join(REPO, 'apps/storefront/src/components/HomeHero.tsx'), 'utf8'),
      'VehicleFinder.tsx': readFileSync(join(REPO, 'apps/storefront/src/components/VehicleFinder.tsx'), 'utf8'),
      'ProductPage.tsx': readFileSync(join(REPO, 'apps/storefront/src/components/ProductPage.tsx'), 'utf8'),
      'CartView.tsx': readFileSync(join(REPO, 'apps/storefront/src/components/CartView.tsx'), 'utf8'),
    };
    const all = Object.values(files).join('\n');
    for (const c of CONTAINERS) {
      for (const cls of c.chain) {
        expect(all.includes(`"${cls}"`) || all.includes(`${cls} `), `class \`${cls}\` 在原始碼裡查無 ⇒ 祖先鏈漂了`).toBe(true);
      }
    }
    // 🔵 負對照:現造的 class 必須查無, 否則上面那圈 includes 是恆真的。
    expect(all.includes('"zzz-bogus-container"')).toBe(false);
  });
});
