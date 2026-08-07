// LightechShowcase.tsx — LighTech 品牌形象區 N°01 + N°02(#212 方向3 品牌放量、2026-07-10)
//
// 製作依據(2026-07-10 kickoff、Sean 預批):骨架同 EvotechShowcase(pd-feature + pd-bs 共用骨架)。
// 信任狀事實官方 URL 佐證(sonnet subagent 親讀 lightech.it、彙整 scratchpad research;查無不寫):
//   1997 由前 SBK 車手 Fabrizio Furlan 創立、帶入家族製造專長(lightech.it/it/company/ 原文
//   「Nel 1997, Fabrizio Furlan crea Lightech per portare le competenze produttive della sua famiglia
//   e della sua professione di pilota…」——家族生產專長+車手職業兩者皆官方原文)/
//   WSBK·MotoGP·Moto2·125GP 車隊合作(同頁)/ 廠房 2,500㎡(1,400㎡ CNC 產線、Treviso,同頁)/
//   2026 賽季贊助 Moto2 SYNC SPEEDRS TEAM(首頁 Eventi)。⚠ 網傳「7000+ 產品」官網查無 → 不用。
// 商品圖 = 報價單 view 實際 image_url;logo = Sean 提供 EPS 內嵌 preview 去底(public/brands/lightech/logo.png)。
// 純 presentational、無 props、無 hooks → 不需 'use client'。
// 🔴 L2 內容(鐵則 9、backlog #271):信任狀數字 hardcode 無後台 CRUD。

export function LightechShowcase() {
  return (
    <>
      {/* N°01 — 為什麼選 LighTech(三卡) */}
      <section className="pd-section" aria-labelledby="pd-h-lt01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo">
              <img src="/brands/lightech/logo.png" alt="LighTech" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-lt01">為什麼選 LighTech</h2>
          <p className="pd-lead">
            1997 年由前 SBK 車手 Fabrizio Furlan 創立，義大利 Treviso 自有 CNC 產線，把世界賽場的合作經驗做進每一顆腳踏與拉桿。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">車手創辦、賽場出身</h3>
            <p className="pd-feature-desc">創辦人 Fabrizio Furlan 是前世界超級摩托車錦標賽車手，把家族製造專長帶進賽車部品——知道車手要什麼，也知道怎麼把它做出來。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">義大利自家產線、不外包</h3>
            <p className="pd-feature-desc">Treviso 廠房 2,500 平方米，其中 1,400 平方米是 CNC 車銑產線——鋁合金、鈦合金到不鏽鋼，從開模到成品都在自己手上。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">品牌．車型．年式 三層對照</h3>
            <p className="pd-feature-desc">官方型錄按品牌、車型到年式逐層對應，孔位配好才出廠——選對年式直上，不用自己量孔距。</p>
          </article>
        </div>
      </section>

      {/* N°02 — 賽場工藝(信任狀四格 + 產品線水平捲) */}
      <section className="pd-section pd-bs pd-bs--lightech" aria-labelledby="pd-h-lt02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  賽場工藝'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-lt02">從世界賽場做回街車的精品</h2>
          <p className="pd-lead">
            與 WSBK、MotoGP 等級車隊長年合作，2026 賽季仍在 Moto2 圍場裡——賽場驗證的工藝，下放到你的車上。
          </p>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;佐證 URL 見檔頭) */}
        {/* N°02 形象大圖(LighTech 贊助 Moto2 車隊情境,官方 Company 頁;Sean 2026-07-10 各家 N°02 加 HERO) */}
        <img className="pd-hero-band" src="/brands/lightech/hero.jpg" alt="LighTech 贊助的 Moto2 賽車與車手" loading="lazy" />

        {/* 故事交錯段(Bonamici 風格,官方研發/製造情境圖;Sean 2026-07-11 品牌放量 rollout;圖逐張肉眼驗零汽車) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/lightech/story-rd.jpg" alt="LighTech 塗裝的賽道車" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Development · 研發</div>
            <div className="pd-bona-h3">賽場需求先行</div>
            <p className="pd-bona-p">1997 年於義大利創立，長年為 WSBK、MotoGP、Moto2 車隊做技術支援——每一件街車部品，都從賽場的真實需求反推設計。</p>
          </div>
        </div>
        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/lightech/story-mfg.jpg" alt="LighTech 紅色陽極 CNC 削切部品裝於後輪" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Manufacturing · 製造</div>
            <div className="pd-bona-h3">義大利 CNC 自製</div>
            <p className="pd-bona-p">自有工廠 CNC 產線量產數千款 Ergal 航太鋁合金與鈦合金件，多色陽極處理，削切、上色、組裝一貫化。</p>
          </div>
        </div>

        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">1997</div>
            <div className="pd-bs-stat-l">品牌創立</div>
            <div className="pd-bs-stat-s">前 SBK 車手 Fabrizio Furlan</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">2,500<span className="pd-bs-stat-plus">㎡</span></div>
            <div className="pd-bs-stat-l">義大利廠房</div>
            <div className="pd-bs-stat-s">Treviso · 1,400㎡ CNC 產線</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">WSBK·GP</div>
            <div className="pd-bs-stat-l">車隊合作</div>
            <div className="pd-bs-stat-s">Superbike／MotoGP／Moto2／125GP</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">2026</div>
            <div className="pd-bs-stat-l">現役贊助</div>
            <div className="pd-bs-stat-s">Moto2 SYNC SPEEDRS TEAM</div>
          </div>
        </div>

        {/* 產品線矩陣(旗艦高階部品,圖 = lightech.it 官方圖、Sean 2026-07-10 校正:移除彩色小螺絲/工作墊小物) */}
        <div className="pd-bs-railwrap">
          <div className="pd-bs-rail">
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/lightech/prod-01.jpg" alt="LighTech 碳纖維後駐車架" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Carbon Paddock</div>
                <div className="pd-bs-mcard-t">碳纖維後駐車架</div>
                <div className="pd-bs-mcard-d">Autoclave 碳纖承重結構，僅 2.1kg。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/lightech/prod-02.jpg" alt="LighTech R Version 腳踏後移" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">R Version</div>
                <div className="pd-bs-mcard-t">R Version 腳踏後移</div>
                <div className="pd-bs-mcard-d">整塊 7075-T6 切削，碳纖護跟、多段可調。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/lightech/prod-03.jpg" alt="LighTech 快拆油箱蓋" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Quick Release</div>
                <div className="pd-bs-mcard-t">快拆油箱蓋</div>
                <div className="pd-bs-mcard-d">整塊切削、PUSH &amp; PULL，義大利製。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/lightech/prod-04.jpg" alt="LighTech 後照鏡孔蓋" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Track Detail</div>
                <div className="pd-bs-mcard-t">後照鏡孔蓋</div>
                <div className="pd-bs-mcard-d">賽道拆鏡後的收尾，鋁合金切削。</div>
              </div>
            </article>
          </div>
          <div className="pd-bs-railhint">← 左右滑看產品線 →</div>
        </div>
      </section>
    </>
  );
}
