// ProductInfo.tsx — 商品詳細頁右欄 pd-info column 子元件
//
// M-1-16c-3:由 mock hardcode(COLOR_MAP/sizeOptions/colorOptions 顏色×規格)改吃**真變體**。
// Sean Q1-4=A 拍板:
//   - Q1=A 規格選擇器全用文字按鈕(沿用 design .pd-size-grid/.pd-size-btn 樣式;紋路/表面無真實單色)
//   - Q2=A 規格顯中文(SPEC_VALUE_LABEL;未對照則 fallback 原值)
//   - Q3=A 資料驅動:每個 distinct 值 >1 的 spec key 各渲染一排(weave/finish/special 通吃、含未來擴充);
//          special 僅部分變體有 → 加「標準」(NONE)選項代表無特殊材質
//   - Q4=A 沿用 #161 不顯庫存(變體 availability 不顯、按鈕永遠可點、訂貨型業務)
//
// 選了變體 → currentVariant(snap 最近、稀疏矩陣保證有效)→ 換價(displayPrice = selectedVariant.price)。
// 變體 UI 價 = priceByTier.general(toUIProduct 已 strip、不帶 priceByTier;詳情頁釘 general、無 NT$0)。
//
// 字面 vs 事實:design ProductPage.jsx 原是顏色 swatch + 規格 size grid(mock 色/尺寸);RPM 真變體是
//   紋路×表面(×特殊)、無「顏色」概念 → Q1=A 業務 override(鐵則 1 例外、Webike 式變體)。沿用 .pd-opt
//   /.pd-size-grid/.pd-size-btn 選擇器 chrome、只換資料源 + 標籤。
//
// 本片 selectedVariant 為 **local state**(16c-4 才提升 ProductPage 給 mobile buybar / gallery 共用);
//   mobile buybar(ProductPage)本片加購用 product 預設變體 = 記錄限制、16c-4 同步(codex 16c-3 k1 consider 2)。
//
// 向後相容:product.variants 空/undefined → 不渲染選擇器、價顯 product.price(mock / related 商品不破)。
//
// 'use client' 必要:useState / useMemo / useEffect + 互動 onClick。對齊 ADR-0006 §1 白名單「Hooks → 'use client'」。

'use client';

import { useEffect, useMemo, useState } from 'react';
import type { MemberTier } from '@pcm/domain';
import type { MockProduct, UIVariant } from '@/data/mock-products';
import { useCart } from '@/contexts/CartContext';
import { ProductServices } from './ProductServices';

export type ProductInfoProps = { product: MockProduct; tier: MemberTier };

// 規格 key 顯示順序(已知者優先、其餘按字母附後)+ 中文名(Q2=A;未列 key fallback 原值)
const SPEC_KEY_ORDER = ['weave', 'finish', 'special'] as const;
const SPEC_KEY_LABEL: Record<string, string> = {
  weave: '紋路',
  finish: '表面',
  special: '特殊材質',
};
const SPEC_VALUE_LABEL: Record<string, Record<string, string>> = {
  weave: { Forged: '鍛造紋', Honeycomb: '蜂巢紋', Plain: '平紋', Twill: '斜紋' },
  finish: { Glossy: '亮面', Matt: '消光' },
  special: { '12K': '12K碳纖', Kevlar: 'Kevlar芳綸' },
};

// 「無此規格」sentinel(special 僅部分變體有、缺此 key 的變體歸此值、選項顯「標準」、Q3=A)
const SPEC_NONE = '__PCM_SPEC_NONE__';
const SPEC_NONE_LABEL = '標準';

function specKeyLabel(key: string): string {
  return SPEC_KEY_LABEL[key] ?? key;
}
function specValueDisplay(key: string, value: string): string {
  if (value === SPEC_NONE) return SPEC_NONE_LABEL;
  return SPEC_VALUE_LABEL[key]?.[value] ?? value;
}
/** 變體在某 spec key 的值(缺則為 NONE sentinel、統一比對) */
function variantValue(v: UIVariant, key: string): string {
  return v.spec[key] ?? SPEC_NONE;
}

type SpecGroup = { key: string; values: string[] };

export function ProductInfo({ product, tier }: ProductInfoProps) {
  const variants = product.variants ?? [];
  const hasVariants = variants.length > 0;

  // 派生選擇器:每個 spec key 的 distinct 值;只渲染 distinct >1 的 key(Q3=A 資料驅動)。
  // key 排序 SPEC_KEY_ORDER 已知優先、其餘字母序;special 等部分變體缺的 key 加 NONE「標準」。
  const specGroups = useMemo<SpecGroup[]>(() => {
    const vs = product.variants ?? [];
    const keys = new Set<string>();
    for (const v of vs) for (const k of Object.keys(v.spec)) keys.add(k);
    const known = SPEC_KEY_ORDER.filter((k) => keys.has(k));
    const rest = [...keys]
      .filter((k) => !(SPEC_KEY_ORDER as readonly string[]).includes(k))
      .sort();
    return [...known, ...rest]
      .map((key) => {
        const values: string[] = [];
        let hasAbsent = false;
        for (const v of vs) {
          const val = v.spec[key];
          if (val === undefined) hasAbsent = true;
          else if (!values.includes(val)) values.push(val);
        }
        return { key, values: hasAbsent ? [SPEC_NONE, ...values] : values };
      })
      .filter((g) => g.values.length > 1);
  }, [product.variants]);

  // selectedVariant local state(預設第一個變體、已 sortOrder+sku 排序;16c-4 提升 ProductPage)
  const [selectedVariant, setSelectedVariant] = useState<UIVariant | null>(
    variants[0] ?? null,
  );
  const [qty, setQty] = useState<number>(1);
  const [liked, setLiked] = useState<boolean>(false);
  const { addItem } = useCart();

  // product 變更 → reset selectedVariant + qty(對齊原 reset 行為;test rerender / 換商品)
  useEffect(() => {
    setSelectedVariant(product.variants?.[0] ?? null);
    setQty(1);
  }, [product.variants]);

  // 選某 spec key 的值:候選 = 該 key=value 的變體;snap「與當前其他維度相符最多」者
  // (稀疏矩陣保證選到有效變體、不卡死;候選保留 variants 排序、首個 max-score 穩定 tie-break)。
  const selectSpec = (key: string, value: string) => {
    const candidates = variants.filter((v) => variantValue(v, key) === value);
    if (candidates.length === 0) return;
    const cur = selectedVariant;
    let best = candidates[0]!;
    let bestScore = -1;
    for (const v of candidates) {
      let score = 0;
      if (cur) {
        for (const g of specGroups) {
          if (g.key === key) continue;
          if (variantValue(v, g.key) === variantValue(cur, g.key)) score += 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    setSelectedVariant(best);
  };

  // 顯示價:選到變體用變體價(general)、否則 product.price(無變體 mock fallback)
  const displayPrice = selectedVariant?.price ?? product.price;

  const addToCart = () => {
    // M-1-16c-3:變體 sku 當 cart line discriminator(全表 UNIQUE + 穩定、無碰撞/翻譯失效;
    //   codex 關卡1 consider 1)。CartLineKey {productId,color,size} 不改契約、sku 走 color 欄。
    //   無變體 → color undefined(同 mock 既有)。proper variantSku cart key 留 backlog。
    addItem({
      productId: product.slug,
      qty,
      color: selectedVariant?.sku,
      size: null,
    });
  };

  return (
    <aside className="pd-info">
      {/* M-1-13H-2:SKU line「{brand} · PCM-{id}」(design VariantCFull.jsx L81) */}
      <div className="pd-sku">{product.brand} · PCM-{String(product.id).padStart(5, '0')}</div>

      <h1 className="pd-title">{product.name}</h1>

      {/* M-1-13H-2:副標(design VariantCFull.jsx L83);brandCountry Phase 1 L2 hardcoded「義大利」(backlog #162) */}
      <div className="pd-sub">適用 {product.fits || '通用款'} · 義大利原裝進口</div>

      {/* M-1-16c-3:價改 displayPrice(選變體換價);詳情頁釘 general、tier 經銷分支 general 不觸發
          (變體無真經銷價、tier-aware 變體價延 M-2-08);非變體 mock 走 product.price + 原 tier/orig 條件 */}
      <div className="pd-price-block">
        <div className="pd-price-row">
          <span className="pd-price">NT$ {displayPrice.toLocaleString()}</span>
          {tier === 'store' || tier === 'premiumStore' ? (
            <>
              <span className="pd-price-orig">
                NT$ {(product.origPrice ?? displayPrice).toLocaleString()}
              </span>
              <span className="pd-price-tag-dealer">經銷價</span>
            </>
          ) : product.origPrice && product.origPrice > displayPrice ? (
            <>
              <span className="pd-price-orig">
                NT$ {product.origPrice.toLocaleString()}
              </span>
              <span className="pd-price-save">
                −{Math.round(((product.origPrice - displayPrice) / product.origPrice) * 100)}%
              </span>
            </>
          ) : null}
        </div>
        <div className="pd-price-sub">含稅 · 滿 NT$ 5,000 免運</div>
      </div>

      {/* M-1-16c-3:資料驅動變體選擇器(Q1=A 文字鈕 .pd-size-grid/.pd-size-btn、Q2=A 中文、
          Q3=A 每 distinct>1 spec key 一排、special 加「標準」、Q4=A 不顯庫存不 disable)。
          取代原 COLOR_MAP swatch + sizeOptions hardcode(mock 階段、RPM 無顏色概念)。 */}
      {hasVariants &&
        specGroups.map((g) => {
          const curVal = selectedVariant ? variantValue(selectedVariant, g.key) : undefined;
          return (
            <div className="pd-opt" key={g.key}>
              <div className="pd-opt-head">
                <span className="pd-opt-label">{specKeyLabel(g.key)}</span>
                <span className="pd-opt-value">
                  {curVal !== undefined ? specValueDisplay(g.key, curVal) : ''}
                </span>
              </div>
              <div className="pd-size-grid">
                {g.values.map((val) => (
                  <button
                    key={val}
                    type="button"
                    className={`pd-size-btn ${curVal === val ? 'is-active' : ''}`}
                    onClick={() => selectSpec(g.key, val)}
                    aria-pressed={curVal === val}
                  >
                    {specValueDisplay(g.key, val)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

      {/* M-1-13e-a:Buy row(design ProductPage.jsx L334-349);#161 業務拍板:永遠可點、無 disabled */}
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

      {/* M-1-13e-a:buynow(design ProductPage.jsx L351);#161 永遠可點 */}
      <button type="button" className="pd-buynow-btn" onClick={addToCart}>
        立即購買
      </button>

      {/* M-1-13f-1:services 段(ProductServices.tsx) */}
      <ProductServices />
    </aside>
  );
}
