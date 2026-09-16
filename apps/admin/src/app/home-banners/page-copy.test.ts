import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME_BANNER_MAX_SLIDES } from '@pcm/domain';
import { describe, expect, it } from 'vitest';

// page-copy.test.ts — 釘住後台「首頁大圖」那一頁【對員工下指令的那幾句話】。
//
// 🔴 **這支存在的理由,是在它之前那幾句話【沒有人在看】**:
//    `apps/admin/src/app/home-banners/` 底下只有 `page.tsx`、全庫沒有任何一格斷言到它的文案
//    ⇒ 兩句假話(「首頁只會顯示最近上架的那一張」)與一句指錯列的話活了一整天。
//
// 🔴 **而這支刻意【不逐字快照】那幾句**(a5 2026-09-17 判準):
//    文案本來就會改 ⇒ 每次改文案都紅 ⇒ 兩週後有人把它 skip 掉 ⇒ 回到今天。
//    ⇒ 只釘【會跟現實脫鉤的那幾格】,每一格都寫成**機械判定得出來**的形狀。
//
// ✅ 證得到:`page.tsx` **原始碼字面**上那幾句話的形狀,以及它與 `HOME_BANNER_MAX_SLIDES` 的一致性。
// ⛔ 證不到:渲染出來長什麼樣、員工讀完會不會做對事。那要 Sean 自己開瀏覽器。
//
// 🔬 **每一格都寫成 `xxxProblems(來源) => string[]` 的純函式**,正對照餵真檔、負對照餵改壞的同一支。
//    ⇒ 兩邊走的是**同一段程式**;不會出現「正對照過了而那道閘其實量不到東西」。

const PAGE = 'apps/admin/src/app/home-banners/page.tsx';
const SRC = readFileSync(join(process.cwd(), PAGE), 'utf8');

/**
 * 🔴 **先把註解剝掉再比**(2026-09-16 在 `home-banner-duplicate-sql.test.ts` 踩過同一個洞)。
 * 不剝的話這支當場就是假的:`page.tsx` 的註解裡**逐字留著**被劃掉的舊句
 * 「要收起來請按【那張】的『下架』」—— 那正是本支要抓的字串。
 * ⇒ 不剝 ⇒ ②那格**永遠紅**;而若房規改成不留刪節線,它又會**永遠綠**。兩種都不是守門。
 */
function stripComments(src: string): string {
  return src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 切出頁面最上面那塊「現在首頁掛的是哪張」(`hb-live`)的**可見文案**。
 * 邊界用兩個穩定的標記,不解析巢狀 JSX;形狀變了就 throw,不要靜靜切到空字串。
 */
function liveBlock(src: string): string {
  const m = stripComments(src).match(/data-testid='home-banner-live'([\s\S]*?)<table className='hb-table'>/);
  if (m?.[1] === undefined) throw new Error(`切不出 hb-live 那一塊 ⇒ ${PAGE} 形狀變了, 先看它再改測試`);
  return m[1];
}

/** ① 說明裡的張數上限不可以寫死 —— 要插值 `{HOME_BANNER_MAX_SLIDES}`。 */
function hardcodedLimitProblems(src: string): string[] {
  const hits = stripComments(src).match(/最多\s*\d+\s*張/g) ?? [];
  return hits.map((h) => `「${h}」把上限寫死了, 要改成插值 {HOME_BANNER_MAX_SLIDES}`);
}

/**
 * ② hb-live 裡,講到「下架」的句子不准用無錨點的「這張 / 那張」。
 *
 * ⚠️ 「**自動下架**」先剝掉:那是上架→下架那一欄的**狀態標籤**,不是叫人動手的話,
 *    而它跟「連同這張共 N 張」住在同一句裡 —— 不剝的話這一格會在**正確的文案上**紅。
 * ⚠️ 也只管 hb-live 這一塊:面板標題「找不到**這張**大圖」的「這張」有錨點(你剛點了它),
 *    全面禁只會逼出更爛的文案。
 */
function pronounProblems(src: string): string[] {
  return liveBlock(src)
    .replace(/自動下架/g, '')
    .split(/[。;;·]/)
    .filter((s) => s.includes('下架') && /[這那]張/.test(s))
    .map((s) => `這句講下架而用了指示代名詞, 讀的人得自己推:${s.trim().slice(0, 40)}…`);
}

/** ③ 文案說「一起輪播」,那碼就必須真的放得下不只一張。 */
function carouselClaimProblems(src: string, maxSlides: number): string[] {
  if (!stripComments(src).includes('一起輪播')) return [];
  return maxSlides > 1 ? [] : [`文案說會一起輪播, 而 HOME_BANNER_MAX_SLIDES = ${maxSlides} ⇒ 首頁只掛得下一張`];
}

describe('🔬 正對照:讀到的真的是那一頁, 而剝註解真的在做事', () => {
  it('抓得到那支元件與 hb-live 那一塊', () => {
    expect(SRC).toContain('export default async function HomeBannersPage');
    expect(SRC).toContain("data-testid='home-banner-live'");
    expect(SRC.length).toBeGreaterThan(5000);
  });

  it('🔴 stripComments 不是空操作:JSX 註解剝掉、看得見的字留著', () => {
    // 沒有這一格的話, stripComments 可以整段拿掉而下面三格照樣全綠。
    // ⚠️ 這一格餵**合成字串**, 不餵真檔:真檔的註解內容會被人改寫(刪節線房規不是永久的),
    //    綁上去就會在【沒有壞掉的時候】紅。
    const sample = "<span>{/* ⛔ ~~要收起來請按那張的「下架」~~ */}要收起來, 按要收的那一張</span>";
    expect(stripComments(sample)).not.toContain('那張的');
    expect(stripComments(sample)).toContain('要收的那一張');
  });

  it('🔴 而真檔裡確實有 JSX 註解要剝(否則上一格在這支上是空轉)', () => {
    expect(SRC).toContain('{/*');
  });

  it('🔴 「一起輪播」與「最多 … 張」兩個判準的錨點都還在頁面上', () => {
    // 錨點不在 ⇒ ①的第二格與③會靜靜變成空集合而恆綠。
    expect(stripComments(SRC)).toContain('一起輪播');
    expect(stripComments(SRC)).toContain('最多 {HOME_BANNER_MAX_SLIDES} 張');
  });
});

describe('現在這一頁的文案', () => {
  it('① 沒有把張數上限寫死', () => {
    expect(hardcodedLimitProblems(SRC)).toEqual([]);
  });

  it('② 講下架的句子都不用「這張 / 那張」', () => {
    expect(pronounProblems(SRC)).toEqual([]);
  });

  it('③ 說會輪播, 而 HOME_BANNER_MAX_SLIDES 真的大於 1', () => {
    expect(carouselClaimProblems(SRC, HOME_BANNER_MAX_SLIDES)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔬 **負對照(docs/patterns/guard-and-instrument-traps.md ④-a:收工前拿一個【已知會過】
//    與一個【已知該紅】的東西各餵一次)**。沒有這一段, 上面三格可能只是恆綠。
//    ⚠️ 三格餵的都是**真實發生過的錯法**, 不是憑空造的字串。
// ─────────────────────────────────────────────────────────────────────────────
describe('🔬 負對照:把已知的錯法餵進同一道閘, 每一格都要咬', () => {
  it('① 有人把插值改回寫死的數字 ⇒ 咬', () => {
    const mutated = SRC.replace('最多 {HOME_BANNER_MAX_SLIDES} 張', '最多 4 張');
    expect(mutated).not.toBe(SRC); // 先證明這個 replace 真的換到東西
    expect(hardcodedLimitProblems(mutated)).not.toEqual([]);
  });

  it('② 把 2026-09-17 之前那句指錯列的話放回去 ⇒ 咬', () => {
    const mutated = SRC.replace(
      '<b>發布新的不會自動收掉舊的</b>;要收起來,到下面列表點開<b>要收的那一張</b>,按它的「下架」。',
      '<b>發布新的不會把這張下架</b>;要收起來請按那張的「下架」。',
    );
    expect(mutated).not.toBe(SRC);
    expect(pronounProblems(mutated)).toHaveLength(2); // 舊句兩個分句各一個指錯列的代名詞
  });

  it('③ 上限被改回 1 而文案照樣講輪播 ⇒ 咬', () => {
    // 🔴 這正是 2026-09-16 的實況:顧客站是 `.limit(1)`, 而後台文案講多張。
    expect(carouselClaimProblems(SRC, 1)).not.toEqual([]);
  });
});
