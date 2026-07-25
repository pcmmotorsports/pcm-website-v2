# SESSION HANDOFF — 2026-07-25 RF2a-0 + S2 pg_cron 上線(ops 片、零業務 code)

> **一句話結果**:RF2a-0(orders 凍結運費規則三欄 + 該表第一個 trigger)與 S2(sweeper 搬 Supabase pg_cron)**已 apply production 並全數驗證通過,含真刷 `PCM-2026-0104` 端到端驗證**。另依 Sean 拍板把 MCP `apply_migration` 改為 `ask` 以斷絕 migration 版本漂移。
> **push 狀態**:🔴 **本 session 全程未執行 `git push`**;但 `origin/dev` 已於 `2026-07-25 16:22:35 +0800` **由外部 push 更新**(並行 session 或 Sean),故本 session 兩個 commit 現已在 remote。詳 §6。
> **環境**:repo `pcm-website-v2` · Supabase prod `bmpnplmnldofgaohnaok` · branch `dev` · 執行模式(非唯讀)。HEAD 收工時 = `5827dbf`(本 session 產出 = `f0388c0`、`7f8e3ed`)。
> **接手先讀**:`STATUS.md`「最後更新」最上一條 → `docs/handoff/CURRENT.md` 頂端 → 本檔 §3(DB 足跡,git diff 看不到)→ memory `project_rf2a0-freeze-shipping-decisions`、`project_supabase-migration-version-drift`。
> **前一份交接包** = `docs/handoff/2026-07-25-rf2a0-freeze-shipping-handoff.md`(其 §1/§3 runbook **已執行完畢**、檔頭已加狀態橫幅,勿再照做)。

---

## 1. 做了什麼(按時序)

1. **RF2a-0 apply 前交易模擬 ✅ PASS(零留痕)** — 交接包 §1 指定的接手第一個技術任務。
   手法 = MCP `execute_sql` 單次呼叫:`BEGIN` → migration 可執行語句逐字 → 合成 INSERT → **結尾刻意 `RAISE`**。
   刻意 RAISE 的用意:即使 `ROLLBACK` 那行因故沒跑到,交易已進入 abort 狀態、**物理上不可能 commit**(沿用 E1a「單語句原子 rollback」保證)。
   🔴 **最有價值的一項**:合成兩筆單走「具名 31 欄」INSERT(= `create_order` 的形狀、**不列三新欄**)→ **三新欄全由 DEFAULT + trigger 補上、兩筆都成立** ⇒ **B3「零 `create_order` 改動」由推論升級為實跑證實**。
   負向測試:往快照欄寫 `bogus` → `check_violation`(CHECK 真的擋)。
   **兩道 apply 閘實測 0/0**(稽核真改動 0、fee↔method 不自洽 0)。

2. **Sean 拍板 A — 接受兩項殘餘風險**(交接包 §4 原標「擋 apply」的閘至此解除)。逐項白話說明後取得明確拍板;拍板落 memory。

3. **`db push` 兩次失敗才成功 —— 🔴 兩次都不是程式問題**(詳 §3)。

4. **三支 migration apply production**:`20260723120000`(S2)→ `20260724140000`(K-SPEED,空轉)→ `20260725120000`(RF2a-0)。

5. **apply 後獨立驗證全綠**(**不採信 migration 自印的 NOTICE**,另起 catalog 查詢逐項比對)。

6. **S2 端到端實證** —— 非手動戳,是**排程自己跑出來的**(詳 §3)。

7. **Sean 真刷 `PCM-2026-0104` → 驗證通過**,RF2a-0 最後一道關卡結案(詳 §3)。

8. **機制:MCP `apply_migration` 改 `ask`(Sean 拍板 B)** — commit `7f8e3ed`。
   Sean 明示理由:「不懂 Supabase 也不懂寫程式」,要**保留 Supabase + Claude 結合的彈性**(preview branch 快速套用),故選 `ask` 不選 `deny`。
   決策全文與理由鏈寫進 `.claude/settings.json` 的 `_migration_drift_note`(對齊該檔既有 `_*_note` 慣例),下一個 session 打開就看得到、不會被無故改回。

---

## 2. Commit 序列(push 狀態寫死)

| commit | 內容 | 作者 |
| --- | --- | --- |
| `f0388c0` | docs(docs): RF2a-0+S2 已 apply production + 交易模擬與驗證紀錄 [M-3] | **本 session** |
| `1dcef06` | docs(docs): 66 檔一次性產物封存 archive + 路由表補登兩行 [M-4a] | ⚠️ **並行 session,非本 session** |
| `7f8e3ed` | chore(config): MCP apply_migration 改 ask 防 migration 版本漂移 [M-3] | **本 session** |
| `5827dbf` | docs(docs): STATUS 最近 3 commit 表補上 f0388c0 [M-4a] | ⚠️ **並行 session,非本 session** |

- **本 session 零業務 code commit**(只動 `.md` + `.claude/settings.json`)。零 migration 新增、零 TS/TSX。
- `7f8e3ed` **一併帶入工作區既有的 `enabledPlugins.ponytail` 條目** —— 該筆為 07-25 裝外掛時產生、非本 session 撰寫,因 git 以檔為單位暫存故同批進入(commit body 已註明)。
- ✅ 已驗本 session 兩個 commit **內容純淨**(`git show --stat`:`f0388c0`=3 檔全 docs、`7f8e3ed`=1 檔 settings.json),**未被並行 session 的檔案污染**。
- 🔴 **多 session 共用 `dev`,接手前務必先 `git fetch`**。

---

## 3. DB / 部署 / 外部足跡(非 git,接手看不到 diff)

### 3.1 三支 migration 已 apply production(不可逆)

| version | 檔名 | 內容 | 可重跑 |
| --- | --- | --- | --- |
| `20260723120000` | `m3_s2_settle_sweep_pgcron` | `pcm_cron` 私有 schema + Vault-backed SECDEF wrapper + 兩個 `cron.job` | 是(idempotent) |
| `20260724140000` | `seed_kspeed_brand` | K-SPEED 品牌列 | 是(`ON CONFLICT DO NOTHING`;本次實為**空轉**,該列 07-24 已存在) |
| `20260725120000` | `rf2a0_orders_freeze_shipping_rule` | `orders` 三欄 + 該表**第一個 trigger** + 兩條 CHECK | 是(每段皆 idempotent) |

**Rollback**:RF2a-0 為 forward-only。apply 後已有新訂單(`PCM-2026-0104`),**DROP 欄位會永久丟失其歷史快照** ⇒ 非緊急勿動;真要回滾的指令見 migration 檔頭註解。

### 3.2 🔴 `db push` 兩次失敗的根因與修法(接手最可能重蹈)

**(a) migration 版本漂移** —— K-SPEED seed 於 07-24 由某 session 走 **MCP `apply_migration`** 套 prod,MCP **以套用當下的時鐘自動重新編號**為 `20260724085956`,與本地檔名 `20260724140000` 對不上 ⇒ `db push` **全面罷工**(正確行為,但爆在正式上線當下)。
修法:`supabase migration repair --status reverted 20260724085956` → 由 `db push` 正式套用該檔。
🔴 **完整比對交給 DB 做、別目視**:CLI 只點名第一個問題;把本地檔名清單餵成 `VALUES` 與 `supabase_migrations.schema_migrations` 雙向 anti-join,才拿得到完整答案(當次 = remote **76** / local **78**、**remote-only 恰 1、local-only 恰 3**)。⚠️ 我目視數 remote 得 75(**錯**),SQL 得 76 —— **自己數的數字不算來源**。
**已上機制**:MCP `apply_migration` 改 `ask`(§1-8)。

**(b) 舊版號被擋第二次** —— S2 版號 `20260723120000` **早於**已套的 07-24 兩支 ⇒ CLI 拒絕插隊,需 `--include-all`。加旗標前已確認 S2 / 法律頁 / RF2a-0 三者**彼此無先後依賴**。

最終成功指令(Sean 手動執行):
```bash
cd /Users/sean_1/pcm-website-v2 && mv .env.local .env.local.bak && { supabase db push --include-all; mv .env.local.bak .env.local; }
```

### 3.3 apply 後獨立驗證(全綠;不採信 migration 自印 NOTICE)

**RF2a-0 結構**
- 三欄:`shipping_free_threshold=integer/notnull=true`、`shipping_home_fee=integer/notnull=true`、`shipping_method_at_checkout=text/notnull=true`
- DEFAULT **逐字** `5000` / `100`
- 兩條 CHECK(`orders_shipping_rule_non_negative`、`orders_shipping_method_at_checkout_whitelist`)皆 `convalidated=true`
- trigger `orders_freeze_shipping_snapshot_bi`:`enabled=O` + `tgfoid=orders_freeze_shipping_snapshot()` + `BEFORE INSERT FOR EACH ROW`(`tgtype&7=7`)

**回填(33 筆)**:快照 ≠ method **0 筆**、規則值錯 **0 筆**、快照為 NULL **0 筆**。

**S2**:`pcm_cron` schema + `invoke_cron_route`(`prosecdef=true`);兩 job `active=true`(`pcm-settle-sweep */2 * * * *`、`pcm-anomaly-alert 0 1 * * *`);**anon 與 authenticated 皆無 EXECUTE、anon 無 schema USAGE**(fail-closed 成立)。

### 3.4 🔴 S2 端到端實證(排程自己跑的,非手動觸發)

```
cron.job_run_details : pcm-settle-sweep :: succeeded :: 07:56:00 UTC   (失敗 0 次)
net._http_response   : status_code=200
                       body {"ok":true,"enabled":false,"skipped":"sweeper_disabled"}
                       error_msg=null
net.http_request_queue = 0        ← Authorization 未滯留(codex 對 S2 的 F8 疑慮實測清除)
```
⇒ pg_cron → wrapper → vault 取鑰匙 → 帶 Bearer 打正式站 → **200**,且 flag 正確為**關**。

### 3.5 🔴 真刷驗證 `PCM-2026-0104`(RF2a-0 最後一道關卡,已結案)

```
payment_status = paid | created_at 2026-07-25 08:06:28 UTC
shipping_method = home  →  shipping_method_at_checkout = home     ✅ 快照正確
shipping_free_threshold = 5000 | shipping_home_fee = 100          ✅ DEFAULT 正確
subtotal 1080 + shipping_fee 100 = total 1180                     ✅ 與凍結規則自洽
```
⇒ **真實客人路徑走 `create_order` 時,新 trigger 正常運作、未破壞結帳**;且 `create_order` **未改一行** 三新欄就填好了(B3 在真實路徑成立)。
**金額 NT$1,180 為真扣款,Sean 已自行於 TapPay 後台退款(2026-07-25 回報「已退款」)**;退款自動化尚未實作(=RF 線的目標)。

### 3.6 新增的常態背景行為(接手須知)

- `pcm-settle-sweep` **每 2 分鐘**對正式站發一次 HTTP 請求(flag 關 ⇒ 回 `skipped`)。
- 每次會在 `net._http_response` 留一列,**pg_net 自帶 6 小時 TTL、會自動消失**。
- `cron.job_run_details` 會持續累積 ⇒ 已有 backlog **#282**(清理 job)。

### 3.7 未動的東西(明確聲明)

**未開任何 flag**(3DS / `CRON_SWEEPER_ENABLED` / `ANOMALY_ALERT_ENABLED` 全維持關)、**未動 `.env*`**、**未 deploy**、**未改任何業務程式碼**。

⚠️ `.env.local` 完好已驗:無 BOM(開頭 `# M-1-`)、14 行 1891 bytes、10 個 key 與 push 前一致、`.env.local.bak` 無殘留。
`supabase migration list` 報 `unexpected character '¿' in variable name` = **CLI 的 env 解析器吃不下檔內中文註解的既知現象**(memory `reference_supabase-cli-reads-env-local-blocker`),**非本次弄壞**;正因如此 runbook 才要把該檔暫時搬開。

---

## 4. graphify 地圖增量

**地圖未動。** 原因:本 session **零 code 變更** —— 只動 `.md`(STATUS / CURRENT / handoff)與 `.claude/settings.json`,未觸及 `apps/` `packages/` `supabase/migrations/` 等觸發範圍。依 skill 步驟 2「純 DB / 只動 docs → 跳過並註明」。

⚠️ **既有已知漂移(carry-over,非本次造成)**:`graphify-out/` 索引自 2026-07-22 起即過期(查詢結果仍含 U2b 已刪除的 `CheckoutStep3.tsx`)。規劃連動面時**以全樹 grep 為準**,不得採信 graphify 輸出。刷圖屬 milestone 收尾工作。

---

## 5. 開放項(待辦)

### 🔴 需 Sean 親自做 / 拍板
1. **STATUS.md `## Blocker` 欄有一行已過期**(本 session **刻意未改**):仍寫「M-3 prod checkout 仍不可開:真刷卡待 sandbox 3DS E2E」,但 sandbox 路線 07-24 已作廢、真刷已成功兩筆。**未改的理由**:要改就得順帶斷言 3DS flag 目前狀態,而該值在 Vercel、本 session 查不到 ⇒ **不憑印象寫進 SSoT**。接手請先查證 flag 再改。
2. **RF2a-0 的兩項殘餘風險已由 Sean 拍 A 接受**,但風險①的實務要求要傳給未來改運費的人:改規則時「新 `create_order`」與「欄位 `SET DEFAULT`」必須放**同一支 migration 並自己包 `BEGIN/COMMIT`**(本 repo 已實證 `SET LOCAL` 在 migration 內是 no-op)。已寫進交接包 §4 與 PRD §4b。

### ⏳ 接手可做
3. **下一片 = RF2a**(退款帳本 `order_refunds` 表 + `bank_refund_id` 唯一鍵 ≤20 字元 + `partiallyRefunded` enum;Q1=A、收 backlog #26)→ **需 Sean db push**。逐片起手見 `docs/handoff/2026-07-25-rf1-refund-engine-handoff.md` §5。
4. **backlog #294**(S2 殘餘:`CRON_SECRET` 三 route 共用,含無 flag 的 email-sweep)。
5. **backlog #282**(`cron.job_run_details` 清理 —— **現在真的有對象了**,S2 已 apply)。

### 已決不做(勿重提)
6. **CI 版 migration 漂移偵測 = 不做**。理由:`supabase_migrations` schema **不在 Data API 曝露清單**(07-25 實測 PostgREST 只曝 `public` + `graphql_public`)⇒ CI 要比對就得把 prod DB 密碼放進 GitHub Secrets,為一個診斷檢查新增高價值機密的攻擊面、不划算。**改以斷因(`ask`)取代偵測**,Sean 拍板 B。

### carry-over(舊 handoff 仍懸)
7. `/terms` `/privacy` 渲染後 payload Sean 尚未逐字肉眼看過(drift `legalRenderedPayloadNotEyeballed`)。
8. 搜尋線 E0:`pg_jieba` 在 Supabase 裝不了、ADR-0004 路線作廢,四題待 Sean(`docs/specs/2026-07-25-search-engine-options-recon.md` §5)。
9. S4 開 flag(正式金鑰 + 3 個 flag)仍是 Sean 手動;**S2 已備好基礎設施,S4 才真兜底**。

---

## 6. push 狀態與收尾自檢

### push 狀態(誠實版)
🔴 **本 session 從未執行 `git push`**。但收尾時實測 `origin/dev` = HEAD = `5827dbf`、**未推 0** ——
`git reflog show origin/dev` 顯示 `5827dbf ... 2026-07-25 16:22:35 +0800: update by push`,**由本 session 以外的來源推送**(並行 session 或 Sean 本人)。
⇒ 本 session 的 `f0388c0`、`7f8e3ed` **現已在 remote**,但**不是我推的**。
⚠️ 這與 2026-07-19 的 push 事故同型(STATUS 有記載):**`dev` 是線性共用分支,單線「不自動 push」的自律擋不住並行 session**。

### ⚠️ 並行 session 警告(接手第一眼)
本 session 進行中,**另一個 session 同時在同一 repo commit 並 push**(`1dcef06` 封存 66 檔 + 動 `CLAUDE.md`、`5827dbf` 補 STATUS 表)。
已驗本 session 兩個 commit 內容純淨、未被污染,但 memory `project_parallel-sessions-shared-git-index-collision` 記載過更嚴重的撞車(檔案被另一 session `git stash` 掃掉)。
🔴 **建議**:接手前先確認只有一個寫入 session;`git add` 一律帶精確 pathspec、add 完立即 commit。

### 收尾自檢
| 項 | 結果 |
| --- | --- |
| `git status` clean | ✅ 乾淨,無 `.env*` / 大檔 / `.DS_Store` 殘檔 |
| 待推 | ✅ 0(但非本 session 推的,見上) |
| Secret 0 洩漏 | ✅ diff / commit msg / 本檔全文無連線字串 / key / token;vault 值全程**只取長度與布林**、未輸出明文 |
| DB / 部署足跡 | ✅ §3 完整(三支 migration + 兩個常態 cron + 真刷單) |
| graphify | ✅ 未動 + 原因已註明(零 code 變更) |
| 開放決策歸位 | ✅ §5 分四類、標阻塞性與由誰 |
| 驗證留痕 | ✅ §3.3/§3.4/§3.5 皆為**實跑輸出**(catalog 查詢、cron 執行紀錄、真訂單欄位),非自述 |

### 下個 session 進入點(1-3 步)
1. `cd /Users/sean_1/pcm-website-v2 && git fetch && git branch --show-current && git status --porcelain && git log --oneline -5`(預期 `dev` / clean / HEAD 對齊 `STATUS.md`)。
2. 讀 `STATUS.md`「最後更新」最上一條 + `docs/handoff/CURRENT.md` 頂端,確認 RF2a-0/S2 已上線。
3. 開 **RF2a**(退款帳本):起手讀 `docs/handoff/2026-07-25-rf1-refund-engine-handoff.md` §5 + PRD `docs/specs/2026-07-24-refund-automation-line-prd.md`。⚠️ 高風險片(鐵則 12 ①錢 ③DB),需 plan → 審查鏈 → Sean db push。

---

## 相關 plan / 記憶 / 文件

- **PRD 真權威**:`docs/specs/2026-07-24-refund-automation-line-prd.md`(§0b/§0c 六拍板、§4 拆片、§4b RF2a-0 B3 理由與殘餘風險表)
- **前一份交接包**:`docs/handoff/2026-07-25-rf2a0-freeze-shipping-handoff.md`(§1/§3 已執行完畢、檔頭有狀態橫幅)
- **RF1 交接包**:`docs/handoff/2026-07-25-rf1-refund-engine-handoff.md` §5(RF2a 逐片起手)
- **S2 runbook**:`docs/specs/2026-07-23-m3-s2-sweeper-pgcron-plan.md` §11
- **memory**:`project_rf2a0-freeze-shipping-decisions`(拍板 + 交易模擬全紀錄)、`project_supabase-migration-version-drift`(**已補 07-25 第二次復發段 + ask 機制決策**)、`reference_supabase-cli-reads-env-local-blocker`、`reference_supabase-rls-schema-test-txn-simulation`、`project_m3-s2-sweeper-pgcron-decisions`
- **設定檔決策**:`.claude/settings.json` → `_migration_drift_note`(為何 ask 不 deny、為何不做 CI 偵測、誠實邊界)
