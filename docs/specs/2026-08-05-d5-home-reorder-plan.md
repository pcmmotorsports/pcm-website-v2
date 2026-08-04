# D5 · 首頁區塊重排 — 施工計畫(鐵則 8,等批准)

> 2026-08-05 開立 · 視窗 C(home-redesign)· worktree 已 `merge --ff-only origin/dev` 對齊 `33b0c22`
> **本檔只是計畫,零 code 異動。**
> 母計畫 = `docs/specs/2026-08-03-storefront-home-brand-page-wire-plan.md`(§4 區塊對照表 / §6 測試表 /
> §7 R3「**一片一個 section**」/ §8.2 定序 / §8.3 開工前三重驗)
> 區塊順序權威 = OD `pcm-home-redesign/README.md`「區塊順序(第 7 步之後)」+「配色的三條規則」
> 版型權威 = OD `direction-b-layout-01-graphite-ember.html`

---

## 0 · 一句話

**順序與底色先到位,內容重寫按 section 逐片跟上。** D5 不碰 hero(D6)、不碰頁尾(D7)、不碰選車內臟(A 段已結)。

---

## 1 · §8.3 開工前三重驗(已跑,結果如下)

| # | 要驗什麼 | 實查結果 |
|---|---|---|
| 1 | A 之後 `.ed-finder-*` 還剩哪些 | 剝註解後**剩 10 個**:`.ed-finder` / `-bar` / `-go` / `-go-arrow` / `-head` / `-hint` / `-inner` / `-label` / `-slot` / `-slot-label`。`-garage` / `-garage-chip` / `-suggest` **只存在於註解**(A10a 已退場) |
| 2 | `VehicleFinder.tsx` 行號全部重 grep | 檔案現 **133 行**;`ready`=`:49`、hint=`:61`、`<section>`=`:52`、鏡寫=`:113`、push=`:124`。**母計畫與 A 計畫裡的行號(:50/:77/:143-159)全部作廢** |
| 3 | finder 殼是白底 b-dock | ✅ 現況 `home.css:189-193` `.ed-finder { background: var(--ed-c-paper) }`=白,與設計稿 C2「白底黑框」一致。**不要照更早的深色示意圖做** |

---

## 2 · 目標順序 vs 現況(逐一對照)

現況 `app/page.tsx:106-113`:

```
Hero(深 #0a0a0a) → VehicleFinder(白) → FeatureEditorial(白) → CategoryGrid(白)
→ HomeSelect(白) → HomeStatement(深 #0a0a0a) → BrandIndex(白) → HomeFooter(深 #0a0a0a)
```

README 定案:

| | 區塊 | 元件 | 底色 | 與現況差異 |
|---|---|---|---|---|
| N°01 | Hero + 選車器 | `HomeHero` + `VehicleFinder` | 照片(深) | 位置不動(hero 重寫=**D6**) |
| N°02 | 最新商品 | `HomeSelect` | 白 | **上移**(現在第 5) |
| N°03 | 部品分類 | `CategoryGrid` | 白 | 位置微調 |
| N°04 | 服務宣言 | `HomeStatement` | **石墨 `#202225`** | 現為 `#0a0a0a` ⇒ 換色 |
| N°05 | 本月聚焦 | `FeatureEditorial` | 白 | **下移**(現在第 3) |
| N°06 | 授權代理 | `BrandIndex` | **淺灰白 `--ed-c-paper-2`** | 現為白 ⇒ 換色 |
| — | 頁尾 | `HomeFooter` | 石墨 `#202225` | **D7 做**,本片不碰 |

⇒ 節奏 **白/白/深/白/淺灰白/深**,無兩塊深色相鄰。
**實際的順序動作只有兩個**:`FeatureEditorial` 由第 3 移到第 6、`HomeSelect` 由第 5 移到第 3。

🔴 **沒有任何測試鎖住這 9 個元件的渲染順序**(實查:`app/` 下查無 `page.test.tsx`)
⇒ 重排本身**改了不會紅**。D5a 必須自帶順序守門,否則這一片等於沒有驗收面。

---

## 3 · 切片(照母計畫 §7 R3「一片一個 section」)

| 片 | 內容 | 檔案 | 估時 | 依賴 |
|---|---|---|---|---|
| **D5a** | 區塊重排 + 兩處底色(N°04 石墨 / N°06 淺灰白)+ **新增順序守門** | `app/page.tsx`、`styles/home.css`、新 `app/page.test.tsx` | 30 分 | — |
| **D5b** | N°02 最新商品:區塊編號 + **條件標題**(已登入且已設愛車才換字) | `HomeSelect.tsx` + test + `page.tsx` 傳 `garage` | 40 分 | D5a |
| **D5c** | N°03 部品分類:8 格 → 12 格 + 第 12 格「全部分類」+ 分類色碼**綁 id** | `CategoryGrid.tsx` + CSS + test | 40 分 | D5a、**Q3** |
| **D5d** | N°04 服務宣言:品牌家數字面對齊 | `HomeStatement.tsx` + test | 15 分 | D5a、**Q1** |
| **D5e** | N°05 本月聚焦:硬編單一品牌 → 資料驅動輪播 | `FeatureEditorial.tsx` + 資料層 + test | 45 分+ | D5a、**Q4** |
| **D5f** | N°06 授權代理:純文字牆 → 20 家 logo 磚牆 | `BrandIndex.tsx` + CSS + test | 45 分 | D5a、**Q5** |

**D5a 可以立刻開工**(零決策依賴)。D5c/D5d/D5e/D5f 各自卡一題,見 §5。

---

## 4 · 各片的實查事實(母計畫與現況對不上的地方)

🔴 母計畫 §4 表裡有幾條與現況不符,**照著做會出錯**:

1. **`CategoryGrid` 現在是 8 格不是 12**(`CategoryGrid.tsx:31` `HOME_GRID_MAX = 8`),
   而且**現在完全沒有「色碼」邏輯** —— 唯一的裝飾是 `DECOR_IMAGES[i % length]`(`:55`),
   綁的是**陣列位置**。README「色碼綁分類 id」是要**新建**的東西,不是「把現有的改掉」。
2. **頁尾不是 `© 2026`,是 `© MMXXVI`**(羅馬數字,`HomeFooter.tsx:76`)。
   母計畫 §4 寫「`© 2026` 改 `new Date().getFullYear()`」—— 那個字面在 repo 裡**不存在**。
   直接套 `getFullYear()` 會把羅馬數字變成阿拉伯數字 = **視覺變更**。(此項屬 D7,先記著。)
3. **`HomeSelect` 沒有任何「依愛車換標題」邏輯**(props 只有 `featured`),
   也**沒收 `garage`** ⇒ D5b 要從 `page.tsx` 往下傳,不是改字面而已。
4. **`FeatureEditorial` 是硬編 RIZOMA**(`:20,44`),三組 fact 是「標籤+值」**兩欄**(`:31-41`),
   沒有 README 要求的第三欄「說明句」⇒ D5e 是新資料結構,不是改文案。
5. **`MOCK_BRANDS` 實為 17 筆**(`data/mock-brands.ts:19-37`),而設計是 20 家 ⇒ D5f 要換資料源。
   `fetchBrandsWithProducts`(`lib/brand-products.ts:64-67`,回 `ReadonlySet<string>`)已備好,
   D3c 系列在用(`app/brands/page.tsx:26` 等),**沿用同一把尺**(5 家泛白)。
6. **20 家 logo 資產齊備**:`public/brand-assets/assets/brands-dark/` 19 檔 + `brands/samco.png` 1 檔
   =20;另有 `brands-trim/` 20 檔。samco 用非深色版是 20 家唯一例外(已知、刻意)。

---

## 5 · 🔴 停下等 Sean 拍板(五題)

### Q1 —— 這題是**事實題**,不是文案題(母計畫 §10 標「廣告不實風險」)

`HomeStatement.tsx:23` 現在寫「**8 大品牌正式代理**」。品牌牆要放 20 家。
但「有品牌介紹頁的 20 家」**不等於**「正式代理的家數」。母計畫 §10 引
`2026-07-25-site-wide-gap-and-admin-platform-plan.md:105`:對外數字必須真,否則是廣告不實。
**我無法從 repo 判斷真實的正式代理家數** —— 這個數字只有 Sean 知道。

```
Q1:首頁「N 大品牌正式代理」這句話,數字要寫多少?
A) 告訴我真實家數 N,我照填(最準,但你要給數字)
B) 改成不報數(例:「原廠正式代理,每件附序號與保固卡」)——
   好:零廣告不實風險、以後增減品牌不用回頭改字
   壞:少一個賣點數字
C) 維持「8 大」不動,這一片只做底色與位置
A: 請給數字 | B | C
```

### Q2 —— 品牌牆 logo 用哪一套(淺底)

N°06 底色是**淺灰白**,但資產有兩套:`brands-dark/`(深色版)與 `brands-trim/`(去背原色)。
README 第 8 步記載「品牌牆 08-02 因**原色 logo 可讀性**改淺場」⇒ 讀起來是要用原色版,
但資料夾名字叫 `brands-dark` 的那套有 19 檔、`brands-trim` 有 20 檔,兩套的用途我不敢憑檔名斷定。

```
Q2:淺灰白底的品牌牆,logo 用哪一套?
A) brands-trim(去背原色,20 檔齊)
B) brands-dark(深色版,19 檔 + samco 走 brands/)
C) 你先看一眼兩套的實際樣子再決定(我可以先做 D5a,這片押後)
A: A | B | C
```

### Q3 —— 分類 12 格,真資料夠嗎

現在 8 格。README「還沒做的」自陳:**分類第 9–11 名的真名稱與件數仍是即時資料槽、沒有靜態值**。
⇒ 12 格裡有 3 格在設計稿裡本來就是空槽。真站分類數我**沒有實測**(要連 DB)。

```
Q3:部品分類要幾格?
A) 照設計做 12 格(第 12 格固定「全部分類」→ /products),真分類不足就少畫幾格
B) 維持 8 格,只做位置與底色(把 12 格留到有足夠真分類再說)
C) 先讓我實測真站到底有幾個分類,再回來問你
A: A | B | C
```

### Q4 —— 本月聚焦的輪播機制

README:20 家全部預設做好、**每 3 天輪播**、每筆 fact 三欄位都要用。
現況是硬編 RIZOMA、兩欄位。這片牽涉:資料來源(要不要接 `brand-content-data.js`)、
輪播是誰決定當期(build 時?ISR?還是純 CSS/client?)、以及 20 家 × 3 欄位的文案從哪來。

```
Q4:「本月聚焦」這一片怎麼做?
A) 完整做:20 家資料 + 每 3 天自動輪播(要先確認 20 家的文案來源,估計不只 45 分鐘、會再拆)
B) 只做位置與底色,內容維持現在的 RIZOMA 硬編,輪播另開一片排期
C) 折衷:接資料驅動但當期先固定(不做時間輪播),之後再加輪播
A: A | B | C
```

### Q5 —— 條件標題的「愛車」判準

README 逐字:條件 = **已登入且已設定愛車**(只登入沒設車**不換**)。
現況 `HomeSelect` 收不到 garage。我照 README 實作即可,但想確認一件事:

```
Q5:首頁「最新商品」的標題,在客人有設定愛車時要換成什麼字?
A) 你給我確切字面
B) 照設計稿 direction-b 的字面(我去抓,抓到什麼用什麼)
A: 請給字面 | B
```

---

## 6 · 風險與 rollback

| # | 風險 | 對策 | rollback |
|---|---|---|---|
| R1 | **重排改了不會紅**(查無 `page.test.tsx`) | D5a 自帶順序守門(斷言 9 個 section 的 DOM 出現順序),並突變驗證 | 單片 revert |
| R2 | 底色改 `#0a0a0a`→`#202225` 是**視覺變更**,jsdom 看不到 | CSS 文字層守門(比照 `home.test.ts` 既有慣例)+ **真瀏覽器量 computed 值** | 單片 revert |
| R3 | 移動 section 順序時把 props 接線弄丟 | `page.tsx` 的 props 來自同一個 `Promise.all` 解構,移動 JSX 不影響;typecheck 會擋 | — |
| R4 | D5f 換資料源後**首頁與 /brands 兩處泛白判準分家** | 沿用 `fetchBrandsWithProducts` 同一把尺(D3c 已在用),不另建名單 | — |
| R5 | backlog **#269** 首頁殘餘死連結(`/install` `/stores`)會被再次渲染 | 本片不修(需 Sean 批),**commit body 要標**(母計畫 §10 要求) | — |
| R6 | 母計畫 §4 有四條與現況不符(見 §4) | 已逐條實查並在本檔更正;**實作時以本檔為準、不照母計畫的舊字面** | — |

### 片型與鐵則
- **標準片**(母計畫 §7 逐字):不碰錢/權限/schema/平台設定/`packages/ui` ⇒ **鐵則 12 不觸發**、
  `code-reviewer` 必跑、關卡2 走 code-reviewer。
- **鐵則 8**:本檔即為 plan,等批。
- **鐵則 4**:每片 15-45 分鐘;D5e 自評會超 ⇒ 已在 Q4 提出拆分選項。
- **鐵則 11**:每片三綠 + 動 `.tsx` 加 build;動共用元件跑完整 `pnpm test`。

### 驗收
- 每片 `/slice-checkpoint`;完整 `pnpm test`(接手基準 = 350 檔 4724 綠 + 1 todo)。
- **真瀏覽器**:D5a 收工必量兩件 —— ①9 個 section 的實際 DOM 順序 ②三處底色的 computed 值
  (1440 + 390 兩斷點;production build;**先斷言 `innerWidth` 再量**,A-engine 那次差點量錯)。
- **不 push**。

---

## 7 · 相關既有紀錄與連動面(偵察 pass 命中)

| 命中 | 內容 | 影響 |
|---|---|---|
| backlog **#269** | 首頁殘餘死連結 `/install` `/stores` + `?filter=new\|sale` | 重排會再次渲染;本片不修、commit body 標 |
| backlog **#205** | featured 首頁推薦機制 | D5b 條件標題會碰到 featured 來源 |
| `MOCK_BRANDS` 過期債 | 真目錄 3 家不在首頁 17 家(主視窗 C-70-A 點名) | D5f 收掉:改吃 `fetchBrandsWithProducts` |
| `home.css:818` | finder placeholder 與已填值同色(A-engine 遺留、在 Sean 肉眼驗清單) | D5 不動 finder 內臟,但**若 Sean 要改,併進 D5a 最省** |
| memory `feedback_ui-count-change-check-hardcoded-css-track-counts` | 改格數先查 CSS 硬編碼軌道數 | **D5c 開工第一件事**:grep `.ed-cats` 的 grid-template-columns |
| memory `reference_agent-browser-cli-real-browser-verify` | 動前台 TSX/CSS 收工前必真瀏覽器驗 | §6 驗收 |

---

## 8 · 開工前逐條自檢

- ☐ Sean 已答 Q1–Q5(**Q1 是事實題、不可由我代填**)
- ☐ 行號全部重新 grep(本檔行號 = 2026-08-05 快照)
- ☐ D5a 的順序守門先寫、先確認它會紅,再改順序
- ☐ 改格數前先 grep CSS 硬編碼軌道數(memory 教訓)
- ☐ 每片標片型(標準片)、估時 15-45 分鐘,超出就拆
- ☐ commit body 標 backlog #269 死連結仍在
- ☐ 精準 `git add`、不 push、不動 `STATUS.md` 與 `CURRENT.md`
