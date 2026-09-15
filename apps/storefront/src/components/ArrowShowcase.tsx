// ArrowShowcase.tsx — ARROW 品牌形象區 N°01 + N°02(2026-09-15、文字版)
//
// Sean 2026-09-15 12:1x 逐字「我要上架 ARROW 、Ilmberger、Ohlins 這三個品牌的品牌介紹跟商品頁面的no1 no2 還沒做」。
// 主視窗交辦:照 WRS(adcf4b641)的形狀做;事實只寫官網查得到的;照片版權不明先不用。
//
// 版型:N°01 = design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md:236-261「Highlights」
//   (eyebrow + h2 + lead + pd-feature-grid 三卡);N°02 = 同檔 :267-289「Engineering」的數據列,
//   落在家族既有的 pd-bs-stats(信任狀四格)。
// 🔴 **文字版:沒有 logo、沒有故事圖** —— repo 內 ARROW 零素材(`find brand-assets apps/storefront/public -ipath '*arrow*'` ⇒ 0),
//   而交辦寫「照片版權不明先不用」⇒ eyebrow 用 pd-eb-label 文字(稿 :243 本來就是文字 eyebrow),
//   N°02 不放 pd-bona-brow 故事段(那一族每段都要一張圖)。補到授權素材再加回來。
// 🔴 accent 中性(只掛 pd-bs):沒有查到官方色票, 不臆測(同 WRS / DBK / K-SPEED)。
// 🔴 L2 hardcode(鐵則 9、backlog #271),無後台 CRUD。
// 🔵 文案每段寫成【一行】:JSX 裡換行會變成一個半形空格, 接在全形標點後面就是「起家； 設計」那種多一格
//   (2026-09-15 本機桌機截圖看到才改)。
//
// ═══ 事實來源(逐句標;本片【只有】來源 A, 沒有沿用 brand-content.ts —— 那一家的品牌頁是設計窗在做)═══
//
//   ── 來源 A:官網 `https://www.arrow.it/it/arrow`(Storia / R&D 兩段)
//      2026-09-15 A 窗以 firecrawl maxAge:0 live 抓(HTTP 200)。逐字原文:
//     A1 "Arrow Special Parts inizia la sua attività nel 1985 quando Giorgio Giannelli, ottimo pilota di motocross,
//         concretizza il suo progetto di realizzare un'azienda specializzata nella costruzione di scarichi da competizione.
//         Le prime realizzazioni sono destinate alle competizioni motocross ..."
//     A2 "Dopo un paio di stagioni arriva il primo significativo successo in pista con il titolo mondiale della classe 500
//         del pilota belga Jobè."
//     A3 "... una linea dedicata a moto enduro a 4 tempi, collaudata e messa a punto nella Parigi-Dakar. Dalla partecipazione
//         a questa classica nasce la vittoria nell'edizione del 1988 con la Honda di Edy Orioli."
//     A4 "Risalgono a questi anni i primi studi e ricerche sulla fibra di carbonio ed il titanio."(= 90 年代)
//     A5 "... alle numerose e pregiate attività artigianali indispensabili per le nostre lavorazioni, su di tutte quella di
//         saldatura dei componenti."
//     A6 "La nostra vocazione sportiva ed agonistica ci ha fatto collezionare, anche negli ultimi anni, oltre 40 titoli mondiali
//         in tutte le discipline motoristiche"
//         ⚠️ 「anche negli ultimi anni」的時間射程讀不準(近年?累計?)⇒ 版面只寫「40+ 世界冠軍頭銜」、不寫期間。
//     A7 "Arrow è partner tecnico privilegiato di Aprilia, Betamotor, Husqvarna, Moto Guzzi, MV Agusta, KMSB (Kawasaki Malesia),
//         Piaggio e Triumph."
//     A8 "Le fasi di progettazione e di produzione sono eseguite completamente in Italia, in Umbria, negli stabilimenti di
//         San Giustino (PG)."
//     A9 "Oggi siamo presenti in oltre 60 paesi."
//     A10(R&D)"Il veicolo possibilmente in configurazione originale viene posizionato sul banco di lavoro ... un prototipo fisico,
//         che viene costruito pezzo per pezzo direttamente sulla moto."
//         "Dopo questa fase il prototipo viene sottoposto a numerose verifiche, al banco prova, su strada, test di montaggio,
//         di emissioni" · "il compromesso migliore, per esempio, tra potenza alla ruota, rumore ed emissioni."
//     A11(R&D)"La sala prove è equipaggiata con un banco statico e tre banchi dinamici a rulli, che possono interfacciarsi anche
//         con l'analizzatore di gas"
//     A12(R&D)"La maggior parte degli impianti di scarico è disponibile in versione omologata per l'utilizzo stradale."
//         ⚠️ 原文是「大部分」不是「全部」⇒ 版面照寫「多數」。
//
// 🔴 **這個檔在什麼情況下會【變成假的】**:官網改寫 Storia / R&D 任一句 ⇒ 對應那格假掉,而沒有東西會叫(hardcode)。
//   驗法 = 重抓來源 A 逐句比。🔴 抓取的原始回應沒有存證落檔 ⇒ 從別人那一端只能寫「與引文吻合, 而引文本身未證實」。
//
// 純 presentational、無 props、無 hooks → 不需 'use client'。

export function ArrowShowcase() {
  return (
    <>
      {/* N°01 — 為什麼選 ARROW(三卡、pd-feature 骨架) */}
      <section className="pd-section" aria-labelledby="pd-h-arrow01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  ARROW'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-arrow01">為什麼選 ARROW</h2>
          <p className="pd-lead">
            {/* 來源 A1 + A8 */}
            1985 年由越野賽車手 Giorgio Giannelli 在義大利創立，從競賽排氣管起家；設計與生產至今全部在義大利翁布里亞的 San Giustino 廠內完成。
          </p>
        </div>

        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">從越野賽道起家</h3>
            <p className="pd-feature-desc">
              {/* 來源 A1(第一批給越野競賽)+ A2(兩個賽季後的 500cc 級世界冠軍)+ A3(1988 巴黎－達卡) */}
              第一批作品就是給越野競賽用的；創立兩個賽季後拿下第一座 500cc 級世界冠軍，1988 年再陪 Honda 車手 Edy Orioli 贏下巴黎－達卡。
            </p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">原型直接在車上做</h3>
            <p className="pd-feature-desc">
              {/* 來源 A10 */}
              新車一上市，就把原廠狀態的車推進原型間，一段一段直接在車上做出排氣管；再上測功機、跑道路、驗排放，在後輪馬力、噪音與排放之間取平衡才量產。
            </p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">車廠也找它合作</h3>
            <p className="pd-feature-desc">
              {/* 來源 A7(官網清單 8 家,版面列 7 家 + 「等」;KMSB 是馬來西亞 Kawasaki,台灣客人不熟故略)+ A12(「多數」) */}
              官網列出的技術合作車廠有 Aprilia、Betamotor、Husqvarna、Moto Guzzi、MV Agusta、Piaggio、Triumph 等；多數排氣系統另有道路合法的認證版本。
            </p>
          </article>
        </div>
      </section>

      {/* N°02 — 義大利廠內(信任狀四格;文字版不放故事圖) */}
      <section className="pd-section pd-bs" aria-labelledby="pd-h-arrow02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  義大利廠內'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-arrow02">設計到生產，都在 San Giustino</h2>
          <p className="pd-lead">
            {/* 來源 A11(測試間設備)+ A4(90 年代開始研究碳纖維與鈦)+ A5(焊接保留手工) */}
            測試間有一座靜態台架與三座滾筒式動態台架，可接排氣分析儀；90 年代開始研究碳纖維與鈦，而焊接這一段至今仍倚重師傅的手工。
          </p>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;每格都有來源 A 原文,見檔頭) */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">1985</div>
            <div className="pd-bs-stat-l">義大利創立</div>
            <div className="pd-bs-stat-s">inizia la sua attività nel 1985</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">40<span className="pd-bs-stat-plus">+</span></div>
            <div className="pd-bs-stat-l">世界冠軍頭銜</div>
            <div className="pd-bs-stat-s">oltre 40 titoli mondiali</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">60<span className="pd-bs-stat-plus">+</span></div>
            <div className="pd-bs-stat-l">國家有售</div>
            <div className="pd-bs-stat-s">presenti in oltre 60 paesi</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">100%</div>
            <div className="pd-bs-stat-l">義大利設計生產</div>
            <div className="pd-bs-stat-s">eseguite completamente in Italia</div>
          </div>
        </div>
      </section>
    </>
  );
}
