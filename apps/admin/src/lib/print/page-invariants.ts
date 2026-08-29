// 列印出來的紙上,**兩件事不可以發生**。本檔只答「給我每一頁上的字,哪一頁違規」。
//
// 🔴 **為什麼是兩道而不是一道**(2026-08-29 線G 當場逐格量的,不是設計出來的):
//    ```
//    5 項 ⇒ 1 頁                                  兩道都綠（正對照：好的世界不誤報）
//    6 項 ⇒ 2 頁，p2 全空                          🔴 守門一紅 ／ 守門二綠
//    7 項 ⇒ 2 頁，p2 = 訂單金額 + QR 頁尾           守門一綠 ／ 🔴 守門二紅
//    ```
//    ⇒ **守門一抓不到 7 項那個病,守門二抓不到 6 項那個病** ⇒ 兩道都要裝。
//    ⇒ 裝一道會得到一個綠,而那個綠是真的、只是問錯問題。
//
// 🔴🔴 **本檔一個數字都不盯** —— 6 與 7 是在【我們發明的 fixture 品名長度】下量到的,
//    真實品名長短不同 ⇒ 兩個門檻都會漂。**盯形狀,不盯數字。**
//
// 🔴🔴 **錨要正規化, 否則整道守門【恆綠】。**
//    PDF 抽出來的中文**不是原始碼裡那個字**:`shipping-doc.tsx` 寫 `訂單金額`(金 = U+91D1),
//    而抽出來是 `訂單⾦額`(⾦ = U+2FA6,康熙部首)。當場量:
//    ```
//    '訂單⾦額'.includes('訂單金額')                        ⇒ false
//    '訂單⾦額'.normalize('NFKC') === '訂單金額'.normalize('NFKC') ⇒ true
//    碼位 8a02 55ae 2fa6 984d  ──NFKC──▶  8a02 55ae 91d1 984d
//    ```
//    ⇒ 一個照抄原始碼字面的守門會在【每一頁】都回 0 ⇒ 兩道斷言全部恆綠,
//      **而它綠得非常乾淨:沒有錯誤、沒有警告、rc=0。**
//    ⇒ 所以 {@link hasAnchor} 一律走 NFKC,而呼叫端**必須**跑 {@link assertAnchorsAlive}。

/**
 * 兩邊都 NFKC + **把連續空白壓成一個空格**之後再比。
 *
 * 🔴 **空白那一半是 2026-08-30 被一發突變逼出來的, 不是想到的**:
 *    丁的跨頁頁首印的是「出貨明細單 訂單編號 … · 箱號 …」,而**單獨的「訂單編號」四個字
 *    在第 2 頁的客服說明裡就有**(逐字「並提供本單上的訂單編號」)
 *    ⇒ 用「訂單編號」當錨 ⇒ **把 `.pd-runhead` 整個關掉, 守門照樣全綠。**
 *    📌 **⇒ 那個錨【在對的世界與錯的世界印同一個答案】** —— 而它看起來非常合理。
 *    ⇒ 改用**複合錨**(兩個詞相鄰,只有頁首那裡相鄰);而 PDF 抽字會在中間塞換行
 *      ⇒ 沒有這道壓縮的話,複合錨會**每一頁都不命中**(那是另一個方向的假答案)。
 */
export function hasAnchor(pageText: string, anchor: string): boolean {
  const squash = (t: string) => t.normalize('NFKC').replace(/\s+/g, ' ');
  return squash(pageText).includes(squash(anchor));
}

export interface PageAnchors {
  /** 品項列的錨(例如料號前綴)。ASCII 的話不受正規化影響,但仍走同一條路。 */
  readonly item: string;
  /** 金額合計那一行的錨。 */
  readonly money: string;
}

/**
 * 🔴 **正對照:每一個錨都要在【整份文件】裡至少命中一次。**
 *
 * 沒有這一道的話,一個打錯的錨會讓下面兩道守門在每一頁都算出「沒有」——
 * 而「沒有」正好是它們用來判斷的東西 ⇒ 守門一會全紅(假紅)、守門二會全綠(假綠)。
 * ⇒ **錨死掉與紙壞掉,在下面兩道底下長得不一樣但都不可信** ⇒ 先擋在這裡。
 */
export function assertAnchorsAlive(pages: readonly string[], a: PageAnchors): string[] {
  const all = pages.join('\n');
  const dead: string[] = [];
  if (!hasAnchor(all, a.item)) dead.push(`品項錨 ${JSON.stringify(a.item)} 在整份文件裡零命中`);
  if (!hasAnchor(all, a.money)) dead.push(`金額錨 ${JSON.stringify(a.money)} 在整份文件裡零命中`);
  return dead;
}

/**
 * 守門一 · **每一頁都必須有東西**。
 * 抓的是「多印一張白紙」——員工把一張只有頁首頁尾的紙一起交給客人。
 */
export function blankPages(pages: readonly string[], a: PageAnchors): number[] {
  const bad: number[] = [];
  pages.forEach((t, i) => {
    if (!hasAnchor(t, a.item) && !hasAnchor(t, a.money)) bad.push(i + 1);
  });
  return bad;
}

/**
 * 守門二 · **錢不可以跟品項分家**。
 * 抓的是「客人第二張紙上只有一個總額和一個 QR,而它旁邊沒有任何品項」。
 *
 * ⚠️ 金額那一行**沒有出現在任何一頁**時本函式回空陣列 —— 那一格由
 * {@link assertAnchorsAlive} 擋,不在這裡重複判(重複判會讓錨死掉時印出一個看起來合理的綠)。
 */
export function moneyPagesWithoutItems(pages: readonly string[], a: PageAnchors): number[] {
  const bad: number[] = [];
  pages.forEach((t, i) => {
    if (hasAnchor(t, a.money) && !hasAnchor(t, a.item)) bad.push(i + 1);
  });
  return bad;
}

/** 跨頁頁首 / 頁尾的錨(丁,Sean 2026-08-30)。 */
export interface RunningChrome {
  /** 頁首上一定會有的字(續頁靠它認出「這是哪一張單」)。 */
  readonly head: string;
  /** 頁尾上一定會有的字。 */
  readonly foot: string;
}

/**
 * 守門三 · **每一頁都要有頁首與頁尾**(丁,Sean 2026-08-30 逐字:
 * 「第七項變成第二張也沒關係,只要看起來好看就好,因為第二頁理論上會有跟第一頁一樣的
 * 重複上方欄位…但是有頁尾就好也可以」)。
 *
 * 🔴 **它為什麼與守門一、二【不同族】**:那兩道問的是「內容有沒有掉到不該在的頁」,
 *    而這一道問的是「**這一頁自己看起來是不是一張完整的紙**」。
 *    ⇒ Sean 要的不是「回到一頁」,是「第二頁不要看起來像印壞了」。
 *
 * 🔴🔴 **它盯的機制【沒有任何別的東西會替它報錯】** —— 跨頁重複靠的是
 *    `<thead>` / `<tfoot>` 的預設 `table-header-group` / `table-footer-group`。
 *    有人把 `.pd-runhead` 改成 `display:block`(或把那層 `<table>` 換成 div 排版),
 *    **螢幕上一模一樣、三綠全綠、單測全過**,只有第 2 頁的紙上少了那一行。
 *    ⇒ 而少的那一行正是「這是哪一張單」——**員工手上會有一張認不出來源的紙。**
 *
 * @returns 違規的頁碼(1-based),每頁附缺哪一邊。
 */
export function pagesMissingRunningChrome(
  pages: readonly string[],
  c: RunningChrome,
): string[] {
  const bad: string[] = [];
  pages.forEach((t, i) => {
    const missing: string[] = [];
    if (!hasAnchor(t, c.head)) missing.push('頁首');
    if (!hasAnchor(t, c.foot)) missing.push('頁尾');
    if (missing.length > 0) bad.push(`第 ${i + 1} 頁缺 ${missing.join(' 與 ')}`);
  });
  return bad;
}
