// IlmbergerShowcase.tsx — Ilmberger Carbon 品牌形象區 N°01 + N°02(2026-09-15、文字版)
//
// Sean 2026-09-15 12:1x 逐字「我要上架 ARROW 、Ilmberger、Ohlins 這三個品牌的品牌介紹跟商品頁面的no1 no2 還沒做」。
// 主視窗交辦:照 WRS(adcf4b641)的形狀做;事實只寫官網查得到的;照片版權不明先不用。
//
// 版型:N°01 = design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md:236-261「Highlights」三卡;
//   N°02 = 同檔 :267-289「Engineering」數據列,落在家族既有的 pd-bs-stats。
// 🔴 **文字版:沒有 logo、沒有故事圖** —— repo 內 Ilmberger 零素材(`find ... -ipath '*ilmberger*'` ⇒ 0),
//   交辦「照片版權不明先不用」⇒ eyebrow 用 pd-eb-label 文字、N°02 不放 pd-bona-brow 故事段。
// 🔴 accent 中性(只掛 pd-bs):沒有查到官方色票。
// 🔴 L2 hardcode(鐵則 9、backlog #271)。
// 🔵 文案每段寫成【一行】:JSX 裡換行會變成一個半形空格, 接在全形標點後面就多一格(同 ArrowShowcase 檔頭)。
//
// 🔴🔴 **不寫「德國製 / Made in Germany」—— 查證抓到的**:公司在德國巴伐利亞(Impressum:Oberhaching),
//   而官網 /de/Produktion/Norm 逐字 "Die Carbonteile von Ilmberger werden in der firmeneigenen Fertigung in Slowenien
//   und Bosnien hergestellt." ⇒ 產地是斯洛維尼亞與波士尼亞的自有工廠。寫德國製 = 對客人講錯產地。有一格測試擋它。
//
// ═══ 事實來源(本片【只有】來源 A:官網 ilmberger-carbon.com)═══
//   2026-09-15 A 窗以 firecrawl maxAge:0 live 抓(四頁皆 HTTP 200)。逐字原文:
//
//   A-G `/de/Geschichte/Geschichte`
//     G1 標題 "Die Geschichte von Ilmbeger Carbon - Im Rennsport geboren, auf der Straße zugelassen."
//     G2 "Julius Ilmberger ist seit 1987 im Motorradrennsport aktiv"
//        "... veranlassten Julius Ilmberger schließlich, seine ersten Carbonteile für den Eigenbedarf selbst zu fertigen."
//     G3 "Im Jahre 1990 war die Nachfrage so groß, dass Julius Ilmberger eine eigene Firma gründete: Ilmberger Carbonparts."
//     G4 "Dies ermöglicht eine direkte Verwendung der Teile im deutschen Straßenverkehr, ohne umständliche Einzelabnahme beim TÜV."
//        "... sodass heute das gesamte Sortiment an Straßenteilen von Ilmberger durch eine ABE abgedeckt und zugelassen ist."
//        ⚠️ G4 說的是【道路件】全系列;/de/Produktion/Norm 另一句寫「Alle Carbonteile」⇒ 兩頁射程不同,版面取窄的那個。
//        ⚠️ ABE 是德國的許可 ⇒ 版面只寫「在德國」,不暗示台灣法規。
//     G5 "Mit dem vorderen Kotflügel der Panigale V4 erhielt die noch recht junge Firma ihren ersten Serienauftrag."(2016)
//        "Ebenfalls noch im gleichen Jahr wurde Ilmberger Carbon von BMW Motorrad nach einem internen Auswahlverfahren
//         als Lieferant für die HP4 Race ausgewählt."
//     G6 "Seit 2023 werden sowohl die Werksteams in der WSBK, sowie die Teams der EWC durch Ilmberger Carbon ausgestattet."
//        (同段開頭 "vertieft sich die Partnerschaft mit BMW Motorrad";/de/service 列 "BMW MOTORRAD WORLD ENDURANCE TEAM")
//
//   A-U `/de/Wissen/Unterschied`
//     U1 "Ilmberger setzt auf eine Fertigung im Autoklaven, bei der ausschließlich speziell entwickeltes Prepreg-Carbon verwendet wird."
//     U2 "Durch den Einsatz modernster CNC-Technik und roboterunterstütztem Kantenschnitt entstehen Teile ..."
//     U3 "... die Rolle von Ilmberger als offizieller Lieferant für renommierte Marken wie BMW und Ducati sowie Ducati Performance."
//
//   A-N `/de/Produktion/Norm`
//     N1 產地句(見上方 🔴🔴)· "Diese Produktion ist nach den international anerkannten Normen ISO 9001 und ISO 14001 zertifiziert."
//     N2 "Einmal jährlich lässt Ilmberger die Qualität seiner Bauteile darüber hinaus unabhängig vom TÜV Rheinland prüfen.
//         Im Fokus dieser Prüfung steht insbesondere die Witterungsbeständigkeit der Carbonteile."
//     N3(/de/Geschichte/Geschichte)"Die Pulverbeschichtung wird zusätzlich aufgetragen und bietet damit eine Grundierung für den
//         darüber liegenden Klarlack."
//
//   A-I `/de/impressum` "Ilmberger Carbonparts · Julius Ilmberger · Hahilingastr. 5 · D-82041 Oberhaching · Deutschland"
//
// 🔴 **這個檔在什麼情況下會【變成假的】**:官網改寫任一句 ⇒ 對應那格假掉,沒有東西會叫(hardcode)。
//   🔴 抓取的原始回應沒有存證落檔 ⇒ 從別人那一端只能寫「與引文吻合, 而引文本身未證實」。
//
// 純 presentational、無 props、無 hooks → 不需 'use client'。

export function IlmbergerShowcase() {
  return (
    <>
      {/* N°01 — 為什麼選 Ilmberger(三卡) */}
      <section className="pd-section" aria-labelledby="pd-h-ilmb01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  ILMBERGER CARBON'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-ilmb01">為什麼選 Ilmberger</h2>
          <p className="pd-lead">
            {/* 來源 G2 + G3 + G1 */}
            1987 年起就在跑機車賽的 Julius Ilmberger，找不到夠好的碳纖件，乾脆自己做，1990 年成立公司。官網給自己的一句話是：生於賽道，准上道路。
          </p>
        </div>

        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">只用熱壓罐與預浸碳纖</h3>
            <p className="pd-feature-desc">
              {/* 來源 U1 + U2 */}
              官網說全部在熱壓罐裡成型，而且只用專門開發的預浸碳纖（Prepreg）；成型後再以 CNC 與機械手臂輔助修邊。
            </p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">道路件附德國 ABE</h3>
            <p className="pd-feature-desc">
              {/* 來源 G4(射程:道路件 · 在德國)*/}
              德國 ABE（一般行車許可）讓零件在德國不必逐件送 TÜV 就能直接上路；官網說現在整個道路件系列都有 ABE。
            </p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">清漆底下多一層粉體塗層</h3>
            <p className="pd-feature-desc">
              {/* 來源 N3 + N2 */}
              表面在清漆底下多一道透明粉體塗層；TÜV Rheinland 每年獨立抽驗一次零件品質，重點是耐候性。
            </p>
          </article>
        </div>
      </section>

      {/* N°02 — 車廠與車隊(信任狀四格;文字版不放故事圖) */}
      <section className="pd-section pd-bs" aria-labelledby="pd-h-ilmb02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  車廠與車隊'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-ilmb02">BMW 與 Ducati 的原廠供應商</h2>
          <p className="pd-lead">
            {/* 來源 G5 + G6 + N1 */}
            2016 年接到第一張車廠量產訂單——Ducati Panigale V4 的前土除；同年通過 BMW Motorrad 內部遴選，供應 HP4 Race。2023 年起，BMW Motorrad 的 WSBK 廠隊與 EWC 耐力賽車隊都由 Ilmberger 供件。碳纖件在自家位於斯洛維尼亞與波士尼亞的工廠製造。
          </p>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;每格來源見檔頭)
            🛑 三個年份是遞進的時間線(1990 創立 → 2016 首張車廠訂單 → 2023 WSBK 廠隊),不是矛盾。 */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">1990</div>
            <div className="pd-bs-stat-l">成立公司</div>
            <div className="pd-bs-stat-s">eine eigene Firma gründete</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">2016</div>
            <div className="pd-bs-stat-l">第一張車廠量產訂單</div>
            <div className="pd-bs-stat-s">ihren ersten Serienauftrag</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">2023</div>
            <div className="pd-bs-stat-l">起 WSBK 廠隊供件</div>
            <div className="pd-bs-stat-s">Werksteams in der WSBK</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">ISO</div>
            <div className="pd-bs-stat-l">9001 · 14001 認證工廠</div>
            <div className="pd-bs-stat-s">ISO 9001 und ISO 14001 zertifiziert</div>
          </div>
        </div>
      </section>
    </>
  );
}
