// app/components/Price.tsx — 價格顯示元件(基本型 props)
//
// 對齊 PRD §3.5 Q3=A:不接 product / tier / brand object、走 price + originalPrice + tierLabel 三個值
// 防三 tier 物件進 client bundle(Q4=C 防洩漏精神)、testability + 防洩漏雙贏
//
// 視覺對齊 design-reference/components/Pricing.jsx isMember 分支結構(L56-95)
// 三分支判定改走 tierLabel 非 null:
//   tierLabel !== null → isMember 分支(劃線 originalPrice + tier 價 + tierLabel pill)
//   tierLabel === null && hasRetailDiscount → retail discount 分支(劃線 origPrice + sale 價)
//   else → 純價分支
//
// sub 6 範圍:本 sub 僅新建元件、無 caller 消費點(留 sub 7 ProductCard 接)

import type { ReactNode } from 'react';

export type PriceProps = {
  price: number;
  originalPrice?: number | null;
  tierLabel?: 'P價' | '店價' | null;
  showSavedTag?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  layout?: 'inline' | 'stack';
  className?: string;
};

export function Price({
  price,
  originalPrice = null,
  tierLabel = null,
  showSavedTag = false,
  size = 'md',
  layout = 'inline',
  className = '',
}: PriceProps): ReactNode {
  const isMember = tierLabel !== null;
  const hasRetailDiscount = !isMember && originalPrice !== null && originalPrice > price;

  // isMember:劃線 originalPrice + tier 價 + tierLabel pill
  if (isMember) {
    return (
      <span className={`price-wrap price-${size} price-${layout} is-dealer ${className}`}>
        {originalPrice !== null && (
          <span className="price-orig price-strike">NT$ {originalPrice.toLocaleString()}</span>
        )}
        <span className="price-main">NT$ {price.toLocaleString()}</span>
        <span className="price-tag-dealer ap-mono">{tierLabel}</span>
      </span>
    );
  }

  // retail discount(general + sale):劃線 origPrice + sale 價
  if (hasRetailDiscount && originalPrice !== null) {
    return (
      <span className={`price-wrap price-${size} price-${layout} ${className}`}>
        <span className="price-orig price-strike">NT$ {originalPrice.toLocaleString()}</span>
        <span className="price-main is-sale">NT$ {price.toLocaleString()}</span>
        {showSavedTag && (
          <span className="price-tag-save ap-mono">省 NT$ {(originalPrice - price).toLocaleString()}</span>
        )}
      </span>
    );
  }

  // 純價
  return (
    <span className={`price-wrap price-${size} price-${layout} ${className}`}>
      <span className="price-main">NT$ {price.toLocaleString()}</span>
    </span>
  );
}
