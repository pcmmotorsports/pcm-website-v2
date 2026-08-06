'use client';

// HomeReveal.tsx — 首頁五個區塊的「捲進視窗才進場」控制器(D5g;2026-08-05)
//
// 真權威 = Open Design `pcm-home-redesign/direction-b-layout-01-graphite-ember.html` 的
// 捲動進場 IIFE + `N05-FOCUS-HANDOFF.md` §6-4。鐵則 1 例外 = 2026-08-03 Sean 拍 Q1=B。
// ⚠️ 刻意不引 OD 行號:那份稿仍在被改(D5d 實錘:四處引用的行號同一天全部漂掉)。
//
// 🔴 **這支不 render 任何東西,也不包住任何 children** —— 回 `null`。
//    handoff 說「需要一個 `'use client'` 的小 wrapper」,但 wrapper 會把被包住的
//    server component 變成它的 children prop(多一層序列化邊界、且容易被誤讀成
//    「這塊要改 client」)。**只掛一個 effect、用選擇器找元素**是更小的作法。
//    ⇒ 對應 handoff 那句「**不要為此把整個資料渲染改成 client**」。
//
//    🔴 **精確措辭**(R1 抓到我原本寫「五個區塊全部維持 server component」是**假的**):
//      · `HomeSelect.tsx:15` **本來就有 `'use client'`**(它用 client component `ProductCard`),
//        與本片無關、也不是本片造成的 —— 我當初查證時用 `head -1` 只看到該檔第 9 行那句
//        **註解**就下結論,證據被截斷。
//      · 正確的宣稱是:**`HomeReveal` 沒有讓任何一塊多轉 client**。
//        `CategoryGrid` / `HomeStatement` / `BrandIndex` / `FeatureEditorial` 四塊
//        經 R1 實查 `.next/server/app/page_client-reference-manifest.js` 確認**不在**其中,
//        是真的 server component;`HomeSelect` 早在本片之前就是 client。
//
// 🔴 **為什麼不是「render 完就加 class」**(這是 2026-08-05 修掉的真 bug,不要退回去):
//    N°05 在整頁最下面,從頁首滑到那裡要好幾秒 —— 載入即觸發的話動畫早就跑完了,
//    等於做了等於沒做。所以一定要 IntersectionObserver。
//
// 三個坑逐條照做(handoff §6-4 明列,少一個動畫就會不見或出事):
//   ① 起始隱藏狀態掛在 `body.js-reveal` 底下,而這個 class **只在「有 IO 且未開減少動效」時才加**
//      ⇒ JS 掛掉 / 不支援 / 使用者開了減少動效 ⇒ 整頁維持全可見,**不會因為動畫壞掉而看不到內容**。
//      (CSS 那邊的 `prefers-reduced-motion` 區塊是雙保險,兩道各自獨立。)
//   ② **雙層 `requestAnimationFrame`**:要讓瀏覽器先畫過一次「隱藏狀態」才有東西可過渡。
//      少了這步,observer 的第一次回呼會和建立狀態擠在同一幀,元素直接跳到完成樣子
//      —— 看起來就像完全沒有動畫。
//   ③ 失效保險必須**先確認「一個都沒進場」**才補救。無條件補救 = 把所有區塊一次全開,
//      往下捲時每一段都已經跑完(等於 ① 那個 bug 的另一種形狀)。
//
// ⛔ **不搬** OD 的 `?replay` 重播鍵:那是 OD 校對台的驗證工具(預覽容器不是一般捲動視窗),
//    正式站上不存在(handoff §6-4 逐字)。

import { useEffect } from 'react';

/** 進場目標:四個掛 `data-reveal` 的區塊 + N°05(它兩欄要錯開,見 home.css)。 */
const REVEAL_SELECTOR = '[data-reveal], .ed-feature';

/**
 * JS 認領某個目標的記號。**CSS 的起始隱藏只認這個屬性**(見 `home.css`)——
 * 沒有它就不會被藏起來,所以「JS 沒認領到的元素」永遠是可見的。
 */
const ARMED_ATTR = 'data-reveal-armed';

/** 失效保險的等待時間(毫秒)。OD 同值。 */
const FALLBACK_MS = 2000;

export function HomeReveal(): null {
  useEffect(() => {
    // ① 能不能動:兩個條件都要成立才進入「先藏起來」的世界。
    //    注意順序 —— `matchMedia` 在極舊環境可能不存在,先擋掉再問它。
    // 🔴 用 `typeof … === 'function'` 而**不是** `'IntersectionObserver' in window`:
    //    後者只問「有沒有這個 key」,值是 `undefined` 時照樣為真(polyfill 沒載到、
    //    或環境把它宣告成 undefined 就是這個形狀)⇒ 會先加上 `js-reveal` 把整頁藏起來,
    //    再在 `new IntersectionObserver(...)` 當場拋錯 —— **內容永久隱形而三綠全過**。
    //    這個洞是 `HomeReveal.test.tsx` 那條「沒有 IO ⇒ 不加 js-reveal」抓出來的,不是假想。
    const canAnimate =
      typeof window !== 'undefined'
      && typeof window.IntersectionObserver === 'function'
      && typeof window.matchMedia === 'function'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!canAnimate) return;

    const targets = Array.from(document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));
    // 🔴 一個都沒找到就**什麼都不做**:加了 `js-reveal` 卻沒有目標,等於把
    //    未來某個符合選擇器的元素永久藏起來(選擇器改名時的典型意外)。
    if (targets.length === 0) return;

    // 🔴 **逐個「上膛」,而不是只靠 body class 一次藏光**(R2 F2 must-fix,實測)。
    //    根因是不對稱:**藏是全域的(CSS 命中所有 `[data-reveal]`),掀是逐個的
    //    (JS 只認 mount 當下的快照)** ⇒ mount 之後才進 DOM 的目標永遠不會被觀察,
    //    保險也早就過期,而 `js-reveal` 還在 ⇒ 那一段**永久 opacity:0**。
    //    可達路徑不是假想:`page.tsx` 的 `{focus && <FeatureEditorial/>}` 與
    //    `CategoryGrid` 的 `cats.length === 0 → return null`,都是「由無變有」的條件渲染。
    //    ⇒ 改成 CSS 只藏**帶 `data-reveal-armed` 的元素**,而那個屬性只有這裡會加。
    //      沒被 JS 認領的元素 = 一律看得見(頂多沒有動畫),**不可能永久隱形**。
    for (const target of targets) target.setAttribute(ARMED_ATTR, '');
    document.body.classList.add('js-reveal');

    // ⚠️ `cancelled` = **第二道保險,我構造不出讓它變紅的負測**(誠實標註,不誇大):
    //    真正擋住「卸載後 rAF 才跑」的是 cleanup 裡的 `cancelAnimationFrame` ——
    //    實測(含「外層已跑、內層未跑」那個中間窗)把這個旗標整個拿掉,行為完全相同、
    //    測試全綠。⇒ 依本 repo 的判準,構造不出負測的守門要先懷疑它是 no-op。
    //    **保留的理由只有一個**:規格上 `cancelAnimationFrame` 對「已經被取出、正在該幀
    //    執行清單裡」的 callback 不保證攔得住,那時這個旗標是最後一道。
    //    ⇒ 它是 defence in depth,**不是**本檔正確性的承重點。別因為它在就放心刪 cleanup。
    let cancelled = false;
    let sawCallback = false;
    let observer: IntersectionObserver | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

    // ③ 失效保險。🔴 **判準是「observer 到底有沒有接上」,不是「有沒有人進場」**
    //    (R2 must-fix,實測):第一個目標(N°02 最新商品,H6 後 class 為 `.b-select`) 在桌機 1440x900 的 `top=1130px`、
    //    手機 390x844 的 `top=1238px` —— **都在首屏之外**。所以「一個都沒進場」是
    //    **正常狀態、不是故障訊號**;舊判準會在**每一次正常首載**的第 2 秒把五段一次全開,
    //    使用者只要看 hero 或用選車器超過兩秒才開始滑,進場動畫就等於沒做
    //    —— 正是 handoff「不要退回載入即觸發」要防的事,只是延後 2 秒。
    //    ⚠️ 這是**申報偏離 OD 字面**(OD §6-4 第③點寫「先確認一個都沒進場」),
    //      但那一點的**意圖**就是「observer 沒接上時才補救」;OD 原型自己也踩了同一個坑。
    // 🔴 而且**註冊在 rAF 之外**:rAF 在背景分頁會被完全暫停(R2 實測 hidden 分頁
    //    `rafHidden=0`、`timerHidden=13`)⇒ 巢在 rAF 內註冊的話,背景分頁載入時
    //    保險根本掛不上,切回前景前整頁隱形。setTimeout 在背景照跑,所以放外面才保得住。
    fallbackTimer = setTimeout(() => {
      // 🔴 判準是「observer **回呼過**」,不是「observer 物件存在」(R3 找到的洞):
      //    建得起來 ≠ 會動 —— 目標在 `display:none` 祖先底下 / 被移出 DOM / 實作被閹割時,
      //    observer 物件在、卻永遠不回呼 ⇒ 用「物件存在」當判準會讓保險**自廢**,
      //    而沒有人會來掀那五段 = 永久隱形。
      //    真的 IO 在 `observe()` 後必送一次初始回呼(不論相不相交),所以正常情況下
      //    這個旗標幾乎立刻為真、保險照樣不會誤觸發(已在真瀏覽器實測:等 3.6 秒仍未進場)。
      if (sawCallback) return;
      for (const target of targets) target.classList.add('is-in');
      document.body.classList.remove('js-reveal');
    }, FALLBACK_MS);

    // 兩層 rAF 的 handle 都要收著才取消得掉(cleanup 可能落在兩層之間)。
    // ⚠️ 這個陣列必須宣告在下面那個 callback **之前** —— 雖然 rAF 是非同步、
    //    實際執行時它早就初始化好了,但寫在後面就是在 TDZ 邊緣,下一個人挪動順序就會炸。
    const cleanupRafs: number[] = [];

    // ② 雙層 rAF:第一幀讓瀏覽器畫出隱藏狀態,第二幀才開始觀察。
    cleanupRafs.push(requestAnimationFrame(() => {
      if (cancelled) return;
      cleanupRafs.push(requestAnimationFrame(() => {
        if (cancelled) return;
        // 🔴 **建構子本身可能同步拋錯**(R1 找到的第四種「永久隱形」路徑):
        //    有些隱私瀏覽器 / 擴充套件會把敏感 API stub 成「存在、且 `typeof` 是 function,
        //    但一呼叫就炸」⇒ 上面的能力檢查過得了,而 `js-reveal` **此時已經掛上去了**。
        //    更糟的是下面那個 2 秒保險寫在建構子**之後**、同一個 callback 裡 ——
        //    建構子一炸,保險那行連跑都跑不到 ⇒ 五個區塊永久 `opacity:0` 而三綠全過。
        //    ⇒ 接住它,並**當場退回「全部可見」**:動畫沒了無所謂,內容看不到才是災難。
        //    ⚠️ OD 那份原生 IIFE 也沒有這層(同形)—— 這是**補強、不是修回歸**。
        try {
          observer = new IntersectionObserver(
          (entries) => {
            sawCallback = true;
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              entry.target.classList.add('is-in');
              // 一次性:捲上去再下來不重播(OD 逐字「不做來回抽動」)。
              observer?.unobserve(entry.target);
            }
          },
          { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
        );
        for (const target of targets) observer.observe(target);
        } catch {
          // 建構子炸了 ⇒ 這一頁不做進場動畫,但**內容一定要看得見**。
          // 拿掉 `js-reveal` 就等於回到「JS 沒跑到」那個安全狀態(起始隱藏整組失效)。
          document.body.classList.remove('js-reveal');
        }
      }));
    }));

    return () => {
      cancelled = true;
      for (const raf of cleanupRafs) cancelAnimationFrame(raf);
      if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
      observer?.disconnect();
      // 🔴 拿掉 `js-reveal`,但**不動已經加上的 `is-in`**:
      //    `body` 是跨路由共用的,留著 class 會讓別的頁面上任何符合選擇器的元素被藏住;
      //    而 `is-in` 留著才不會在 StrictMode 的第二次 mount 讓已經現身的區塊又閃一下。
      document.body.classList.remove('js-reveal');
      // 上膛屬性一併卸除:留著的話,下一次 mount 前那些元素會維持在「可被藏」的狀態。
      for (const target of targets) target.removeAttribute(ARMED_ATTR);
    };
  }, []);

  return null;
}
