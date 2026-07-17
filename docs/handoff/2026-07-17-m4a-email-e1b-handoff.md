# SESSION HANDOFF — 2026-07-17 M-4a Email 片:E1a 硬閘全關 + E1b 收工,下一=E2a

> 一句話:E1a migration prod 驗證 PASS(放行三步全關)+ E1b(port/adapter 層)雙審過、**已 push**。
> 環境:pcm-website-v2 · Supabase prod(bmpnplmnldofgaohnaok)· branch dev · engineering mode。HEAD=`7b30ced` = origin/dev。
> 接手先讀:`STATUS.md`「下一步」→ 本檔 → plan v3.1(`docs/specs/2026-07-16-m4a-email-notify-plan.md`)§3.5b/§3.6/§4.2 → migration `20260717020000` 頭註 §⑦§⑧ → **`packages/ports/src/IEmailOutbox.ts` 全檔 JSDoc(E2a 的使用合約)**。

## 1. 做了什麼(按時序)

1. **E1a 放行三步全關**(`4a02330`)— 開工發現 migration 已 apply、dev 已推(前交接「未 push 未 apply」過時);值班台缺位,**Sean 指示本視窗開 Supabase MCP 驗**=步驟②改由 fresh 視窗執行。唯讀 catalog 包+寫入型合成資料包(**單一 DO block+結尾無條件 RAISE=單語句原子 rollback**,MCP 縱使 autocommit 也零留痕)全 PASS、residual_rows=0。⚠️ 首輪 4 FAIL 全是驗證腳本自身 bug(P0003 RETURNING 兩列/jsonb 跨層轉義 22P02),含 7b 一次假 PASS,修正重跑才算數——「驗證步驟比 code 更易錯」再添實錘。
2. **E1b 實作**(`7b30ced`;Sean 拍 A+**指定二審**)— `@pcm/ports`:`IEmailOutbox`(enqueue/claimDue/claimById/markSent/markFailed/markSkippedOrderIneligible)+`IEmailSender`;`@pcm/adapters/email/`:`SupabaseEmailOutboxAdapter`(窄 cast;database.types 未含 email_outbox)+`ResendEmailSenderAdapter`+`order-email-assembly`;出口=`@pcm/adapters/server` subpath。零 UI、零 schema、零既有行為變更。
3. **雙審鏈**:code-reviewer R1 FAIL(🔴 Critical=先 limit 再過濾 → 死列佔滿窗口活信餓死 → `DUE_SCAN_CAP=200` 大窗)→修→R2 fresh PASS;codex 關卡2 R1 FAIL 6 must-fix(🔴 ABA 覆寫在途列→mark* 帶 `claimedAttempts` 世代柵欄/port 收任意 payload+subject 可繞組裝層→**enqueue 只收來源欄位、落表三欄內部重組**/order_shipped 過早開放→收窄 `'order_created'`/23505 盲回 duplicate→回查同事件同訂單/錯誤碼 runtime 窮舉 allowlist/Idempotency-Key 改結構化座標)→全修→R2 PASS(2 nit 已清);兩輪 porcelain 零留痕。
4. **Sean push**(`8b5bc74..7b30ced`)+ graphify 地圖增量 + 本交接。

## 2. Commit 序列(push 狀態寫死)

| commit | 內容 | push |
|---|---|---|
| `4a02330` | docs:E1a prod 驗證 PASS、STATUS 對齊 | ✅ 已推 |
| `7b30ced` | feat:E1b ports/adapters/組裝層+32 測 | ✅ 已推 |
| (本交接檔+CURRENT) | docs:交接 | 見 §6 |

三綠 typecheck/lint/build+完整 vitest **221 檔 2361 綠**(+3 檔+32 測)。origin/main=`13ce3a9` 未動(storefront production 不含本線);admin production 跟 dev 重部署=只帶未被引用的新零件、零行為變更。

## 3. DB / 部署 / 外部足跡

- **E1a migration `20260717020000` 已 apply 於 prod**(list_migrations 核實);本 session 對 prod 只做驗證(全 rollback、residual_rows=0、表+6 索引在)。
- E1b **無** migration、無資料寫入、無部署動作、無新 env(`ORDER_EMAIL_FROM` 是 E3 前 Sean 手動項、兩個 Vercel project 都要設)。

## 4. graphify 地圖增量

動了 packages code → 已刷(cwd=repo 根、相對路徑、純加法):**5250→5337 nodes / 8712→8850 links / 366→383 communities**(+87 節點+138 邊);前綴驗證 PASS(`packages_ports_src_iemailoutbox_ts` 與既有 `packages_ports_src_*_ts` 同型、零 `private_tmp_*` 污染、零敏感節點)。備份=session scratchpad `graph.json.bak`(session 結束即失,已驗過不需回滾)。

## 5. 開放項(待辦)

- ⏳ ~~**E2a(下一片、接手主工作)**:sweeper route+對帳補寄+**dead-man 四訊號**+lease 回收+failed 告警+單測。~~
  🔴 **本句四處已過期(E2a-a 更正、2026-07-17)**:①**E2a 已由 Sean Q12=A 拆三片**=**E2a-a**(零件層:port `reclaimStaleLeases`+adapter 回收,✅ 已完成)→ **E2a-b**(退避政策+sweeper use-case)→ **E2a-c**(route+composition);②**對帳補寄 = E2a-2**、不在 E2a;③**四訊號 → 五訊號**(§⑨ 增補額度耗盡)且**五訊號全歸 E2a-2 的獨立管道**;④**Sean Q13=A:E2a 三片皆不做 failed 告警**(sweeper 不可自我監看)。以下硬合約仍有效:
  - 🔴 **照 `IEmailOutbox` port 用、勿自寫 SQL 繞過**(attempts guard/世代柵欄/claimed_at 清空已內建於 adapter;繞過=把 8 輪+2 輪審查的成果作廢)。
  - ✅ **已由 E2a-a 定案、本兩行字面已過期**(2026-07-17;權威=migration `20260717020000` 頭註 **§⑩**):
    ~~定案「attempts 遞增時機 × 回收落 pending 或 failed」時必須回頭過 plan §3.6 訊號表~~ → **義務已履行**(結論=零盲區、`pending@max` 不可達);
    ~~lease 回收**翻 pending**時不清 attempts~~ → **Sean Q2=A:回收落 `failed`、不是 pending**(+`last_error_code='lease_reclaimed'` 覆寫舊碼;attempts 不動、必清 claimed_at 不變)。實作=port `reclaimStaleLeases`。
  - 🔴 回收器跑在 sweeper 裡=已知「不可自我監看」限制,靠訊號 3 兜(此行仍有效)。
  - 「哪些訂單狀態算 ineligible」= **E2a-2 定案**(⚠️ 本行原寫「本片定案」= 依 plan §5 拆片表已過期);轉入必寫 `last_error_code='order_ineligible'`+抑制路徑必附測試。
  - composition:service_role client 窄 cast 為 `EmailOutboxClient`、`syntheticEmailDomain` 從 `line.ts:38` 注入;走 line-admin 式 server-only 模組(`apps/storefront/src/lib/auth/line-admin.ts` 為範例;放 storefront=plan Q7 裁示)。
  - 審查閘=code-reviewer+**codex 關卡2**(plan §5/§6 明定)。
- ⏳ E2b→E3→E4 依 plan §5 順序;**部署順序不可調**(E2a 部署→Vercel secret→Vault 同值→db push E2b→驗→才 E3)。E3 另記:enqueue 必須全 catch(組裝層驗證也會 throw)、不影響付款;文案字面先給 Sean 過目。
- 🔴 Sean 手動項(未動):`ORDER_EMAIL_FROM` 兩 project(E3 前)、pg_cron/pg_net 啟用+Vault secret(E2b 時)、E3/E4 肉眼驗。
- carry-over:STATUS「Sean 待決策」①Vercel 升 Pro ③S4 ACL 可否決 ④LINE 補資料線前置;memory index 19.6KB 近上限=**milestone 收尾家事**(每條一行精簡,勿在 slice 中混做)。

## 6. push 狀態與收尾自檢

feature 全推(origin/dev=`7b30ced`);本交接檔+CURRENT.md 更新後以 docs commit 收尾(見 STATUS 最近 commit 表)、推不推由 Sean 定。凍結 dirty(`.gitignore`/`*.png`/docs 群/`docs/superpowers/`)原封未動、接手不得 reset/stash/混入。secret 掃描:本檔+diff 零金鑰零連線字串;graph.json 零敏感節點。
**接手 1-2-3**:①讀 STATUS「下一步」+本檔 §5 ②讀 plan §3.5b/§3.6/§4.2+migration §⑦§⑧+`IEmailOutbox.ts` ③E2a 偵察 pass(anomaly-alert route 骨架+lease 回收落點決策)→ slice plan → 動工。

## 相關 plan / 記憶 / 文件

plan v3.1(docs/specs/2026-07-16-m4a-email-notify-plan.md)、migration `supabase/migrations/20260717020000_m4a_email_outbox.sql`、memory `project_m4a-email-e1a-decisions`(含 E1b 段+E2a/E3 義務)、`project_m4a-email-notify-decisions`、前交接 `docs/handoff/2026-07-17-m4a-email-e1a-handoff.md`(⚠️ §1/§3 已被本 session 超越)。

— E1a 驗證+E1b 實作視窗(Claude Code),2026-07-17
