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

import { useState, type CSSProperties } from 'react';
import { hasNoRealImage } from '@pcm/domain';
import type { UIImageTrim } from '@/data/mock-products';
import { brandLogoSrc } from '@/lib/brand-logo';
import { computeTrimStyle } from '@/lib/image-trim-style';

// 🔴 2026-08-22:這裡原本是 15 個 Unsplash photo id + `productGallery(seed)` ——
//   **商品沒有圖的時候, 顧客站會去跟 `images.unsplash.com` 要三張示意圖。**
//   出處是 design-reference/components/ProductCard.jsx:22 逐字搬進來的(本檔檔頭 :18 寫著)
//   ⇒ **設計稿的示意圖被當成正式站的 fallback 用了。**
//
//   為什麼要拿掉(不是視覺問題):
//   ① 對方掛掉或擋流量 ⇒ 客人看到破圖, 而我們沒有任何控制權
//   ② 每一個沒有圖的商品卡都在對外部網域發三個請求, 順便把瀏覽紀錄送出去
//
//   ⚠️ **而這個分支影響幾件商品, 是量過的:【1 件】。**
//   ```
//   select ... from products p left join (每個商品的變體圖數) v
//   商品總數 21,220 / 群層與變體層【都】沒有圖 = 1 / 至少有一張 = 21,219
//   ```
//   ⇒ 換掉它**幾乎不會改變任何人看到的畫面** —— 它修的是「我們對外部服務的依賴」,
//     不是「畫面比較好看」。(先前流傳的「933 件」是 product-jsonld.ts:15 註解裡
//     **別的年代、別的分母**的數字, 不是這一題的。)
//
// 🔴 `ProductImage.tsx:101-103` 原本掛著「無真圖漸層分支刻意不動…留給 Sean 裁」(D-149-A)。
//   **Sean 2026-08-22 答「甲 = 可以動」** ⇒ 本片依那道令改。
const PLACEHOLDER_IMAGE = '/placeholder-product.png';

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
  /**
   * 品牌 slug(`MockProduct.brandSlug`)—— **無真照片時拿它去取品牌 logo**。
   * 🔴 給 slug 不給 logo 路徑:路徑的副檔名每家不同, 拼字串對 6 家會 404(見 `lib/brand-logo.ts`)。
   */
  brandSlug?: string | null;
  hover?: boolean;
  /**
   * M-1-16c-1:商品真圖 URL(toUIProduct ← domain product.images[0])。
   * 有值 → 渲染真圖(hover 微縮放、無 cross-fade);`null` / 缺 → 站內佔位圖 PLACEHOLDER_IMAGE。
   * 🔴 2026-08-22 前這裡是【Unsplash 三張示意圖】, 見本檔上方 PLACEHOLDER_IMAGE 那段。
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
// 🔴 ~~漸層分支(showReal===false、無真圖 placeholder)刻意不動…該分支留給 Sean 裁,本片不碰。~~
// **2026-08-22 Sean 答「甲 = 可以動」** ⇒ 該分支已改:Unsplash 三張 → 站內佔位圖一張。
// 原句保留,因為它記著「OD 稿完全沒有【無真圖】狀態」這個仍然成立的事實 ——
// **底下那層漸層的顏色仍然沒有設計權威**,本片沒有動它,只換了疊在它上面的那張圖。

export function ProductImage({ tone = 'neutral', label = 'PRODUCT', hover = false, image = null, trim, brandSlug = null }: ProductImageProps) {
  // hooks 一律置頂、不可條件呼叫(react-hooks/rules-of-hooks error);real-image 分支與 fallback
  // 共用同一組 hook、僅 render 內 branch。
  const [placeholderFailed, setPlaceholderFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [realFailed, setRealFailed] = useState(false);
  const [c1, c2] = PALETTES[tone as Tone] ?? PALETTES.neutral;
  // 🔴🔴 `hasNoRealImage`:`image` 有值【不等於】有照片 —— 2026-09-03 量到來源 1,011 列的
  //   `image_url` 是「查無圖片」的卡(882 列是 PCM 自己那張、119 列是供應商的、10 列沒網址)。
  //   ⇒ 少了這一句, 那 1,011 件會走「真圖」分支, 把一張「暫無照片」的卡當商品照片放大顯示,
  //     而**下面整個無真圖分支對它們永遠到不了**(那正是 `rpm-transform.ts` repImage 的同一個病)。
  //   🛑 判斷住在 `@pcm/domain`, 不在這裡 —— 每個消費端各判一次就會分岔, 而分岔不會紅。
  const showReal = !!image && !realFailed && !hasNoRealImage(image);
  // 無真照片時的品牌 logo(查無回 null ⇒ 退回站內佔位圖, 不硬拼路徑)。
  const logoSrc = brandLogoSrc(brandSlug);
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
        // 🔴 2026-08-22:這裡原本是三張 Unsplash 圖疊著做 hover cross-fade。
        //   換成站內佔位圖之後【只有一張】—— 三張之間的淡入淡出對同一張圖沒有意義。
        //   佔位圖自己也載不到(它是 public/ 底下的站內檔, 不該發生)⇒ 只剩底下那層漸層,
        //   而那正是這個分支原本就有的最後一層。
        // 🔴 Sean 2026-09-03 拍甲:「放該品牌的 LOGO 是不是比放【暫無照片】更好」
        //    ⇒ **品牌 logo + 底下小字「暫無照片」**。字體規格照 design 的 `.ph`
        //    (`design-reference/styles/tokens.css:76` 斜紋佔位:mono / 11px / 大寫 / letter-spacing .04em /
        //     var(--c-text-3))—— 🎯 **稿裡本來就有「沒有圖」的樣式, 我沒有自己發明一套。**
        //    ⚠️ 底下那層漸層維持不動(OD 稿沒有「無真圖」狀態、其顏色仍無設計權威, 見檔頭)。
        logoSrc && !logoFailed ? (
          <div
            style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: '10px',
            } as CSSProperties}
          >
            <img
              src={logoSrc}
              alt={label}
              loading="lazy"
              onError={() => setLogoFailed(true)}
              style={{
                maxWidth: '52%', maxHeight: '34%', objectFit: 'contain',
                // 🔵 壓一點透明度:這是「沒有照片」的狀態, logo 不該搶得比真商品卡還亮。
                opacity: 0.72,
                transform: hover ? 'scale(1.04)' : 'scale(1)',
                transition: 'transform 1.4s cubic-bezier(0.2,0.7,0.1,1)',
              } as CSSProperties}
            />
            <span
              style={{
                // ⚠️ 這四個值與站內 `styles/tokens.css` 的 `.ph` 逐字相同(已比過)——
              //    這裡沒有直接套 `.ph`, 因為它自帶斜紋底, 而本處底層已經是漸層。
              //    🔴 **代價:稿改字級時這一份不會跟** ⇒ 改 `.ph` 的人要記得掃這裡(grep `--f-mono`)。
              fontFamily: 'var(--f-mono)', fontSize: '11px', letterSpacing: '0.04em',
                color: 'var(--c-text-3)',
              } as CSSProperties}
            >
              暫無照片
            </span>
          </div>
        ) : placeholderFailed ? null : (
          // 🛑 最後一層:這家沒有 logo 檔(或 logo 載不到)⇒ 退回站內佔位圖。
          //    🔴 **不退成「什麼都不畫」** —— 那一格原本守的是「一定要有一張圖」, 那件事沒有變。
          <img
            src={PLACEHOLDER_IMAGE}
            alt={label}
            loading="lazy"
            onError={() => setPlaceholderFailed(true)}
            className="pcard-gallery-img"
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%', objectFit: 'contain',
              transform: hover ? 'scale(1.04)' : 'scale(1)',
              transition: 'transform 1.4s cubic-bezier(0.2,0.7,0.1,1)',
            } as CSSProperties}
          />
        )
      )}
    </div>
  );
}
