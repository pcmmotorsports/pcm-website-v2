# L5b 補償退款 — 設計決策 + 片級 plan(**合併版 v5:兩表**)

> P 窗 / 2026-08-10。**本檔取代** `2026-08-10-l5b-decision-record-design.md`(v1/v2,保留供追線)。
> 🔴 **v5 全文對帳(三線審查同指的一條 must-fix)**:v3 是**單表**規格,而 L5b-1 的 migration
> 稱本檔為真權威 ⇒ L5b-2 的實作者會照 v3 的舊契約做。本輪把**核心點 2 的事件狀態機**、
> **核心點 4 的欄位規格**、**§2b 驗收**、**§3 誠實邊界**四段全部升成兩表版並逐欄對過 migration。
> ⛔ 已作廢的舊字面(**不要再引用**):`logical_refund_id` 欄 / `event_type='intent'` /
> 「`REVOKE UPDATE, DELETE` + claim-by-insert」的 append-only 機制 /
> 「`UNIQUE (logical_refund_id) WHERE …`」那組部分索引 / 「仍擋不住的**兩條**」/
> 「父表 insert-only + FK ⇒ 構造上即 DAG、不需要防環守門」。
> 🔴 **合併的理由**:v2 被審查指出「先自裁設計、再給 Sean 看 plan」等於**他看到 plan 時核心策略已定死**
> ⇒ 設計與片級 plan **併成一份**送核准(主視窗核 `P-313` §3)。
> 片型=**高風險片**(鐵則 12 ①錢 ③DB 結構)。
> **核准點有兩個**:①**設計形狀**(本檔,排 Sean)②**apply**(第二個獨立核准點,照舊規矩)。
>
> ## 🔬 plan 全綠 ≠ 設計成立(實作實跑抓到 plan 四輪都沒看到的兩條)
> L5b-1 的 harness **第一次實跑**就抓到:①`GRANT + zero-policy RLS` = **靜默死表**
> ②`REVOKE UPDATE/DELETE` 的 append-only **對 owner(唯一寫入者 SECDEF RPC)完全無效**。
> 四輪 plan 層審查(codex ×2 / Fable / confirm)全數沒看到 —— 不是不夠嚴,而是第二條要等
> **寫入路徑確定是 SECDEF** 才成立,那是實作時才定的。
> 🔴 **plan 層審查與實跑是兩種判別力,不能互相取代。**
>
> ## 🔬 這輪審查鏈的交叉驗證(主視窗指定記一句)
> **codex 與 Fable 兩條獨立審查線,各自撞上同一個問題:ownership 衝突。**
> codex 從「兩個 L5b worker」的角度看到;Fable 從「sweeper lease × genesis 收款確認」的角度看到。
> 🔴 **兩個不同模型、不同切入點、獨立得到同一結論** —— 這是本輪最強的一條 finding,
> 也是「換模型換角度」這條紀律的直接證據。

---

## 0. 這片要解決什麼(一句話)

被讓路(superseded)的舊付款授權,若事後其實有扣到錢 ⇒ **自動把錢退回去**。
它是 Sean **Q4=A「重付鈕等 L5b 上線才開」**的那個 L5b —— **做完它,重付鈕才能開**。

---

## 1. 🔴 要 Sean 核准的四個核心點(各附選項與推薦)

### 核心點 1 · 退款的 ownership 要怎麼避免「同時確認收款 + 退款」
**問題(Fable MF1 + codex MF2 交叉命中)**:被讓路的 attempt 是 `released`,而它**刻意留在對帳集**
(L5a-1 `:264-267` 重置 `next_settle_at`;R1c1/R1c2 讓 `released` 繞 ceiling 照常被 claim)。
⇒ 既有 sweeper 可以 claim 它、觀察到「已請款」、走 genesis `released→charged` **確認收款**;
**同一時間** L5b worker 若用自己的 claim,可以對同一筆**發動全額退款**。
⇒ 同一筆 attempt **同時被確認收款與退款** —— 🔴 **誤退比雙扣更糟**(雙扣客人會抱怨,誤退我們自己虧且難查)。

| 案 | 做法 | 代價 |
|---|---|---|
| **1-A(推薦)** | **沿用既有 lease**:L5b 退款一律先取 `claim_stuck_unsettled_attempts` 的同一把 lease(`next_settle_at` + `settle_attempt_count` token),不另開 claim | 要動既有 sweeper 的呼叫面(讀取層),但**不動它的判準** |
| 1-B | L5b 自己一套 claim + 在 sweeper 端加閘「`superseded_at IS NOT NULL` 的列 sweeper 不碰」 | 動到已 apply 的 sweeper 判準;且「兩套機制並存」本身就是下一個 bug 的溫床 |
| 1-C | 只做人工:L5b 只產報表,退款由人按 | 最安全但等於沒自動化;Q4=A 的「隔日自動退」承諾做不到 |

**推薦 1-A**。理由:**只能有一個 attempt-level ownership 機制**(兩線審查同一結論);
既有 lease 已經在跑、已被驗過,新開一套等於製造第二個真相。

🔴 **職責切開(confirm 輪 must-fix;也是我自己折兩線 findings 時造出來的矛盾)**:
| 機制 | 管什麼 | **不管**什麼 |
|---|---|---|
| **既有 lease**(`next_settle_at` + `settle_attempt_count` token) | **唯一的 attempt-level ownership** —— 現在誰有權動這筆 | 不管冪等 |
| **兩張表的 UNIQUE**(父:冪等鍵全表唯一、重試鏈不分叉;子:`(refund_id, seq)`、至多一列 terminal) | **冪等與鏈的形狀** —— 同一把鍵不得重用、同一前手至多一個接手、同一 refund 至多一個結局 | 🔴 **不是**第二套 ownership |
⚠️ v3 初稿把兩者都寫成「claim」,實作者會把 ledger UNIQUE 當成第二個 ownership ⇒ 正是本片要消滅的東西。
🔴 **每一列 ledger 必須綁當時的 lease token**(`settle_attempt_count` 值),
   lease 過期換手後,新 worker 的動作帶新 token ⇒ 舊 token 的動作不得再寫入。

🔴 **released 可被既有 lease claim —— 已實查確認**:`claim_stuck_unsettled_attempts` 的**現行本體**
是 R1c1 `20260624120008` 改寫過的版本,WHERE 含 `OR a.status = 'released'`
⇒ L5b 取得到 lease,**不需要動 sweeper 判準、也不需要另開查詢**。
(⚠️ 原始片 `20260615120001` 的舊版只有 `pending/charged` —— 讀錯版本會得到相反結論,見 §4-5。)

### 核心點 2 · 外呼與紀錄的順序(防「錢已退、本地查無」)
**問題(codex MF1 + Fable MF3)**:先呼叫 TapPay 後寫紀錄 ⇒ **crash-after-send** 時
本地沒有任何痕跡,下一個 worker 看不到證據、**換把鍵再退一次 = 雙退**。
而 TapPay refund **鍵消耗恆久無 TTL**(memory `reference_tappay-refund-api-multiple-partial-and-overrefund`)
⇒ 重試**必須換鍵**,所以「換了哪把鍵」非記不可。

| 案 | 做法 | 代價 |
|---|---|---|
| **2-A(推薦)** | **write-ahead**:意圖列(含這次要用的冪等鍵)**先 commit** 才准打 TapPay;重啟時看到未結案的意圖 ⇒ **一律先 Record 對帳**,禁止直接換鍵重試 | 多一次 DB 往返;且「送出了但不確定」的情況會轉對帳/人工,不會自動快速收斂 |
| 2-B | 先呼叫、後記錄,靠逾時判斷 | 🔴 **擋不住 crash-after-send**(審查逐字);不採 |

**推薦 2-A**。⚠️ 附帶硬規則:**任何「可能已送出」的不確定狀態,一律先對帳或轉人工,禁止自動換鍵重試。**

🔴 **事件狀態機(v4 拆兩表後的形狀;append-only 的直接後果)**:
兩張表都是 append-only ⇒ **「記結果」不能 UPDATE,只能再 INSERT 一列事件**。
🔴 **v5 全文對帳更正(v3 是單表規格,照舊句實作會做出錯的東西)**:v3 把「意圖」寫成一種事件
(`event_type='intent'`)、把同一筆邏輯退款串在 `logical_refund_id` 上;**兩表版把意圖升成父表的一列** ——
`payment_refunds` 的**一列本身就是意圖**(它帶金額、幣別、冪等鍵、lease token),
`payment_refund_events` 只記「送出」與「結果」,`logical_refund_id` 這個欄位**不再存在**(改用父列 `id`)。

| 事件(`payment_refund_events.event_type`) | 何時寫 | 約束(機制在哪) |
|---|---|---|
| `sent` | **外呼前**必須連同父列先 commit,才准打 TapPay | write-ahead;🔴 **DB 不強制順序**(誠實邊界②) |
| `result_success` / `result_failed` | 外呼回來且結果確定 | terminal;**同一 refund 至多一列 terminal**(`pre_one_terminal_uniq`) |
| `result_unknown` | 外呼回來但結果不確定 | 🔴 **不是 terminal**(它正是「要去對帳」的訊號)⇒ 不在 `pre_one_terminal_uniq` 述詞內 |
| `reconcile` | 見到未結案 refund 時**先跑** | 不是 terminal;可多列(靠 `seq` 區分) |
| `manual` | 轉人工 | terminal(在 `pre_one_terminal_uniq` 述詞內) |

**未結案查找順序(硬規則)**:取得 lease → **先查同 attempt 有無未結案 refund**
(父列存在、但它的事件表裡沒有 terminal)→ 有 ⇒ **一律先 `reconcile`**
(禁止直接開新 refund 換鍵重試,禁止沿用舊鍵重打)→ 依對帳結果補寫 terminal result。
🔴 **「禁止重試」涵蓋兩種形狀**:開**新的根 refund**、以及**沿鏈接手**(新列 `supersedes_refund_id`
指回未結案的前手)—— 兩種都是換鍵再送,兩種都禁。(v4 只寫「開新根」,字面過窄。)
**crash 窗口的行為(明寫,不要讓讀者自己推)**:
- lease 已取、父列未寫時 crash ⇒ **沒有任何外呼發生過**;lease 到期後別人接手,等於沒開始過。
- 父列 + `sent` 已 commit、外呼前後 crash ⇒ 後手看到未結案 refund ⇒ 走 `reconcile`,**不得**當成「沒送出」。

### 核心點 3 · 誰是權威(避免兩份紀錄分岔)
| 來源 | 負責什麼 |
|---|---|
| `payment_charge_attempts` 三欄 | **讓路身分與生命週期**(誰被讓路、什麼時候) |
| **TapPay Record** | **外部金流事實**(錢到底在不在)—— 唯一權威,不可由本地紀錄推斷 |
| **L5b ledger** | **本地決策與動作**(判了什麼、用了哪把鍵、結果如何) |

🔴 **C1(Fable)必須處理**:已 apply 的 L5a-M 檔頭**逐字承諾**「已補償過 / 用了哪把鍵 = attempt 另一組欄、
L5b 自己那片加」——**與本案的 ledger 直接矛盾**。不宣告作廢的話,未來讀 migration 註解的人
會去 attempt 上再開第二組欄 = **真正的分岔源**。
⇒ **v3 明文宣告:單一權威 = ledger;L5a-M 檔頭那句作廢。**
⚠️ 那句在**已 apply 的檔案**裡改不了 ⇒ 用 **#368 同款處理**(掛 backlog + 本檔落檔宣告)。

### 核心點 4 · ledger 要記哪些欄位(v2 的六個泛稱欄位不夠)
審查逐條指出缺:退款金額/幣別、強識別鍵、**logical refund ID**、claim token/lease、
重試序號與前次動作、**結果分類(成功 / 確定失敗 / 未知)**、對帳結果、人工處理原因。

| 案 | 做法 |
|---|---|
| **4-A(推薦)** | 下表全部設成**具型別、有約束、有唯一鍵**的正式欄位 |
| 4-B | 記成 JSON 快照 ⇒ 🔴 DB 保證不了必填/唯一/可查 ⇒ 核心點 2 的規則會**只是文字** |

**推薦 4-A**。

#### 🔴 v5 形狀 = **兩張表**(主視窗裁 B;v3 的單表規格已作廢)
單表版被 Fable 四發 probe 實證:五條不變量 DB 其實擋不住、只能靠 L5b-2 自律 ——
而「靠自律」正是本片存在要消滅的東西。拆兩表之後,`supersedes 存在性 + 同 attempt`、
`事件同 attempt`、`無環` **從自律變成 DB 保證**。
⚠️ **本節與 `supabase/migrations/20260810140000_m4b_lifecycle_l5b_refund_ledger.sql` 必須逐欄一致**;
兩者不一致時**以 migration 為準並回頭修本檔**(migration 檔頭稱本檔真權威,兩份分岔就是下一個 bug)。

**父表 `public.payment_refunds` —— 一列 = 一個 logical refund = 一次物理退款嘗試 = 一把冪等鍵**

| 欄位 | 型別 | 約束 |
|---|---|---|
| `id` | uuid | PK,DEFAULT `gen_random_uuid()` |
| `attempt_id` | uuid | NOT NULL,FK → `payment_charge_attempts(id)`(ON DELETE 預設 NO ACTION) |
| `supersedes_refund_id` | uuid | 可空(NULL = 根);**複合 FK** `(attempt_id, supersedes_refund_id)` → `(attempt_id, id)`,靶 = `pr_attempt_id_uniq UNIQUE(attempt_id, id)` ⇒ 🔴 **重試鏈不得跨 attempt / 跨 order** |
| `idempotency_key` | text | NOT NULL + `btrim(...) <> ''`;**全表 UNIQUE**(`pr_idem_key_uniq`)—— 鍵恆久消耗、絕不重用 |
| `amount` | integer | NOT NULL,CHECK `> 0`。🔴 **整數「元」**(全庫慣例,非分);禁浮點 |
| `currency` | text | NOT NULL,CHECK `= 'TWD'` |
| `strong_key` | text | NOT NULL + `btrim(...) <> ''` —— 弱識別不得進退款路徑(§3 強識別) |
| `lease_token` | integer | NOT NULL,CHECK `>= 0` —— 寫入當時的 `settle_attempt_count`(綁 ownership) |
| `created_at` | timestamptz | NOT NULL DEFAULT `now()` |

父表的其餘機制:
- `pr_supersedes_uniq`:`UNIQUE(supersedes_refund_id) WHERE supersedes_refund_id IS NOT NULL`
  ⇒ **同一前手至多一個接手 = 重試鏈不分叉**。
- `pr_not_self_chk`:`supersedes_refund_id IS DISTINCT FROM id`(被下面的防環守門嚴格蘊含,留作第二層)。
- 🔴 **`pr_no_cycle` BEFORE INSERT trigger(SQLSTATE `P5B02`)= 無環的真正機制**:
  前手必須在插入當下**看得見**。**FK 做不到這件事** —— FK 在語句末檢查,單一 statement 的多列互指
  (`VALUES (1,2),(2,1)`)兩列都存在 ⇒ FK 滿足、環仍在(三線審查各自實測;harness `MUT-no-cycle`
  停掉守門後 `G-NO-CYCLE` 立刻變 `OK`,就是這件事的機械證據)。
  **合法代價的精確範圍(codex 關卡2 must-fix:原本寫「零合法代價」比實際強)**:
  ✅ 已實測寫得進 = **單列 INSERT**(正式 writer 的形狀)+ 多列 `VALUES` 且後列指前列(`G-CHAIN-SAME-STMT`)。
  ⚠️ **未實測且 PG 不保證** = `INSERT … SELECT`、data-modifying CTE 等**列處理順序未定**的寫法:
  前手可能排在後面 ⇒ 合法鏈被**誤擋** `P5B02`。方向是 fail-closed(誤擋合法、不漏放環),
  但那是**能力上限**、不是零代價 ⇒ 🔴 **L5b-2 的 writer 一律一次插一列**;要支援其他形狀先補該形狀的 probe。
  同一條 PG 語意在 B 線 OP2b(`20260810130000`)以 `P2B32` 擋,兩片各自實測。

**子表 `public.payment_refund_events` —— append-only 事件流**

| 欄位 | 型別 | 約束 |
|---|---|---|
| `id` | uuid | PK,DEFAULT `gen_random_uuid()` |
| `refund_id` | uuid | NOT NULL,FK → `payment_refunds(id)`(ON DELETE 預設 NO ACTION) |
| `event_type` | text | NOT NULL,CHECK ∈ (`sent`, `result_success`, `result_failed`, `result_unknown`, `reconcile`, `manual`) |
| `seq` | integer | NOT NULL,CHECK `> 0`;`UNIQUE(refund_id, seq)` |
| `lease_token` | integer | NOT NULL,CHECK `>= 0` |
| `record_snapshot` | jsonb | 可空 —— 當下 Record 觀察(稽核用,**不作決策依據**) |
| `created_at` | timestamptz | NOT NULL DEFAULT `now()` |

- `pre_one_terminal_uniq`:`UNIQUE(refund_id) WHERE event_type IN ('result_success','result_failed','manual')`
  ⇒ 至多一列 terminal。
- 🔴 **`attempt_id` 不在子表** —— attempt 歸屬由父表決定,事件**無從**與它不一致
  (v3 單表版要靠自律維持的「事件同 attempt」,在這個形狀下不存在了)。

🔴 **重試的形狀(v3 的說法在兩表版仍成立,只是換了載體)**:重試 = **開一列新的 refund**,
以 `supersedes_refund_id` 指回前一列 ⇒ 鏈狀歷史,「換過哪些鍵」沿鏈走得出來。
⚠️ **部分退款多次 = 多條根鏈,各自帶自己的金額**(不是一條鏈上累加)。

🔴 **append-only 要用機制、不是宣稱(Fable MF2)—— 而 v3 指定的機制是錯的**:
v3 寫「`REVOKE UPDATE, DELETE` + claim-by-insert」。**實跑推翻**:唯一寫入者是 SECDEF RPC = **owner**,
而 ACL 只擋非 owner ⇒ REVOKE 對它完全無效。
⇒ v4/v5 改成 **trigger**:`prl_append_only_guard()`(SQLSTATE `P5B01`),
**ROW(UPDATE/DELETE)與 STATEMENT(TRUNCATE)兩種都掛**、兩張表各掛一對,共四支;
trigger 對 owner 照樣觸發。負向測試**以 owner 身分**跑(拿非 owner 測會被 ACL 擋 = 恆真的假綠)。
⚠️ 誠實邊界:owner / superuser 可 `DISABLE`/`DROP` trigger 或 `session_replication_role='replica'`
繞過 —— **不宣稱防得住它們**。

---

## 2. 片級 plan

### 2a. 範圍
- **L5b-1(已完成、未 apply)**:新增**兩張**表 —— `payment_refunds`(父,insert-only)+
  `payment_refund_events`(子,append-only);ACL 比照 L5a-1(零 GRANT + RLS),append-only 走 trigger。
- **L5b-2(下一片)**:新增退款 use-case,且 **RPC 是唯一寫入路徑** —— 取 lease(1-A)→ 重驗 L5a 狀態 →
  當下 Record 觀察 → 決策 → write-ahead(父列 + `sent` 事件先 commit,2-A)→ 呼 TapPay refund → 記結果事件。
  §3a 那五條 DB 擋不住的不變量**全部由這片強制**,並在該片各配一發突變(見 §2b 下半表)。
- **不做**:重付鈕(Q4=A 要等本片上線後才開,屬 L5a-2)、不動 sweeper 判準、不動 L5a-1 讓路 RPC。

### 2b. 🔴 驗收(C2:空集合會讓全鏈恆綠,必須用非空 fixture)
> **空集合上線的盲區**:v2 主張「先跑起來被觀察是安全的」——好處我講了,**盲區沒講**:
> 零筆 superseded 時**所有斷言恆真**,第一筆真錢就是第一次真正執行。

⇒ 硬需求:**非空 synthetic fixture 走完整鏈**(決策 → claim → 呼叫 → 逾時 → 對帳),
**每條守門各配一發突變**。

**L5b-1(本片,DB 層)—— 已交付,`scripts/l5b1-verify.sh` 拋棄式 cluster 實跑**:
| 面 | 突變 | 現況 |
|---|---|---|
| 每條 CHECK / UNIQUE / FK | 各一發獨立突變,**每發重跑全矩陣、比對每一格的精確結果** | ✅ 26 格 × 19 發 |
| 無環(`P5B02`) | `MUT-no-cycle` 停守門 ⇒ `G-NO-CYCLE` 翻 `OK` = 環真的寫得進去 | ✅ |
| 重試鏈不跨 attempt | `MUT-supersedes-fk` 丟複合 FK ⇒ 只有 `G-CROSS-ATTEMPT` 翻 | ✅ |
| append-only 機制 | 以 **owner** 身分 UPDATE / DELETE / TRUNCATE ⇒ 被 DB 擋(`P5B01`) | ✅ |
| TRUNCATE 兩支各自有效 | **只停子表那支**:子格翻 `OK`、父格仍 `P5B01`(此刻只剩父支能擋)⇒ 兩支各自證到 | ✅ |

**L5b-2(寫入 RPC,下一片)—— 🔴 本片 DB 擋不住、必須在那片配突變的五條**
(逐條與 migration 檔頭「仍擋不住的五條」同字面):
| # | 不變量 | 那片要配的突變 |
|---|---|---|
| ① | 未知態禁重試(**開新根 refund 或沿鏈接手,兩種都算**) | 餵「送出了但結果未知」⇒ 不得自動換鍵重試(兩種形狀各一發) |
| ② | write-ahead 順序 | 把父列 + `sent` 寫在呼叫**之後** ⇒ crash-after-send 情境必紅 |
| ③ | Σ 超退上界 | 同一 attempt 開兩條根鏈各退一半以上 ⇒ 必紅 |
| ④ | 退款目標限「L5 讓路過的 attempt」 | 對從未讓路的 pending attempt 開 refund ⇒ 必紅 |
| ⑤ | lease token 當前性 | 帶**過期**的 token 寫入 ⇒ 必紅(DB 只驗 `>= 0`,驗不了當前性) |
| ownership 互斥(1-A) | 讓 L5b 不取 lease ⇒ 必須能構造出「sweeper 與 L5b 同時處理同一筆」 |
| 強識別 | 弱識別(rec 與 bank 皆 null)⇒ fail-closed 不退 |

### 2c. 發布序
`L5a-M / L5a-1`(**已 apply**)→ 本片 apply → 觀察 → **然後才**開重付鈕(L5a-2)。

---

## 3. 誠實邊界
1. **TapPay Record 是唯一外部權威**;本地任何紀錄都推不出「錢現在在不在」。
2. 本片**只處理被讓路(superseded)的那一類**;10 分鐘窗口留下的 stuck pending 由既有 sweeper
   自動對帳 8 次後轉人工佇列(`2026-08-10-l5a-policy-unification-plan.md` §1c)。
3. `superseded_by_order_id` **不得**用來做金額或歸屬推論(L5a-1 檔頭硬契約)。
4. 🔴 **設計形狀由 Sean 核准,不由我自裁** —— v1/v2 我判了兩次「可自裁」,兩次都被打掉
   (第一次「完全可逆」錯、第二次「純加法可 DROP」也錯:啟用即真的退錢、外部金流動作不可逆)。
   同一判斷連兩次錯 ⇒ 交出去。

### 3a. 🔴 DB **擋不住**的五條(與 migration 檔頭逐字同款;交 L5b-2 的 RPC 強制)
1. **未知態禁重試(開新根 refund「或」沿鏈接手,兩種都算)** —— terminal 未落就換鍵再送;
   跨列狀態,row-local 判不了。
2. **write-ahead 順序** —— 本片零痕跡;唯一偵測面是 Record 對帳。
3. **Σ 超退上界** —— 兩張表皆無總額約束:同一 attempt 開兩條根鏈各退 100 元照收(跨列 SUM,row-local 判不了)。
4. **退款目標限「L5 讓路過的 attempt」** —— 對從未讓路的 pending attempt 開 refund 照收
   (§3.2「寧漏勿誤」的主閘在 L5b-2,不在表上)。
5. **lease token 當前性** —— DB 只驗 `>= 0`,驗不了「這把 token 是不是當前那把」。

🔴 **本清單本身也可能不完整**:它是「已知擋不住」的列舉,**不是「其餘全部擋得住」的證明**。
v4 曾列「仍擋不住的**兩條**」並暗示那就是全部,實際至少五條 —— **誠實邊界的完整性本身也會超稱**,
而這份清單正是 Sean 核准時看的東西:短報 = 他核到的形狀比實際安全。

## 4. 🔴 審查過程中的一條**假 finding**,以及它是怎麼被我自己造出來的

confirm 輪(codex)給了一條 must-fix:
> 「L5b 目標是 `released`,但既有 RPC 只 claim `pending/charged`;照現況 L5b **永遠取不到 lease**。」

**那是錯的。** 實查:`claim_stuck_unsettled_attempts` 最後一支改寫它的是
**R1c1 `20260624120008`**,本體 WHERE 含 `OR a.status = 'released'` ⇒ **released claim 得到**。

🔴 **為什麼審查會錯:因為我在 prompt 裡限定它「只讀 `20260615120001:120-150`」**
—— 那是**被取代掉的原始版**。我把審查的輸入範圍限縮成只看得到舊定義,它就照舊定義給了一條
自信但錯誤的 finding。

**這正是我今天稍早才寫進另一份 plan 的那條教訓**
(`2026-08-10-l5a-policy-unification-plan.md` §1c:「判 DB 現況要讀**最後一支改它的**本體」)——
我寫下了那條教訓,然後**把審查者推進同一個坑**。

**How to apply(給下一個派審查的人,包括我自己)**:
限縮審查的可讀範圍是控成本的正當手段,但**限縮本身會製造盲區**。
凡是要審查者判斷「DB 現況」的題目,給的檔案清單必須是**最後一支改它的**,
或乾脆不限縮該檔;否則拿回來的 finding 會是「對著舊世界的正確推理」。
⚠️ 而且這種錯**特別有說服力**:它推理無誤、引用了真實行號,只是前提是過期的。

⇒ 本輪處置:那條 must-fix **駁回(附上方證據)**;連帶依賴它的第五條(「ownership 突變構造不出」)
一併不成立 —— released 既然 claim 得到,那格**構造得出來**。

