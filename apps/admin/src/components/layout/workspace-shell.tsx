'use client';

import * as React from 'react';

import {
  MIN_PANEL_WIDTH,
  WORKSPACE_PANEL_COOKIE,
  WORKSPACE_PANEL_COOKIE_MAX_AGE,
  clampPanelWidth,
  defaultPanelWidth,
  maxPanelWidth,
} from '@/lib/layout/workspace-panel';

// workspace-shell.tsx — #350b 工作區殼:內容區 + 可調寬度的右側面板槽。
//
// 🔴 **面板是共用基礎設施,不是訂單專屬**(wave-plan `:23`:「D 的殼落地後,E 的取消畫面與
//    B 的收款/對帳讀面都掛進同一個右側面板系統」)⇒ 本檔**不認得任何業務概念**,只認「有沒有內容」。
//
// 🔴 **為什麼 `children` 與 `panel` 是 props 而不是在這裡渲染**:本檔是 client component
//    (drag 需要),而各頁面與面板內容**必須維持 server component**(PII 白名單投影 + server action,
//    鐵則 12 ②)。當成 ReactNode 收進來,它們仍在 server 渲染、只是被塞進這個殼。
//    (2026-08-10 code-reviewer R1/R2 兩輪實跑 `next build` 複驗:所有 route 仍 server-rendered、
//     `prerender-manifest.json` 零真實 route 被預渲染、無既有頁被拉進 client bundle。)
//
// ── 🔴🔴 捲動模型:**刻意不改**(code-reviewer R1 第一條 must-fix)────────────────
// 第一版把 row 寫成 `min-h-0 flex-1`、main 加 `overflow-auto`。那看起來只是排版,實際上是
// **把全站的捲動模型從「document 捲」換成「main 內捲」** —— `sidebar-wrapper` 有 `min-h-svh`,
// row 一旦 `min-h-0` 就拿到確定高度、`overflow-auto` 就真的生效。
// 後果不只是捲軸位置:`multi-check-filter.tsx` 那種非 portal 的 `absolute` 下拉
// (訂單列表篩選在用)會被新的 scroll container **裁切**。
// ⇒ 殼只負責「多切一欄」,不順手改每一個既有頁面的行為;面板自己的捲動留給 350c
//   (那時它有內容、看得見、驗得到)。`workspace-shell.test.ts` 有兩格釘住這條「不要做」。
//
// ── 🔴 寬度的夾範圍在 **CSS**,不在這裡(code-reviewer R2)──────────────────────
// 本檔只負責「使用者拖到多少」與「寫進 cookie」;**實際渲染寬度由 `globals.css` 的
// `min-width`/`max-width` 夾**。理由與取捨全文在那條規則旁邊(第一幀正確 + 不會因為縮視窗
// 把使用者存的偏好永久改小)。⇒ **本檔沒有 resize 監聽,那是刻意的。**

/** 拖曳把手的鍵盤步進(px)。 */
const KEYBOARD_STEP = 24;

export function WorkspaceShell({
  children,
  panel,
  initialPanelWidth,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
  /** server 端從 cookie 讀到的偏好;`null` = 還沒有偏好。 */
  initialPanelWidth: number | null;
}) {
  const [width, setWidth] = React.useState<number>(initialPanelWidth ?? 0);
  // 🔴 `viewport` **只服務 `aria-valuemax`**,不參與版面(版面由 CSS 夾)。
  //    分開之後,resize 不再碰 cookie ⇒ 使用者的偏好不會被縮視窗改掉。
  const [viewport, setViewport] = React.useState<number>(0);
  /** `.workspace-panel` 那個槽。🔴 只掛 `ref`,**不多包一層** —— 兩條 `:has()` 規則
   *  依賴「`{panel}` 是它的直接子代」(理由寫在下面 render 那段,測試另有一格釘著)。 */
  const panelSlotRef = React.useRef<HTMLDivElement | null>(null);
  /**
   * 🔴🔴 **使用者在【這個 session 裡】主動調過寬度了嗎。**
   *
   * 沒有它,下面那個 `MutationObserver` 會**蓋掉使用者剛拖出來的寬度**
   * (`-4a` 審查 2026-08-22 R1 MF1;jsdom 實際重現:使用者調到 544 ⇒ 面板再動一下 ⇒ **彈回 720**)。
   * 成因:觀察者掛上去之後**活過整個 session**,而 `subtree: true` ⇒ 面板裡任何一次 DOM 變動
   * 都會再跑一次 `apply()`,而 `apply()` 是**無條件** `setWidth`。
   *
   * 🔴 **為什麼不能改看 `initialPanelWidth`**:那是 SSR 從 cookie 帶下來的 prop,
   *    **整個 session 不變** —— 使用者拖曳走的是 `commit()`,它只寫 cookie、不會回頭改這個 prop。
   *    ⇒ 「這個 session 裡拖過沒有」與「上次來訪有沒有偏好」是**兩件事**,要各自記。
   * ⚠️ 用 `ref` 不用 `state`:它只在 effect 裡被讀,不參與渲染;放進 state 會多一輪 render。
   */
  const hasUserSetWidthRef = React.useRef(false);

  React.useEffect(() => {
    const sync = () => setViewport(window.innerWidth);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  /**
   * 沒有 cookie 偏好時的預設寬度。殼不認業務概念,只認「槽裡有沒有掛 `.panel-width-locked`」——
   * 訂單面板在 `@panel/orders/page.tsx` 的 JSX 裡帶著它。判斷在 JS 做、只決定**預設值**,
   * 寬度本身仍走 `commit()` 那條可拖曳、會記住的路徑
   * (2026-08-21 Sean 拍板「留著拖曳、預設值改 720」,推翻 08-19「固定 720、拿掉拖曳」)。
   *
   * 🔴🔴 **為什麼要 `MutationObserver`,而不是只在掛載時查一次(2026-08-22 線 E 修)**
   *    舊版把這段寫在上面那個 effect 裡、相依只有 `[initialPanelWidth]`,而它從頭到尾不變
   *    ⇒ **`querySelector` 只在元件掛載那一瞬間跑過一次。**
   *    平行路由的槽在**軟導航**時會換內容,而 `WorkspaceShell` **不會重新掛載**
   *    ⇒ 「先開訂單列表,再點一張單」這條路上,marker 是在**判斷做完之後**才進 DOM 的。
   *
   *    **實測(2026-08-22 真瀏覽器、真滑鼠點擊、視窗 1728;`-2e` 以不同工具獨立複現同一組數字):**
   *      直接貼網址 `?panel=…`  ⇒ 720 ✅(掛載時 marker 已在)
   *      從列表點一張單          ⇒ **864** ❌ = `defaultPanelWidth(1728)` = 視窗的一半
   *      視窗 1280 同樣點法      ⇒ **640** ❌ —— 比 720 還**窄**
   *    ⚠️ **修好之後 1280 量到的是 716 不是 720,而那【不是誤差】**(`-4a` N4):
   *       CSS 的上限以 `.workspace-row`(= 視窗 − 側欄 84)為基準 ⇒ 1280 且側欄展開時上限就是 716。
   *       **在那台機器上,Sean 拍的 720 本來就拿不到** —— 那是 `MIN_CONTENT_WIDTH = 480` 的必然,
   *       是**產品事實不是缺陷**。別把那 4px 當成誤差去「修掉」。
   *    🔴 **方向會翻面這件事才是它真正的形狀**:不是「固定錯成 864」,是
   *       **寬度跟著視窗跑,而拍板的那個數字根本沒有進入計算。**
   *    ⇒ Sean 每天的動線就是「開列表 → 點單」⇒ **他從來沒有拿到過他自己拍的 720。**
   *
   * ⚠️ 觀察範圍限定在 `.workspace-panel` 這個槽(舊版查整份 document)——
   *    範圍越大,越可能被別處剛好同名的節點餵一個假的 true。
   * ⚠️ `initialPanelWidth !== null`(使用者拖過、有 cookie)⇒ **整段不跑**,行為與舊版一致:
   *    使用者的偏好優先於任何預設值。
   *
   * 🔴🔴 **而那件事在【改預設值】那一天有一個後果**(2026-08-24 codex important):
   *    ```
   *    改預設值【不影響】任何已經有 cookie 的人 —— 他們的偏好直接短路掉這一段。
   *    cookie 活 WORKSPACE_PANEL_COOKIE_MAX_AGE = 60*60*24*7 = 7 天
   *      (`lib/layout/workspace-panel.ts:23` 逐字, 量到的)
   *    ⇒ 🔴 **拍板的人自己最可能看不到自己拍的改動** —— 他是拖曳過最多次的那一個。
   *    ```
   *    ⇒ 沒有 migration、沒有清除機制,而**那是刻意的**(偏好優先是這一段的設計)。
   *    ⇒ 驗收時要嘛開無痕視窗、要嘛先清掉那顆 cookie;
   *      否則「看起來沒改」是**預期行為**,不是 bug。
   *    ⚠️ **這一段是紙上約束** —— 沒有任何東西會在他打開後台時提醒他。
   */
  React.useEffect(() => {
    if (initialPanelWidth !== null) return;
    const slot = panelSlotRef.current;
    if (slot === null) return;
    const apply = (): void => {
      // 🔴 使用者這個 session 已經自己調過 ⇒ 預設值退場,不得覆蓋他的選擇。
      if (hasUserSetWidthRef.current) return;
      const hasOrderPanelMarker = slot.querySelector('.panel-width-locked') !== null;
      // 🔴 **2026-08-24 Sean 逐字「面板寬度那題: 520」** —— 推翻他 08-21 拍的「預設值改 720」
      //    那一半;**「留著拖曳」那一半沒有被推翻**(另問過,他答「甲 留著」)⇒ 只改預設值。
      // ✅ 而 520 有一個 720 沒有的性質:**它拿得到。**
      //    上面 `-4a` N4 那段量到「1280 且側欄展開時上限就是 716」⇒ **Sean 拍的 720 在那台機器上拿不到**。
      //    `MIN_CONTENT_WIDTH = 480` ⇒ 520 需要 `vw − 480 ≥ 520`,即 **vw ≥ 1000**(再加側欄軌 84)。
      //    ⚠️ **2026-08-24 收窄(code-reviewer N-4)**:~~原句「日常視窗都滿足」~~ 是**推出來的**。
      //       反例:vw 1024 ⇒ `maxPanelWidth(1024) = 544`,扣側欄後 460 < 520 ⇒ **仍會被夾**。
      //       ⇒ 正確的說法是「**比 720 容易拿到**」,不是「都拿得到」。
      // 🔴 `520` **刻意寫成字面、不抽常數**:`workspace-shell.test.ts` 用原始碼字串
      //    (`/hasOrderPanelMarker\s*\?\s*520\s*:\s*defaultPanelWidth/`)釘著這條規則。
      //    抽成 `ORDER_PANEL_WIDTH` 會讓那格紅,而**行為一個字都沒變** ——
      //    我試過,然後選擇讓自己的寫法配合守門,而不是改守門的期望值。
      /* 🔴 **外面包 `clampPanelWidth`,不寫生的值**(`-4a` 審查 2026-08-22 N3;
         舊版同款不對稱,**非本片造成**)。`commit()`(拖曳/鍵盤)一直都夾,只有這裡沒夾
         ⇒ state 可能存著一個畫面上不成立的值,而 `aria-valuenow` 讀的就是 state
         ⇒ **螢幕閱讀器被告知一個錯的寬度。**

         ⚠️🔴 **而這一夾【只修掉一半】,誠實寫下來:**
           JS 上限 `maxPanelWidth(vw) = vw − 480` 用**視窗**寬;
           CSS 上限 `max-width: calc(100% - 480px)` 的 `100%` 是 **`.workspace-row`** 的寬
           = 視窗 − 側欄軌道。**兩邊的基準不同。**
         **真瀏覽器實量(2026-08-22 `localhost:3861`,面板開著):**
           側欄展開(84px 軌):1728 ⇒ row 1644 / 1280 ⇒ row 1196 ⇒ **視窗 − row = 84**(兩個尺寸一致)
           側欄收合(`app-sidebar.tsx:153` `return null`,整條不渲染):1280 ⇒ row **1280**,差 0
         ⇒ **被 CSS 夾住的臨界視窗寬:側欄展開 < 1284、側欄收合 < 1200。**
         ⇒ 1280 + 側欄展開時 JS 算 720(`vw−480=800` 夾不到)而 CSS 給 716 ⇒ **仍差 4px**。
            要完全消掉,`maxPanelWidth` 得改吃 row 的寬而不是視窗寬 —— 那會動到 `aria-valuemax`
            與拖曳夾寬的共用規則,**不在本片範圍**,標為已知缺口。 */
      setWidth(
        clampPanelWidth(hasOrderPanelMarker ? 520 : defaultPanelWidth(window.innerWidth), window.innerWidth),
      );
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(slot, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [initialPanelWidth]);

  /**
   * 使用者**主動**調整寬度時才走這裡(拖曳 / 鍵盤)——**唯一會寫 cookie 的路徑**。
   * 🔴 副作用不放在 `setWidth` 的 updater 裡:updater 依 React 契約必須純,
   *    StrictMode / concurrent 下會被重跑,被丟棄的 render 也會落 cookie。
   */
  const commit = React.useCallback((next: number) => {
    // 🔴 標記在**寫 state 之前**,而且在 updater 之外(updater 依 React 契約必須純,見下)。
    hasUserSetWidthRef.current = true;
    const clamped = clampPanelWidth(next, window.innerWidth);
    setWidth(clamped);
    // 🔴 server 端**真的會讀它**(`app/layout.tsx`)。
    //    ⚠️ 對照組:`ui/sidebar.tsx` 也寫 cookie,但 admin 的 `<SidebarProvider>` 沒傳 `defaultOpen`
    //    ⇒ 那顆只寫不讀、重整後側欄一律回展開。本檔刻意不重蹈。
    document.cookie = `${WORKSPACE_PANEL_COOKIE}=${clamped}; path=/; max-age=${WORKSPACE_PANEL_COOKIE_MAX_AGE}`;
  }, []);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => commit(window.innerWidth - ev.clientX);
      // 🔴 `pointercancel` 也要收尾(系統手勢/裝置切換會發它而不是 `pointerup`);
      //    漏了它,監聽會留在 window 上、下次滑鼠一動面板就自己跟著跑。
      const end = () => {
        if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    },
    [commit],
  );

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      /* 🔴 **鍵盤這條路不走 `commit()`**(它自己寫 cookie)⇒ 標記要在這裡再做一次。
         只標 `commit()` 的話,用鍵盤調寬的人仍然會被彈回 720 —— 而那是**兩條路裡比較安靜的那條**。
         ⚠️ 標在 updater **外面**:updater 依 React 契約必須純(理由同 `commit()` 那段)。

         ⚠️🔴 **而下面那個 `document.cookie` 就寫在 updater 【裡面】,那違反本檔 `commit()` 上方
            自己立的規矩**(逐字:「副作用不放在 `setWidth` 的 updater 裡…被丟棄的 render 也會落 cookie」)。
            **舊的、非本輪造成**,而本輪把 `ref` 正確標在外面 ⇒ **同一段裡兩種寫法並排**,
            `-4a` R2 nit 指出:註解只解釋了對的那一半。寫在這裡,免得下一個人照著錯的那一半抄。
            🔴 **本片不順手修它**:updater 是為了「同一 render 內連按兩下能累加」而存在(下一行寫著),
            把 cookie 搬出去要另外處理累加,那是**行為改動**不是註解。已請主視窗配一個 backlog 號。

         🔴 **標記是【無條件】的,而且在 `setWidth` 之前 —— 這是選擇,不是疏忽**(`-4a` R2 nit N-R2-2):
           在夾的邊界(例如視窗 1000、寬度已經是上限 520)按 ArrowLeft ⇒ **寬度零變化**,
           而 marker 預設值從此退場,**畫面上零訊號**。
           兩種讀法都講得通,我選**「按了鍵 = 有意圖」**:
             選它的理由 —— 使用者在邊界上反覆按,正是他**想要更寬而系統給不了**的時刻;
             這時候若不記他的意圖,他每次面板一動還會被拉回預設值,**而他剛剛才試過要改它**。
             不選另一種(「寬度真的變了才算」)的理由 —— 那會讓「調到邊界」與「沒調過」變成同一件事,
             而它們對使用者是兩件事。
           ⚠️ 代價寫清楚:**誤觸方向鍵一次,預設值就不再套用,而且【重載也回不來】。**
             🔴 我第一版在這裡寫「重載會回來,cookie 沒被寫」—— **那是錯的,我自己查出來的**:
                下面 updater 裡的 `document.cookie` 是**無條件**寫的,邊界上 `next` 夾回同一個值,
                cookie 照樣落地 ⇒ 下次 SSR 的 `initialPanelWidth` 就不是 `null` ⇒ 預設值那條路整段不跑。
             ⇒ 判別句:**我寫「不會發生」的時候,有沒有沿著那條路真的走一遍?** */
      hasUserSetWidthRef.current = true;
      // 讀 state 而非 closure 陳舊值的理由:同一 render 內連按兩下要能累加。
      setWidth((prev) => {
        const next = clampPanelWidth(prev + (e.key === 'ArrowLeft' ? KEYBOARD_STEP : -KEYBOARD_STEP), window.innerWidth);
        document.cookie = `${WORKSPACE_PANEL_COOKIE}=${next}; path=/; max-age=${WORKSPACE_PANEL_COOKIE_MAX_AGE}`;
        return next;
      });
    },
    [],
  );

  return (
    <div
      className='workspace-row flex flex-1'
      style={{ '--workspace-panel-width': `${width}px` } as React.CSSProperties}
    >
      {/* 🔴 內層是 `<div>` 不是 `<main>`:`SidebarInset` 本身已經是 `<main>`
          (`components/ui/sidebar.tsx`)⇒ 再包一個會有兩個 main landmark。
          舊版就有這個問題,本片動到這一行、順手改對(code-reviewer R2 nit)。 */}
      <div className='workspace-content min-w-0 flex-1 p-6'>{children}</div>
      {/* 🔴 把手與面板欄在**沒有面板內容時整組隱藏** —— 規則在 `globals.css`(`:has()`,零 JS)。
          🔴 **接點有兩個,不是一個**(2026-08-19 `W4-002` F1 更正;原句寫「唯一的接點」不實):
          ① 三個 class 名 ② **`{panel}` 必須是 `.workspace-panel` 的直接子代** ——
          在下面 `:154` 把它多包一層(error boundary / 捲動容器 / `<Suspense>`),
          class 名一個字沒動、兩條 `:has()` 規則就同時失配,**而測試會全綠**。
          ⇒ 測試把三個 class 在兩邊對照釘死,**並另有一格釘那個直接子代關係**。 */}
      {/* 🔴🔴 **`/40` `/60` 兩個透明度是【片1 換色時被迫重算的】,不是順手美化。**
          舊值是**黑色**疊出來的:hover 2.82、**focus 5.65(達標)**。
          片1 把 `--primary` 從純黑換成 BMW 藍 `#0066b1` ⇒ **同樣的透明度、亮很多的底色**
          ⇒ hover 掉到 1.85、**focus 掉到 2.65 —— 從達標變不達標**。
          ⚠️ **這是 WCAG 2.4.7(可見焦點)+ 1.4.11 的 3.0**,而這顆是**可聚焦的 window splitter**
             (下面 `role='separator'` + `tabIndex` + 方向鍵調寬)⇒ **鍵盤使用者唯一的位置訊號就是它。**
          🔴 **重點不是「我把顏色改醜了」,是【透明度是相對值、換底色就換了意思】** ——
             `/60` 這個字面**一個字都沒動,而它代表的顏色變了**,且三綠、突變、CSS 守門**全部不會紅**。
          **選值(可重跑,取頁底 `#f7f8fa` 與卡片 `#ffffff` 較差者)**:
            `/60` → 2.65 ✗   `/65` → 2.90 ✗(**邊界值,不用**)   `/70` → **3.17** ✓   不透明 → **5.59** ✓
          ⇒ **focus 用不透明**(把餘裕留滿,焦點環不該省)、**hover 用 `/70`**(仍比 focus 淡、層級還在)。
          ⚠️ 靜止態 `bg-border` 對頁底 1.27,**本來就低於 3.0 且本片沒動它的角色** ——
             它是兩塊面板之間的**分隔線**不是控制項的邊界,照設計參照 §1 的判別句歸「裝飾性」那一階。
             **不要順手把它也拉到 3.0**,那會在畫面中間畫一條中灰藍實線。 */}
      <div
        className='workspace-handle bg-border hover:bg-primary/70 focus-visible:bg-primary w-1 shrink-0 cursor-col-resize outline-hidden'
        role='separator'
        aria-orientation='vertical'
        aria-label='調整面板寬度'
        // 🔴 可聚焦的 separator(window splitter)依 ARIA **必須**報得出目前位置與範圍。
        //    `viewport` 未知時(SSR 那一幀)把上限退成「至少不小於目前值」,
        //    避免報出 `valuenow > valuemax` 這種不合法的組合。
        aria-valuenow={width}
        aria-valuemin={MIN_PANEL_WIDTH}
        aria-valuemax={viewport ? maxPanelWidth(viewport) : Math.max(width, MIN_PANEL_WIDTH)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      {/* 🔴 `ref` 寫在 `className` **前面**、而且整行不換行 —— 那不是排版偏好:
          `workspace-shell.test.ts` 用 `/className='workspace-panel shrink-0'>\{panel\}/`
          這串**原始碼字面**當「`{panel}` 是直接子代」的替身。ref 插在中間或換行 ⇒ 那格紅,
          **而直接子代關係其實一點都沒變**。⇒ 同上:配合守門,不改守門。 */}
      <div ref={panelSlotRef} className='workspace-panel shrink-0'>{panel}</div>
    </div>
  );
}
