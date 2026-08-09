// h1-scale.test.ts — 全站頁面主標題(h1)手機三級收斂的守門。
//
// 由來:Sean 2026-08-09 拍板 H1=A / H2=A / H3=A(D-334-STOP 的對照表)——
// 390px 下把 19 個 h1 面收斂成三級:**形象 38 / 一般 26 / 工具 22**。
//
// 🔴 **這支為什麼一定要跨檔掃、不能一檔一條**:
//    同一個選擇器常常有**多處**宣告在 390px 同時生效,而且分散在不同檔:
//      · `.page-hero-title` 三處 —— `filter-responsive.css` ×2(其中一條是
//        `[data-mobile="true"]`,specificity (0,2,0) 比另一條高)+ `pages-shipping.css` ×1。
//      · `.auth-card h1` / `.cart-head h1` 各兩處(普通 + `[data-mobile="true"]`)。
//    ⇒ 只改「我打開的那一支檔」= 另一條 cascade 路徑上的舊值原封不動,
//      而任何「這個檔裡有 22px」式的斷言**照樣全綠**。
//    這正是本週那條教訓的形狀(宣稱同步、實際只改碰到的行)。所以守門的單位是
//    **「這個選擇器在 390px 生效的每一處宣告」**,不是「某支檔裡有沒有出現某個值」。
//
// ⚠️ **它擋不住什麼**:文字層算不出 cascade 真正的勝負,也量不到渲染結果。
//    落片當下另外用真瀏覽器在 390px 量過 10 條路由的 computed 值(全中);
//    `/cart` `/checkout` `/checkout 完成` `/account` 需登入或 DB、本 worktree 量不到,
//    那四面只有本檔的宣告層守門 —— 這個缺口是明說的,不是假裝覆蓋到了。

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const VIEWPORT = 390; // Sean 的 iPhone 寬度,也是本次拍板的量測基準

/** 三級的拍板值。改這裡等於改拍板,不是調樣式。 */
const TIER = { 形象: 38, 一般: 26, 工具: 22 } as const;

/** 各 h1 面 → 級別。`null` = 刻意排除,理由寫在 EXCLUDED。 */
const PAGES: ReadonlyArray<{ what: string; sel: string; tier: keyof typeof TIER }> = [
  { what: '品牌頁 /brands/[slug]', sel: '.bp-title', tier: '形象' },
  { what: '品牌總覽 /brands', sel: '.bd-hero h1', tier: '形象' },
  { what: '即將上線 /coming-soon', sel: '.cs-title', tier: '形象' },
  { what: '商品頁 /products/[slug]', sel: '.pd-title', tier: '一般' },
  { what: '404', sel: '.err-title', tier: '一般' },
  { what: '法律/資訊三頁 /terms /privacy /info/shipping', sel: '.page-hero-title', tier: '一般' },
  { what: '登入族七面 /login /register /login/forgot /login/reset', sel: '.auth-card h1', tier: '工具' },
  { what: '已登出 /logout', sel: '.lo-card h1', tier: '工具' },
  { what: '購物車 /cart', sel: '.cart-head h1', tier: '工具' },
  { what: '結帳 /checkout', sel: '.co-head h1', tier: '工具' },
  { what: '結帳完成', sel: '.co-success-title', tier: '工具' },
  { what: '會員中心 /account', sel: '.acc-head h1', tier: '工具' },
];

/**
 * 刻意不進三級的兩個面 —— 各自有**拍板來源**,不是漏掉。
 * 🔴 這裡的 `expect` 值是承重的:有人「順手把它們也收斂了」會直接紅。
 */
const EXCLUDED: ReadonlyArray<{ what: string; sel: string; expect: number; why: string }> = [
  {
    what: '首頁 hero',
    sel: '.b-hero-title',
    expect: 26,
    why: 'Sean 2026-08-09 H2=A 明確破例:文案是長中文句(且掛 .b-hero-title--cjk),38px 在 390px 會斷得很難看',
  },
  {
    what: '商品列表 /products',
    sel: '.pp-title',
    expect: 24,
    why:
      'Sean 2026-07-30 Q1=B「手機藏大標題、留麵包屑」⇒ products-mobile.css 用 clip-path 視覺隱藏(語意保留)。' +
      '手機上它根本不顯示,改字級是 no-op ⇒ 維持現狀 24px,不進三級',
  },
];

type Decl = { file: string; line: number; media: string; size?: string; weight?: string; selectorHasDataMobile: boolean };

/** 這條 @media 串在 VIEWPORT 寬度下是否生效。 */
function appliesAtViewport(media: string): boolean {
  for (const m of media.matchAll(/max-width:\s*([\d.]+)px/g)) if (VIEWPORT > Number(m[1])) return false;
  for (const m of media.matchAll(/min-width:\s*([\d.]+)px/g)) if (VIEWPORT < Number(m[1])) return false;
  return true;
}

/** 把 `clamp(a, b, c)` / `Npx` 換算成 VIEWPORT 下的實際 px。看不懂的回傳 null。 */
function toPx(value: string): number | null {
  const v = value.trim();
  const plain = /^([\d.]+)px$/.exec(v);
  if (plain) return Number(plain[1]);
  const cl = /^clamp\(\s*([\d.]+)px\s*,\s*([\d.]+)vw\s*,\s*([\d.]+)px\s*\)$/.exec(v);
  if (cl) {
    const [min, vw, max] = [Number(cl[1]), Number(cl[2]), Number(cl[3])];
    return Math.min(Math.max((vw * VIEWPORT) / 100, min), max);
  }
  return null;
}

/** 掃全站 CSS,取某選擇器在 VIEWPORT 下生效的所有 font-size / font-weight 宣告。 */
function declsFor(sel: string): Decl[] {
  const out: Decl[] = [];
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.css'))) {
    const raw = readFileSync(join(DIR, f), 'utf8');
    // 剝註解(註解裡大量引用選擇器與數值),等長空白代換讓行號不位移
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      const idx = line.indexOf(sel);
      if (idx < 0) return;
      // 必須是「規則的選擇器」而非宣告內的字串:後面要接空白/逗號/大括號
      const after = line.slice(idx + sel.length);
      if (after !== '' && !/^[\s,{:]/.test(after)) return;
      if (!/[{,]/.test(line)) return;
      let end = i;
      while (end < lines.length && !lines[end]!.includes('}')) end += 1;
      const body = lines.slice(i, end + 1).join(' ');
      const size = body.match(/font-size:\s*([^;}]+)/)?.[1]?.trim();
      const weight = body.match(/font-weight:\s*([^;}]+)/)?.[1]?.trim();
      if (!size && !weight) return;
      // 往回推 @media 巢狀(用大括號深度,不用縮排)
      const stack: string[] = [];
      let depth = 0;
      for (let j = i - 1; j >= 0; j -= 1) {
        const l = lines[j]!;
        depth += (l.match(/\}/g) ?? []).length - (l.match(/\{/g) ?? []).length;
        if (depth < 0 && l.includes('@media')) {
          stack.unshift(l.trim().replace(/\s*\{$/, ''));
          depth = 0;
        }
      }
      const media = stack.join(' > ') || '(base)';
      if (!appliesAtViewport(media)) return;
      const selectorText = line.slice(0, line.indexOf('{') >= 0 ? line.indexOf('{') : line.length);
      out.push({ file: f, line: i + 1, media, size, weight, selectorHasDataMobile: selectorText.includes('[data-mobile') });
    });
  }
  return out;
}

/**
 * 「手機路徑上」的 font-size 宣告 —— 本檔所有斷言的單位。
 *
 * 🔴 為什麼不是「所有生效的宣告」:base 那條常常是**桌機值**,本來就會被手機帶覆寫
 *    (例:`.acc-head h1` base 32px、`≤1079` 帶 22px)。把 base 也要求等於目標 = 誤報,
 *    而且會逼人去改桌機值 —— 那超出本片「只收斂手機層」的範圍。
 *
 * 🔴 為什麼 `[data-mobile]` 那種**沒有包在 @media 裡**的也算手機路徑:
 *    它是給 UA 判定走的旁路,specificity (0,2,0) 比一般的 (0,1,0) 高、**贏過** @media 那條。
 *    漏改它 = 走該路徑的裝置仍是舊值,而「@media 裡是對的」式的斷言照樣綠。
 *    這條就是本檔存在的主要理由,不要為了讓測試好寫而拿掉。
 *
 * 手機路徑一條都沒有時(例:`.bp-title` / `.pd-title` 只有一條 base `clamp()`),
 * 就退回 base —— 那種寫法本來就是靠 clamp 自己在 390px 算出手機值。
 */
function mobileDecls(sel: string): { decls: Decl[]; fromBase: boolean } {
  const sized = declsFor(sel).filter((d) => d.size);
  const mobile = sized.filter((d) => d.media !== '(base)' || d.selectorHasDataMobile);
  if (mobile.length > 0) return { decls: mobile, fromBase: false };
  return { decls: sized.filter((d) => d.media === '(base)'), fromBase: true };
}

describe('h1 手機三級收斂(Sean 2026-08-09 H1=A/H2=A/H3=A;基準 390px)', () => {
  it('🔴 前提 — 每個 h1 面都掃得到生效宣告(掃不到 = 下面整組沒有對象、恆真)', () => {
    const missing = [...PAGES, ...EXCLUDED]
      .filter((p) => declsFor(p.sel).length === 0)
      .map((p) => `${p.what} ${p.sel}`);
    expect(missing, '這些選擇器在 styles/ 底下掃不到任何 font-size/font-weight 宣告 ⇒ 被改名或刪了,守門失去對象').toEqual([]);
  });

  for (const p of PAGES) {
    it(`🔴 ${p.what} — ${p.sel} 在 390px 生效的**每一處**宣告都必須是 ${TIER[p.tier]}px(${p.tier}級)`, () => {
      const { decls, fromBase } = mobileDecls(p.sel);
      const want = TIER[p.tier];
      // clamp 只要「在 390px 算出來等於目標」就算對(品牌頁/商品頁走 clamp 是刻意的)
      const bad = decls
        .map((d) => ({ d, px: toPx(d.size!) }))
        .filter(({ px }) => px === null || px !== want)
        .map(({ d, px }) => `${d.file}:${d.line} [${d.media}] font-size:${d.size} ⇒ 390px 下 ${px ?? '算不出來'}px`);
      expect(
        bad,
        `${p.sel} 被歸為「${p.tier}級 = ${want}px」,但在 390px 生效的宣告裡有對不上的。` +
          '🔴 常見病因:同一個選擇器有多處宣告(普通的 + `[data-mobile="true"]` 的、或分散在兩支檔),' +
          '只改了其中一處 ⇒ 另一條 cascade 路徑仍是舊值,而「某檔裡有這個數字」式的斷言照樣綠。' +
          `本選擇器目前在手機路徑上有 ${decls.length} 處宣告${fromBase ? '(無手機帶,退回 base clamp)' : ''},要改就每一處一起改。`,
      ).toEqual([]);
    });
  }

  for (const e of EXCLUDED) {
    it(`🔴 ${e.what} — ${e.sel} 刻意**不進**三級,維持 ${e.expect}px`, () => {
      const { decls } = mobileDecls(e.sel);
      const pxs = [...new Set(decls.map((d) => toPx(d.size!)))];
      expect(pxs.length, `${e.sel} 的手機路徑上有互相矛盾的值 ${JSON.stringify(pxs)} ⇒ 某條沒跟著改`).toBe(1);
      const px = pxs[0];
      expect(
        px,
        `${e.sel} 被改成 ${px}px。它不進三級是有拍板來源的:${e.why}。` +
          '要動請先推翻那個拍板,不要因為「看起來沒收斂完」順手改掉。',
      ).toBe(e.expect);
    });
  }

  // 🔴 字重是 H3=A 的部分:工具級統一 600。這條與字級分開,因為**字重不隨斷點變**
  //    —— 改的是 base 宣告(全寬生效),不是手機帶。
  it('🔴 H3=A 工具級字重 — 結帳與結帳完成的 base 字重必須是 600(它們原本是僅有的兩個 700 落單者)', () => {
    for (const sel of ['.co-head h1', '.co-success-title']) {
      const weights = declsFor(sel)
        .filter((d) => d.weight)
        .map((d) => `${d.file}:${d.line} ${d.weight}`);
      expect(weights.length, `${sel} 掃不到任何 font-weight 宣告 ⇒ 這條斷言沒有對象`).toBeGreaterThan(0);
      for (const w of weights) {
        expect(
          w,
          `${sel} 的字重不是 600 ⇒ 工具級收斂被打回(會員中心/購物車/登入族本來就是 600,` +
            '這兩個是 Sean H3=A 唯一點名要改的落單者):' + w,
        ).toMatch(/600/);
      }
    }
  });

  it('🔴 三級只有三個值 —— 有人偷加第四級(或把某頁改成 24/28)會在這裡紅', () => {
    const used = new Set(PAGES.map((p) => TIER[p.tier]));
    expect(
      [...used].sort((a, b) => b - a),
      '三級的數值集合被改動了。這三個數字是 Sean 2026-08-09 拍的(38 形象 / 26 一般 / 22 工具),' +
        '不是可以自由微調的樣式偏好;要加第四級請先問他。',
    ).toEqual([38, 26, 22]);
  });
});
