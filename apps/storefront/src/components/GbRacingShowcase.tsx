// GbRacingShowcase.tsx — GB Racing 品牌形象區 N°01 + N°02(#270 B S4 + S6 真圖)
//
// 🔴 視覺真權威 = 07-08 壓縮版 Artifact「壓縮版預覽」(9368fc24、file-history 救回、備份於本 session
//   scratchpad/artifact-recovery/0708-preview-ffed-v2.html;plan §8 定案「長版太長 6-7 屏 → 壓縮成 2-3 屏」)。
//   文案逐字直搬草稿(鐵則 1、Sean 回饋數輪定案、非 AI 自編 R6 無虞)。
// 🔴 標點例外:草稿(OD 家族)原用半形逗號/括號,渲染改**全形**——對齊 storefront 商品詳情散文家族
//   (#223 Sean 2026-06-10 Q2=B「全頁散文全形」業務 override、鐵則 1 例外;manifest productPageFullwidthPunctuation)。
// - N°01「為什麼選 GB Racing」三卡:重用 RPM 的 pd-feature-* 骨架(三家一致 Sean §4=B);eyebrow 用真 GB logo
//   圖(pd-eb-logo <img>、Sean D5=B logo 圖)。
// - N°02「工程血統」:冠軍認證橫幅 + 信任狀四格 + 產品線水平捲(4 卡);pd-gb-* 命名空間。
// 🔴 S6 真圖(Sean 2026-07-09 授權確認、Q1=A public/brands):圖片為 07-03 長版草稿內嵌 base64 → 解出落地
//   public/brands/gb-racing/*.webp(logo/hero-champion/engine-covers/frame-sliders/lever-guards/axle-sliders);
//   走原生 <img>(對齊 storefront RPM swatch 慣例、不進 next/image 遠端白名單)。
//
// 純 presentational、無 props、無 hooks、無互動 → 不需 'use client'(同 ProductHighlights)。
//
// 🔴 L2 內容(鐵則 9、backlog #271):信任狀數字(2007／2009／2 專利／450+ 車型)年度會變、hardcode 無後台 CRUD。

export function GbRacingShowcase() {
  return (
    <>
      {/* N°01 — 為什麼選 GB Racing(三卡、重用 pd-feature 骨架、三家一致) */}
      <section className="pd-section" aria-labelledby="pd-h-gb01">
        {/* lead 精簡(Sean 2026-07-09 肉眼驗二次拍板:「N°01 文字不要加長、大約兩行保持精簡即可」——推翻同日稍早「加長」)。
            標準 pd-section-head(760px 讀寬、段落自然折行),文案逐字直搬壓縮版草稿(鐵則 1)。 */}
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo">
              <img src="/brands/gb-racing/logo.webp" alt="GB Racing" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-gb01">為什麼選 GB Racing</h2>
          <p className="pd-lead">
            英國賽道等級引擎防護，自 2009 年起是全球唯一通過 FIM 認證的引擎護蓋系列，把 MotoGP、WorldSBK 的實戰防護帶回你的日常騎乘。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">FIM 認證、賽道實證</h3>
            <p className="pd-feature-desc">全球唯一通過國際摩托車總會（FIM）認證的引擎防護，長年征戰 MotoGP、WorldSBK、BSB，經頂尖車隊工程師實戰驗證。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">專利複合材質、潰縮式防護</h3>
            <p className="pd-feature-desc">高強度長玻纖尼龍射出成型，依部位精調厚度 2–12mm，搭配兩項英國專利，摔車瞬間吸收撞擊、避免磨破漏油。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">英國製造、全車系覆蓋</h3>
            <p className="pd-feature-desc">引擎護蓋、防倒球、拉桿護弓、輪軸保護，支援 Aprilia、BMW、Ducati、Honda、KTM、Yamaha 等 9 大車廠逾 450 款車型。</p>
          </article>
        </div>
      </section>

      {/* N°02 — 工程血統(冠軍認證橫幅 + 信任狀四格 + 產品線水平捲) */}
      <section className="pd-section" aria-labelledby="pd-h-gb02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  工程血統'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-gb02">FIM 唯一認證的引擎防護</h2>
          <p className="pd-lead">
            GB Racing 不是外觀改裝——是有認證、有專利、有世界賽事背書的防護工程。
          </p>
        </div>

        {/* 冠軍認證橫幅 */}
        <img className="pd-gb-hero" src="/brands/gb-racing/hero-champion.webp" alt="GB Racing 冠軍認證橫幅" />

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271) */}
        <div className="pd-gb-stats">
          <div className="pd-gb-stat">
            <div className="pd-gb-stat-n">2007</div>
            <div className="pd-gb-stat-l">品牌創立</div>
            <div className="pd-gb-stat-s">英國 Lewis Banks 精密工程</div>
          </div>
          <div className="pd-gb-stat">
            <div className="pd-gb-stat-n">2009</div>
            <div className="pd-gb-stat-l">FIM 認證</div>
            <div className="pd-gb-stat-s">全球唯一認證引擎防護</div>
          </div>
          <div className="pd-gb-stat">
            <div className="pd-gb-stat-n">2</div>
            <div className="pd-gb-stat-l">英國專利</div>
            <div className="pd-gb-stat-s">複合材質 · 磨損指示</div>
          </div>
          <div className="pd-gb-stat">
            <div className="pd-gb-stat-n">450<span className="pd-gb-stat-plus">+</span></div>
            <div className="pd-gb-stat-l">支援車型</div>
            <div className="pd-gb-stat-s">九大主流車廠</div>
          </div>
        </div>

        {/* 產品線矩陣(桌機四欄等寬 / 手機水平捲 peek) */}
        <div className="pd-gb-railwrap">
          <div className="pd-gb-rail">
            <article className="pd-gb-mcard">
              <img className="pd-gb-mcard-img" src="/brands/gb-racing/engine-covers.webp" alt="GB Racing 引擎護蓋" loading="lazy" />
              <div className="pd-gb-mcard-b">
                <div className="pd-gb-mcard-en">Engine Covers</div>
                <div className="pd-gb-mcard-t">引擎護蓋</div>
                <div className="pd-gb-mcard-d">潰縮式複合材質，摔車不磨破漏油。</div>
              </div>
            </article>
            <article className="pd-gb-mcard">
              <img className="pd-gb-mcard-img" src="/brands/gb-racing/frame-sliders.webp" alt="GB Racing 車架防倒球" loading="lazy" />
              <div className="pd-gb-mcard-b">
                <div className="pd-gb-mcard-en">Frame Sliders</div>
                <div className="pd-gb-mcard-t">車架防倒球</div>
                <div className="pd-gb-mcard-d">Race 內置 · Street 外露雙版本。</div>
              </div>
            </article>
            <article className="pd-gb-mcard">
              <img className="pd-gb-mcard-img" src="/brands/gb-racing/lever-guards.webp" alt="GB Racing 拉桿護弓" loading="lazy" />
              <div className="pd-gb-mcard-b">
                <div className="pd-gb-mcard-en">Lever Guards</div>
                <div className="pd-gb-mcard-t">拉桿護弓</div>
                <div className="pd-gb-mcard-d">防止短兵相接誤觸。</div>
              </div>
            </article>
            <article className="pd-gb-mcard">
              <img className="pd-gb-mcard-img" src="/brands/gb-racing/axle-sliders.webp" alt="GB Racing 輪軸防倒球" loading="lazy" />
              <div className="pd-gb-mcard-b">
                <div className="pd-gb-mcard-en">Axle Sliders</div>
                <div className="pd-gb-mcard-t">輪軸防倒球</div>
                <div className="pd-gb-mcard-d">前後輪軸心保護。</div>
              </div>
            </article>
          </div>
          <div className="pd-gb-railhint">← 左右滑看四大產品線 →</div>
        </div>
      </section>
    </>
  );
}
