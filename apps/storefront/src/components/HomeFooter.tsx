// HomeFooter.tsx — 字面原從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬
// (新莊化成路 736 巷 18 號)
// ⚠️ 版權列原字面 `© MMXXVI · PCM MOTOR PARTS LTD.` 已於 2026-08-05 D7 作廢(見下方 D7 段);
//    本檔真權威也已改成 Open Design `pcm-home-redesign`(CLAUDE.md 鐵則 1 明文例外),
//    submodule 那份是過期假稿、不得回頭引用。
//
// M-1-04 刀 1b1:'use client' → server component + onNav stub → <Link href>(對齊 backlog #116 + recon §7 候選刀 2)
// onNav target 對映(本檔 **6 條**;2026-08-11 #269-a 移除「特價專區」後由 7 條變 6 條):
//   'catalog' → /products / 'brands' → **/brands**(D3c-5 改回;當年 Q4-S5 指 /products 的理由是
//      「品牌專區頁留 Phase 2、route 不存在」,那個前提在 D3c-3 落地時消失)
//   'new' → /products?filter=new(**2026-08-11 #269-b 段二起是真的篩選** —— `parseCatalogQuery`
//      認得 `filter=new`、換算成近 7 天的 `p_new_since` 打進 RPC;窗內沒東西時退回顯示最近上架
//      (Sean Q20=C「不准空白」)。原註解寫的「全站沒有任何地方在讀、按了等於未篩選全目錄」已作廢)
//   ~~'sale' → /products?filter=sale~~ **2026-08-11 移除**(#269-a;Sean:特價概念還不存在)
//   'install' → /install / 'stores' → /stores(🔶 2026-08-06 第2批已建這兩條路由、掛「新功能即將上線」
//      ⇒ 原註解的「路由不存在=404」已失效;backlog #269 的 `/install` `/stores` 那半已解)
//      / 'shipping' → /info/shipping
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
// 不給 prop 時字面完全不變(既有掛載點零影響、`HomeFooter.test.tsx` 有守)。
// 🔴 2026-08-06(D-136 清尾片)更正:上一行原本寫「**首頁**與其餘既有掛載點零影響」——
//    **首頁自本日起有給 prop 了**(OD 把首頁頁尾改成服務範圍句、理由見 `app/page.tsx` 那段註解),
//    首頁不再走預設值。其餘 23 個沒給 prop 的掛載點仍然零影響。


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
          {/* 🔴 D-136 清尾片 R1 MF1(2026-08-06):**這顆預設值不要改成首頁那句**。
              首頁頁尾標語確實已由 OD 改成「專業重機零件・改裝精品/一站式服務」,但那是**首頁一頁**的事
              —— OD 另外 13 支頁稿(register / login / cart / checkout / account / products-list /
              install / stores / logout / not-found / terms / privacy / info-shipping)**全部逐字保留**
              下面這句預設值,`products-list-handoff.md` 也逐字寫「首頁=服務範圍句、其他頁=預設句」。
              本片第一版把它改在這裡 = 一次動到 24 個沒給 prop 的掛載點、15 頁反向偏離 OD(R1 擋下)。
              ⇒ 首頁那句走 D3a 早就建好的 `tagline` prop(`app/page.tsx`),與 brands / brands-slug 同款。 */}
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
            {/* 🔴 「特價專區」2026-08-11 移除(#269-a;Sean 逐字:特價這個概念**還不存在**,
                要等商品編輯後台能設優惠價才有)。
                ⚠️ 本檔**檔頭的 onNav 對映表原本就註記著**「🔴 `?filter=` 全站未接、backlog」——
                那句話在這裡躺著,但沒有人把它變成行動,客人照樣天天在每一頁的頁尾看到
                這顆按了沒反應的連結。(檔頭那段已隨本片更新。) */}
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
            {/* 地址硬寫、不吃 `lib/site-config.ts` 的 `STORE_ADDRESS`(既有技術債,見 ComingSoon.tsx 同段註解)。
                「1樓」是 Sean 2026-08-15 逐字拍板的正典值,**不得被改回「一樓」**;
                空格與 `<br/>` 是本頁尾的排版、不是地址的一部分,正典值本身沒有空格。
                守門在 `HomeFooter.test.tsx`。 */}
            <p>新北市新莊區化成路<br/>736 巷 18 號1樓</p>
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
