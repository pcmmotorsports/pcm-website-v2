// HomeHero.tsx — 首頁 N°01:四張實拍輪播 + 選車器 dock(D6 / 首頁對齊批 H5;2026-08-06)
//
// 字面搬自 Open Design `pcm-home-redesign/direction-b-layout-01-graphite-ember.html`
// (骨架 :771-836、輪播腳本 :1280-1352、CSS :108-175、統一版面層 :627-634)。
// 鐵則 1 例外 = Sean 2026-08-03 拍 Q1=B(本線真權威在 OD)。
// 資產由 H4 轉存進 `public/hero/`(8 檔,sha256 對源;守門 `data/hero-assets.test.ts`)。
//
// ── 🔴 本檔從 server component 變成 client component ──────────────────────────
//   前一版檔頭逐字寫「'use client' 移除原因:此元件無 useState / useEffect / onClick」。
//   **那個前提在本片消失**:OD 的 hero 不是四張圖輪流亮,是「**圖與文案一起換**」
//   (每張各自的眉標與標題,:1302-1307),而且帶三條互動規則(下面「輪播的三件事」)。
//   ⚠️ 邊界只擴到這一支:`page.tsx` 仍是 server component,選車器由 `children` 傳進來
//      (server 端算好的資料照舊在 server 算),**沒有讓任何一塊多轉 client**。
//
// ── 輪播的三件事(OD :1282-1288 逐字,改之前先讀)────────────────────────────
//   1. 圖片放 DOM 讓瀏覽器自己排下載,文案放 `SLIDES` 陣列 —— 加減張數 = 三邊數量一起改。
//   2. `prefers-reduced-motion` 開著就**完全不自動輪播**,只留手動。
//      「自動移動的東西對前庭障礙使用者是實際的生理不適,不是喜好問題。」
//   3. 滑鼠移入、鍵盤 focus 進來、分頁切到背景,都會暫停。
//      「使用者正在讀的時候把字抽掉,是輪播最惹人厭的一件事。」
//
// ── ⚠️ 第 2-4 張為什麼要自己延後補 `src`(OD :1311-1313)───────────────────────
//   它們躲在 `opacity: 0` 後面**但仍在視窗內** ⇒ `loading="lazy"` 對這種情況不生效,
//   不延的話首屏會同時吞四張 2.5K 大圖。第 1 張反過來要 `fetchPriority="high"`(它是 LCP)。
//
// ── ⚠️ 為什麼不用 `next/image` ────────────────────────────────────────────────
//   OD 用 `<picture>` + `<source media>` 做的是**藝術指導**(手機吃另一張直式構圖 1080×1800,
//   不是把寬版 2560×1200 裁一裁 —— CSS 註解逐字:「寬版是橫幅構圖,手機 cover 只看得到全圖約 24%」)。
//   `next/image` 的 `sizes` 只換解析度、不換構圖。這裡照 OD 用原生 `<picture>`,
//   兩張圖都已在 `public/` 下、走同網域靜態檔 ⇒ **不需要動 `next.config`**(鐵則 12 ④ 不命中)。

'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * 四張輪播。**文案順序是對著圖排的,不要單獨調動其中一邊**(OD :1298-1301 逐字):
 *   01 BMW 車頭 → 品牌宣言   02 輪框 → 裝得上(輪框正是最講相容性的件)
 *   03 貨架     → 數十個品牌 04 避震 → 安裝(避震正是最需要進場調的件)
 * 🔴「數十個」不是「二十個」:Sean 2026-08-05「我們品牌還很多沒上」⇒ 原字面與事實不符(OD :1301)。
 * 🔴 標題的換行位置是**刻意寫死**的(OD :803 註解):中文不能靠 `max-width` 自然斷,
 *    會斷在「展／現」這種詞中間。
 */
const SLIDES = [
  {
    n: '01',
    eyebrow: 'PCM MOTOR PARTS ‧ 重機零件與改裝精品',
    title: ['改裝不只是升級配件，', '更是展現風格與態度的延伸'],
  },
  { n: '02', eyebrow: 'FITMENT ‧ 依車款匹配', title: ['輸入車款與年份，', '只看裝得上的東西'] },
  { n: '03', eyebrow: 'BRANDS ‧ 代理品牌', title: ['數十個改裝品牌，', '都在同一個購物車'] },
  { n: '04', eyebrow: 'INSTALL ‧ 安裝與合作車行', title: ['不只把零件賣給您，', '安裝也幫您約好'] },
] as const;

/** 停留時間(OD :1308 的 `DWELL`)。 */
const DWELL_MS = 6500;
/** 窄螢幕改吃直式底圖的斷點:要與 CSS `@media` 和 OD `<source media>` 一致(OD :143 註解)。 */
const NARROW_MAX_W = 900;

export function HomeHero({ children }: { children?: ReactNode }) {
  const [at, setAt] = useState(0);
  /** 第 2-4 張等 `load` 之後才補 src(理由見檔頭)。 */
  const [warmed, setWarmed] = useState(false);
  /** 三個暫停來源分開記:合成一個布林會讓「滑鼠移出」把「分頁在背景」也一起解除。 */
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reduce, setReduce] = useState(false);
  /** 手動點擊切換後要**重新計時**(OD :1345 的 `show(i); play();`),靠這顆讓計時 effect 重跑。 */
  const [restart, setRestart] = useState(0);

  useEffect(() => {
    if (document.readyState === 'complete') {
      setWarmed(true);
      return;
    }
    const onLoad = () => setWarmed(true);
    window.addEventListener('load', onLoad, { once: true });
    return () => window.removeEventListener('load', onLoad);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // 🔴 `reduce` 在這裡是**硬條件**、不是加速度:開著就完全不排計時器(不是排了之後跳過)。
  // ⚠️ **與 OD 腳本的一處行為差異(R1 指出,申報而非照抄)**:OD :1342 是「interval 常駐、
  //    內部看 `paused` 旗標」⇒ 暫停再恢復會**接著原本的節奏**,可能滑鼠一移開就立刻換張;
  //    本檔是「暫停就清掉 interval、恢復時重排」⇒ 恢復後給滿一個完整的 6.5 秒。
  //    選後者的理由與 OD 自己寫的暫停動機同一條(「使用者正在讀的時候把字抽掉是最惹人厭的」)——
  //    剛把滑鼠移開就被抽走,和沒暫停過差不多。副作用:在 hero 內按 Tab 每次都會重排一次計時器,
  //    行為無害(只是那一張多停一會),不另外處理。
  const autoplay = !reduce && !hovered && !focused && !hidden;
  useEffect(() => {
    if (!autoplay) return;
    const id = window.setInterval(() => setAt((i) => (i + 1) % SLIDES.length), DWELL_MS);
    return () => window.clearInterval(id);
  }, [autoplay, restart]);

  const current = SLIDES[at]!;

  return (
    // 🔴 `id="vehicle-finder"` 從 `VehicleFinder` 搬到這裡(OD :771 就是掛在 hero section 上)——
    //    選車器 dock 化之後它本來就在 hero 裡面,而 `Header.tsx` 首頁那顆「依車輛搜尋」導的
    //    `/#vehicle-finder` **一個字都不用改**就還是對的(有測試釘住)。
    <section
      id="vehicle-finder"
      className="b-hero"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div className="b-hero-media">
        {SLIDES.map((s, i) => {
          // 第 1 張一定要有 src(它是 LCP);其餘等 load 之後才補。
          const load = i === 0 || warmed;
          return (
            <picture key={s.n} className={i === at ? 'b-hero-slide is-on' : 'b-hero-slide'}>
              {/* 🔴 `srcSet` 要**先**於 `src` 存在,否則瀏覽器一看到 img.src 就選定了、不會回頭看 source
                  (OD :1317 逐字)。React 依 JSX 順序輸出,`<source>` 寫在 `<img>` 前面即滿足。 */}
              {/* 🔴 未 warm 的那幾張**整個 `<img>` 都不畫**,而不是畫一個沒有 `src` 的 `<img>`
                  (OD 原型用 `data-src` 佔位是因為它在原生 DOM 裡要拿得到節點;React 這邊
                  條件渲染即可,行為一樣是「load 之後才發請求」,而且不會在 HTML 裡留下
                  一個沒有來源的 `<img>`)。它們本來就躲在 `opacity: 0` 後面,晚一拍掛上去看不出來。 */}
              {load && (
                <>
                  <source media={`(max-width: ${NARROW_MAX_W}px)`} srcSet={`/hero/hero-${s.n}-m.jpg`} />
                  <img
                    src={`/hero/hero-${s.n}.jpg`}
                    alt=""
                    width={2560}
                    height={1200}
                    fetchPriority={i === 0 ? 'high' : undefined}
                  />
                </>
              )}
            </picture>
          );
        })}
        <div className="b-hero-tint" />
      </div>
      <div className="b-hero-inner">
        <div className="b-hero-eyebrow">
          <span className="b-hero-dot" aria-hidden="true" />
          <span>{current.eyebrow}</span>
        </div>
        {/* `--cjk` 那一版的行高 / 字距 / max-width 三個值都與拉丁字母版不同,不要合併(OD :168-174)。 */}
        <h1 className="b-hero-title b-hero-title--cjk">
          {current.title[0]}
          <br />
          {current.title[1]}
        </h1>

        <div className="b-hero-nav" role="group" aria-label="主視覺切換">
          {SLIDES.map((s, i) => (
            <button
              key={s.n}
              type="button"
              className={i === at ? 'b-hero-tick is-on' : 'b-hero-tick'}
              aria-label={`第 ${i + 1} 張主視覺`}
              aria-current={i === at ? 'true' : undefined}
              onClick={() => {
                setAt(i);
                setRestart((r) => r + 1);
              }}
            />
          ))}
        </div>

        {/* 選車器 dock。**由 `page.tsx` 以 children 傳進來**,不是本檔自己 import ——
            它需要 server 端算好的車輛字典與車庫資料,本檔轉成 client 之後不該再去碰那些。 */}
        {children}
      </div>
    </section>
  );
}
