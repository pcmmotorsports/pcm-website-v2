// overlay-focus.ts — ⟦fc-FOCUSTRAP⟧ 全屏覆蓋層的焦點處理,**單一定義點**。
//
// 🔴🔴 **為什麼是一支共用檔,而不是每支元件各打一份**
//    這一族有五支全屏層(`position:fixed; inset:0`),而它們都要用同一把「誰可以被聚焦」的尺:
//      · 開啟時把焦點移進來 ⇒ 用它算 `first`
//      · Tab 循環 ⇒ 用它算 `first` / `last`
//    ⇒ 而 **2026-09-02 我在 FilterDrawer 第一版就把它打了兩份**:移入只找 `button`、循環找四種
//      ⇒ 抽屜第一個若是 `<a>` / `<input>`,**移入的落點與循環的 `first` 不是同一個元素**
//      ⇒ ⇒ 而 FilterDrawer 今天第一個剛好是 `button` ⇒ **它今天不發作**
//      ⇒ ⇒ ⇒ 📌 **那種分岔【不會紅】** —— 三發突變一格都沒抓到它,是 code-reviewer 讀 diff 抓的。
//    ⇒ 所以複製到其餘幾支之前先抽出來:**一把尺被重打一份,兩份會分岔,而分岔不會紅。**
//
// ⚠️ **已知不完整,而它是【照抄的代價】不是疏忽**
//    這串少了 `textarea` 與 `[tabindex]:not([tabindex="-1"])`。
//    來源是 `MobileMenu.tsx:131`(本族最早、也是唯一完整的實作),而它也少。
//    ⇒ 補它 = 同時改 MobileMenu 並重驗它 ⇒ **那是另一片**,已另開一列。
//    🔴 而在補之前,任何用 `tabindex` 或 `<textarea>` 做的可聚焦元素**不在這把尺的分母裡**
//       ⇒ 它會變成循環的漏網:Tab 走到它就出去了,而測試全綠。
//
// 🛑 **而這一族守得住什麼、守不住什麼(不要讀成等價物)**
//    ✅ 守得住:Tab / Shift+Tab 走不出覆蓋層
//    🔴 **守不住:螢幕閱讀器仍然讀得到背景** —— 那要 `inert`
//       而 🔬 `-fc` 2026-09-02 拋棄式探針實測:**jsdom 對 `inert` 零判別力**
//       (設之前 `focus()` 成功、設之後照樣成功 ⇒ `discriminates = false`)
//       ⇒ 走 `inert` 那條路的產出會是「動了全站共用容器換到一格證不到任何事的綠」
//       ⇒ ⇒ 所以它被**正確地延後**到一個量得到它的世界,不是被放棄。

/**
 * 覆蓋層內「可以被 Tab 走到」的元素。
 *
 * 🔴 **兩處必須用同一個常數**:算 `first`(移入的落點)與算循環的端點。
 *    分開打會分岔,而分岔在測試裡不會紅 —— 見檔頭。
 * 🔵 `:not([disabled])` 不可省:一顆 disabled 的鈕會變成循環的端點,而它按不下去
 *    ⇒ 客人會覺得 Tab「卡住了」。
 */
export const OVERLAY_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])';

/** 覆蓋層內所有可聚焦元素(DOM 順序)。`panel` 為 null ⇒ 空陣列,呼叫端不必自己防。 */
export function overlayFocusables(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return [...panel.querySelectorAll<HTMLElement>(OVERLAY_FOCUSABLE)];
}

/**
 * Tab 循環:在**兩端**攔截,中間交給瀏覽器原生行為。
 *
 * 🔴 **只攔兩端** —— 攔中間的話那不是循環,是綁架(客人在面板裡也走不動)。
 * 🔵 回傳 `true` = 這一次按鍵被我們處理掉了;呼叫端可以據此決定要不要繼續往下判別的鍵。
 *    ⚠️ 而 `SwatchLightbox` 那支的 keydown 裡有 `ArrowLeft` / `ArrowRight` 換圖
 *    ⇒ **循環必須放在那些鍵【之後】或只在 `Tab` 時介入**,否則左右鍵會失效,
 *      而那個壞法是「客人打不開下一張圖」而測試全綠(沒有人問過左右鍵)。
 */
export function trapTabInOverlay(e: KeyboardEvent, panel: HTMLElement | null): boolean {
  if (e.key !== 'Tab') return false;
  const f = overlayFocusables(panel);
  const first = f[0];
  const last = f[f.length - 1];
  if (!first || !last) return false;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/**
 * 開啟時把焦點移進覆蓋層 —— **它是循環的前提,不是額外的禮貌。**
 *
 * 🔴 不做它 ⇒ 焦點留在 `body`(`-fc` 2026-09-02 在 `.pd-lightbox` 上實測到的正是這個)
 *    ⇒ 客人按第一下 Tab 是從**整頁最上面**開始走 ⇒ 要走完背景才進得來
 *    ⇒ ⇒ **循環要等幾十下才生效 = 等於沒做。**
 * 🔵 而落點刻意是 `first`(不是「關閉鈕」)—— 這樣它與循環算出來的 `first` **是同一個元素**。
 *    ⚠️ `MobileMenu` 走的是另一種(聚焦關閉鈕、而它排在第 2 個)⇒ 已量過:**零代價**,
 *       因為循環只在 `activeElement === first` 時才攔 ⇒ 從第 2 個按 Shift+Tab 不進那個分支。
 */
export function focusFirstInOverlay(panel: HTMLElement | null): void {
  overlayFocusables(panel)[0]?.focus();
}
