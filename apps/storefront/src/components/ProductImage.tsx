// ProductImage.tsx — 卡片圖區(真圖 / trim 去白邊 / placeholder 漸層三條路徑)
//
// 2026-08-12 從 `ProductCard.tsx` **純搬移**拆出(該檔 360 行、>300 警戒;鐵則 6)。
// 零行為變更:本檔內容與拆檔前 `ProductCard.tsx:21-187` 逐字相同,只補上本檔自己要的 import。
// `ProductCard.tsx` 保留 `export { ProductImage }` re-export(#341-B barrel 手法)——理由是
// **維持公開出口的位置**(本符號拆檔前即由 ProductCard.tsx export 出去),不是「既有呼叫端不用改」:
// 實查全樹 import 這支的只有 `ProductCard.tsx:20` 自己那行。
// 🎨 **`business_overrides.cardImageTrimZoom` 的實作整組在本檔**(manifest ProductCard 條目;
//    Sean 2026-07-19 拍 Q1=B + 2026-08-06 白底拍 A)⇒ 動 trim / 白底 / hover 縮放改這裡。
//
// 字面從 design-reference/components/ProductCard.jsx @ 25d3a2a 直接搬(與 ProductCard 同源;
// M-1-04-mini-slice 修:25d3a2a 加 tier prop + window.Price 條件渲染、storefront 用 import <Price>
// + tierLabel 優於 window.Price UMD、不重做):
// - jsx → tsx + props type 推斷
// - React.useState / useMemo → import { useState, useMemo }
// - window.ProductCard / window.ProductImage UMD 註冊移除(改 ES export)
// - className 字面完全不動
// ⚠️ 鐵則 1 說明:design 稿把 `ProductImage` / `PRODUCT_IMG_POOL` / `productGallery` 與 `ProductCard`
//    放在**同一支** `.jsx`(實查 `design-reference/components/ProductCard.jsx:4/22/32`)。本站拆成兩支
//    是**檔案結構**決定(鐵則 6 行數),**字面零差異** ⇒ 不算偏離 design、無須記 override。

'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import type { UIImageTrim } from '@/data/mock-products';
import { computeTrimStyle } from '@/lib/image-trim-style';

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
