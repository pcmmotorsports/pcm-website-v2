// @vitest-environment node
//
// brand-focus-data.test.ts — N°05 覆蓋層那 20 家**資料本身**的保真守門(D5e-2;2026-08-05)
//
// 🔴 這支存在的理由,是「搬 20 家」這個動作的失敗形狀**在畫面上看不出來**:
//    一次貼 20 家 × (鉤子 + 照片 + 三則事實),抄錯一個字、少一對括號、把全形標點
//    「順手修正」回半形 —— typecheck 綠、lint 綠、`brand-focus.test.ts` 也綠
//    (那支問的是「每一家都**有**東西」,不問「那東西**對不對**」)。
//    而每家只在輪播上出現 3 天 ⇒ 錯的那家要等到輪到它才被看到,大概率沒人在看。
//
// 🔴 **抽樣不算數**。下面每一條都跑滿 20 家 / 60 對事實,不挑幾家看。
//
// 🔴🔴 **但這支答不了「20 家的鉤子文字都對嗎」——講清楚它涵蓋到哪裡為止**
//    (R1 must-fix:原本這裡寫「答案是這支」,**超出實際能力**。R1 實測:把一家 title 的
//     中文字改掉一個〔`後移`→`前移`〕、標點不動,**這支 25 條全綠**)。
//    原因是結構性的,不是漏寫測試:
//      · `facts` 有 repo 內的對照權威(`BRAND_CONTENT`)⇒ 抄錯一個字就對不上,下面那組抓得到。
//      · `title` / `body` **在 repo 內沒有任何對照權威** —— 它們的真權威是 OD 專案檔
//        `brand-focus-data.js`,那份檔不在 repo 裡,測試讀不到、也不該把它複製進來當第二份。
//    ⇒ 鉤子文字的保真是**搬運當下用腳本逐字比對**確認的(D5e-2:兩邊各自求值成物件、
//      逐欄嚴格比對,20/20 零差異;R1 用獨立腳本複驗,同樣 0 diff)。
//      那是**一次性的搬運驗證**,不是這支的持續守門。
//    ⇒ 這支持續守的是「**契約可機械檢查的那一部分**」:事實值的來源、標點、照片。
//      **鉤子與敘述的文字內容不在射程內**,改壞了要靠 code review 與肉眼。
//
// 資料來源真權威 = Open Design `pcm-home-redesign/brand-focus-data.js`。
// ⚠️ 那份檔**不在本 repo**(在 OD 專案目錄)⇒ 測試沒辦法直接對它比對。
//    所以這支改成守「資料自己該滿足的**契約**」,那些契約來自 OD 檔頭與 `N05-FOCUS-HANDOFF.md`:
//    事實值必須取自 `BRAND_CONTENT`、標點必須全形、照片必須是 repo 相對路徑且不與品牌頁 hero 撞。
//    ⇒ 抄錯值會紅(因為對不上 `BRAND_CONTENT`),抄錯標點會紅,抄錯路徑會紅(資產守門那支)。

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { BRAND_CONTENT } from './brand-content';
import { BRAND_FOCUS } from './brand-focus';

const ASSET_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/brand-assets');
const BY_SLUG = new Map(BRAND_CONTENT.map((b) => [b.slug, b]));

/**
 * CJK 全形括號正規化。
 *
 * 🔴 **只有這一族要正規化,而且是刻意的**:2026-08-05 Sean 拍板標點改全形,OD 端已全面套用,
 *    但 `brand-content.ts` **這一片不准動**(handoff §十 + 驗收第 12 條「除了新增 `wallTagline`
 *    外一個字都沒動」)⇒ LIGHTECH 的 Racing 值在兩邊必然差一對括號:
 *    本檔 `（2026 SYNC SPEEDRS）`、`brand-content.ts` `(2026 SYNC SPEEDRS)`。
 *    ⇒ 比對時把括號寬度抹平,**其餘一個字都不放寬**(不是抽樣、不是模糊比對)。
 *    那一顆另有下面「全形標點」那條單獨釘住,所以抹平不會讓它變成沒人管。
 */
const normalizeBrackets = (s: string) => s.replace(/（/g, '(').replace(/）/g, ')');

describe('N°05 覆蓋層 · 20 家逐一保真(非抽樣)', () => {
  it('前提:20 家全到齊,且每一家都對應真 slug(空集合會讓下面全部空跑)', () => {
    const keys = Object.keys(BRAND_FOCUS);
    expect(keys, 'BRAND_FOCUS 不是 20 家 ⇒ 搬運漏了或多了').toHaveLength(20);
    expect(BRAND_CONTENT, 'BRAND_CONTENT 不是 20 家 ⇒ 下面的對照基準本身變了').toHaveLength(20);
    for (const k of keys) expect(BY_SLUG.has(k), `BRAND_FOCUS['${k}'] 不對應任何品牌`).toBe(true);
  });

  // ── 事實保真:60 對逐一對照 BRAND_CONTENT ──────────────────────────────
  // OD 檔頭逐字契約:「值一律取自 brand-content-data.js 該品牌的 facts 清單,
  //                  不自行增列標籤、不改寫值」。
  // 🔴 這條是本支的**主要判別力來源**:它讓「抄 20 家」這個動作有了機械檢查 ——
  //    任何一個標籤或值抄錯一個字,那一對就對不上 `BRAND_CONTENT`,紅在那一家那一格。
  //
  // 🔴 **比 tuple、不比接起來的字串**(R2 F1,實測是真的假綠):
  //    原本把兩欄接成 `${label} ${value}` 再做 membership,開了兩個洞 ——
  //      ① **切分點移位**:`['Made', 'in 英國']` 與 `['Made in', '英國']` 接起來一模一樣
  //         ⇒ 抄錯欄界不會紅。
  //      ② **重複同一對**:三則全填同一對合法事實,membership 三次都命中
  //         ⇒ R2 實測 73 條全綠。
  //    兩者都正好落在本檔自稱的「抄 20 家的機械檢查」射程內,是真缺口不是理論缺口。
  //    ⇒ 改成逐欄比對 tuple + 要求三則標籤互異(OD 契約「不自行增列標籤」也蘊含這件事)。
  describe('三則事實的標籤與值都取自 BRAND_CONTENT(不自行增列、不改寫、不重複)', () => {
    for (const [slug, overlay] of Object.entries(BRAND_FOCUS)) {
      it(`事實對得上:${slug}`, () => {
        const brand = BY_SLUG.get(slug)!;
        const readable = brand.facts.map((f) => `[${f[0]} | ${f[1]}]`).join(' ');
        expect(overlay.facts, `${slug} 的事實不是恰好三則`).toHaveLength(3);
        for (const [label, value] of overlay.facts) {
          // 逐欄比:標籤要完全相同,值只抹平 CJK 括號寬度(理由見 normalizeBrackets)。
          const hit = brand.facts.some(
            (f) => f[0] === label && normalizeBrackets(f[1]) === normalizeBrackets(value),
          );
          expect(
            hit,
            `${slug} 的事實 [${label} | ${value}] 在 BRAND_CONTENT 找不到相同的一對`
              + `(抄錯值/抄錯標籤/切錯欄界/自行增列都會落在這裡)。`
              + `該品牌可用的是:${readable}`,
          ).toBe(true);
        }
        const labels = overlay.facts.map(([label]) => label);
        expect(
          new Set(labels).size,
          `${slug} 的三則事實有重複標籤(${labels.join(' / ')})⇒ 多半是同一對被貼了兩次,`
            + `而三則都合法時 membership 式的比對抓不到。可用的是:${readable}`,
        ).toBe(3);
      });
    }
  });

  // ── 標點:2026-08-05 Sean 拍板改全形,禁止「順手修正」回半形 ───────────────
  // 判準(handoff §七逐字):**前一個字是中文才全形**;英數字後面維持半形
  // (`Pontyclun, South Wales`、`mo.unit, mo.view` 是英文語境)。
  // ⚠️ 只掃文案欄(title / body / 事實值),**不掃 photo**:資產路徑一律不動。
  it('🔴 中文後面不得出現半形標點(全形規則;搬過來時最容易被「順手修正」掉)', () => {
    const offenders: string[] = [];
    for (const [slug, overlay] of Object.entries(BRAND_FOCUS)) {
      const texts = [overlay.title, overlay.body ?? '', ...overlay.facts.map((f) => f[1])];
      for (const text of texts) {
        // 🔴 字元類要含 `.!?`(R1 nit:原本只有 `,:;()`,中文後接半形句點/驚嘆號不會紅)。
        for (const m of text.matchAll(/[,:;().!?]/g)) {
          // 🔴 **要跳過空白往回看**(R1 nit,實測 M6b `中文 (Slovenia)。` 整組逃逸):
          //    左括號前面通常有一個空格,只看緊鄰的前一字會看到空白、判為「不是中文」而放行。
          const prev = text.slice(0, m.index).replace(/\s+$/, '').at(-1);
          if (prev && /\p{Script=Han}/u.test(prev)) {
            offenders.push(`${slug}: 「…${prev}${m[0]}…」 中文後應用全形`);
          }
        }
      }
    }
    expect(offenders, `有 ${offenders.length} 處中文後接半形標點:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });

  // 🔴 反向那一半(R1 nit:原本只守單向,實測「英數字後誤用全形括號」全綠)。
  //    handoff §七逐字:判準是「前一個字是中文才全形」⇒ **英數字後面維持半形**,
  //    `Pontyclun, South Wales`、`mo.unit, mo.view` 全形會很怪。單向守門只擋一半的錯。
  it('🔴 英數字後面不得出現全形標點(規則是雙向的,不是「全形越多越好」)', () => {
    const offenders: string[] = [];
    for (const [slug, overlay] of Object.entries(BRAND_FOCUS)) {
      const texts = [overlay.title, overlay.body ?? '', ...overlay.facts.map((f) => f[1])];
      for (const text of texts) {
        // 🔴 **右括號 `）` 不在射程內,這是刻意的**:括號的寬度由**這一對**決定,
        //    而那一對看的是**左括號**前面是什麼。LIGHTECH 的
        //    `技術支援（2026 SYNC SPEEDRS）` 就是實例 —— 左括號前是「援」⇒ 整對全形是對的,
        //    但右括號前面是 `S`。把右括號也照「前一字」判,會判出一條**要求把資料改錯**的紅
        //    (實測會紅在 lightech)。⇒ 只判左括號與其餘標點。
        for (const m of text.matchAll(/[，：；（。、！？]/g)) {
          const prev = text.slice(0, m.index).replace(/\s+$/, '').at(-1);
          // 只在「前一個字是拉丁字母或數字」時判違規;前面是中文或字串開頭都不管。
          if (prev && /[A-Za-z0-9]/.test(prev)) {
            offenders.push(`${slug}: 「…${prev}${m[0]}…」 英數字後應用半形`);
          }
        }
      }
    }
    expect(offenders, `有 ${offenders.length} 處英數字後接全形標點:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });

  it('🔴 LIGHTECH 那顆刻意的全形括號還在(它是唯一與 brand-content.ts 不同的一顆)', () => {
    // 上面的事實比對把括號寬度抹平了 ⇒ 若沒有這條,有人把它「對齊」成半形也不會紅。
    // 這條單獨把它釘住:全形是新規則、是對的那一版;半形是 `brand-content.ts` 尚未遷移的舊版。
    const racing = BRAND_FOCUS['lightech']!.facts.find(([label]) => label === 'Racing');
    expect(racing, 'lightech 的 Racing 那則不見了').toBeDefined();
    expect(racing![1], 'lightech 的括號被改回半形 ⇒ 違反 2026-08-05 全形拍板').toContain(
      '（2026 SYNC SPEEDRS）',
    );
  });

  // ── 照片 ─────────────────────────────────────────────────────────────
  it('每家 photo 都是 repo 相對路徑、且落在自己品牌的資料夾(不得混到別家或外部圖床)', () => {
    for (const [slug, overlay] of Object.entries(BRAND_FOCUS)) {
      expect(
        overlay.photo,
        `${slug} 的 photo 不是 assets/brands-prod/${slug}/ 底下的檔`
          + '(外部圖床會隨時壞掉、指到別家則是抄錯行)',
      ).toMatch(new RegExp(`^assets/brands-prod/${slug}/[^/]+$`));
    }
  });

  // 🔴 驗收條件第 4 條(handoff §九):「每家照片 ≠ 該品牌頁的 hero(`band.src`),20 家實測無撞圖」。
  //    ⚠️ **比對檔案內容不是比對路徑**:兩張圖存成不同檔名照樣是同一張,
  //    而「首頁與品牌頁看到不同的照片」正是這個版位存在的理由(OD 檔頭逐字)。
  //    路徑不同是必要非充分 —— 所以這條算 sha256。
  it('🔴 20 家的 focus 照片都不等於自己品牌頁的 hero,彼此之間也不重複(比內容,不比路徑)', () => {
    const sha = (p: string) => createHash('sha256').update(readFileSync(join(ASSET_ROOT, p))).digest('hex');
    const seen = new Map<string, string>();
    // 🔴 前提斷言要排在**迴圈之前**(R1 nit):原本放在迴圈後,而迴圈內的斷言會先 throw
    //    ⇒ 「提早跳出」這件事永遠走不到那條檢查 = 它只是重複了第一條的 20 家、零判別力。
    const entries = Object.entries(BRAND_FOCUS);
    expect(entries, '前提:要比對的是 20 家,少了的話下面是空跑').toHaveLength(20);
    for (const [slug, overlay] of entries) {
      const focusHash = sha(overlay.photo);
      // 🔴 `band` 在型別上是選填 ⇒ 先斷言它在,不用 `!` 硬吞:
      //    某家哪天沒了 hero,這一輪的「不得相同」就變成拿不到對照組 = 恆真放行。
      const band = BY_SLUG.get(slug)!.band;
      expect(band, `${slug} 沒有品牌頁 hero(band)⇒ 這一家的撞圖比對會失去對照組`).toBeDefined();
      const heroHash = sha(band!.src);
      expect(
        focusHash,
        `${slug}:首頁 focus 照片與品牌頁 hero 是同一張圖 ⇒ 點進去沒有「還有別的」的感覺`,
      ).not.toBe(heroHash);
      const dup = seen.get(focusHash);
      expect(dup, `${slug} 與 ${dup} 用了同一張 focus 照片(內容相同、檔名不同)`).toBeUndefined();
      seen.set(focusHash, slug);
    }
  });

  // 🔴 R1 nit:`normalizeBrackets` 套用在 20 家身上,但只有 LIGHTECH 那一顆需要它。
  //    今天它「恰好最窄」(R1 實測:把它換成 identity,只有 lightech 一條紅),
  //    但那是**今天的資料碰巧**,不是被釘住的性質 —— 第 21 家出現括號寬度分歧時,
  //    會被這個放寬**靜默吸收**,而沒有任何一條會紅。這條把「唯一例外」本身變成斷言。
  it('🔴 括號寬度正規化只對 LIGHTECH 一家有作用(放寬的射程被釘住,不會靜默吸收下一家)', () => {
    const needsNormalizing = Object.entries(BRAND_FOCUS)
      .filter(([slug, overlay]) => {
        const source = BY_SLUG.get(slug)!.facts.map((f) => `${f[0]} ${f[1]}`);
        // 不正規化就對不上、正規化之後才對得上的,就是「靠這個放寬過關」的那幾家。
        return overlay.facts.some(
          ([label, value]) =>
            !source.includes(`${label} ${value}`)
            && source.map(normalizeBrackets).includes(normalizeBrackets(`${label} ${value}`)),
        );
      })
      .map(([slug]) => slug);
    expect(
      needsNormalizing,
      '靠括號寬度正規化才過關的品牌不只 LIGHTECH 一家 ⇒ 要嘛是新的刻意偏離(請比照 LIGHTECH'
        + '單獨釘住並在檔頭說明),要嘛是抄錯了括號寬度。放寬不該無聲擴大。',
    ).toEqual(['lightech']);
  });
});
