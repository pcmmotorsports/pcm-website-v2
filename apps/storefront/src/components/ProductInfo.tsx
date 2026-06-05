// ProductInfo.tsx — 商品詳細頁右欄 pd-info column 子元件
//
// M-1-16c-3:由 mock hardcode(COLOR_MAP/sizeOptions/colorOptions 顏色×規格)改吃**真變體**。
// Sean Q1-4=A 拍板:
//   - Q1=A 規格選擇器全用文字按鈕(沿用 design .pd-size-grid/.pd-size-btn 樣式;紋路/表面無真實單色)
//   - Q2=A 規格顯中文(OD-4c 後標籤改 WEAVE_LABEL/FINISH_LABEL/SPECIAL_LABEL;未對照則 fallback 原值)
//   - Q3=A 資料驅動:每個 distinct 值 >1 的 spec key 各渲染一排(weave/finish/special 通吃、含未來擴充);
//          special 僅部分變體有 → 加「標準」(NONE)選項代表無特殊材質
//   - Q4=A 沿用 #161 不顯庫存(變體 availability 不顯、按鈕永遠可點、訂貨型業務)
//
// OD-4a/OD-4c 更新(supersede 上方 16c-3 Q3 的 3 排 weave/finish/special + 「標準」NONE 描述):
//   - OD-4a:selectedVariant 提升至 ProductPage(本元件受控、收 selectedVariant+onSelectVariant props),
//            ProductGallery 隨選變體換圖、mobile buybar 用真選中變體(上方「local state / 預設變體」描述已過時)。
//   - OD-4c:picker 折成 **2 維**(紋路 pattern = weave+special 合併、表面 finish),12K/Kevlar 折進紋路
//            (顯「12K斜紋」「Kevlar斜紋」)、移除「特殊」獨立欄 + NONE「標準」sentinel(Sean Q-OD4c-1/2=A);
//            消光不寫死鎖 —— 真資料 12K 亦有消光(D3=A 真資料為準、選項由 snap 決定)。
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
import { ProductSwatchPreview } from './ProductSwatchPreview';

// OD-4a:selectedVariant 狀態提升至 ProductPage(本元件受控)— picker 改它、ProductGallery 隨它換圖、
//   mobile buybar 用它(修 16c-3 buybar 只能用預設變體的限制)。
export type ProductInfoProps = {
  product: MockProduct;
  tier: MemberTier;
  selectedVariant: UIVariant | null;
  onSelectVariant: (variant: UIVariant | null) => void;
};

// OD-4c:把真變體 spec {weave, finish, special?} 折成 picker 2 維(Sean Q-OD4c-1/2=A、D3=A 真資料為準):
//   紋路(pattern)= weave + special 合併顯示 —— 12K/Kevlar 折進紋路(顯「12K斜紋」「Kevlar斜紋」),
//     移除原獨立「特殊」欄(Sean「特殊沒這選項」);
//   表面(finish)= 亮光/消光。**消光不寫死鎖** —— 真資料 12K 亦有消光(DB 24 變體),選項全由真變體
//     snap 決定(不照搬 OD enforceSurface/GLOSSY_ONLY 寫死;Sean Q-OD4c-1=A,避免少賣 24 變體)。
type Dim = 'pattern' | 'finish';
const DIM_LABEL: Record<Dim, string> = { pattern: '紋路', finish: '表面' };
const WEAVE_LABEL: Record<string, string> = { Twill: '斜紋', Plain: '平織', Forged: '鍛造', Honeycomb: '蜂巢' };
const FINISH_LABEL: Record<string, string> = { Glossy: '亮光', Matt: '消光' };
const SPECIAL_LABEL: Record<string, string> = { '12K': '12K', Kevlar: 'Kevlar' };
const WEAVE_ORDER = ['Twill', 'Plain', 'Forged', 'Honeycomb'];
const FINISH_ORDER = ['Glossy', 'Matt'];

/** 紋路維 key:有 special 則「special|weave」合併、否則純 weave(空 weave → '') */
function patternKey(v: UIVariant): string {
  const weave = v.spec.weave ?? '';
  const special = v.spec.special;
  return special ? `${special}|${weave}` : weave;
}
function patternLabel(key: string): string {
  const sep = key.indexOf('|');
  if (sep >= 0) {
    const special = key.slice(0, sep);
    const weave = key.slice(sep + 1);
    return `${SPECIAL_LABEL[special] ?? special}${WEAVE_LABEL[weave] ?? weave}`;
  }
  return WEAVE_LABEL[key] ?? key;
}
/** 變體在某維(pattern/finish)的值 */
function variantDimValue(v: UIVariant, dim: Dim): string {
  return dim === 'pattern' ? patternKey(v) : (v.spec.finish ?? '');
}
function dimValueLabel(dim: Dim, value: string): string {
  return dim === 'pattern' ? patternLabel(value) : (FINISH_LABEL[value] ?? value);
}
/** 排序:紋路標準 weave(WEAVE_ORDER)在前、special 合併款(12K→Kevlar)在後;表面亮光在前 */
function sortDimValues(dim: Dim, values: string[]): string[] {
  if (dim === 'finish') {
    const rank = (k: string) => { const i = FINISH_ORDER.indexOf(k); return i < 0 ? 99 : i; };
    return [...values].sort((a, b) => rank(a) - rank(b));
  }
  const rank = (key: string): number => {
    const sep = key.indexOf('|');
    if (sep < 0) {
      const i = WEAVE_ORDER.indexOf(key);
      return i < 0 ? 50 : i; // 純 weave 0-3
    }
    const special = key.slice(0, sep);
    const weave = key.slice(sep + 1);
    const wi = WEAVE_ORDER.indexOf(weave);
    const si = special === '12K' ? 0 : special === 'Kevlar' ? 1 : 2;
    return 100 + si * 10 + (wi < 0 ? 9 : wi); // special 合併款排後
  };
  return [...values].sort((a, b) => rank(a) - rank(b));
}

type SpecGroup = { dim: Dim; values: string[] };

export function ProductInfo({ product, tier, selectedVariant, onSelectVariant }: ProductInfoProps) {
  const variants = product.variants ?? [];
  const hasVariants = variants.length > 0;

  // OD-4c:派生 2 維(pattern / finish)選擇器;只渲染 distinct >1 的維(資料驅動)。
  //   pattern 已把 special 折入(見 patternKey);無「特殊」獨立維、無 NONE「標準」sentinel。
  const specGroups = useMemo<SpecGroup[]>(() => {
    const vs = product.variants ?? [];
    const dims: Dim[] = ['pattern', 'finish'];
    return dims
      .map((dim) => {
        const values: string[] = [];
        for (const v of vs) {
          const val = variantDimValue(v, dim);
          if (!values.includes(val)) values.push(val);
        }
        return { dim, values: sortDimValues(dim, values) };
      })
      .filter((g) => g.values.length > 1);
  }, [product.variants]);

  // OD-4a:selectedVariant 提升 ProductPage(props 受控)、本元件只持 qty / liked local。
  //   product 變更時 selectedVariant reset 由 ProductPage 統一處理(gallery 同步換圖);本處只 reset qty。
  const [qty, setQty] = useState<number>(1);
  const [liked, setLiked] = useState<boolean>(false);
  const { addItem } = useCart();

  // product 變更 → reset qty(selectedVariant reset 在 ProductPage)
  useEffect(() => {
    setQty(1);
  }, [product.variants]);

  // OD-4c:選某維(pattern/finish)的值;候選 = 該維=value 的變體;snap「另一維與當前相符最多」者
  // (稀疏矩陣保證選到有效變體、不卡死;候選保留 variants 排序、首個 max-score 穩定 tie-break)。
  const selectSpec = (dim: Dim, value: string) => {
    const candidates = variants.filter((v) => variantDimValue(v, dim) === value);
    if (candidates.length === 0) return;
    const cur = selectedVariant;
    let best = candidates[0]!;
    let bestScore = -1;
    for (const v of candidates) {
      let score = 0;
      if (cur) {
        for (const g of specGroups) {
          if (g.dim === dim) continue;
          if (variantDimValue(v, g.dim) === variantDimValue(cur, g.dim)) score += 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    onSelectVariant(best);
  };

  // 顯示價:選到變體用變體價(general)、否則 product.price(無變體 mock fallback)
  const displayPrice = selectedVariant?.price ?? product.price;

  // OD-7c:預覽卡的「紋路 · 表面」文字 — 反映實際選擇(含 12K/Kevlar 合併款、空維過濾)。
  const previewValueText = selectedVariant
    ? [
        dimValueLabel('pattern', variantDimValue(selectedVariant, 'pattern')),
        dimValueLabel('finish', variantDimValue(selectedVariant, 'finish')),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const addToCart = () => {
    // M-3-S2-b2-c:cart 線契約改帶 variant_id(變體 uuid = selectedVariant.id、建單 RPC create_order 的
    //   variant_id 來源;取代 M-1-16c-3 把 sku 塞 color 的權宜 hack)。無變體 → variantId undefined、
    //   line key 退回 productId。🔴 不送價(server 依 tier 取價、鐵則 12)。
    addItem({
      productId: product.slug,
      qty,
      variantId: selectedVariant?.id,
    });
  };

  return (
    <aside className="pd-info">
      {/* M-1-16c-4a:料號顯選中變體真 sku(隨 selectSpec 連動;Sean Q1=A、取代原 PCM-{id hash} 亂碼數)。
          無變體 mock fallback 用 slug(sane、非 hash;design VariantCFull.jsx L81 原 PCM-XXXXX 格式退場)。 */}
      <div className="pd-sku">{product.brand} · {selectedVariant?.sku ?? product.slug}</div>

      <h1 className="pd-title">{product.name}</h1>

      {/* M-1-16c-4a:副標顯 DB 真 subtitle(Webike 式如「Ducati Panigale · 碳纖維」;Sean Q2=A);
          拿掉寫死「義大利原裝進口」(RPM 非義大利、backlog #162 placeholder 退場);無 subtitle fallback「適用 {fits}」。
          確切排版/字面 Sean 後續用網頁設計 skill 調(對齊 feedback_sean-owns-visual-design)。 */}
      <div className="pd-sub">{product.subtitle || `適用 ${product.fits || '通用款'}`}</div>

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

      {/* OD-7c:picker 上方即時預覽卡 — 顯當前選中變體對應的紋路樣品圖(findSwatch + fallback);
          點圖開 lightbox 瀏覽全 10 張樣品。與 Hero 圖庫(OD-7d 真變體實拍)互補(預覽=乾淨紋路參考)。 */}
      {hasVariants && (
        <ProductSwatchPreview selectedVariant={selectedVariant} valueText={previewValueText} />
      )}

      {/* OD-4c:資料驅動 2 維選擇器(紋路 = weave+special 合併、表面 = finish;Sean Q-OD4c-1/2=A、D3=A)。
          12K/Kevlar 折進紋路(顯「12K斜紋」「Kevlar斜紋」)、無「特殊」獨立欄、消光不寫死鎖(真資料 snap)。
          文字鈕沿用 .pd-size-grid/.pd-size-btn、Q4=A 不顯庫存不 disable。 */}
      {hasVariants &&
        specGroups.map((g) => {
          const curVal = selectedVariant ? variantDimValue(selectedVariant, g.dim) : undefined;
          return (
            <div className="pd-opt" data-opt={g.dim} key={g.dim}>
              <div className="pd-opt-head">
                <span className="pd-opt-label">{DIM_LABEL[g.dim]}</span>
                <span className="pd-opt-value">
                  {curVal !== undefined ? dimValueLabel(g.dim, curVal) : ''}
                </span>
              </div>
              <div className="pd-size-grid">
                {g.values.map((val) => (
                  <button
                    key={val}
                    type="button"
                    className={`pd-size-btn ${curVal === val ? 'is-active' : ''}`}
                    onClick={() => selectSpec(g.dim, val)}
                    aria-pressed={curVal === val}
                  >
                    {dimValueLabel(g.dim, val)}
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
      {/* OD-5:服務橫條(ProductServices)已外移至 ProductPage、改為 hero 下方獨立全寬 section(OD 模板 §12)*/}
    </aside>
  );
}
