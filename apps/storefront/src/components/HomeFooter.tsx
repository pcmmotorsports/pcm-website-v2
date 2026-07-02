// HomeFooter.tsx — 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬
// (© MMXXVI · PCM MOTOR PARTS LTD.、新莊化成路 736 巷 18 號)
//
// M-1-04 刀 1b1:'use client' → server component + onNav stub → <Link href>(對齊 backlog #116 + recon §7 候選刀 2)
// onNav target 對映(本檔 7 條):
//   'catalog' → /products / 'brands' → /brands / 'new' → /products?filter=new / 'sale' → /products?filter=sale
//   'install' → /install / 'stores' → /stores / 'shipping' → /info/shipping
// social / 聯絡客服 4 條 placeholder:不在 onNav 範圍、M-1-06 #136 改 <button disabled aria-label> 宣告未上線
// 'use client' 移除原因:此元件無 useState / useEffect / onClick / window. / hover、純展示
//
// 字面 vs 事實(2026-07-03 A4):design 門市電話「02-2998-xxxx」/ 統編「xxxxxxxx」為佔位假值
// (design 自身即佔位、非真資料)→ 改接 lib/site-config 真值(Sean 2026-06-21 親自提供的
// SSoT:CONTACT_PHONE_DISPLAY / TAX_ID);版面字面不動、僅資料更正。

import Link from 'next/link';
import { CONTACT_PHONE_DISPLAY, TAX_ID } from '@/lib/site-config';

export function HomeFooter() {
  return (
    <footer className="ed-footer">
      <div className="ed-footer-inner">
        <div className="ed-footer-brand">
          <div className="ed-footer-logo">PCM MOTORSPORTS</div>
          <p className="ed-footer-tagline">
            改裝不只是升級配件,<br/>
            是風格與態度的延伸。
          </p>
          <div className="ed-footer-social">
            <button type="button" disabled aria-label="Facebook(尚未上線)">Facebook</button>
            <button type="button" disabled aria-label="Instagram(尚未上線)">Instagram</button>
            <button type="button" disabled aria-label="LINE(尚未上線)">LINE</button>
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
            <button type="button" disabled aria-label="聯絡客服(尚未上線)">聯絡客服</button>
          </div>
          <div>
            <div className="ed-mono ed-footer-h">門市</div>
            <p>新北市新莊區化成路<br/>736 巷 18 號一樓</p>
            <p>週一-週六 10:00-20:00</p>
            <p>{CONTACT_PHONE_DISPLAY}</p>
          </div>
        </div>
      </div>
      <div className="ed-footer-base">
        <span className="ed-mono">© MMXXVI · PCM MOTOR PARTS LTD.</span>
        <span className="ed-mono">統編 · {TAX_ID}</span>
      </div>
    </footer>
  );
}
