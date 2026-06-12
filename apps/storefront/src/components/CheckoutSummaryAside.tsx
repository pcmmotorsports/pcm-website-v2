'use client';

// CheckoutSummaryAside.tsx — 結帳右側訂單摘要(M-3 ②-④b 自 CheckoutView 抽出、鐵則 6 控行數)
//
// 結構/字面 = 原 CheckoutView 內 aside 區塊原樣搬移(e1 直接搬 design CheckoutPage.jsx 右側摘要、
// 鐵則 1 已驗;本檔零視覺改動、純抽件 —— CheckoutView 接 TapPay 後逼近 400 行上限)。
// 🔴 鐵則 12:價全來自 useResolvedCart 的 server-resolved 值(props 透傳、零 client 算價)。

import Link from 'next/link';
import { FREE_SHIPPING_THRESHOLD } from '@pcm/domain';
import type { MemberTier } from '@pcm/domain';
import { TierBadge } from '@/components/TierBadge';
import type { ResolvedCartLineView } from '@/hooks/useResolvedCart';

export type CheckoutSummaryAsideProps = {
  lines: ResolvedCartLineView[];
  subtotal: number;
  shipping: number;
  total: number;
  memberName: string;
  memberTier: MemberTier;
};

export function CheckoutSummaryAside({
  lines,
  subtotal,
  shipping,
  total,
  memberName,
  memberTier,
}: CheckoutSummaryAsideProps) {
  return (
    <aside className="co-aside">
      <div className="co-summary">
        <div className="co-summary-head">
          <div className="ap-mono">ORDER SUMMARY</div>
        </div>

        <div className="co-summary-items">
          {lines.map(({ item, resolved: line, lineTotal }) => (
            <div key={`${item.productId}-${item.variantId ?? ''}`} className="co-summary-item">
              <span className="co-summary-item-qty">{item.qty}×</span>
              <span className="co-summary-item-name">{line.name}</span>
              <span className="co-summary-item-price">NT$ {lineTotal.toLocaleString()}</span>
            </div>
          ))}
        </div>

        <div className="co-summary-lines">
          <div className="co-line"><span>商品小計</span><span>NT$ {subtotal.toLocaleString()}</span></div>
          <div className="co-line"><span>運費</span><span>{shipping === 0 ? '免運' : `NT$ ${shipping}`}</span></div>
        </div>

        <div className="co-grand">
          <span>應付總額</span>
          <span className="co-grand-val">NT$ {total.toLocaleString()}</span>
        </div>

        {/* Member info */}
        <div className="co-member-block">
          <div className="ap-mono co-member-label">MEMBER</div>
          <div className="co-member-row">
            <div className="co-member-name">{memberName}</div>
            <TierBadge tier={memberTier} size="sm" />
          </div>
          {memberTier === 'general' && (
            <Link href="/account" className="co-member-upgrade">
              升級店家會員 · 享更多優惠 →
            </Link>
          )}
        </div>

        <div className="co-perks">
          <div><span>✓</span> 滿 NT$ {FREE_SHIPPING_THRESHOLD.toLocaleString()} 宅配免運</div>
          <div><span>✓</span> 原廠正品保固</div>
          <div><span>✓</span> TapPay PCI-DSS 安全加密</div>
        </div>
      </div>
    </aside>
  );
}
