// Front3dShowcase.tsx — Front3D 品牌形象區 N°01 + 短 N°02(#212 方向3 品牌放量、2026-07-10、精簡版)
//
// 製作依據(2026-07-10 kickoff、Sean 預批):小品牌(108 群)走精簡版=N°01 三卡 + 短 N°02、不硬撐。
// 信任狀事實官方 URL 佐證(sonnet subagent 親讀 front3d.com、彙整 scratchpad research;查無不寫):
//   工程師創辦人自改車起家(front3d.com/es/pages/about)/ 3D 列印、可砂磨噴漆客製、沿用原廠螺絲免加工
//   (products/side-wings-yamaha-mt09「Uses original screws—no extra hardware needed」)/
//   適配 10+ 車廠(首頁 Shop by Brand)。
//   🔴 研究修正:kickoff 原假設「義大利 3D 列印廠」查無佐證、旁證指向西班牙(WhatsApp +34、Spain EUR)、
//   官網未載明總部 → 版面不寫產地。🔴 官方免責:僅供賽道/競技/特技/越野、非道路合法認證
//   (pages/about)→ pd-bs-note 誠實揭露(台灣買家怕買錯,先講清楚)。
// 商品圖 = 報價單 view 實際 image_url。
// 🔴 eyebrow = 官方 logo(/brands/front3d/logo.png、pd-eb-logo--dark;2026-07-10 rollout 補檔換上,取代原文字 lockup)。無官方色票 → 中性 accent。
// 純 presentational、無 props、無 hooks → 不需 'use client'。
// 🔴 L2 內容(鐵則 9、backlog #271)。

export function Front3dShowcase() {
  return (
    <>
      {/* N°01 — 為什麼選 Front3D(三卡) */}
      <section className="pd-section" aria-labelledby="pd-h-f3d01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo pd-eb-logo--dark">
              <img src="/brands/front3d/logo.png" alt="Front3D" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-f3d01">為什麼選 Front3D</h2>
          <p className="pd-lead">
            工程師出身的 3D 列印空力工作室——側翼、卡鉗導風罩沿用原廠孔位免鑽孔，賽道日外觀一次到位。
          </p>
        </div>
        {/* 品牌 HERO 大圖(Yamaha R1 裝上 Aero Kit,front3d.com 首頁圖、Sean 2026-07-10 指定「大大圖」) */}
        <img className="pd-gb-hero" src="/brands/front3d/prod-01.jpg" alt="Front3D Yamaha R1 空力套件實裝" />
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">3D 列印一體成形</h3>
            <p className="pd-feature-desc">3D 列印直接成型，MotoGP 風格小翼與導風罩用親民價格入手；表面可再砂磨、噴漆，配色自己作主。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">原廠螺絲直上、免鑽孔</h3>
            <p className="pd-feature-desc">按車型建模、沿用原廠鎖點與螺絲——不用鑽車殼、不用另買五金，拆回原狀也不留痕跡。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">賽道取向、誠實定位</h3>
            <p className="pd-feature-desc">原廠明文定位賽道／競技／越野用途，非道路認證部品——定位講在前面，要改什麼、怎麼用，你自己決定。</p>
          </article>
        </div>
      </section>

      {/* 短 N°02 — 空力套件(信任狀三格 + 產品線三卡 + 免責 note;精簡版) */}
      <section className="pd-section pd-bs" aria-labelledby="pd-h-f3d02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  空力套件'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-f3d02">給街車的賽道空力語彙</h2>
        </div>

        {/* 交錯段:兩張官方實裝照(Sean 2026-07-11 提供 front3d.com 裝車照,直式影片比例不佳改用照片;肉眼驗零汽車商品) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/front3d/install-1.jpg" alt="Front3D 空力套件實裝於 Triumph Speed Triple RS 車頭" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Design · 3D 設計</div>
            <div className="pd-bona-h3">從 3D 建模到成品</div>
            <p className="pd-bona-p">工程師以 3D 建模逐車開版，側翼、導風罩沿用原廠孔位——列印成型後可再砂磨、噴漆，配色自己作主。</p>
          </div>
        </div>
        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/front3d/install-2.jpg" alt="Front3D 空力套件實裝正面視角" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Install · 原廠孔位直上</div>
            <div className="pd-bona-h3">對位鎖上、免鑽孔</div>
            <p className="pd-bona-p">側翼、導風罩沿用原廠鎖點——不鑽車殼、不另買五金，賽道日的空力外觀自己動手就到位。</p>
          </div>
        </div>

        {/* 信任狀三格(🔴 L2 hardcode、backlog #271;佐證 URL 見檔頭) */}
        <div className="pd-bs-stats cols-3">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">10<span className="pd-bs-stat-plus">+</span></div>
            <div className="pd-bs-stat-l">適配車廠</div>
            <div className="pd-bs-stat-s">Yamaha／Ducati／Triumph／KTM 等</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">3D</div>
            <div className="pd-bs-stat-l">列印製程</div>
            <div className="pd-bs-stat-s">可砂磨噴漆客製</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">0</div>
            <div className="pd-bs-stat-l">鑽孔需求</div>
            <div className="pd-bs-stat-s">原廠螺絲直上</div>
          </div>
        </div>

        {/* 產品線矩陣(四大空力類別 Side Wings／Front Spoilers／Brake Coolers／Tail Fins,圖 = front3d.com 官方圖、Sean 2026-07-10 指定) */}
        <div className="pd-bs-railwrap">
          <div className="pd-bs-rail">
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/front3d/prod-02.png" alt="Front3D 側翼定風翼" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Side Wings</div>
                <div className="pd-bs-mcard-t">側翼定風翼</div>
                <div className="pd-bs-mcard-d">MotoGP 風格雙層側翼，下壓穩定。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/front3d/prod-03.png" alt="Front3D 前擾流下巴" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Front Spoilers</div>
                <div className="pd-bs-mcard-t">前擾流下巴</div>
                <div className="pd-bs-mcard-d">車頭下方導流，強化空力語彙。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/front3d/prod-04.png" alt="Front3D 卡鉗散熱導風罩" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Brake Coolers</div>
                <div className="pd-bs-mcard-t">卡鉗導風罩</div>
                <div className="pd-bs-mcard-d">導風降溫，賽道反覆重煞抗衰退。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/front3d/prod-05.png" alt="Front3D 尾翼尾鰭" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Tail Fins</div>
                <div className="pd-bs-mcard-t">尾翼尾鰭</div>
                <div className="pd-bs-mcard-d">車尾造型與氣流收尾一次到位。</div>
              </div>
            </article>
          </div>
          <div className="pd-bs-railhint">← 左右滑看產品線 →</div>
        </div>

        {/* 官方用途免責(front3d.com/pages/about 原文轉譯;誠實揭露、對應台灣買家怕買錯) */}
        <p className="pd-bs-note">
          原廠聲明：Front3D 部品定位為賽道、競技、特技與越野用途，未經道路使用認證——一般道路安裝前，請自行確認在地法規。
        </p>
      </section>
    </>
  );
}
