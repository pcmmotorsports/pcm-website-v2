// HomeSelect.tsx — 首頁 N°02「New Arrivals · 最新商品」橫捲區
//
// 🔴 2026-08-07(R-1):本檔原本自己實作整套橫捲機制(軌道 ref、兩端偵測、箭頭步進、空/錯狀態)。
//    Sean 拍板品牌頁「熱門商品」與會員中心「為你推薦」都要改成同款 rail、且要求**不寫第二套**
//    ⇒ 機制整組抽到 `ProductRail.tsx`,本檔退化成「只負責本區的字面與資料」的薄殼。
//    **輸出一個字都沒有變**(驗收:`HomeSelect.test.tsx` / `home.test.ts` /
//    `products-featured-limit.test.ts` 三支一字不改仍綠)。
//
// 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬
// (M-1-04-mini-slice 修:加 ProductCard tier prop、storefront 走 server-side tier 預算 tierLabel conceptually equivalent)
//
// d1 階段:用 MOCK_PRODUCTS.slice(0, 4) 對齊 design 字面 window.PCM_DATA.products.slice(0, 4)
// d2 階段:props.featured 真資料(server-side fetch from SupabaseProductAdapter.listByCategory('碳纖維部品'))
//          (category M-1-16b 後 Sean 2026-06-01 拍 A 覆蓋 d2 '操控部品'、RPM 真資料在'碳纖維部品')
//          MOCK_PRODUCTS import 移除、empty / error UI 字面 Sean 2026-05-09 拍板新增
//
//   🔴 D5a(2026-08-05)編號重標:OD `README.md`「區塊順序(第 7 步之後)」逐字
//      「編號是位置標記不是內容 id,所以聚焦與服務對調後編號跟著位置走」⇒ 本檔編號隨新位置改。
//      權威字面 = OD `direction-b-layout-01-graphite-ember.html` 裡的 `b-select-title` 那顆 `N°02`。
//      🔴 D5d 順手更正(同族):此處原寫的行號實查已漂掉 —— 該稿當天仍在被改。
//         ⇒ **OD 稿一律不引行號、引逐字字串用 grep 找**;也不補新行號(R3 F4)。
//
// ⚠️ **OD 的副標「若有設定愛車,此處顯示該車適用商品」刻意不搬** —— 那句在描述
//    「依愛車狀態換標題/換內容」那個功能,而該功能已被 M-4a 業務拍板**凍結**
//    (標題恆為 New Arrivals;`D-122-A` Q1=B 逐字「本板只覆蓋版面」)。
//    搬進來就是對客人承諾一個站上沒有的行為 = 文案說謊,不是版面。
import type { FeaturedResult } from '@/lib/products';
import { ProductRail } from './ProductRail';

export type HomeSelectProps = {
  featured: FeaturedResult;
};

export function HomeSelect({ featured }: HomeSelectProps) {
  return (
    <ProductRail
      products={featured.products}
      error={featured.error}
      eyebrow="N°02"
      // M-4a 前菜 D:授權覆蓋 design 文案「The Selection · 編輯精選」→「New Arrivals · 最新商品」
      // (Sean 2026-07-12 go;本區資料已改最新商品〔created_at 遞減〕、標籤對齊語意 + 既有「查看所有新品」CTA;
      // design-reference 未同步、此為業務 override、**勿調回**,同全站灰字調深(0de825e)override 精神)
      title="New Arrivals · 最新商品"
      viewAllHref="/products?filter=new"
      // 字面維持「查看所有新品」(M-4a 業務 override 的既有字面),不換成 OD 的「查看全部」——
      // 同上,OD 覆蓋的是版面。
      viewAllLabel="查看所有新品"
      ariaLabel="最新商品橫捲"
      // 三條 UI 分支(對齊 Sean 2026-05-09 d2 拍板 Q-empty=b / Q-error=b):
      //   error →「載入失敗、請稍後再試」/ empty →「目前沒有商品」/ 其餘 → 軌道
      emptyText="目前沒有商品"
      errorText="載入失敗、請稍後再試"
      // 首頁 N°02 有捲動進場揭示(`HomeReveal` 靠 `[data-reveal]` 選擇器找元素)。
      reveal
      // d1 階段 tweaks default(對齊 design HomePage tweaks panel default)、tweaks panel 落地時 hoist
      showRedPrice={false}
      badgeStyle="minimal"
    />
  );
}
