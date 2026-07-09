// SamcoShowcase.tsx — Samco Sport 品牌形象區 N°01 + N°02(#212 方向3 品牌放量、2026-07-10)
//
// 製作依據(2026-07-10 kickoff、Sean 預批):骨架同 EvotechShowcase(pd-feature + pd-bs 共用骨架)。
// 信任狀事實官方 URL 佐證(sonnet subagent 親讀 samcosport.com、彙整 scratchpad research;查無不寫):
//   英國製造 26 年、原創高性能矽膠水管品牌(samcosport.com/frequently-asked-questions/)/
//   南威爾斯 Pontyclun 自有工廠手工製造(同 FAQ)/ 終身保固(FAQ + /warranty/)/
//   MXGP Monster Energy Kawasaki(官方 blog 戰報)、WorldSBK Jonathan Rea 相關(首頁)。
//   ⚠ MotoGP 官網查無 → 不寫 MotoGP。「Fit and Forget」「Race Fit/OEM Fit」皆 FAQ 原文。
// 商品圖 = 報價單 view 實際 image_url;logo = Sean 提供 AI 檔 qlmanage 轉檔去白底(public/brands/samco/logo.png)。
// 純 presentational、無 props、無 hooks → 不需 'use client'。
// 🔴 L2 內容(鐵則 9、backlog #271):信任狀數字(26 年=查證當下值、會逐年變)hardcode 無後台 CRUD。

export function SamcoShowcase() {
  return (
    <>
      {/* N°01 — 為什麼選 Samco Sport(三卡) */}
      <section className="pd-section" aria-labelledby="pd-h-samco01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo">
              <img src="/brands/samco/logo.png" alt="Samco Sport" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-samco01">為什麼選 Samco Sport</h2>
          <p className="pd-lead">
            英國南威爾斯手工製造的矽膠水管世界品牌，26 年只做一件事——MXGP、WorldSBK 車隊同款，終身保固。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">英國手工製造 26 年</h3>
            <p className="pd-feature-desc">南威爾斯 Pontyclun 自有工廠，從矽膠原料到成品手工成型——原創高性能矽膠水管品牌，不是後起貼牌。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">終身保固、裝了就忘</h3>
            <p className="pd-feature-desc">原廠橡膠水管會熱老化龜裂爆管，矽膠不會——官方稱「Fit and Forget」，全系列水管終身保固，一次換到底。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">車型專用、原廠直上</h3>
            <p className="pd-feature-desc">按車型開發整組替換套件，Race Fit 與 OEM Fit 兩種版本——彎角走向照原廠水路，不用自己剪萬用管湊。</p>
          </article>
        </div>
      </section>

      {/* N°02 — 矽膠工藝(信任狀四格 + 產品線水平捲) */}
      <section className="pd-section pd-bs pd-bs--samco" aria-labelledby="pd-h-samco02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">矽膠工藝</span>
          </div>
          <h2 className="pd-h2" id="pd-h-samco02">水冷系統的最後一次升級</h2>
          <p className="pd-lead">
            老車救星也是賽車標配——水管換過一次 Samco，之後只需要挑顏色。
          </p>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;佐證 URL 見檔頭) */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">26<span className="pd-bs-stat-plus">年</span></div>
            <div className="pd-bs-stat-l">英國製造</div>
            <div className="pd-bs-stat-s">原創矽膠水管品牌</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">Lifetime</div>
            <div className="pd-bs-stat-l">終身保固</div>
            <div className="pd-bs-stat-s">全系列性能矽膠水管</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">MXGP</div>
            <div className="pd-bs-stat-l">賽事供應</div>
            <div className="pd-bs-stat-s">Monster Energy Kawasaki 等</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">Wales</div>
            <div className="pd-bs-stat-l">自有工廠</div>
            <div className="pd-bs-stat-s">Pontyclun 手工製造</div>
          </div>
        </div>

        {/* 產品線矩陣(圖 = 報價單 view 實際商品圖) */}
        <div className="pd-bs-railwrap">
          <div className="pd-bs-rail">
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://racebikebitzusa.com/image/cache/catalog/MV%20Agusta/AGU-1-BK-agusta-f4-1000-2001-2009-Samco-silicone-radiator-hose-kit-800x800.jpg" alt="Samco Sport 防爆水管套件" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Hose Kits</div>
                <div className="pd-bs-mcard-t">防爆水管套件</div>
                <div className="pd-bs-mcard-d">車型專用整組替換，多色可選。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://racebikebitzusa.com/image/cache/catalog/Clip%20Kits/CK-Hose-Clamp-Main-Listing-Image-001-800x800.jpg" alt="Samco Sport 不鏽鋼束環套件" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Clamp Kits</div>
                <div className="pd-bs-mcard-t">不鏽鋼束環</div>
                <div className="pd-bs-mcard-d">與水管成對的專用束環組。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://racebikebitzusa.com/image/cache/catalog/Arctic/ARC-1-BU-arctic-fox-arctic-cat-400-2003-2007-Samco-silicone-radiator-hose-kit-800x800.JPG" alt="Samco Sport ATV/UTV 水管套件" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">ATV &amp; UTV</div>
                <div className="pd-bs-mcard-t">四輪越野套件</div>
                <div className="pd-bs-mcard-d">ATV／UTV 水冷系統同樣覆蓋。</div>
              </div>
            </article>
          </div>
          <div className="pd-bs-railhint">← 左右滑看產品線 →</div>
        </div>
      </section>
    </>
  );
}
