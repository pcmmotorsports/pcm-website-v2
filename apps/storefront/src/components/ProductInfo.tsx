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
import { useRouter } from 'next/navigation';
import type { MemberTier } from '@pcm/domain';
import type { MockProduct, UIVariant } from '@/data/mock-products';
import { useCart, type CartItemVehicle } from '@/contexts/CartContext';
import { readVehicleContext } from '@/lib/vehicle-context';
import { ProductSwatchPreview } from './ProductSwatchPreview';
import { ProductServices } from './ProductServices';

// OD-4a:selectedVariant 狀態提升至 ProductPage(本元件受控)— picker 改它、ProductGallery 隨它換圖、
//   mobile buybar 用它(修 16c-3 buybar 只能用預設變體的限制)。
export type ProductInfoProps = {
  product: MockProduct;
  tier: MemberTier;
  selectedVariant: UIVariant | null;
  onSelectVariant: (variant: UIVariant | null) => void;
  /** RPM 才顯「泰國原廠」卡(卡級守門);由 ProductPage 依 brandSlug 傳入。預設 false。 */
  isRpmCarbon?: boolean;
};

// OD-4c:把真變體 spec {weave, finish, special?} 折成 picker 2 維(Sean Q-OD4c-1/2=A、D3=A 真資料為準):
//   紋路(pattern)= weave + special 合併顯示 —— 12K/Kevlar 折進紋路(顯「12K斜紋」「Kevlar斜紋」),
//     移除原獨立「特殊」欄(Sean「特殊沒這選項」);
//   表面(finish)= 亮光/消光。**消光不寫死鎖** —— 真資料 12K 亦有消光(DB 24 變體),選項全由真變體
//     snap 決定(不照搬 OD enforceSurface/GLOSSY_ONLY 寫死;Sean Q-OD4c-1=A,避免少賣 24 變體)。
//
// W2(#265/#267、2026-07-04):選擇器泛化支援非 RPM 規格形狀(bonamici {color,material}、
//   cncracing {color}…)—— spec 含 weave/finish/special 任一 key = RPM 形狀、走現行 pattern/finish
//   合成維路徑(🔴 輸出 byte 不變硬約束、12 現有測試為行為錨);否則泛型模式:維 = spec 實際 key
//   (GENERIC_DIM_PRIORITY 排序、GENERIC_DIM_LABEL 顯中文、值原字直出、值序 = 變體首見序 =
//   匯入端 sort_order 序)。ProductSwatchPreview 為 RPM 紋路樣品卡、非 RPM 降級不渲染
//   (防 findSwatch fallback 顯錯誤碳纖樣品;通用色塊 hex_color 為後續獨立工作、見 #265)。
type Dim = string; // RPM 模式 = 'pattern' | 'finish' 合成維;泛型模式 = spec 原始 key
const DIM_LABEL: Record<string, string> = { pattern: '紋路', finish: '表面' };
// 泛型維標籤(key 皆 2026-07-04 報價單 DB spec 實際命中:color=CNC/bonamici/eazigrip/lightech、
//   material=bonamici/materya、design/tier=eazigrip、version=lightech);未列 key fallback 顯原字。
const GENERIC_DIM_LABEL: Record<string, string> = {
  color: '顏色',
  material: '材質',
  design: '款式',
  tier: '等級',
  version: '版本',
  finish: '表面', // 2026-07-12 E1:eazigrip GUARD/TANK 表面貼降級泛型後、表面軸標籤
  pack: '入數', // 2026-07-12 E3(Sean):儀表貼「PACK」→「入數」(值 1/2→一組/兩組 由報價單源頭)
};
// 泛型維順序:主軸(顏色)最前、表面次之;未列 key 排後、保持首見序(sort 穩定)。
const GENERIC_DIM_PRIORITY = ['color', 'finish', 'material', 'design', 'tier', 'version'];
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
/** W2:RPM 形狀偵測 — 任一變體 spec 帶 weave/special(碳纖編織法/特殊材質)→ 走現行 RPM 合成維路徑。
 *  🔴 finish 不再單獨觸發(2026-07-12 Sean E1):eazigrip GUARD/TANK 表面貼只有 finish、無 weave,
 *  原以 finish 觸發會誤走 RPM 路徑(掛錯誤碳纖紋路預覽卡 ProductSwatchPreview + 排序退化)。
 *  RPM 碳纖恆有 weave(斜紋/平織/鍛造/蜂巢)→ 去掉 finish 觸發不影響 RPM 偵測;eazigrip 改走
 *  泛型模式(finish 當泛型維「表面」、值原字直出、無紋路卡)。
 *  🔴 已知假設(對抗審 F2、2026-07-04):以 key 名嗅探 = 假設非 RPM 品牌不用 weave/special 英文
 *  key。守衛在源頭:報價單 NEW_SUPPLIER_ONBOARDING 已列這些 key 為 RPM 保留字、新品牌 fetcher 禁用。 */
function isRpmSpecShape(variants: UIVariant[]): boolean {
  return variants.some((v) => 'weave' in v.spec || 'special' in v.spec);
}
/** W2:泛型維收集 — variants spec 全部 distinct key、PRIORITY 先、未列 key 保持首見序 */
function collectGenericDims(variants: UIVariant[]): string[] {
  const keys: string[] = [];
  for (const v of variants) {
    for (const k of Object.keys(v.spec)) {
      if (!keys.includes(k)) keys.push(k);
    }
  }
  const rank = (k: string) => {
    const i = GENERIC_DIM_PRIORITY.indexOf(k);
    return i < 0 ? 99 : i;
  };
  return keys.sort((a, b) => rank(a) - rank(b));
}
/** 變體在某維的值(RPM:pattern=合成 key、finish;泛型:spec 原始 key 直讀) */
function variantDimValue(v: UIVariant, dim: Dim, rpm: boolean): string {
  if (!rpm) return v.spec[dim] ?? '';
  return dim === 'pattern' ? patternKey(v) : (v.spec.finish ?? '');
}
function dimValueLabel(dim: Dim, value: string, rpm: boolean): string {
  if (!rpm) return value; // 泛型值原字直出(來源已繁中;未譯值後續內容輪處理)
  return dim === 'pattern' ? patternLabel(value) : (FINISH_LABEL[value] ?? value);
}
function dimLabel(dim: Dim, rpm: boolean): string {
  return rpm ? (DIM_LABEL[dim] ?? dim) : (GENERIC_DIM_LABEL[dim] ?? dim);
}
/** 排序:紋路標準 weave(WEAVE_ORDER)在前、special 合併款(12K→Kevlar)在後;表面亮光在前;
 *  泛型維不重排(維持變體首見序 = 匯入端 sort_order 序) */
function sortDimValues(dim: Dim, values: string[], rpm: boolean): string[] {
  if (!rpm) return values;
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

export function ProductInfo({ product, tier, selectedVariant, onSelectVariant, isRpmCarbon = false }: ProductInfoProps) {
  const variants = product.variants ?? [];
  const hasVariants = variants.length > 0;

  // W2:RPM 形狀走現行合成 2 維;非 RPM 泛型模式(維 = spec 實際 key)。
  const rpmShape = useMemo(() => isRpmSpecShape(product.variants ?? []), [product.variants]);

  // OD-4c:派生選擇器維;只渲染 distinct >1 的維(資料驅動)。
  //   RPM = pattern / finish(pattern 已把 special 折入,見 patternKey);泛型 = collectGenericDims。
  const specGroups = useMemo<SpecGroup[]>(() => {
    const vs = product.variants ?? [];
    const dims: Dim[] = rpmShape ? ['pattern', 'finish'] : collectGenericDims(vs);
    return dims
      .map((dim) => {
        const values: string[] = [];
        for (const v of vs) {
          const val = variantDimValue(v, dim, rpmShape);
          // 泛型模式濾空值(對抗審 F1):spec key 不齊(如 eazigrip 主列 {} + 變體列 {color})
          //   會產生 '' 值 → 空白按鈕 + snap 污染;缺 key 變體仍可經其他維 + snap 選到。
          //   RPM 模式不濾(patternKey 可為 '' 是現行行為、byte 不變)。
          if (!rpmShape && val === '') continue;
          if (!values.includes(val)) values.push(val);
        }
        return { dim, values: sortDimValues(dim, values, rpmShape) };
      })
      .filter((g) => g.values.length > 1);
  }, [product.variants, rpmShape]);

  // OD-4a:selectedVariant 提升 ProductPage(props 受控)、本元件只持 qty / liked local。
  //   product 變更時 selectedVariant reset 由 ProductPage 統一處理(gallery 同步換圖);本處只 reset qty。
  const [qty, setQty] = useState<number>(1);
  const [liked, setLiked] = useState<boolean>(false);
  const { addItem } = useCart();
  const router = useRouter();

  // product 變更 → reset qty(selectedVariant reset 在 ProductPage)
  useEffect(() => {
    setQty(1);
  }, [product.variants]);

  // OD-4c:選某維(pattern/finish)的值;候選 = 該維=value 的變體;snap「另一維與當前相符最多」者
  // (稀疏矩陣保證選到有效變體、不卡死;候選保留 variants 排序、首個 max-score 穩定 tie-break)。
  const selectSpec = (dim: Dim, value: string) => {
    const candidates = variants.filter((v) => variantDimValue(v, dim, rpmShape) === value);
    if (candidates.length === 0) return;
    const cur = selectedVariant;
    let best = candidates[0]!;
    let bestScore = -1;
    for (const v of candidates) {
      let score = 0;
      if (cur) {
        for (const g of specGroups) {
          if (g.dim === dim) continue;
          if (variantDimValue(v, g.dim, rpmShape) === variantDimValue(cur, g.dim, rpmShape)) score += 1;
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
  //   W2:預覽卡限 RPM 形狀(非 RPM 不渲染、文字不需算)。
  const previewValueText = rpmShape && selectedVariant
    ? [
        dimValueLabel('pattern', variantDimValue(selectedVariant, 'pattern', true), true),
        dimValueLabel('finish', variantDimValue(selectedVariant, 'finish', true), true),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const addToCart = () => {
    // M-3-S2-b2-c:cart 線契約改帶 variant_id(變體 uuid = selectedVariant.id、建單 RPC create_order 的
    //   variant_id 來源;取代 M-1-16c-3 把 sku 塞 color 的權宜 hack)。無變體 → variantId undefined、
    //   line key 退回 productId。🔴 不送價(server 依 tier 取價、鐵則 12)。
    // V-2a 帶入路徑1(搜尋情境自動帶):選車 context 有字典名稱字面(brandName/modelName 齊全、
    //   REQUIRED-3 additive 欄)→ 標 kind:'dict' source:'search'、購物車顯「已依你的搜尋帶入」可改;
    //   舊 context 缺名稱欄 → 不自動帶入(零猜);label 反解析=脆、禁。
    const ctx = readVehicleContext();
    const vehicle: CartItemVehicle | undefined =
      ctx && ctx.brandName && ctx.modelName
        ? { kind: 'dict', brand: ctx.brandName, model: ctx.modelName, year: ctx.year, source: 'search' }
        : undefined;
    addItem({
      productId: product.slug,
      qty,
      variantId: selectedVariant?.id,
      ...(vehicle ? { vehicle } : {}),
    });
  };

  // 立即購買(Sean 2026-07-11):加入購物車後直接前往購物車頁(非結帳);與「加入購物車」的差別=多一步導頁。
  const buyNow = () => {
    addToCart();
    router.push('/cart');
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
          點圖開 lightbox 瀏覽全 10 張樣品。與 Hero 圖庫(OD-7d 真變體實拍)互補(預覽=乾淨紋路參考)。
          W2:限 RPM 形狀 — 非 RPM(bonamici/cncracing 色彩變體)降級不渲染,防 findSwatch
          fallback 顯示錯誤的 RPM 碳纖樣品圖(#265;通用色塊 hex_color 為後續獨立工作)。 */}
      {hasVariants && rpmShape && (
        <ProductSwatchPreview selectedVariant={selectedVariant} valueText={previewValueText} />
      )}

      {/* OD-4c:資料驅動 2 維選擇器(紋路 = weave+special 合併、表面 = finish;Sean Q-OD4c-1/2=A、D3=A)。
          12K/Kevlar 折進紋路(顯「12K斜紋」「Kevlar斜紋」)、無「特殊」獨立欄、消光不寫死鎖(真資料 snap)。
          文字鈕沿用 .pd-size-grid/.pd-size-btn、Q4=A 不顯庫存不 disable。 */}
      {hasVariants &&
        specGroups.map((g) => {
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
                    onClick={() => selectSpec(g.dim, val)}
                    aria-pressed={curVal === val}
                  >
                    {dimValueLabel(g.dim, val, rpmShape)}
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
      <button type="button" className="pd-buynow-btn" onClick={buyNow}>
        立即購買
      </button>

      {/* 服務保障(Sean 2026-07-11 拍板):原 OD-5 放 hero 下方全寬橫條 → 移進買價下方右欄空白,
          省一條橫條、填滿右欄、零重複。全寬版樣式改窄欄直立(product-page.css .pd-services-*)。 */}
      <ProductServices isRpmCarbon={isRpmCarbon} />
    </aside>
  );
}
