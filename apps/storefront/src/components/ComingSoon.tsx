// components/ComingSoon.tsx — 「即將上線」頁(全站重設計 第2批;2026-08-06)
//
// 真權威 = OD `pcm-home-redesign/coming-soon.html` + `coming-soon-handoff.md`。
// 交接單 §三 逐字:「原型的 `?v=` 只是為了在靜態檔環境預覽。真站請**抽成一個元件**」
// ⇒ 三個變體(整站 / stores / install)= 同一支元件 + 不同 props,不走 query string。
//
// 🔴 **`hasNav` 的語意是「這是站內頁」,不是「要不要好看」**。
//    Sean 2026-08-05 逐字:「即將上線的功能還是要保留天地,不然可能會跳到下一個頁面回不去。」
//    `/stores` `/install` 是站內頁 ⇒ 客人要能繼續逛;`/coming-soon` 是**整站上線前的唯一一頁**
//    ⇒ 那時其他頁都還沒上線,擺連結點了只會 404,所以刻意沒有天地(交接單驗收 #14 明列
//    「這是刻意的,不是漏做」)。
//
// 🔴 **交接單 §三之二 有一個前提在本站不成立,我沒有照抄那句話**:
//    它寫「真站不用做這段 —— Next.js 的 `app/layout.tsx` 本來就會包 header / footer」。
//    但本站的殼**不是 layout 注入的**(派工單 §3-2 實查:`Header` / `HomeFooter` 由各頁
//    view 元件各自 import、計 13 處,`app/` 底下無 nested layout)。
//    ⇒ 功能版的天地必須由 `app/stores/page.tsx` / `app/install/page.tsx` **自己 import**,
//    不會自動有。做法見那兩支 page 的檔頭。
//
// ⚠️ 設計稿的「天地」整段(深色精簡殼 `.cs-nav` + 頁尾的 `.cs-foot-nav` 快速前往欄)
//    **一律不搬**:那是為了讓靜態單檔原型有天地而寫的,真站有自己的 `<Header>` /
//    `<HomeFooter>`,兩套並存就是重複。交接單 §三之二 也是這個結論(「真站不用做這段」)
//    —— 錯的只是它給的理由(它以為 layout 會自動包)。
//    🔴 這條**第一版沒有貫徹**:我搬了 `.cs-foot-nav` 的 markup,結果 `/stores` `/install`
//    的門市 / 營業時間 / 社群 / 版權 / 統編**各出現兩次**(R1 抓到、真瀏覽器 count 實測 = 2)。
//    現在的規則很單純:**有天地 = 頁尾整個不渲染**(見下面 `!hasNav` 那段)。

import { TAX_ID } from '@/lib/site-config';

/** 20 家代理品牌的深色版 logo(`public/brands-dark/`,sha256 逐位元組核過源檔)。
 *  🔴 **寫死陣列、不用 glob 或 JS 產生**:設計端 §四 逐字「整站版是零 JS 頁,牆不該因為
 *  script 沒跑就整塊消失」。代價是新增品牌要手動加一行 —— 這是刻意的取捨(可靠性 > 省一行)。
 *  順序 = 設計稿 `coming-soon.html:354-373` 逐字,**不要排序**:`nth-child(5n+…)` 的錯落相位
 *  是照這個順序算的,重排會讓同一列同時亮起來。 */
const BRAND_LOGOS = [
  { slug: 'akrapovic', w: 800, h: 178 },
  { slug: 'rizoma', w: 380, h: 92 },
  { slug: 'lightech', w: 380, h: 92 },
  { slug: 'evotech', w: 380, h: 92 },
  { slug: 'gilles', w: 652, h: 137 },
  { slug: 'bonamici', w: 380, h: 92 },
  { slug: 'cnc-racing', w: 380, h: 92 },
  { slug: 'rpm-carbon', w: 380, h: 92 },
  { slug: 'kineo', w: 380, h: 92 },
  { slug: 'ebc', w: 800, h: 417 },
  { slug: 'gb-racing', w: 380, h: 92 },
  { slug: 'motogadget', w: 695, h: 91 },
  { slug: 'samco', w: 380, h: 92 },
  { slug: 'eazi-grip', w: 380, h: 92 },
  { slug: 'wrs', w: 380, h: 92 },
  { slug: 'dbk', w: 380, h: 92 },
  { slug: 'extreme', w: 380, h: 92 },
  { slug: 'materya', w: 380, h: 92 },
  { slug: 'front3d', w: 380, h: 92 },
  { slug: 'k-speed', w: 499, h: 377 },
] as const;

const LINE_URL = 'https://lin.ee/R6QZUH2';
const IG_URL = 'https://www.instagram.com/pcm_officialtw/';
const FB_URL = 'https://www.facebook.com/partscheaper';

function LineIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.5 11.6a7.6 7.6 0 0 1-10.9 6.8L4.2 20l1.6-5.2a7.6 7.6 0 1 1 14.7-3.2z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.3" cy="6.7" r="1" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}

export type ComingSoonProps = {
  /** mono 眉標。整站版 = 品牌句;功能版 = `N°06 · PARTNER STORES` 這種編號。 */
  eyebrow: string;
  /** 主標第一行(逗號前)。 */
  titleLead: string;
  /** 主標第二行,熔橘強調字。 */
  titleAccent: string;
  /** 說明段落。每個元素一行;`strong` 欄位標出該行要加粗的字面(設計稿用 `<strong>` 包)。 */
  lede: React.ReactNode;
  /** 狀態標的文字(設計端沒有上線日期可寫,所以只說狀態,不做倒數計時器)。 */
  etaText: string;
  /** 第二顆(次要)CTA。整站版 = IG「看最新到貨」;功能版 = 回首頁。 */
  secondaryCta: { href: string; label: string; icon: 'instagram' | 'home'; external?: boolean };
  /**
   * 這是不是站內頁。
   * `true`(`/stores` `/install`)= 主區大 logo 收起來(頁面已有 `<Header>` 那顆)、
   *   **本元件的頁尾整個不渲染**(由頁面自己的 `<HomeFooter>` 提供,否則會出現兩個頁尾)。
   * `false`(`/coming-soon`)= 整站版:主區自帶大 logo、自帶三欄頁尾與版權列、
   *   **沒有任何站內連結**(上線前其他頁還沒好,點了只會 404)。
   */
  hasNav: boolean;
};

export function ComingSoon(props: ComingSoonProps) {
  const { eyebrow, titleLead, titleAccent, lede, etaText, secondaryCta, hasNav } = props;

  return (
    <div className={`cs-page ${hasNav ? 'cs-has-nav' : ''}`} data-screen-label="ComingSoon">
      <main className="cs-main">
        <div className="cs-copy">
          {/* 功能版把這顆收起來 —— 頁面上方的 <Header> 已經有一顆,不重複(交接單驗收 #15)。 */}
          {!hasNav && (
            <span className="cs-logo">
              {/* 走原生 `<img>` 不走 `next/image` —— storefront 既有慣例
                  (`Header.tsx:35` / `HomeFooter.tsx:53` 逐字;全站原本零 next/image)。
                  w/h 寫**原生像素**(`sips` 實量 1384×902)= aspect-ratio 佔位、防 CLS,
                  與 0b 給頁首 logo 的作法同一條規則。 */}
              <img src="/pcm-stacked-bicolor-on-dark.png" width={1384} height={902} alt="PCM MOTOR PARTS" />
            </span>
          )}

          <div className="cs-mono">{eyebrow}</div>
          <h1 className="cs-title">
            {titleLead}
            <br />
            <em>{titleAccent}</em>
          </h1>
          <p className="cs-lede">{lede}</p>

          <div className="cs-eta">
            <span className="cs-eta-dot" aria-hidden="true" />
            <span>{etaText}</span>
          </div>

          <div className="cs-actions">
            <a className="cs-btn cs-btn-primary" href={LINE_URL} target="_blank" rel="noopener noreferrer">
              <LineIcon />
              <span>用 LINE 找我們</span>
            </a>
            <a
              className="cs-btn cs-btn-ghost"
              href={secondaryCta.href}
              {...(secondaryCta.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {secondaryCta.icon === 'instagram' ? <InstagramIcon /> : <HomeIcon />}
              <span>{secondaryCta.label}</span>
            </a>
          </div>
        </div>

        {/* 對讀屏是純裝飾層(alt 留空 + aria-hidden)—— 真正的品牌資訊在 /brands。 */}
        <div className="cs-art">
          {/* 走原生 `<img>`(不是 `next/image`)—— storefront 既有慣例,`Header.tsx:35` 逐字。
              本 repo 的 eslint 沒有註冊 `@next/next/no-img-element`,所以不需要 disable 註解。 */}
          <div className="cs-wall" aria-hidden="true">
            {BRAND_LOGOS.map((b) => (
              <img
                key={b.slug}
                src={`/brands-dark/${b.slug}.png`}
                width={b.w}
                height={b.h}
                alt=""
                loading="lazy"
              />
            ))}
          </div>
        </div>
      </main>

      {/* 🔴🔴 **有天地時整個頁尾都不渲染**,由頁面自己的 `<HomeFooter>` 提供。
          第一版兩個都渲染 ⇒ `/stores` `/install` 上**門市地址、營業時間、社群、版權列、統編
          各出現兩次**(真瀏覽器實測 count = 2)。設計稿之所以自帶頁尾,是因為它是一支
          完全自包含的靜態單檔、沒有別的頁尾可用;真站有 `<HomeFooter>`,兩個並存就是重複。
          ⇒ 「不搬天地」的判斷本來是對的,錯在我把頁尾那一欄的 markup 也搬了。
          `<HomeFooter>` 的「購物 / 服務 / 門市」三欄本來就涵蓋了設計稿「快速前往」要解決的
          問題(Sean 2026-08-05:「不然可能會跳到下一個頁面回不去」)、而且更完整。 */}
      {!hasNav && (
        <>
          <div className="cs-foot">
            <div className="cs-foot-col">
              <h2>門市</h2>
              <p>
                新北市新莊區化成路
                <br />
                736 巷 18 號1樓
              </p>
            </div>
            <div className="cs-foot-col">
              <h2>營業時間</h2>
              <p>週一-週六 10:00-19:00</p>
            </div>
            <div className="cs-foot-col">
              <h2>社群</h2>
              <div className="cs-social">
                <a href={FB_URL} target="_blank" rel="noopener noreferrer">Facebook</a>
                <a href={IG_URL} target="_blank" rel="noopener noreferrer">Instagram</a>
                <a href={LINE_URL} target="_blank" rel="noopener noreferrer">LINE</a>
              </div>
            </div>
          </div>

          <div className="cs-base">
            {/* 版權年份動態現算 —— 0b 的 D7 已把頁尾改成這個做法,這裡跟同一條規則。 */}
            <span className="cs-mono">© {new Date().getFullYear()} PCM MOTOR PARTS LTD. 版權所有</span>
            {/* 統編走 `lib/site-config.ts` 的 SSoT,不寫死 —— 與 `HomeFooter.tsx` 的
                `統一編號 {TAX_ID}` 那行同一條規則。
                ⚠️ 上面的門市地址與營業時間**仍然是寫死的**:照 `HomeFooter.tsx` 的
                `新北市新莊區化成路` / `週一-週六` 兩行對齊(那兩行在真站本來就寫死、
                沒吃 `STORE_ADDRESS` / `OPENING_HOURS`)。
                🔴 D-040(2026-08-15)更新這段:**「不吃 SSoT」這個債還在,但它的症狀已經變了。**
                  · 地址**字面**已對齊 Sean 拍板的正典值(`一樓` → `1樓`),兩個載體同一顆 commit 一起改。
                  · 本檔與 `HomeFooter.test.tsx` **各補了一格守門**釘渲染輸出 ⇒ 再漂掉會有東西紅。
                  · 剩下的債 = 這兩處仍不 import `STORE_ADDRESS`,所以**改常數不會傳到這裡**。
                    要修得動殼元件(`OPENING_HOURS` 目前也還沒有 SSoT 常數),不在本片範圍。
                ⚠️ 原註解寫的 `HomeFooter.tsx:89-90` / `:97` 是**過期行號**,已換成 grep 錨點 ——
                  行號會漂,錨點不會。 */}
            <span className="cs-mono">統一編號 {TAX_ID}</span>
          </div>
        </>
      )}
    </div>
  );
}
