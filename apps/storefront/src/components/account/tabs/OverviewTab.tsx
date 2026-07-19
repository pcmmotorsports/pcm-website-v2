// OverviewTab.tsx — 會員中心「總覽」分頁(g-2:接 stats + featured 真資料、g-1a stub 退場)
//
// 直接搬 design-reference/components/AccountPages.jsx overview block(L467-535):
// - acc-stats(3 卡):Member tier(TierBadge + sub 字面)/ Stored value / Total orders
// - acc-section 最近訂單(L498-517):M-3 接真資料 recentOrders(AccountView slice(0,2) 傳入);
//   對齊 design preview 字面(.acc-order 無 -full、meta「件」、無詳情鈕);0 筆走 acc-empty 空狀態。
//   不搬 design mock orders 字面(PCM-2026-0042 / NT$ 18,600 / 已出貨)。
// - acc-section 為你推薦(L519-534):design 用 mock data.products.slice(0,4) + p.image;
//   g-2 走 fetchFeaturedProducts(server-side、Supabase 真資料)+ <ProductImage>(MockProduct
//   無 image 欄位、走既有元件、wrapper .acc-rec-img 撐 aspect-ratio)。
//   ⚠️ tier-aware pricing 暫不接(server page.tsx 固定 'general' 公開價、待 M-1-16、見 manifest
//   featuredProductsViaSupabase business override + codex k2 round1 must-fix#1)、本 tab 收到的
//   `featured` 已是 general 公開價序列、不傳 stats.tier 影響推薦定價
//
// stats / featured 由 server page.tsx 傳入(prop drill;對齊 plan v2 決策 4)。
// tier 字面 sub 對齊 design L477-481:premium_store → 「已享 PREMIUM 經銷折扣」/ store →
// 「已享店家經銷價」/ general →「一般會員價(升級需聯絡客服)」(用 schemaTierToDesign 收斂)。

import Link from 'next/link';
import { schemaTierToDesign } from '@pcm/domain';
import type { MemberTier, OrderListItem } from '@pcm/domain';
import { TierBadge } from '@/components/TierBadge';
import { ProductImage } from '@/components/ProductCard';
import type { AccountStats } from '@/components/account/AccountView';
import type { FeaturedResult } from '@/lib/products';
import { formatOrderDate, orderStatusLabel } from '@/lib/orders/order-display';

export type OverviewTabProps = {
  stats: AccountStats;
  featured: FeaturedResult;
  // M-3:最近訂單 preview(AccountView 已 slice(0,2) 傳入;與 stats.orderCount 同源、Q5=A 一致)
  recentOrders: OrderListItem[];
  onJumpToOrders: () => void;
  onJumpToWallet: () => void;
};

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
          <div className="acc-stat-v acc-stat-tier">
            <TierBadge tier={stats.tier} size="md" />
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
                    {formatOrderDate(o.createdAt)} · {o.itemCount} 件
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

      {/* acc-section 為你推薦(g-2 走 fetchFeaturedProducts 真資料 + ProductImage 元件)*/}
      <div className="acc-section">
        <div className="acc-section-head">
          <h2>為你推薦</h2>
          <Link href="/products">更多新品 →</Link>
        </div>
        {featured.error ? (
          <div className="acc-empty">推薦商品載入失敗、請稍後再試</div>
        ) : featured.products.length === 0 ? (
          <div className="acc-empty">推薦商品即將上架</div>
        ) : (
          <div className="acc-rec">
            {featured.products.map((p) => (
              <Link key={p.id} href={`/products/${p.slug}`} className="acc-rec-item">
                <div className="acc-rec-img">
                  {/* trim 線 S4b(codex MF-2):為你推薦同步吃去白邊 bbox、四消費端一致 */}
                  <ProductImage tone={p.imgTone} label={p.brand} seed={p.id} image={p.image} trim={p.imageTrim} />
                </div>
                <div className="acc-rec-name">{p.name}</div>
                <div className="acc-rec-price">NT$ {p.price.toLocaleString()}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
