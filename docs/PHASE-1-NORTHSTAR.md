# PCM Phase 1 北極星(Phase 1 NORTHSTAR)v2

> **讀者:** 新 Claude Code(從零進入此 repo、無上下文)
> **作者:** Claude.ai(基於 Sean 2026-04-29 拍板「整個重做」+ 第一輪 04-22 北極星精煉)
> **目的:** Phase 1 的範圍邊界、真權威定義、執行原則
> **狀態:** v2 / 2026-04-29 / 重做專案版本
>
> 衝突仲裁:STATUS.md > 本檔 > 其他 md > 對話歷史
>
> 配合閱讀:`STATUS.md`(當前狀態)、`docs/PROJECT-OVERVIEW.md`(整體 PCM 介紹)、`docs/PHASE-2-VISION.md`(9 點業務藍圖、Phase 1 不做的部分)、`docs/lessons-learned.md`(踩過的坑)

---

## 0. v1 → v2 變更說明

第一輪 v1 北極星(2026-04-24 寫)定義 Phase 1 = 「editorial 全站前台完整上線、五個 milestone(M-α/β/γ/δ/ε)」、走「縫合 design 進既有 storefront」路線。

**2026-04-29 Sean 拍板整個重做、新 repo `pcm-website-v2` 從零、舊 repo `pcmmotorsports/pcm-website` 凍結保留。** v2 北極星因此重寫:

| 項目 | v1(舊、已退役) | v2(本檔、生效) |
|---|---|---|
| 範圍 | editorial 全站前台 | design 直接搬 + 對應後台、前後台同步 |
| 路線 | 縫合 design 進既有 storefront | 新 repo 從零、design 是真權威、後台對應 design |
| Milestone | M-α / β / γ / δ / ε(全部作廢) | 待 design 完整偵察後重排(`docs/PHASE-1-MILESTONES.md`) |
| 真權威 | design-reference 文件夾 | design-reference submodule(同源、用法升級) |
| 工作流 | 前台先做、後台之後補 | 每個 slice 動前台 → 補對應後台 → 肉眼驗 → 修連動 |

---

## 1. Phase 1 範圍(明確列出)

### 1.1 要做的

**前台(`apps/storefront`):**
- design-reference 全部頁面直接搬進 storefront
- 路由結構對齊 design SPA 路由
- 共用元件抽 `packages/ui`(只在 design 真的需要共用時)
- SEO + structured data + sitemap day 1 起就建

**後台(`apps/api`):**
- Medusa v2 重新規劃、schema 對應 design 已定義的資料結構
- product / order / customer / cart 完整、含 metadata 欄位
- 三級會員(general / store / premium_store)tier 機制
- 儲值金 ledger 基本功能(加值 / 扣款 / 退款 / 餘額查詢)
- 依 0002 ADR、後台 admin 由 `apps/admin` Next.js 寫、用 `@pcm/ui` design tokens 自組、不用 Medusa Admin 內建 UI(0001 ADR §4「Phase 1 不寫客製 admin」已被 0002 ADR 推翻)

**共用(`packages/`):**
- `packages/ui`(@pcm/ui)— design tokens + 共用元件 + Storybook
- `packages/schemas` — 共用 TypeScript / Zod 型別(前後台合約)

**部署:**
- Vercel(前台)+ Railway(後台)
- TapPay sandbox 串接

### 1.2 不做的(Phase 2 做)

- 9 大業務藍圖(車輛履歷、店家端、預約、保養提醒等)詳見 `docs/PHASE-2-VISION.md`
- Excel 大量上架 / 爬蟲同步(用 Medusa Admin 單筆建立)
- Admin UI 客製化(用內建)
- 真實環境 TapPay(sandbox 即可)
- 自訂網域綁定(Phase 1 跑 Vercel preview URL 即可)
- Cloudflare 前置盾(Phase 2 或之後)
- E2E 測試套件(留 Phase 2、Phase 1 靠肉眼 + 簡單 unit test)

---

## 2. 視覺與設計真權威

### 2.1-a 🔴 真權威**不只** `design-reference` —— 先解析,再動工(2026-08-16 新增)

> **這一段的存在理由**:本節是 `CLAUDE.md` 路由表欽定的「找 design 真權威」那份檔,
> 而它**全檔對 Open Design 的提及 = 0**(正向對照 `grep -c 'design-reference'` ⇒ **14**)
> ⇒ **被路由指過去的那份檔,自己漂了。**

**任何會被人看到的產出物**(前台頁面 / 後台 UI / 列印單據 / 信件模板)**動工前先解析真權威**:

```
OD list_projects   ← 當場列出全部設計專案（不要照抄任何清單）
grep design-reference
```

🔴 **查法取代清單** —— **清單會過期,查法不會。**
📎 實錘:主視窗原本要把 OD 專案清單直接寫進 `CLAUDE.md` 鐵則 1,
而 F 窗**當場跑了一次 `list_projects` ⇒ 現場 9 個,主視窗列的 4 個在提出當下就已經過期。**

**查無** ⇒「查無」寫進 plan **並附掃過的分母**;**拿不準哪個是權威** ⇒ 問 Sean。

#### 2026-08-16 當下的快照(⚠️ **引用前重跑 `list_projects`,本表只是那一刻的樣子**)

| 面 | 設計真權威 | 備註 |
|---|---|---|
| 前台首頁改版 + 選車統一線 | OD `pcm-home-redesign` | ~~原寫在 `CLAUDE.md` 鐵則 1 的例外,2026-08-16 搬來此處~~ |
| 後台 UI | OD `pcm-admin-order-ui` 等;BMW M 設計語言見 `docs/design/admin-design-system.md` | 該檔**檔頭「落地狀態」表**決定能不能直接照抄 |
| **列印單據** | OD `pcm-print-docs` | ⚠️ **Sean 2026-08-16 出示樣張;正式拍板未確認,缺的檢查 = Sean 一句話**(F 窗標的誠實缺口,**不要抹掉**) |
| 其餘 | `design-reference/` submodule(見 §2.1) | |

⚠️ **`components/HomePage.jsx`(submodule 內)為過期假稿、不得引用。**

### 2.1 真權威字面位置

**唯一基準:** ~~`design-reference/` submodule~~ **見 §2.1-a —— 它不是唯一基準,是其中一個**
`design-reference/` submodule(來自 `pcmmotorsports/pcm-website-design` repo)

```
pcm-website-v2/
└── design-reference/        ← submodule、視覺真權威
    ├── components/          ← 20 個 .jsx
    ├── styles/              ← 23 個 .css
    ├── data/                ← mock data
    ├── design-reference/    ← HANDOFF docs(10 份)
    ├── design-handoff/      ← HANDOFF v2.0 / v2.1 + index.html(3 檔)
    ├── assets/              ← logos / brand-logos
    ├── screenshots/         ← 89 entries
    ├── HANDOFF.md           ← 根目錄單檔
    ├── README.md            ← 根目錄
    └── index.html           ← SPA 入口
```

⚠️ 嵌套 `design-reference/design-reference/` 是 design submodule 內部結構、勿與外層 `design-reference/` 混淆。

※ 字面以最後對齊 commit 為準、實況以 `ls design-reference/` + `ls design-reference/design-reference/` 為準。drift 出現時、以實況為準、本字面 follow up。

### 2.2 真權威更新流程

```
Sean 在 Claude Design 改設計
        ↓
Sean push 到 pcm-website-design GitHub repo
        ↓
你跑 `git submodule update --remote design-reference/`
        ↓
你 git diff 確認改動
        ↓
你直接搬新內容進 storefront
```

### 2.3 衝突仲裁鐵則

**storefront 與 design 衝突時、storefront 對齊 design、不反向遷就。**

例外只有以下三類:
1. **業務邏輯**(訂單流程、權限、價格、Medusa schema)— 走 `docs/decisions/`
2. **技術實作**(Next.js routing 規範、TypeScript 型別)— 不影響視覺、按工程選擇
3. **Phase 1 範圍外**(9 大藍圖功能)— design 若有相關 UI、Phase 1 不做、留 Phase 2

視覺、結構、路由、元件命名一律 design 為準。

### 2.4 內部衝突優先級(design-reference 內部)

若 design-reference 內部不一致(jsx 跟 HANDOFF docs 有 drift):

```
DETAILS > TOKENS > COMPONENTS > PAGES > OVERVIEW > index.html SPA 行為
```

但實務上、**.jsx + .css 字面 > HANDOFF docs**(因為 jsx + css 是真實渲染源)。HANDOFF docs 是說明、可能未隨 jsx 更新。

其餘 HANDOFF docs(無優先序、補列以對齊實況):

```
API / CHANGELOG / DEPLOY / ROADMAP / TWEAKS
```

---

## 3. 執行原則

### 3.1 直接搬、不翻譯

**正確:**
```
design 的 ProductsPage.jsx → cp 到 apps/storefront/src/components/ProductsPage.tsx
                          → 改副檔名 + import path + TS 型別
                          → 用
```

**錯誤(第一輪卡這裡、新 project 嚴禁):**
```
讀 design ProductsPage.jsx → 看結構 → 用 Tailwind 重寫一份「自己的風格」
```

slice 指令禁用「翻譯 / 對齊 / 重寫」字眼、預設「直接搬」。

### 3.2 後台對應 design

Medusa schema 設計**對應** design 已定義的資料結構、不是讓 design 配合既有 schema。

design `data/products.js` mock 是合約、Medusa 實作合約。例如:

```
design products mock:
  { id, brand, name, fits, price, images[], category, ... }

→ Medusa product 對應:
  - 標準欄位用 product.title / product.handle / product.thumbnail
  - design 特有欄位用 metadata.fits / metadata.fitment_type
  - variants 對應 design 的 variant 結構
```

### 3.3 前後台同步、不分階段

每個 slice 順序:

```
動前台(對齊 design 真權威)
   ↓
補對應後台(Medusa schema / API / Admin)
   ↓
肉眼驗 + 操作驗
   ↓
修連動細節
   ↓
commit
```

**不允許「前台先全做、後台之後補」**(這是第一輪錯誤、導致前後台 schema 不對齊、修起來痛苦)。

### 3.4 slice 切割原則

每個 slice 15-45 分鐘可中斷、單一 commit 體積小、Sean 可肉眼驗。

**slice 範圍指引:**
- 一個元件 + 對應 CSS = 一個 slice(雙檔聯動單一 slice 不拆)
- 一個頁面 + 對應後台 endpoint = 一個 slice(若範圍小)
- 若一個頁面太大、拆成「結構」+「資料接入」+「互動細節」三個 slice

### 3.5 內容分級 L1 / L2 / L3 強制前置

任何 slice 前先標記涉及內容是哪一級:

| 級別 | 變更頻率 | 處置 |
|---|---|---|
| L1 | 每年 0-1 次 | hardcode 可接受 |
| L2 | 每季 1-3 次 | hardcode + TODO + backlog |
| L3 | 每週多次 | **必須**後台 CRUD + 排程、強制停 slice 寫 PRD |

發現 L3 內容 → 立即停、不繼續、寫 PRD 後再動。

---

## 4. 工作流檢查點

### 4.1 每次新 Claude Code session 起手

```bash
cd /Users/sean_1/pcm-website-v2
git branch --show-current      # 預期: dev
git status                      # 預期: clean + up to date
git log --oneline -5            # 確認 HEAD 與 STATUS.md 一致
```

任一不綠 → 停下回報、不自排除狀態。

### 4.2 每個 slice 結束

```
1. 肉眼驗(前台啟動、操作流程跑一遍)
2. typecheck + lint 通過
3. 精準 git add(不用 git add . / -A)
4. commit(訊息: type(scope): subject)
5. 跑 busboy-end 自動更新 STATUS.md
6. 不 push(Sean 手動推當 review checkpoint)
```

### 4.3 重大改動前先提 plan

「重大」定義:
- 跨 3 個以上檔案
- 動 schema / API / 共用元件
- 動 next.config / vercel.json / Medusa config
- 影響部署或資料遷移

Plan 內容:
- 要改什麼、為什麼
- 預期影響面
- rollback 方式

Sean 批准後才執行。

---

## 5. 上線就緒判斷(Phase 1 結束條件)

Phase 1 結束 = 對外開放公測、員工切換到新版 admin 工作。

**checklist 詳見舊 repo `docs/phase-1-backlog.md` #33**(新 repo 啟動時搬進來、依重做版本調整)。

關鍵硬規則:
- 前台關鍵流程(瀏覽 / 加購物車 / 結帳 / 會員中心)在 375px / 1920px 都能跑完
- 後台關鍵動作(改訂單狀態 / 加物流單號 / 改備註)員工跑通
- TapPay sandbox happy path 至少跑通一次
- 前台 SEO + structured data 各頁完整
- 至少一週連續 build / lint / typecheck 三綠

### 🔴 上線當天必做:repo 轉 private **＋同時**設定 Actions spending limit(2026-08-16 Sean 裁【丙】)

```
☐ 把 pcmmotorsports/pcm-website-v2 從 public 改成 private
☐ 【同一時間】把 GitHub Actions 的 spending limit 從預設 $0 調高
   —— 這兩件是【一件事】，分開做會出事，原因見下
☐ 把 main 納入分支保護（見下方「🔴 陷阱」，不要只看設定頁上的 ruleset 名字）
```

#### 🔴 陷阱:設定頁上那個叫 `main` 的 ruleset **不保護 `main`**

**2026-08-16 實查(I 窗),請上線那天自己重跑一次確認沒變:**
```bash
gh api /repos/pcmmotorsports/pcm-website-v2/rules/branches/main --jq 'length'  # 當時 0
gh api /repos/pcmmotorsports/pcm-website-v2/rules/branches/dev  --jq 'length'  # 當時 5 ← 正向對照
gh api /repos/pcmmotorsports/pcm-website-v2/rulesets --jq '.[]|"\(.name) \(.id)"'
gh api /repos/pcmmotorsports/pcm-website-v2/rulesets/<id> --jq '.conditions.ref_name'
gh api /repos/pcmmotorsports/pcm-website-v2 --jq '.default_branch'              # 當時 dev
```
**當時的結果**:
```
ruleset「dev」  target = refs/heads/dev     規則 deletion / non_fast_forward
ruleset「main」 target = ~DEFAULT_BRANCH    規則 deletion / non_fast_forward / required_status_checks
而 default_branch = dev
⇒ 🔴 那個【名字叫 main】的 ruleset，~DEFAULT_BRANCH 解析出來是 dev
⇒ 兩個 ruleset 保護的都是 dev；main 實得 0 條
（驗證：dev 那 5 條 = 兩個 ruleset 的聯集，按 ruleset_id 逐條對過）
```
🔴🔴 **誤導方向是「讓人以為安全」** —— 打開設定頁看到「main」是 `active`,
**會直接打勾過關**。**⇒ 判準不是「有沒有一個叫 main 的 ruleset」,是「`rules/branches/main` 回幾條」。**
📎 而 `main` 是 storefront 正式站(memory `project_deploy-topology-main-stale-dev-live`)
⇒ **當時它可以被直接推、強推、刪除,且無任何 status check 要求。**

⚠️ **為什麼 2026-08-16 當天【不】立刻補**(Sean 未拍,I 窗判並記錄理由):
`main` 上那次 CI **不是重複** —— 7/1 起實測 **7 顆 commit 只在 `main` 跑過、從未經過 `dev`**
(量法:`gh run list --workflow ci.yml --limit 1000 --json headSha,headBranch` 按 sha 分組看分支集合)
⇒ **對那 7 顆而言,`main` 那次是唯一一次檢查。**
⇒ **現在鎖緊會改變 Sean 推正式站的操作,而上線前他還在頻繁直推。**
**⇒ 這是「上線後才鎖」的一半,與 private 那條同一個理由。**

🔴 **現在是 public,那是【刻意的、有關閉時點】,不是疏忽 —— 不要自己去改。**
Sean 2026-08-16 逐字:「**等到網站上線後再改,畢竟為了安全著想。**」

**為什麼當時不改(這段是決定的理由,不是背景)**:
- public repo 的 Actions **免費**;private 之後**開始吃 2,000 分/月的免費額度**。
- 🔴 **而 GitHub 預設 spending limit 是 `$0` ⇒ 額度用完不是多收錢,是【workflow 直接不執行】。**
- 🔴🔴 **CI 是唯一在守 SQL / `docs/probes/` 那一層的東西**(本機三綠對 `.sql` 恆綠、零判別力;
  見 `docs/patterns/slice-checkpoint.md` §6.5)⇒ **CI 停跑 = 那層防護無聲消失,而三綠照樣全綠。**
- ⇒ **為了把 repo 藏起來而讓驗證鏈斷掉,淨安全性是負的。**

**⚠️ 當時的數字(`2026-08-16` 量的,上線時很可能已經不同 —— 請重跑,不要引用這個數)**:
```
本期 8/1–8/16（半個月）約 2,548 分  vs  private 免費額度 2,000 分/月
⇒ 當時若改 private，約每月中額度就會用完
```
> 🔴🔴 **2026-08-16 稍晚【自我更正:上面那個「約每月中用完」的推論,基準選錯了】**
> ```
> 按日分佈（ci.yml，8/1 起）
>   08-09 一天 146 次  ← 佔本期 426 次的 34%
>   08-10 之後每天只有 3–10 次
> 照近 7 天速率外推 ≈ 180–210 run/月 ≈ 750–850 分/月  ⇒ 遠低於 2000 額度
> ```
> **`2548` 是本期【已發生】的事實(不可改變),但它不代表未來月份的速率。**
> ⇒ **判「以後會不會超」要用近 7 天,不是本期平均。上線那天請重跑【按日分佈】再下結論。**
> ⚠️ **未查:`08-09` 那天為何 146 次,因此無法判斷那種尖峰會不會再來 —— 那才是決定性的一題。**
> 📎 **本條保留原推論不刪**,因為「同一組數字用不同基準得到相反結論」本身就是要留給下一個人的東西。

**重跑量法**(校準過:每 run 恰 1 job、job/wall = 0.97 ⇒ wall-clock 可用;計費每 job 進位到整分):
```bash
for w in ci.yml e2e-prod.yml rpm-sync.yml; do
  gh run list --workflow $w --limit 1000 --json createdAt,updatedAt \
    --jq '[.[]|select(.createdAt>="<本期起始日>")|(updatedAt−createdAt 秒)]
          |map(select(.>0 and .<7200))|map(((.*0.97)/60)|ceil)|add'
done
```
🔴 **`--limit` 要夠大**:結果若**等於**你給的上限,那是上限不是真值(本檔量測時 `300` 就中過這個坑)。
📎 相關 backlog:`#548`(CI 只跑 push tip,不逐顆跑)—— 其成本結論中的「金錢 `$0`」**前提正是 repo 為 public**,
改 private 當天那條結論同時失效,要一併重算。

---

## 6. 新 Claude Code 第一天的工作

如果你是進入新 repo 的第一個 Claude Code session、按以下順序進行:

### Step 1:讀完所有 .md 套件(對齊上下文)

依序讀:
1. `STATUS.md`
2. **本檔**(`docs/PHASE-1-NORTHSTAR.md`)
3. `docs/lessons-learned.md`
4. `docs/working-style.md`
5. `CLAUDE.md`
6. `docs/PROJECT-OVERVIEW.md`
7. `docs/PHASE-2-VISION.md`
8. `docs/features/vehicle-service-ecosystem.md`(完整 Phase 2 PRD)

讀完用一句話跟 Sean 確認:「我已讀完套件、了解 Phase 1 範圍 = design 直接搬 + 後台對應、不做 9 大藍圖功能」。

### Step 2:執行 design-reference 完整偵察

**任務目標:** 完整盤點 design-reference 全部資產、回報結構 / 資料模型 / 頁面覆蓋範圍。

**偵察範圍:**
- 13 個 .jsx 元件清單 + props + 用途
- 15 個 .css 檔功能 + token 命名
- data mock 完整結構(products / brands / vehicles / orders / users 等)
- 9 份 HANDOFF docs 涵蓋範圍
- 頁面覆蓋表(對照 PROJECT-OVERVIEW §2 目標市場、看哪些頁面有、哪些缺)

**輸出:** `docs/recon/design-reference-recon-{date}.md`

### Step 3:寫 PRD-rewrite.md(含 Medusa schema 對應)

依偵察結果、寫:
- Medusa schema 對應 design 資料結構的設計
- 路由結構對應 design SPA
- 共用元件抽 packages/ui 的範圍
- 執行順序(哪頁先、哪頁後)

**輸出:** `docs/features/PRD-rewrite.md`

Sean 審核拍板後、進入 Step 4。

### Step 4:寫 `docs/PHASE-1-MILESTONES.md`

依 PRD 拆 milestone(每個 milestone 1-2 週、含若干 slice)、按依賴排序。

### Step 5:第一個 slice 動工

依 milestone 第一個 slice 開始實作。

---

## 7. 常見錯誤(自檢)

### 7.1 你寫 slice 指令前自檢

- [ ] 是「直接搬 design」還是「翻譯 / 重寫」?(後者錯)
- [ ] 是否已 grep design-reference 字面、不憑記憶?
- [ ] CSS + TSX 是否在同一個 slice?(雙檔聯動不拆)
- [ ] 是否前台 + 後台同步?(不允許前台先做後台之後補)
- [ ] 內容分級 L1 / L2 / L3 是否標記?
- [ ] 預估時間是否在 15-45 分鐘?(超出拆 slice)

### 7.2 你發現自己在做以下事情、立刻停下

- 把 design 元件「翻譯成 Tailwind 風格」
- 為了「保留既有 storefront 結構」而修改 design 內容
- 憑記憶或印象描述 design 長相、畫預覽 HTML
- 把 9 大藍圖功能(車輛履歷 / 店家端等)的 schema 加進 Phase 1
- 一個 slice 跨 5+ 檔、commit 體積爆炸
- 想用 Orchestrator 拆任務(永久禁用)

---

## 8. 北極星精神一句話

> **design 是成品、Phase 1 把 design 上架、後台支撐 design、不做 9 大藍圖、前後台同步小步前進。**

任何決策遇到不確定、回頭看這一句。

— END —
