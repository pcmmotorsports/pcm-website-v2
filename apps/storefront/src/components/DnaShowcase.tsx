// DnaShowcase.tsx — DNA Filters 品牌形象區 N°01 + 短 N°02(2026-08-21、精簡版)
//
// ✅✅ **`pd-bs--dna` 那個【未驗】2026-09-03 線 `-auth` 看過了 —— 答案是 ①, 而它不是缺陷。**
//    ⛔ 原文 ~~「這個 class 在 CSS 裡沒有任何規則, 而【沒有人看過它】…下一次有人為了任何理由
//    走到這條動線時, 請順手看一眼它」~~ ⇒ **我走到了(補這支檔的 smoke test), 所以我看了。**
//
//    🔬 **量到的**(帶正負對照, 範圍 `apps/storefront/src/styles/`):
//      `.pd-bs--dna` ⇒ **0** 條規則 · 🟢 正對照 `.pd-bs--ebc` ⇒ **1**(同族兄弟, 尺會動)
//      · `.pd-bs` ⇒ **43** · 🔵 負對照 現造 class ⇒ **0**
//      DNA 品牌色 token(`--dna*`)⇒ **0** · 🟢 正對照 `--ebc-blue` ⇒ **2** · 🔵 負對照 ⇒ **0**
//
//    ✅ **四種解釋收斂到 ①「真的沒寫」, 而【不是缺陷】**:那個修飾子的唯一用途是
//      `--bs-accent`(品牌強調色), 而全 repo **只有 8 家有**(`evotech` / `lightech` /
//      `cnc-racing` / `samco` / `ebc` / `akrapovic` / `extreme` / `gilles`);
//      dispatcher 有 **19** 家 ⇒ **11 家沒有, DNA 在多數那邊。**
//      沒有覆寫時走 `.pd-bs { --bs-accent: var(--c-text); }` ⇒ **有顏色, 只是不是品牌色。**
//
//    🛑 **剩下的是【視覺決定】不是缺陷** —— DNA 該不該有自己的強調色是 Sean 拍板,
//      而**本窗不自己發明一個顏色**。這一格只把「沒有人看過」關掉, 不替他決定。
//    📌 **而那句話當初寫在這支檔裡而不是寫進一份清單, 是對的** —— 我不是去讀清單才看到它,
//      是**為了別的理由打開這支檔**而撞到它。⇒ 那個放置判斷今天有了一個實例。
//    📎 兩份清單與判準見 `~/pcm-mailbox/線G-規格-死class守門兩份清單-20260830.md`;
//      量測與分母釘在 `DnaShowcase.test.tsx` 第三格(有人日後幫 DNA 加 accent ⇒ 那一格會紅)。
//
// 製作依據(主視窗 2026-08-21 放行):小品牌(單一產品線=空氣濾清器)走精簡版=N°01 三卡 + 短 N°02,
// 對齊 EbcShowcase 骨架(#212 方向3 品牌放量、精簡版三家 front3d/materya/ebc 同款)。
// 起因:Sean 2026-08-21 肉眼驗 DNA 商品頁,發現保固之後直接跳「相關商品」、缺 N°01/N°02 兩段
// (`~/pcm-mailbox/I-b9-DNA商品頁品牌形象區-盤點-20260821.md`);grep BrandShowcase.tsx 確認
// 21 家裡有 15 家 case、6 家沒有(dbk/dna/gilles/kineo/rizoma/wrs),其餘 5 家因網站庫商品數為 0
// 尚未現形,DNA 是第一個「商品已上架、缺口被看到」的案例。
//
// 信任狀事實:官方 dnafilters.com 已查證(讀取日 2026-08-20,`~/pcm-mailbox/W5-021-DNA品牌頁內容草稿與出處-20260820.md`)、
// 與品牌介紹頁(`brand-content.ts:696-783`)facts/about/craft 同一批來源,本檔為商品頁語氣改寫
// (品牌頁講「認識這個牌子」、商品頁講「你手上這件東西為什麼值得買」),不是照抄:
//   多層棉紗浸油濾材、纖維間隙 150 微米仍黏附 5 微米微塵、靜電吸附原理
//     → https://www.dnafilters.com/en/inaction
//   希臘 Mandra Attika 1,300 平方米自有廠房、R&D/模具/三條產線同一棟
//     → https://www.dnafilters.com/en/factory
//   約 95% 外銷、逾 42 國;Red Dot Product Design Award 2012・2017
//     → https://www.dnafilters.com/en/(首頁)
//   官方稱於 Rally Dakar(阿根廷/安地斯/Atacama 沙漠)實測,對抗 fesh-fesh 細沙
//     → https://www.dnafilters.com/en/inaction
//
// 圖片(兩種來源,分開記,不要混成一句「圖都備齊了」):
//   logo.png / prod-01~04.jpg = 我方資料庫既有商品照(`products.images`,已在自家商品頁合法展示,
//     沿用同一批圖不是新的授權問題;2026-08-21 curl 逐張驗證 200 存活)。
//   story-anatomy.jpg = 官方 dnafilters.com/en/anatomy 的濾材結構剖面圖(1920×871,裁 16:9 損失小)
//     —— 這張走 Sean 2026-08-20 對 DNA 品牌頁圖片的既有授權(「乙:從官網抓」,他看過零授權聲明後選的)
//     延伸到本頁同一用途,主視窗 2026-08-21 明寫這個延伸判斷。
//
// 產品線卡的分類名逐字對齊 `categories` 表 name 欄(空氣濾芯/進氣上蓋/進氣套件/機油與濾芯),
// 與客人在網站上點得到的分類名是同一個字。
//
// 影片:不做(Sean 2026-08-20 對 DNA 品牌頁已拍「找不到就不放」,官網查無影片)。
//
// 純 presentational、無 props、無 hooks → 不需 'use client'。
// 🔴 L2 內容(鐵則 9、backlog #271):信任狀數字 hardcode 無後台 CRUD。

export function DnaShowcase() {
  return (
    <>
      {/* N°01 — 為什麼選 DNA(三卡) */}
      <section className="pd-section" aria-labelledby="pd-h-dna01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo">
              <img src="/brands/dna/logo.png" alt="DNA Filters" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-dna01">為什麼選 DNA</h2>
          <p className="pd-lead">
            擋得住的不是網目，是靜電——DNA 用多層棉紗浸油濾材，孔隙夠大讓空氣順暢進去，細小的灰塵照樣被黏住。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">靜電吸附，孔隙大顆粒照樣留住</h3>
            <p className="pd-feature-desc">纖維間隙可達 150 微米，連 5 微米的微塵都會被靜電黏附——孔隙夠大、進氣阻力小，卻不放過灰塵。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">自有工廠，三條產線出貨</h3>
            <p className="pd-feature-desc">希臘 Mandra Attika 1,300 平方米廠房，R&D、模具工具與品管同一棟完成，每顆濾芯都在自家產線把關。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">沙漠實測，扛得住細沙</h3>
            <p className="pd-feature-desc">官方稱於 Rally Dakar 橫越阿根廷、安地斯山與 Atacama 沙漠測試，對付當地細如粉塵的 fesh-fesh。</p>
          </article>
        </div>
      </section>

      {/* 短 N°02 — 濾清工程(信任狀四格 + 產線故事一段 + 產品線四卡;精簡版) */}
      <section className="pd-section pd-bs pd-bs--dna" aria-labelledby="pd-h-dna02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  濾清工程'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-dna02">上油棉紗擋沙，引擎照樣順暢呼吸</h2>
          <p className="pd-lead">
            1,300 平方米的專用廠房，R&D、模具與三條產線一次到位——濾芯從棉紗到出貨都在自家把關。
          </p>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;佐證 URL 見檔頭) */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">希臘</div>
            <div className="pd-bs-stat-l">Mandra Attika</div>
            <div className="pd-bs-stat-s">自有廠房產線</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">1,300<span className="pd-bs-stat-plus">㎡</span></div>
            <div className="pd-bs-stat-l">專用廠房</div>
            <div className="pd-bs-stat-s">R&D／模具／三產線</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">42<span className="pd-bs-stat-plus">+</span></div>
            <div className="pd-bs-stat-l">外銷國家</div>
            <div className="pd-bs-stat-s">約 95% 外銷</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">2012·2017</div>
            <div className="pd-bs-stat-l">Red Dot 設計獎</div>
            <div className="pd-bs-stat-s">Product Design Award</div>
          </div>
        </div>

        {/* 故事段(官方濾材結構剖面圖,16:9;佐證 URL 見檔頭) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/dna/story-anatomy.jpg" alt="DNA 濾材結構剖面示意圖" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Filtration · 過濾原理</div>
            <div className="pd-bona-h3">靜電，不是網目，擋住微塵</div>
            <p className="pd-bona-p">空氣通過上油棉紗的折層時產生靜電，微塵改變路徑黏附於纖維；灰塵停在外層，通過的是乾淨而平順的氣流。</p>
          </div>
        </div>

        {/* 產品線矩陣(四款式:空氣濾芯／進氣上蓋／進氣套件／機油與濾芯,分類名逐字對齊 categories 表;
            圖 = 我方資料庫既有商品照,見檔頭來源說明) */}
        <div className="pd-bs-railwrap">
          <div className="pd-bs-rail">
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/dna/prod-01.jpg" alt="DNA 空氣濾芯" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Air Filter</div>
                <div className="pd-bs-mcard-t">空氣濾芯</div>
                <div className="pd-bs-mcard-d">還原原廠孔位的可清洗濾芯，多層棉紗浸油，日常保養即可重複使用。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/dna/prod-02.jpg" alt="DNA Stage 2 進氣上蓋" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Stage 2</div>
                <div className="pd-bs-mcard-t">進氣上蓋</div>
                <div className="pd-bs-mcard-d">換裝加大進氣上蓋，第一階進氣升級，對應原廠螺絲孔位直上。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/dna/prod-03.jpg" alt="DNA Stage 3 進氣套件" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Stage 3</div>
                <div className="pd-bs-mcard-t">進氣套件</div>
                <div className="pd-bs-mcard-d">整組更換進氣系統，是 DNA 進氣改裝中進氣量最大的一階。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/dna/prod-04.jpg" alt="DNA 機油濾芯" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Oil Filter</div>
                <div className="pd-bs-mcard-t">機油與濾芯</div>
                <div className="pd-bs-mcard-d">搭配空濾同步保養，原廠孔位直上，機油循環系統的第一道關卡。</div>
              </div>
            </article>
          </div>
          <div className="pd-bs-railhint">← 左右滑看產品線 →</div>
        </div>
      </section>
    </>
  );
}
