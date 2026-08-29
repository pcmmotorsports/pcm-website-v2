// brand-content-shell.test.ts — 「條目在、但是空殼」的守門
// (板子 `docs/launch-todo.md` :215 的**第二半**;線G 2026-08-29 08:42 開列、線F 實作)
//
// 隔壁 `brand-content-coverage.test.ts:38` 自己逐字寫著它守不到的那一格:
//   「一個只有 slug、其餘全空的條目在本閘底下是綠的,而客人會看到一個空殼頁。」
// ⇒ 那就是本檔。兩支合起來才是完整的:隔壁問「這一家【在不在】」,本檔問「它【有沒有東西】」。
//
// 客人看到的形狀:`app/brands/[slug]/page.tsx:102` 的 `if (!brand) notFound()` **會通過**
// (條目存在),而 `BrandPageRoot` 把每個子元件都渲染出來、只是裡面沒有字
// ⇒ **頁面存在、沒有錯誤、三綠全綠,而客人看到一頁空的。**
//
// 🔴 **這一片不是修一個現有的缺陷,是【讓下一次的缺陷會出聲】。**
//   落筆當下實量:21 筆條目、必填欄位空值 **0 筆**(線G 08:4x 用一次性探針量過,線F 複量相同)
//   ⇒ **今天沒有客人會撞到。而沒有任何東西會在下一次撞上時叫。**
//
// ═══════════════════════════════════════
// 🔴 為什麼判準是【型別上的必填】,而不是【哪個元件讀它】
// ═══════════════════════════════════════
//   線G 交列時用 `grep 'brand\.[a-zA-Z]+'` 逐元件列消費欄位,並據此把 `BrandPageWhy` 標成
//   「零個 `brand.*` ⇒ 它不吃 brand 欄位,別把它算進去」。
//   🔴 **而它吃** —— `BrandPageWhy.tsx:22` 是 `const { highlights, stats } = brand;`
//   ⇒ **解構的欄位不帶 `brand.` 前綴,那把 grep 對它天生失明。**
//   📌 而 `highlights` 是**必填** ⇒ 照那份清單裝閘,會漏掉一個真的會變空殼的欄位。
//   ⇒ 所以本檔不採「消費端清單」當分母,改用**型別上的必填集合**:
//      它由 `brand-content-types.ts` 決定,而那份東西**不會因為有人改寫元件的取值語法而漂**。
//
// ⚠️ **代價要寫明**:必填而目前無人渲染的欄位(例 `country`/`wallTagline` 是目錄頁在讀,
//   不是品牌頁)也會被本閘要求非空。**那是刻意的** —— 型別說它必填,空著就是資料缺陷,
//   而「今天誰在讀它」會變,「型別說它必填」不會。
//
// ⚠️ **本檔是 `.test.ts` ⇒ `lint` 對它沒有判別力**(它不進 build、也沒有 a11y/react 規則可觸發)
//   ⇒ 這一片的守門力全部來自**本檔自己的三發自檢**,不是三綠。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_CONTENT } from './brand-content';

/** 型別上的必填欄位。🔴 下面 `型別漂移` 那一格會拿型別檔回核這兩份清單,不是憑記憶維護。 */
const REQUIRED = [
  'slug',
  'name',
  'country',
  'origin',
  'lede',
  'slogan',
  'wallTagline',
  'bandLogo',
  'logoScale',
  'facts',
  'about',
  'highlights',
  'craft',
  'categories',
  'focus',
] as const;

/** 型別上的選填欄位 —— 🔴 它們空著是**合法的**,本閘不得碰(少了這一條,這道閘會一裝就紅)。 */
const OPTIONAL = ['band', 'aside', 'video', 'stats', 'timeline'] as const;

/**
 * 「空」的定義,逐型別寫死。
 * 🔴 `logoScale` 是 `number`(預設 1、實測值域 0.88-1.08)⇒ 它的「空」不是空字串,
 *    是**不是有限數或 <= 0**。少了這一格,`logoScale: 0` 會安靜通過而磚牆的 logo 會消失。
 */
function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'number') return !Number.isFinite(v) || v <= 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/** 回傳「這一筆有哪幾個必填欄位是空的」;沒有的話回空陣列。 */
function emptyRequiredFields(entry: Record<string, unknown>): string[] {
  return REQUIRED.filter((f) => isEmptyValue(entry[f]));
}

describe('BRAND_CONTENT:條目在、而內容是空殼', () => {
  it('前提:分母不是空的(空掉的話下面整段恆綠)', () => {
    expect(
      BRAND_CONTENT.length,
      'BRAND_CONTENT 是空的 ⇒ 下面那條沒有東西可以檢查 ⇒ 它會恆綠而看起來像通過',
    ).toBeGreaterThan(0);
  });

  it('🔴🔴 每一筆的必填欄位都不得為空(空了客人會看到一頁空的,而不是 404)', () => {
    const report = BRAND_CONTENT.map((b) => ({
      slug: (b as unknown as Record<string, unknown>).slug,
      empty: emptyRequiredFields(b as unknown as Record<string, unknown>),
    })).filter((r) => r.empty.length > 0);

    expect(
      report,
      `這些條目的必填欄位是空的 ⇒ 客人點進去會看到一頁空的(頁面存在、不會 404):\n` +
        report.map((r) => `  ${String(r.slug)} ⇒ ${r.empty.join(' / ')}`).join('\n'),
    ).toEqual([]);
  });

  // ─────────────────────────────────────
  // 🔴 三發自檢。本檔的判別力全部在這裡 —— 上面那一格今天本來就是綠的,
  //    而「本來就綠」的斷言證明不了它會在該紅的時候紅。
  // ─────────────────────────────────────

  // 🔴 下面兩發的樣本是**現造的**,不是從 `BRAND_CONTENT[0]` 複製來的。
  //   ⚠️ 第一版是複製真資料的,而 2026-08-29 對真資料跑突變時量到:
  //      弄壞【一筆真資料】⇒ **兩條紅**(主斷言 + 突變②),而預期只有一條。
  //      ⇒ 突變② 當時是在斷言【別人的資料】,不是在斷言這把尺。
  //   📌 判別句:自檢的樣本若來自被測的資料,那個自檢就會跟著資料一起壞 ——
  //      而它壞掉的時候,看起來像「守門抓到了東西」。
  /** 一筆**必填欄位全部填好**的合成樣本(不碰真資料)。 */
  function syntheticEntry(): Record<string, unknown> {
    return {
      slug: 'zz-synthetic',
      name: 'ZZ',
      country: '合成國',
      origin: '合成國 · 自 2026',
      lede: '一句話',
      slogan: '一句標語',
      wallTagline: '一行副標',
      bandLogo: 'zz.svg',
      logoScale: 1,
      facts: [{ k: 'v' }],
      about: { body: 'x' },
      highlights: { items: ['x'] },
      craft: { body: 'x' },
      categories: [{ k: 'v' }],
      focus: { k: 'v' },
    };
  }

  it('🔴 前提:合成樣本本身必須是【零空欄位】(它若本來就殘,下面兩發都失去判別力)', () => {
    expect(
      emptyRequiredFields(syntheticEntry()),
      '合成樣本自己就有空欄位 ⇒ 突變①分不出「我弄壞的」與「本來就殘的」',
    ).toEqual([]);
  });

  it('🔴 突變①:必填欄位空掉 ⇒ 尺必須指出【是哪幾個欄位】', () => {
    const hit = emptyRequiredFields({ ...syntheticEntry(), name: '', facts: [], about: {} });

    expect(hit.slice().sort()).toEqual(['about', 'facts', 'name']);
    // 🔴 而不只是「有紅」:紅的必須【只有】我造的那三個。
    //    多出來 ⇒ 本尺在斷言別人的欄位;少了 ⇒ 它漏檢。
    expect(hit, '紅的欄位比我造的多 ⇒ 這把尺在斷言不是我弄壞的東西').toHaveLength(3);
  });

  it('🔴 突變②:選填欄位全空 ⇒ 必須【綠】(少了這一發,把整條規則放寬也會讓突變①過)', () => {
    const stripped = syntheticEntry();
    for (const f of OPTIONAL) delete stripped[f];

    expect(
      emptyRequiredFields(stripped),
      `選填欄位(${OPTIONAL.join('/')})空著是合法的,本閘不得因此變紅 —— 那會讓它一裝就紅`,
    ).toEqual([]);
  });

  it('🔴 突變③:`logoScale` 是數字 ⇒ 0 必須算空(少了它,磚牆 logo 會消失而本閘全綠)', () => {
    expect(emptyRequiredFields({ ...syntheticEntry(), logoScale: 0 })).toEqual(['logoScale']);
    expect(emptyRequiredFields({ ...syntheticEntry(), logoScale: 0.88 })).toEqual([]);
  });

  it('🔴 型別漂移:REQUIRED/OPTIONAL 兩份清單必須與型別檔一致(有人加欄位時本格要紅)', () => {
    const src = readFileSync(join(__dirname, 'brand-content-types.ts'), 'utf8');
    const body = src.slice(src.indexOf('export type BrandContent'));
    const end = body.indexOf('\n};');
    expect(end, '在型別檔裡切不出 BrandContent 的本體 ⇒ 本格的前提失效,不是通過').toBeGreaterThan(0);

    // 只認【頂層】欄位(縮排剛好兩空白),不然巢狀型別的欄位會被算進來。
    const declared = [...body.slice(0, end).matchAll(/^ {2}(?:readonly )?([A-Za-z_]\w*)(\??):/gm)];
    expect(declared.length, '型別檔裡一個頂層欄位都沒抓到 ⇒ 這把尺沒有接上').toBeGreaterThan(0);

    expect(declared.filter((m) => !m[2]).map((m) => m[1]).sort()).toEqual([...REQUIRED].sort());
    expect(declared.filter((m) => m[2]).map((m) => m[1]).sort()).toEqual([...OPTIONAL].sort());
  });
});
