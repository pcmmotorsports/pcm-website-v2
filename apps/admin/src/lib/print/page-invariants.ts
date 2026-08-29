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

/** 兩邊都 NFKC 之後再比 —— 理由見檔頭那段碼位。 */
export function hasAnchor(pageText: string, anchor: string): boolean {
  return pageText.normalize('NFKC').includes(anchor.normalize('NFKC'));
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
