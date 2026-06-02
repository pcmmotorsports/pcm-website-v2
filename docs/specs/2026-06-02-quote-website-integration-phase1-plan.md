# 報價單 ↔ 網站 商品資料整合 — Phase 1 Plan(每天乾淨同步)

> 2026-06-02 / 網站側審查 session 產出。**鐵則 8 重大改動 plan、等 Sean 批准才動手、未碰程式。**
> 決策基線:**Q1=A** 每天批次複製 / **Q2=A** 敏感欄不進網站 / **Q3=A** 即時層延後 / **D1=A** 車款直出 / **D2** 由乾淨同步解決 / **D3=A** 資料驅動。
> 跨系統:報價單 = PCM報價單-V2(Supabase **B庫 `dllwkkfanaebrsuyuedy`**);網站 = 本 repo(Supabase `bmpnplmnldofgaohnaok`)。
> 來源:`~/.claude/plans/INTEGRATION-quote-website-2026-06-02.md`(報價單側設計)+ 工作流多方研究(2026-06-02、9 方案多維+對抗分析、結論「批次複製」最適 PCM)。

---

## 1. 目標
網站商品資料每天自動對齊報價單(源頭唯一真相),後台一改、最慢隔天自動上架;**敏感資料(成本/蝦皮/來源/客人 LINE)根本不進網站**;廢掉髒 `RPM-` 前綴;補下架對賬;為 OD 商品頁重做鋪乾淨資料地基。

## 2. 終態架構(Phase 1)
```
報價單 B庫 (源頭真相)                          網站 (前台)
products / product_groups_v                    Supabase bmpnpl...
   │  (含成本/蝦皮/LINE — 後台用)
   ▼
storefront_catalog_v  ──每天排程複製(只公開欄)──▶  products(只存公開欄)
 (乾淨公開 view、排敏感、grant)                       │
                                                     ▼
                                          ProductPage 讀「自家副本」(現狀不變)
```
- **報價單側**:`storefront_catalog_v`(只吐公開欄、排敏感)+ grant。【報價單 session 做、非本 repo】
- **網站側**:每天排程讀 view → upsert 網站 `products`(冪等、`updated_at` 比對);`(supplier_slug, sku)` 模型;**只寫公開欄**;下架對賬(源頭消失 → 軟下架)。
- **網站商品頁**:不變(讀自家 `products`),只是資料來源變乾淨。源頭掛了網站照賣昨天資料(複製模式天然降級)。

## 3. 要改什麼(影響面)
**網站側**
- schema migration:`products` 加 `supplier_slug`、加「已下架」軟狀態欄;**清掉既有 `metadata` 內 `cost`/`shopee`/`source_*`**(backfill 清空);唯一鍵對齊 `(supplier_slug, sku)`。RLS/grant 收緊(新欄不外洩)。
- `scripts/rpm-import.ts`(**415 行、超鐵則 6 的 400 上限**)→ 拆 fetch / transform / load 三段。
- 同步邏輯:改讀 `storefront_catalog_v`、廢 `RPM-` 前綴、只寫公開欄、冪等 upsert、`updated_at`/版本防漂移、分批、斷線重試、失敗 log/警報、**下架對賬**。
- domain/adapter:`productCode` 去前綴(吃乾淨 `main_sku`);**`fitments[]` plumb 到 UI**(`MockProduct` 加 `fitments` + `toUIProduct`)為車款表鋪路。
- 部署:排程平台(Vercel Cron vs Supabase pg_cron — 待 Sean 拍)。

**報價單側(非本 repo、報價單 session 做)**
- `storefront_catalog_v` + RLS/grant + 給網站連線方式。

## 4. 切片(序列 + 依賴)
| Slice | 內容 | 依賴 | 規則 |
|---|---|---|---|
| **S0**【報價單側、非我】 | `storefront_catalog_v` + grant + 連線 | — | 阻擋 S3+ |
| **S1** | 網站 schema:加 `supplier_slug`/軟下架狀態 + 清 `metadata` 敏感欄 backfill + RLS/grant 收緊 | — | 鐵則 8+12、codex 雙關卡、down migration |
| **S2** | 拆 `rpm-import.ts` → fetch/transform/load 三段(純 refactor) | — | 三綠 **(不依賴 S0、可先開跑)** |
| **S3** | 同步腳本改讀 `storefront_catalog_v` + 廢 `RPM-` + `(supplier_slug,sku)` + 只寫公開欄 + 冪等/`updated_at` | S0+S1+S2 | 鐵則 12、codex |
| **S4** | 下架對賬(源頭消失→軟下架、不硬刪避免撞訂單)+ 日誌/警報 | S3 | codex |
| **S5** | 排程上線(Vercel Cron / pg_cron)+ 冪等/重試/分批驗證 | S3+S4 | — |
| **S6** | 資料層接線(`productCode` 乾淨 + `fitments` plumb)為 OD 鋪路 | S3 | 三綠 |

> **OD 商品頁重做** = 另一條 workstream、疊在 S6 之上、**獨立 plan + 獨立 slice 群**(視覺/廠牌內文與資料源無關、可在 S0–S5 進行時並行先做)。

## 5. Rollback
逐片:S1 down migration(還原欄位;敏感欄清空不可逆但無風險);S2–S6 `git revert`;排程可停;軟下架可還原。整體切換期間舊資料仍可服務。最壞回到現狀(舊腳本 + 公開 view 擋敏感)。

## 6. Gates(PCM 紀律)
- **鐵則 8**:本 plan 等 Sean 批。
- **鐵則 12**:S1/S3/S4 碰 schema/敏感價 → codex 關卡1(plan、Sean 批 plan 後跑)+ 關卡2(commit 前 diff)。codex 每片硬上限 2 輪。
- 每片三綠(typecheck+lint+build)+ code-reviewer。
- STATUS 7 欄自更 + busboy-end。**不 push**。

## 7. 需要 Sean / 報價單 side
- **路由給報價單 session**:建 `storefront_catalog_v`(公開欄合約 + grant + 連線方式)。← 不做這個、S3 之後全卡。
- **Sean 拍**:排程平台(Vercel Cron vs pg_cron);網站連報價單方式(受限 read key vs anon view);公開欄最終清單確認。
- 跨兩個 repo,Sean 居中協調。

## 8. 風險(研究 + 親驗)
- **幽靈商品**(現狀缺下架對賬,親驗 `rpm-import.ts` 只 upsert 不刪)→ S4 修。
- **敏感資料已在網站 DB**(親驗 `products.metadata` 有 `cost:6400`/`shopee:13100`)→ S1 清 + S3 不再寫。
- **源頭未定稿**(車種約 19% 未確認 / 中文品名灌中 / 品牌將大改)→ transform 階段清洗、不推半成品上公開頁。
- **前綴/唯一鍵切換**(舊 `RPM-DCC01` vs 新 `(rpm, DCC01)`)→ S3 一次性對映 migration + 驗。

— END —
