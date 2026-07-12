# SESSION HANDOFF — 2026-07-12 收整 P4 目錄 server 分頁 + S4 卡片年份 + preview 抓到 RPC 逾時交 Codex

> **一句話結果**:P4/S4 code 全完成 + 雙審 PASS + 已上 `origin/dev` preview(**未上 prod**);但 preview 肉眼驗抓到 P4 RPC「沒選車」8.2s 逾時 bug、已寫問題書交 docs/superpowers Codex session 治本。本 session 4 支 commit 全 push `origin/dev`(preview);main 未動。**非全程 auto mode**(Sean 逐步拍板)。
> **環境**:pcm-website-v2 · prod A庫 `bmpnplmnldofgaohnaok` · branch `dev` · mode=engineering(含 website 部署面)。HEAD=`5c019d5`。
> **接手先讀**:`STATUS.md`(Blocker/下一步/最後更新)、`docs/handoff/2026-07-12-p4-rpc-timeout-for-codex.md`(給 Codex 的 RPC 問題書)、memory `project_search-vehicle-consistency-keyword-engine`(S1–S4 線)、本檔。

## 1. 做了什麼(時序)
1. **判斷 P4 完整度 + 收整** — P4(前一條 Codex session 做完只差沒 commit 的目錄 server 分頁,Sean 已批 A×6)判定完整 → 精準 commit `dcebd92`(10 檔)。`catalog-page.ts` 刻意切兩段:P4 base 進 `dcebd92`、S4 的 `toCardFitments`/fitments 透傳留 S4 commit(Sean 拍 **Q1=A 收整 / Q2=A 切開**)。
2. **S4 收尾** — 貼回 catalog-page fitments delta,commit `bc1a7cf`。乾淨基底重驗:typecheck/lint/**production build**/完整 vitest **1885** 綠。**code-reviewer PASS(0 must-fix)+ Fable 深度對抗審 PASS(0 must-fix)**(取代 Codex Packet=codex 無額度、Sean 拍)。順手清 3 nit:**N1 移除 `product-card-fits.ts:49` 一個 NUL byte**(`${motoBrand}\0${modelCode}`=git 誤判該檔 binary 主因)+ trim / N2 快取鍵 `catalog-page` v1→v2 / N3 migration 193000 rollback 註補正。
3. **migration 上 prod** — Sean `db push`(暫移 `.env.local` 繞 CLI 擋),**一次帶 4 支**:`183000`(P4)/`193000`(S4)/`120000`(taxonomy 種子,別 session)/`203000`(M-4a orders 欄,別 session)。唯讀 MCP 驗證全綠。
4. **preview 部署 + 肉眼驗抓 bug** — 推 `origin/dev` → Sean preview 驗 `/products` **空白(0 件商品)**。診斷=`search_catalog_by_vehicle` 沒選車路徑 generic plan 剪不掉 UNION 車款分支 → 掃 `product_fitments` 81K + `product_fitments_effective` 103K → **8.2s > anon 8s statement_timeout → PostgREST 57014** → 前端 catch 成空。⚠️ **先前「service 唯讀驗證全綠」是誤判**(`SET ROLE`/service 不套 anon timeout、也會剪枝)。
5. **交 Codex 治本** — Sean 拍 **A**,寫問題書 `docs/handoff/2026-07-12-p4-rpc-timeout-for-codex.md`(commit `5c019d5`)交 docs/superpowers Codex session。

## 2. Commit 序列(push 狀態寫死)
| commit | 內容 | 歸屬 | push |
|---|---|---|---|
| `dcebd92` | #51 商品目錄 server 分頁(10 檔) | 本 session(收整 Codex P4) | ✅ origin/dev |
| `bc1a7cf` | #212 S4 卡片年份收尾 | 本 session | ✅ origin/dev |
| `638b42a` | STATUS(migration 上 prod + B 暫緩) | 本 session | ✅ origin/dev |
| `aca8425` | PRD §6.2 稽核欄正名 [m4a] | **別 session(M-4a)** | ✅ origin/dev(隨本 session push 帶上) |
| `5c019d5` | P4 RPC 逾時問題書交 Codex + STATUS | 本 session | ✅ origin/dev |

本檔 handoff commit = **未 push**(依 handoff skill 不自動 push、Sean 決定)。**⚠️ 多 session 共用工作樹:接手先 `git fetch` + `git status`,勿 `git add -A`(見第 6 節殘檔清單)。**

## 3. DB / 部署 / 外部足跡(git 看不到)
- **migration apply prod A庫 `bmpnplmnldofgaohnaok`(Sean db push)**:
  - `183000`:`products_list_public` view 改 10→15 欄 + `security_invoker=true`(CREATE OR REPLACE、前 10 欄相容)+ `search_catalog_by_vehicle` RPC + `catalog_brand_counts` RPC。
  - `193000`:CREATE OR REPLACE 同 RPC、jsonb 尾端加 `fitments` key(現 12 key)。
  - `120000`/`203000`:別 session(taxonomy 種子 / M-4a orders 欄);**taxonomy 種子若動分類資料,現行 prod 分類可能已隨之變**(M-4a/分類 session 地盤)。
  - 皆 CREATE OR REPLACE/可重跑;RPC rollback 註在 193000 檔內。
- **部署**:prod `main=06110a8` **未動**(舊前端不呼叫新 RPC = 安全)。P4/S4 在 `origin/dev` preview。**RPC 治本前不上 prod。**
- **🔴 已知 prod 效能 bug**:`search_catalog_by_vehicle` 沒選車 8.2s 逾時(復現/驗收見問題書)。

## 4. graphify 地圖增量
**地圖未刷。原因:①07-10 拍板 `graphify --update` 走 milestone/每日、非每 slice ②工作樹現有別 session(M-4a)未 commit 的 `apps/admin` code + migration `210000`,現在刷會把別人半成品灌進圖 ③本 session 是 mid-flight 交棒(P4/S4 交 Codex)、非 milestone。** 待 M-4a 收斂 / milestone 收尾、乾淨樹再刷(`graph.json` 存在、graphify_enabled=true)。

## 5. 開放項(待辦)
- 🔴 **P4 RPC 效能治本(交 Codex、阻塞上線)** — docs/superpowers session 修 `search_catalog_by_vehicle` 沒選車路徑 → 目標 <1s;改法=**新** migration `CREATE OR REPLACE`(別動已 apply 的 183000/193000);驗收**必用** `force_generic_plan` 或 curl PostgREST anon(別用 SET ROLE/service)。進入點=`docs/handoff/2026-07-12-p4-rpc-timeout-for-codex.md`。**這關過才可能上 prod。**
- 🔴 **正式部署決策(Sean 拍)** — `dev→main` FF 會連帶推 11+ commit,含別 session M-4a 首頁最新商品(`e89bf06`/`44d1b5e`)+ 後台 spike(`0b76936`);需 Sean 對齊 M-4a 是否同批上 prod。RPC 治本 + M-4a 對齊後才 push `dev:main`。
- ⏳ **RPC 治本後複驗(接手 Claude 可做)** — Codex 交回後:`force_generic_plan` EXPLAIN + curl PostgREST anon 量 time_total <1s、preview `/products` 肉眼驗有商品。
- ⏳ carry-over(見 STATUS「下一步」):S2 lightech 上架(#275)、S3 搜尋 MVP、子分類 follow-up、#277 車輛下拉純 inherited。

## 6. push 狀態與收尾自檢(接手第一眼)
- **push**:本 session 4 支 commit 全 push `origin/dev`(preview、含 M-4a 的 `aca8425`);`main` 未動;本檔 handoff commit 待 Sean 推或下 session 帶。**下 session 進入 3 步**:①`git fetch` + 讀 STATUS Blocker ②等/查 Codex 的 RPC 治本 migration ③治本後 `force_generic_plan`+curl 驗 <1s → 對齊 M-4a → 才 `dev→main`。
- **收尾自檢**:
  1. `git status` **非 clean**:有別 session(M-4a)殘檔 `apps/admin/src/app/page.tsx`(M)、`apps/admin/src/lib/{audit/,session/,request-id.ts,staff.ts}`、`apps/admin/src/middleware.ts`、`supabase/migrations/20260712210000_m4a_admin_audit_log.sql`、`docs/superpowers/`(??)=**不歸本 session、勿 git add -A、勿 reset/checkout 清掉**。
  2. secret 0 洩漏:handoff 全文無連線字串/secret(問題書內 `sb_publishable_…` 為**公開** publishable key、非機密)。
  3. DB/部署足跡見第 3 節;graphify 未動見第 4 節。

## 相關 plan / 記憶 / 文件
- `docs/handoff/2026-07-12-p4-rpc-timeout-for-codex.md`(RPC 問題書,給 Codex)
- `docs/specs/2026-07-12-search-vehicle-work-plan.md` §5(S4 真權威)
- memory:`project_search-vehicle-consistency-keyword-engine`(S1–S4 線)、`reference_supabase-anon-rpc-verify-generic-plan-timeout`(這次驗證盲點)、`reference_nul-byte-in-source-git-binary`(S4 那顆 NUL byte)
- `STATUS.md`(Phase 1 SSoT)
