# D 段 · 首頁重排 + 品牌頁接進正式站 — 接線計畫

> 2026-08-03 開立 · 分支 `home-redesign`(worktree `/Users/sean_1/pcm-website-v2-home`,已 `git merge --ff-only dev` 對齊 `1b8f842`)
> **本檔只是計畫,零 code 異動。**
> 設計權威 = `/Users/sean_1/Library/Application Support/Open Design/namespaces/release-stable/data/projects/pcm-home-redesign/`
> (讀過:`NEXT-STEPS.md` D 段逐字提示詞、`README.md` 全文、`brand-page-integration.md` 全文、`prototype-router.js`)
> 需求書 = `docs/specs/2026-08-01-storefront-home-redesign-brief.md`(本 worktree 未追蹤檔)
> 🔴 **§9 有一題必須 Sean 拍板才能開工**(design 真權威住哪裡)。在拍板之前,本計畫的每一片都不得開工。

---

## 0 · 一句話

首頁從「形象刊物」重排成「購物優先」(brief 拍板 Q1=B),同時把 **20 家共用一份版型的品牌介紹頁**接上正式站,
取代現有 **15 支各寫一支的 `*Showcase.tsx`**。兩者共用同一批 design token 與同一份品牌資料,所以放同一條線。

---

## 1 · 範圍與明確不做的事

### 做

| # | 事情 | 產出 |
|---|---|---|
| D1 | 品牌資料層 —— `brand-content-data.js`(20 家)→ TS 資料模組 + 型別 | 新檔 |
| D2 | 品牌介紹頁版型元件(橫幅 / 四則事實 / About / craft / 分類 / 其他品牌) | 新元件 + 新 CSS |
| D3 | 品牌介紹頁路由接線(§2 網址契約) | route 或 products 頁內嵌 |
| D4 | 品牌總覽頁 `/brands`(20 家磚牆 + 深色 logo 牆 hero) | 新 route |
| D5 | 首頁區塊重排(順序 + 份量;§4 對照表) | 改 `app/page.tsx` + 各 section |
| D6 | 首頁 hero 四張輪播 + `next/image` 化 | 改 `HomeHero.tsx` + 資產 |
| D7 | 頁尾回深 + 版權年份動態 | 改 `HomeFooter.tsx` ✅ **已完成 2026-08-05**,由全站重設計線第0批 0b 執行(主視窗 `D-107-A` 裁 A 案:0b 已被指派 D7 三件中的兩件,拆兩片會讓頁尾停在半套狀態)|
| D8 | 15 支 `*Showcase.tsx` 退場 | 刪檔 + 改 `dev-preview` 引用 |

### 不做(明確排除)

- **不換配色、不換字體**(brief:「換調性是另一題」)。`styles/tokens.css` 既有語彙沿用。
- **不照抄 `brand-page.html` 的 `.bp-slot` 骨架卡**(`brand-page-integration.md` §1 逐字:那五張灰卡只是佔位)
  → 「熱門商品」一律用既有 `ProductCard.tsx`(介面實查 §5)。
- **不搬原型專用件**:`#proto-switch`(`brand-page.html:2087-2107`)、`prototype-router.js`
  (`NEXT-STEPS.md` C 段:兩者保留在 OD 供 Sean 預覽,**正式站不要**)。
- **不搬 `brand-catalog-preview.html`**(NEXT-STEPS 已拍板 4:原型專用、不進正式站)。
- **不碰** `apps/admin/`、`packages/adapters/`(今晚兩個夜跑視窗在那裡)。
- **不碰** `docs/handoff/CURRENT.md`、`STATUS.md`(本視窗紅線)。
- **不動選車器內臟** —— 那是 A 段的事,交集見 §8。

---

## 2 · 網址契約(實查,不是憑設計稿猜)

`prototype-router.js:17-45` 的檔頭逐字說明:四支產出檔裡的連結**刻意保留正式站的網址契約**,
接線時「那些 href 可以原封不動搬過去」。從它反推出的正式站契約:

| 設計稿內的 href | 正式站語意 | 現況 |
|---|---|---|
| `/` | 首頁 | ✅ `app/page.tsx` |
| `/brands` | 品牌總覽(20 家磚牆) | 🔴 **route 不存在**(`find app -name page.tsx` 實查 18 條 route 無 `/brands`) |
| `/products?pbrand=<slug>#brand-about` | **品牌介紹頁**(router:23-34 兩條判斷都導 `brand-page.html`) | 🔴 現況只會落在商品目錄、`#brand-about` 無錨點 |
| `/products?pbrand=<slug>[&category=]` | 商品目錄篩該品牌 | ✅ `products-url-state.tsx:92-98` + `lib/catalog-query.ts` |
| `/products?pick=vehicle` | 目錄落地開燈選車 | 🔴 **A 段負責**(見 §8) |
| `/products?filter=new` / `?filter=sale` | 新品 / 特價 | ⚠️ 已知死連結 = backlog #269 |
| `/install` / `/stores` | 安裝預約 / 合作店家 | ⚠️ 已知死連結 = backlog #269 |

執行期網址由 `brand-content-data.js:1187` 產生:
`window.PCM_catalogueUrl = (slug, category) => '/products?pbrand=' + slug + (category ? '&category=' + category : '')`
—— 與正式站 `?pbrand=` 讀取端完全對得上,**這一半零改動**。

### 🔴 `?pbrand=` 的既有債(接線前必須知道)

`products-url-state.tsx:82-85` 註解寫「多品牌放量前需消歧…見 backlog #269」,
`brand-page-integration.md` §2 也照抄了這個編號。**兩處都指錯**:

- `#269` 的實際標題是「首頁殘餘死連結:`/install` `/stores` + `?filter=new|sale`」(`docs/phase-1-backlog.md:6721`)
- 真正在追這件事的是 **`#287`**,而且 `docs/phase-1-backlog.md:7112-7117` 已經逐字記載了這個 dangling 引用,
  並指示「本條(#287)實作時順手把該註解一併修正」。

→ **本計畫不修 `#287`**(它動 `products-url-state.tsx` 的 URL 合約 = 鐵則 8 + 高風險禁區,
`CURRENT.md:719` 已載明需 Sean 批 + `#288` 守門就位)。但 D3 一旦讓 `?pbrand=` 承擔「品牌介紹頁」語意,
就會**多一個消費端**壓在這個未消歧的 key 上 —— 這是 §7 的風險 R2。

---

## 3 · 品牌介紹頁的路由:三個做法與推薦

設計稿的契約是 `/products?pbrand=X#brand-about`。字面照搬有代價,列清楚:

| 案 | 做法 | 好 | 壞 |
|---|---|---|---|
| **A(推薦)** | 新 route `app/brands/[slug]/page.tsx`;`/products?pbrand=X#brand-about` 加一條 `redirect()` 保住設計稿字面連結 | 品牌頁有自己的 metadata / OG / JSON-LD(SEO 這頁才是主角);不把 `?pbrand=` 這個已知未消歧的 key 再加一個語意;`/brands` 與 `/brands/[slug]` 同一族、D4 順帶落地 | 開新 route = 鐵則 8,要 Sean 批(本計畫即是) |
| B | 真的在 `/products` 頁上,`?pbrand=` 且帶 `#brand-about` 時把品牌帶渲染在目錄上方 | 逐字符合設計稿;零新 route | `/products` 是 `force-dynamic` + 已經扛著 `products-url-state.tsx` 三個歷史 bug(#287/#288/#289)的 URL 狀態機,再塞一個模式進去 = 在最脆弱的地方加分支;品牌頁拿不到自己的 `<title>`/OG |
| C | 兩者都做(route + 目錄內嵌) | — | 兩份版型要同步,正是「20 家一份版型」要消滅的東西 |

**推薦 A。** 理由:`brand-page-integration.md` §0 的「不開新路由」講的是**商品列表**不要長第二套
(§1 逐字:「不要照設計檔重刻…直接用既有元件」),不是禁止品牌頁有自己的網址;
而 `prototype-router.js:21` 自己就把 `/brands` 當成一條正式站路由在對應。

> A 案落地後,`brand-content-data.js:1188` 的 `PCM_introUrl` 在正式站對應 `/brands/<slug>`;
> `#brand-about` 的舊字面靠 redirect 保住,設計稿不用改。

---

## 4 · 首頁:區塊對照表(哪些改字面、哪些重寫、哪些新增)

現況 `app/page.tsx:92-103` 組合 9 個元件。設計定案順序見 `README.md`「區塊順序(第 7 步之後)」:
**白 / 白 / 深 / 白 / 淺灰白 / 深**,任兩塊深色不相鄰。

| 設計 | 現有元件 | 動作 | 主要字面/結構變更 |
|---|---|---|---|
| N°01 Hero + 選車器 | `HomeHero.tsx`(46 行)+ `VehicleFinder.tsx`(167 行) | **重寫 Hero / finder 只動殼** | 四張輪播(`assets/hero/slides/hero-0N{,-m}.jpg`);`<picture>` + `next/image`;切換條 `.b-hero-tick`;**編號撞號解掉**(brief 問題 6:Hero `N°01` vs finder `01 ·`);finder 內臟屬 A 段 |
| N°02 最新商品 | `HomeSelect.tsx`(93 行) | 改字面 + 條件標題 | 標題依愛車狀態換字,條件 = **已登入且已設定愛車**(`README.md` 逐字,只登入沒設車不換);原型的 `TWEAK_DEFAULTS.demoVehicle` **不搬**、改讀真車庫 |
| N°03 部品分類 | `CategoryGrid.tsx`(70 行) | 改結構 | 12 格,第 12 格「全部分類」跳 `/products`(不另做分類目錄頁);色碼**綁分類 id 不綁排序位置**(`README.md` §8:名次會變) |
| N°04 服務宣言 | `HomeStatement.tsx`(49 行) | 改位置 + 改字面 | 由原 N°05 上移;🔴 brief 問題 5:現況寫「8 大品牌正式代理」而品牌牆列 17 家 → **數字必須對齊到 20**(或改成不報數) |
| N°05 本月聚焦 | `FeatureEditorial.tsx`(59 行) | 改位置 + 資料驅動 | 由原 N°04 下移;20 家全部預設做好、每 3 天輪播;**每筆 fact 三個欄位都要用**(標籤/值/說明句;`README.md`:說明句 08-03 才補回來) |
| N°06 授權代理 | `BrandIndex.tsx`(46 行) | **重寫** | 現況是純文字牆吃 `MOCK_BRANDS`(實查 **17 筆**;主視窗收割時勘誤,原稿誤計 interface 的 `id: string;` 行成 18),設計是 **20 家 grid 5 欄 logo 磚牆**;底色 `--ed-c-paper-2` 淺灰白;連結由 `/products?brand=${b.id}` 改成品牌介紹頁(§3) |
| 頁尾 | `HomeFooter.tsx`(70 行) | 改配色 + 動態年份 | 回 graphite `#202225` + `pcm-stacked-*-on-dark` logo;`© 2026` 改 `new Date().getFullYear()`;留白 52/40/22 **維持不動**(Sean 08-03 看過拍板)<br>✅ **已完成 2026-08-05(0b)**;⚠️ repo 內原字面是 `© MMXXVI` 不是 `© 2026`(見 d5 計畫 §「頁尾不是 © 2026」),已一併作廢 |

### 🔴 首頁的三個非改不可的細節(照抄會出錯)

1. **hero 主體必須在中間 73%(`SAFE_H`)** —— `README.md`「首頁 hero」整節:hero 沒有固定比例
   (`height:calc(100svh-69px)` 上限 880、寬不設限),鋪滿等於裁兩次。2026-08-03 第一版就這樣把 BMW 裁到只剩後照鏡。
2. **手機一定要用直式 `hero-0N-m.jpg`**,且 `object-position` 用 CSS 預設置中、**不要改成 `top`**
   (暗區在下方,`top` 會把最暗那段裁掉)。
3. **壓暗強度是 `auto_scrim` 自動找的,不要手調**;改 CSS 要回去同步 `build-hero-wall.py` 的
   `CSS_FILTER` / `TINT_H` / `TINT_V` / `NARROW_MAX_W`,否則腳本量出來的對比數字是假的。

---

## 5 · 品牌介紹頁:資料 / 元件 / 既有件

### 5.1 資料層(D1)

`brand-content-data.js`(102 KB、20 家)→ `apps/storefront/src/data/brand-content.ts`。
欄位規格見 `BRAND-PAGE-HANDOFF.md` §2;`brand-page-integration.md` §3 的 `data-field` 對照表:

`brand.name` / `brand.origin` / `brand.lede` / `fact.founded` `fact.origin` `fact.material` `fact.racing`
/ `brand.about`(**中文段落必須單行**,換行會渲染成看得見的空格)/ `brand.categories`(由後台實際分佈決定)

#### 🔴 D1 開檔後實查補記(2026-08-03,A2 收工前;**原稿沒寫到,而它會決定 D2 的做法**)

`brand-content-data.js` 實測 **1188 行 / 20 家**,頂層鍵全集:
`slug name country origin lede slogan band(src/alt/focus/portrait/poster) bandLogo logoScale
facts categories about(lead/pull/tail) craft(cards/items) aside highlights stats timeline
video(youtube/vimeo/file) img caption title rows d source`

**內容欄位帶 HTML 標籤,不是純文字**:實測 `<strong>` **168 處**、`<br>` **98 處**,
分佈於 `lede`(20)`slogan`(20)`about.lead`(40)`about.pull`(20)`about.tail`(20)
`title`(53)`caption`(11)。所以 D1 不是「JS 物件改寫成 TS 物件」那麼單純:

| 選項 | 代價 |
|---|---|
| a) 保留 HTML 字串 + `dangerouslySetInnerHTML` | 最省;但把一個 XSS 形狀的 API 帶進前台元件。內容目前全是我們自己寫死的(L2 hardcode),風險在**未來**接後台 CRUD(backlog #271)時有人把可編輯內容餵進同一個欄位 |
| b) 資料層拆成結構(`lead: [{ text, strong? }]` 之類)+ 元件渲染 | 型別安全、之後接 CRUD 不必回頭改;但 1188 行內容要逐段拆,體積遠超一片 |
| c) 保留字串 + 一支只認 `<strong>` / `<br>` 的極小 parser(白名單、不是 HTML 解析) | 中間值:不引入 `dangerouslySetInnerHTML`,轉換成本低,白名單以外一律當純文字 |

→ **D1 開工第一件事就定這一題**(推薦 **c**:讓「未來接 CRUD」不必回頭重做,
成本只比 a 多一支約 20 行純函式 + 它的單元測試)。
🔴 這題**不需要 Sean 拍板**(實作手法,不改產品行為也不改視覺輸出),
但要寫進 D1 的 commit body —— 它決定了 backlog #271 未來的接法。

- **件數欄不要搬** —— 設計稿已移除 `data-live="count"`(Sean 2026-08-02:快照數字一定跟後台對不起來)。
- 三組 logo 資產各 20 檔、用途不同、**不要拿錯**:`brands-trim/`(磚牆與其他品牌)/ `brands-dark/`(深色橫幅大 logo)/ `brands/`(原始檔、目前無人引用)。

#### 🔴 L2 內容分級(鐵則 9)

四則事實 + 兩段介紹目前是 **hardcode、無後台 CRUD**(`brand-page-integration.md` §3 明標,backlog **#271**)。
依鐵則 9,L2 = **hardcode + TODO + backlog** 可過,但要在 D1 的 commit body 標明,並在 `#271` 補一行指到新資料檔。
→ **不因此升 L3**(內容更新頻率 = 上架新品牌時,不是週多次)。

### 5.2 版型(D2)

#### D2 的五片切分(2026-08-04 補;讀過 `brand-page.html` 版面骨架後定)

`brand-page.html` = 2111 行(`<style>` 佔 11-1315,body 骨架 1349-1535)。整頁九個區塊,
一片做完會遠超鐵則 4 的 45 分鐘,故拆:

| 片 | 內容 | 對應設計稿 | 狀態 |
|---|---|---|---|
| **D2a** | `BrandRichText` 渲染元件(D1a parser 的消費端) | — | ✅ `8df6325` |
| D2b | 麵包屑 + 品牌橫幅 + 四則事實 | `.bp-crumb` `.bp-band` `.bp-facts`(1349-1385) | ⏳ |
| D2c | About + 右欄影片/產品照 | `.bp-about` `.bp-media`(1386-1411) | ⏳ |
| D2d | Why(highlights+stats)+ Craft + Timeline | `.bp-why` `.bp-craft` `.bp-time`(1412-1446) | ⏳ |
| D2e | 代表分類 chips + 品牌磚牆 + 動效層 | `.bp-cats` `.bp-others`(1447-1535)+ CSS 792 起的動效層整段 | ⏳ |

- 「商品」區(`.bp-products`)**不在 D2** —— 它用既有 `ProductCard`,屬 D3 接線。
- 動效層(CSS 792 行起)**整段原封搬、不要拆散**(§6);放 D2e 是因為它跨全部區塊,
  最後一片搬才不會邊做邊改。
- 每片都要 1440 / 390 兩斷點真機驗;**samco 的 band 截圖列入 D2b 的必看清單**
  (C-01-A Q3-1:設計側最終確認就靠 Sean 肉眼那關)。

#### 🔴 資產落地(2026-08-04,信箱 C-01-A Q1=A)

- 佈局**保留 Open Design 原樣**,複製到 `apps/storefront/public/brand-assets/assets/...`,
  資料層 117 條路徑**一字不改**(渲染時前綴 `/brand-assets/`)。
  理由:D1b 是求值產生、與來源 byte-identical,改寫路徑會毀掉可重產性;
  而 `public/brands/` 那套慣例本來就隨 D8 退場。
- 已複製 **137 檔 / 38.1 MB**(資料引用的 117 檔 + 磚牆用的 `brands-trim/` 20 檔)。
- ⛔ **維持 untracked、不得 `git add`**,直到 Sean 對「38 MB 二進位進 git」拍板
  (C-01-Q Q2 = 需 Sean,主視窗已轉問;拍板結果會落 `C-02-A.md`)。
  拍板前 `git status` 會有一行 `?? apps/storefront/public/brand-assets/`,是預期的。

各區塊的欄線,整頁共用一組 `200px | 1fr`,**不要只改其中一區**:

> 🔴🔴 **2026-08-04 D2d-2 更正:下表原本抄自 `brand-page-integration.md` §5,而那份的 craft 那一列是錯的。**
> 本表已改為對 `brand-page.html` 的 `<style>` 逐條求值(九列全數重驗,只有 craft 一列不同,另補上漏列的 `.bp-time-inner`)。
> **完整考據(版本史證據 + 為什麼不能用檔案 mtime 當判準)寫在 `apps/storefront/src/styles/brand-page.css`
> 的 `.bp-craft-inner` 規則正上方,一處全文;這裡只留結論。**
> 一句話:設計稿自 v0011(08-02 16:44)起連續 19 版都是 `200px minmax(0,1fr)`,
> 而 integration.md 成文那一刻(08-03 17:52)它已經是 200px 超過 25 小時 ⇒ 那一列從寫下當天就是錯的。

```
.bp-band           橫幅(滿版,照片 + 由左到右暗幕)
.bp-facts          欄數 = facts 個數,由 --fact-n 決定(3 或 4)
.bp-about-inner    200px | minmax(0,.8fr) | minmax(420px,1.2fr)   ← 第三欄不是 300px 固定寬
.bp-why-inner      200px | minmax(0,1fr)
.bp-cats-inner     200px | minmax(0,1fr)
.bp-products-inner 200px | minmax(0,1fr)   ← 內容再包一層 div
.bp-others-inner   200px | minmax(0,1fr)   ← 內容再包一層 div
.bp-craft-inner    200px | minmax(0,1fr)   ← 🔴 2026-08-04 更正,它**也吃**標籤欄
.bp-time-inner     200px | minmax(0,1fr)   ← 原表漏列,D2d-2 補
```

斷點 **≤1180**(About 收第三欄)/ **≤960**(全收單欄)。

> 🔴 **`grid-column` 每個斷點都要確認**(§4b 的坑):`.bp-aside` 在 ≤1180 設 `grid-column:2`,
> ≤960 忘了重設回 `auto` → 單欄容器生出隱式欄位、正文被擠成 242px 細長條。
> 用 `getComputedStyle(...).gridTemplateColumns` 量出 `45.7px 242.27px` 才抓到。

橫幅(`README.md`「品牌介紹頁的橫幅」):

- 桌機 >960 鋪滿整條、`100deg` 側向幕、logo 340px;手機 ≤960 **上方 220px 固定高**、`180deg`、停點用 **px 不用 %**、logo 190px。
- 窄螢幕那條 `::after` 選擇器必須寫成 **`.bp-band.bp-band::after`**(兩個 class)才壓得過 `.bp-band.no-photo::after` 的 0-2-0 權重 —— **少寫一個 class 窄螢幕會變回全黑**。
- **沒有照片的品牌根本不建節點**,不要用 `hidden` 藏(全站 reset 的 `img{display:block}` 會蓋掉它 → 上一家的照片留在畫面上)。

品牌磚牆(§4)—— 五個非改不可的細節,不做就是 Sean 說的「歪歪的、很空、比例不一」:
固定尺寸 logo 框 `.bp-others-logo`(58px,≤620 收 46px)/ `--logo-scale` **逐家光學校正**(7 家有值、範圍 0.88–1.08,新增品牌要目視加一次、不是套公式)/ `filter: grayscale(1) brightness(.45) contrast(1.08)` / 品牌名固定兩行高 `min-height:32px` / 磚要橫向比例 + 邊框更淡。

- 首頁磚牆與品牌頁「其他品牌」是**兩個不同元件、兩套排法**:首頁 `.b-brand-wall` = `grid` 5 欄(≤1200→4、≤700→2);品牌頁 `.bp-others-list` = `flex-wrap`(≤1180→4、≤620→3)。
- 「其他品牌」**不把當前品牌拿掉**,當前那磚加 `is-cur` + `aria-current="page"`(`brand-page.html:2001` 核對過)。
- 磚裡**只有 logo + 品牌名**,不要再加短描述(Sean 2026-08-02 明確否掉,「這條寫下來是因為它看起來像個沒做完的待辦」)。

動效層(§6)—— `<style>` 尾端標了 `══ 動效層 ══` 的整段**自足、可原封搬**,是純 CSS、**不需要 framer-motion**。
一條 `--ease: cubic-bezier(.2,0,0,1)` + 四個時長 `--dur-press:110ms` / `--dur-hover:200ms` / `--dur-reveal:420ms` / `--dur-enter:620ms`。
捲動揭示用 `IntersectionObserver`、**一次性**(進場即 `unobserve`、全完成 `disconnect`)、
`prefers-reduced-motion` 或無 `IntersectionObserver` 時**完全不介入**(不是先隱藏再等 JS —— 那樣 JS 掛掉整頁空白)。

> 🔴 `prefers-reduced-motion` 有**兩層**,不要只留一層:檔案上方全域重置只讓動畫變快;
> 動效層那層才把位移與縮放 `transform:none` 整個拿掉。只留全域層 = 元素「瞬移」,對前庭敏感的人更糟。

### 5.3 既有件重用(不要重刻)

| 要用的東西 | 位置 | 實查 |
|---|---|---|
| 商品卡 | `components/ProductCard.tsx`(254 行) | `ProductCard({ p, showRedPrice, badgeStyle='minimal', compact=false, href, onClick })` — 設計骨架畫的是 `minimal`;品牌頁精選條建議 `compact` |
| 商品型別 | `data/mock-products.ts` `MockProduct` | — |
| 整頁列表 | `components/ProductsPage.tsx:193` | `ProductsPage({ products, total, error, categories, brands, motoBrands, garage })` |
| 現有雛形 | `app/dev-preview/brands/[slug]/page.tsx`(124 行) | ⚠️ dev-only(`metadata.robots.index=false`)、商品來自 `BRAND_FIXTURES` **snapshot 而非即時目錄**、且自帶 `import '@/styles/product-page.css'`(`pd-*` 只在 `ProductPage.tsx` import、非全域 → 新品牌頁若用 `pd-*` 也要自帶,否則裸奔) |

**15 支 `*Showcase.tsx` 就是要被取代的東西**(`brand-page-integration.md` §1 逐字)。實查:
`ls components/ | grep -i showcase` = 14 支品牌專屬 + `BrandShowcase.tsx` 共 **15 支 `.tsx`**,
其中 **11 家**掛在 `dev-preview/brands/[slug]/page.tsx:29-41` 的 `SHOWCASES` 對照表。

---

## 6 · 被字面鎖住、必須同 commit 改的測試

| 測試檔 | 鎖住什麼 | D 的哪一片會弄紅 |
|---|---|---|
| `components/BrandIndex.test.tsx` | N°06 純文字牆結構 + `MOCK_BRANDS` 17 筆 | D5(改成 20 家 logo 磚牆) |
| `components/HomeHero.test.tsx` | 現況單張 hero 結構 | D6 |
| `components/CategoryGrid.test.tsx` | 8 磁磚結構 | D5(改 12 格) |
| `components/HomeSelect.test.tsx` | N°04 `New Arrivals · 最新商品` 字面 | D5(區塊改 N°02 + 條件標題) |
| `components/HomeStatement.test.tsx` | 「8 大品牌」等宣言字面 | D5(數字對齊 20) |
| `components/FeatureEditorial.test.tsx` | 單一品牌長文結構 | D5(改資料驅動輪播) |
| `components/HomeFooter.test.tsx` | 頁尾三欄 + 版權列 | D7 ✅ 已完成(0b);守門已補年份動態、logo 變體、統編字面 |
| `components/Header.test.tsx:85-105` | **完整 nav href 對照表**,含 `['品牌', '/products']` 與「不得有任何導覽項目再指向 `/brands`」的明確斷言 | 🔴 D4:`/brands` 一旦建好,這條斷言的前提就消失了,**必須同 commit 改**,且要把註解 `// 🔴 Phase 2 才有品牌頁` 一起更新 |
| 14 支 `*Showcase.test.tsx` | 各家 showcase 結構 | D8(整批隨元件刪除) |
| `app/dev-preview/brands/[slug]` 的引用 | `SHOWCASES` 11 家對照表 | D8(元件刪掉 → 這支要嘛跟著退場〔backlog #147 本來就要 M-6 前移除〕,要嘛改指新元件) |

> `components/ProductsPage.test.tsx` 與 `styles/products-mobile.test.ts` 的守門在 D 段**不會被碰到**
> (它們鎖的是目錄選車入口與斷點)—— 那是 A 段的責任面,見 §8。

---

## 7 · 風險與 rollback

| # | 風險 | 為什麼會發生 | 對策 | rollback |
|---|---|---|---|---|
| R1 | **`?pbrand=` 語意再多一個消費端** | §2 的既有債:`?brand=` / `?pbrand=` 命名空間未消歧(`products-url-state.tsx:82-85`),`#287` 未做 | 走 §3 A 案(新 route)= 品牌介紹頁**完全不碰** `?pbrand=`,只有 redirect 讀它一次 | 移除 redirect,設計稿連結退回落在商品目錄(可用、只是沒有介紹段) |
| R2 | **改到 `products-url-state.tsx`** | 若選 §3 B 案 | **不選 B**。此檔是 #287/#288/#289 三個 bug 的現場,`CURRENT.md:719` 明載需 Sean 批 + #288 守門 | — |
| R3 | **首頁 8 個 section 同時改 = 一次改 9 檔** | D5 天然跨檔 | **按 §8 的 slice 切,一片一個 section**;鐵則 4(15-45 分鐘)+ 鐵則 8(提 plan)已由本檔滿足 | 每片獨立 commit,`git revert` 單片 |
| R4 | **hero 八張圖約 1.7 MB** | `README.md` 已知限制 | 走 `next/image`(原型的 `data-src` 手動 lazy 技倆**不要搬**) | — |
| R5 | **`assets/brands-dark/samco.png` 疊 graphite 只有 2.57:1** | 第三方 logo,其餘 17 家 ≥4.15 | **不處理**(Sean 已拍板:擅自改色是品牌使用問題,而且品牌名就在旁邊 72px 大字) | — |
| R6 | **`italian` 配色 logo 不能用在深色底** | 綠字在 graphite 上認不出來 | 深色區一律 `*-on-dark`;放之前確認那一區**實際底色**、不要照區塊名字猜 | — |
| R7 | **分類第 9–11 名、商品第 5 格是資料槽** | 真站資料才會滿 | 版面必須容忍空槽、不得寫死假值(brief:「不要用假商品名或假價格」) | — |
| R8 | **`design-reference/` 與 OD 兩份設計打架** | 見 §9 | **Sean 拍板前不開工** | — |

### 三綠與驗收(鐵則 11)

- 每片 commit 前 `/slice-checkpoint`(typecheck + lint,動 `.ts/.tsx` 加 build)。
- 動前台元件 → 補/更新 `*.test.tsx` smoke test(快速自檢清單硬條)。
- 收工前 **1440 與 390 兩個斷點實際 render**(`brand-page-integration.md` §7);
  用 `agent-browser` CLI 真瀏覽器驗(memory `reference_agent-browser-cli-real-browser-verify`),
  **互動必用 production build**。
- **不 push**(紅線)。

### 片型與鐵則 12

- D1–D2、D5–D7 = **標準片**(不碰錢/權限/schema/平台設定/`packages/ui`)→ 全 9 步、`code-reviewer` 必跑、關卡2 走 code-reviewer。
- **D3 / D4 開新 route = 鐵則 8**(動路由、影響部署)→ 本計畫即為 plan,**等 Sean 批**。
- 全 D 段**不命中鐵則 12 任一類**(無錢、無權限、無 schema/migration、無 `next.config`/`vercel.json` 改動、無對外寄送、`packages/ui` 不動)→ codex 對抗審查非強制。
  ⚠️ 若實作時發現需要動 `next.config.ts`(例如 hero 圖 remote pattern),**當場升級為高風險片**、停下跑 codex 關卡2。

---

## 8 · 🔴 與 A 段(選車引擎統一 B′)的交集與先後順序

**這一節是分開寫兩份計畫會漏掉的東西。** 兩段在首頁上重疊 —— 首頁裝著選車器。

### 8.1 對同一檔案的交集

| 檔案 | D 段動什麼 | A 段動什麼 | 會不會撞 |
|---|---|---|---|
| `app/page.tsx` | 區塊順序、新增/移除 section、`Header currentPage="home"` | 不動 | ❌ 不撞 |
| `components/VehicleFinder.tsx` | **只動殼**:`.ed-finder` 在新 hero 下緣改成白色入口板 `b-dock`、編號撞號解掉 | **動內臟**:hint 字面、送出門檻 `ready`、chips 換 `GarageChips`、push 段數 | 🔴 **同檔會撞** |
| `styles/home.css`(777 行) | 整體重排、hero、磚牆、頁尾 | `.ed-finder-hint` / `.ed-finder-garage*` / `.ed-finder-suggest*`(L215、L697-740)退場或換 token | 🔴 **同檔會撞** |
| `components/Header.tsx` | 不動 | `navItems[1].href` 改 currentPage 條件式(`Header.tsx:98`) | ❌ 不撞(不同行),但⬇️ |
| `components/Header.test.tsx` | D4 要改 nav href 對照表(`/brands` 斷言) | A 要改同一張對照表(`依車輛搜尋` 那一列) | 🔴 **同一個 `expect(actual).toEqual([...])` 陣列,必撞** |
| `components/MobileTabBar.tsx` + `.test.tsx` | 不動 | 「找車」解除停用 | ❌ 不撞 |
| `components/GarageChips.tsx` | 不動 | 加 `onApply` 回呼 variant | ❌ 不撞 |
| `components/ProductsPage.tsx` | 不動 | 讀 `?pick=vehicle` 開燈 | ❌ 不撞 |

### 8.2 先後順序(定序,不是建議)

```
① A-nav（Header 條件 href + MobileTabBar 找車 + ?pick=vehicle 落地）   ← 先做,最小、與 D 幾乎不交集
② D1 → D2 → D3 → D4（品牌線,完全不碰首頁檔）                          ← 與 A 內臟片零交集,可與 ③ 並行分片但不同 commit
③ A-engine（選車器內臟統一:字面 + 兩個行為變更 + GarageChips 收斂）    ← 必須排在 D5 之前
④ D5 → D6 → D7（首頁重排,含 VehicleFinder 換殼）                       ← 吃 ③ 的成果,只動殼不動內臟；**D7 已於 08-05 由 0b 完成**
⑤ D8（Showcase 退場)                                                    ← 最後,依賴 D2 元件已上線
```

**為什麼 ③ 一定要在 ④ 之前:**

- A 段改的是 `VehicleFinder.tsx` 的**判斷邏輯**(`ready` 在 `:50`、hint 在 `:77`、push 在 `:143-159`),
  D 段改的是它的**外殼與定位**。先做殼、再做內臟,等於在一個剛被搬過家的檔案上做邏輯改動,
  兩次都要重讀同一段 —— 而且 A 段的 `vehicle-picker-spec.md` §1b 那三個 sessionStorage 鏡寫入點
  (`VehicleFinder.tsx:149`、`products-url-state.tsx:366-380`、`ProductFitmentCheck.tsx:118,167`)
  **一個都不能少**,先動殼會讓 diff 變大、審查者更難看出鏡有沒有被弄掉。
- 反過來(先 ③ 後 ④)只需要在 ④ 重新對一次 CSS class 名,成本低得多。

**`Header.test.tsx` 的處理**:那張 nav 對照表兩段都要改。定序 ① 先改「依車輛搜尋」那一列,
D4 落地時只改「品牌」那一列與 `/brands` 的否定斷言 —— **後做的那一片必須先 `git log -1` 確認 HEAD 是自己那筆**
(memory `feedback_concurrent-session-git-index-contamination`:並行 session 的 `--amend` 曾改到別人的 commit)。

### 8.3 ④ 開工前必須重驗的三件事

1. `styles/home.css` 的 `.ed-finder-*` 家族在 ③ 之後還剩哪些(A 段會讓 `.ed-finder-garage-chip` 退場、
   併進 `.cat-garage-chip` 家族 —— `vehicle-picker-design.html` §B 逐字)。
2. `VehicleFinder.tsx` 的行號全部作廢,重新 grep,**不得沿用本檔或 A 計畫裡的行號**。
3. 首頁 finder 的殼在設計稿是 **白底黑框 + 紅色送出鈕的 `b-dock`**
   (`vehicle-picker-design.html` C2 逐字註記:「前版示意誤畫深色底,已依 direction-b 定稿修正為白色」)
   —— 不要照更早的深色示意圖做。

---

## 9 · 🔴 停下等 Sean 拍板

```
背景:
鐵則 1 寫「design-reference/ submodule 是視覺真權威、storefront 對齊 design、不反向遷就」。
但這次的新設計住在 Open Design(~/Library/.../pcm-home-redesign/),不在 submodule 裡。
而且 submodule 裡那份 design-reference/components/HomePage.jsx 已被 Open Design 的 README
逐字判定為「過期的假稿,與真站不符(分類名、件數、區塊標題、品牌數量全都對不上)」,
brief 也叫我不要參考它。所以現在有兩份東西都自稱權威,我不能自己選。

實查補充:
- submodule 目前在 637dafc(heads/main),內容是 20 支 .jsx 元件庫 + styles + design-handoff。
- Open Design 那邊是 5 支獨立 HTML 原型 + 一支 102KB 的 brand-content-data.js,不是 .jsx 元件。
- brief 第 88-92 行原本規劃「把 artifact 拉進 design-reference/ → submodule commit → 才輪到 storefront」,
  但那是 08-01 寫的,當時設計還沒長成現在這樣。
- 我查過:DesignSync 工具只能同步 claude.ai 的 design-system 專案,搬不動這個 git submodule,
  所以 A 案的搬運是純手工複製 + submodule commit,沒有自動化。

Q1:這次接線,design 的真權威認哪一邊?
A) 先把 Open Design 的產出複製進 design-reference/ submodule、commit,再照鐵則 1 從 submodule grep 字面
   好:鐵則 1 一字不改;未來任何人打開 submodule 看到的就是現行設計,不會再撿到假稿
   壞:5 支 HTML 原型塞進一個 .jsx 元件庫,結構對不上;而且設計還在動時每改一次就要同步一次,
       同步落後那一刻起 submodule 又變成新的假稿

B) 本次接線的 design 真權威改認 Open Design 目錄,submodule 只留舊站對照,鐵則 1 補一條例外
   好:設計改了立刻生效、零同步延遲;OD 那邊本來就有 NEXT-STEPS/README/integration 三份交接檔
   壞:鐵則 1 被開了一個口,以後「權威在哪」要看是哪一條線;submodule 裡的假稿沒人清,
       下一個接手的人還是可能撿到它

A: A | B
```

**在 Q1 拍板前,D 段任何一片都不開工。** 拍 B 的話,我會順手在 `design-reference/components/HomePage.jsx`
檔頭加一行「本檔為過期假稿,現行首頁設計見 Open Design `pcm-home-redesign`」的註記(submodule 內一行 commit),
把「下一個人撿到假稿」這個壞處補掉。

---

## 10 · 相關既有紀錄與連動面(規劃前偵察 pass)

| 命中 | 內容 | 對本計畫的影響 |
|---|---|---|
| memory `project_storefront-home-redesign-0801-decisions` | 08-01 拍 Q1=B 重排版面 / Q2=A 走 Open Design;🔴 首屏零商業訊號、Hero 與選車器編號撞號;design 先定案 storefront 才對齊 | = 本計畫 §4 的來源 |
| backlog **#147** | `dev-preview/*` 屬開發臨時驗證頁、**M-6 前移除** | D8 可順手收掉 `dev-preview/brands` |
| backlog **#269** | 首頁殘餘死連結 `/install` `/stores` + `?filter=new|sale` | 首頁重排會**再次渲染**這些死連結;本計畫不修(需 Sean 批,見 §2),但 D5 commit body 要標 |
| backlog **#271** | 品牌形象區信任狀/徽章數字 L2 hardcode | D1 資料層繼承此條,需補指標 |
| backlog **#287 / #288** | `?pbrand=` 重複 key 與 Next segment 碰撞;E2E 守門未建 | §3 選 A 案的主要理由 |
| backlog **#205** | featured 首頁推薦機制 | D5 的 N°02 最新商品若改條件標題,會碰到 featured 來源 |
| `docs/specs/2026-07-25-site-wide-gap-and-admin-platform-plan.md:105` | Showcase 都標 L2、上線前確認對外數字真實(**廣告不實風險**) | D1/D5 的「20 家」「N 大品牌」數字必須真 |

---

## 11 · 開工前逐條自檢

- ☐ Sean 已回答 §9 Q1
- ☐ §3 路由案已定(推薦 A)
- ☐ A 段 ①(nav 小修)已落地(§8.2 定序)
- ☐ 每片標 L1/L2/L3(品牌內容 = L2 + backlog #271)與片型(標準片)
- ☐ 每片 15-45 分鐘可中斷(鐵則 4)、CSS+TSX 同片(鐵則 5)、元件 >400 行必拆(鐵則 6)
- ☐ 動 design 前 **grep 真權威字面**,不憑記憶、不畫預覽 HTML(鐵則 1)
- ☐ 每片三綠 + smoke test + 1440/390 實 render
- ☐ 精準 `git add`、不 push、不動 `STATUS.md` 與 `CURRENT.md`
