// WrsShowcase.tsx — WRS 品牌形象區 N°01 + N°02(上架第 20 家、2026-09-04)
//
// 製作依據:骨架對照 `DbkShowcase.tsx`(重量版 + YouTube facade),
//   N°01 三卡重用 pd-feature-*、N°02 重用 pd-bona-*(影片 facade + 故事兩段)+ pd-bs-*(信任狀四格)。
//   ⇒ 重量版四個組成(三卡 / 影片 / 故事兩段 / 信任狀四格)一個不少,與 dbk 逐格同構。
//
// 🔴🔴 **本檔第一版寫錯了一個前提, 留在這裡當紀錄**:
//   ⛔ ~~「WRS 沒有影片素材 ⇒ N°02 的媒體位置換成第三段故事」~~
//   🔬 那句話的依據是 `find apps/storefront/public -iname '*.mp4'` ⇒ WRS 0 支 —— **而那把尺量的是
//     「我們 repo 裡有沒有 mp4」, 不是「這個品牌有沒有影片」。** 官網查證回來:WRS 有官方 YouTube
//     頻道(見來源 B)⇒ 前提不成立, 改回 dbk 的標準形狀(facade)。
//   📌 **⇒ 一把量錯東西的尺, 會給出一個內部完全自洽的錯結論** —— 它甚至讓我為那個偏離寫了一段
//     看起來很負責的理由。抓到它的不是我更仔細, 是**我派出去問官網的那一趟回來了**。
//
// ═══ 本片的事實有【三個來源】, 逐句標明是哪一個 ═══
//
// 🔴🔴 **DbkShowcase 檔頭的 R1 F1 教訓照搬**:那支原本寫「事實全部由本窗當場抓官網」而實際版面上
//   有 5 句來自 `brand-content.ts` —— 📌 **「我查證過」與「版面上每一句都來自我查證的那份」是兩個宣稱。**
//   ⇒ 本片一開始就逐句標。**沒有標 A/B 的句子, 就是來源 C。**
//
//   ── 來源 A(官網 `wrs.it`)2026-09-04 本窗派查證當場抓取。逐字原文:
//     `https://www.wrs.it/it/content/4-chi-siamo`
//       "Fondata nel 2008, WRS è una azienda specializzata nella produzione di cupolini per moto
//        che collabora con i Team più prestigiosi del motociclismo internazionale nei campionati
//        MotoGP e WSBK ... garantendo prodotti di altissima qualità e precisione Made in Italy."
//     地址逐字(`manufacturing.wrs.it` 頁尾):
//       "Via O. Respighi, 56 int. 1 - 47841 Cattolica (RN) - Italia"
//     ⚠️ `https://www.wrs.it/` 直接 WebFetch 回 **403**, 該趟改用 firecrawl 才拿到 ⇒ 下一個要重驗的人
//       別把 403 讀成「站掛了」。
//
//   ── 來源 B(官網製造站 `manufacturing.wrs.it`, 同屬官方)同日同法。逐字原文:
//     `/produzione/`
//       "Utilizziamo macchinari all'avanguardia quali taglio laser, scanner 3d, frese Cnc
//        e software di simulazione."
//       "Dal 2021 grazie alle nuove omologazioni ricevute la WRS è pronta a svilupparsi
//        nei mercati internazionali."(同頁放 TÜV 標章)
//     `/racing/`
//       "Dal 2018 a fronte di un aumento della capacità produttiva e viste le collaborazioni
//        sempre più numerose con i Team del Motomondiale e WSBK, abbiamo avviato la produzione
//        dei cupolini per moto sportive diventando sponsor tecnico e fornitori Ufficiali
//        dei più prestigiosi Team."
//     `/ricerca-e-sviluppo/`
//       "Un software di simulazione fisica ci permette di raggiungere alte prestazioni
//        aerodinamiche ..."
//       "Inoltre il nostro servizio è quello di affiancare i migliori team nelle prove
//        in galleria del vento."(= 風洞;同頁配圖檔名逐字含 `galleria-vento-bmw-wrs-*.jpg`)
//       🔴 **這一句是 code-reviewer M2 逼我補上的, 而它值得寫下為什麼**:
//       "L'ultimo step della produzione è quello di testare il prodotto in via definitiva
//        con prove su strada. In questo modo siamo in grado di offrire prodotti esteticamente
//        unici con un'ottima protezione aerodinamica e minimi valori di turbolenza."
//        (= 生產的最後一步是實路測試 … 亂流值極低)
//       📌 版面 N°01 卡 3 那句「官網說生產的最後一步是實路測試——目的是把亂流值壓到最低」
//         **本來就是從這段來的**, 而我沒把原文抄進檔頭 ⇒ **審查者 grep 整個 repo 零命中**
//         ⇒ 他判它「掛著『官網說』三個字而沒有任何來源」—— 🎯 **他判得對**:
//         那句話的來源當時只活在【我派出去那趟的回報裡】, 而回報會隨 session 消失。
//         ⇒ 📌 **「我查證過」與「證據在這個檔案裡」是兩個宣稱, 而只有後者活得比我久。**
//     官方 YouTube 頻道 "WRS Moto Special Parts" / "WRS TECH ZONE" 簡介逐字:
//       "WRS TECH ZONE is the official channel of WRS, \"Made in Italy\" excellence in the
//        production of PMMA windshields for road and track motorbikes."
//
//   ── 來源 C(我方 repo 既有已審內容)`apps/storefront/src/data/brand-content.ts` 的 wrs 那筆
//      (2026-09-04 實查在 `:2736-2854`)。🔴 **它不是官網, 是我們自己的品牌頁文案**,由品牌頁那條線
//      另行查證過,**而本窗沒有重驗它**。本片沿用它的句子(逐字,故意不改寫,讓品牌頁與商品頁
//      對同一件事說同一句話),已逐處在 JSX 內標註。
//
//   ── 來源 D(設計稿 design-reference,鐵則 1 的真權威)`design-reference/data/products.js:26` 逐字:
//      `{ id: 'wrs', name: 'WRS', … country: 'IT', tagline: '頂級風鏡:冠軍視野', since: 2008,
//        hero: '#ffffff', logoBg: 'transparent', heroText: 'dark' }`
//      ⚠️ 而 `design-reference/styles/pages.css:222` 逐字(⛔ ~~前一版把尾巴截掉了, N3~~):
//        `/* WRS = black text on white — multiply on light hero */`
//        ⇒ 稿給的是**白底深字**, 不是一個 accent 專色。
//        📌 **截斷值得被記一筆**:本檔用了 11 次「逐字」二字, 而截掉一次會讓下一個人不敢信其他 10 次。
//      🔴 **而我第一發 grep 這份稿是【零命中】的, 那是假的** —— 本 worktree 的 design-reference
//        submodule 當時**未初始化**(`scripts/design-ref-check.sh` 逐字警告「每一發 grep 都會回零命中,
//        而那與『稿裡真的沒有』印同一個東西」)。init 之後分母 176 檔, `wrs` 命中 2 檔。
//        📌 **⇒ 新開一棵 worktree 要先 `git submodule update --init design-reference`, 否則鐵則 1
//        的那一步是空轉的, 而它不會出聲。**
//
// 🟢 **【2008】三個來源獨立一致** —— 來源 A 逐字 "Fondata nel 2008" · 來源 C「自 2008」· 來源 D `since: 2008`。
//   🎯 **這正是 DBK 那支踩到而 WRS 沒踩到的坑**:dbk 有四個互不相容的年份 ⇒ 它的四格刻意不放年份。
//
// 🔴🔴 **【合作車隊數】刻意不上版面 —— 而這是查證抓到的矛盾**:
//   來源 C 的 stats 逐字寫「**10** 支合作車隊」, 而來源 B `/racing/` 的清單**當天可數 30+ 支**。
//   ⇒ 兩處印不同數字給同一個客人看是可見矛盾, 且該數字每次 WRS 多簽一隊就過期一次而**零訊號**
//   ⇒ 📌 **照 DbkShowcase 的同一條紀律:版面列車隊名、不列筆數。**
//   ⚠️ **而版面上點名的車隊只用【來源 B 與來源 C 都有】的那幾支**(dbk R1 F8 的同一條):
//     Ducati Lenovo · KTM Factory Racing · Prima Pramac Yamaha · ROKiT BMW Motorrad WorldSBK
//     —— 四支在 B 與 C 都出現。單一來源撐著的不上版面, 抓錯的話版面會對客人點名一支它沒供應的車隊。
//   📌 `brand-content.ts` 那個 10 要不要改, 是品牌頁那條線的事, 本片沒動;已回報主視窗。
//
// 🔴 **這個檔在什麼情況下會【變成假的】**:
//   ① 官網改寫(2018 官方供應商 / 2021 認證 / 四項設備任一變動)⇒ 信任狀四格同時假掉。
//      驗法 = 重抓來源 A/B 逐句比;而**沒有任何東西會自己叫**, 四格是 hardcode。
//   ② YouTube `h2lY1Cs3HRI` 被下架或改私人 ⇒ facade 點下去是空的。而**縮圖還在, 畫面看起來正常**。
//   ③ `brand-content.ts` 的 wrs 那筆被改寫 ⇒ 來源 C 那些句子與品牌頁**不再一致**, 而兩邊都不會紅。
//   ④ 🔴 來源 A / B 那幾次抓取的原始回應**沒有存證落檔** ⇒ 從別人那一端只能寫
//      「與引文吻合, 而引文本身未證實」。要關掉這格就得把原始回應存成 artifact。
//
// 🔴 素材 = `public/brands/wrs/*`。logo.png 是既有檔(`-auth` 線 2026-09-04 從
//   `brand-assets/assets/brands-trim/wrs.png` 複製, 逐位元組相同);其餘三張由本窗自
//   `brand-assets/assets/brands-prod/wrs/*` **壓縮**而來(`sips -Z 1200 --setProperty formatOptions 68`):
//     video-thumb.jpg      ← motogp-screen.jpg    (1400×875 214KB ⇒ 1200×750 119KB)
//     story-laser.jpg      ← craft-laser.jpg      (1400×875 513KB ⇒ 1200×750 175KB)
//     story-windtunnel.jpg ← craft-windtunnel.jpg (1500×999 420KB ⇒ 1200×799 201KB)
//   🔴 **不是逐位元組副本**(與 dbk 那支不同)—— 原檔是既有 story 圖的 3~6 倍大
//     (dbk 的 82~137KB / gilles 的 37~112KB), 直接放會拖慢商品頁。**壓縮是刻意的, 對照組在括號裡。**
//   🔴 **video-thumb 用的是自家 MotoGP 產品照, 不是 YouTube 的縮圖** —— 外連 `img.youtube.com`
//     等於再開一個「圖在別人伺服器上」的洞, 而**那正是今天 dbk 3,727 張圖踩的坑**(板 `⟦supply-DBKIMGHOTLINK⟧`)。
//   🔴 刻意留副本、不直接引 `/brand-assets/assets/` 原檔:`/brands/<slug>/` 是 showcase 的資產
//     命名空間(`GillesShowcase.tsx:41-42` 逐字說明:跨過去引會被 brand-content 重產的副作用波及)。
//
// 🔴 **accent 落中性(只掛 `pd-bs`, 不加 `pd-bs--wrs`)** —— 稿給的是白底深字(來源 D),
//   不是一個可以當 accent 的專色;`product-page.css:1182` `.pd-bs { --bs-accent: var(--c-text) }`
//   是真的中性 fallback ⇒ 加一個空 class 只會讓下一個人以為有顏色。同 K-SPEED / DBK 前例。
//
// 🔴 L2 內容(鐵則 9):信任狀四格 hardcode、無後台 CRUD(同其餘 19 家、backlog #271)。
//
// ⚠️ **肉眼驗的前提**:WRS **尚未首灌**(2026-09-04 網站庫 wrs 商品 0 筆)⇒ 真站上今天沒有商品頁
//   走得到這一區;要看畫面得自己造一筆 brandSlug='wrs' 的假商品。
//   📌 **而這正是 Sean Q4 拍甲(先做形象區再上架)的理由** —— 免得像 DNA 首灌 787 件那次,
//   整段形象區漏掉而沒有人發現。
//
// 影片 facade onClick → useState 換入 iframe → 需 'use client'(同 DbkShowcase / KspeedShowcase 前例)。

'use client';

import { useState } from 'react';

// WRS 官方形象影片 YouTube ID。2026-09-04 本窗查證於官方頻道 "WRS Moto Special Parts"
// (又稱 WRS TECH ZONE)實見,標題 "WRS TECH ZONE | Ep.1: Cupolini WRS"(主題即風鏡)。
// ⚠️ 與 dbk 那支不同:**`brand-content.ts` 的 wrs 那筆沒有 video 欄位** ⇒ 這支 ID 只有【一個來源】。
const WRS_VIDEO_ID = 'h2lY1Cs3HRI';

export function WrsShowcase() {
  const [videoOpen, setVideoOpen] = useState(false);

  return (
    <>
      {/* N°01 — 為什麼選 WRS(三卡、重用 pd-feature 骨架、家族一致) */}
      <section className="pd-section" aria-labelledby="pd-h-wrs01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo">
              <img src="/brands/wrs/logo.png" alt="WRS" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-wrs01">為什麼選 WRS</h2>
          <p className="pd-lead">
            {/* 🔴 **來源標記訂正(code-reviewer N1)**:⛔ ~~「第 1 句 = 來源 A 逐字」~~ ——
                「**成立於**義大利 Cattolica」是 A 的 `Fondata nel 2008` + 頁尾**現址**兩件事合成的,
                **A 沒說在哪裡創立**。而它站得住是靠來源 C `about.lead` 逐字「WRS 自義大利 Cattolica 起步」
                ⇒ 這一句是 **A + C**, 不是純 A。第 2 句 = 來源 C highlights.lead。 */}
            2008 年成立於義大利 Cattolica，官網說自己是「專做機車風鏡的公司」。
            風鏡的差別在曲面與材料，兩者都不是外觀問題——設計、切型到驗證，全部在自有產線完成。
          </p>
        </div>

        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">自手工部門長成獨立產線</h3>
            <p className="pd-feature-desc">
              {/* 來源 C:highlights.cards[0] 逐字 */}
              2008 年以一個小型手工部門開始，只做旅行與運動車款風鏡；
              需求成長後投入設備，建立完全獨立的生產部門。
            </p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">四項設備，都在自家廠裡</h3>
            <p className="pd-feature-desc">
              {/* 🔴 設備四項 = 來源 B 官網逐字("taglio laser, scanner 3d, frese Cnc e software
                  di simulazione");末句 = 來源 C highlights.cards[1] */}
              {/* ⛔ ~~「官網列出的設備【逐字】是」~~ ⇒ 兩處訂正:
                  ① N2:客人看到的是中譯不是逐字 —— 「逐字」二字給客人時要有代價
                  ② M3:原文連接詞是 `quali`(= such as)⇒ **那是舉例不是清單** ⇒ 改「舉的例子」 */}
              官網舉的設備例子有：雷射切割、3D 掃描、CNC 銑削與模擬軟體。
              生產部門自行掌握全部環節——設計、規劃到最終生產，不外包。
            </p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">算得出來，還要吹得過</h3>
            <p className="pd-feature-desc">
              {/* 🔴 兩段皆來源 B 官網:模擬軟體那句 + "prove in galleria del vento" + 實路測試那句 */}
              曲面先用物理模擬軟體算，再由他們陪著車隊進風洞測；
              官網說生產的最後一步是實路測試——目的是把亂流值壓到最低。
            </p>
          </article>
        </div>
      </section>

      {/* N°02 — 自有產線(官方形象影片 facade + 切型/風洞兩段 + 信任狀四格;pd-bona-* + pd-bs 中性 accent) */}
      <section className="pd-section pd-bs" aria-labelledby="pd-h-wrs02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  自有產線'}</span>
          </div>
          {/* 來源 C:craft.title 逐字 */}
          <h2 className="pd-h2" id="pd-h-wrs02">兩件外包做不到的事</h2>
          <p className="pd-lead">
            {/* 🔴 「2018 年起成為官方供應商」= 來源 B 逐字("Dal 2018 … fornitori Ufficiali");
                車隊名 = 來源 B 與來源 C 都有的那幾支(檔頭有說明為什麼不寫「共十支」) */}
            2018 年起，WRS 成為多支頂尖車隊的技術贊助商與官方供應商——
            Ducati Lenovo、KTM Factory Racing、Prima Pramac Yamaha、ROKiT BMW Motorrad WorldSBK 都在名單上。
            廠隊車頭上的那一片，與市售件出自同一條產線。
          </p>
        </div>

        {/* 官方形象影片(facade:縮圖 → 點擊才載入 YouTube iframe、省流量;同 DBK/K-SPEED 手法)
            🔴 縮圖用自家 MotoGP 產品照, 不外連 img.youtube.com(理由見檔頭) */}
        <div className="pd-bona-video">
          {videoOpen ? (
            <iframe
              className="pd-bona-video-frame"
              src={`https://www.youtube.com/embed/${WRS_VIDEO_ID}?autoplay=1&rel=0`}
              title="WRS 官方形象影片"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <button
              type="button"
              className="pd-bona-video-facade"
              onClick={() => setVideoOpen(true)}
              aria-label="播放 WRS 官方形象影片"
            >
              <img className="pd-bona-video-thumb" src="/brands/wrs/video-thumb.jpg" alt="" loading="lazy" />
              <span className="pd-bona-video-play" aria-hidden="true" />
              <span className="pd-bona-video-label">品牌形象影片 · WRS TECH ZONE</span>
            </button>
          )}
        </div>

        {/* 切型段(桌機:圖左文右) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/wrs/story-laser.jpg" alt="WRS 產線上以雷射切割 PMMA 板材" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">01 — Laser Cutting</div>
            <div className="pd-bona-h3">自有產線切型</div>
            <p className="pd-bona-p">
              {/* 來源 C:craft.rows[0] 逐字(原文的 <strong> 在此改平文,語意不變) */}
              生產部門完全獨立，自設計、規劃至最終生產一貫執行。
              雷射切割決定邊緣的乾淨度與固定孔的精度，這一段外包就控制不了。
            </p>
          </div>
        </div>

        {/* 風洞段(桌機:圖右文左、flip) */}
        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/wrs/story-windtunnel.jpg" alt="WorldSBK 廠車於風洞內進行氣流測試" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">02 — Wind Tunnel</div>
            <div className="pd-bona-h3">風洞裡的實測</div>
            <p className="pd-bona-p">
              {/* 來源 C:craft.rows[1] 逐字(<strong> 改平文)。
                  ⚠️ 來源 C 另有一句「攝於 BMW 集團的【聲學】風洞」—— 官網只給得到 "galleria del vento"
                     與配圖檔名裡的 `bmw`, **沒有「聲學」那個詞** ⇒ 本片不寫它。 */}
              曲面先以模擬軟體計算，再進風洞驗證。風鏡不是一片壓克力，
              是一片計算過又量測過的曲面；算得出來與吹得過，是兩件事。
            </p>
          </div>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271)
            🟢 四格【全部】有官網原文撐著(來源 A/B), 逐句見檔頭 —— 這一點與 dbk 那支同級。
            🔴 **而這句話在 code-reviewer 審之前是【假的】, 兩格不成立**(M3):
              ⛔ ~~「起 廠隊官方供應商」~~(原文說的是「最頂尖的車隊」, 廠隊只在來源 C)
              ⛔ ~~「4 項自有設備」~~(原文是 `Utilizziamo … quali …` = 我們使用…諸如… ⇒ 開放式舉例)
            📌 **⇒ 一句寫在四格【正上方】的「全部有官網撐著」, 擋不住四格裡有兩格沒有** ——
              因為那句話是我自己寫的, 而它與被它描述的東西之間**沒有任何機制**。
            🛑 三個年份不是矛盾, 是遞進的時間線:2008 創立 → 2018 成為官方供應商 → 2021 取得新認證。
               (dbk 那支四格刻意不放年份, 因為它的四個年份互不相容 —— 情況不同。) */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">2008</div>
            <div className="pd-bs-stat-l">義大利 Cattolica 創立</div>
            <div className="pd-bs-stat-s">Fondata nel 2008</div>
          </div>
          <div className="pd-bs-stat">
            {/* ⛔ ~~「起 廠隊官方供應商」~~ ⇒ code-reviewer M3 訂正:原文是 `i Team più prestigiosi`
                = 「最頂尖的【車隊】」, 而「廠隊(factory team)」只在來源 C 出現;
                🎯 而版面自己點名的 Prima Pramac 是**衛星隊不是廠隊** ⇒ 那是把射程講【歪】不是講寬。 */}
            <div className="pd-bs-stat-n">2018</div>
            <div className="pd-bs-stat-l">起 頂尖車隊官方供應商</div>
            <div className="pd-bs-stat-s">fornitori Ufficiali dei più prestigiosi Team</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">2021</div>
            <div className="pd-bs-stat-l">取得新認證</div>
            <div className="pd-bs-stat-s">nuove omologazioni ricevute</div>
          </div>
          <div className="pd-bs-stat">
            {/* ⛔ ~~「4 / 項自有設備 / taglio laser · scanner 3d · frese Cnc · simulazione」~~
                ⇒ code-reviewer M3 訂正, **兩個字都錯**:
                  ① 原文動詞是 `Utilizziamo`(= 我們【使用】), 不是「自有」
                  ② 連接詞是 `quali`(= such as)⇒ 🔴 **那是開放式舉例, 不是一份四項的清單**
                     —— 把 `quali` 讀成閉合集合才數得出「4」。
                📌 而設備那件事**沒有消失**, 它在 N°01 卡 2 講(那裡沒有宣稱數量)。
                ✅ 換成一句閉合的、來源 A 逐字撐得住的:`precisione Made in Italy`。 */}
            <div className="pd-bs-stat-n">Made in Italy</div>
            <div className="pd-bs-stat-l">義大利自製</div>
            <div className="pd-bs-stat-s">precisione Made in Italy</div>
          </div>
        </div>
      </section>
    </>
  );
}
