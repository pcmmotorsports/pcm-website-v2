// MotogadgetShowcase.tsx — Motogadget 品牌形象區 N°01 + N°02(#212 方向3 品牌放量、2026-07-10)
//
// 製作依據(2026-07-10 kickoff、Sean 預批):骨架同 EvotechShowcase(pd-feature + pd-bs 共用骨架)。
// 信任狀事實官方 URL 佐證(sonnet subagent 親讀 motogadget.com、彙整 scratchpad research;查無不寫):
//   2000 年機械工程師 Garrit Keller 創立(motogadget.com/en/pages/our-history + /about)/
//   柏林製造、2021 遷入 1,800㎡ 新廠(our-history)/ ISO 9001(about 標章)/ 專利與 IP 逾百件
//   (/en/pages/patents「over a hundred intellectual property rights worldwide」)/
//   「TÜV-tested quality - Made in Germany」(首頁)/ iF Design Award + Good Design Award(about 標章;
//   ⚠ Red Dot 官網查無 → 不寫)。
// 商品圖 = 報價單 view 實際 image_url。
// 🔴 eyebrow = 文字 lockup(Sean 的廠牌LOGO 2 無 motogadget 檔;晨報補圖清單、補檔後換 pd-eb-logo <img>)。
// 純 presentational、無 props、無 hooks → 不需 'use client'。
// 🔴 L2 內容(鐵則 9、backlog #271):信任狀數字 hardcode 無後台 CRUD。

export function MotogadgetShowcase() {
  return (
    <>
      {/* N°01 — 為什麼選 Motogadget(三卡) */}
      <section className="pd-section" aria-labelledby="pd-h-mg01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-lockup">motogadget</span>
          </div>
          <h2 className="pd-h2" id="pd-h-mg01">為什麼選 Motogadget</h2>
          <p className="pd-lead">
            2000 年創立的柏林電裝精品——mo.view 無框後視鏡、motoscope 儀表到 mo.unit 電控中樞，德國製造、專利逾百件。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">德國工程、認證齊全</h3>
            <p className="pd-feature-desc">柏林 1,800 平方米自有廠房，ISO 9001 品質管理、TÜV 檢測——買德國電裝精品,不用賭來路。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">專利逾百件的原創設計</h3>
            <p className="pd-feature-desc">全球智慧財產逾百件，拿過 iF 與 Good Design 設計獎——玻璃無框鏡等獨門技術，仿品做不出同樣的光學品質。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">mo.unit 電控中樞</h3>
            <p className="pd-feature-desc">一顆整合保險絲、繼電器與閃爍器，所有按鍵開關直接接上——咖啡改裝最頭痛的線組，化繁為簡。</p>
          </article>
        </div>
      </section>

      {/* N°02 — 柏林電裝(信任狀四格 + 產品線水平捲;無官方色票 → 中性 accent) */}
      <section className="pd-section pd-bs" aria-labelledby="pd-h-mg02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">柏林電裝</span>
          </div>
          <h2 className="pd-h2" id="pd-h-mg02">把車頭改乾淨的德國答案</h2>
          <p className="pd-lead">
            從一支後視鏡到整車線組，Motogadget 的每件產品都在做同一件事——更少的體積，更精緻的機能。
          </p>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;佐證 URL 見檔頭) */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">2000</div>
            <div className="pd-bs-stat-l">柏林創立</div>
            <div className="pd-bs-stat-s">機械工程師 Garrit Keller</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">100<span className="pd-bs-stat-plus">+</span></div>
            <div className="pd-bs-stat-l">全球專利 IP</div>
            <div className="pd-bs-stat-s">技術・設計雙重保護</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">ISO·TÜV</div>
            <div className="pd-bs-stat-l">品質認證</div>
            <div className="pd-bs-stat-s">ISO 9001＋TÜV 檢測</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">iF</div>
            <div className="pd-bs-stat-l">設計獎項</div>
            <div className="pd-bs-stat-s">iF＋Good Design Award</div>
          </div>
        </div>

        {/* 產品線矩陣(圖 = 報價單 view 實際商品圖) */}
        <div className="pd-bs-railwrap">
          <div className="pd-bs-rail">
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://cdn.shopify.com/s/files/1/0678/3221/7868/files/MotoGadget_mo.view.spy._082451_d46cd2b7-5240-496b-b5e1-d57db6d63fce_1024x.jpg?v=1741168744" alt="Motogadget mo.view 後視鏡" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">mo.view Mirrors</div>
                <div className="pd-bs-mcard-t">無框後視鏡</div>
                <div className="pd-bs-mcard-d">玻璃無框設計，車頭視覺瞬間輕。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://cdn.shopify.com/s/files/1/0678/3221/7868/files/moswitch-mini-1_21ff8661-106a-4ca9-a2bf-306d0b17766e_1024x.png?v=1741167841" alt="Motogadget mo.switch mini 把手開關" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Switches</div>
                <div className="pd-bs-mcard-t">精品開關</div>
                <div className="pd-bs-mcard-d">鋁合金切削按鍵，握把區精緻化。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://cdn.shopify.com/s/files/1/0678/3221/7868/files/Gewebeschlauch_neu_1024x.png?v=1753692592" alt="Motogadget 纖維編織套管" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Electrics</div>
                <div className="pd-bs-mcard-t">電裝配線</div>
                <div className="pd-bs-mcard-d">編織套管等配線細節一次到位。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://cdn.shopify.com/s/files/1/0678/3221/7868/files/mg-tuch_968618f3-26fe-4492-a119-5c726e4a9c64_1024x.png?v=1741168281" alt="Motogadget 騎士好物" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Essentials</div>
                <div className="pd-bs-mcard-t">騎士好物</div>
                <div className="pd-bs-mcard-d">防霧布、螺絲膠等養車小物。</div>
              </div>
            </article>
          </div>
          <div className="pd-bs-railhint">← 左右滑看產品線 →</div>
        </div>
      </section>
    </>
  );
}
