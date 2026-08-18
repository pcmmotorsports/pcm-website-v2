'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * 11=丙:訂單列表右邊被切掉的欄,在**看不到的人的螢幕上**講出來。
 *
 * Sean 2026-08-18 中午逐字 `11 外接螢幕看不到三欄 = 丙`
 * (memory `project_0818-sean-eleven-rulings-noon.md` 落地含義節逐字:
 *  「訂單列表死區 ⇒ **在被切掉的地方加看得見的提示**」;同節逐字註明
 *  「他的 1728 螢幕看不到這個病,只有 1440/1600 外接螢幕的員工會撞到」)。
 *
 * 🔴🔴 **觸發條件是【真的溢出】,不是視窗斷點。** 這是本片最要緊的一句:
 *    斷點是猜的 —— 側邊欄收合、瀏覽器縮放、字級變大都會改變可視寬,而視窗寬一格沒動。
 *    ⚠️ **精確講:比的是「每個 `<th>` 的右緣 vs 容器的右緣」,不是 `scrollWidth > clientWidth`**
 *    (codex R2 nit:原本這行寫成後者,而那是**另一個判準** —— 它只答得出「有沒有溢出」,
 *     答不出「哪幾欄」,而這一片要點名。兩者在「有沒有」這一題上等價,在本檔用的是前者)。
 *    重量時機用 `ResizeObserver`(容器 + 表格)與容器的 `scroll`。
 *
 * 🔴 **為什麼不能只靠捲軸**:macOS 的覆蓋式捲軸**在你捲之前是看不見的**
 *    (實測 `offsetHeight - clientHeight` = 2,那 2 是邊框不是捲軸)
 *    ⇒ 員工在 1440 螢幕上**沒有任何訊號**告訴他右邊還有欄位。
 *
 * 量到的病(真後台 + 真瀏覽器,2026-08-18;內容寬 1,412 px):
 * ```
 * 1280  看不到 326 px   完全看不到:客戶 狀態 發票 操作     被切一半:金額
 * 1440  看不到 166 px   完全看不到:發票 操作             被切一半:狀態
 * 1600  看不到   6 px   完全看不到:(無)                 被切一半:操作
 * 1728  看不到   0 px   ← Sean 的螢幕。這一列在他那邊【不會出現】,那是對的
 * ```
 * ⚠️ 上表量在**一張 5 品項的單**上(拋棄式庫、非正式站);欄寬不隨資料變,但字長會。
 */
export function OrdersCutoffNotice() {
  /**
   * 🔴 **每一顆自己的 id,用 `useId()` 不用固定字串。**
   * 我上一版用 `export const ORDERS_CUTOFF_NOTICE_ID = 'orders-cutoff-notice'`,
   * codex R4 判 must-fix:**一頁兩張表就會有兩個一樣的 id**,
   * 第二個 region 的 `aria-describedby` 會讀到第一張表的提示 ——
   * 這與 R1 抓到的 `document.querySelector` 是**同一個病**(全域唯一的假設),我換了個地方再犯一次。
   */
  const noticeId = useId();
  // `null` = 還沒量(SSR 與第一次 paint 之前);`[]` = 量過而沒有欄被切。
  const [cutColumns, setCutColumns] = useState<string[] | null>(null);
  /**
   * 🔴 **恆存在的空殼,不是可以順手拿掉的包裝。**
   * 它是這個元件認得自己那張表的唯一辦法:`hostRef.current.closest('.orders-grid')`
   * 找的是**包住這一顆元件自己的**那個捲動容器。
   * 🔴 用 `closest` 不用 `parentElement`:後者要求「元件一定是 grid 的直接子節點」,
   *    那是一個**沒有東西在守的排版假設** —— 中間哪天多包一層 div,量測就靜默壞掉。
   * ⚠️ 原本寫 `document.querySelector('.orders-grid')`,codex R1 判 must-fix:那會**永遠拿到
   *    整頁第一張表** —— 一頁兩張表時,兩個元件都量第一張,第二張溢出了卻沒人講,
   *    而第一張被掛兩組 listener。今天一頁只有一張,所以**畫面上看不出差別**。
   */
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = hostRef.current?.closest<HTMLElement>('.orders-grid');
    if (!grid) return;

    const measure = () => {
      const box = grid.getBoundingClientRect();
      // 🔴 用**表頭**認欄名:它是這張表唯一寫著欄名的地方,而且與 `<td>` 同欄寬。
      // 🔴 判準是「右緣超出容器」= **沒有完整顯示**,含只被切一半的那一欄
      //    (1440 實測:`狀態` 只切一半,而切一半的狀態欄**讀不出值**,對員工等於看不到)。
      //    ⇒ 文案寫「沒有完整顯示」不寫「看不到」:後者對半切的欄是**說過頭**。
      const cut = [...grid.querySelectorAll<HTMLElement>('thead th')]
        .filter((th) => th.getBoundingClientRect().right > box.right + 0.5)
        .map((th) => th.textContent?.trim() ?? '')
        .filter((t) => t.length > 0);
      setCutColumns(cut);

      /**
       * 🔴 **容器的鍵盤與無障礙狀態由這裡開關,不是寫死在 `orders-table.tsx` 上。**
       * codex R4 判 must-fix:寫死的話,**沒有溢出的螢幕(例如 Sean 的 1728)也會多一個 Tab 停點,
       * 而且那一區的名字還宣稱「可左右捲動」** —— 對他是一句錯的指示。
       * 只有這裡知道「現在到底捲不捲得動」⇒ 由這裡設。
       * · 有溢出 ⇒ `tabIndex=0`(WCAG 2.1.1:可捲動區域要能拿到鍵盤焦點,否則純鍵盤的人捲不動)
       *          + `role=region` + 名字帶「可左右捲動」+ `aria-describedby` 指向那句話
       * · 沒溢出 ⇒ **四個屬性全部移掉**,回到一個乾淨的 `<div>`
       */
      if (cut.length > 0) {
        grid.setAttribute('tabindex', '0');
        grid.setAttribute('role', 'region');
        grid.setAttribute('aria-label', '訂單列表(可左右捲動)');
        grid.setAttribute('aria-describedby', noticeId);
      } else {
        for (const attr of ['tabindex', 'role', 'aria-label', 'aria-describedby']) {
          grid.removeAttribute(attr);
        }
      }
    };

    measure();

    // 🔴 **捲動也要重量**(真瀏覽器抓到的:第一版只在 resize 時重量)。
    //    員工往右捲之後那三欄就看得到了,而那句話還在說「右邊還有 3 欄」
    //    ⇒ **一個不會退場的提示,下一次就沒人看它了。**
    //    捲到最右 ⇒ 右緣沒有東西超出 ⇒ `cut` 變空 ⇒ 這一列**自己消失**,
    //    那個消失本身就是「你已經看完了」的回饋。
    grid.addEventListener('scroll', measure, { passive: true });

    // 🔴 `ResizeObserver` 在 jsdom 裡**不存在**(實測 `ReferenceError: ResizeObserver is not defined`,
    //    而它會把整支 `orders-table.test.tsx` 一次弄紅 84 格)。
    //    ⚠️ 這個 guard 是**環境相容**,不是「可有可無」:少了觀察器,側邊欄收合/縮放時這一列不會更新。
    //    ⚠️ 而且 jsdom **沒有版面引擎** ⇒ 那裡的 `getBoundingClientRect()` 全是 0
    //       ⇒ `cut` 恆為空 ⇒ **這一列在 jsdom 裡永遠不出現**。
    //       ⇒ 🔴 **這一片的真守門只能在真瀏覽器上**(見 commit body 的量測表);
    //          jsdom 那格守的是「沒有溢出時不得長出東西」,守不到正向那一半。
    if (typeof ResizeObserver === 'undefined') {
      return () => grid.removeEventListener('scroll', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    // 🔴 **表格本身也要觀察**(codex R1 must-fix)。原本只觀察容器 ——
    //    而容器寬是版面決定的、**它不會因為內容變寬而變**:
    //    字型晚載入、訂單筆數/字長改變都會把表格撐寬,那時「還有幾欄看不到」變了,
    //    而容器一個像素都沒動 ⇒ ResizeObserver 不會叫 ⇒ **提示停在舊答案上。**
    const table = grid.querySelector('table');
    if (table) ro.observe(table);
    return () => {
      grid.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [noticeId]);

  // 🔴 **不能 `return null`** —— `hostRef` 沒掛上去的話,上面那個 effect 永遠找不到容器。
  //    沒有東西要講的時候渲染一個**空的**殼(零高度、零內容)。
  if (cutColumns === null || cutColumns.length === 0)
    return <div ref={hostRef} id={noticeId} />;

  return (
    <div ref={hostRef} id={noticeId}>
      <div
        // 🔴 `sticky left-0` 是承重的:這一列住在**會左右捲動的容器裡**,
        //    沒有它的話捲到右邊時這句話自己也捲出畫面 —— 而它正是要告訴你「右邊有東西」。
        // 🔴 `w-fit` 不能省:sticky 元素若寬度等於表格寬(1,412),`left-0` 貼住的是那個寬度的左緣,
        //    看起來像沒生效。
        // 🔴 **刻意【沒有】`role='status'`**(codex R1 must-fix):`status` 是 polite live region,
        //    而這句話會在**每次跨過一個欄界**時改內容 ⇒ 螢幕閱讀器會一路重唸「還有 3 欄…還有 2 欄…」。
        //    它是**常駐的操作說明**,不是狀態播報 ⇒ 讓它照 DOM 順序被讀到就好(它就在表格正上方)。
        // `print:hidden`:紙**不能捲**,把一句叫人捲動的話印出去是負值(codex R3)。
        //  ⚠️ 它只藏這句提示,**沒有解決「印出來的表格一樣會被裁掉」** —— 那是列印樣式的另一題。
        className='border-border bg-muted text-foreground sticky left-0 z-20 w-fit border-b px-3 py-1.5 text-xs print:hidden'
        // 🔴 `note` 是**非 live** 的角色:遇到才讀,不會像 `status` 那樣每次改內容就插播。
        //    捲動容器用 `aria-describedby` 指到**外層那個恆存在的空殼**(id 見 `noticeId`)
        //    ⇒ 螢幕閱讀器進到那一區時會讀到這句;沒有東西要講時空殼是空的,描述就是空的
        //    (codex R4 查過:空節點依規範**等同沒有描述**,不會比缺屬性更糟)。
        //    ⚠️ 我原本在註解裡寫成 `<table aria-describedby>`,而它其實掛在**外層捲動容器**上
        //    —— codex R4 nit,字面與事實差一層。
        //    🔴 **我原本在這裡寫「那個 id 會有一半時間指向不存在的節點,所以做不到」——
        //       codex R3 判 must-fix,而它是對的:空殼本來就恆渲染,id 掛在空殼上就沒有這個問題。
        //       那句話是【把做得到的事寫成做不到】。**
        role='note'
        data-cutoff-notice=''
      >
        → 右邊還有 {cutColumns.length} 欄沒有完整顯示:
        <span className='font-medium'>{cutColumns.join('、')}</span>。 這一區可以左右捲動,或把左邊的側邊欄收起來。
      </div>
    </div>
  );
}
