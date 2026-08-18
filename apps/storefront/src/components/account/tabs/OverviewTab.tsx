// OverviewTab.tsx — 會員中心「總覽」分頁(g-2:接 stats + featured 真資料、g-1a stub 退場)
//
// 直接搬 design-reference/components/AccountPages.jsx overview block(L467-535):
// - acc-stats(3 卡):Member tier(TierBadge + sub 字面)/ Stored value / Total orders
// - acc-section 最近訂單(L498-517):M-3 接真資料 recentOrders(AccountView slice(0,2) 傳入);
//   對齊 design preview 字面(.acc-order 無 -full、meta「件」、無詳情鈕);0 筆走 acc-empty 空狀態。
//   不搬 design mock orders 字面(PCM-2026-0042 / NT$ 18,600 / 已出貨)。
// - acc-section 為你推薦:g-2 走 fetchFeaturedProducts(server-side、Supabase 真資料)。
//   🔴 2026-08-06 更正(R1 MF1):本段原本寫「+ <ProductImage>(…wrapper .acc-rec-img 撐
//      aspect-ratio)」與「design 用 mock data.products.slice(0,4)」—— **兩句都已過期**:
//      卡片改用共用 `ProductCard`(Sean 拍板「格式跟首頁最新商品一樣」),`.acc-rec-img`
//      wrapper 與 `ProductImage` 直呼都已刪除、高度由 `.pcard-img-wrap` 的 aspect-ratio 給。
//   🔴 2026-08-07 R-3 再更正:上一行原本還寫「顯示筆數也已是 `ACCOUNT_REC_DISPLAY`(8)不是 4」
//      —— 那句已作廢。整區改用共用 `ProductRail` 橫捲,**不再截斷、全顯**(理由見下方常數位置的說明)。
//   ⚠️ tier-aware pricing 暫不接(server page.tsx 固定 'general' 公開價、待 M-1-16、見 manifest
//   featuredProductsViaSupabase business override + codex k2 round1 must-fix#1)、本 tab 收到的
//   `featured` 已是 general 公開價序列、不傳 stats.tier 影響推薦定價
//
// stats / featured 由 server page.tsx 傳入(prop drill;對齊 plan v2 決策 4)。
// tier 字面 sub 對齊 design L477-481:premium_store → 「已享 PREMIUM 經銷折扣」/ store →
// 「已享店家經銷價」/ general →「一般會員價(升級需聯絡客服)」(用 schemaTierToDesign 收斂)。

import { schemaTierToDesign } from '@pcm/domain';
import type { MemberTier, OrderListItem } from '@pcm/domain';
import { TierBadge } from '@/components/TierBadge';
import { ProductRail } from '@/components/ProductRail';
import type { AccountStats } from '@/components/account/AccountView';
import type { FeaturedResult } from '@/lib/products';
import { formatOrderDate, orderStatusLabel } from '@/lib/orders/order-display';
import { ORDER_ITEM_COUNT_TRUNCATED_NOTE } from '@/lib/account-order-copy';

export type OverviewTabProps = {
  stats: AccountStats;
  featured: FeaturedResult;
  // M-3:最近訂單 preview(AccountView 已 slice(0,2) 傳入;與 stats.orderCount 同源、Q5=A 一致)
  recentOrders: OrderListItem[];
  onJumpToOrders: () => void;
  onJumpToWallet: () => void;
};

// 🔴 2026-08-07 R-3:這裡原本有一顆 `ACCOUNT_REC_DISPLAY = 8`,把 10 筆截成 8 筆。
//    那是 Sean 2026-08-06 拍板 B(主視窗 `D-138-A`),而**理由純粹是版面**:
//    「取數從 4 提到 10 之後,這一格的 4 欄 grid 會排成 4+4+2、最後一列缺兩格」⇒ 切成 4 的倍數。
//    ⇒ 本片把版面由 grid 換成橫捲 rail,**rail 沒有「列」的概念、不存在缺角** ——
//    那條限制的**存在理由整個消失**;Sean 2026-08-07 已拍「rail 全顯、與首頁一致」。
//    ⚠️ 是**理由消失而作廢**,不是被忘記:常數與那條「顯示筆數整除 `.acc-rec` 欄數」的守門
//    一起移除,改由 `lib/products-featured-limit.test.ts`(取數必須 > 桌機軌道格數)覆蓋 ——
//    首頁與本頁現在是**同一顆 rail、同一個取數**,那支一支就夠、不需要本頁再抄一份。

// tier sub 字面對齊 design AccountPages.jsx L477-481
function tierSubLabel(tier: MemberTier): string {
  const designKey = schemaTierToDesign(tier); // 'general' | 'store' | 'premium_store'
  if (designKey === 'premium_store') return '已享 PREMIUM 經銷折扣';
  if (designKey === 'store') return '已享店家經銷價';
  return '一般會員價(升級需聯絡客服)';
}

export function OverviewTab({
  stats,
  featured,
  recentOrders,
  onJumpToOrders,
  onJumpToWallet,
}: OverviewTabProps) {
  return (
    <div data-tab="overview">
      {/* acc-stats:Member tier / Stored value / Total orders(對齊 design L469-496)*/}
      <div className="acc-stats">
        <div className="acc-stat">
          <div className="ap-mono">Member tier</div>
          {/* 🔶 第4批 R1 9-3:徽章由 `md`(28px 高 / 12px)改 `lg`(40px 高 / 14px)。
              R1 那一列寫的是 `.acc-tier-badge { padding: 7px 14px; font-size: 14px }`,
              但真站沒有那個 class ——【徽章走 `<TierBadge>` + `tier.css` 的尺寸階】,
              設計稿 `pcm-account.css:154` 自己也註明「本稿只畫版位」。
              ⇒ **選擇器不適用,但意圖適用**:理由是「與旁邊 30px 的數字同一列時原本太小」。
              `tier-badge-lg` 的 40px/14px 正好對上設計稿那組值。
              (R1 抓到我原本只回答了選擇器問題、把意圖整條漏掉。) */}
          <div className="acc-stat-v acc-stat-tier">
            <TierBadge tier={stats.tier} size="lg" />
          </div>
          <div className="acc-stat-sub">{tierSubLabel(stats.tier)}</div>
        </div>
        <div className="acc-stat">
          <div className="ap-mono">Stored value</div>
          <div className="acc-stat-v">NT$ {stats.walletBalance.toLocaleString()}</div>
          <div className="acc-stat-sub">
            <button type="button" className="acc-link-btn" onClick={onJumpToWallet}>
              查看明細 →
            </button>
          </div>
        </div>
        <div className="acc-stat">
          <div className="ap-mono">Total orders</div>
          <div className="acc-stat-v">{stats.orderCount}</div>
          <div className="acc-stat-sub">2024 年起累計</div>
        </div>
      </div>

      {/* acc-section 最近訂單(M-3:接真資料 recentOrders、design overview preview L498-517)
        * - 對齊 design preview 字面:.acc-order(無 -full)、meta「{日期} · {件數} 件」(注意是「件」非 orders tab 的「件商品」)、
        *   無「查看詳情」鈕(preview 不含)。
        * - recentOrders 由 AccountView slice(0,2) 傳入;與 stats.orderCount 同源(page.tsx 同一 orders)→ Q5=A
        *   數字 vs 列表天然一致(消除 codex k2 round1 點名的 stat/list inconsistency 風險)。
        * - 0 筆 → 空狀態(design 無 orders 空狀態、沿用 business override 文案);不搬 design mock 訂單字面。
        */}
      <div className="acc-section">
        <div className="acc-section-head">
          <h2>最近訂單</h2>
          <button type="button" className="acc-link-btn" onClick={onJumpToOrders}>
            查看全部 →
          </button>
        </div>
        {recentOrders.length === 0 ? (
          <div className="acc-empty">目前尚無訂單紀錄</div>
        ) : (
          <div className="acc-orders">
            {recentOrders.map((o) => (
              <div key={o.id} className="acc-order">
                <div className="acc-order-l">
                  <div className="ap-mono acc-order-id">{o.displayId}</div>
                  <div className="acc-order-meta">
                    {/* 🔴 **`itemCountTruncated` ⇒ 件數不可信,改印「?」**(2026-08-16,`Q-EMBED-1`)。
                    ⚠️ **這裡【不能】照後台那條印「未知」蓋掉整格** —— 那一格印的是**一個算出來的狀態**,
                       蓋掉它員工還看得到別的欄;而**這裡蓋掉的是客人辨識自己訂單的資訊**。
                       ⇒ 只把**那個不可信的數字**換掉,單號與日期照常。
                    🔴 **不印 0、不留空** —— 兩者都會被讀成「這單沒東西」。
                       印 `?` 是「我們也不確定」,而它旁邊的 title 給得出下一步。 */}
                    {formatOrderDate(o.createdAt)} ·{' '}
                    {o.itemCountTruncated ? (
                      <span title={ORDER_ITEM_COUNT_TRUNCATED_NOTE}>? 件</span>
                    ) : (
                      <>{o.itemCount} 件</>
                    )}
                  </div>
                </div>
                <div className="acc-order-r">
                  <div className="acc-order-total">NT$ {o.total.amount.toLocaleString()}</div>
                  <div className="acc-order-status">
                    {orderStatusLabel(o.paymentStatus, o.fulfillmentStatus)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* acc-section 為你推薦(g-2 走 fetchFeaturedProducts 真資料)
          🔴 2026-08-07 R-3:整區由 4 欄 grid 改成**首頁 N°02 同一顆 `ProductRail`**
             (Sean 拍板「品牌頁熱門商品與會員中心為你推薦都改成 N°02 同款橫向滑動一列」)。
             ⇒ 區塊表頭由 `.acc-section-head` 換成 rail 自己的 `.b-select-head`
               ——「查看全部 + 左右箭頭」是一組、箭頭本來就住在那顆表頭裡。
             ⚠️ **連帶的可見變化(全部已列 Sean 肉眼驗清單;審查抓到我原本只列了空/錯狀態)**:
               ① 標題字級 20px → 15px(`.acc-section-head h2` → `.b-select-title`);
               ② 表頭底線**整條消失**(`.acc-section-head` 有 `padding-bottom` + `border-bottom`,
                  `.b-select-head` 沒有)⇒ 與正上方「最近訂單」那區的分隔感不同;
               ③ 表頭下距 16px → 28px;
               ④ CTA 由 13px 灰底線字變成 12.5px 墨色 + 下框線(`.ed-link` 那組);
               ⑤ 空/錯訊息由 `.acc-empty`(虛線框、`32px 20px`)改走 rail 的空狀態
                  —— **字級兩邊都是 13px、沒變**,變的是虛線框消失與 padding 改 `60px 0`;
                  ⚠️ 那組樣式是 `ProductRail` 的 **inline style**,`.ed-select-empty` 只是掛名 hook、
                  全 repo 沒有對應 CSS 規則(別去 CSS 檔找)。
               ⑥ 卡片寬度會比首頁窄:rail 的格數斷點吃**視窗寬**,而本頁的 `.acc-body` 被側欄
                  吃掉約 292px ⇒ 1280 視窗下首頁卡約 224px、這裡被 `min-width: 176px` 夾住,
                  第 5 張永遠只露一半。不是 bug,但看得出來。
             ⚠️ `variant="inset"`:rail 的 CSS 吃 7 個只活在 `.ed-page` 的 `--ed-*` token,
               本頁沒有那個作用域 ⇒ 不給 inset 的話整組宣告會**無聲失效**(見 `home.css` 的
               `.b-select-inset`)。`reveal` 不給:捲動進場是首頁才有的東西。
          🔴 Sean 2026-08-06 拍板(Q1=A):這一格的卡片格式改成**與首頁 N°02 最新商品同一顆**
            `ProductCard` —— 原本是本檔自刻的 `.acc-rec-item`(只有圖 + 品名 + 價格,
            沒有品牌 mono 行、沒有適用車型行、沒有圖框)。
            🔴 **價格顏色順帶被修好**:自刻版的 `.acc-rec-price` 吃 `--c-text-2`(灰),
               而 `ProductCard` 吃 `product-card.css` 的 `.pcard .price-main`
               = `--c-red-dark` #c4470c,與 OD 新稿逐字的 `.price-main` 那條所用的
               `--c-ember-ink`(#c4470c)同值。Sean 回報的「價錢字體顏色不一樣」就是這一顆。
            🔴 **本頁的 OD 真權威 = `pcm-account.css`**(`account-page.html` 用 `<link>` 掛它,
               不是 inline `<style>`)。那支已於 **2026-08-06 同一句 Sean 指示**改成 `.pcard`,
               檔內註解逐字:「格式要跟首頁的最新商品一樣…原本這裡是自己一套(.acc-rec-img / -name
               / -price):只有圖、品名、灰色價格,缺品牌 mono 標、缺適用車型、缺分隔線,
               價格也不是熔橘」⇒ **本片與 OD 一致,不是偏離**(R1 MF4 更正:初稿把它寫成
               「刻意偏離頁稿」是錯的,而且把來源檔指到了 `source/styles/account.css`)。
            🔴 `source/styles/` 那個目錄是**舊站快照層**(`--c-red:#dc2626` 緋紅那一版)、不是稿。
               把它當權威就會搬到過期值 —— 灰價格正是這樣來的。OD 共三層,別再混:
               `source/styles/*`(舊站快照)/ `pcm-*.css`(各頁新稿樣式)/ 各頁 `<style>`(首頁那類自包含稿)。
            props 與首頁/品牌頁對齊:`showRedPrice` 與 `badgeStyle` 都不給
            (讓 `ProductCard` 自己的預設生效;首頁顯式傳的 `false` / `'minimal'` 正是那組預設值,
            品牌頁 `BrandPageProducts.tsx` 也是只傳 `p` + `href`)。 */}
      <div className="acc-section">
        <ProductRail
          products={featured.products}
          error={featured.error}
          title="為你推薦"
          viewAllHref="/products"
          viewAllLabel="更多新品"
          ariaLabel="為你推薦橫捲"
          emptyText="推薦商品即將上架"
          errorText="推薦商品載入失敗、請稍後再試"
          variant="inset"
        />
      </div>
    </div>
  );
}
