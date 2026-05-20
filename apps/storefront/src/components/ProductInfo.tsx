// ProductInfo.tsx — 商品詳細頁右欄 pd-info column 子元件(M-1-13d、對齊 13c ProductGallery 拆檔模式)
//
// 字面從 design-reference/components/ProductPage.jsx @ 25d3a2a 直接搬:
// - L96-104 sizeOptions useMemo(4 個 category includes 分支)
// - L107-111 colorOptions useMemo(pool 8 色 filter slice、主色 + 2 extras)
// - L113-115 color/size useState(qty useState 延 13e Buy Row 真用時加、避免 unused state lint)
// - L120-125 reset useEffect(deps 比 design 多加 product.color + sizeOptions、防 React 19 react-hooks/exhaustive-deps stale closure)
// - L144-151 colorMap → COLOR_MAP 常數(補 yellow / blue 對應 MOCK_PRODUCTS 真實數據)
// - L266-332 pd-info column 上半 JSX(brand row + sku + title + fits-banner + color/size options)
//
// 'use client' 必要:useEffect / useMemo / useState + 互動 onClick(swatch / size button)
// 對齊 ADR-0006 §1 白名單「Hooks → 'use client'」。
//
// 本 sub-slice 不渲染:
// - product.price / origPrice / discountPct / tierLabel(留 13e、#130 tier resolution helper 第 3 處撞)
// - product.inStock / availability(留 13e、Q2=A 2026-05-20 拍板 + #82 mapper trigger)
// - qty spinner / add-to-cart / like / 立即購買 / services(留 13e)
//
// 鐵則 9 L3 標記:COLOR_MAP 8 色 + sizeOptions 4 分支 hardcode 屬 L3(員工後台會新增規格);
// Q1=A 2026-05-20 拍板:先搬 design hardcoded、M-5-03 sync engine 前真撞才 spike #81(PRD 級條目)。

'use client';

import { useEffect, useMemo, useState } from 'react';
import type { MockProduct } from '@/data/mock-products';

export type ProductInfoProps = { product: MockProduct };

// COLOR_MAP — 6 色字面對齊 design ProductPage.jsx L144-151;yellow / blue 2 色補齊
// 對應 MOCK_PRODUCTS 真實數據(ohlins-8 'yellow' 等)、避免 fallback 顯示英文 id。
const COLOR_MAP: Record<string, { label: string; swatch: string }> = {
  black: { label: '黑色', swatch: '#1a1a1a' },
  carbon: { label: '消光碳纖', swatch: 'linear-gradient(135deg, #2a2a2a 25%, #4a4a4a 50%, #2a2a2a 75%)' },
  red: { label: '賽道紅', swatch: '#c41e3a' },
  gold: { label: '陽極金', swatch: 'linear-gradient(135deg, #d4a853, #b8892c)' },
  titanium: { label: '鈦灰', swatch: 'linear-gradient(135deg, #8a8278, #6b635a)' },
  silver: { label: '銀色', swatch: 'linear-gradient(135deg, #d4d4d4, #a3a3a3)' },
  yellow: { label: '螢光黃', swatch: '#f5d800' },
  blue: { label: '深海藍', swatch: '#1e3a8a' },
};

export function ProductInfo({ product }: ProductInfoProps) {
  // Size options based on category(對齊 design L96-104 字面、4 個 includes 分支)
  const sizeOptions = useMemo<string[] | null>(() => {
    const c = product.category || '';
    if (c.includes('排氣')) return ['Standard', 'Race-Only'];
    if (c.includes('碳纖') || c.includes('飾板')) return ['Matte', 'Gloss'];
    if (c.includes('避震') || c.includes('前叉')) return ['Road', 'Track'];
    if (c.includes('卡鉗') || c.includes('碟盤')) return ['街道版', '賽道版'];
    return null;
  }, [product.id, product.category]);

  // Color options — 主色 + 2 個 extras(對齊 design L107-111 字面、pool 8 色)
  const colorOptions = useMemo<string[]>(() => {
    const pool = ['black', 'carbon', 'red', 'gold', 'titanium', 'silver', 'yellow', 'blue'];
    const extras = pool.filter((c) => c !== product.color).slice(0, 2);
    return [product.color, ...extras];
  }, [product.id, product.color]);

  // Options state(對齊 design L113-115)
  const [color, setColor] = useState<string>(product.color);
  const [size, setSize] = useState<string | null>(sizeOptions?.[0] ?? null);

  // Reset on product change(對齊 design L120-125;deps 比 design 多加 product.color + sizeOptions
  // 防 React 19 react-hooks/exhaustive-deps stale closure)
  useEffect(() => {
    setColor(product.color);
    setSize(sizeOptions?.[0] ?? null);
  }, [product.id, product.color, sizeOptions]);

  return (
    <aside className="pd-info">
      <div className="pd-brand-row">
        <a
          href="#"
          className="pd-brand-link"
          onClick={(e) => e.preventDefault()}
        >
          {product.brand}
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M7 17L17 7M7 7h10v10" />
          </svg>
        </a>
        <div className="pd-sku">SKU · PCM-{String(product.id).padStart(5, '0')}</div>
      </div>

      <h1 className="pd-title">{product.name}</h1>

      <div className="pd-fits-banner">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M5 17h14l-1.5-9h-11L5 17zM7 17v2a1 1 0 001 1h1a1 1 0 001-1v-2M14 17v2a1 1 0 001 1h1a1 1 0 001-1v-2" />
          <circle cx="8" cy="14" r="1" fill="currentColor" />
          <circle cx="16" cy="14" r="1" fill="currentColor" />
        </svg>
        <div>
          <div className="pd-fits-label">適用車款</div>
          <div className="pd-fits-value">{product.fits || '通用款'}</div>
        </div>
      </div>

      {/* TODO M-1-13e: pd-price-block(含 tier resolution helper #130 第 3 處撞) */}

      <div className="pd-opt">
        <div className="pd-opt-head">
          <span className="pd-opt-label">顏色</span>
          <span className="pd-opt-value">{COLOR_MAP[color]?.label || color}</span>
        </div>
        <div className="pd-swatches">
          {colorOptions.map((c) => (
            <button
              key={c}
              type="button"
              className={`pd-swatch ${color === c ? 'is-active' : ''}`}
              onClick={() => setColor(c)}
              title={COLOR_MAP[c]?.label || c}
              aria-label={`選擇顏色 ${COLOR_MAP[c]?.label || c}`}
              aria-pressed={color === c}
            >
              <span
                className="pd-swatch-dot"
                style={{ background: COLOR_MAP[c]?.swatch || c }}
              />
            </button>
          ))}
        </div>
      </div>

      {sizeOptions && (
        <div className="pd-opt">
          <div className="pd-opt-head">
            <span className="pd-opt-label">規格</span>
            <a
              href="#"
              className="pd-opt-guide"
              onClick={(e) => e.preventDefault()}
            >
              規格說明 →
            </a>
          </div>
          <div className="pd-size-grid">
            {sizeOptions.map((s) => (
              <button
                key={s}
                type="button"
                className={`pd-size-btn ${size === s ? 'is-active' : ''}`}
                onClick={() => setSize(s)}
                aria-pressed={size === s}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
