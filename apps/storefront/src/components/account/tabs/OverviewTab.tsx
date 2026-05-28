// OverviewTab.tsx — 會員中心「總覽」分頁(g-2:接 stats + featured 真資料、g-1a stub 退場)
//
// 直接搬 design-reference/components/AccountPages.jsx overview block(L467-535):
// - acc-stats(3 卡):Member tier(TierBadge + sub 字面)/ Stored value / Total orders
// - acc-section 最近訂單(L498-517):design 用 orders.slice(0,2);g-2 用 acc-empty 空狀態
//   (真用戶 0 筆訂單、不搬 design mock orders PCM-2026-0042 / NT$ 18,600 字面)
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
import type { MemberTier } from '@pcm/domain';
import { TierBadge } from '@/components/TierBadge';
import { ProductImage } from '@/components/ProductCard';
import type { AccountStats } from '@/components/account/AccountView';
import type { FeaturedResult } from '@/lib/products';

export type OverviewTabProps = {
  stats: AccountStats;
  featured: FeaturedResult;
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

      {/* acc-section 最近訂單(g-2 永遠空狀態 business override:真用戶 0 筆、不搬 design mock 訂單)
        * M-3 接真訂單後本段改成 orders.slice(0,2) 列表;g-2 階段 page.tsx 固定 orderCount=0,
        * 此處不留 orderCount > 0 死碼分支(codex k2 round1 consider:防 stat 數字 vs 列表空白 inconsistency)。
        */}
      <div className="acc-section">
        <div className="acc-section-head">
          <h2>最近訂單</h2>
          <button type="button" className="acc-link-btn" onClick={onJumpToOrders}>
            查看全部 →
          </button>
        </div>
        <div className="acc-empty">目前尚無訂單紀錄</div>
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
                  <ProductImage tone={p.imgTone} label={p.brand} seed={p.id} />
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
