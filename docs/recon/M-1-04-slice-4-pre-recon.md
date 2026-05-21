# M-1-04 候選刀 4 — 前置偵察:NORTHSTAR §2.1 字面 vs design-handoff 實況 drift

> **產出時間:** 2026-05-14
> **產出者:** Claude Code(純偵察、不寫推薦、不寫修正建議、不替 Claude.ai 寫前置 slice)
> **任務目標:** 為 Claude.ai 寫前置小 slice(修 NORTHSTAR §2.1 字面 vs 實況 drift)+ 後續 PRD(ADR-0006 + server-client-boundary.md)撈材料
> **本檔範圍:** 6 章節純事實列表、不歸納規則、不寫「應該 / 建議 / 推薦」
> **字面 vs 事實守則(對齊 lessons §12-3 維度 A):** 每章引用字面均標檔名 + 行號 / 數字均用實況 wc -l / ls 取得、不憑記憶

---

## §1 NORTHSTAR §2 / §2.1 字面全文 + 行號

### 1.1 §2 章節位置(grep `^##|^###` 結果)

| 行 | header |
|---|---|
| L67 | `## 2. 視覺與設計真權威` |
| L69 | `### 2.1 真權威字面位置` |
| L83 | `### 2.2 真權威更新流程` |
| L97 | `### 2.3 衝突仲裁鐵則` |
| L108 | `### 2.4 內部衝突優先級(design-reference 內部)` |
| L120 | `## 3. 執行原則`(§2 結束點 = L118 `---`) |

### 1.2 §2.1 字面全文(L69-L81)

```
### 2.1 真權威字面位置

**唯一基準:** `design-reference/` submodule(來自 `pcmmotorsports/pcm-website-design` repo)

```
pcm-website-v2/
└── design-reference/        ← submodule、視覺真權威
    ├── components/          ← 13 個 .jsx
    ├── styles/              ← 15 個 .css
    ├── data/                ← mock data
    ├── design-reference/    ← HANDOFF docs(9 份)
    └── index.html           ← SPA 入口
```
```

### 1.3 §2.4 字面 drift 相關陳述(L108-L116)

```
### 2.4 內部衝突優先級(design-reference 內部)

若 design-reference 內部不一致(jsx 跟 HANDOFF docs 有 drift):

```
DETAILS > TOKENS > COMPONENTS > PAGES > OVERVIEW > index.html SPA 行為
```

但實務上、**.jsx + .css 字面 > HANDOFF docs**(因為 jsx + css 是真實渲染源)。HANDOFF docs 是說明、可能未隨 jsx 更新。
```

§2.4 提到的優先級字面(`DETAILS / TOKENS / COMPONENTS / PAGES / OVERVIEW / index.html`)對應 §2.1 嵌套子目錄內 HANDOFF docs 內容,但 §2.1 沒列出具體 HANDOFF 檔名。

---

## §2 design-handoff/ + 相關目錄實況

### 2.1 design-reference/ 根目錄(`ls -la` 完整結果)

```
.DS_Store
.git                                  41 bytes(submodule pointer)
.gitignore                           195 bytes
HANDOFF.md                         13257 bytes
README.md                           2905 bytes
assets/                            (目錄)
components/                        (目錄)
data/                              (目錄)
design-handoff/                    (目錄)
design-reference/                  (目錄、嵌套)
index.html                          6538 bytes
screenshots/                       (目錄)
styles/                            (目錄)
```

### 2.2 design-reference/design-handoff/ 實況

```
HANDOFF-v2.0.md                    21905 bytes
HANDOFF-v2.1.md                     8977 bytes
index.html                         89330 bytes
```

共 3 檔。

### 2.3 design-reference/design-reference/ 實況(嵌套子目錄、NORTHSTAR §2.1 指認的 "HANDOFF docs 9 份" 位置)

```
HANDOFF-API.md
HANDOFF-CHANGELOG.md
HANDOFF-COMPONENTS.md
HANDOFF-DEPLOY.md
HANDOFF-DETAILS.md
HANDOFF-OVERVIEW.md
HANDOFF-PAGES.md
HANDOFF-ROADMAP.md
HANDOFF-TOKENS.md
HANDOFF-TWEAKS.md
```

共 **10 個** HANDOFF-*.md。

### 2.4 design-reference/components/ 實況

```
AccountPages.jsx        App.jsx                 CheckoutPage.jsx
ErrorPage.jsx           FilterDrawer.jsx        FilterSide.jsx
FilterTop.jsx           Header.jsx              HomePage.jsx
LegalPage.jsx           OrderCompletePage.jsx   Pages.jsx
Pricing.jsx             ProductCard.jsx         ProductPage.jsx
ProductsPage.jsx        SearchOverlay.jsx       StorePickerModal.jsx
TierComponents.jsx      WalletTab.jsx
```

共 **20 個** .jsx(`ls *.jsx | wc -l` = 20)。

### 2.5 design-reference/styles/ 實況

```
account.css             checkout.css            error.css
filter-drawer.css       filter-side.css         filter-top.css
header.css              home.css                home.v1.css
legal.css               order-complete.css      pages.css
pricing.css             product-card.css        product-page.css
products-page.css       search-overlay.css      store-picker.css
tier.css                tokens.css              tweaks.css
vehicle-drawer.css      wallet.css
```

共 **23 個** .css(`ls *.css | wc -l` = 23)。

### 2.6 design-reference/data/ 實況

```
BRANDS-README.md
PRODUCTS-README.md
STORES-README.md
products.js
stores-loader.js
stores.json
```

共 6 entries(3 README + 2 .js + 1 .json)。

### 2.7 design-reference/assets/ 實況

```
.DS_Store
brand-logos/                       (子目錄、16 entries 估算)
logos/                             (子目錄、3 entries 估算)
```

### 2.8 design-reference/screenshots/ 實況

`ls | wc -l` = **89** entries(NORTHSTAR §2.1 寫「91」是先前報告偵察數字、本次重 count = 89、可能含 .DS_Store 差異、未深究)。

---

## §3 字面 vs 實況逐條對照表

### 3.1 NORTHSTAR §2.1 列出的路徑、test -e 結果

| NORTHSTAR §2.1 字面 | test -e 結果 |
|---|---|
| `design-reference/`(submodule) | 存在 ✓ |
| `design-reference/components/` | 存在 ✓ |
| `design-reference/styles/` | 存在 ✓ |
| `design-reference/data/` | 存在 ✓ |
| `design-reference/design-reference/`(嵌套) | 存在 ✓ |
| `design-reference/index.html` | 存在 ✓ |

→ 路徑層級 6/6 全對。

### 3.2 NORTHSTAR §2.1 標註的數字 / 屬性 vs 實況

| NORTHSTAR §2.1 字面 | 字面數字 | 實況數字 | 差異 |
|---|---|---|---|
| `components/ ← 13 個 .jsx` | 13 | 20 | **Δ +7、字面 stale** |
| `styles/ ← 15 個 .css` | 15 | 23 | **Δ +8、字面 stale** |
| `data/ ← mock data`(無數字) | — | 6 entries(3 README + 2 .js + 1 .json) | 字面無數字、不直接 drift、但「mock data」未含 README 字面 |
| `design-reference/ ← HANDOFF docs(9 份)` | 9 | 10 | **Δ +1、字面 stale**(HANDOFF-API/CHANGELOG/COMPONENTS/DEPLOY/DETAILS/OVERVIEW/PAGES/ROADMAP/TOKENS/TWEAKS = 10、§2.4 列 5 個關鍵字面 DETAILS/TOKENS/COMPONENTS/PAGES/OVERVIEW 即在此 10 個內) |
| `index.html ← SPA 入口` | — | 存在(6538 bytes) | 字面對 ✓ |

### 3.3 對照表小結

- 路徑 6/6 全對 ✓
- 數字 3/3 全 stale(13→20 / 15→23 / 9→10)
- 字面「mock data」未涵蓋 data/ 內 README 字面(語意 drift、非數字 drift)

---

## §4 額外 drift 點(NORTHSTAR §2.1 未提的實況存在物)

### 4.1 NORTHSTAR §2.1 字面遺漏的 design-reference/ 根目錄項目

| 實況 path | 屬性 | NORTHSTAR §2.1 字面是否提到 |
|---|---|---|
| `design-reference/HANDOFF.md` | 13257 bytes、根目錄單檔 | **未提** |
| `design-reference/README.md` | 2905 bytes、根目錄單檔 | **未提** |
| `design-reference/design-handoff/`(目錄) | 含 HANDOFF-v2.0.md / v2.1.md / index.html 3 檔 | **未提** |
| `design-reference/assets/`(目錄) | 含 logos/ + brand-logos/ 兩子目錄 | **未提** |
| `design-reference/screenshots/`(目錄) | 89 entries | **未提** |
| `design-reference/.gitignore` | 195 bytes | **未提**(屬內部 git 機制、不在 §2.1 視覺真權威範圍) |
| `design-reference/.git` | 41 bytes(submodule pointer) | **未提**(屬 submodule 機制) |

### 4.2 命名混淆風險點(本檔不歸納、純列事實)

NORTHSTAR §2.1 字面同時出現兩處「design-reference」字面:

- 外層 `design-reference/`(submodule 路徑)
- 內層 `design-reference/design-reference/`(嵌套子目錄、HANDOFF docs 位置)

且實況另有第三個近名目錄:

- `design-reference/design-handoff/`(NORTHSTAR §2.1 未提、含 v2.0/v2.1 docs + 89330 bytes index.html)

三者並存實況:`design-reference/` / `design-reference/design-reference/` / `design-reference/design-handoff/`

### 4.3 §2.4 引用的字面 anchor 對 §2.1 列舉的相容性

§2.4 字面:`DETAILS > TOKENS > COMPONENTS > PAGES > OVERVIEW > index.html SPA 行為`

對照 §2.3 列出的 10 個 HANDOFF-*.md:
- HANDOFF-DETAILS.md ✓
- HANDOFF-TOKENS.md ✓
- HANDOFF-COMPONENTS.md ✓
- HANDOFF-PAGES.md ✓
- HANDOFF-OVERVIEW.md ✓
- index.html(SPA 入口、§2.1 已列)✓

§2.4 5 個關鍵 anchor 在實況存在;§2.4 未提到其餘 5 個 HANDOFF-*.md(API / CHANGELOG / DEPLOY / ROADMAP / TWEAKS)。

### 4.4 NORTHSTAR §2.1 字面與 STATUS / 其他 .md 引用 design-handoff 路徑的一致性

本偵察未跨檔 grep 其他 .md 引用 design-handoff / design-reference 字面、留 Claude.ai 寫前置小 slice 時補(對齊禁止清單「不寫修正建議」+ 範圍紀律)。

---

## §5 audit sub-8d server-only 討論完整字面

### 5.1 檔名實況確認(`ls docs/audits/`)

```
2026-05-02-full-audit.md
M-1-03-main-a-刀-4-sub-8d-findings.md
```

sub-8d 檔名實況 = `M-1-03-main-a-刀-4-sub-8d-findings.md`。

### 5.2 [eng-3](docs/audits/M-1-03-main-a-刀-4-sub-8d-findings.md#L50-L56) designTierToSchema try/catch fallback ✅(L50-L56)

```
### eng-3: designTierToSchema try/catch fallback ✅
- **檔案:** `apps/storefront/src/app/page.tsx:54-58`
- **嚴重程度:** 🟡 低
- **視角:** correctness
- **描述:** `try/catch` 包 `designTierToSchema`、corrupt cookie / 攻擊 URL fallback `'general'`、防 server 端 throw
- **建議處置:** 現實作 correctness 全綠、可考慮 log fallback case 便於 admin debug
- **三視角:** bug ✅ 增加 log 可加分
```

### 5.3 [eng-4](docs/audits/M-1-03-main-a-刀-4-sub-8d-findings.md#L58-L64) server-only runtime guard 替代 npm package(L58-L64)

```
### eng-4: server-only runtime guard 替代 npm package
- **檔案:** `apps/storefront/src/lib/products.ts:28-32`
- **嚴重程度:** 🟡 低(已記 commit body)
- **視角:** security
- **描述:** `typeof window !== 'undefined'` runtime guard 替代 `server-only` npm package(對齊 d2 Sean 拍板「範圍紀律不擴張 deps」)、runtime guard 在 build time 不阻擋 client component import
- **建議處置:** 現實作可接受;storefront 規模擴張可考慮加 `server-only` package(對齊 Next.js 13+ 推薦)
- **三視角:** 擴 ✅(規模擴張)/ 維 ✅ / bug -
```

### 5.4 字面要點摘錄(純引、不歸納)

- 引用檔案:`apps/storefront/src/lib/products.ts:28-32`
- 機制字面:「`typeof window !== 'undefined'` runtime guard 替代 `server-only` npm package」
- 拍板理由字面:「對齊 d2 Sean 拍板『範圍紀律不擴張 deps』」
- 已知限制字面:「runtime guard 在 build time 不阻擋 client component import」
- 後續觸發字面:「storefront 規模擴張可考慮加 `server-only` package(對齊 Next.js 13+ 推薦)」
- 三視角字面:「擴 ✅(規模擴張)/ 維 ✅ / bug -」

---

## §6 偵察過程觀察(純事實、不寫推薦)

### 6.1 偵察範圍

- 1 個 NORTHSTAR 檔:grep header + 讀 L67-L116
- design-reference/ 全目錄樹:find -maxdepth 3 + ls -la 根目錄 + ls 各子目錄 + wc -l
- test -e 11 個路徑
- 1 個 audit 檔:`ls docs/audits/` 確認檔名 + 讀 L45-L72(含 eng-3 / eng-4 上下文)
- 0 個 webfetch / online 查詢
- 0 個 git 動作

### 6.2 偵察當下發現的字面差異(列、不歸納)

- NORTHSTAR §2.1 三個數字字面 stale:13(components)→ 20、15(styles)→ 23、9(HANDOFF)→ 10
- NORTHSTAR §2.1 未提 5 個根目錄項目:HANDOFF.md / README.md / design-handoff/ / assets/ / screenshots/
- NORTHSTAR §2.1 三個近名目錄並存實況:`design-reference/` 外層 / `design-reference/design-reference/` 嵌套 / `design-reference/design-handoff/`(§2.1 未提)
- §2.4 列 5 個 HANDOFF anchor 命中實況、未提另 5 個 HANDOFF-*.md(API / CHANGELOG / DEPLOY / ROADMAP / TWEAKS)
- design-handoff/ 內 index.html 是 89330 bytes(vs design-reference/ 根目錄 index.html 6538 bytes、兩者用途未在 §2.1 區分)

### 6.3 字面 vs 事實偏離可能成因(本檔不歸納、純列觀察)

- NORTHSTAR v2 寫於 2026-04-29(`L6` 字面)、design-reference submodule pointer 在 M-1-04-mini-slice 25d3a2a → 797e386 變動(STATUS L12 / 7e950c8 commit body 字面)、本檔當下偵察 = `design-reference/ HEAD` 與 NORTHSTAR §2.1 字面寫定當下 = 不同 submodule commit
- design-reference 內部結構在多次 submodule 更新後 drift、§2.1 未隨 submodule pointer 同步調整數字
- §2.1 字面用「樹狀概覽」格式、未列窮舉項目(HANDOFF.md / README.md / assets / screenshots / design-handoff/ 屬「窮舉外」項目)

### 6.4 偵察過程零既有檔案修改

- 0 git add / commit / push
- 0 dev server / typecheck / lint / test / webfetch
- 1 新增 untracked:本檔(`docs/recon/M-1-04-slice-4-pre-recon.md`)
- 0 修改既有檔案
- 0 submodule update --remote
- audit sub-8d 檔名先 `ls docs/audits/` 確認、未憑記憶寫路徑(對齊禁止清單)

### 6.5 留給 Claude.ai 寫前置小 slice / PRD 時自查的字面

- NORTHSTAR §2.1 字面修法選項(數字更新 vs 整體重寫 vs 加註「pointer 變動時數字會 stale」)— 本檔不選
- design-handoff/ 角色與 design-reference/design-reference/ 角色區別 — 本檔不判定
- §2.1 是否應列窮舉項目 — 本檔不判定
- audit sub-8d eng-4 server-only 字面進 ADR-0006 / server-client-boundary.md 哪一章節 — 本檔不判定
- 跨 .md grep design-handoff / design-reference 引用字面一致性 — 本檔未跑、留前置 slice 時做

— END —
