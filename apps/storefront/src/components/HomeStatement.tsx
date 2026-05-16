// HomeStatement.tsx — 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬
// (N°05 · Service · 黑色 slab、原廠授權 / 合作店家安裝 / 終身技術諮詢 三 col)
//
// M-1-04 刀 1b1:'use client' → server component + onNav stub → <Link href>(對齊 backlog #116 + recon §7 候選刀 2)
// onNav target 對映(本檔 2 條):'install' → /install / 'stores' → /stores
// 'use client' 移除原因:此元件無 useState / useEffect / onClick / window. / hover、純展示

import Link from 'next/link';

export function HomeStatement() {
  return (
    <section className="ed-statement">
      <div className="ed-statement-inner">
        <div className="ed-mono ed-statement-tag">N°05 · Service</div>
        <h2 className="ed-statement-h">
          下單之後,<br/>
          <em>真正的服務才開始。</em>
        </h2>
        <div className="ed-statement-grid">
          <div className="ed-statement-col">
            <div className="ed-mono ed-statement-col-num">01</div>
            <h3>原廠授權</h3>
            <p>8 大品牌正式代理。每件商品附原廠序號與保固卡,杜絕仿品風險。</p>
          </div>
          <div className="ed-statement-col">
            <div className="ed-mono ed-statement-col-num">02</div>
            <h3>合作店家安裝</h3>
            <p>全台 9 家合作店家,線上預約、到店直裝。特殊安裝 PCM 工程師親自到府。</p>
          </div>
          <div className="ed-statement-col">
            <div className="ed-mono ed-statement-col-num">03</div>
            <h3>終身技術諮詢</h3>
            <p>LINE 一對一技師諮詢。不只賣你部品,是陪你騎一輩子的夥伴。</p>
          </div>
        </div>
        <div className="ed-statement-cta">
          <Link href="/install" className="ed-link ed-link-light">
            <span>預約安裝</span>
            <span className="ed-link-arrow" aria-hidden="true">→</span>
          </Link>
          <Link href="/stores" className="ed-link ed-link-light ed-link-sm">
            <span>合作店家地圖</span>
            <span className="ed-link-arrow" aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
