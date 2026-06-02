# 報價單↔網站整合 Phase 1 — 交接(2026-06-02、雙 session context 滿)

> 給新開的【執行 session】+【fresh-context 審查 session】。承「寫審分離 ROLE=A」+「哨兵自動審」。
> 作者:整合 Phase 1 審查 session(context 滿、交棒)。

## 0. 一句話現況
資料層整合進行中:**S2 ✅ + S1 ✅(已 commit、已 `supabase db push` 套用、§8.5 live sign-off、post-commit PASS;未 push 到 origin)**;**S0(報價單側共用 view)Sean 正要貼指令給報價單 session**;**S3 卡 S0**。OD 商品頁重做是疊在資料層之上、之後的另一條 workstream。

## 1. 大方向
- **報價單系統(PCM報價單-V2、Supabase B庫 `dllwkkfanaebrsuyuedy`)= 商品唯一真相 + 後台大腦**;購物網站(本 repo、Supabase `bmpnplmnldofgaohnaok`)= 前台門面。會員/訂單/auth 留網站本地。
- 取代舊「網站自存一份商品複製(rpm-import 加 RPM- 髒前綴)」。
- 報價單側設計文件:`~/.claude/plans/INTEGRATION-quote-website-2026-06-02.md`。

## 2. 決策彙整(Sean 拍、必遵)
- **Q1=A** 每天批次複製(網站讀自家副本、不直讀源頭、過渡版)。
- **Q2=A** 敏感欄(cost/shopee/source)根本不複製進網站。
- **Q3=A** 即時刷新層(webhook+ISR)延 Phase 2。
- **S0=A** 建「一支共用」乾淨 view `storefront_catalog_v`(涵蓋所有供應商、`supplier_slug` 欄區分、加品牌零改 view)。
- **D1=A** 適用車款表照 DB `fitments` 原樣直出(三欄 車廠/車型 modelCode/年式;無「車系」欄、~24 列 messy)。
- **D2** 主料號真值 = `DCC01`(import 加 RPM- 前綴變 RPM-DCC01)→ 由乾淨同步(S3 廢前綴)解決。
- **D3=A** picker/規格走真資料、OD 樣板當視覺皮(真資料 = 4 紋路 + 12K special,且**有消光蜂巢變體**、與 OD 文案「蜂巢只有亮光」不符 → 以真資料為準)。
- **ROLE=A** 純寫審分離:獨立執行 session 實作、獨立 fresh-context 審查 session 重驗(codex 關卡2 + sign-off)、Sean 橋接。
- S1 內:`delisted_at timestamptz`(NULL=上架)/ `supplier_slug NOT NULL DEFAULT 'rpm'`(過渡、S3 評估移)/ 唯一鍵切換留 S3。

## 3. Slice 進度(master plan: `docs/specs/2026-06-02-quote-website-integration-phase1-plan.md`)
| Slice | 狀態 |
|---|---|
| **S0** 報價單側建 `storefront_catalog_v` + grant + 連線 | 🔜 Sean 正要貼指令給報價單 session(S0 文字見 §9) |
| **S1** 網站 schema(supplier_slug/delisted_at/清敏感+CHECK/RLS/3 view 重建) | ✅ commit `a6b7cbd`、已 db push 套用、§8.5 live SIGN-OFF、post-commit PASS |
| **S2** 拆 rpm-import.ts → fetch/transform/load | ✅ commit `7f1fb87` |
| **S3** 同步腳本改讀 `storefront_catalog_v` + 廢 RPM- + (supplier_slug,sku) + 只寫公開欄 | ⛔ 卡 S0 |
| **S4** 下架對賬(源頭消失 → `delisted_at`、軟下架) | 待 S3 |
| **S5** 排程(Vercel Cron / pg_cron、待 Sean 拍平台) | 待 S3/S4 |
| **S6** 資料層接線(productCode 乾淨 / fitments plumb)為 OD 鋪路 | 待 S3 |

## 4. 已 commit、未 push(等 Sean 手動推;origin/dev = `2ec044b`)
- `7f51fc7` docs brief 入版 + STATUS 轉線
- `7f1fb87` S2 拆檔
- `a6b7cbd` S1 schema migration

## 5. 關鍵檔
- master plan:`docs/specs/2026-06-02-quote-website-integration-phase1-plan.md`(S0–S6)
- S1 plan v3:`docs/specs/2026-06-02-S1-schema-migration-plan.md`(codex k1 雙輪處置 §2.5)
- S1 migration(已套用):`supabase/migrations/20260602135934_s1_supplier_slug_delisted_clean_metadata.sql`
- **審查紀錄(逐片 PASS/findings)**:`docs/reviews/integration-phase1-review-log.md`
- 報價單側設計:`~/.claude/plans/INTEGRATION-quote-website-2026-06-02.md`
- 同步腳本(S2 拆後):`scripts/rpm-{import,fetch,transform,load}.ts`
- **OD 商品頁視覺真權威**:OpenDesign「Website V2」專案 `product-detail-rpm-template.html` + `HANDOFF-rpm-template.md`(讀法:open-design MCP、project="Website V2")
- 記憶:`project_quote-website-integration-phase1` / `reference_supabase-rls-schema-test-txn-simulation` / `reference_sentinel-auto-review-pipeline`

## 6. ⚠️ 鐵律 / 地雷
- 🔴 **S1→S3 之間,別經任何路徑(含手動 rpm-import / seed / 手動 SQL)寫 `shopee/cost/source_amount/source_currency` 到 metadata** —— S1 的 CHECK 會拒寫;S3 改 rpm-transform 停寫才解。
- 🔴 **`price_store` 命名相反**:報價單 `price_store`=零售、網站 `price_store`=經銷。S0 view 合約欄用 `price_retail`;S3 對接照「語意」不照欄名,接反會標錯價/洩成本。
- 經銷防護:column GRANT 排敏感 + public view 排敏感 + RLS + **S1 新增 metadata CHECK(第 4 層)**。公開頁只讀乾淨 view、type 不帶敏感、commit 前 `.next/static` grep。
- **不 push**(Sean 手動 = review checkpoint)。
- 報價單 `product_groups_v` 會吐 `price_source`、不能當公開源 → 必須走 `storefront_catalog_v`。

## 7. 【執行 session】接手步驟
1. 起手:`cd /Users/sean_1/pcm-website-v2` + git branch(dev)/status/log;讀 STATUS + master plan + 本 handoff + CLAUDE.md「自驅 slice SOP」+ 鐵則 6/8/11/12。
2. 下一片 = **S3**,但**等 S0**(報價單側 view + 連線就緒、且審查 session 複驗過 view)。S0 沒好別動 S3。
3. S3 內容:`rpm-fetch` 改讀 `storefront_catalog_v`(取代讀原始 products + product_groups_mv)、`rpm-transform` 廢 RPM- 前綴 + 只寫公開欄(**停寫敏感 metadata、解 S1 CHECK 限制**)+ 對齊 `(supplier_slug, sku)`;domain/mapper 視需要。鐵則 8+12 → 先 plan + codex 雙關卡。
4. 流程:前後台同步、檔案 <400、三綠(動 .ts 加 build)、code-reviewer、精準 git add、commit 字面 vs 事實、STATUS 7 欄、busboy-end、**不 push**。

## 8. 【審查 session】接手 + 重新布哨
1. 角色:fresh-context 重驗執行 session 每片 commit(字面vs事實 / 鐵則 1-12 / manifest / 經銷 grep)+ codex 關卡2(敏感片 S3/S4、codex-adversary skill)+ sign-off。**不寫實作碼**。對齊 memory `feedback_execution-review-session-split`。
2. **重新 arm 哨兵**(舊 session 的 Monitor 已隨 session 死):先 ToolSearch 載入 `Monitor` + `PushNotification`,再用 Monitor(persistent、timeout 3600000)布署,command:
   ```
   R=/Users/sean_1/pcm-website-v2
   prev=$(git -C "$R" rev-parse dev 2>/dev/null)
   echo "SENTINEL_ARMED watching dev from ${prev:0:8}"
   while true; do cur=$(git -C "$R" rev-parse dev 2>/dev/null || true); if [ -n "$cur" ] && [ "$cur" != "$prev" ]; then echo "NEW_COMMIT ${cur:0:8} :: $(git -C "$R" log -1 --format='%s' "$cur" 2>/dev/null)"; prev="$cur"; fi; sleep 20; done
   ```
3. 每 NEW_COMMIT → 審不可變 commit(`git show`、零 race)、三綠在乾淨樹或獨立 worktree 重跑、敏感片跑 codex 關卡2(main session、`-s read-only`、`git status --porcelain` before/after 比對)、findings append `docs/reviews/integration-phase1-review-log.md`、**FAIL 才 PushNotification**。
4. RLS/schema 真 DB 驗證手法:memory `reference_supabase-rls-schema-test-txn-simulation`(MCP `execute_sql` 交易內 `BEGIN` + 模擬 + `SET LOCAL ROLE anon` + 查 + `ROLLBACK`、零留痕;只查 count/欄名、不取金額)。
5. **S0 view 建好後**:審查 session 對報價單 B庫(`dllwkkfanaebrsuyuedy`)真連線複驗 `storefront_catalog_v`:只露公開欄、零敏感(cost/shopee/source/line_*)、`security_invoker`、anon 查得到、過濾正確、那把 key 只能讀 view 碰不到敏感 → 過了才放行 S3。

## 9. 待 Sean
- ~~手動 **push** 那 3 片(`7f51fc7` / `7f1fb87` / `a6b7cbd`)~~ **✅ 已 push**(2026-06-02、origin/dev=`a6b7cbd`、ancestor 驗證 3 片全中)。
- **S0 指令已複製、待本次交接結束後貼給報價單 session**(原文見審查 session 對話最後一則;重點:一支共用 view、涵蓋所有供應商、`price_retail` 別叫 `price_store`、security_invoker + 受限唯讀 key)。
- 報價單回「view 欄位清單 + 連線」→ 轉給審查 session 複驗 → 過了執行 session 接 S3。
- 拍排程平台(Vercel Cron vs Supabase pg_cron、S5 才需)。

— END —
