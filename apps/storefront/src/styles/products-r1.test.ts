// products-r1.test.ts — /products 與 /cart 的文字層守門(全站重設計 第3批;2026-08-06)
//
// 🔴 **這支存在的理由**:本批改的東西幾乎全是「改回去也不會有任何東西紅」的形狀 ——
//    字體 token 的 typo、半像素併整數、一顆鈕的底色、選車列的彈性欄寬、sticky 偏移。
//    其中 sticky 偏移那一組**尤其危險**:漂開的症狀是「側欄與主表頭黏頂的位置差幾像素」,
//    沒有人會回報,而且真瀏覽器不刻意量也看不出來。
//
// ⚠️ **它擋不住什麼**:文字層看不到 cascade 勝負、看不到實際渲染尺寸。
//    本批那個 `--font-sans` typo 的**嚴重程度**(整條 `font:` 簡寫被丟棄、連字級一起沒了)
//    是真瀏覽器合成探針量出來的,不是這裡看出來的。

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const PRODUCTS = strip(read('products-page.css'));
const CARD = strip(read('product-card.css'));
const CASCADE = strip(read('filter-cascade.css'));
const SIDE = strip(read('filter-side.css'));
const CART = strip(read('cart.css'));
const CART_VEHICLE = strip(read('cart-vehicle.css'));
const PRICING = strip(read('pricing.css'));

function block(src: string, label: string, selector: string): string {
  const i = src.indexOf(selector);
  expect(i, `${label} 找不到選擇器 ${selector}(被改名或刪了?)`).toBeGreaterThan(-1);
  const open = src.indexOf('{', i);
  const close = src.indexOf('}', open);
  expect(close, `${label} 的 ${selector} 區塊沒有閉合`).toBeGreaterThan(open);
  const body = src.slice(open + 1, close);
  expect(body, `${label} 的 ${selector} 區塊內出現巢狀 {`).not.toMatch(/\{/);
  return body;
}

describe('第3批 · `--font-sans` / `--font-mono` typo 家族(與第1批同一族)', () => {
  // 那兩顆別名**只**定義在 `product-page.css` 的 `.pd-page` scope 內。任何其他檔案消費它們,
  // 宣告都會在 computed-value time 失效 —— 而它們多半寫在 `font:` 簡寫裡 ⇒ **整條被丟棄**,
  // 連字級與行高一起沒了(真瀏覽器合成探針實測:壞的 16px/normal、好的 13px/13px)。
  it('🔴 面層 — 只有 product-page.css 可以消費 `var(--font-sans)` / `var(--font-mono)`', () => {
    const offenders: string[] = [];
    for (const f of readdirSync(HERE).filter((x) => x.endsWith('.css'))) {
      if (f === 'product-page.css') continue; // 別名的定義處,scope 內取得到
      if (/var\(--font-(sans|mono)/.test(strip(read(f)))) offenders.push(f);
    }
    expect(offenders, `這些檔案在 .pd-page scope 外消費了只在 scope 內定義的別名:${offenders.join(', ')}`)
      .toEqual([]);
  });

  it('🔴 前提 — 那兩顆別名確實只在 product-page.css 定義(定義處若外移,上面那條就失去意義)', () => {
    const definers = readdirSync(HERE)
      .filter((x) => x.endsWith('.css'))
      .filter((f) => /--font-(sans|mono):/.test(strip(read(f))));
    expect(definers, '別名的定義處變了 ⇒ 上面那條面層斷言要重想').toEqual(['product-page.css']);
  });

  // 🔴 N1:上面只比「有沒有寫 `var(--f-`」,那**不足以**保證宣告解得出來。
  //    `.pp-page-num` 與 `.pp-pagination-perpage select` 用的是**無 fallback** 的 `var(--f-sans)`
  //    ⇒ 那顆 token 一改名,`font:` 簡寫會再次被整條丟棄,而上面那組照樣全綠
  //    —— 正是本 describe 自己要防的形狀。這條把「別名真的存在」釘住。
  it('🔴 前提 — --f-sans / --f-mono 確實定義在全域 :root(無 fallback 的消費點全靠它)', () => {
    const tokens = strip(read('tokens.css'));
    const root = tokens.slice(0, tokens.indexOf('[data-theme="dark"]'));
    expect(root, ':root 找不到 --f-sans ⇒ 分頁的 font: 簡寫會被整條丟棄').toMatch(/--f-sans:\s*\S/);
    expect(root, ':root 找不到 --f-mono').toMatch(/--f-mono:\s*\S/);
  });

  it('🔴 分頁三處已改吃 --f-*(字級與行高不再隨整條宣告一起被丟棄)', () => {
    for (const sel of ['.pp-pagination-info', '.pp-page-num', '.pp-pagination-perpage select']) {
      expect(block(PRODUCTS, 'products-page.css', sel), `${sel} 還在吃 typo 別名`).toMatch(
        /var\(--f-(sans|mono)/,
      );
    }
  });
});

describe('第3批 · 半像素併整數(DESIGN-HANDOFF §4-3「字級只用整數 px」)', () => {
  // 🔴 N3:`DESIGN-HANDOFF` §4-3 的口徑是「**全站**半像素為零」,只掃我手碰過的三支
  //    就是把面畫在「我改過的檔」而不是「規則成立的面」。改成掃本批兩條路由吃到的每一支。
  it.each([
    ['cart.css', CART],
    ['cart-vehicle.css', CART_VEHICLE],
    ['filter-cascade.css', CASCADE],
    ['products-page.css', PRODUCTS],
    ['filter-side.css', SIDE],
    ['products-mobile.css', strip(read('products-mobile.css'))],
    ['filter-responsive.css', strip(read('filter-responsive.css'))],
    ['filter-top.css', strip(read('filter-top.css'))],
    ['pricing.css', strip(read('pricing.css'))],
  ])('%s 不再有半像素字級', (_f, src) => {
    expect(src, '仍有 .5px 的字級').not.toMatch(/font-size:\s*\d+\.\d+px/);
  });

  it('🔴 product-card.css 只剩下那一條**死規則**的半像素,且它是刻意留著的', () => {
    // `noUncheckedIndexedAccess` 下 `m[1]` 是 `string | undefined` ⇒ 用整段命中(`m[0]`)。
    const halves = [...CARD.matchAll(/[^\n]*font-size:\s*\d+\.\d+px[^\n]*/g)].map((m) => m[0].trim());
    // `[data-font-size="sm"]` 全樹零消費點(`.tsx`/`.ts` 都沒有設過這個屬性)⇒ 死規則。
    // 併整數會讓人以為它是活的,所以刻意不動 —— 但也不能讓它默默增生。
    expect(halves, `product-card.css 的半像素字級不只那一條死規則:${halves.join(' | ')}`).toEqual([
      '[data-font-size="sm"] .pcard-name { font-size: 12.5px; }',
    ]);
  });

  it('🔴 前提 — `data-font-size` 真的沒有任何消費點(哪天接上了,上面那條的理由就沒了)', () => {
    // 🔴 N4:原本只走 `apps/storefront/src`。`packages/ui` 之後掛上就看不到
    //    (memory `reference_monorepo-查無斷言-grep-全樹`)⇒ 從 monorepo 根掃起。
    const src = resolve(HERE, '../../../..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = resolve(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
          if (/data-font-size|dataFontSize/.test(readFileSync(p, 'utf8'))) hits.push(e.name);
        }
      }
    };
    walk(src);
    expect(hits, `data-font-size 已經被接上(${hits.join(', ')})⇒ 那三條不再是死規則,要重新評估`)
      .toEqual([]);
  });
});

describe('第3批 · /cart 主 CTA 熔橘化(交接單 §五 拍板;§一-4 與驗收 #3 是過期字面)', () => {
  it('🔴 .cart-checkout 底色熔橘、hover 深熔橘', () => {
    const body = block(CART, 'cart.css', '.cart-checkout {');
    expect(body, '前往結帳鈕不是熔橘').toMatch(/background:\s*var\(--c-red\)/);
    expect(body, '前往結帳鈕退回墨黑 ⇒ 牴觸 §4-1「主 CTA 一律熔橘」').not.toMatch(
      /background:\s*var\(--c-text\)/,
    );
    expect(CART, 'hover 沒跟著走深熔橘').toMatch(
      /\.cart-checkout:hover\s*\{\s*background:\s*var\(--c-red-dark\)/,
    );
  });

  it('🔴 反面 — 空車的 .btn-primary(繼續購物)**維持墨黑**(設計端 §五 明文)', () => {
    // 它是導流鈕、不是結帳主 CTA。順手一起改熔橘會同時打破設計端的明文與 404 主鈕
    // 的 scope 前提(見 `content-pages.test.ts` 的前提①)。
    expect(block(CART, 'cart.css', '.btn-primary {'), '.btn-primary 被順手改成熔橘了').toMatch(
      /background:\s*var\(--c-text\)/,
    );
  });
});

describe('第3批 · R1-2 快加鈕黑→灰(Sean 逐字「黑色看不清楚」)', () => {
  it('🔴 淺灰底 + 墨字,hover 再深一階', () => {
    const body = block(CARD, 'product-card.css', '.pcard-quick-btn {');
    expect(body, '快加鈕不是淺灰底').toMatch(/background:\s*rgba\(233,\s*233,\s*235,\s*0\.94\)/);
    expect(body, '快加鈕的字不是墨色').toMatch(/color:\s*var\(--c-text\)/);
    // 反面:退回黑底白字 —— 深色商品照上那顆鈕會整個糊進圖裡。
    expect(body, '快加鈕退回黑底').not.toMatch(/background:\s*rgba\(10,\s*10,\s*10/);
    expect(CARD, 'hover 沒跟著改(仍是純黑)').not.toMatch(/\.pcard-quick-btn:hover\s*\{[^}]*#000/);
  });
});

describe('第3批 · R1-3 選車列彈性欄位(Sean 圈圖親自解鎖 B′ C1)', () => {
  it('🔴 欄位由固定 184px 改成彈性等寬(flex 1 1 0 / min 150 / **無成長上限**)', () => {
    const body = block(CASCADE, 'filter-cascade.css', '.cft-cascade .vsc {');
    expect(body, '欄位不是彈性').toMatch(/flex:\s*1 1 0/);
    expect(body, '少了收縮下限').toMatch(/min-width:\s*150px/);
    // 🔴 Q15(Sean 2026-08-07)**把這條翻正**:原本這裡釘 `max-width: 236px`,理由寫
    //    「少了成長上限 ⇒ 1440 下三欄會拉得過寬」—— 真瀏覽器實測(1440 訪客態)是**相反**的:
    //    三欄被夾在 236px、內容右緣留 438px 空白,那正是 Sean 要修掉的東西。
    //    上限本來就多餘,因為列寬自己封頂(下一個 it 守那條)。
    expect(body, '成長上限又回來了 ⇒ 1440 訪客態右側會再空 438px').not.toMatch(/max-width:/);
    // 反面:184px 的固定寬不得復活(那正是「右側大片死空間」的來源)。
    // 🔴 N2:舊寫法是 `width: 184px; min-width: 184px` 兩行一組(1220 段是 156)。
    //    只鎖 `min-width` 的話,單寫回一行 `width: 184px` 就能把彈性打死而不紅。兩種都鎖。
    expect(CASCADE, '固定 184px 欄寬又回來了').not.toMatch(/(min-)?width:\s*184px/);
    expect(CASCADE, '1220 斷點那組固定 156px 覆寫又回來了 ⇒ 會蓋掉彈性').not.toMatch(
      /(min-)?width:\s*156px/,
    );
  });

  it('🔴 Q15 連坐:三欄的天花板改由列寬承擔 ⇒ `.cft-inner` 的 1440 封頂變成承重、不得移除', () => {
    // 拿掉 `.cft-cascade .vsc` 的 max-width 之後,唯一還在限制欄寬的就是這條。
    // 它若被刪(或改成 --shell-max: none),三欄會跟著超寬螢幕一路長,那是真的「拉得過寬」。
    const body = block(CASCADE, 'filter-cascade.css', '.cft-inner {');
    expect(body, '.cft-inner 少了 --shell-bar-max 封頂 ⇒ 三欄會跟著螢幕無限長').toMatch(
      /max-width:\s*var\(--shell-bar-max\)/,
    );
  });

  it('🔴 容器要能吃滿剩餘寬(沒有這兩條,裡面的 flex:1 1 0 沒有空間可分)', () => {
    const body = block(CASCADE, 'filter-cascade.css', '.cft-cascade {');
    expect(body, '.cft-cascade 少了 flex: 1 1 auto ⇒ 只會撐到內容寬、欄位長不大').toMatch(
      /flex:\s*1 1 auto/,
    );
    expect(body, '.cft-cascade 少了 min-width: 0 ⇒ 窄螢幕收不動').toMatch(/min-width:\s*0/);
  });

  it('🔴 欄位本體:44px 高 / 15px / border-strong,且 min-width 歸零', () => {
    const body = block(CASCADE, 'filter-cascade.css', '.cft-cascade .vsc-input {');
    expect(body, '欄位不是 44px 高').toMatch(/height:\s*44px/);
    expect(body, '欄位字級不是 15px').toMatch(/font-size:\s*15px/);
    expect(body, '欄位框線沒換 border-strong').toMatch(/border-color:\s*var\(--c-border-strong\)/);
    // 🔴 `.vsc-input` 在本檔別處有 `min-width: 132px`;不歸零的話 flex 收縮會被那個下限卡住,
    //    三欄在窄螢幕就不等寬了 —— 而畫面上只是「稍微不齊」,沒有東西會紅。
    expect(body, '.vsc-input 沒把 min-width 歸零 ⇒ 會被別處的 132px 下限卡住').toMatch(
      /min-width:\s*0/,
    );
  });

  it('🔴 前提 — 那個 132px 下限確實還在(它沒了,上面那條歸零就是多餘的)', () => {
    expect(CASCADE, '.vsc-input 的 132px 下限不見了 ⇒ 回頭把歸零那行拆掉').toMatch(
      /\.vsc-input\s*\{[^}]*min-width:\s*132px/,
    );
  });

  it('🔴 標題與提示改上下兩行、提示句斷點 1220 → 1280', () => {
    expect(block(CASCADE, 'filter-cascade.css', '.cft-picker-title {'), '標題還是同行 baseline')
      .toMatch(/flex-direction:\s*column/);
    expect(CASCADE, '提示句的收起斷點沒改到 1280').toMatch(
      /@media \(max-width:\s*1280px\) and \(min-width:\s*1024px\)/,
    );
    expect(CASCADE, '舊的 1220 斷點還在').not.toMatch(/max-width:\s*1220px/);
  });

  it('🔴 愛車鈕的加大**只 scope 在選車列內**(全域還有別的掛載點)', () => {
    expect(CASCADE, '愛車鈕的 padding 沒 scope').toMatch(
      /\.cft-right \.cat-garage-toggle\s*\{\s*padding:\s*9px 14px/,
    );
    // 反面:全域那顆維持原值 —— 手機面板與購物車車款欄不在本次圈圖範圍。
    // 🔴 anchor 必須**行首錨定**:`.cft-right .cat-garage-toggle` 這個字串裡也含
    //    `.cat-garage-toggle {`,用 `indexOf` 會先命中 scoped 那條、量到錯的區塊。
    //    (第一版就是這樣寫的,測試直接紅出來 —— 這族錯誤在寫的當下看起來完全正常。)
    const globalRule = /\n\.cat-garage-toggle \{([^}]*)\}/.exec(CASCADE);
    expect(globalRule, '找不到行首的全域 .cat-garage-toggle 規則').not.toBeNull();
    expect(globalRule?.[1], '全域的愛車鈕被一起改大了').toMatch(/padding:\s*7px 12px/);
  });
});

describe('🔴 第3批 · sticky 偏移三處必須同值(漂開不會有任何東西紅)', () => {
  // 選車列由實量 64px 長到 70px(欄位 44 + 直距 12×2 + 兩條框線)。
  // 真瀏覽器複驗:頁首 73 + 選車列 70 = 143,兩處 sticky top 都是 143px、bar 底緣也是 143
  // ⇒ 零重疊。這裡釘的是「三處寫的是同一個數」,實際數字對不對靠那次量測。
  const OFFSET = /calc\(var\(--shell-header-h\) \+ 70px\)/;

  it('.pp-head(cascade 模式)', () => {
    expect(
      block(PRODUCTS, 'products-page.css', '.pp-layout[data-filter-style="cascade"] .pp-head'),
      '主表頭的 sticky 偏移不是 70',
    ).toMatch(OFFSET);
  });

  it('.fs-side(cascade 模式)的 top 與 height 都要跟著', () => {
    const body = block(SIDE, 'filter-side.css', '.pp-layout[data-filter-style="cascade"] .fs-side');
    expect(body, '側欄的 sticky 偏移不是 70').toMatch(OFFSET);
    expect(body, '側欄高度沒扣掉新的 70 ⇒ 底部會被截掉 6px').toMatch(
      /height:\s*calc\(100vh - var\(--shell-header-h\) - 70px\)/,
    );
  });

  it('🔴 反面 — 舊的 64 不得殘留在任何一處(只改一半 = 側欄與表頭黏頂位置差 6px)', () => {
    for (const [f, src] of [
      ['products-page.css', PRODUCTS],
      ['filter-side.css', SIDE],
    ] as const) {
      expect(src, `${f} 還殘留舊的 64px 偏移`).not.toMatch(
        /calc\(var\(--shell-header-h\)\s*[+-]\s*64px\)/,
      );
    }
  });

  it('🔴 前提 — top 模式那條的 58px **沒有**被順手一起改(它是另一條 bar 的高度)', () => {
    expect(
      block(PRODUCTS, 'products-page.css', '.pp-layout[data-filter-style="top"] .pp-head'),
      'top 模式的偏移被連坐改掉了 ⇒ 那條 bar 沒有變高',
    ).toMatch(/calc\(var\(--shell-header-h\) \+ 58px\)/);
  });
});

// ══ 商品卡「價格列貼卡底、整排對齊」三件套(2026-08-06,R1 MF3)══
//
// 🔴 這三條是**一組**,少任何一條那個版面就不成立,而且三種壞法在三綠與單元測試下全都零轉紅:
//    ①`.pcard-info{flex:1}` 沒了 → `margin-top:auto` 沒有剩餘空間可分配、推不到卡底
//    ②`.pcard-name{min-height:2.8em}` 沒了 → 1 行與 2 行品名讓下半部整段位移
//    ③`.pcard-price-row` 又被補上第二個 `margin-top` → 後者覆蓋 `auto`,貼底整條變死規則
//    ③正是這次抓到的真缺陷:`margin-top:auto` 與 `margin-top:8px` 同時存在了不知道多久。
// 真權威 = OD `pcm-account.css` 的「為你推薦」段(2026-08-06 Sean 指示後的新稿)與首頁稿
//    `direction-b-layout-01-graphite-ember.html`,兩支的 `.pcard-*` 逐字相同。
// ⚠️ 它擋不住什麼:文字層證得了三條規則在、形狀對,證不了瀏覽器真的把價格排到同一條線上
//    (那要真瀏覽器量整排卡片的 `.pcard-price-row` top 值)。
describe('商品卡 · 價格列貼卡底(首頁橫捲 / 商品列表 / 品牌頁 / 會員中心共用)', () => {
  // 🔴 `.pcard` 自己的 `flex:1` = OD 逐字(鐵則 1 直搬)+ 縱深防禦。
  //    ⚠️ **不要照抄「少了它首頁就會不齊」那個說法** —— 真瀏覽器四組對照實測:
  //       min-height ON/flex ON → 0px、ON/OFF → 0px、OFF/ON → 0px、OFF/OFF → 19px。
  //       兩套機制互相獨立、任一條單獨都夠(現行內容形狀下)。這條守的是「OD 字面別被摘掉」,
  //       它**不是**目前唯一撐住對齊的那根柱子;真正會壞的組合是兩套一起消失。
  it('🔴 `.pcard` 自己有 flex:1(OD 字面;與 min-height 互為備援)', () => {
    expect(
      block(CARD, 'product-card.css', '.pcard {'),
      '.pcard 沒有 flex:1 ⇒ OD 字面被摘掉、只剩 min-height 一根柱子撐對齊',
    ).toMatch(/flex:\s*1\b/);
  });

  it('🔴 `.pcard-info` 有 flex:1(否則下面那條 margin-top:auto 是空話)', () => {
    expect(
      block(CARD, 'product-card.css', '.pcard-info'),
      '.pcard-info 沒有 flex:1 ⇒ 價格列推不到卡底、整排高低不齊',
    ).toMatch(/flex:\s*1\b/);
  });

  it('🔴 `.pcard-name` 有 min-height:2.8em(line-clamp 只管上限、不管下限)', () => {
    expect(
      block(CARD, 'product-card.css', '.pcard-name'),
      '.pcard-name 沒有 min-height ⇒ 一行品名的卡片下半部整段上移',
    ).toMatch(/min-height:\s*2\.8em/);
  });

  it('🔴 `.pcard-price-row` 只有**一個** margin-top 且是 auto(重複宣告會讓後者靜默覆蓋)', () => {
    const body = block(CARD, 'product-card.css', '.pcard-price-row');
    const marginTops = body.match(/margin-top:/g) ?? [];
    expect(
      marginTops.length,
      `.pcard-price-row 出現 ${marginTops.length} 個 margin-top ⇒ 後者會覆蓋 auto、貼底變死規則`,
    ).toBe(1);
    expect(body, '.pcard-price-row 的 margin-top 不是 auto ⇒ 不貼卡底').toMatch(/margin-top:\s*auto/);
  });

  // 🔴 R2 nit:上面三條都只看 `block()` 取到的**第一個**同名區塊 ⇒ 有人在檔案後段或別支 CSS
  //    另寫一條 `.pcard-price-row{margin-top:8px}` / `.pcard-info{flex:none}` / `.pcard-name{min-height:0}`
  //    就能讓 bug 復活而守門全綠 —— 那正是這次抓到的 bug 的下一個變形(它本來就是「同一條規則裡
  //    寫了兩次 margin-top」)。這條掃**全部**出現位置,不是只掃第一個。
  it('🔴 這四顆屬性在全站 CSS 裡只有一個定義點(後面沒有人再覆寫回去)', () => {
    const ALL: Array<[string, string]> = [
      ['product-card.css', CARD],
      ['products-page.css', PRODUCTS],
      ['cart.css', CART],
      ['filter-cascade.css', CASCADE],
      ['filter-side.css', SIDE],
      ['cart-vehicle.css', CART_VEHICLE],
    ];
    // 找出每支 CSS 裡所有「選擇器含 .pcard-xxx」的規則,檢查有沒有第二處覆寫承重屬性
    const overrides: string[] = [];
    for (const [label, src] of ALL) {
      for (const m of src.matchAll(/([^{}]*\.pcard(?:-info|-name|-price-row)\b[^{}]*)\{([^}]*)\}/g)) {
        const selector = m[1]!.trim();
        const body = m[2]!;
        const isBase = /^\.pcard(-info|-name|-price-row)$/.test(selector) || selector === '.pcard';
        if (isBase) continue;
        if (/flex:|min-height:|margin-top:/.test(body)) {
          overrides.push(`${label} 的「${selector}」覆寫了承重屬性`);
        }
      }
    }
    expect(overrides, `有第二處覆寫會讓 base 規則靜默失效:\n${overrides.join('\n')}`).toEqual([]);
  });
});

// ══ 商品卡價格顏色 · 同權重撞規則(2026-08-06,Sean 逐字「我們價錢字的顏色要用橘色」)══
//
// 🔴 這條守的是一個**靜態讀單一檔案永遠看不出來**的缺陷:
//    `product-card.css` 的 `.pcard .price-main{color:var(--c-red-dark)}` 與
//    `pricing.css` 的 `.price-wrap .price-main{color:var(--c-text)}` **權重完全相同**(0,2,0),
//    而真實 DOM 上兩條同時命中(卡片價格外面包了三級定價元件 `.price-wrap`)
//    ⇒ 後載入者(`layout.tsx` 裡 pricing.css 排在 product-card.css 之後)贏 ⇒ **整站卡片價格都是墨黑**。
//    三綠全過、兩個檔案各自讀起來都對、單元測試全綠 —— 只有在真實 DOM 上量 computed 才會現形。
// ⚠️ 它擋不住什麼:文字層算不出 cascade 勝負。這條驗的是「**有沒有留一條贏得過通用預設的卡片專屬規則**」,
//    不是「顏色真的畫出來了」。後者要真瀏覽器量(本片已量:卡片內 rgb(196,71,12)、卡片外仍 rgb(18,18,20))。
describe('商品卡價格顏色 · 必須贏過 pricing.css 的通用預設', () => {
  it('🔴 前提:pricing.css 真的有一條 `.price-wrap .price-main` 在設 color(沒有的話下面那條恆真)', () => {
    expect(
      PRICING,
      'pricing.css 不再設 .price-wrap .price-main 的 color ⇒ 撞規則消失,下面那條就沒有守護對象了(可以刪)',
    ).toMatch(/\.price-wrap\s+\.price-main\s*\{[^}]*color:/);
  });

  it('🔴 `product-card.css` 有一條**含 `.price-wrap`** 的卡片專屬價格色規則(否則墨黑會贏)', () => {
    expect(
      CARD,
      '找不到 `.pcard .price-wrap .price-main` ⇒ 只剩 0,2,0 的 `.pcard .price-main`,'
        + '與 pricing.css 同權重、且它後載入 ⇒ 卡片價格會靜默變回墨黑',
    ).toMatch(/\.pcard\s+\.price-wrap\s+\.price-main\s*\{[^}]*color:\s*var\(--c-red-dark\)/);
  });
});

// ══ 商品卡圖框 · 白底加框(2026-08-06,Sean 拍板 A)══
//
// 🔴 OD 三支稿(brand-page.html / direction-b-layout-01-graphite-ember.html / pcm-account.css)
//    逐字一致 `background:#fff;border:1px solid var(--c-border)`,只有 products-list-page.html
//    一支落單畫灰底無框 —— 與價格色那次同型、同一支稿再度落單,稿自身矛盾已記入 OD 回饋包。
//    影響五個面:首頁最新商品橫捲(HomeSelect)/ 商品列表(ProductsPage)/ 品牌頁熱門商品
//    (BrandPageProducts)/ 會員中心為你推薦(OverviewTab)/ PDP 相關商品(ProductRelated,由
//    ProductPage.tsx:206 掛載;R1 抓到前一版漏算此面)——皆共用 .pcard-img-wrap class。
// 🔴 這條守門只驗「CSS 宣告存在」,不驗「畫面看得到」——2026-08-07 更正(R1 MF1/MF2/MF3,
//    上一版這裡的講法有兩處錯):
//    ①`ProductCard.tsx` 的 `.pcard-gallery` inline background 已跟進改 `#ffffff`(Sean 08-06 拍 A
//      推翻 07-24 拍板 Q1=A)——但這裡的 `background:#fff` **仍然被 `.pcard-gallery` 完整蓋住**
//      (該層 width/height:100% + 三分支全不透明),只是兩條真圖路徑現在同色、看不出被蓋。
//      它是**縱深防禦**(gallery 若改回透明或整條 background 被拿掉才輪到它現形),不是「不再被蓋」;
//      對「gallery 改成別的不透明色」零保護。
//    ②`ProductCard.test.tsx` 是 `@vitest-environment jsdom` 的**單元測試**,量的是 React 產出的
//      inline style **字串**,沒有 cascade/合成/真瀏覽器——**不是畫面實測**。本片沒有任何真瀏覽器
//      證據(本機三條路由都渲染不出商品卡,見 ProductCard.test.tsx 對應說明),實際外觀待 Sean
//      在有資料的站上看。
describe('商品卡圖框 · 白底加框(首頁橫捲 / 商品列表 / 品牌頁 / 會員中心 / PDP 相關商品共用)', () => {
  it('🔴 前提(非獨立防線):.pcard-img-wrap 區塊裡有 background 宣告', () => {
    // R1 nit:這條被下面「background 是 #fff」那條嚴格蘊含(後者成立 ⇒ 本條必成立)、零額外
    // 判別力,只在「background 宣告整個消失」時給出更精確的失敗訊息,不是一道獨立防線。
    const body = block(CARD, 'product-card.css', '.pcard-img-wrap {');
    expect(body, '.pcard-img-wrap 沒有 background 宣告 ⇒ 守門對象不存在').toMatch(/background:/);
  });

  it('🔴 background 宣告是 #fff、不是舊的 var(--c-surface-2)(守的是 CSS 宣告、非畫面可見底色——見上方說明)', () => {
    const body = block(CARD, 'product-card.css', '.pcard-img-wrap {');
    expect(body, '.pcard-img-wrap 的 background 不是 #fff ⇒ 改回舊灰底也全綠').toMatch(
      /background:\s*#fff/,
    );
    expect(body, '.pcard-img-wrap 仍殘留舊的 var(--c-surface-2) ⇒ 沒真的改掉').not.toMatch(
      /var\(--c-surface-2\)/,
    );
  });

  it('🔴 有 border: 1px solid var(--c-border)', () => {
    const body = block(CARD, 'product-card.css', '.pcard-img-wrap {');
    expect(body, '.pcard-img-wrap 沒有 border ⇒ 改回無框也全綠').toMatch(
      /border:\s*1px solid var\(--c-border\)/,
    );
  });
});
