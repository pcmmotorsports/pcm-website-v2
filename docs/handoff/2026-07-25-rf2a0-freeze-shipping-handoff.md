# 交接包 — RF2a-0 收工 + DB 上線 runbook + 搜尋線待拍(2026-07-25 深夜)

> **給接手 session**:本檔是「接著做什麼」的唯一入口。起手照 `CLAUDE.md` 開工儀式。
> 真權威仲裁序 = 可驗證事實 > `STATUS.md` > `docs/handoff/CURRENT.md` > 本檔 > 歷史。
> 前一份交接包 = `docs/handoff/2026-07-25-rf1-refund-engine-handoff.md`(RF1;§1/§2 已標過期)。

---

## 0. 起手狀態(接手第一件事:核對)

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status --porcelain && git log --oneline -3 && git rev-list --count origin/dev..HEAD
```

預期:branch=`dev`;工作區**只有** `.claude/settings.json` 一項 dirty(**非本線產物、session 起手即存在,不要動它**);
HEAD=`a698ba8`;**未推 2 個 commit**(`0673312` gate anchor、`a698ba8` RF2a-0)。

🔴 **push 是 Sean 的手動動作**,任何 session 不得代推或主動提議。

---

## 1. 🔴 接手當下唯一的「進行中」工作:等 Sean 完成 DB 上線前置

RF2a-0 **code 已收工並 commit,但從未在任何資料庫實跑過**(含 preview branch)。
apply 由 Sean 手動,而且**卡在兩件他必須先做的事**(見 §3 runbook)。

**接手 session 在 Sean 說「前置做完了」之後要做的事(順序固定)**:

1. **交易模擬**(PCM 規則 R5:DB 片必跑)—— 🔴 **本 session 尚未做**,是接手的第一個技術任務:
   - 方式:MCP `execute_sql` 跑 `BEGIN;` → RF2a-0 migration 全文 → 驗證(三欄形狀 / trigger / 回填結果)→ `ROLLBACK;`
   - ⚠️ 陷阱:①RF2a-0 **自己沒有** `BEGIN/COMMIT`(可安心外包 txn;S2 那支自帶、不可比照)②會對 live `orders` 取 ACCESS EXCLUSIVE(33 列、微秒級,但**挑低流量**)③跑完必驗零留痕(`shipping_free_threshold` 等三欄**不應**存在於 catalog)。
   - 相關 memory:`reference_supabase-rls-schema-test-txn-simulation`、`project_m4a-email-e1a-decisions`(模擬兩陷阱)、`reference_pooled-mcp-set-role-secdef-terminates`。
2. 模擬綠 → 告知 Sean 可以 `db push`(指令見 §3 步驟 E)。
3. push 後陪他跑 §3 的「apply 後驗證」——🔴 **含 1 元商品真刷 smoke**:這是唯一能證明「新 trigger 沒有把結帳弄壞」的觀察。
4. 之後才進 **RF2a**(退款帳本 `order_refunds`,見 RF1 交接包 §5)。

---

## 2. RF2a-0 做了什麼(接手不必重讀 migration 也能接上)

`supabase/migrations/20260725120000_rf2a0_orders_freeze_shipping_rule.sql`(新增)在 `public.orders` 加:

| 欄位 | 型別 | 怎麼填 |
| --- | --- | --- |
| `shipping_free_threshold` | `integer NOT NULL DEFAULT 5000` | 由 DB DEFAULT(**零 `create_order` 改動** = B3 路線) |
| `shipping_home_fee` | `integer NOT NULL DEFAULT 100` | 同上 |
| `shipping_method_at_checkout` | `text NOT NULL` + CHECK `IN ('home','store')` | 由 🆕 **BEFORE INSERT trigger** `orders_freeze_shipping_snapshot_bi` 填(= `orders` 上**第一個 trigger**) |

- **為何要第三欄**(Sean 2026-07-25 明示「我可能會改運送方式,**非常有可能**」):運費金額**回推不出**原方式 —— 存 100 必為「宅配未達免運」;**存 0 可能是自取、也可能是宅配滿額免運**。後台把 home 改 store 後,RF5 若按當下 method 算(store→0)會少扣運費 = **多退錢**。DEFAULT 不能引用同列其他欄位 ⇒ 只能 trigger。
- **執行順序是安全核心**:加欄(方式欄可 NULL)→ 建 trigger → 回填 + `SET NOT NULL`(**同一個 DO block**)→ CHECK → schema 自檢。🔴 **不可**把 `SET NOT NULL` 提前到 trigger 之前(Fable F1:半套用會留下「必填已生效、trigger 不存在」⇒ 之後每筆結帳 INSERT 都失敗)。
- **回填前置斷言(apply 當下評估、任一不成立即 RAISE 拒套用)**:①`admin_audit_log` 內「真的改過 `shipping_method`」筆數 = 0 ②每列 `shipping_fee` 與 `shipping_method` 自洽。
  🔴 **⇒ 在 apply 之前,Sean 不要去改任何訂單的配送方式**;若已改過,migration 會拒絕套用(這是刻意的),要人工從稽核逐筆還原原值。
- `#216` drift gate 擴為**三方**(TS 常數 ↔ `create_order` §7 CASE ↔ 欄位 DEFAULT),並改用**引號感知 SQL 掃描器**;anchor 語意 = 對照「最新一支**定義/設定**該對象的 migration」,**抓不到就紅、絕不回退舊檔**。
- PRD 補 `§4b`(B3 理由 + 殘餘風險表 + 第三欄決定),並校正 `§0c`/`§4` 的舊字面。

**驗證數字(本 session 實跑)**:三綠 typecheck 8/8 · lint 10/10 · build 2/2(0 cached)、full test **252 檔 2930 passed + 1 todo**、gate 10/10、**突變 8 組於最終版實測**(6 紅 + 2 應綠)。
**審查鏈**:codex 關卡2 R1 FAIL 9 → R2 FAIL 10(2 輪上限用盡)→ Sean 拍 A 改派 **adversarial-reviewer(Fable)R1 NO-GO 4 must-fix + 2 consider + 8 nit** → 全折入 → **Fable R2 GO**(+2 新 nit 已清)。

---

## 3. 🔴 Sean 的 DB 上線 runbook(權威;本檔與 S2 plan §11 並用)

`db push` 會**依序**套用**兩支**待套 migration:先 `20260723120000`(S2 pg_cron)再 `20260725120000`(RF2a-0)。
S2 那支有**前置閘**,secret 沒建好會 `RAISE` 而**擋住整個 push** ⇒ 必須先做 A-D。

### A. Vercel 設 `CRON_SECRET`(≥32 字元)
```bash
cd /Users/sean_1/pcm-website-v2 && vercel env add CRON_SECRET production
```

### B. Supabase Dashboard → Database → Extensions:啟用 `pg_cron` + `pg_net`(GUI)

### C. Supabase SQL Editor:存兩個 vault secret(逐字取自 S2 plan §11 步驟 3)
`cron_base_url` = 正式站 storefront origin、**無尾斜線**(cron 路由在 `apps/storefront/src/app/api/cron/*`;
STATUS 記錄 `shop.pcmmotorsports.com/terms` 實測 200 ⇒ 即 `https://shop.pcmmotorsports.com`,**請以 Vercel Dashboard 的 production domain 為準再確認一次**)。
`cron_secret` = 與 A 步的 `CRON_SECRET` **同值**。

```sql
DO $$
DECLARE v_id uuid; v_name text; v_val text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['cron_base_url','cron_secret'] LOOP
    v_val := CASE v_name WHEN 'cron_base_url' THEN 'https://正式站網域' ELSE '與Vercel_CRON_SECRET同值' END;
    IF (SELECT count(*) FROM vault.secrets WHERE name=v_name) > 1 THEN
      RAISE EXCEPTION '% 有多筆、請先清理', v_name; END IF;
    SELECT id INTO v_id FROM vault.secrets WHERE name=v_name;
    IF v_id IS NULL THEN PERFORM vault.create_secret(v_val, v_name);
    ELSE PERFORM vault.update_secret(v_id, v_val); END IF;
  END LOOP;
END $$;
```

### D. ✅ **已完成(2026-07-25 實測)**:Data API 曝露 schema 不含 `net`/`cron`/`vault`

S2 plan §11 原本把這條列為「人工看 Dashboard 硬核」。**已改成機械驗證**(機制優先律):
`authenticator` 角色的 `rolconfig` 內**沒有** `pgrst.db_schemas`(⇒ 由 Dashboard 管、SQL 讀不到,S2 plan 這點正確),
但可以**從外面問 PostgREST 自己**——它會在錯誤訊息裡列出完整曝露清單:

```bash
curl -s -H "apikey: <publishable-key>" -H "Authorization: Bearer <publishable-key>" \
  -H "Accept-Profile: net" \
  "https://bmpnplmnldofgaohnaok.supabase.co/rest/v1/products?select=id&limit=1"
```
(publishable key 取得:Supabase MCP `get_publishable_keys`,或直接讀 client bundle —— 它本來就是公開值、不是 secret)

**2026-07-25 實測輸出**:`HTTP 406` + `PGRST106` + `"Only the following schemas are exposed: public, graphql_public"`
⇒ `net` / `cron` / `vault` **均未曝露、S2 的安全必要條件成立**(對照:`Accept-Profile: public` 回 `HTTP 200`,證明這個測法本身有效、不是一律 406)。
🔴 **這條在每次改 Dashboard 曝露設定後要重驗**;可考慮收成 backlog 做成 CI 檢查。

~~原步驟:Dashboard → Project Settings → Data API → Exposed schemas 人工確認~~
(若要人工複核:`https://supabase.com/dashboard/project/bmpnplmnldofgaohnaok/settings/api` → **Exposed schemas** 欄位,應只有 `public`、`graphql_public`)

### ⏸ 這裡停一下:等接手 session 跑完 RF2a-0 交易模擬(§1 第 1 點)再 push

### E. db push(這行保證會把 `.env.local` 還原,即使 push 失敗)
```bash
cd /Users/sean_1/pcm-website-v2 && mv .env.local .env.local.bak && { supabase db push; mv .env.local.bak .env.local; }
```
```bash
cd /Users/sean_1/pcm-website-v2 && test -f .env.local && echo env-restored-ok && supabase migration list | tail -5
```
⚠️ 若沒印出 `env-restored-ok`:先跑 `mv .env.local.bak .env.local` 再做別的事。

### F. apply 後驗證
1. **S2 連通實證(6h 內,S2 plan §11 步驟 6)**:`select pcm_cron.invoke_cron_route('/api/cron/settle-sweep')` 取 request_id → 查 `net._http_response` 該筆為 **200** + body `{enabled:false,skipped:'sweeper_disabled'}`;`cron.job_run_details` 有成功列;`select count(*) from net.http_request_queue` 應為 **0**。
2. **RF2a-0 結構驗證**:三欄存在且 `NOT NULL`、DEFAULT 逐字 `5000`/`100`、兩條 CHECK `convalidated`、trigger 存在且 `tgenabled='O'`。(migration 自己的 §6 自檢已驗這些;套用成功就代表通過,失敗會 RAISE。)
3. 🔴 **1 元商品真刷 smoke(必做)**:這是唯一能證明「新 trigger 沒把結帳弄壞」的觀察 —— 下一筆真訂單成立後,查它的 `shipping_method_at_checkout` 有值且等於 `shipping_method`。**這一步不可跳**:整支 migration 從未實跑過。
4. S2 plan §11 步驟 7:確認含 `vercel.json` 移除兩 crons 的 production deploy 已完成、Vercel Dashboard crons=0(**S4 開 flag 的硬前置**)。

---

## 4. 🔴 兩項殘餘風險(擋 apply、不擋 commit;**尚未經 Sean 拍板接受**)

| # | 風險 | 何時會咬人 | 目前緩解 |
| --- | --- | --- | --- |
| 1 | **秒級部署窗**:改運費規則需同時改「TS 常數 + 新 `create_order` migration + 欄位 `SET DEFAULT`」;「同一支 migration」本身**不保證原子**(本 repo 實證 `SET LOCAL` 是 no-op ⇒ 逐句 autocommit) | **改運費那天**(年 0-1 次) | 三方 gate 擋漏改;規則變更時把兩句放同一支 migration **並自己包 `BEGIN/COMMIT`** |
| 2 | **回填盲區**:繞過後台、**直接用 SQL** 翻轉某單的配送方式**且**維持 `shipping_fee` 自洽(例如 store→home 且 subtotal ≥ 5000,兩者 fee 都是 0)⇒ 兩道 apply 斷言都抓不到、該單回填出錯快照 | apply 當下(需人為手動改過 prod 資料) | 無;**機率低但非零**,已寫進 PRD §4b |

⇒ 接手 session 應在 Sean push 前**再確認一次**他知情接受這兩項。

---

## 5. 另一條線:站內搜尋(E0)—— 🔴 地基已被推翻、等 Sean 拍板

- 🔴 **`pg_jieba` 在 Supabase 裝不了**(實測:不在該專案 80 個可用擴充清單內)⇒ **ADR-0004 的「tsvector + pg_jieba」路線作廢**。memory `reference_supabase-no-pg-jieba-use-pgroonga`。
- **可用替代(皆可裝未裝)**:`pgroonga` 3.2.5(Supabase 官方文件明列為中日文全文檢索方案)、`pg_trgm` 1.6、`rum`、`fuzzystrmatch`、`unaccent`。
- **兩份調研已落檔(scratchpad,重開機會消失 → 要留就搬進 repo)**:
  - `scratchpad/search-tooling-options.md`:前三名 = ①PGroonga+pg_trgm($0、裝在現有 Supabase)②Typesense Cloud(約 $22-30/月起、亞太節點最多、官方明寫簡繁皆支援)③Meilisearch Cloud(用的就是 jieba;但亞洲只有新加坡節點)。**Algolia 排不進前三**:中文只在查詢時分詞、索引時不分詞(官方原文),基礎方案機房無亞洲主節點。
  - `scratchpad/tw-ecom-search-research.md`:蝦皮全被反爬蟲擋(未確認);**PChome 對英文錯字有容錯但對中文品牌譯名完全查無**(搜「布雷波」找不到 Brembo);momo 對簡繁混用有「查無+相似推薦」。四平台**都查不到**官方技術棧一手證據。
  - 🔴 **最直接的啟示**:「英文品牌 ↔ 中文口語」平台級技術也沒解(PChome 這種規模都沒做)⇒ **必須自建品牌別名詞庫**,不是換引擎能解決的。
- **Claude 的建議(Sean 未拍板)**:先不花錢,走 PGroonga + pg_trgm + 自建別名詞庫;**先開 GA4 站內搜尋追蹤蒐集真實搜尋字**再決定。awoo 那類整包平台的客戶量級是「年度數位行銷預算 35 萬起」(取自其表單選項),不是現階段。
- **決策題原文見對話**(Q:只用 PGroonga / PGroonga+pg_trgm【推薦】/ 先不決定用真資料實測再拍)。

---

## 6. 本 session 已 commit(全部未 push)

| commit | 內容 |
| --- | --- |
| `0673312` | `#216` gate anchor 改對照「最新一支**定義** `create_order` 的檔」(codex 關卡2 R3 第 5 條;負向實測:新版 4 紅 / 舊版 6 綠) |
| `a698ba8` | **RF2a-0**:三欄 + `orders` 第一個 trigger + 三方 gate + PRD §4b |

🔴 **零 apply、零 DB 變更、零 flag、未動 `.env*`、未 push。**

---

## 7. 本 session 的流程教訓(接手請沿用)

1. 🔴 **重疊審查線只在「問不同的問題」時才有價值**:同一句「再跑第三輪審查」被貼進兩個並行視窗 → 兩邊各跑一次 codex(白付一次),findings 幾乎同一組;**只有多問「前兩輪的修法是否真的成立」的那邊**抓到 gate anchor 假綠。memory `feedback_single-review-session-avoid-parallel`。
2. 🔴 **並行視窗會改動同一批未 commit 檔**,連 `/tmp/*-base.sha` 這種凍結基準都會被改寫 ⇒ 「審查前凍結版本」會失效,而且 `git status` 前後比對會誤判成「codex 動了檔」。
3. 🔴 **codex 每片 2 輪上限用盡後,改派 `adversarial-reviewer` 帶 `model: fable`**(跨模型、不算 codex 輪次)比授權 codex R3 有效:Fable 抓到 codex 兩輪都沒抓到的順序缺陷(F1)與證據時效問題(F2)。
4. **回填/前置條件的證據必須寫進 migration、在 apply 當下評估**;規劃日查一次不算證明(TOCTOU)。
