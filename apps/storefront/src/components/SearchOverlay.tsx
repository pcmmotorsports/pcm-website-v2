'use client';

// SearchOverlay.tsx — 全站搜尋疊層(搜尋線 第一刀)
//
// ⚠️🔴 **這支檔貼著鐵則 6 的 400 行硬線** ⇒ 你很可能是被迫拆的那個人。
//    ✅ **拆點是 render 那三支 `view.kind` 分支**,各自抽成小元件。
//    🛑 **拆點【不是】下面那幾段註解** —— 它們記的是「這個分支為什麼存在」與
//      「視覺從哪一支稿搬來」,搬走 = 下一個人找不到來源(鐵則 1 要防的正是這個)。
//    🟢 拆的時候 `SearchOverlay.test.tsx` 的 **G1-f** 會盯著你:它釘住 render 的 kind 集合,
//      多一支或改名都會紅 ⇒ **那一格是給拆的人的安全網。**
//
// 🔴 **稿是 `design-reference/components/SearchOverlay.jsx`(205 行),本檔照搬版面與字面**
//    (鐵則 1:直接搬、不翻譯)。CSS 整支已逐字搬到 `styles/search-overlay.css`。
//
// 🔴 **開關方式:自己聽 `pcm-open-search` 事件,不改 Header 的發送端。**
//    `Header.tsx:72` 逐字寫著「做搜尋線時把這個常數改成 `true` 就好,**不要重寫**;
//    `openSearch()`、事件名、`searchQuery` state 全部原樣留著 —— 那是之後要接的東西」。
//    ⇒ 那條指示現在被執行了:Header 的 `openSearch()` 一個字沒動,缺的監聽器長在這裡。
//    ⚠️ Header **不在 root layout**(各頁各自 import、`app/` 底下無 nested layout)
//       ⇒ 本元件由 Header render,才會跟著 Header 出現在每一頁。
//
// 🔴 **與稿的差異 = 【分刀】不是【偏離】**(主視窗 2026-09-02 批准,三個條件之一是寫在這裡):
//    稿的即時結果分**四區**:商品 / 品牌 / 分類 / 車款(`SearchOverlay.jsx:36-57`),
//    而那四區是從 `window.PCM_DATA` 這份靜態 mock 算的、真站沒有那份東西。
//    **本刀只做【商品】那一區**;另三區各自要接既有函式,下一刀:
//      · 品牌 → `fetchCatalogBrandTaxonomy`(lib/products.ts:613)
//      · 分類 → `fetchCategories`(lib/products.ts:696)
//      · 車款 → `fetchVehicleTaxonomy`(lib/products.ts:838)
//    ⚠️ **不做的那三區在畫面上不留空殼**(批准條件②)—— 標題底下空著,與「搜不到」
//       在客人眼裡是同一件事。本檔沒有那三個 `<section>`,不是它們渲染成空。
//
// 🔴 搜尋準確度:走 ILIKE(`ADR-0004` §2.1 Q3 第一階),**中文搜得到、排不準**;
//    分詞路線待 Sean 重新拍(`ADR-0004:80`)。細節在 `lib/search.ts` 檔頭。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';

// 🔴 **不要用裸 `router.push('/products…')`** —— `catalog-navigation.test.ts` 有一道**掃全樹**的守門
//    在盯這個字面,而它盯的是一件真事:`router.push` **不會把捲動歸零**
//    (D-315-A ② 真 DB 實測:push 前 scrollY 152.5 ⇒ 落地仍 152.5)。
//    ⇒ 客人在疊層裡捲了幾行才點到第 6 筆結果,落地商品頁**停在同一個捲動位置**、看到半截。
// ⚠️ **名字叫 Catalog 而我用它跳的是商品【詳情】頁** —— 刻意的:那支 helper 做的事是
//    「push 之後捲到頂」,而**那正是這裡要的**;它的名字比它的行為窄。
//    改名要動另外三個既有呼叫端 + 那支守門 ⇒ 不在這一刀的範圍,記在這裡。
// 🔴🔴 **而那個窄名字有一個具體的害處,寫下來給下一個人**:它會讓人以為
//    「這支只給目錄頁用」⇒ 於是他為了跳別的頁**另外寫一支**,而那一支**會漏掉捲動歸零**
//    ⇒ 客人落地在半截畫面上,而**沒有任何東西會紅**(那道全樹守門只盯 `/products` 這個字面,
//      盯不到一支跳別條路徑的新 helper)。
//    ⇒ 📌 **判別句:helper 的名字比行為窄時,下一個人不會去改它,他會繞過它。**
import { navigateToCatalog } from '@/lib/catalog-navigation';

import { SEARCH_MAX_QUERY_LENGTH, type SearchOverlayItem } from '@/lib/search-shape';

/** 稿 `SearchOverlay.jsx:74` 的熱門搜尋 chips,逐字照搬。 */
const POPULAR = ['排氣管', '碳纖維', '腳踏', 'Öhlins', 'Akrapovič', 'CBR600RR'];

/** 打字停多久才打 API。太短 = 每個字一發請求;太長 = 客人以為壞了。 */
const DEBOUNCE_MS = 220;

/**
 * 這一次查詢的結果。`items === null` = **這一次失敗了**(不是「零筆」)。
 */
export type SearchResultState = { q: string; items: SearchOverlayItem[] | null };

/**
 * 現在這個查詢該畫什麼。**render 只吃這一個函式的回傳。**
 *
 * 🔴 **為什麼把 `status` 從 render 判斷裡整個拿掉**(codex 2026-09-02 R2 must-fix 1):
 *   `status` 是一顆**不帶查詢字**的 state ⇒ 它答得出「上一次成功還是失敗」,
 *   答不出「上一次是**哪一個查詢**的成功或失敗」。
 *   R1 的修法只把【成功】那一半綁上查詢,而**失敗那一半漏了** ⇒
 *   搜尋失敗之後改字或清空,effect 跑之前那一次 render 仍然畫著舊的錯誤訊息;
 *   清空時甚至「熱門搜尋」與「搜尋暫時無法使用」**同時出現**。
 * 📌 **⇒ 同一個病修了一半,而修好的那一半讓它更難被看見** ——
 *    R1 之後成功那條路不再出錯了,於是沒有人會再懷疑失敗那條路。
 *
 * 🔴 **抽成具名函式的理由**(2026-09-02 突變實測逼出來的):
 *   這個判斷守的是 **render 與 effect 之間**那一次 render —— React 先 render 再跑 effect,
 *   而 testing-library 看到的永遠是 effect 跑完之後的 DOM ⇒ **那一幀在 DOM 那一端沒有形狀**。
 *   寫在 render 裡的話,拿掉它**測試照樣全綠**。抽出來,測試才有一個【不經過 DOM 的入口】。
 */
export function viewFor(
  result: SearchResultState | null,
  q: string,
): { kind: 'pending' } | { kind: 'failed' } | { kind: 'ok'; items: SearchOverlayItem[] } {
  // 沒有結果,或結果屬於別的查詢 ⇒ 一律當「還在路上」,不畫任何舊東西。
  if (result === null || result.q !== q) return { kind: 'pending' };
  if (result.items === null) return { kind: 'failed' };
  return { kind: 'ok', items: result.items };
}

export function SearchOverlay() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /**
   * 🔴 **結果與【它屬於哪個查詢】綁在同一顆 state**(codex 2026-09-02 must-fix 1)。
   * 原本 `items` 與 `status` 是兩顆獨立的 state,而 effect 在 render **之後**才跑
   * ⇒ 客人把「碳纖維」改成「排氣管」的那一次 render,畫面上是
   *   **新的查詢字 + 舊的商品列**(標題還寫「商品 · 3」、底下那顆鈕寫「查看『排氣管』的所有結果」);
   *   而把字**清空**時更明顯:「熱門搜尋」與上一次的結果會**同時出現**。
   * ⇒ 綁在一起之後,渲染前用 `result.q !== q` 就判得出「這批結果不屬於現在這個查詢」。
   * 📌 判別句:兩顆分開的 state 沒有辦法表達「它們是同一次量測」——
   *    而 React 只保證同一顆 state 的更新是原子的。
   */
  const [result, setResult] = useState<SearchResultState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** 開疊層之前焦點在誰身上 —— 關閉時要還回去(codex must-fix 4)。 */
  const returnFocusRef = useRef<Element | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // Header 的 openSearch() 發這個事件(帶 detail.query 當種子)。
  useEffect(() => {
    const onOpen = (e: Event) => {
      const seed = (e as CustomEvent<{ query?: string }>).detail?.query ?? '';
      // 開之前先記住焦點在誰身上(通常是那顆搜尋鈕)—— 關閉時要還回去。
      returnFocusRef.current = document.activeElement;
      setQuery(seed);
      setOpen(true);
    };
    window.addEventListener('pcm-open-search', onOpen);
    return () => window.removeEventListener('pcm-open-search', onOpen);
  }, []);

  // 稿 :14-26:聚焦 + 鎖背景捲動 + Esc 關閉。加上 focus trap 與焦點還原(codex must-fix 4)。
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    // 🔴🔴 **鎖背景捲動:用【自己的 data 屬性 + CSS 規則】,不碰 `body.style.overflow`。**
    //
    // 成因(codex 2026-09-02 R1 must-fix 3、R2 判「修了一半」):
    //   本 repo 有 **5 支元件**在搶同一個 inline style ——
    //     `FilterDrawer.tsx:154` / `MobileVehicleSheet.tsx:103`      無條件寫回 `''`
    //     `ProductGallery.tsx:119` / `SwatchLightbox.tsx:48`          存值再還原
    //   而**兩種寫法都會互蓋**:誰後關,誰的還原值贏。
    //   ⛔ ~~R1 我用「存值還原」,並主張相反順序那條路徑被 focus trap 關掉了~~
    //   🔴 **R2 打破了那個主張**:程式自己開的 modal、路由狀態變更、`element.focus()`、
    //      輔助技術的移動 —— **都不經過滑鼠遮罩,也不經過 Tab**。
    //      ⇒ 「今天到不了」是一句我證不了的話,而它會叫下一個人不要去查。
    //
    // ✅ **改法:不參與那場搶奪。**設一顆只屬於本疊層的屬性,
    //    鎖的效力由 `search-overlay.css` 的 `body[data-pcm-search-lock]` 提供。
    //    · 別人寫 inline `overflow:''` ⇒ inline 等於沒設 ⇒ **我的規則仍然生效**(我的鎖不會被解掉)
    //    · 我移除屬性 ⇒ **完全不碰他們的 inline style** ⇒ 他們的鎖原封不動
    //    ⇒ 📌 **兩邊變成【相加】而不是【互相覆寫】—— 而那不需要另外 4 支元件先改。**
    // ⚠️ 而別人若寫 inline `overflow:'hidden'`,那是他們的鎖,本來就該留著。
    // 🔵 真正的通解仍是一顆共用的鎖計數器(要動那 4 支)⇒ 已交 backlog,不在這一刀。
    document.body.setAttribute('data-pcm-search-lock', '');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      // 🔴 focus trap:`aria-modal="true"` 只是**告訴**輔助技術這是 modal,
      //    它**不會**阻止 Tab 走到背景的 Header 與頁面控制項。少了這一段,
      //    鍵盤使用者會 Tab 出去、而畫面上還蓋著疊層 ⇒ 他在操作一個他看不見的東西。
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      // 焦點已經在外面(例如上一次 Tab 溜出去了)⇒ 拉回來,不要放它繼續跑。
      if (!panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.body.removeAttribute('data-pcm-search-lock');
      window.removeEventListener('keydown', onKey);
      // 焦點還給打開它的那顆鈕 —— 否則鍵盤使用者關掉之後焦點掉回 <body>,
      // 下一次 Tab 從頁首重來,他失去了原本的位置。
      const back = returnFocusRef.current;
      if (back instanceof HTMLElement && document.contains(back)) back.focus();
    };
  }, [open, close]);

  // 取數。稿在這裡是 useMemo 純算,真站要問 server。
  // 🔵 顯示與查詢用**同一個運算式**算出來的 q(截斷值來自 search-shape,server 端截同一個數)。
  const q = query.trim().slice(0, SEARCH_MAX_QUERY_LENGTH);

  useEffect(() => {
    if (!open || q === '') {
      setResult(null);
      return;
    }
    // 🔴 AbortController 不是效能優化:少了它,先發後回的舊請求會蓋掉新請求的結果
    //    ⇒ 客人看到的是**上一個字**的搜尋結果,而畫面上完全正常。
    const ac = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ac.signal });
        if (!res.ok) throw new Error(`search api ${res.status}`);
        const data = (await res.json()) as { items: SearchOverlayItem[] };
        // 結果與它所屬的查詢一起寫進去 —— 兩顆分開的 state 表達不了「同一次量測」。
        setResult({ q, items: data.items ?? [] });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.error('[SearchOverlay] 取結果失敗:', err);
        // 🔴 失敗也要記在【它屬於哪個查詢】上,`items: null` = 這一次失敗了。
        //    R1 這裡寫的是 `setResult(null)` + `setStatus('failed')` ⇒ 失敗脫離了查詢
        //    ⇒ 改字之後那一次 render 會把舊的錯誤訊息畫在新的查詢底下(R2 must-fix 1)。
        setResult({ q, items: null });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [q, open]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!q) return;
    // 稿 :66 是 `onNav('products', { search })`,而 `/products` 走的 RPC 沒有關鍵字參數
    // ⇒ 主視窗判 A 案:另開 `/search`。理由全文在 `lib/search.ts` 檔頭。
    router.push(`/search?q=${encodeURIComponent(q)}`);
    close();
  };

  if (!open) return null;

  // 修法本體在 `viewFor`(抽成具名函式的理由見它的 JSDoc:寫在這裡的話那個條件殺不掉突變)。
  const view = viewFor(result, q);

  return (
    <div className="search-overlay" role="dialog" aria-modal="true" aria-label="搜尋">
      <div className="search-overlay-backdrop" onClick={close} />
      <div className="search-overlay-panel" ref={panelRef}>
        <form className="search-overlay-head" onSubmit={submit}>
          <svg className="search-overlay-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            className="search-overlay-input"
            type="search"
            placeholder="搜尋商品 / 品牌 / 車款..."
            /* 🔵 **與稿的第二處差異(刻意,可及性)**:稿的 input 只有 placeholder、沒有 aria-label。
                 這一格照本 repo 既有前例補 —— `Header.tsx` 的桌機搜尋框逐字寫過同一件事:
                 「這欄沒有 <label>,報讀器原本只念得到 placeholder(且部分瀏覽器在有值時不念)
                  ⇒ 補上不是樣式偏好,是可及性」。
                 ⚠️ 名字刻意**三個都不同**:外層 dialog 是 `搜尋`(稿的字面)、Header 桌機框也是 `搜尋`、
                    Header 手機鈕是 `搜尋商品` ⇒ 這裡只剩下把 placeholder 唸出來這條路。
                    撞名的後果不是難看:`getByLabelText` 會一次撈到兩個,而**守門會在兩個世界印同一種紅**。 */
            aria-label="搜尋商品 / 品牌 / 車款"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          {query && (
            <button type="button" className="search-overlay-clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="清除">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
          <button type="button" className="search-overlay-close" onClick={close} aria-label="關閉">
            取消
          </button>
        </form>

        <div className="search-overlay-body">
          {q === '' && (
            <div className="search-overlay-empty">
              <div className="search-overlay-h">熱門搜尋</div>
              <div className="search-overlay-chips">
                {POPULAR.map((tag) => (
                  <button key={tag} type="button" className="search-overlay-chip" onClick={() => setQuery(tag)}>{tag}</button>
                ))}
              </div>
            </div>
          )}

          {/* 🔴🔴 **等結果的那段時間要說話** —— 而這一格【不是樣式問題,是一個不存在的分支】。
              `viewFor()` 回三種 kind(錨:該函式的回傳型別那一行),而在本片之前 render 端只有 `failed` / `ok` 兩支
              ⇒ **`pending` 沒有任何分支** ⇒ 那段時間整片疊層是空的。

              🔴 **而它比「沒有轉圈圈」嚴重一級**:熱門搜尋 chips 也一起消失
              (它們的條件是 `q` 為空)⇒ **客人看到的是【畫面壞掉】,不是【沒有回饋】。**
              線上實測(2026-09-03,production,打中文一個字「貼」):
                300 / 700 / 1100 / 1500 / 2200ms 五格取樣 ⇒ 疊層 innerText 全部是 **2 字元「取消」**
                🟢 正對照 2500ms ⇒ 250 字元(結果出來了)⇒ 尺會動
                🔵 同頁量:中文 1934ms vs ASCII `rsv4` 455ms ⇒ 中文那條路真的要等
                ⚠️ **兩臂各 n=1、單次取樣**(R1 F12);且 `-mail` 的 pg_trgm 索引落地後
                  這個對比**會反轉** ⇒ **那時要回來重量,不要引用這兩個數字。**
              (後端那半 = `-mail` 的 pg_trgm 索引線,本片不碰:索引讓那段變短,本片讓它不像壞掉。)

              🔴 **鐵則 1:視覺不是我發明的,是從稿裡搬的。**
              · 稿 `design-reference/components/SearchOverlay.jsx`(205 行)掃
                `loading|Loading|spinner|pending|搜尋中|載入|skeleton|shimmer` ⇒ **八個字面全 0**
                (🟢 正對照同檔 `search-overlay` ⇒ 34、`取消` ⇒ 1 ⇒ 尺是活的)
                ⚠️ **而查無的成因要寫出來**:稿 `:4` 逐字 `const data = window.PCM_DATA;`
                ⇒ **稿是同步讀 mock、根本沒有等待期** ⇒ 它不是「決定不畫」,是**沒有這個世界**。
              · ⇒ 所以我去找稿裡**有等待**的元件。⛔ ~~本段原寫「**唯一**真的有等待的元件」~~
                **2026-09-03 R1 F2 訂正:那是把 n=1 寫成全稱,而我沒有量過分母。**
                ✅ 實際數法 `grep -rn "中…" design-reference/components/` ⇒ **3 處 / 2 個元件**:
                  `StorePickerModal.jsx:151` `{geoState === 'loading' && '定位中…'}`(另 `:43` 逐字
                    `// idle | loading | ok | error`)
                  `CheckoutPage.jsx:600` 與 `:677` `{processing ? '處理中…' : …}`
                ⇒ 🎯 **稿自己的做法是【一句「動詞+中…」的字】,不是轉圈圈圖示** ——
                  而 n=2 個元件 / 3 處**讓這個歸納比原本更硬**,不是更軟。
                (`is-loading` 那個 class 在 `design-reference/styles/` 掃 ⇒ **0 條 CSS 規則**。
                 ⚠️ 而稿是**換字 + 禁用**(同段 `:148` `disabled=…`;R1 F3)—— 本片無按鈕、不受影響。)
              · ⇒ 本格照搬那個慣例:**「搜尋中…」**。
              ⚠️ **鐵則 1 的分母我補記(R1 F4)**:`bash scripts/design-ref-check.sh` ⇒ 本樹 submodule
                已初始化、176 個檔(正對照 README.md 在);OD 那一側磁碟 **12** 個專案,
                掃 `search-overlay|搜尋中|searchOverlay` 只命中 3 支 `<專案>/source/app/layout.tsx` 的
                **註解行**(= storefront 原始碼副本、不是稿)⇒ **無競爭權威。**

              🔵 **而版面重用既有的「訊息槽」,零新增 CSS**:`.search-overlay-noresults` 那組
              (`search-overlay.css:231-243`)本來就是「疊層中央放一句話」的位置,
              `failed` 與「查無結果」兩支都用它 ⇒ 第三種狀態沒有理由自己開一套。
              `role="status"` 與 `failed` 那支一致(新出現的內容要唸得到)。 */}
          {q !== '' && view.kind === 'pending' && (
            <div className="search-overlay-noresults" role="status">
              <div className="search-overlay-nores-label">搜尋中…</div>
            </div>
          )}

          {/* 🔴 「這次查不到」與「真的沒有這件商品」要畫**兩種**字。
              少了這一格,一次 DB 抖動會告訴客人我們沒有這件商品。 */}
          {view.kind === 'failed' && (
            <div className="search-overlay-noresults" role="status">
              <div className="search-overlay-nores-label">搜尋暫時無法使用</div>
              <div className="search-overlay-nores-hint">請稍後再試一次,或用 LINE 直接問我們</div>
            </div>
          )}

          {view.kind === 'ok' && view.items.length === 0 && (
            <div className="search-overlay-noresults">
              <div className="search-overlay-nores-label">沒有找到「{q}」相關結果</div>
              <div className="search-overlay-nores-hint">試試「排氣管」、「Öhlins」、或你的車款名稱</div>
            </div>
          )}

          {view.kind === 'ok' && view.items.length > 0 && (
            <>
              <section className="search-overlay-section">
                <div className="search-overlay-h">商品 · {view.items.length}</div>
                <div className="search-overlay-products">
                  {view.items.map((p) => (
                    <button
                      key={p.slug}
                      type="button"
                      className="search-overlay-product"
                      onClick={() => { navigateToCatalog(router, `/products/${p.slug}`); close(); }}
                    >
                      <div className="sop-thumb">
                        {/* 🔴 用原生 `<img>` 是本 repo 的慣例(`ProductImage.tsx:132/152/172` 三處皆是),
                            而**不要**加 `eslint-disable-next-line @next/next/no-img-element` ——
                            本 repo 的 eslint **沒有註冊那條規則** ⇒ 加了 disable 反而 lint 紅
                            (`Definition for rule ... was not found`)。
                            ⚠️ 這個坑 `ComingSoon.tsx:161` 與 `OrdersTab.tsx:149` 已經各記過一次,
                               而我今天是第三次踩 —— 📌 記在兩個地方,擋不住第三個人。 */}
                        {p.image ? <img src={p.image} alt="" loading="lazy" /> : null}
                      </div>
                      <div className="sop-meta">
                        <div className="sop-brand">{p.brand}</div>
                        <div className="sop-name">{p.name}</div>
                        {/* 🔴 `null` 印「—」不是「NT$ 0」:0 元是贈品、查不到價格是另一件事。 */}
                        <div className="sop-price">{p.price === null ? '—' : `NT$ ${p.price.toLocaleString()}`}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <div className="search-overlay-footer">
                <button type="button" className="search-overlay-all" onClick={() => submit()}>
                  查看「{q}」的所有結果 →
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
