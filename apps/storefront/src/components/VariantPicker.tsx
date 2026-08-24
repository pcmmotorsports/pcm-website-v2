// VariantPicker.tsx — 商品變體規格選擇器(#888 由 ProductInfo.tsx 搬出)
//
// 🔴 為什麼搬出來(理由與行數無關):純呈現、無自有 state、prop 邊界乾淨,
//   而它是 OD 改版**反覆在動的那一塊**(OD-4a → OD-4c 都改它)⇒ 下次改版的 diff 只碰這一支。
// 🔴 下方 JSX 自 ProductInfo.tsx **逐字搬移**(只統一去掉 2 格縮排、拆掉屬於外層
//   `{hasVariants &&` 的那一個 `}`),承重註解一起搬。
//
// ⚠️ 「渲染順序」沒有守門 —— `sortDimValues` 零測試引用(見 product-variant-dims.ts 檔頭)。

'use client';

import type { UIVariant } from '@/data/mock-products';
import { dimLabel, dimValueLabel, variantDimValue, type Dim, type SpecGroup } from './product-variant-dims';

export type VariantPickerProps = {
  specGroups: SpecGroup[];
  selectedVariant: UIVariant | null;
  rpmShape: boolean;
  onSelectSpec: (dim: Dim, value: string) => void;
};

export function VariantPicker({ specGroups, selectedVariant, rpmShape, onSelectSpec }: VariantPickerProps) {
  return (
    <>
    {/* OD-4c:資料驅動 2 維選擇器(紋路 = weave+special 合併、表面 = finish;Sean Q-OD4c-1/2=A、D3=A)。
        12K/Kevlar 折進紋路(顯「12K斜紋」「Kevlar斜紋」)、無「特殊」獨立欄、消光不寫死鎖(真資料 snap)。
        文字鈕沿用 .pd-size-grid/.pd-size-btn、Q4=A 不顯庫存不 disable。 */}
      {specGroups.map((g) => {
        const curVal = selectedVariant ? variantDimValue(selectedVariant, g.dim, rpmShape) : undefined;
        return (
          <div className="pd-opt" data-opt={g.dim} key={g.dim}>
            <div className="pd-opt-head">
              <span className="pd-opt-label">{dimLabel(g.dim, rpmShape)}</span>
              <span className="pd-opt-value">
                {curVal !== undefined ? dimValueLabel(g.dim, curVal, rpmShape) : ''}
              </span>
            </div>
            <div className="pd-size-grid">
              {g.values.map((val) => (
                <button
                  key={val}
                  type="button"
                  className={`pd-size-btn ${curVal === val ? 'is-active' : ''}`}
                  onClick={() => onSelectSpec(g.dim, val)}
                  aria-pressed={curVal === val}
                >
                  {dimValueLabel(g.dim, val, rpmShape)}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
