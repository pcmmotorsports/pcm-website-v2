// ProductCard.tsx — editorial · hover-swap images
// Each product has a small gallery (2-3 images). On hover, cross-fade to next image.
//
// 字面從 design-reference/components/ProductCard.jsx @ 25d3a2a 直接搬(M-1-04-mini-slice 修:25d3a2a 加 tier prop + window.Price 條件渲染、storefront 用 import <Price> + tierLabel 優於 window.Price UMD、不重做):
// - jsx → tsx + props type 推斷
// - React.useState / useMemo → import { useState, useMemo }
// - window.ProductCard / window.ProductImage UMD 註冊移除(改 ES export)
// - className 字面完全不動

'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { MockProduct, UIImageTrim } from '@/data/mock-products';
import { computeTrimStyle } from '@/lib/image-trim-style';
import { useCart } from '@/contexts/CartContext';
import { readSearchVehicle } from '@/lib/search-vehicle';
import { Price } from './Price';
import { formatCardFits } from './product-card-fits';

const PRODUCT_IMG_POOL = [
  'photo-1558981285-6f0c94958bb6', // brake caliper
  'photo-1568772585407-9361f9bf3a87', // motorcycle closeup
  'photo-1449426468159-d96dbf08f19f', // moto parts
  'photo-1558980664-10e7170b5df9', // exhaust pipe
  'photo-1611241443322-b5ba0b9c4f83', // carbon fiber
  'photo-1580310614729-ccd69652491d', // handlebars
  'photo-1517649763962-0c623066013b', // racing bike
  'photo-1609630875171-b1321377ee65', // moto accessories
  'photo-1558981806-ec527fa84c39', // moto riding
  'photo-1558981852-426c6c22a060', // helmet
  'photo-1558981403-c5f9899a28bc', // track day
  'photo-1591637333472-3e9e137b87d2', // brake disc
  'photo-1547996160-81dfa63595aa', // motorcycle wheel
  'photo-1449426468159-d96dbf08f19f', // parts detail
  'photo-1527136006912-44ea5baac0c6', // track racing
];

function productGallery(seed: number): string[] {
  // Stable deterministic selection of 3 images per product
  const n = PRODUCT_IMG_POOL.length;
  return [
    PRODUCT_IMG_POOL[seed % n] ?? '',
    PRODUCT_IMG_POOL[(seed * 7 + 3) % n] ?? '',
    PRODUCT_IMG_POOL[(seed * 13 + 5) % n] ?? '',
  ];
}

type Tone = 'cool' | 'neutral' | 'warm' | 'dark' | 'red' | 'gold';

// module-level const、避免 ProductImage 每次 render 重建 6-entry object
// (對齊 sub 8d simp-7 efficiency finding)
const PALETTES: Record<Tone, [string, string]> = {
  cool: ['#f1f3f5', '#e4e7ec'],
  neutral: ['#f4f4f5', '#e8e8e8'],
  warm: ['#f6f2ec', '#e8dfd0'],
  dark: ['#1e1e20', '#141416'],
  red: ['#fdf0ef', '#f5d8d4'],
  gold: ['#faf4e4', '#ede0b8'],
};

type ProductImageProps = {
  tone?: Tone | string;
  label?: string;
  seed?: number;
  hover?: boolean;
  /**
   * M-1-16c-1:商品真圖 URL(toUIProduct ← domain product.images[0])。
   * 有值 → 渲染真圖(hover 微縮放、無 cross-fade);`null` / 缺 → fallback seed placeholder gallery。
   */
  image?: string | null;
  /**
   * trim 線 S4b:卡片首圖去白邊 bbox(已經 parseImageTrim 收斂)。有值且 computeTrimStyle
   * 算得出(縮放 ≤3×)→ 去白邊置中模式(內容佔框 92%、絕對定位置中;F3 拍板可改);
   * 缺 / 過小 fallback → contain 完整顯示(原 cover 會裁非方圖、Sean 2026-07-24 Q1=A)。
   * 🔴 2026-08-07 更正(R1 nit):底色**不再是**兩種模式的區辨特徵——letterbox 底色 07-24
   * 原是 --c-surface-2 灰底、**已被 Sean 2026-08-06 拍 A 推翻**(依據「本次設計變更以 OD 為權威」)
   * ⇒ trim 模式與 contain fallback 兩條真圖路徑現在**同為白底**,底色分不出走了哪一條;
   * 兩者的差異只剩「置中縮放 92%(trim)」vs「contain 全圖顯示(fallback)」。
   */
  trim?: UIImageTrim;
};

// 🔴 2026-08-07:Sean 08-06 拍 A(圖框白底)本身就是「正式推翻他 07-24 拍板 Q1=A」的動作
// (依據:Sean 08-06 逐字「本次設計變更以 OD 為權威」)。前一片只改了 product-card.css 的
// `.pcard-img-wrap` 背景 → 站上真正蓋滿整個卡片框、非 hover 態時決定可見底色的是本檔案這層
// (`.pcard-gallery`,width/height:100% + inline background 三分支全不透明),沒有一起改 ⇒
// 白底畫不出來、product-card.css 那條變成「被蓋住而不生效」的宣告。本片改真正生效的這層。
// ⚠️ 2026-08-07 更正(R1 MF4):上一句「決定可見底色的是 .pcard-gallery」只在**非 hover 態**成立。
// hover 態另有 `.pcard-img-wrap::after`(product-card.css)疊在這層之上(z-index:1、同堆疊脈絡),
// `.pcard:hover` 給它 `rgba(0,0,0,0.04)` ⇒ hover 時圖區實際可見底色約 `#f5f5f5`、不是純白。
// 這是既有的 hover 遮罩行為(OD 稿查無、依 D-149-A 本片不處理,見 product-card.css 該規則旁說明),
// 本片沒有動它,只是這裡先前的講法忽略了它、寫成「真正決定可見底色的」沒有例外。
// 🔴 漸層分支(showReal===false、無真圖 placeholder)刻意不動:主視窗 D-149-A 要求照 OD 稿判、
// 但主對話已實查 OD 稿完全沒有「無真圖」狀態(grep pcard-gallery / 卡片 linear-gradient 皆零命中)。
// 依 D-149-A「查無=STOP 問我,不猜」⇒ 該分支留給 Sean 裁,本片不碰。

export function ProductImage({ tone = 'neutral', label = 'PRODUCT', seed = 0, hover = false, image = null, trim }: ProductImageProps) {
  // hooks 一律置頂、不可條件呼叫(react-hooks/rules-of-hooks error);real-image 分支與 fallback
  // 共用同一組 hook、僅 render 內 branch(imgs/failedIdx 在 real 分支不用、開銷可忽略)。
  const imgs = useMemo(() => productGallery(seed), [seed]);
  const [failedIdx, setFailedIdx] = useState<Record<number, boolean>>({});
  const [realFailed, setRealFailed] = useState(false);
  const [c1, c2] = PALETTES[tone as Tone] ?? PALETTES.neutral;
  const showReal = !!image && !realFailed;
  // trim 線 S4b:有 bbox 且縮放在上限內 → 去白邊置中模式;否則 undefined = contain fallback 路徑
  const trimStyle = showReal && trim ? computeTrimStyle(trim) : undefined;
  return (
    <div className="pcard-gallery" style={{
      width: '100%', height: '100%', position: 'relative',
      // 底色:真圖+trim=純白(與去白邊圖無縫、F3 Fable 關卡1);真圖+contain fallback 原是
      //   --c-surface-2 淺灰 letterbox(07-24 拍板 Q1=A),**已被 08-06 拍 A 推翻、改純白**。
      //   🔴 兩條真圖路徑同色 ⇒ **收斂成單一 `'#ffffff'`**,不留 `trimStyle ? '#ffffff' : '#ffffff'`
      //      那種兩臂相同的三元式:它看起來像個決策點、實際上不是,下一個人會以為兩條路各有講究
      //      而不敢動。日後若 trim 與 letterbox 真要分開給色,再把三元式加回來、各自附理由。
      //      守門仍分「有 trim」「無 trim」兩條 case 各驗一次 —— 那是使用者看得到的兩種狀態,
      //      值得各自釘住;**程式碼收斂不等於測試要跟著併**。
      //   🔴 2026-08-07(R1 nit):收斂成單一字面後,`ProductCard.test.tsx` 的 trim 測與 contain
      //      fallback 測**不存在「只紅其中一個」的突變**——兩條都讀同一個字面 `'#ffffff'`,改壞
      //      這行任何一測都會一起紅。它們**不再互為獨立防線**,但仍各自釘住一個使用者可見狀態
      //      (trim 置中裁切 / contain 全圖顯示),不算冗餘測試、不刪。
      //   無真圖=placeholder 彩色漸層(OD 稿無此狀態、本片刻意不動、見上方元件註解)。
      background: showReal
        ? '#ffffff'
        : `linear-gradient(145deg, ${c1} 0%, ${c2} 100%)`,
      overflow: 'hidden',
    }}>
      {showReal ? (
        trimStyle ? (
          // trim 模式:內容框等比縮放佔框 92% 置中(width/left/top=computeTrimStyle;不裁內容、只裁白邊)
          <img
            src={image!}
            alt={label}
            loading="lazy"
            onError={() => setRealFailed(true)}
            className="pcard-gallery-img"
            style={{
              position: 'absolute',
              width: trimStyle.width, left: trimStyle.left, top: trimStyle.top, height: 'auto',
              // MF-1:縮放原點=內容框中心(偏心 bbox 用 img 中心會把內容 scale 出卡框)
              transformOrigin: trimStyle.transformOrigin,
              transform: hover ? 'scale(1.04)' : 'scale(1)',
              transition: 'transform 1.4s cubic-bezier(0.2,0.7,0.1,1)',
            } as CSSProperties}
          />
        ) : (
        // M-1-16c-1:真圖單張、object-fit contain + hover 微縮放;load 失敗 → setRealFailed 退回 placeholder
        // Sean 2026-07-24 override design(原 cover):非正方形合成圖 cover 會裁掉上下 → contain 完整顯示;
        //   letterbox 底色 = 上方 .pcard-gallery background 分支給的 #ffffff(Sean 2026-08-06 拍 A、
        //   推翻 07-24 的 --c-surface-2 灰底;trim 模式本就同為白底,兩條真圖路徑現在同色)。
        <img
          src={image!}
          alt={label}
          loading="lazy"
          onError={() => setRealFailed(true)}
          className="pcard-gallery-img"
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%', objectFit: 'contain',
            transform: hover ? 'scale(1.04)' : 'scale(1)',
            transition: 'transform 1.4s cubic-bezier(0.2,0.7,0.1,1)',
          } as CSSProperties}
        />
        )
      ) : (
        imgs.map((id, i) => failedIdx[i] ? null : (
          <img
            key={i}
            src={`https://images.unsplash.com/${id}?w=600&q=80&auto=format&fit=crop`}
            alt={label}
            loading="lazy"
            onError={() => setFailedIdx(prev => ({ ...prev, [i]: true }))}
            className="pcard-gallery-img"
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%', objectFit: 'cover',
              mixBlendMode: tone === 'dark' ? 'normal' : 'multiply',
              opacity: (hover ? (i === 1 ? 1 : 0) : (i === 0 ? 0.92 : 0)),
              transform: hover && i === 1 ? 'scale(1.04)' : 'scale(1)',
              transition: 'opacity 0.55s ease, transform 1.4s cubic-bezier(0.2,0.7,0.1,1)',
            } as CSSProperties}
          />
        ))
      )}
    </div>
  );
}

export type ProductCardProps = {
  p: MockProduct;
  showRedPrice?: boolean;
  badgeStyle?: 'minimal' | 'pill' | 'corner' | 'none';
  compact?: boolean;
  /**
   * 有 href 時用 Next.js Link 包外層、card 為 SEO 真 anchor;
   * 無 href 時沿用 onClick(向後相容 HomeSelect 等既有用法)。
   * 兩者擇一、有 href 時 onClick 不觸發(避免雙觸發 confusion)。
   */
  href?: string;
  onClick?: () => void;
};

export function ProductCard({ p, showRedPrice, badgeStyle = 'minimal', compact = false, href, onClick }: ProductCardProps) {
  const [hover, setHover] = useState(false);
  const [liked, setLiked] = useState(false);
  const { addItem } = useCart();
  // Q2=A(Sean 2026-08-08):加購回饋做在鈕本身、1.5 秒後復原。存**時間戳**而非布林——
  // 布林在連點時第二次 setState 值沒變 ⇒ effect 不重跑 ⇒ 計時器不重置、第二次的回饋會提早消失。
  const [addedAt, setAddedAt] = useState<number | null>(null);
  useEffect(() => {
    if (addedAt === null) return;
    const t = setTimeout(() => setAddedAt(null), 1500);
    return () => clearTimeout(t);
  }, [addedAt]);

  /**
   * 快速加購(2026-08-08 接線;在此之前 onClick 只有 preventDefault+stopPropagation = 佔位空殼,
   * 五個掛載面的鈕全部按了沒反應——`/products` 商品目錄 / 首頁 rail / 品牌頁 / 會員中心推薦 / 相關商品)。
   *
   * 🔴 欄位形狀**逐字比照** `ProductPage.tsx` 的手機 sticky buybar:兩者同樣是「沒有數量 UI 的入口」
   *   ⇒ 同樣 `qty: 1`、同樣 `variantId` 取自動選的第一個變體、同樣用 `readSearchVehicle()` 帶車款。
   *   不另發明一套組法(全站第三份各寫各的加購邏輯 = 下次改契約時漏掉這裡)。
   * Q1=A:多變體卡片直加取 `variants[0]`,與 PDP 一致——PDP 本來就在 mount 時自動選第一個變體
   *   (`ProductPage.tsx:117-122`)、加購鈕永遠可點無 disabled(#161 業務拍板)⇒ 「未選規格」不是可達狀態。
   * 🔴 不送價(server 依 tier 取價、鐵則 12);車款名稱不齊 ⇒ 整欄不帶(零猜)。
   * `preventDefault` 擋外層 Link 的原生導航、`stopPropagation` 擋祖先 handler,兩個都要(既有行為不得回歸)。
   */
  // 🔴 Sean 2026-08-08 中午拍板 A:**有規格的商品不在卡片上直接加**,點了跳商品頁讓客人選規格。
  //   病因=列表讀路徑不帶變體資料(只 embed id 數數量)⇒ 卡片若照 `variants[0]` 直加,送出的
  //   `variantId` 恆為 undefined,而購物車 server 端看到「有變體卻沒帶 variantId」會 fail-closed
  //   丟掉整行(`app/cart/actions.ts:168-170` → `useResolvedCart.tsx:110`)⇒ 客人看到「✓ 已加入」、
  //   徽章 +1,進購物車卻沒那筆、還刪不掉 = **幽靈品項,比原本的沒反應更糟**。
  //   ⚠️ 判定只能看 `variantCount`,不能看 `variants.length`(後者在列表上恆為 0、分不出兩種情況)。
  //
  // 🔴 **`undefined` 走「有規格」這一側,不是「沒規格」**(R2 must-fix,方向一開始寫反了)。
  //   `variantCount` 在 domain 是必填,但到了 UI 邊界是 optional —— 不是所有讀路徑都餵得到它:
  //   `/products` 商品目錄與品牌頁走 RPC `search_catalog_by_vehicle` → `catalog-page.ts` 的
  //   `catalogRowToUIProduct`,那支 mapper **沒有這個欄位**(要讓它有,得動 DB 函式=另一片)。
  //   若把未知當成「沒規格」而直加,幽靈品項會在**正是 Sean 點名的那一面**原封復發。
  //   兩種猜錯的代價不對稱:猜「有規格」最差只是多跳一次商品頁;猜「沒規格」會做出刪不掉的幽靈行。
  //   ⇒ 未知一律走安全側。等 RPC 帶回真值後,那兩面才會恢復卡片直加。
  const hasVariants = p.variantCount !== 0;
  // 🔴 鈕的字面是**三態**(主視窗 2026-08-08 裁定 F2),不是跟著 `hasVariants` 二分:
  //   走 RPC 的兩面(`/products` 商品目錄、品牌頁)拿不到 `variantCount` ⇒ 恆 `undefined` ⇒
  //   若一律寫「選擇規格」,零變體商品也會被這麼寫、點進去卻沒規格可選 = 字面小謊。
  //   `undefined`(不知道)⇒「查看商品」,誠實描述這顆鈕實際會做的事(跳過去看)。
  //   backlog #342 讓 RPC 帶回真值後,`undefined` 消失、字面自動歸位成另外兩態。
  const quickLabel =
    p.variantCount === undefined ? '查看商品' : hasVariants ? '選擇規格' : null;

  const quickAdd = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    // 有規格 ⇒ **什麼都不做**:不 preventDefault、讓外層 <Link href> 自己導到商品頁(零導頁程式碼)。
    // 三個呼叫點都傳 href(ProductsPage:399 / ProductRelated:105 / ProductRail:242-247);
    // 型別上 href 可省略但實際不可達,那種情況會落到既有的 onClick 分支 —— 不猜一個變體加下去。
    if (hasVariants) return;
    e.preventDefault();
    e.stopPropagation();
    const vehicle = readSearchVehicle();
    // 🔴 **刻意不帶 `variantId`**:能走到這一行就代表 `variantCount === 0`(有規格的在上面已導頁),
    //   line key 照契約退回 `productId`。原本這裡寫 `p.variants?.[0]?.id` —— 導頁分支落地後那是死碼
    //   (到得了這裡就保證無變體),留著只會讓下一個人以為卡片有能力選變體、而它沒有。
    addItem({
      productId: p.slug,
      qty: 1,
      ...(vehicle ? { vehicle } : {}),
    });
    setAddedAt(Date.now());
  };

  const badge: ReactNode = (() => {
    if (badgeStyle === 'none') return null;
    if (p.isNew) {
      if (badgeStyle === 'pill') return <div className="badge badge-pill badge-dark">NEW</div>;
      if (badgeStyle === 'corner') return <div className="badge badge-corner badge-dark">NEW</div>;
      return <div className="badge badge-min">新品</div>;
    }
    if (p.isSale) {
      if (badgeStyle === 'pill') return <div className="badge badge-pill badge-red">SALE</div>;
      if (badgeStyle === 'corner' && p.origPrice) return <div className="badge badge-corner badge-red">-{Math.round((1 - p.price / p.origPrice) * 100)}%</div>;
      return <div className="badge badge-min badge-min-red">特價</div>;
    }
    return null;
  })();

  const cardInner = (
    <article
      className="pcard"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={href ? undefined : onClick}
      style={{ cursor: 'pointer' }}
    >
      <div className="pcard-img-wrap">
        <ProductImage tone={p.imgTone} label={p.brand} seed={p.id} hover={hover} image={p.image} trim={p.imageTrim} />
        {badge && <div className="pcard-badge">{badge}</div>}
        {/* 沒貨徽章移除(M-1-13e-pre-3、Sean 2026-05-21 業務拍板「不顯示有無庫存」、
            storefront 偏離 design 字面 L101-103、backlog #161 追蹤 Claude Design 補對齊) */}
        {/* 🔴 2026-08-07 焦點查修片:補 `e.preventDefault()`。
            有 `href` 時整張卡被 `<Link>` 包成一顆真 `<a>`(見本檔下方 `display: contents` 那層),
            這兩顆按鈕是 `<a>` 的**後代** ⇒ 點它們時,`<a>` 的**原生導航 default action** 照樣會發生。
            `stopPropagation()` 擋的是「事件往上傳給祖先的 handler」,**擋不掉元素自己的 default action**
            —— 兩者是不同機制,這正是 Next.js `<Link>` 包可點擊元素的已知坑。
            ⇒ 少了 `preventDefault`,點「收藏」會同時跳去商品頁。四個掛載面同形
            (`ProductsPage` / `BrandPageProducts` / `ProductRail` / `ProductRelated`)。
            ⚠️ 既有測試從沒測過「有 href **且** 點按鈕」這個組合(兩個 case 各測一半、沒交叉)⇒ 本片補上。 */}
        <button
          className="pcard-heart"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLiked(!liked); }}
          aria-label="收藏"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? 'var(--c-red)' : 'none'} stroke={liked ? 'var(--c-red)' : 'currentColor'} strokeWidth="1.6">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
        {/* gallery dots (subtle indicator) */}
        <div className="pcard-dots" aria-hidden="true">
          <span className={`pcard-dot ${!hover ? 'is-active' : ''}`} />
          <span className={`pcard-dot ${hover ? 'is-active' : ''}`} />
        </div>
        {/* hover quick-add */}
        <div className={`pcard-quick ${hover ? 'is-visible' : ''}`}>
          {/* 同上:`preventDefault` 擋原生導航、`stopPropagation` 擋祖先 handler,兩個都要(在 quickAdd 內)。 */}
          <button
            className="pcard-quick-btn"
            onClick={quickAdd}
          >
            {/* 字面必須符合行為(主視窗裁定:這是正確性不是文案調性)——有規格時這顆鈕會導頁、不加購 */}
            {quickLabel ?? (addedAt !== null ? '✓ 已加入' : '+ 加入購物車')}
          </button>
        </div>
      </div>

      <div className="pcard-info">
        <div className="pcard-brand">{p.brand}</div>
        <div className="pcard-name">{p.name}</div>
        {/* S4:同名不同年商品在卡片可區分 —— 單款顯示年份 '18–'24、多款顯示「N 款車型」;
            缺年份降級只顯車款。前綴「適用 」保留 design 字面。 */}
        {!compact && <div className="pcard-fits">適用 {formatCardFits(p.fitments, p.fits)}</div>}
        <div className="pcard-price-row">
          <Price
            price={p.price}
            originalPrice={p.originalPrice ?? null}
            tierLabel={p.tierLabel ?? null}
            size="md"
            className={showRedPrice ? 'is-red' : ''}
          />
        </div>
      </div>
    </article>
  );

  // 有 href 時 Link 包外層、display:contents 避免破壞 grid layout、a 字面屬於 SEO 真 anchor
  return href ? (
    <Link href={href} style={{ display: 'contents', color: 'inherit', textDecoration: 'none' }}>
      {cardInner}
    </Link>
  ) : (
    cardInner
  );
}
