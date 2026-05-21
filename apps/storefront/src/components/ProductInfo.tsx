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
import type { MemberTier } from '@pcm/domain';
import type { MockProduct } from '@/data/mock-products';
import { useCart } from '@/contexts/CartContext';
import { ProductServices } from './ProductServices';

export type ProductInfoProps = { product: MockProduct; tier: MemberTier };

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

export function ProductInfo({ product, tier }: ProductInfoProps) {
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
  // M-1-13e-a:qty / liked state(對齊 design L115 + L117)
  const [qty, setQty] = useState<number>(1);
  const [liked, setLiked] = useState<boolean>(false);

  // M-1-13e-b:接 CartContext;對齊 design L127-130 addToCart 行為
  // (Phase 1 mock:localStorage 暫存、無後端;M-3 swap 真結帳時介面不變)
  const { addItem } = useCart();

  // Reset on product change(對齊 design L120-125;deps 比 design 多加 product.color + sizeOptions
  // 防 React 19 react-hooks/exhaustive-deps stale closure)
  useEffect(() => {
    setColor(product.color);
    setSize(sizeOptions?.[0] ?? null);
    setQty(1);
  }, [product.id, product.color, sizeOptions]);

  const addToCart = () => {
    // productId 用 product.slug:string、stable、對齊 domain ProductId + Supabase 路由
    // (Codex M-1-13e-b review P1:不用 mock-only product.id:number 當 cart 契約、避免 hash collision + M-3 反查失敗)
    addItem({ productId: product.slug, qty, color, size });
  };

  return (
    <aside className="pd-info">
      {/* M-1-13H-2:SKU line 字面從 design VariantCFull.jsx L81 直接搬、取代 13d brand-row 段
          (對應 HANDOFF #4 + PRD §4 slice-2)
          原 brand-row(brand-link + 外連 svg + 獨立 sku)→ 單一 mono 行「{brand} · PCM-{id}」 */}
      <div className="pd-sku">{product.brand} · PCM-{String(product.id).padStart(5, '0')}</div>

      <h1 className="pd-title">{product.name}</h1>

      {/* M-1-13H-2:副標字面從 design VariantCFull.jsx L83 直接搬(對應 HANDOFF #6)
          字面 `${product.fits} · ${brandCountry}原裝進口`、brandCountry Phase 1 L2 hardcoded
          「義大利」對齊 design;MOCK_PRODUCTS 約 60% 義大利品牌(Lightech / CNC Racing / Brembo /
          Rizoma / Termignoni)、其餘 Akrapovič(斯洛維尼亞)/ Öhlins(瑞典)/ GB Racing(英國)
          Phase 1 字面顯「義大利」屬 placeholder、Phase 2 接 brand 表 country 欄位真區分
          (backlog #162);同時 #7 移除原 .pd-fits-banner 厚 banner、資訊併進此副標 */}
      <div className="pd-sub">適用 {product.fits || '通用款'} · 義大利原裝進口</div>

      {/* M-1-13e-a:pd-price-block 字面從 design ProductPage.jsx L289-303 直接搬。
          Mock 路徑下 priceByTier 暫不接通(對齊 [slug]/page.tsx L37 註解 + STATUS L24
          backlog #130 已抽 helper、mock 一律 general retail);M-1-16 真接 Supabase
          fetcher findBySlug + toUIProduct(p, tier) 才真區分會員價;短期 store /
          premiumStore tier 顯「經銷價」tag 但 product.price 仍是 retail、字面 vs 事實
          偏離、commit body 揭示。 */}
      <div className="pd-price-block">
        <div className="pd-price-row">
          <span className="pd-price">NT$ {product.price.toLocaleString()}</span>
          {tier === 'store' || tier === 'premiumStore' ? (
            <>
              <span className="pd-price-orig">
                NT$ {(product.origPrice ?? product.price).toLocaleString()}
              </span>
              <span className="pd-price-tag-dealer">經銷價</span>
            </>
          ) : product.origPrice && product.origPrice > product.price ? (
            <>
              <span className="pd-price-orig">
                NT$ {product.origPrice.toLocaleString()}
              </span>
              <span className="pd-price-save">
                省 NT$ {(product.origPrice - product.price).toLocaleString()}
              </span>
            </>
          ) : null}
        </div>
        <div className="pd-price-meta">含稅 · 滿 NT$ 5,000 免運</div>
      </div>

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

      {/* M-1-13e-a:Buy row 字面從 design ProductPage.jsx L334-349 直接搬。
          Sean 2026-05-21 業務拍板(對應 backlog #161):全部 disabled={!product.inStock}
          + 三元字面替換「補貨中 · 通知我」移除、按鈕固定文字「加入購物車」、永遠可點。 */}
      <div className="pd-buy-row">
        <div className="pd-qty">
          <button
            type="button"
            onClick={() => setQty(Math.max(1, qty - 1))}
            aria-label="減少數量"
          >
            −
          </button>
          <span>{qty}</span>
          <button
            type="button"
            onClick={() => setQty(qty + 1)}
            aria-label="增加數量"
          >
            +
          </button>
        </div>
        <button type="button" className="pd-add-btn" onClick={addToCart}>
          加入購物車
        </button>
        <button
          type="button"
          className={`pd-like ${liked ? 'is-liked' : ''}`}
          onClick={() => setLiked(!liked)}
          aria-label="收藏"
          aria-pressed={liked}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill={liked ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
      </div>

      {/* M-1-13e-a:buynow 字面從 design ProductPage.jsx L351 直接搬;移除 disabled、文字「立即購買」固定 */}
      <button type="button" className="pd-buynow-btn" onClick={addToCart}>
        立即購買
      </button>

      {/* M-1-13f-1:services 段拆出至 ProductServices.tsx(對齊鐵則 6 警戒 + Codex M-1-13e-b review 提醒) */}
      <ProductServices />
    </aside>
  );
}
