// EaziGripShowcase.tsx — Eazi-Grip 品牌形象區 N°01 + N°02(#212 方向3 品牌放量、2026-07-10)
//
// 製作依據(2026-07-10 kickoff、Sean 預批):骨架同 EvotechShowcase(pd-feature + pd-bs 共用骨架)。
// 信任狀事實官方 URL 佐證(sonnet subagent 親讀 eazi-grip.com、彙整 scratchpad research;查無不寫):
//   英國 Lancashire 登記(contact 頁地址)/ Evo 系列 2011 推出(eazi-grip.com/eazi-grip/;⚠ 產品線年份、
//   非公司創立年 → 不寫「創立於 2011」)/ BSB·WSBK·MotoAmerica·MotoGP·Moto2·Moto3 車隊採用 +
//   Toprak Razgatlioglu(WSBK 冠軍)、Stefano Manzi 背書(首頁)/ Pro·Evo·Silicone 三系列材質(產品頁)。
//   ⚠ 終身保固僅限矽膠油管登錄(30 天內)、非全品項 → 不寫全品項保固。
// 商品圖 = 報價單 view 實際 image_url。
// 🔴 eyebrow = 文字 lockup(Sean 的廠牌LOGO 2 無 eazi-grip 檔;晨報補圖清單、補檔後換 pd-eb-logo <img>)。
// 純 presentational、無 props、無 hooks → 不需 'use client'。
// 🔴 L2 內容(鐵則 9、backlog #271):信任狀 hardcode 無後台 CRUD。

export function EaziGripShowcase() {
  return (
    <>
      {/* N°01 — 為什麼選 Eazi-Grip(三卡) */}
      <section className="pd-section" aria-labelledby="pd-h-eazi01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo">
              <img src="/brands/eazi-grip/logo.png" alt="Eazi-Grip" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-eazi01">為什麼選 Eazi-Grip</h2>
          <p className="pd-lead">
            英國 Lancashire 的油箱止滑貼專家，車型專屬裁型免自己剪——WSBK 世界冠軍車手同款的夾持感。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">車型專屬裁型、不用自己剪</h3>
            <p className="pd-feature-desc">每組至少兩片、按你的車型開版裁好——貼上就服貼油箱曲面，不像通用片要自己比劃剪裁還怕貼歪。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">三系列材質、按騎法選</h3>
            <p className="pd-feature-desc">Pro 低調圓紋耐磨、Evo 半球顆粒賽道鎖腿、Silicone 織紋緩衝通勤舒適——選對系列，煞車時下半身穩定不靠手腕硬撐。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">頂級賽事車隊採用</h3>
            <p className="pd-feature-desc">BSB、WSBK、MotoAmerica 到 MotoGP 各級車隊都在用，WSBK 世界冠軍 Toprak Razgatlıoğlu 同款背書。</p>
          </article>
        </div>
      </section>

      {/* N°02 — 止滑工程(信任狀四格 + 產品線水平捲) */}
      <section className="pd-section pd-bs" aria-labelledby="pd-h-eazi02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  止滑工程'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-eazi02">貼上去，過彎重煞都咬得住</h2>
          <p className="pd-lead">
            止滑貼是最便宜的操控升級——夾油箱省下的力氣，全部還給手腕與注意力。
          </p>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;佐證 URL 見檔頭) */}
        {/* N°02 形象大圖(Eazi-Grip 世界賽事車隊 pit 情境,官方圖;Sean 2026-07-10 各家 N°02 加 HERO) */}
        <img className="pd-hero-band" src="/brands/eazi-grip/hero.jpg" alt="Eazi-Grip 世界超級摩托車錦標賽車隊使用情境" loading="lazy" />

        {/* 交錯段(Bonamici 風格;Sean 2026-07-11 提供 BSB 賽事圖 + 官方止滑面特寫;肉眼驗零汽車商品) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/eazi-grip/story-bsb.jpg" alt="Eazi-Grip 贊助的 BSB 超級摩托車賽事" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Racing · 賽事驗證</div>
            <div className="pd-bona-h3">頂級賽事同款</div>
            <p className="pd-bona-p">BSB、WSBK 到 MotoGP 車隊都在用——止滑貼是最便宜的操控升級，賽場先驗證過，再給你。</p>
          </div>
        </div>
        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/eazi-grip/story-grip.jpg" alt="Eazi-Grip 半球顆粒止滑面特寫" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Design · 止滑面設計</div>
            <div className="pd-bona-h3">車型專屬裁型</div>
            <p className="pd-bona-p">每組按車型開版、半球顆粒排列針對煞車支撐——貼上就服貼油箱曲面，重煞時下半身穩定、不靠手腕硬撐。</p>
          </div>
        </div>

        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">UK</div>
            <div className="pd-bs-stat-l">英國品牌</div>
            <div className="pd-bs-stat-s">Lancashire 設計製造</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">2011</div>
            <div className="pd-bs-stat-l">Evo 系列問世</div>
            <div className="pd-bs-stat-s">半球顆粒止滑面</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">WSBK</div>
            <div className="pd-bs-stat-l">冠軍同款</div>
            <div className="pd-bs-stat-s">Toprak Razgatlıoğlu 背書</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">3</div>
            <div className="pd-bs-stat-l">材質系列</div>
            <div className="pd-bs-stat-s">Pro／Evo／Silicone</div>
          </div>
        </div>

        {/* 產品線矩陣(三種止滑材質 EVO／PRO／Silicone,圖 = eazi-grip.com 官方裝車圖、Sean 2026-07-10 校正:移除儀表貼/水管) */}
        <div className="pd-bs-railwrap">
          <div className="pd-bs-rail">
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/eazi-grip/prod-01.jpg" alt="Eazi-Grip EVO 半球顆粒止滑貼" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">EVO</div>
                <div className="pd-bs-mcard-t">半球顆粒止滑貼</div>
                <div className="pd-bs-mcard-d">明顯顆粒紋理，重煞時皮衣清楚獲得支撐。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/eazi-grip/prod-02.jpg" alt="Eazi-Grip PRO 低輪廓止滑貼" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">PRO</div>
                <div className="pd-bs-mcard-t">低輪廓止滑貼</div>
                <div className="pd-bs-mcard-d">兼顧抓附與左右換位，適合頻繁移動身體。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/eazi-grip/prod-03.jpg" alt="Eazi-Grip Silicone 緩衝止滑貼" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Silicone</div>
                <div className="pd-bs-mcard-t">緩衝止滑貼</div>
                <div className="pd-bs-mcard-d">柔軟緩衝表面，適合旅行、通勤與長途舒適。</div>
              </div>
            </article>
          </div>
          <div className="pd-bs-railhint">← 左右滑看產品線 →</div>
        </div>
      </section>
    </>
  );
}
