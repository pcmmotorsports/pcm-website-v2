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
  /**
   * 營業稅(元位整數)。⟦auth-TIERTOTALBYPAYMENT⟧ B2b。
   * 🔵 **0 = 不顯示那一行**, 而 0 有兩種來源、**畫面上刻意不分**:
   *   ①一般會員(價已含稅)②經銷會員選匯款(Sean Q24「匯款不用」)。
   * 🔴 **算在上層 `CheckoutView`, 不在這裡** —— 本檔檔頭那句「零 client 算價」照舊成立:
   *   我收到的是**算好的數**, 我只負責印。
   */
  tax: number;
  total: number;
  memberName: string;
  memberTier: MemberTier;
};

export function CheckoutSummaryAside({
  lines,
  subtotal,
  shipping,
  tax,
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
          {/* 🔴 稅只在【真的要加】時出現 —— Sean Q24 逐字「未稅 **但是不標未稅**」
              ⇒ 商品那幾行一個「未稅」字都沒有;而總額多出來的 5% 必須有一行說明它是什麼,
                 否則客人看到的是一個**自己會變的數字**。⇒ 標的是【稅】, 不是【未稅】。 */}
          {tax > 0 && (
            <div className="co-line"><span>營業稅 5%</span><span>NT$ {tax.toLocaleString()}</span></div>
          )}
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
