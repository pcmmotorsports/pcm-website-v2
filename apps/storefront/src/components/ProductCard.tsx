// ProductCard.tsx — editorial 商品卡(badge / 收藏 / 快速加購 / 品名價格區)
// ⚠️ 圖區與 hover 圖庫(小 gallery、hover cross-fade)2026-08-11 已搬到 `./ProductImage`;
//    本檔只保留卡片本體 + 那顆 re-export。
//
// 字面從 design-reference/components/ProductCard.jsx @ 25d3a2a 直接搬(M-1-04-mini-slice 修:25d3a2a 加 tier prop + window.Price 條件渲染、storefront 用 import <Price> + tierLabel 優於 window.Price UMD、不重做):
// - jsx → tsx + props type 推斷
// - React.useState / useMemo → import { useState, useMemo }
//   (⚠️ 2026-08-12 拆檔後:`useMemo` 隨 `ProductImage` 搬走,本檔的 import 只剩 `:16` 的
//    useEffect / useState / ReactNode;上面那條講的是 25d3a2a 當年的轉換動作,不是本檔現況)
// - window.ProductCard / window.ProductImage UMD 註冊移除(改 ES export)
// - className 字面完全不動

'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { MockProduct } from '@/data/mock-products';
import { useCart } from '@/contexts/CartContext';
import { useFavorites } from '@/contexts/FavoritesContext';
import { readSearchVehicle } from '@/lib/search-vehicle';
import { Price } from './Price';
import { formatCardFits } from './product-card-fits';
import { ProductImage } from './ProductImage';

// 2026-08-12 拆檔(鐵則 6:本檔曾 360 行、過 300 警戒):圖區 `ProductImage` 與它三個
// module-level const(PRODUCT_IMG_POOL / productGallery / PALETTES)整組搬到 `./ProductImage`,
// **純搬移零行為變更**。
// 🔴 下面這行 re-export **不是**為了「讓既有呼叫端不用改」——實查全樹 import 這支的只有本檔
//    `:22` 自己那行。數法:`grep -rn "from '\./ProductImage'\|from '@/components/ProductImage'"
//    --include='*.tsx' --include='*.ts' apps packages | grep -v node_modules`
//    ⚠️ 該命令**會命中 2 行**:真 import(`ProductCard.tsx:22`)+ **本註解自己這幾行**
//    (命令字串裡就含 `./ProductImage` ⇒ 偵測器命中自己的輸入)。真正的呼叫點是 **1 個**。
//    它保留的是**公開出口的位置**:`ProductImage` 拆檔前就是從本檔 export 出去的具名符號,
//    拿掉等於順手改了本檔的對外介面(那是行為變更、不是搬移)。⇒ 沿用 #341-B barrel 手法留著。
export { ProductImage };

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
  // M-4b #191:收藏改吃 FavoritesContext(單一資料源)。原本是 `useState(false)` =
  // 純畫面狀態:重新整理就消失、同一件商品在列表與商品頁還互不知道。
  const { isFavorite, toggleFavorite } = useFavorites();
  const liked = isFavorite(p.slug);
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
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(p.slug); }}
          aria-label="收藏"
          aria-pressed={liked}
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
