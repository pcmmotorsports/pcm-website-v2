// HomeFooter.tsx — 字面原從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬
// (新莊化成路 736 巷 18 號)
// ⚠️ 版權列原字面 `© MMXXVI · PCM MOTOR PARTS LTD.` 已於 2026-08-05 D7 作廢(見下方 D7 段);
//    本檔真權威也已改成 Open Design `pcm-home-redesign`(CLAUDE.md 鐵則 1 明文例外),
//    submodule 那份是過期假稿、不得回頭引用。
//
// M-1-04 刀 1b1:'use client' → server component + onNav stub → <Link href>(對齊 backlog #116 + recon §7 候選刀 2)
// onNav target 對映(本檔 7 條):
//   'catalog' → /products / 'brands' → **/brands**(D3c-5 改回;當年 Q4-S5 指 /products 的理由是
//      「品牌專區頁留 Phase 2、route 不存在」,那個前提在 D3c-3 落地時消失)
//   'new' → /products?filter=new / 'sale' → /products?filter=sale(🔴 ?filter= 全站未接、backlog)
//   'install' → /install / 'stores' → /stores(🔴 路由不存在=404、backlog)/ 'shipping' → /info/shipping
// social 3 條:M-1-06 #136 曾因無真連結改 <button disabled> 宣告未上線 → 2026-07-03 Sean 拍 Q2=A
//   接 site-config SOCIAL_URLS 真連結、回到 design <a> 結構(design L303-305 href="#" 佔位 → 真 URL、
//   外連加 target="_blank" rel="noopener noreferrer");#136 該段 supersede。
// 聯絡客服 1 條:仍 disabled(不在 Q2=A 拍板範圍;接 LINE 與否待 Sean)。
// 'use client' 移除原因:此元件無 useState / useEffect / onClick / window. / hover、純展示
//
// 字面 vs 事實(2026-07-03 A4):design 門市電話「02-2998-xxxx」/ 統編「xxxxxxxx」為佔位假值
// (design 自身即佔位、非真資料)→ 改接 lib/site-config 真值(Sean 2026-06-21 親自提供的
// SSoT:CONTACT_PHONE_DISPLAY / TAX_ID);版面字面不動、僅資料更正。

// D3a(2026-08-04):加 optional `tagline` —— 設計稿的頁尾標語**每頁不同**
// (`pcm-home-redesign/brand-page.html:1510-1512` 逐字:「首頁講品牌態度、品牌總覽講選部品、
//  這一頁講『這家品牌』—— 20 家各一句」;灌值在 `:2029` `$('bp-footer-slogan').innerHTML = brand.slogan`)。
// 不給 prop 時字面完全不變(首頁與其餘既有掛載點零影響、`HomeFooter.test.tsx` 有守)。


import type { ReactNode } from 'react';
import Link from 'next/link';
import { CONTACT_PHONE_DISPLAY, SOCIAL_URLS, TAX_ID } from '@/lib/site-config';

// 🔶 D7「頁尾回深 + 版權年份動態」(2026-08-05,由第0批 0b 執行;主視窗 `D-107-A` 裁 A 案)。
// 真權威 = 母計畫 `docs/specs/2026-08-03-storefront-home-brand-page-wire-plan.md:114` 逐字:
//   「回 graphite `#202225` + `pcm-stacked-*-on-dark` logo;`© 2026` 改 `new Date().getFullYear()`;
//    留白 52/40/22 **維持不動**(Sean 08-03 看過拍板)」。
// 版權列字面 = OD 全站頁尾逐字(`products-list-page.html:599-600`、`brand-directory.html:166-167`
//   等 10 支稿一致):「© {年份} PCM MOTOR PARTS LTD. 版權所有」+「統一編號 90003020」。
//   R2-3 表列明訂「MMXXVI 羅馬數字寫法作廢」、年份程式產生。
// 🔴 年份用 server 端 `new Date().getFullYear()`(不是 client script):本元件是 server component,
//    OD 稿用 `<script>` 只是靜態 HTML 沒有別的辦法。副作用=靜態預渲染的頁面年份釘在 build 當下,
//    跨年要重新部署才會更新 —— 這是可接受的(全站每年都會部署),換 client 反而多一顆 hydration 風險。
// 🔴 統編走 `lib/site-config.ts` 的 `TAX_ID`(Sean 2026-06-21 提供的 SSoT),不寫死字面;
//    實查 `site-config.ts:18` = `'90003020'`,與 OD 稿字面相同。
const FOOTER_LOGO = { src: '/pcm-stacked-bicolor-on-dark.png', w: 1384, h: 902 } as const;

export function HomeFooter({ tagline }: { tagline?: ReactNode }) {
  return (
    <footer className="ed-footer">
      <div className="ed-footer-inner">
        <div className="ed-footer-brand">
          <div className="ed-footer-logo">
            <img src={FOOTER_LOGO.src} width={FOOTER_LOGO.w} height={FOOTER_LOGO.h} alt="PCM MOTOR PARTS" />
          </div>
          <p className="ed-footer-tagline">
            {tagline ?? (
              <>
                改裝不只是升級配件,<br/>
                是風格與態度的延伸。
              </>
            )}
          </p>
          <div className="ed-footer-social">
            <a href={SOCIAL_URLS.facebook} target="_blank" rel="noopener noreferrer">Facebook</a>
            <a href={SOCIAL_URLS.instagram} target="_blank" rel="noopener noreferrer">Instagram</a>
            <a href={SOCIAL_URLS.line} target="_blank" rel="noopener noreferrer">LINE</a>
          </div>
        </div>
        <div className="ed-footer-cols">
          <div>
            <div className="ed-mono ed-footer-h">購物</div>
            <Link href="/products">商品目錄</Link>
            <Link href="/brands">品牌專區</Link>
            <Link href="/products?filter=new">新品上架</Link>
            <Link href="/products?filter=sale">特價專區</Link>
          </div>
          <div>
            <div className="ed-mono ed-footer-h">服務</div>
            <Link href="/install">安裝預約</Link>
            <Link href="/stores">合作店家</Link>
            <Link href="/info/shipping">配送 & 退貨</Link>
            {/* #291(2026-07-24):法律頁須從任何頁可達,不能只在結帳/註冊才找得到。 */}
            <Link href="/terms">服務條款</Link>
            <Link href="/privacy">隱私政策</Link>
            <button type="button" disabled aria-label="聯絡客服(尚未上線)">聯絡客服</button>
          </div>
          <div>
            <div className="ed-mono ed-footer-h">門市</div>
            <p>新北市新莊區化成路<br/>736 巷 18 號一樓</p>
            <p>週一-週六 10:00-19:00</p>
            <p>{CONTACT_PHONE_DISPLAY}</p>
          </div>
        </div>
      </div>
      <div className="ed-footer-base">
        <span className="ed-mono">© {new Date().getFullYear()} PCM MOTOR PARTS LTD. 版權所有</span>
        <span className="ed-mono">統一編號 {TAX_ID}</span>
      </div>
    </footer>
  );
}
