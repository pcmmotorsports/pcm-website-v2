# ADR-0004: M-1 Pre-launch Decisions(M-1 啟動前 6 + 4 題拍板紀錄)

> **Status:** 🟢 拍板 / 2026-05-03
> **拍板人:** Sean(Claude.ai 2026-05-03 拍板對話)
> **層級:** docs/decisions/、衝突仲裁僅次 STATUS.md / NORTHSTAR / 0001-0003 ADR
> **本 ADR 角色:** M-1 啟動前 6 題基礎設施 / 架構拍板 + wrs.it IA 報告 4 題處置紀錄、後續 milestone trigger 銜接表
>
> 配合閱讀:
> - `docs/decisions/0001-rewrite-decision.md`(整個重做拍板、本 ADR 承接)
> - `docs/decisions/0002-architecture-pivot.md`(Medusa-as-API + 9 contexts、本 ADR §7 待寫文件清單對應 testing-strategy / bounded-contexts 落地、本 slice M-0-10a 順手修 §7 stale)
> - `docs/decisions/0003-domain-entity-naming.md`(9 衝突處置、本 ADR wrs Q1 修 §4 第 3 條 fitment 字面)
> - `docs/research/wrs-ia-decomposition.md`(wrs.it IA 競品研究、本 ADR wrs Q1-Q6 處置依據)

---

## 1. Context(背景)

M-0(規劃層 9/9)收尾完成、進 M-1(實作層、catalog spike + 種子)前、Sean 拍板對話含 6 題基礎設施 / 架構決定 + 4 題 wrs.it IA 競品研究啟發處置。本 ADR 集中紀錄、避免 trigger 散在多處 commit message。

本 ADR 落地 slice 為 M-0-10(三 sub-slice a / b / c):
- M-0-10a:本 ADR + testing-strategy.md + bounded-contexts.md + money-handling.md + wrs IA 報告 commit + ADR-0002 §7 stale 修
- M-0-10b:packages/domain/src/shared/types.ts(Money brand type)+ packages/domain/src/catalog/types.ts(FitmentSpec yearStart/yearEnd)
- M-0-10c:medusa-schema-design.md / ADR-0003 §4 第 3 條 / IProductRepository.ts JSDoc / security-timeline.md / PHASE-1-MILESTONES.md / backlog 處置

---

## 2. Decisions(拍板字面)

### 2.1 M-1 啟動前 6 題

| Q | 內容 | 拍板 | trigger |
|---|---|---|---|
| Q1 | Supabase 升 Pro 時機 | A2 上架完畢 / 上線前升($25/月) | M-6 上線前 checklist |
| Q2 | Image storage | A2 Supabase Storage(跟 Q1 同生態、上線時同步升 Pro) | M-1-02 起 |
| Q3 | Search engine | A1 PG tsvector + pg_jieba(實作分兩階段:dev 期 ILIKE / 上線後切)　🔴 **分詞那半已被平台事實推翻,見 §2.1-a** | M-1-03 起 dev 期 / M-6 切 |
| Q4 | Money 守門 | A3 brand type MoneyAmount + helper toMoneyAmount(n) | 本 ADR 落地(M-0-10b) |
| Q5 | testing-strategy.md | A3 minimum 版 | 本 ADR 落地(M-0-10a) |
| Q6 | bounded-contexts.md | A3 minimum 版 | 本 ADR 落地(M-0-10a) |

### 2.1-a 🔴 更正段 · `Q3` 的分詞路線已被平台事實推翻(2026-08-16 補;**原決議不刪不改**)

> **只加更正,不動上面那一列的原文。** 原決議在 2026-05-03 當時是對的 —— **變的是平台事實,不是判斷。**
> 刪掉它會讓「為什麼曾經選這條路」消失,而下一個人只會看到結論、看不到那次判斷哪裡失效。

**事實**:`pg_jieba` **不在 Supabase 的可用擴充清單裡** ⇒ `CREATE EXTENSION pg_jieba` 不可能成功
⇒ **「tsvector + pg_jieba」的中文分詞那半在 Supabase 上蓋不起來。**

**兩個來源(不是推論)**:

1. **實測**(2026-07-25,本專案 `bmpnplmnldofgaohnaok`):MCP `list_extensions` 回 **80 個擴充,逐一比對無 jieba**。
2. **官方文件親讀**:Supabase docs `guides/database/extensions/pgroonga` 逐字
   「native Postgres 全文索引 **limited to alphabet and digit based languages**」⇒ CJK 要改用 **PGroonga**。

**該專案清單裡實際可用**(皆 `installed_version: null` = 可裝未裝):
`pgroonga` 3.2.5 + `pgroonga_database`(CJK 主力,`USING pgroonga(col)` + `&@~`)、
`pg_trgm` 1.6(補錯字/近似/子字串,料號年份這類短字串尤其有用)、`rum` 1.3、`fuzzystrmatch`、`unaccent`。

🔴 **這一段為什麼現在才補**:更正**只活在 memory** `reference_supabase-no-pg-jieba-use-pgroonga`,
而那條逐字寫著「**請 Sean 重新拍 ADR-0004 的分詞路線**」—— **那次重拍從來沒有發生過。**
⇒ **ADR 是別人會來查的載體,memory 不是。** 更正沒回到被引用的那份檔,等於沒更正。
📎 同族 memory `feedback_downgrade-a-source-inside-the-file-people-cite`。

📐 **本更正段涵蓋到哪(2026-08-16 重掃,附分母)**:同檔 `grep -c 'pg_jieba'` ⇒ **6**,逐處分類
⚠️ **那個 6 裡有 1 個是【這句話自己】**(它引用了那個字面才數得到)—— 真正指向該路線的是 **5**;
**寫下分母的那一刻,分母就被自己改變了**,所以下表逐處列,不要只看數字:
(🔴 **用錨點文字不用行號** —— 我第一版寫了行號,而**加完這段之後它們當場就漂了**):

| 錨點 | 是什麼 | 狀態 |
|---|---|---|
| `\| Q3 \| Search engine \|` | §2.1 決議列 | ✅ 已就地標更正 |
| `不在 Supabase 的可用擴充清單裡` / `的中文分詞那半` | **本更正段自己** | — |
| `Q1 / Q2 / Q3 同生態` | §3.1 擴充性敘述 | ✅ 已標 |
| `M-6 上線前 checklist(M-6-08)` | §4 trigger 銜接表 | ✅ 已標 |

🔴 **後兩處是第一版更正時【漏掉的】** —— 我只折了 finding 點名的那一列(§2.1 決議列)。
   而 **「M-6 上線前 checklist」那一列 = 會被拿去執行的東西**,不是敘述;
   **上線前 checklist 正是最不會被人質疑的那種清單** —— 讀的人會照著做,不會回頭問「這條還成立嗎」。
   📎 `feedback_folding-a-finding-defaults-to-the-named-spot-only`:**finding 給的是症狀的位置,不是病的邊界。**

**⇒ 待辦(未做)**:`Q3` 的分詞路線**需要 Sean 重新拍**(PGroonga / PGroonga+pg_trgm 混合 / 其他)。
⚠️ **兩階段那半仍然有效**(dev 期 ILIKE、上線後切)—— **被推翻的只有「切過去之後用什麼分詞」。**
⚠️ 上面那條 memory **只證「可用性」,未證效能 / 中文斷詞品質 / 索引體積** —— 那些要真資料實測。
📎 啟用擴充 = migration = **Sean 手動 `db push`**,Claude 不自行 apply。

### 2.2 wrs.it IA 報告 4 題處置

| Q | 內容 | 拍板 | trigger |
|---|---|---|---|
| wrs Q1 | Year 範圍 schema | A1 yearStart: number / yearEnd: number \| null(null = 開放式範圍 "2025+") | 本 ADR 落地修 FitmentSpec(M-0-10b) |
| wrs Q3 | 4 軸 selector | A2 維持 design 現狀、之後實際操作再決定 | 不修、留 trigger 給 Phase 1 完工後 Sean 跟 Claude Design 對話(backlog #79) |
| wrs Q4 | 商品名硬規範 | backlog #78 trigger M-5-03 | 不本 slice 處理、新 backlog 條目 |
| wrs Q5 | SKU brand prefix | 撤銷不做(原廠料號 = SKU、PCM 不自建 prefix) | 不做、不進 backlog |
| wrs Q6 | 雙 breadcrumb | B2 維持 design 現狀 | 不修、留 trigger 給 Phase 1 完工後(backlog #79) |

---

## 3. Rationale(三視角)

對齊 Sean 2026-05-03 拍板對話、簡短不過度展開。

### 3.1 擴充性

- **Q1 / Q2 / Q3 同生態:** Supabase Pro 一次升、解決 DB / Storage / ~~pg_jieba~~(⚠️ 分詞那件**不可行**,見 §2.1-a)三件、Phase 2 加 Vehicle / Booking / Wallet 表也走同 plan、不需多 vendor
- **Q3 兩階段 search:** dev 期 ILIKE 跑 200 SKU 規模可用(p99 1-3s)、不阻 M-1-03 進度;M-6 切 tsvector 對 5w SKU(p99 < 100ms)、上線後 Phase 2 5w-10w SKU 撐得住
- **Q4 brand type:** Phase 2 加幣別(USD / EUR)時、MoneyAmount + Currency 兩維度擴張、不動既有 use-case;helper 集中守門、新進 dev 不需學浮點 guard
- **wrs Q1 yearStart/yearEnd:** 對應 Sean 真實業務(報價單寫 "2018-2024" / "2025+")、Phase 2 加 vendor crawler 抓年份範圍直接 mapping、不需事後遷移
- **Q5 / Q6 minimum 版:** Phase 2 啟動前再擴 ubiquitous language 字典 / contract test 框架、Phase 1 minimum 版守 test 風格 / context 邊界一致即可

### 3.2 可維護性

- **Q4 集中守門:** toMoneyAmount() helper 單點維護、各 use-case 不散寫 Number.isInteger guard、改規範靠 grep helper 找全
- **Q3 JSDoc 註明:** searchByKeyword / Medusa adapter 兩階段註記 JSDoc + ADR-0004 trigger、M-6 切換時 grep "ILIKE 暫代" 找全切點
- **wrs Q1 schema 命名:** yearStart / yearEnd 對應 Sean 口語(「2018 到 2024」/「2025 以後」)、員工跟 Sean 跟 code 同字面
- **Q5 / Q6 minimum 版位置:** docs/architecture/、與既有 dependency-rules.md / medusa-schema-design.md / security-timeline.md 同層、單一 source 集中

### 3.3 bug 可追蹤性

- **Q4 brand type:** TS 編譯期攔「未過 helper」的 number 賦值、bug 在 lint / typecheck 階段 catch、不 leak 到 runtime
- **Q3 兩階段:** dev 期 ILIKE 跑「搜不到」與 production tsvector「搜不到」是兩種 bug、JSDoc 註明後第一時間定位是 dev 暫代問題還 production 索引問題
- **wrs Q1 schema:** yearStart / yearEnd 結構化、客人「車型 fitment 找不到」grep adapter 邊界 fitmentToWireString / parseWireFitment 找
- **Q5 test 風格一致:** 同層 *.test.ts + describe('X') / it('should ...') 慣例、test 失敗 grep test description 直接定位 entity
- **Q1 升級 trigger M-6-08:** Supabase Pro 升級動作落 M-6-08 上線前 checklist、checklist 漏一條 = 上線當天才發現,checklist 有條 = 上線前驗;落點明確、責任不分散

---

## 4. Trigger 銜接表

| Trigger 點 | 動作 | 來源 |
|---|---|---|
| 本 ADR 落地(M-0-10) | testing-strategy.md / bounded-contexts.md / money-handling.md / Money brand type / FitmentSpec yearStart-yearEnd | Q4 / Q5 / Q6 / wrs Q1 |
| M-1-03 啟動 | search 用 PG ILIKE 暫代、JSDoc 註明 M-6 切 tsvector | Q3 |
| M-1-02 起 image 上傳 | 走 Supabase Storage free tier | Q2 |
| **M-6 上線前 checklist(M-6-08)** | Sean 刷卡升 Supabase Pro $25/月、search 切 tsvector + ~~pg_jieba~~ ⚠️🔴 **這一列的技術路線已於 §2.1-a 標記為【不可行】(Supabase 裝不了 `pg_jieba`)——執行前先看那一節,不要照這行做。** | Q1 + Q2 + Q3 |
| M-5-03(sync-product-candidates) | 寫商品名硬規範 + concat helper | wrs Q4(backlog #78) |
| Phase 1 完成後 | Sean 評估 4 軸 selector / 雙 breadcrumb 是否需要、若是跟 Claude Design 對話 | wrs Q3 / wrs Q6(backlog #79) |

---

## 5. 與其他文件交叉引用

| 檔案 | 角色 | 本 ADR 關係 |
|---|---|---|
| `docs/decisions/0001-rewrite-decision.md` | 整個重做拍板 | 本 ADR 承接、不推翻 |
| `docs/decisions/0002-architecture-pivot.md` | Medusa-as-API + 9 contexts | 本 ADR §7 待寫文件清單對應 testing-strategy / bounded-contexts 落地、本 slice M-0-10a 順手修 §7 stale |
| `docs/decisions/0003-domain-entity-naming.md` | 9 衝突處置 | 本 ADR wrs Q1 修 §4 第 3 條 fitment 字面(由 M-0-10c 落地) |
| `docs/architecture/testing-strategy.md` | minimum 版本(新檔) | 本 ADR Q5 落地(M-0-10a) |
| `docs/architecture/bounded-contexts.md` | minimum 版本(新檔) | 本 ADR Q6 落地(M-0-10a) |
| `docs/patterns/money-handling.md` | brand type 規範(新檔) | 本 ADR Q4 落地(M-0-10a)、實際 .ts 字面 M-0-10b |
| `docs/architecture/medusa-schema-design.md` | schema mapping | 本 ADR wrs Q1 / Q3 §2.4 Fitment + search 兩階段補(M-0-10c) |
| `docs/architecture/security-timeline.md` | 安全時序統一表 | 本 ADR Q1 加 #F6 Supabase Pro 升級 trigger(M-0-10c) |
| `docs/PHASE-1-MILESTONES.md` | milestone 排程 | 本 ADR Q1 加 M-6-08 任務名 + §11 拍板項目補 trigger(M-0-10c) |
| `docs/research/wrs-ia-decomposition.md` | wrs.it IA 競品研究 | 本 ADR wrs Q1-Q6 處置依據 |
| `docs/phase-1-backlog.md` | backlog | #13 / #45 / #46 / #57 標 ✅ + 新增 #78 / #79(M-0-10c) |

---

## 6. 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-03 | 初始化 ADR-0004(M-1 啟動前 6 + 4 題拍板紀錄 + trigger 銜接表) | Claude.ai + Sean / 由 Claude Code(M-0-10a)落地 |

— END —
