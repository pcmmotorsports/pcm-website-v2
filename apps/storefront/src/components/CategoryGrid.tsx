// CategoryGrid.tsx — 首頁 N°03 部品分類:11 顆 icon chip + 第 12 格「全部分類」(D5c / 首頁對齊批 H3;2026-08-06)
//
// 字面搬自 Open Design `pcm-home-redesign/direction-b-layout-01-graphite-ember.html`
// (骨架與 11 顆 icon :924-991、CSS :275-289、統一版面層 :640-672、色碼 :36-38)。
// 鐵則 1 例外 = Sean 2026-08-03 拍 Q1=B(本線真權威在 OD);D5c 本身 Sean 已拍「照抄稿」。
//
// ── 換掉了什麼(前一版是 8 張 Unsplash 裝飾圖卡)────────────────────────────────
//   · 8 格圖卡(`.ed-cats` / `.ed-cat-grid`,`DECOR_IMAGES` 裝飾圖與分類語意無關)
//     → 11 顆 icon chip + 第 12 格「全部分類」(`.b-cats` / `.b-cat-list`,6×2 磚面)。
//   · 表頭右側的「查看全部分類」文字連結退場 —— OD 表頭右側放的是排序說明 `.b-cats-note`,
//     「全部分類」由第 12 格承擔(:990-993)。兩者目的地相同(`/products`),入口沒有變少。
//
// ── 🔴 三個數字全部現算,一個都不寫死(Sean 拍板時特別點名)──────────────────────
//   · 「取前 N 名」的 N = 實際畫出來的 chip 數 = `chips.length`
//   · 「全站共 M 類」的 M = `categories.length`(server 傳進來的真目錄頂層分類)
//   · 版面是 12 格 = 11 顆 chip + 1 顆「全部分類」⇒ 唯一的常數是 `WALL_CELLS = 12`
//     (OD :639 逐字「12 格 = 11 個分類 + 1 個更多分類,桌機 6×2 收成一塊完整磚面」),
//     chip 數由它減 1 求得。分類不足 11 類時 `chips.length` 自然變小,說明文字跟著變、不會說謊。
//   ⚠️ 件數(`c.count`)也是 server 帶的即時值 —— OD 稿上那些數字是 2026-08-01 的快照,
//      稿的註解自己就寫「data-live="count" 的數字由後端帶」。**不要把稿上的數字抄進 code。**
//
// ── 🔴 icon 與色碼綁「分類」、不綁「名次」(OD :927-929 逐字)────────────────────
//   名次會變 ⇒ 哪 11 類上榜也會變。所以下面這張表用**分類名**當鍵:
//   · 為什麼不用 `id`:實查真目錄(2026-08-06,主樹 3111 的 RSC payload),頂層分類的 `id` 是
//     UUID(`fb3e68c3-915b-…`)—— 不可讀、換一次匯入就變。而**分類名本來就是全站的接合鍵**
//     (`?category=<分類名>`、`products-url-state.parseCategoryFromUrl` 比對的也是它)。
//   · 色碼編號與 `brand-content.ts` 的 `categories: [分類名, 色碼編號]` **是同一套**
//     (實查 12 個分類名對到的編號零衝突),`0` = 這一類沒有色碼,也是那份資料既有的哨兵值。
//   · 調色盤 `--cat-1..11` 由 `styles/home.css` 的 `.ed-page` 提供,值與 `styles/brand-page.css`
//     的 `.bp-page` 那份逐字相同(守門在 `styles/home.test.ts`,兩邊分家會轉紅)。
//
// ── ⚠️ 沒有 icon 的分類會發生什麼(**已知邊界,Sean 未拍板前的暫行做法**)────────
//   OD 只畫了 11 顆 icon,而全站有 15 類(2026-08-06 實測)。未進榜的 4 類
//   (煞車系統 285 / 懸吊與車架 202 / 四輪 ATV/UTV 46 / 服務／其他 1)沒有 icon;
//   哪天它們的件數超車就會上榜、而稿上沒有那顆圖。
//   本片的暫行做法 = **chip 照畫、但不畫 icon 格**(純文字 chip),並掛上 `.b-cat-chip--noicon`
//   讓它在真瀏覽器 / E2E 掃得出來。**不隱藏那個分類**(客人會少一個入口)、
//   **也不自己補畫 icon**(那是視覺設計,分工上不是我的)。
//   ✅ Sean 2026-08-06 拍 **A**(信箱 `D-125-A`):純文字 chip、不留空圖格 —— 即本檔現行做法,零改動。
//   🔴 **「進榜卻沒 icon 要被看見」怎麼做到的**(主視窗要求掛守門;誠實講清楚哪一半做得到):
//      · ❌ 單元測試**做不到**:它看不到真目錄(`categories` 是測試自己餵的),
//        任何「前 11 名都有 icon」的斷言都只是在驗自己剛餵進去的 fixture = 恆真。
//      · ✅ **執行期告警做得到**:下面 `warnMissingIcon()` 在真的有分類上榜卻查無 icon 時
//        對 server log 吐一行(含分類名與件數)。真目錄一變,下一次首頁渲染就會叫。
//        **告警本身有單元測試**(餵一個沒有 icon 的分類 → 斷言真的叫了、且叫對名字)。
//      · ⏳ 真正的「紅」要靠接真資料的 E2E ⇒ 已在收工信請主視窗立 backlog。

import type { ReactElement } from 'react';
import Link from 'next/link';
import type { MockCategory } from '@/data/mock-categories';

/** 版面是一塊 6×2 的磚面(OD :639);唯一的版面常數,chip 數由它減去「全部分類」那一格求得。 */
const WALL_CELLS = 12;

/**
 * 分類名 → { 色碼編號, icon }。icon 的 `path` 全部是 OD :930-989 的字面,一筆一劃未改。
 * 🔴 新增分類時**不要套公式**:icon 要有人畫、色碼要有人指定,兩者都缺就走上面那條暫行做法。
 */
const CATEGORY_CHIPS: Readonly<Record<string, { cat: number; icon: ReactElement }>> = {
  外觀與後視鏡: {
    cat: 1,
    // 後視鏡:傾斜鏡面 + 支桿 + 手把座
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="11.6" y="3.2" width="9.8" height="7" rx="2.4" transform="rotate(-14 16.5 6.7)" />
        <path d="M11.8 10.8 8.8 14.9" />
        <path d="M8.8 14.9V18" />
        <path d="M4 18h9.6" />
      </svg>
    ),
  },
  騎士用品與配件: {
    cat: 2,
    // 全罩安全帽:帽殼 + 帽緣 + 鏡片開口
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M3.6 16.6a8.4 8.4 0 0 1 16.8 0" />
        <path d="M3.6 16.6h16.8" />
        <path d="M8 10.4h8.6a1.2 1.2 0 0 1 1.15 1.55l-.65 2.2a1.2 1.2 0 0 1-1.15.85H8z" />
      </svg>
    ),
  },
  碳纖維部品: {
    cat: 3,
    // 斜紋碳纖編織面
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
        <path d="M3.5 10 10 3.5M3.5 16.5 16.5 3.5M7.5 20.5 20.5 7.5M14 20.5l6.5-6.5" />
      </svg>
    ),
  },
  車身防護與防摔: {
    cat: 4,
    // 護盾 + 防摔球
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 21.2s7.2-3.6 7.2-9.2V5.8L12 3 4.8 5.8V12c0 5.6 7.2 9.2 7.2 9.2z" />
        <circle cx="12" cy="11.2" r="2.3" />
      </svg>
    ),
  },
  拉桿與把手: {
    cat: 5,
    // 握把 + 煞車拉桿
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="2.4" y="9" width="9" height="6" rx="3" />
        <path d="M11.4 11.2 20.4 9.2a1.6 1.6 0 0 1 .7 3.05L13 14.4" />
      </svg>
    ),
  },
  精品螺絲與螺帽: {
    cat: 6,
    // 六角螺帽
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 2.7 20 7.35v9.3L12 21.3 4 16.65v-9.3z" />
        <circle cx="12" cy="12" r="3.4" />
      </svg>
    ),
  },
  引擎與冷卻: {
    cat: 7,
    // 水冷排:散熱鰭片 + 上下水管口
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3.5" y="6" width="17" height="12" rx="2" />
        <path d="M8.2 6v12M12 6v12M15.8 6v12" />
        <path d="M3.5 9.5H1.5M3.5 14.5H1.5M22.5 9.5h-2M22.5 14.5h-2" />
      </svg>
    ),
  },
  止滑貼與保護膜: {
    cat: 8,
    // 保護膜:掀角貼片
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M20 4.8v9.4L14.2 20H5.6A1.6 1.6 0 0 1 4 18.4V5.6A1.6 1.6 0 0 1 5.6 4h12.8z" />
        <path d="M20 14.2h-4.2a1.6 1.6 0 0 0-1.6 1.6V20" />
      </svg>
    ),
  },
  腳踏後移與傳動: {
    cat: 9,
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="6.4" />
        <circle cx="12" cy="12" r="2.3" />
        <path d="M12 2.8v2.8M12 18.4v2.8M21.2 12h-2.8M5.6 12H2.8M18.5 5.5l-2 2M7.5 16.5l-2 2M18.5 18.5l-2-2M7.5 7.5l-2-2" />
      </svg>
    ),
  },
  排氣系統: {
    cat: 10,
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M9.6 8.4h8.4a2.5 2.5 0 0 1 2.5 2.5v2.2a2.5 2.5 0 0 1-2.5 2.5H9.6z" />
        <path d="M9.6 10.2 5.7 8.3a1.9 1.9 0 0 0-2.8 1.7v4a1.9 1.9 0 0 0 2.8 1.7l3.9-1.9" />
      </svg>
    ),
  },
  燈具與電子: {
    cat: 11,
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4.2 12a7.8 7.8 0 0 1 7.8-7.8v15.6A7.8 7.8 0 0 1 4.2 12z" />
        <path d="M14.6 8.6h4.6M14.6 12h6.2M14.6 15.4h4.6" />
      </svg>
    ),
  },
};

/**
 * 上榜卻查無 icon → 對 server log 吐一行。**這是本片唯一能真的看到真目錄的偵測點**
 * (單元測試只看得到自己餵的 fixture)。
 * ⚠️ 它擋不住什麼:①只在首頁被渲染時才叫(首頁有快取 ⇒ 不是即時)②沒有人看 log 就等於沒叫
 * ③它報的是「查無 icon」,分類**被改名**同樣會走到這裡 —— 那正是最容易靜默的那種變更。
 */
function warnMissingIcon(missing: MockCategory[]): void {
  if (missing.length === 0) return;
  // 這行就是本片唯一看得到真目錄的偵測點(理由見上方 doc);拿掉它 = 回到靜默。
  // ⚠️ 不加 `eslint-disable no-console`:本 repo 沒開那條規則,加了會變成「無用指令」警告、
  //    而 lint 是 `--max-warnings 0` ⇒ 反而讓三綠變紅(第一版真的踩到)。
  console.warn(
    `[CategoryGrid] 有 ${missing.length} 個分類上了首頁磚面卻查無 icon(會渲染成純文字 chip):` +
      missing.map((c) => `${c.name}(${c.count} 件)`).join('、') +
      ' — 要補 icon 請走設計出稿,不要自己畫(Sean 2026-08-06 拍 A:純文字 chip 是可接受的暫態)',
  );
}

export function CategoryGrid({ categories }: { categories: MockCategory[] }) {
  // 依件數遞減取前 11(`buildCategoryTree` 已按群數排序,這裡保守再排一次)。
  const chips = [...categories].sort((a, b) => b.count - a.count).slice(0, WALL_CELLS - 1);
  if (chips.length === 0) return null; // 空 → 整段不渲染(勝過假卡或空磚面)
  warnMissingIcon(chips.filter((c) => !CATEGORY_CHIPS[c.name]));

  // OD `:924` 是 `data-od-id="categories"`(原型標記)、**沒有真 id** ⇒ 這裡也不造一個
  // (R1 nit:第一版加了 `id="categories"`,全 repo 零引用 = 憑空多出的字面)。
  return (
    <section data-reveal className="b-cats">
      <div className="ed-section-head">
        <h2 className="ed-section-label">
          <span className="ed-mono">N°03</span>
          <span>Categories · 部品分類</span>
        </h2>
        {/* 🔴 兩個數字都現算:抄稿上的「11」「15」會在分類增減的那一天開始說謊,
            而畫面看起來完全正常 —— 沒有任何測試會紅。 */}
        <p className="b-cats-note">
          依件數排序取前 {chips.length} 名 · 全站共 {categories.length} 類
        </p>
      </div>
      <div className="b-cat-list">
        {chips.map((c) => {
          const chip = CATEGORY_CHIPS[c.name];
          return (
            <Link
              key={c.id}
              className={chip ? 'b-cat-chip' : 'b-cat-chip b-cat-chip--noicon'}
              // 色碼綁分類、不綁名次(OD :929);沒有對照的分類不輸出 data-cat = 不畫色條。
              data-cat={chip ? chip.cat : undefined}
              href={`/products?category=${encodeURIComponent(c.name)}`}
            >
              {chip && (
                <span className="b-cat-icon" aria-hidden="true">
                  {chip.icon}
                </span>
              )}
              <span className="b-cat-label">
                {c.name}
                <span className="b-cat-count">{c.count}</span>
              </span>
            </Link>
          );
        })}
        {/* 第 12 格 = 更多分類(OD :990-993)。目的地與退場的表頭連結相同。 */}
        <Link className="b-cat-more" href="/products">
          <span>全部分類</span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
