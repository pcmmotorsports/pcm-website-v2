# 2026-09-15 · 手機版網站變快(字型 + 商品圖)—— plan

> 設計窗。主視窗 pcm-website-v2-b7 派工。鐵則 8(動 `app/layout.tsx` 全站字型策略、`next.config.ts`)⇒ **本檔批了才開工,只寫 plan、不寫碼**。
> 前一片:`95b757296`(LCP 圖加優先權)本機量不到好處、主視窗裁**不合** —— 瓶頸不在圖的優先權,在下面兩件。

---

## 1. 白話

- 客人用手機開網站,**要等 8–13 秒才看到第一個字**、**13–20 秒才看到主圖**。
- 慢在兩件事:
  1. **字型**:網站一開頭先去 Google 抓 6 套字型的設定檔,**抓完才開始畫畫面**;光中文字型檔就 1.4 MB。
  2. **商品圖**:目錄頁的小卡片,用的是供應商的**原始大圖**,一張最大 3 MB,手機一頁要吞 4 MB 圖。
- 這份要 Sean 決定兩件事(§8):
  - **字型**:中文改用手機內建字(iPhone 蘋方 / Android 思源黑體)—— 我們實際截圖比過,**手機上看起來幾乎一樣**。
  - **商品圖**:讓 Vercel 自動把大圖縮成卡片大小。Vercel 已經是 Pro,**不用升級**;估每月多用約 US$3–4,從 Pro 每月內含的 US$20 用量額度裡扣。

## 2. 量到的事實(每個數字附出處)

### 2-1 正式站手機 Lighthouse(2026-09-15,`npx lighthouse@13.4.1` 手機預設:slow 4G + 4x CPU,每頁 2 發取中位數)
| 頁 | LCP | FCP | 傳輸 | LCP 元素 |
|---|---:|---:|---:|---|
| 首頁 `/` | 13.2 s | 7.6 s | 4.5 MB | 輪播第 1 張 `hero-01-m.jpg`(已 `fetchpriority=high`) |
| 目錄 `/products` | 20.3 s | 9.7 s | 5.9 MB | 第 1 張商品卡圖 |
| 商品頁 `/products/dbk-bsra53v4d` | 15.9 s | 9.9 s | 2.7 MB | 圖庫主圖 |
| 品牌頁 `/brands/akrapovic` | 15.9 s | 13.1 s | 2.9 MB | 品牌帶圖 |

出處:`~/pcm-mailbox/手機速度-0915.md`(原始 JSON 在設計窗 scratchpad);CLS 0–0.003、TBT 0–128 ms ⇒ 互動不是瓶頸。

### 2-2 字型
| 事實 | 出處 |
|---|---|
| 一條 `<link rel="stylesheet">` 載 6 家:Antonio(ital 0/1 × 500/700)· Inter 400–700 · Noto Sans TC 400–700 · Noto Serif TC(0,400 / 0,500 / 1,400)· Cormorant Garamond(0,500 / 1,400 / 1,500)· JetBrains Mono 400/500 | `apps/storefront/src/app/layout.tsx:199` |
| 那支 CSS **擋 render**:204 KB、Lighthouse 估省 FCP **9.2 s(首頁)/ 7.9 s(商品頁)** | Lighthouse `render-blocking-insight`(home-1 / pdp-1) |
| 字檔 21 支共 **1.4 MB**,最大幾支都是 `notoseriftc` / `notosanstc` | Lighthouse `network-requests`(home-1) |
| 用 `<link>` 不用 `next/font` 是**既有拍板**:「對齊 design 字面、避免 next/font 隱式包裝偏離 design」 | `layout.tsx:16`;`statement/page.tsx:30-31` 引同句 |
| design 稿載的是 5 家(**沒有 Antonio**):Inter / Noto Sans TC / Noto Serif TC / Cormorant Garamond / JetBrains Mono | `design-reference` 內 Google Fonts link(grep) |
| Antonio 是後加的:RPM 商品頁 OD 模板的 N° 章節數字 / 卡片序號;**只在 `product-page.css` 4 處用**(`:889` `:977` `:1049` `:1219`) | `layout.tsx:17-18`;grep |
| token:`--f-sans: "Inter", "Noto Sans TC", …` · `--f-serif: "Noto Serif TC", "Cormorant Garamond", …` · `--f-mono: "JetBrains Mono", …` · `--f-display: "Antonio", …` | `styles/tokens.css:162-170` |
| **JetBrains Mono 用了 600 字重(17 條規則)而只載 400/500** ⇒ 600 目前是瀏覽器**假粗體** | 本窗掃 storefront CSS(`font-family: var(--f-mono)` + `font-weight: 600`) |
| Noto Sans TC 經 `next/font` 自託管的實測:**105 支 woff2 / 4,193,212 bytes**;400 與 700 **共用同一批檔(可變字型)**;CJK 沒有 `subsets` 選項 ⇒ 必須 `preload: false` | `app/account/orders/[displayId]/statement/page.tsx:34-40` |
| `next/font` 會多宣告一個 `src:local(Arial)` 的度量替身,`adjustFontFallback: false` 在 Next 16.3 + Turbopack **不生效** | 同檔 `:44-52` |

### 2-3 商品圖
| 事實 | 出處 |
|---|---|
| 卡片圖是**純 `<img>`**、沒有 `next/image`;`next.config.ts` **沒有 `images` 區塊** | `components/ProductImage.tsx:147-180`;`apps/storefront/next.config.ts`(grep `images` 零命中) |
| 每件商品只有 **1 張**主圖(`images` 陣列平均 1.00、最多 1) | 正式庫唯讀 SQL(本窗 09-15) |
| 上架 25,402 件的主圖來源 host(件數):R2 `pub-267d…r2.dev` **9,796** · `cdn.shopify.com` **5,257** · `www.cncracing.com` 1,978 · `www.gillestooling.com` 1,470 · `www.bonamiciracing.it` 1,083 · `lightech.it` 1,024 · `storage.googleapis.com` 965 · `www.gbracing.eu` 943 · `img.tpl.one` 788 · `www.extreme-components.com` 676 · `d1sfhav1wboke3.azureedge.net` **641(幾乎全是 PNG)** · `quote.pcmmotorsports.com` 638(no-photo 卡)· 其餘 5 家 142 | 正式庫唯讀 SQL(本窗 09-15) |
| 抽樣實抓大小:Gilles JPG **3,176,238 bytes** · Azure PNG **1,610,855 / 1,300,798 bytes** · R2 JPG 72,441 / 57,263 bytes · Shopify JPG 88,894 bytes | `curl -w %{size_download}`(本窗 09-15) |
| **Shopify CDN 網址加 `width=400` 就會縮**:88,894 → **7,953 bytes(−91%)**;但檔名已帶尺寸(`_1024x.png`)的那張不變(197,024 → 197,024) | 同上 curl |
| R2 `r2.dev` 公開網址**不縮圖**(`?width=400` 大小不變) | 同上 curl |
| 目錄頁圖片 **4.3 MB**;Lighthouse `image-delivery-insight` 估省 **4,139 KiB** | Lighthouse(products-1) |
| 圖由報價單側轉存 R2(「源頭下載→轉存 Cloudflare R2→DB 存乾淨 https 網址、storefront 零改動」)| `docs/phase-1-backlog.md` #275(Sean 2026-07-24 拍) |
| 圖片儲存的舊拍板:ADR-0004 Q2=A2 = Supabase Storage(但實際沒有走到) | `docs/phase-1-backlog.md` #43 supersede 註 |

### 2-4 平台方案與價格
| 事實 | 出處 |
|---|---|
| **Vercel team `pcm-motorsports` = Pro** | Vercel API `list_teams` 回 `"plan": "pro"`(主視窗 b7 與本窗 2026-09-15 各查一次);Sean 2026-08-23 批升級(memory `reference_pcm-platform-plans-vercel-hobby-supabase-pro` 第 81 行起) |
| ⚠️ 本檔初版(`7a7654ed9`)寫成 Hobby 是**錯的**:只讀了上面那顆 memory 的前段(07-16 / 07-25),沒讀到同檔 08-23 的推翻段。repo 裡還寫 Hobby 的文件(過期,**本片不改**)見 `~/pcm-mailbox/進度-設計窗.md` | — |
| Image Optimization 價目(Pro 走 on-demand;官方頁的「含多少次、超量回 402」那欄**只寫 Hobby**,與我們無關,已刪) | https://vercel.com/docs/image-optimization/limits-and-pricing(last_updated 2026-08-11) |
| on-demand:transformations **$0.05–$0.0812 / 1K**(每次 cache MISS / STALE)· cache reads **$0.40–$0.64 / 1M**(8 KB 一單位)· cache writes **$4.00–$6.40 / 1M**(8 KB 一單位)· 另計 Fast Data Transfer / Edge Requests | 同上 |
| Vercel Pro:**$20 / 月平台費,含 $20 用量額度**;含 Flat Rate CDN 1M requests + 1 TB 傳輸 / 月 | https://vercel.com/docs/plans/pro-plan(last_updated 2026-09-02) |
| **Supabase = Pro**;Image Transformations 只給 Pro 以上,**含 100 / 月、超過 $5 / 1,000 origin images**;**只能轉 Supabase Storage 裡的檔** | memory 同上;https://supabase.com/docs/guides/storage/serving/image-transformations |

## 3. 字型:選項

> 共同前提:改完要照 `layout.tsx:16` 的拍板精神驗「字面對齊 design」—— 所以每個選項都附截圖。

### A. 同樣 6 家改 `next/font` 自託管、只載用到的字重、`display: swap`
- 做法:`layout.tsx` 拿掉 Google `<link>`,改 `next/font/google` 宣告;CSS 變數由 `next/font` 的 `variable` 餵 token。字重修正:Antonio 留 700(+ italic)、JetBrains Mono **補 600**(修假粗體)、其餘照 design。
- 省多少:移掉那支 204 KB 擋 render 的 CSS + 兩個外部網域連線 ⇒ **FCP 上限約 7.9–9.2 s**(Lighthouse 估值,**不是實測**)。字檔總量**不會少**(CJK 仍要下載,只是不擋畫面):statement 頁實測 Noto Sans TC 自託管 105 支 / 4.19 MB(整套,實際依頁面用字按需下載)。
- 外觀:字載完後與現在相同;**載入瞬間會先用替身字再換**(swap 閃一下)。⚠️ 替身是被拉伸過的 Arial(`statement/page.tsx:44-52`),中文閃的那一下是系統字。
- 碰到:`app/layout.tsx`、`styles/tokens.css`(變數接法);**推翻 `layout.tsx:16` 既有拍板** ⇒ 要 Sean 點頭。
- rollback:revert 那顆 commit ⇒ 回到 `<link>`。

### B. 在 A 之上,**中文改用系統字**(拿掉 Noto Sans TC,Noto Serif TC 只留給少數襯線標題或也拿掉)
- 做法:`--f-sans: "Inter", -apple-system, "PingFang TC", "Noto Sans CJK TC", "Microsoft JhengHei", sans-serif`;`--f-serif` 同理。
- 省多少:首頁字檔 1.4 MB 的大宗(Noto Sans/Serif TC 切片)**不再下載**;Latin 三家(Inter / Antonio / JetBrains Mono)每家幾十 KB 級(未量)。
- 外觀(截圖在 `~/pcm-mailbox/screens/font-plan-20260915/`,macOS Chrome 390 寬):
  - `font-home-A-current.png` vs `font-home-B-systemcjk.png`、`font-pdp-A-current.png` vs `font-pdp-B-systemcjk.png`
  - **肉眼幾乎分不出來**(那台機器替代成蘋方;iPhone 同樣是蘋方)。
  - Android 內建中文字就是 **Noto Sans CJK(與 Noto Sans TC 同一套字)** ⇒ 預期一樣(**未實機驗**)。
  - ⚠️ Windows 桌機會變成**微軟正黑體**,差異明顯 —— 但本題是手機。
- 碰到:同 A + `tokens.css`、`brand-page.css:101` 的 `--f-serif`。
- rollback:把 token 改回。

### C. 只把現在的 `<link>` 改成**非阻塞載入**(不換 next/font)
- 做法:`<link rel="preload" as="style" onload="this.rel='stylesheet'">` 或 `media="print"` 再切。
- 省多少:一樣去掉 render-blocking(FCP 上限同 A 的估值);兩個外部網域連線仍在。
- 外觀:與 A 同樣會先閃替身字;**不推翻 next/font 那條拍板**。
- 缺點:需要一段 inline script / 屬性技巧;沒補 JetBrains Mono 600;CJK 仍從 Google 抓 1.4 MB。

### 推薦:**B(= A + 中文系統字)**
- 理由:唯一同時解決「擋畫面」與「1.4 MB 中文字檔」的選項;手機上外觀幾乎不變(有截圖)。
- 若 Sean 對「中文換字型」有疑慮 ⇒ 退而求其次選 **A**(外觀零變化,只多一下 swap)。

## 4. 商品圖:選項

### A. Vercel Image Optimization(`next/image` + `remotePatterns`)
- 做法:`ProductImage.tsx` / 商品頁圖庫改用 `next/image`(或自訂 loader 走 `/_next/image`),`next.config.ts` 加 `images.remotePatterns` 列出 §2-3 的 17 個 host,`sizes` 依卡片寬度給。
- 省多少:目錄頁 Lighthouse 估省 **4,139 KiB**;Gilles 3.2 MB / Azure 1.3–1.6 MB 這類原圖會被轉成卡片寬度的 WebP / AVIF。
- 成本(**估算,不是帳單**;單價取官方區間低標,實際依區域最高約 ×1.6):
  - transformations:假設每件 2 種寬度 ⇒ 最多 **50,804 次** ⇒ × $0.05 / 1K ≈ **$2.54**(只在 cache MISS / STALE 算,命中快取不再算)。
  - cache writes:假設縮完平均 30 KB(**未量,假設值**)⇒ 約 4 單位 × 50,804 ≈ 20 萬單位 ⇒ × $4 / 1M ≈ **$0.81**。
  - cache reads:假設每月 20 萬次看圖 × 4 單位 = 80 萬單位 ⇒ × $0.40 / 1M ≈ **$0.32**(看圖次數**未量,假設值**)。
  - 圖片流量:算在 Pro 的 Flat Rate CDN(1 TB / 月)內。
  - ⇒ 合計約 **$3.7 / 月級**(區域高標約 $6),**從 Pro 每月內含的 $20 用量額度扣**;這 $20 是全站共用(函式、流量等也從這裡扣),額度用完才另外按量計費。**不用升級方案、沒有新的月費。**
  - 上線後第一個月看 Vercel 用量頁的 Image Optimization 一欄核對估算。
- 碰到:`apps/storefront/next.config.ts`(鐵則 8)、`ProductImage.tsx`、`ProductGallery.tsx`、`ProductCard` 相關測試。
- rollback:`next.config.ts` 設 `images.unoptimized: true` 或 revert。
- 附帶好處:§5 的快取時效問題一起解(圖改由 Vercel 快取供應)。

### B. Supabase Storage 圖片轉換
- 前提:**只能轉存在 Supabase Storage 的檔**,而我們的圖在 17 個外部 host ⇒ 要先把 25,402 張搬進 Storage(報價單側同步流程要改)。
- 成本:Pro 含 100 / 月、超過 **$5 / 1,000 origin images** ⇒ 25,402 張若當月都被轉 ≈ **$127 / 月**(以官方單價乘,未含搬檔工時)。
- 碰到:報價單同步(另一個 repo)、Storage bucket、`ProductImage` 網址組法。
- rollback:網址改回原圖。
- ⇒ **不推薦**:比 A 貴、工程量大、還要跨 repo。

### C. 同步時就產生縮圖(報價單側轉存 R2 時一起產 400 / 800 px WebP)
- 前提:報價單側已有「下載→轉存 R2」流程(backlog #275),但目前只涵蓋 R2 那 9,796 件;Shopify 5,257 件與其餘外部 host 仍是原網址。
- 省多少:涵蓋到的那部分效果同 A;沒轉存的 host 不受益。
- 成本:R2 儲存 / 流量費用 **未查**;主要是**工時**(報價單 repo 改同步 + DB 多一欄 `card_image` + storefront 讀新欄 + 補跑歷史 2.5 萬張)。
- 碰到:報價單 repo、正式庫 schema(migration)、`catalog-page.ts` mapper。
- rollback:storefront 讀回原欄。

### D.(附帶,零成本的一小步)Shopify 圖網址加 `width`
- 做法:`catalog-page.ts` mapper 對 `cdn.shopify.com` 且檔名沒帶尺寸的網址補 `width=` 參數。純 TS、不碰 next.config。
- 省多少:抽樣 88,894 → 7,953 bytes(−91%);涵蓋 5,257 件(21%)。**解不了** Gilles 3.2 MB / Azure 1.3–1.6 MB 那兩群。

### 推薦:**A(Vercel Image Optimization)**
- 理由:一次涵蓋全部 17 個 host、零跨 repo、零 schema;費用估算落在 Pro 內含額度裡(§4-A);順便解快取時效。
- 若 Sean 不想動 `next.config.ts` ⇒ 退而求其次做 **D**(只救 Shopify 那 21%)。

## 5. 快取時效(Lighthouse 估 803 KiB)
- 那 803 KiB 全是**供應商自己主機上的圖**快取時間太短或沒有(Azure 3 天、Bonamici 沒設、Google Storage 1 小時)—— 我們改不了對方的 header;**選 §4-A 之後圖改由 Vercel 快取,這條會一起消失,不值得另外做**(出處:Lighthouse `cache-insight` products-1)。

## 6. 影響

- 客人:手機首次看到畫面預期快數秒(字型);目錄頁圖片流量大幅下降(商品圖)。**秒數是 Lighthouse 估值,實際以上線後重量為準。**
- 外觀:字型 B 在 Windows 桌機中文會變微軟正黑體;手機預期幾乎不變(有截圖,Android 未實機驗)。
- 費用:商品圖 A ≈ $3–4 / 月(估算),從現有 Pro 的 $20 用量額度扣;不升方案、沒有新月費。字型 0 元。
- 範圍:不動 DB、不動報價單 repo(A / B 字型、A / D 圖都一樣)。

## 7. 驗收(批了之後的做法)

1. 字型:本機 production build(`next build && next start`)對 4 頁各 2 發 Lighthouse,before / after 同條件;FCP 要看到下降。
2. 字型外觀:390 寬 iPhone / Android 實機或模擬各截首頁、商品頁、品牌頁,與現在並排給 Sean 看。
3. 商品圖:preview deployment 上跑目錄頁 Lighthouse,圖片傳輸量要從 4.3 MB 明顯下降;抽 17 個 host 各 1 張確認沒有破圖。
4. 上線後:正式站同一組 4 頁 × 2 發重量,更新 `~/pcm-mailbox/手機速度-0915.md`。
5. 三綠 + 相關測試;`next.config.ts` 屬鐵則 12 高風險 ⇒ 過審查再合。

## 8. 要 Sean 拍的

```
Q1:字型怎麼改?(甲、乙都會推翻「字型用 Google 連結、不用 next/font」那條舊拍板,layout.tsx:16)
A:  甲 中文改用手機內建字 + 英文字型自己放(推薦)—— 手機上看起來幾乎一樣(附截圖),省最多
    乙 字型都照舊、只是改成自己放 —— 外觀零變化,但中文字檔 1.4 MB 還在
    丙 不動字型

Q2:商品圖要不要讓 Vercel 自動縮圖?(Vercel 已是 Pro,不用升級)
A:  甲 做自動縮圖(推薦)—— 所有品牌的圖一次變小;估每月約 US$3–4,從 Pro 內含的 $20 額度扣
    乙 只把 Shopify 那 21% 的圖縮小(免費、純程式,不動 next.config)
    丙 都不動
```

## 9. 估時
- 字型甲:~2 小時(改 layout / tokens + 截圖比對 + 本機 before / after)
- 商品圖甲:~3 小時(next/image 接線 + remotePatterns + preview 驗 17 host)
- 商品圖乙(Shopify width):~40 分鐘
