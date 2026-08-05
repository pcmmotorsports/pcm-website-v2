// HomeStatement.tsx — 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬
// (N°04 · Service · 黑色 slab、原廠授權 / 合作店家安裝 / 終身技術諮詢 三 col)
//
// M-1-04 刀 1b1:'use client' → server component + onNav stub → <Link href>(對齊 backlog #116 + recon §7 候選刀 2)
// onNav target 對映(本檔 2 條):'install' → /install / 'stores' → /stores
// 'use client' 移除原因:此元件無 useState / useEffect / onClick / window. / hover、純展示
//   🔴 D5a(2026-08-05)編號重標:OD `README.md`「區塊順序(第 7 步之後)」逐字
//      「編號是位置標記不是內容 id,所以聚焦與服務對調後編號跟著位置走」⇒ 本檔編號隨新位置改。
//      權威字面 = OD `direction-b-layout-01-graphite-ember.html` 裡的 `N°04 · Service`。
//      🔴 D5d 更正:此處原寫的行號實查已漂掉(該稿 2026-08-05 當天仍在被改,
//         同一小時內編號位置就漂了 6-7 行)⇒ **OD 稿一律不引行號、引逐字字串用 grep 找**。
//         不在這裡補「正確的新行號」—— 那只是製造下一顆會過期的字面(R3 F4)。

import Link from 'next/link';

export function HomeStatement() {
  return (
    <section className="ed-statement">
      <div className="ed-statement-inner">
        <div className="ed-mono ed-statement-tag">N°04 · Service</div>
        <h2 className="ed-statement-h">
          下單之後,<br/>
          <em>真正的服務才開始。</em>
        </h2>
        <div className="ed-statement-grid">
          <div className="ed-statement-col">
            <div className="ed-mono ed-statement-col-num">01</div>
            <h3>原廠授權</h3>
            {/* 🔴 D5d(2026-08-05,Sean 拍板 Q1=B「不報數」):這一句**刻意偏離 design 字面**
                (design 稿寫「17 家品牌正式代理。」)—— 依據、實查數字與字面取捨全部寫在
                `docs/design-storefront-manifest.yaml` 的
                `HomeStatement.business_overrides.brandCountClaimRemoved`,**那裡是唯一權威**。
                ⚠️ 不要在這裡再抄一份:R2 F10 逐字指出兩份敘述會各自漂移(這一版的 OD 行號
                就是那樣過期的)。守門在 `HomeStatement.test.tsx`。 */}
            <p>原廠正式代理。每件商品附原廠序號與保固卡,杜絕仿品風險。</p>
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
