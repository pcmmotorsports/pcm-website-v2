'use client';

// order-detail-tabs.tsx — 訂單明細的四分頁 + 「全部展開」逃生口(OD FIX-07 / FIX-17 / FIX-45 / FIX-44②)。
//
// 🔴🔴 **這是【全新結構】,不是改樣式** —— 動工前實查:`order-detail.tsx` 內
//    `role='tab'` / `tablist` / `Tabs` 命中 **0**(線A 片0 對映表量到同一個數)。
//
// 🔴 **為什麼是獨立一支 client 檔**:`order-detail.tsx` 是 server component
//    (渲染期產 `generateNoteRequestToken()`、讀 `Date.now()`)⇒ 不能加 `'use client'`。
//    四個分頁的內容仍然**由 server 渲染**,以 `ReactNode` 當 prop 傳進來 ——
//    這支檔只握「哪一頁是開的」,**看不到也碰不到任何業務資料**。
//
// 🔴 **OD 明說不要照抄他那份 delegated listener**(HANDOFF §7 逐字)。他踩到的三個坑
//    (`[hidden]` 用 CSS 蓋不掉 / 收回時不能還原舊狀態 / MutationObserver 咬自己)
//    **在 state 版本全部不存在** —— 那三個坑是「沒有 state 才要拿 DOM 當 state」造成的。
//    ⚠️ 但 state 版有它**自己**的坑,而它就在下面那個 effect 的依賴陣列上(見該段)。
//
// 🔴🔴 **逃生口不是裝飾,是這個方案成立的前提**(OD §9 取捨分析,方案 E)。
//    分頁的代價逐字:「藏起來的內容 **Cmd+F 找不到、也印不出來**」。**不准只做分頁不做展開。**
//
// 🔴🔴 **值的真權威 = 產物檔 `orders-admin-v2.html` 的最終渲染結果,不是任何單一 FIX 條目**
//    (線A 2026-08-23 實錘:他照 FIX-10 抄了 `--background`,而 FIX-38 後來把它蓋掉了 ⇒
//     搬進來的是一個**稿上根本沒長出來**的值,7 個 token 全錯,是 Sean 用肉眼抓到的)。
//    ⇒ 本檔每一個具體數值都**當場在產物檔裡搜過**。實際擋下兩件:
//      ① `.od-seg{font-size:13px;padding:0 3px}` / `.od-segbar{gap:2px}` 看起來像覆寫,
//         實際住在 `@container (max-width:380px)` 裡 ⇒ **基準值仍是 14px / 6px / 3px**。
//      ② `.od-seg{min-height:40px}` 是 **FIX-68 觸控目標**(L4 的範圍、且在 pointer 條件下),
//         **不是**分頁的基準高度 ⇒ 本檔照基準 `h-[34px]`,不順手把 40 帶進來。
//
// ⚠️ **本檔【沒有】做 FIX-07 的「固定摘要頭」那一半,而那不是漏做**:
//    OD 的 `<header … sticky>` 需要「面板內部自己的捲動容器」,而那個容器住在
//    `app/@panel/orders/page.tsx:78`(`sticky top-0 max-h-[calc(100svh-3.5rem)] overflow-y-auto`)
//    —— **那支檔不屬於本條線**。整頁版那一半 OD 也是靠 `.od-fullpage>header{position:sticky}`
//    這條**外殼 CSS** 做的(`globals.css` 是線A 獨佔)。⇒ 已列成需求交出去,不在這裡做半套:
//    只改我這一半,會在其中一面留下「內容從標頭底下透出來」的縫。

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type OrderDetailTabSpec = {
  /** 內部 key,也是 DOM id 的一段;不顯示給人看。 */
  key: string;
  /** 分頁鈕上的字。**逐字取自 `patch-orders-ui.py` 的 `_tab_parts()`**(含 `·` 兩側的空格)。 */
  label: string;
  content: ReactNode;
  /* 🔴 **這裡原本有一個「還有未收款」紅點的 prop(OD FIX-11),已撤回。**
     ① FIX-11 **不在本條線的 FIX 清單裡**;
     ② 算它需要多一個「尾款/已收」彙總函式的呼叫端,而
        `payment-amount-due-single-source.test.ts` 明文擋著「恰有 3 個 —— 多一個就要有人看過」。
        ⇒ **那不是它壞了,是它在做它的工作。**
     ⇒ **不留一個沒有呼叫端的介面** —— 那會讓下一個人以為它已經接好了。
        FIX-45 的「指示器在藍底上要翻色」在**徽章**那一半已經做了,紅點那一半等 FIX-11 一起。 */
  /**
   * 數字徽章(OD FIX-44②;Sean 逐字「如果備註裡面有東西,這個地方幫我做顏色或任何方式做提醒」)。
   *
   * 🔴 **`0` / `undefined` 一律不渲染元素**(OD 逐字「不是隱藏,是根本沒有這個元素」)。
   * 🔴 **數字來源必須是後端已經回傳的筆數,不要在前端數 DOM**(OD 給線A 的注意事項逐字)。
   * 🔴 **用數字不用純圓點**(OD 逐字):圓點只說「有東西」,數字同時說「有幾筆」,成本一樣。
   */
  badge?: number;
  /**
   * 這一頁「認領」哪些網址 hash(不含 `#`)。
   *
   * 🔴🔴 **這一格是承重的,不是便利功能。** `order-detail.tsx` 逐字寫著:
   *    「`anchorId='cancel'` 是**承重的**:列表那兩條 `#cancel` 深連結的目的地
   *     住在這一塊裡面 ⇒ 收起來就等於連過去看到空白。」
   *    **分頁把「收起來」這件事又做了一次,而且是預設** ⇒ 沒有這一格,那兩條既有連結會壞。
   */
  hashes?: readonly string[];
};

/* ═══ 分段控制的 class(OD FIX-45)══════════════════════════════════════════════
   Sean 逐字:「…可以在側邊欄**位置中**,然後**依照欄位佈滿配置**,然後再**更明顯地
   去顯示這個是標籤,不同顏色**。」⇒ 四格等寬佈滿 + 內容置中 + 選到的實色底。
   🔴 **「不同顏色」= 選中 vs 未選中兩色,不是四個分頁各一色**(OD 逐字):
      藍/黃/綠/紅在本專案是**狀態語意色**(膠囊那套),拿來當分頁裝飾會讓
      「紅色 = 有問題」這個約定失效。
   🔴 **OD 用自訂 CSS class,我們用 Tailwind utility** —— 他自己在 §7 就是這樣建議的;
      他之所以走自訂 class,是因為**快照的 Tailwind 是編譯好的**(沒生成過的 utility 寫了沒效果),
      而**那個限制只存在於快照**。⇒ 換載體、不換值。
   🔴🔴 **圓角:這一格【今天被翻過兩次】,而兩次的原因不同 —— 逐條留,不要只讀最後一句。**
      ```
      第一版  我照 OD 寫方括號寫死的 10px / 8px / 9px
      翻案①  design-tokens.test.ts「裸圓角/方括號」那格當場紅(全掃 .ts + .tsx, 我的新檔唯一命中)
              查因:當時 globals.css `--radius: 0`、四階各自寫死 0 ⇒ 全站方角
              (Sean 2026-08-16「狀態膠囊改方角, 全站統一、沒有例外要記」)
              ⇒ 改成 rounded-md / rounded-sm, 而它們【當時】都解析成 0
      翻案②  Sean 2026-08-23 晚逐字裁「乙 不算了 —— 照 OD 新稿, 全部圓角」
              ⇒ 線A 把 token 改成 --radius: 8px, 四階 xs 2 / sm 4 / md 6 / lg 8 / xl 12
              ⇒ 【同一串 class 的解析結果變了, 而我的檔一個字都沒動】
      ```
      🔴 **翻案② 最值得記的不是結論,是它的形狀**:我寫的 `rounded-md` 從 0px 變成 6px,
         **而我的檔沒有任何改動、任何測試也不會紅** —— 值住在別人的 token 裡。
         ⇒ **「我確認過這個 class」不等於「我確認過它會畫出什麼」。**
      **現在的對應(OD 產物實量 → 我方四階)**
      ```
      軌道 `.od-segbar`  OD 10px  →  rounded-xl (12px)   ⚠️ 四階沒有 10 那一階(見下)
      每格 `.od-seg`     OD  8px  →  rounded-lg  (8px)   ✅ 精準
      徽章               OD  9px  →  rounded-full        ✅ 18px 高 + 9px 半徑 = 全圓, 逐字等價
      ```
      🔴 **軌道為什麼取【比較大】那一階,而不是比較小的 `lg`(8px)** ——
         `lg` 與 `xl` 對 OD 的 10px **誤差同樣是 2**,所以「哪個比較接近」分不出勝負。
         判準改用**同心圓角**那條:外框半徑 ≈ 內部半徑 + 內距。
         這裡內部 8px、`p-[3px]` ⇒ **理想外框 11px** ⇒ `xl`(12)差 1、`lg`(8)差 3。
         ⚠️ 而 `lg` 還有一個額外的壞處:**它會等於格子自己的半徑 ⇒ 巢狀感消失**
            (OD 的軌道本來就比格子圓,那是「格子躺在軌道裡」的樣子)。
      🔴 **我第一版是 `lg`+`md`(8/6),那是【保住 2px 差】選的,而它讓每一格都不準。**
         線A 2026-08-23 夜用 `tool-final-css.py`(五個世界自檢全 PASS)重量頂層最終值,
         確認 `.od-seg` **就是 8px** ⇒ **有一階可以打準,就不該為了維持相對關係而兩邊都放掉。**
      🔴 **`10px` 在我方四階裡【沒有對應】,這是量到的不是估的**:
         OD 產物 `grep -oE 'border-radius:[^;}]*' | sort | uniq -c` ⇒ `8px 22 / 9px 4 / 4px 3 / 12px 3 / 10px 3 / 6px 2`
         —— **10px 真的存在(3 次)**,而我方 `xs2 / sm4 / md6 / lg8 / xl12` 沒有它。
         ⚠️ 線A 給我的那份分佈**漏了 10px 這一格**(他列 8/4/6/12 四種)⇒ **已回報他**,
            要不要為它加一階由他決定。**在他決定之前,這裡差的那 2px 是【已知的、寫下來的】。**
      ⚠️ **仍然不得用【方括號寫死的圓角】** —— 那道守門還在,而它擋的是「繞過 token」,與圓不圓無關。
         🔴 **這一行本身踩過那道守門一次**:我原本在這裡寫了那個 class 的完整字面當範例,
            而**它連註解都掃**(它的案例表逐字含「被行註解掉的 class」與「無引號的註解散文」,
            理由是**真 build 實測那些會被 Tailwind 產出**)⇒ 舉例等於違規。
            📌 `design-tokens.test.ts` 自己也是這樣做的 —— 它逐字寫著「本段刻意不寫出那個英文字的
            裸形,也不寫方括號圓角的完整字面」,並說它踩過三次「偵測器打到自己的輸入」。
            ⇒ **要描述它就用中文,不要示範。**
   🔴 色票對照(產物檔實搜):`--pill-accent` = `#0066b1` = 我方 `--primary`
      (`workspace-shell.tsx` 逐字記著片1 把 `--primary` 換成 BMW 藍 `#0066b1`)⇒ 用 `bg-primary`。
   ⚠️ **窄版斷點 380 → 384 的差**:OD 用 `@container (max-width:380px)`,我方用 `@sm`(24rem = 384px)。
      本 repo 既有的容器斷點都走具名階(`@md` / `@4xl`),而 4px 差落在「沒有任何內容剛好卡在 380–384」
      的區間裡。**這是一個我知道的偏離,不是照抄。** */
/* 🔴 §12 批次 2(組 22/24/25,2026-08-24)三格照稿補上,Sean 2026-08-23 常設令「一律照 OD 現行稿」:
   組22 `.od-segbar{margin:10px 0 12px}` —— 我方原本沒有這行 ⇒ 補 `mt-[10px] mb-[12px]`。
   組24 `.od-seg-off{color:var(--fg-2)}` —— 我方原本誤用 `text-muted-foreground`
        (`--fg-2` #333e4e 與 `--muted-foreground` #4d596d 是兩個不同 token,不是換名同值)
        ⇒ 改 `text-[var(--fg-2)]`,直接吃 token、不要寫死 hex(token 之後若再變不用回來改這裡)。
   組25 `.od-seg-off:hover{background:color-mix(in oklab,var(--card),transparent 40%)}` ——
        我方原本只做了 hover 文字色(`hover:text-foreground`,那格本來就對),沒做 hover 背景 ⇒ 補上。
        Tailwind 任意值語法空白要換底線,逐字搬 `color-mix()` 那串。 */
const SEGBAR = 'grid grid-cols-4 gap-[2px] rounded-xl bg-muted p-[3px] mt-[10px] mb-[12px] @sm:gap-[3px]';
const SEG_BASE =
  'flex h-[34px] min-w-0 cursor-pointer items-center justify-center gap-[5px] rounded-lg' +
  ' border-0 px-[3px] text-[13px] leading-none whitespace-nowrap' +
  ' focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none' +
  ' @sm:px-[6px] @sm:text-sm';
const SEG_ON = 'bg-primary text-primary-foreground font-semibold shadow-[0_1px_2px_rgba(16,24,40,.16)]';
const SEG_OFF =
  'bg-transparent text-[var(--fg-2)] font-normal hover:text-foreground' +
  ' hover:bg-[color-mix(in_oklab,var(--card),transparent_40%)]';

export function OrderDetailTabs({
  header,
  tabs,
  initialKey,
}: {
  /** 分頁列**上方**、四頁共用的抬頭(單號列 / 焦點列 / 已取消橫幅)。由 server 渲染後傳進來。 */
  header: ReactNode;
  tabs: readonly OrderDetailTabSpec[];
  /**
   * 首選分頁。呼叫端用它處理「網址已經在指定某一頁」的情形(例如 `?correct=` 更正備註)。
   * 🔴 給不出來時退回第一頁,**不記憶上次停在哪一頁**:OD FIX-11 的
   *    `localStorage["od.orderPanelTab"]` 那一半**不在本條線的清單裡**,而且它必須在 effect 裡讀
   *    (SSR 首屏讀不到 localStorage ⇒ 直接讀會 hydration mismatch)。**要做請開一片。**
   */
  initialKey?: string;
}) {
  const uid = useId();
  const [active, setActive] = useState(
    () => tabs.find((t) => t.key === initialKey)?.key ?? tabs[0]?.key ?? '',
  );
  const [expanded, setExpanded] = useState(false);

  /**
   * 深連結:`#cancel` 這種 hash 要把對應的分頁打開(見 `hashes` 的 docstring —— 承重)。
   *
   * 🔴 **`tabs` 不能進依賴陣列**:呼叫端每次渲染都會給一個**新的陣列字面量**
   *    ⇒ effect 每次渲染都重跑 ⇒ 只要網址上的 hash 還在,員工點哪一頁都會被彈回去。
   *    ⇒ 用 ref 讀最新值、依賴陣列留空。**這就是「state 版有它自己的坑」的那一格。**
   * ⚠️ **它救得回「連過去看得到」,救不回「捲到那裡」**:`DangerZoneDetails` 的
   *    `scrollIntoView` 在**子層** effect 先跑,那一刻那一頁還是 `hidden` ⇒ 捲動是 no-op。
   *    ⇒ 這句是實話不是保證;要連捲動也對得上,得由那支元件自己重試 —— 不屬本片,已列進回報。
   */
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash.replace(/^#/, '');
      if (hash === '') return;
      const hit = tabsRef.current.find((t) => t.hashes?.includes(hash));
      if (!hit) return;
      setActive(hit.key);
      setExpanded(false);
    };
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  /* 🔴 nit(codex 關卡2 2026-08-24):`role='tab'` 要配鍵盤,否則鍵盤使用者換不了頁。
     WAI-ARIA tabs 模式的兩半都做:①方向鍵在 tablist 內移動並「跟著焦點切頁」、Home/End 到兩端
     ②roving tabindex(只有現用那顆進 Tab 順序 —— 四顆全進會讓 Tab 要按四下才離得開分頁列)。
     與點擊同款:鍵盤切頁也退出展開模式(FIX-17 的行為不分輸入裝置)。 */
  const onTablistKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = tabs.findIndex((t) => t.key === active);
    let next: number;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    const key = tabs[next]?.key;
    if (key === undefined) return;
    e.preventDefault();
    setActive(key);
    setExpanded(false);
    document.getElementById(`${uid}-tab-${key}`)?.focus();
  };

  return (
    <div className='space-y-4'>
      {/* 抬頭 + 逃生口。
          🔴 **逃生口的位置是量出來的,不是排版偏好**:OD 實測面板 400px 時分頁列已被四格佔滿,
             按鈕放進分頁列會被橫向捲出視線外 —— 逐字「**逃生口看不到就等於沒有**」。
          ⚠️ **已知偏離**:OD 把它塞在抬頭列**尾端**(「訂單明細」那顆鈕右邊)。
             我們的抬頭列是 **server 渲染**的,塞不進一顆 client 按鈕 ⇒ 改放同一區塊的**右上角**。
             射程一樣(在抬頭裡、不進分頁列、面板 400px 時看得到),位置不同。已寫進回報。
          🔴 鈕的 class **逐字取自 OD 的 `EXPAND_BTN`**,只拿掉它那個 `ml-1`
             (那是為了接在抬頭列尾端;我們是獨立一格)。 */}
      {/* 🔴🔴 **`data-od-id="panel-header"` 是給 `globals.css` 做 sticky 用的掛鉤(線A 要的)。**
          用 OD 原本那個名字 ⇒ 稿上的規則
          `.od-fullpage>header{position:sticky;top:0;z-index:5;background:var(--card)}`
          搬過來是逐字的,不用轉譯。
          🔴🔴 **而它【必須包住分頁列】,不能只包抬頭那一列** —— 線A 原本要我掛在
             `flex items-start gap-2` 上,那樣**分頁鈕會跟著捲走**:
             OD 自己的 `<header data-od-id="panel-header">` 裡面**同時裝著抬頭與 `.od-segbar`**
             (`patch-orders-ui.py` 的 `fix07_tabs`:`head_html + focal + cancelled` 之後緊接
              `<div role="tablist" class="od-segbar">`,兩者在**同一個 header 之內**)。
             ⇒ 只 sticky 抬頭 = 捲下去之後**看得到單號、卻沒有分頁可以按**。
          ⚠️ 這一層刻意用 `space-y-4` 而不是留給外層 —— 外層的 `space-y-4` 只作用在直接子代,
             把兩個元素收進來之後,它們之間的 16px 要由這一層自己給。 */}
      <div data-od-id='panel-header' className='space-y-4'>
      <div className='flex items-start gap-2'>
        <div className='min-w-0 flex-1'>{header}</div>
        <button
          type='button'
          aria-pressed={expanded}
          onClick={() => setExpanded((v) => !v)}
          className='border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center rounded-md border px-2.5 py-1 text-sm'
        >
          {expanded ? '收回分頁' : '全部展開'}
        </button>
      </div>

      {/* 🔴 展開模式下分頁鈕**淡化到 .55**(OD `EXPAND_CSS` 逐字
          `.panel-expand-all [role="tablist"] [data-od-tab]{opacity:.55}`)——
          它們**沒有失效**(點下去會退出展開模式),所以不是 `disabled`;淡化是在說「現在不是它在管」。 */}
      <div
        role='tablist'
        aria-label='訂單分頁'
        onKeyDown={onTablistKeyDown}
        className={expanded ? `${SEGBAR} opacity-55` : SEGBAR}
      >
        {tabs.map((tab) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              type='button'
              role='tab'
              id={`${uid}-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`${uid}-panel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                setActive(tab.key);
                // OD FIX-17 逐字:「點任一分頁也會自動退出展開模式」。
                setExpanded(false);
              }}
              className={`${SEG_BASE} ${selected ? SEG_ON : SEG_OFF}`}
            >
              <span className='truncate'>{tab.label}</span>
              {/* 🔴 **狀態指示器在實色底上要翻色,否則等於消失**(OD FIX-45 逐字)。
                  他量的兩個世界(徽章):未選 淡藍底藍字 → 選中 白底藍字。**兩個值不同才算數。**
                  ⚠️ OD 量翻色前有一句必須帶走的話:他第一次量「未選」時,分頁已經被
                     `localStorage` restore 成選中了 ⇒ 兩邊都讀到白色、**差點誤判成沒翻色**。
                     「這不是程式的錯,是量測被前一次操作污染。」 */}
              {tab.badge !== undefined && tab.badge > 0 && (
                <>
                  {/* OD:`min-width:18px; height:18px; padding:0 5px; border-radius:9px;
                      font-size:12px; font-weight:600; background:var(--tint-accent); color:var(--pill-accent)`。
                      🔴 **`border-radius:9px` 在一個 18px 高的東西上就是【全圓】** ⇒ 用 `rounded-full`,
                         而**不是**方括號寫死的 9px(那條被 `design-tokens.test.ts` 擋著,理由見檔頭那段)。
                         `rounded-full` 是那道守門**明文豁免**的一個,而且與本 repo 既有的計數徽章同族
                         (`notes-timeline.tsx` / `payment-list.tsx` 那批仍然是 `rounded-full`)。
                         ⚠️ ~~這與上面分段控制走方角不衝突~~ **2026-08-23 晚:這句的前提沒了** ——
                            分段控制**現在也是圓的**(`rounded-lg` / `rounded-md` 解析成 8 / 6px)。
                            🔴 **但這一格的判準沒有變,而那才是要留的東西**:
                            用 `rounded-full` 的理由是**它是全圓、與既有計數徽章同族**,
                            **不是**「別人方我圓」。⇒ 前提被推翻,結論仍然成立。
                      ⚠️ `--tint-accent` = `color-mix(in oklab,var(--pill-accent),var(--card) 88%)`;
                         我方用 `bg-primary/12` 近似(**近似,不是逐字**)—— 已寫進回報。 */}
                  <span
                    aria-hidden='true'
                    className={`inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-[5px] text-xs font-semibold tabular-nums ${
                      selected ? 'bg-primary-foreground text-primary' : 'bg-primary/12 text-primary'
                    }`}
                  >
                    {tab.badge}
                  </span>
                  <span className='sr-only'>有 {tab.badge} 筆備註</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      </div>

      {tabs.map((tab, i) => (
        <section
          key={tab.key}
          id={`${uid}-panel-${tab.key}`}
          role='tabpanel'
          aria-labelledby={`${uid}-tab-${tab.key}`}
          /* 🔴 **`data-od-panel` 是給 `globals.css` 掛鉤用的,不是裝飾**:OD 有幾條規則
             (FIX-18 的窄面板表格橫捲、FIX-46① 客戶頁 `grid-column` 爆版)**用這個屬性選中分頁**,
             ⚠️ **FIX-08 不在這一族** —— 它選的是 `.ihead` / `.iline`,與本屬性無關;
                我第一版把它一起寫進來,那是一句**沒查就寫下的宣稱**(已對產物檔逐條核過選擇器)。
             而 `globals.css` 是線A 獨佔 ⇒ 我方只能把**掛鉤**留出來,規則由他寫。
             ⚠️ `useId` 產生的 `id` 每次渲染都不同 ⇒ CSS 選不到,必須另外有一個**穩定的**屬性。
             📌 值刻意用 OD 那四個 key(`items`/`money`/`customer`/`notes`),他的規則就能直接搬。 */
          data-od-panel={tab.key}
          /* 🔴 **`hidden` 屬性,不是 `className='hidden'`**:
             ① UA 的 `[hidden]{display:none}` 是這一格的權威,而**本節點刻意不掛任何 display utility**
                —— 掛了(`flex` / `grid`)就會贏過 `[hidden]`,而 OD 實測那時**連作者端 `!important`
                都蓋不回來**(UA 的 `[hidden]{display:none!important}` 在層疊順序上贏)。
             ② `hidden` 同時把節點移出無障礙樹 ⇒ 讀螢幕的人不會念到收起來的三頁。
             🔴 **展開時是把屬性【拿掉】,不是用 CSS 蓋掉它**(OD 踩過的坑 1 逐字)。
                在 React 這是 `hidden={false}`,天然就是「拿掉」。 */
          hidden={!expanded && tab.key !== active}
          /* 展開模式下四段黏成一條長捲軸 ⇒ 段與段之間要有邊界。
             OD `EXPAND_CSS` 逐字:`margin-top:16px;padding-top:16px;border-top:1px solid var(--border)`
             ——外層 `space-y-4` 已經給了 16px 的 margin,所以這裡只補上下那半。 */
          className={expanded && i > 0 ? 'space-y-4 border-t pt-4' : 'space-y-4'}
        >
          {tab.content}
        </section>
      ))}
    </div>
  );
}
