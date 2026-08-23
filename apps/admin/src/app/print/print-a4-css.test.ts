import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A4 版面(Sean 2026-08-17 四條需求裡,本檔守的是**第 1、2、4 條**)的守門。
// ⚠️ 2026-08-17 更新:這一行原本寫「第 1、2 條」,而第 4 條(頁碼)已落地並在本檔有兩格。
//
// 🔴🔴 **先講這一族【證不了】什麼,免得它被讀成「A4 驗過了」:**
//    這裡全部是**檔案字面**與**掛勾對得上**的檢查。**紙上長什麼樣,一個字都沒有量。**
//    A4 尺寸對不對、12mm 邊距實際印出來多寬、一列會不會被切成兩半 —— **未確認**,
//    要 Sean 用真印表機印一次才驗得掉(已排進他的清單)。
//    ⇒ 這一族的價值只有一個:**這些字面與掛勾【不會靜默消失】** ——
//      而它們消失的症狀是「紙印出來不是 A4」,三綠、build、其他單測**都不會紅**。
//
// 📎 為什麼不寫「`getComputedStyle` 量 `@page`」那種格:`@page` 讀不到 computed style,
//    而 jsdom 連 print media 都沒有。真要量得走真瀏覽器產 PDF —— 那是 Sean 那一關。

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CSS = read('./print-a4.css');
// 🔴 **規則層要與註解層分開**:本檔的註解裡就寫著 `table-header-group`(解釋為什麼不搬它)
//    ⇒ 直接對全文 `not.toContain` 會被**自己的說明文字**弄紅。
//    📎 這不是我先想到的,是那一格當場紅給我看的 —— 同族坑見
//       `docs/patterns/guard-and-instrument-traps.md`「偵測字串自命中」。
const CSS_RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const LAYOUT = read('./layout.tsx');
const SHIPPING = read('../../components/print/shipping-doc.tsx');
const PICKING = read('../../components/print/picking-doc.tsx');
const GLOBALS = read('../globals.css');

// 🔴 **`PAGE_DECL` 而不是 `[^}]*`**(2026-08-17,code-reviewer R1 nit):
//    `@page` 現在**裡面有巢狀區塊**(第 4 條的 `@bottom-center`)⇒ `[^}]*` 跨不過它的結束大括號
//    ⇒ 有人多加一個邊距框、或把它往上搬(**合法且無害**),依賴順序的那些格就會紅,
//    **而那個紅不指向任何真問題**。假紅的代價不是浪費時間,
//    是「看過幾次假紅的人會開始改測試而不是改 code」。
//    ⇒ 這個 pattern 允許跨過**一層**巢狀區塊。
const PAGE_DECL = String.raw`@page\s*\{(?:[^{}]|\{[^{}]*\})*`;

describe('A4 版面第 1 條 —— `@page` 逐字照 OD 樣張', () => {
  // 樣張 `shipping-picking-doc-a4.html:21` 逐字:`@page{ size:A4 portrait; margin:12mm 12mm 14mm 12mm; }`
  // 🔴 分開釘 `size` 與 `margin` 兩條,而不是比對整段字串 —— 整段比對會被「多一個空格」弄紅,
  //    那種紅不指向任何真問題,而**看過幾次假紅的人會開始改測試而不是改 code**。
  it('size = A4 portrait', () => {
    expect(CSS).toMatch(new RegExp(PAGE_DECL + String.raw`\bsize:\s*A4 portrait;`));
  });

  it('margin 四個 mm 值與樣張一字不差(12 / 12 / 14 / 12)', () => {
    // ⚠️ 這格會抓到的是**打錯數字**與**刪掉 margin**;抓不到「印出來邊距其實不對」。
    // ⚠️ 而且它量的是**原始檔** —— 產物會被壓成三值(見下方第 4 條 describe 的 ② )。
    expect(CSS).toMatch(new RegExp(PAGE_DECL + String.raw`\bmargin:\s*12mm 12mm 14mm 12mm;`));
  });

  it('🔴 負向對照 —— `@page` 不得住進 `globals.css`(那會讓後台每一頁列印都變 A4)', () => {
    // `@page` 是頁面層 at-rule、**沒有選擇器可以侷限它** ⇒ 唯一的侷限手段就是「哪些路由載入它」。
    // 這一格同時證明上面兩格量的是**這支 route-scoped CSS**,不是碰巧全站都有。
    expect(GLOBALS).not.toContain('@page');
  });
});

describe('A4 版面第 2 條 —— 跨頁表格', () => {
  it('`tr` 有 break-inside / page-break-inside: avoid(樣張 `:130` 逐字)', () => {
    expect(CSS).toMatch(/\btr\s*\{[^}]*break-inside:\s*avoid;/);
    expect(CSS).toMatch(/\btr\s*\{[^}]*page-break-inside:\s*avoid;/);
  });

  it('🔴 刻意【沒有】搬 `thead{display:table-header-group}` —— 它等於 UA 預設', () => {
    // 這一格釘的是一個**刻意的不作為**,而不作為在檔案上看不出來。
    // 依據:`picking-doc.tsx`(錨點 `跨頁表頭:已實測會自動重複`)2026-08-15 真瀏覽器量測
    // 含負向對照(注入 `display:table-row-group !important` ⇒ 第 2 頁欄名整排消失)。
    // ⇒ 搬過來會是一條永遠不會失效的字面。有人「順手補齊樣張」時,這格會紅並把他帶去讀那段。
    expect(CSS_RULES).not.toContain('table-header-group');
    // 正向對照:證明上面那個 0 是「規則層真的沒有」,不是 `CSS_RULES` 被剝成空字串。
    expect(CSS_RULES).toContain('@page');
    expect(PICKING).toContain('跨頁表頭:已實測會自動重複');
  });
});

describe('A4 版面第 4 條 —— 頁碼(`@page` 邊距框)', () => {
  // 🔴 **這一族證不了紙上有沒有頁碼**(檔頭那段對本 describe 一樣適用)。
  //    它證的是唯一一件事:**這段字面不會靜默消失** ——
  //    消失的症狀是「印出來的紙沒有頁碼」,而三綠 / build / 其他單測**一格都不會紅**。
  // 🔴 **紙上到底印不印得出頁碼,目前【未確認】** —— 缺的那道檢查寫在 `print-a4.css`
  //    第 4 條那段註解裡:2026-08-17 Sean 是印過量具、回「一切正確」,
  //    **而量具要的是「照抄紙上那行字」,他給的是總評**;加上 Chrome 自己的頁尾選項
  //    有沒有關掉沒有紀錄 ⇒ **在「生效」與「Chrome 自己印的」兩個世界,那句話是同一句。**
  //    ⇒ 本 describe 更不能被讀成「頁碼驗過了」。它守的只有「字面不會靜默消失」。
  //
  // ── 🔴 落地當天量到、而下一個人會重踩的兩件(2026-08-17,`TURBO_FORCE=1 pnpm build` 之後)──
  //  ① **產物不在 `.next/static/css/`,那個目錄根本不存在** ⇒ 對它下 grep 會拿到 `0`,
  //     而那個 0 是**分母為 0**,不是「被剝掉了」。我當場就被這個 0 騙過一次,
  //     是**正向對照**(同一支 grep 找 `A4 portrait` 也回 0)把它揪出來的。
  //     ✅ 真正的位置:`apps/admin/.next/static/chunks/*.css`。
  //     實測該檔 `A4 portrait` / `bottom-center` / `counter(pages)` 各 1 命中,
  //     **負向對照**:同目錄另一支 chunk 三項全 0 ⇒ 命中不是「哪支都會中」。
  //  ② **產物與原始檔【不逐字相同】**:`margin:12mm 12mm 14mm 12mm` 被壓成
  //     **三值** `margin:12mm 12mm 14mm`(CSS shorthand 三值 = 上 / 左右 / 下,**等價**,不是錯)。
  //     ⇒ 拿本檔守的原始檔字面去 grep 產物會**撲空**。上面那些格量的是**原始檔**,那是刻意的。

  it('`@bottom-center` 在 `@page` 【區塊裡面】,且 content 用 counter(page)', () => {
    // 🔴 **「在裡面」是這一格的重點,不是順便**:`@bottom-center` 掉到 `@page` 外面
    //    是**無效 CSS ⇒ 被瀏覽器整段丟掉**,而檔案讀起來一模一樣、沒有任何東西會紅。
    //    ⇒ 下面這條 regex 的 `[^}]*` 就是在證明「兩者之間沒有結束大括號」。
    // ⚠️ 用 `CSS_RULES`(已剝註解)不用 `CSS`:本檔的註解裡就引了樣張那句
    //    `@bottom-right{content:counter(page)}` ⇒ 對全文比對會被**自己的說明文字**餵成綠的。
    // 🔴 **`content:` 這個 property 名要釘進 regex,不能只釘 `counter(page)`**
    //    —— 這一條是 code-reviewer R1 用突變打出來的,我原本的版本漏了它:
    //      · `content:` 打成 `contnet:`  ⇒ 舊版**全綠**,而紙上沒有頁碼
    //      · content 值拿掉引號(無效宣告被整條丟掉)⇒ 舊版**全綠**,紙上也沒有頁碼
    //    兩者都比「有人刪掉整塊」更可能真的發生,而我當初的突變(刪整塊)
    //    **打在這族最容易被抓到的那一發上** ⇒ 那個綠是量錯東西量出來的。
    expect(CSS_RULES).toMatch(
      new RegExp(PAGE_DECL + String.raw`@bottom-center\s*\{[^}]*content:\s*[^}]*counter\(page\)`),
    );
  });

  it('印的是「第 N 頁 / 共 M 頁」—— 兩個 counter 都在', () => {
    // 只有 `counter(page)` 而沒有 `counter(pages)` 時,紙上是「第 2 頁」而看不出總共幾頁
    // ⇒ **員工不知道自己手上這疊有沒有缺頁**,而那正是 Sean 要頁碼的理由。
    expect(CSS_RULES).toMatch(/@bottom-center\s*\{[^}]*content:\s*[^}]*counter\(pages\)/);
  });
});

describe('🔴 掛勾對不上 = CSS 寫了等於沒寫', () => {
  it('`layout.tsx` 真的 import 了 `print-a4.css`', () => {
    // 這是本族**判別力最高**的一格:CSS 檔可以完美無缺而**沒有任何路由載入它**,
    // 而那個狀態下上面每一格都照樣綠。
    expect(LAYOUT).toContain("import './print-a4.css'");
  });

  it('兩張紙的容器都帶 `print-sheet`,而 CSS 裡真的有這個選擇器', () => {
    // workspace-shell 那族踩過的形狀:TSX 的 class 名與 CSS 選擇器對不上 ⇒ 兩邊各自看起來都對。
    expect(SHIPPING).toContain("'print-sheet mx-auto");
    expect(PICKING).toContain("'print-sheet mx-auto");
    expect(CSS).toMatch(/\.print-sheet\s*\{[^}]*padding:\s*0;/);
  });

  it('🔴 `.print-sheet` 的宣告【全部】住在 `@media print` 裡(螢幕上的 `p-6` 要留著)', () => {
    // 掉出 @media print ⇒ 螢幕上那張紙會貼著視窗邊緣,而**列印結果一模一樣** ⇒ 沒人會回報。
    //
    // 🔴🔴 **R3 MF1:這一格原本用 `CSS.indexOf('@media print')` 當邊界,而那是【碰巧的字面】。**
    //    2026-08-23 片1 之後,`@media print` 這幾個字**第一次出現在 `:109` 的一句註解裡**
    //    (真 block 在 `:153`)⇒ **這一格只掃了 833 行的前 109 行。**
    //    實測突變:在 `:400`(任何 `@media print` 之外)插入 `.print-sheet{font-size:9pt}`
    //    ⇒ **三條斷言全綠**,而那正是 R1 修掉的「字級外溢到揀貨單」原樣復活。
    //    🔴 **而那句 `:109` 的註解,是修 R1 那條時寫下來的** ——
    //       **修一個病的動作,把守門的邊界往前搬了 44 行。**
    // ⇒ 改用**規則層**(`CSS_RULES`,註解已剝):邊界由**真的 at-rule** 決定,不由註解決定。
    // ⚠️ 並且改成掃**全部**出現位置,不只「第一個之前」——
    //    原寫法即使邊界對,也只保證「第一個 block 之前沒有」,**第二個 block 之後仍是盲區**。
    const first = CSS_RULES.indexOf('@media print');
    expect(first, '規則層找不到 @media print ⇒ 本格沒有判別力').toBeGreaterThan(-1);
    expect(CSS_RULES.slice(first)).toContain('.print-sheet');
    // 🔴 逐個 `.print-sheet` 出現位置檢查它是不是落在某個 `@media` 區塊裡面。
    const inMedia = (idx: number): boolean => {
      // 從檔頭走到 idx,數還沒關掉的 `@media` 大括號 —— 深度 > 0 就代表在區塊內。
      let depth = 0;
      let atDepth = -1;
      for (let i = 0; i < idx; i += 1) {
        // 🔴 **R4 F2:只認 `@media print`,不是任何 `@media`。**
        //    本格的標題與 `print-a4.css` 的不變式都寫「在 `@media print` **之外**不加宣告」,
        //    而原本 `startsWith('@media', i)` 接受**任何** media ⇒ 把外溢規則包進
        //    `@media screen{…}` 就整條放行(R4 實測綠;我在真 runner 上覆過 ⇒ 12 passed)。
        //    🔴 失敗情境不是假想:R1 修掉的「字級外溢到揀貨單」包進 `@media screen` 就完整復活
        //       —— **而這道守門會告訴下一個人「包進 @media 就對了」。**
        if (CSS_RULES.startsWith('@media print', i)) atDepth = depth;
        else if (CSS_RULES[i] === '{') depth += 1;
        else if (CSS_RULES[i] === '}') {
          depth -= 1;
          if (depth <= atDepth) atDepth = -1;
        }
      }
      return atDepth >= 0;
    };
    const spots: number[] = [];
    for (let i = CSS_RULES.indexOf('.print-sheet'); i !== -1; i = CSS_RULES.indexOf('.print-sheet', i + 1)) {
      spots.push(i);
    }
    expect(spots.length, '規則層一個 .print-sheet 都沒有 ⇒ 本格恆真').toBeGreaterThan(0);
    for (const at of spots) {
      const line = CSS_RULES.slice(0, at).split('\n').length;
      expect(inMedia(at), `規則層第 ${line} 行的 .print-sheet 在 @media 之外`).toBe(true);
    }
  });
});

describe('🔴🔴 反方向掃描 —— 元件掛了、而 CSS 沒有的 `pd-*`(R3 MF2)', () => {
  // 🔴🔴 **這一族是我 R2 那一掃【漏掉的方向】,而漏掉的那一半才會害人。**
  //    我掃的是「CSS 有、元件沒有」= 死規則 ⇒ **無害**(只是多了幾行 CSS)。
  //    會害人的是**反方向**:**元件掛了一個類,而沒有任何規則接它**
  //    ⇒ 畫面上那一區**拿不到它該有的語彙**,而三綠全綠、沒有任何東西會叫。
  //    📌 判別句(2026-08-23 主視窗給的):**我這一掃,漏掉的東西會落在哪一邊?**
  //       兩個方向的工作量看起來一樣,**所以人會選比較好寫的那一個。**
  //
  // 🔴 實例:`pd-pending` 全 repo 零規則,而 `shipping-doc.tsx` 掛著它。
  //    ⚠️ **稿本身也不完整**(實查 `預覽-出貨明細單.html`):
  //       `pd-pending`   markup 用 1 次 / CSS 規則 **0** 條  ← 只掛不用
  //       `pd-cancelled` markup 用 0 次 / CSS 規則 **2** 條  ← 只用不掛
  //       **兩個各缺相反的一半。** ⇒ 不能靠「照抄稿」得到完整的語彙。

  /** 元件原始碼裡出現的 `pd-*`(剝註解 —— 否則本檔與元件的說明文字會自命中)。 */
  const emitted = (src: string): Set<string> => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const out = new Set<string>();
    for (const m of code.matchAll(/\bpd-[a-z0-9-]+/g)) out.add(m[0]);
    // 🔴 動態組:`pd-${variant}` —— 它在字面上抓不到,而它正是 MF2 那一個。
    //    ⇒ 把同檔宣告的 union 成員也算進來。抓不到 union 就**紅**,不放行。
    if (/pd-\$\{/.test(code)) {
      const u = /variant\?:\s*([^;]+);/.exec(code);
      expect(u, '元件有 `pd-${…}` 動態類,而本格找不到它的 union 宣告 ⇒ 掃描不完整').not.toBeNull();
      // 🔴🔴 **R4 F1:找到宣告 ≠ 抽到成員。** `[^;]+` 可以匹配成功而內層抽出 **0 個**,
      //    而那條路徑原本是**靜默**的 —— 只要有人把 union 抽成具名型別
      //    (`variant?: SectionVariant;`),`pd-pending`/`pd-cancelled` 就整層離開分母,
      //    **而守門照樣綠**(R4 實測:n 由 40 掉到 38,綠;我在真 runner 上覆過 ⇒ 12 passed)。
      //    ⇒ 那正是「加第三個 variant」時最可能發生的重構 ⇒ **R3-MF2 原樣復活。**
      let added = 0;
      for (const m of (u?.[1] ?? '').matchAll(/'([a-z0-9-]+)'/g)) {
        out.add(`pd-${m[1]}`);
        added += 1;
      }
      expect(
        added,
        `找到 union 宣告 \`${u?.[1]?.trim() ?? ''}\` 但抽不出任何成員 ⇒ 動態類整層離開分母`,
      ).toBeGreaterThan(0);
    }
    return out;
  };

  /**
   * 刻意「只掛勾、不上樣式」的類。**每一個都要寫理由** ——
   * 沒有理由的話,這張白名單就會變成「把紅的關掉」的地方。
   */
  const HOOK_ONLY: Record<string, string> = {
    // 稿的 markup 有這個修飾類而**稿自己也沒有規則**(實查:CSS 0 條)。
    // 我們照鐵則 1 把它掛著,但它**目前不產生任何視覺差異** ——
    // 「尚未出貨」與「本次出貨」在紙上長得一樣,而那是**設計端的缺口**,不是我們漏搬。
    // ⚠️ 要給它視覺語彙,得 Sean 看過 —— 我不自己發明一個他沒看過的樣子。
    'pd-pending': '稿與我們都零規則;設計端缺口,已回報 OD。不自己發明視覺。',
    // 純結構包裝:`.pd-contact{display:flex}` 需要一個子節點裝那三行字,
    // 而那三行各自有規則(`.pd-ch` / `.pd-cu` / `.pd-cp` 稿的 CSS 各 1 條,實查)。
    // 稿自己也是「markup 用 1 次 / CSS 0 條」⇒ 照鐵則 1 掛著,它不承載任何視覺。
    'pd-ctxt': '純結構包裝;稿同樣零規則,三個子類才帶樣式。',
  };

  it('🔴 元件掛的每一個 `pd-*`,CSS 都要接得住(或在白名單裡並寫明理由)', () => {
    const names = new Set([...emitted(SHIPPING), ...emitted(PICKING)]);
    expect(names.size, '一個 pd-* 都沒掃到 ⇒ 本格恆真').toBeGreaterThan(10);
    const orphan = [...names].filter(
      (n) => !new RegExp(`\\.${n}(?![\\w-])`).test(CSS_RULES) && !(n in HOOK_ONLY),
    );
    expect(orphan, `元件掛了但 CSS 沒有規則的類:${orphan.join(', ')}`).toEqual([]);
  });

  it('🔴 白名單本身要是活的 —— 裡面的類【必須】真的還零規則', () => {
    // 沒有這一格的話,白名單會在規則補上之後繼續留著,
    // 而**下一個人會以為那個類仍然沒有樣式**。
    for (const [n, why] of Object.entries(HOOK_ONLY)) {
      expect(why.length, `${n} 的白名單理由是空的`).toBeGreaterThan(10);
      expect(
        new RegExp(`\\.${n}(?![\\w-])`).test(CSS_RULES),
        `${n} 已經有 CSS 規則了 ⇒ 請把它從白名單移除`,
      ).toBe(false);
    }
  });
});
