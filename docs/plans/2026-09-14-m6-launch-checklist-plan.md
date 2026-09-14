# plan · M-6 上線 checklist 整包 —— 2026-09-14

> 來源:`docs/PHASE-1-MILESTONES.md:687-760`(§10 M-6)。§10.6 的打勾框 **2026-09-06 Sean 拍 B 作廢**,不照它判進度;**§10.5 Slice 列表是活的真權威**,本 plan 逐條對它。
> 現況怎麼量的:**真開頁面 / 真發 HTTP**(`curl https://www.pcmmotorsports.com/...` + 讀 HTML 的 `<title>` / `<meta>` / `<link rel=canonical>` / `application/ld+json`),**不是 grep**。碼側的判讀另外標明出處(檔:行)。量測時間 2026-09-14。
> `docs/launch-todo.md` 凍結只讀,本 plan 不改它。

---

## 0. 一句話結論

**M-6-01 / 02 / 03 / 04(SEO 那四片)線上已經大致是綠的** —— 不是「還沒做」,是**前面幾個月陸續做掉了而沒有人回來勾**。真正剩下的量在:**E2E(M-6-05,卡 Sean 拍 G2)**、**部署環境(M-6-06 已成真 / M-6-07 已失效)**、**上線 checklist(M-6-08)**,加上下面第 2 節那 **5 個 SEO 真缺口**。

---

## 1. 逐片現況(§10.5 Slice 列表)

### M-6-01 · SEO meta tags 各 page type

**現況(線上實測,8 條路徑)**

| 路徑 | title | description | canonical | og:title | og:image |
|---|---|---|---|---|---|
| `/` | ✅ | ✅ | ✅ | ✅ | hero-01.jpg |
| `/products` | ✅ | ✅ | ✅(依參數,`lib/catalog-canonical.ts`) | ✅ | hero-01.jpg |
| `/products/dbk-gr06` | ✅ | ✅ | ✅ | ✅ | ✅ 商品實照(R2) |
| `/brands` | ✅ | ✅ | ✅ | ✅ | hero-01.jpg |
| `/brands/akrapovic` | ✅ | ✅ | ✅ | ✅ | ✅ 品牌橫幅 |
| `/info/shipping` | ✅ | ✅ | 🔴 **缺** | ✅ | hero-01.jpg |
| `/privacy` · `/terms` | ✅ | ✅ | 🔴 **缺** | ✅ | hero-01.jpg |
| `/stores` · `/install` | ✅ | ✅ | 🔴 **缺** | ✅ | hero-01.jpg |
| `/search` | ✅ | ✅ | —(本頁 `noindex, follow`,不需要) | ✅ | hero-01.jpg |

碼側對照:`canonical` 只出現在 5 支 route(`app/page.tsx:59`、`app/products/page.tsx:87`、`app/products/[slug]/page.tsx:90`、`app/brands/page.tsx:40`、`app/brands/[slug]/page.tsx:130`)。其餘有 `metadata` 的頁一律沒有。

**要做什麼** — 給 `/info/shipping` `/privacy` `/terms` `/stores` `/install` 補 canonical。寫法照既有慣例:`resolveSiteUrl()` 拿得到才發,拿不到就整個省略(`lib/site-url.ts` 檔頭的理由:**寧缺勿錯,不能讓 Google 索引到 localhost**)。
**誰** — 設計窗(本窗)。**切片** — S1,≤20 分。

### M-6-02 · structured data(Product / BreadcrumbList / Organization)

**現況(線上讀 `application/ld+json`)**
- 每一頁都有 `Store` + `PostalAddress` + `OpeningHoursSpecification`(`app/layout.tsx:210`)⇒ **Organization 那一格已滿。**
- `/products/[slug]`:`Product` · `Brand` · `Offer` · `Motorcycle`×4 · `BreadcrumbList`(5 個 ListItem)· `FAQPage`(5 組 Q/A)⇒ **Product + BreadcrumbList 那一格已滿。**
- 🔴 `/brands/[slug]`:**只有 Store 那一組**,沒有 `Brand`、沒有 `BreadcrumbList`。
- 🟢 `/products`(型錄)也只有 Store 那一組,**而那是 2026-09-09 判過不做的**(見下)。

**要做什麼** — `/brands/[slug]` 補 `Brand` + `BreadcrumbList`(首頁 › 品牌 › 該品牌)。
🛑 **`/products` 的 `BreadcrumbList` 不做 —— 那是 2026-09-09 主視窗判過的,不是漏的。** 理由逐字在 `apps/storefront/src/lib/breadcrumb-jsonld.ts:13-19`:① 它的麵包屑住在 `components/ProductsPageHeader.tsx`,要做只有「動那支」或「維護第二份推導」;② 商品詳情頁 25,843 頁對型錄 1 頁,投報率差三個數量級,而那一頁的麵包屑本來就只有兩階。⇒ **本 plan 尊重那個判,不推翻。**
**不做** — 型錄頁的 `ItemList`(一頁 24 筆會把 JSON-LD 撐大,而 Google 對型錄 ItemList 不給額外 rich result)。
**誰** — 設計窗。**切片** — S2,≤40 分。

### M-6-03 · sitemap.xml 動態

**現況(線上實測)** — `sitemap.xml` 200、**3,607,200 bytes、25,927 個 `<loc>`**(商品 25,904 / 品牌 22 / 首頁 1),`changefreq` 與 `priority` 各 25,927 個,**`lastmod` 0 個**,單檔不是 sitemapindex。

- 🟢 **`lastmod` 缺席【不是缺口,是拍過的決定】** —— `app/sitemap.ts:32-56` 有 2026-09-09 的完整量測:`products.updated_at` 被批次整片翻新(2026-09-09 一天 25,430 列 / 全表 26,425;同一秒最大群集 4,566 列),拿它當 `lastmod` = 每次同步就對 Google 說「這 25,430 頁今天全改了」⇒ **假的 lastmod 比沒有 lastmod 更糟。** 要做得先有「內容真的變了」的來源(hash),那碰 schema ⇒ 走鐵則 8。**本 plan 不排它。**
- 🟢 `/stores` `/install` `/coming-soon` `/logout` 不進 sitemap 也是拍過的決定(`app/sitemap.ts:62-70`,2026-08-06 第 2 批)。
- 🔴 **真缺口**:`/info/shipping` `/privacy` `/terms` 三頁**有實質內容、可索引、卻不在地圖裡**。`STATIC_SITEMAP_PATHS`(`lib/seo.ts:35`)只有 `''` / `/products` / `/brands`,而上面那條 2026-08-06 的決定**沒有涵蓋這三頁**。
- ⚠️ 3.6MB 單檔:Google 的上限是 50MB / 50,000 URL ⇒ **現在沒有超**,商品數再翻倍才要切 index。**不排。**

**要做什麼** — `STATIC_SITEMAP_PATHS` 加那三條(`changefreq: yearly` / `priority: 0.3`,誠實反映它們一年改不到一次)。
**誰** — 設計窗。**切片** — 併進 S1。

### M-6-04 · robots.txt + OG image

**現況(線上實測)** — `robots.txt` 200。`*` 一組 + **11 支 AI 爬蟲各一組**(GPTBot / OAI-SearchBot / ChatGPT-User / ClaudeBot / Claude-SearchBot / Claude-User / PerplexityBot / Perplexity-User / CCBot / Google-Extended / Applebot-Extended),每組 Disallow `/account /cart /checkout /login /register /auth /api /dev-preview`,`Host` 與 `Sitemap` 都在。`/llms.txt` 200、3,523 bytes。OG image:商品頁是商品實照、品牌頁是品牌橫幅、其餘是 `hero-01.jpg`。

⇒ **這一片線上是綠的,零工可做。** (`hero-01.jpg` 當法務頁 / 佔位頁的 OG 圖是合理的,不是缺口。)

### M-6-05 · E2E 主流程 happy path

**現況** — 基建在、但只有 3 支:`apps/storefront/e2e/{home,account-guard,cart-unavailable}.spec.ts`,`playwright.config.ts` 起 `next dev --port 3100`、只跑 chromium。**沒有任何一支走完「瀏覽 → 加購 → 結帳 → 後台出貨」。**
**blocker** — §10.3 逐字「待 Sean 拍板 G2(測試覆蓋率 + E2E 範圍)」。**題在第 4 節,端 Sean。**
**誰** — 拍完才派。**切片** — 拍完再拆(預估 2-3 片)。

### M-6-06 · Vercel production env vars + production build

**現況** — `https://www.pcmmotorsports.com` 全站 200、apex 308 轉 www、`NEXT_PUBLIC_SITE_URL` 顯然有設(canonical / sitemap / OG 都吐絕對網址,沒設會全部休眠成空)⇒ **production build 綠、env 到位、而且自訂網域也綁好了**(§10.2 原本把網域列為「不做」,實際做掉了)。
⚠️ 唯一沒證到的:**env var 有沒有漏哪一條**(例如 TapPay 是不是還在 sandbox)。那要開 Vercel 主控台,**不是本窗能量的**。
**誰** — Sean 或主視窗(開 Vercel 面板核 env 清單)。**切片** — 併進 M-6-08 的 checklist。

### M-6-07 · Railway production env vars + production build

🔴 **這一片已經失效,不是待辦。** repo 裡沒有任何 Railway 設定檔(`railway.json` / `railway.toml` / `nixpacks.toml` / `Dockerfile` 全無),`apps/` 底下是 `admin` / `api` / `storefront` / `sync-engine`,**Medusa 早就不在了**;而 `CLAUDE.md` 逐字「`dev` = 後台 admin 的 production」⇒ **後台也在 Vercel,不在 Railway。**
**🛑 判定:作廢(2026-09-14 設計窗量,主視窗 09-14 指示記進本 plan)。**

**作廢的理由,三條各自成立:**
① **前提物件不存在** —— `ls railway.json railway.toml nixpacks.toml Dockerfile` 與 `find apps -maxdepth 2` 實跑,repo **零個** Railway / 容器設定檔。
② **要部署的東西不在了** —— 這一片原本部署的是 Medusa 後端(`docs/phase-1-backlog.md:1787` ⟦#60⟧ 逐字「Railway 免費版 $5/mo credit、Medusa 啟動 RAM ~512MB」)。`apps/` 現在是 `admin` / `api` / `storefront` / `sync-engine`,`package.json` / `pnpm-workspace.yaml` 零 medusa 命中。
③ **後台已經在別的地方** —— `CLAUDE.md` 逐字「**`dev` = 後台 admin 的 production,推 dev = 後台上線**」,而 `apps/admin/vercel.json` 存在(`framework: nextjs` / `regions: ["sin1"]`)⇒ 後台是 Vercel 專案,不是 Railway 服務。

⇒ 📌 **這不是「還沒做」,是那件事的對象消失了。** 把它當待辦排工,會排出一個沒有標的的 30 分鐘。
⚠️ **誠實邊界**:我證得到的是「**這個 repo 裡沒有 Railway**」。Sean 的 Railway 帳號上**還有沒有在跑、在付錢的舊服務**,我看不到 ⇒ 那一格留給 Sean 看一眼帳單,順手關掉省錢。

**誰** — 記帳由主視窗;帳單那一眼由 Sean。**切片** — 無。

### M-6-08 · 上線前 checklist 走完

§10.5 逐字列了四項:lessons-learned 規範 / 連續一週三綠 / Supabase Pro 升級驗證 / search 切 tsvector + pg_jieba。
**現況** — 這四項**本窗都沒有證據**(Supabase 方案、CI 連續一週紀錄都不在 repo 裡;搜尋那項 `20260809180000_m4b_347_1_admin_search_orders.sql` 有 tsvector,但那是**後台訂單搜尋**,不是顧客站商品搜尋)。
⚠️ 另外 `docs/launch-todo.md` 有一條 open 的 ⟦f3-TWELVEUNPROVABLE1⟧ 逐字「端給 Sean 的那個『12 件擋上線』機械上不可複現 —— 而它最可能被拿去排上線工序」⇒ **排上線工序時不要拿那份 12 件當清單。**
**誰** — 主視窗彙整 + Sean 決定。**切片** — 另開一片,不在本 plan 的動工範圍。

---

## 2. 本 plan 要動工的 5 個真缺口(彙總)

| # | 缺什麼 | 影響 | 片 |
|---|---|---|---|
| 1 | `/info/shipping` `/privacy` `/terms` `/stores` `/install` 沒有 canonical | 同一頁被參數 / 大小寫變出多個網址時權重散掉 | S1 |
| 2 | `/info/shipping` `/privacy` `/terms` 不在 sitemap | Google 要靠內鏈自己找 | S1 |
| 3 | `/brands/[slug]` 沒有 `Brand` JSON-LD | 品牌頁拿不到品牌實體識別 | S2 |
| 4 | `/brands/[slug]` 沒有 `BreadcrumbList` | 搜尋結果不顯示麵包屑路徑 | S2 |
| 5 | **站名三種寫法**:`PCM重機零件販售`(多數頁)/ `PCM MOTOR PARTS LTD`(品牌頁、法務頁)/ `PCM`(商品頁) | 搜尋結果看起來像三個不同的站 | **不動,端 Sean**(第 4 節 Q2)。已知未做,記在 `app/brands/[slug]/page.tsx:113-117` 與 `docs/handoff/2026-08-05-site-redesign-line.md` |

---

## 3. 影響 / 風險 / rollback

- **影響** — 只碰 `apps/storefront` 的 metadata 與 JSON-LD,**零資料庫、零 API、零金流、零權限**。canonical 一律沿用「`resolveSiteUrl()` 拿不到就不發」的既有休眠寫法 ⇒ 沒設網域的環境行為不變。
- **風險** — canonical 寫錯會指到別的頁 ⇒ 每一支都配單測釘字面(照 `app/brands/page.test.tsx:57` 那組現成的形狀)。
- **rollback** — 純前端 metadata,`git revert` 該顆 commit 即可,沒有資料殘留。
- **鐵則 12** — 本包不碰錢 / 權限 / schema ⇒ 不送 codex。

---

## 4. 要 Sean 拍的兩題

```
Q1(擋 M-6-05):E2E 要測到多深?
  甲 = 只做「瀏覽 → 加購 → 結帳(TapPay sandbox)→ 後台出貨」這一條 happy path 跑到底,
       加上已經出過事的那幾個點各補一支迴歸(例如購物車失效品項、登入守門)。
       約 3 片、150 分鐘。整體覆蓋率不追數字。
  乙 = 甲 + 後台第二條主線(收單 → 收款 → 退款 → 建單 → 到貨 → 出貨)也自動化,
       並把 E2E 掛進 CI 每次推都跑。約 8 片、400 分鐘,而且後台 E2E 要真帳號真 cookie,
       維護成本跟著上去(後台一改版就要修測試)。
  A: 甲|乙   ← 推薦【甲】。理由:M-6 的驗收條件原文就只寫 happy path;
     而後台現在每週都在改版(這兩週已經改了十幾片),乙的測試會一直紅、然後被關掉。

Q2(不擋工,但越晚改越貴):站名要統一成哪一個?
  現在三種混用 —— 首頁與多數頁「PCM重機零件販售」、品牌頁與法務頁「PCM MOTOR PARTS LTD」、
  商品頁「PCM」。Google 搜出來會像三個站。
  甲 = 全站統一「PCM重機零件販售」(中文、客人搜得到、和首頁一致)。
  乙 = 全站統一「PCM MOTOR PARTS LTD」(公司正式名,法務頁本來就用它)。
  A: 甲|乙   ← 推薦【甲】。理由:客人在 Google 打的是中文;正式名留在法務頁內文與
     Organization 結構化資料裡就夠,不必佔用每一頁的 title。
```

## 5. 切片表

| # | 內容 | 誰 | 估時 | 依賴 |
|---|---|---|---|---|
| S1 | 五頁補 canonical + `STATIC_SITEMAP_PATHS` 加三條靜態頁 + 單測釘字面 | 設計窗 | ≤20 分 | — |
| S2 | `/brands/[slug]` 補 `Brand` + `BreadcrumbList`;單測 | 設計窗 | ≤40 分 | S1 |
| S3 | E2E happy path | 待 Q1 拍完再拆 | — | Q1 |
| S4 | M-6-08 上線 checklist ⇒ **已產出 `docs/runbooks/launch-checklist.md`**(A Vercel env 兩張名單 / B build 綠 / C TapPay sandbox vs production 判法 / D Railway 作廢 / E 原文四項 / F 排工序前的提醒)。剩下的是**去勾它**:env 名單用 `vercel env ls production` 對、TapPay 兩支要 Sean 目視 | 主視窗 + Sean | — | — |
