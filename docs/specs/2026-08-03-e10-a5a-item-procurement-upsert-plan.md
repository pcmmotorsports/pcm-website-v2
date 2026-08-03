# A5a 片級 plan:`admin_upsert_item_procurement` 採購 upsert owner RPC(v5)

> 規格母體 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.1 row 32(`:379`)。
> 片型 = **R(owner RPC)、高風險片**(鐵則 12 ②權限:SECURITY DEFINER 唯一應用寫入口;寫入目標是錢面真相表)⇒ 關卡1 codex 審 plan、關卡2 codex 審 diff、對抗審查不降級。
> 形狀樣板 = `20260801160000` S2(owner RPC + 固定碼 + 同交易稽核)+ `20260802150000` A6(先命中先回傳順序即合約)。
> 施工位置 = worktree `a4a-chain`(基底 dev `e32d3d5`);**不 push、不 apply、不 db push**。
> 🔀 **v2**:折入關卡1 R1(codex gpt-5.6-sol xhigh,NO-GO:21 must-fix + 3 nit、駁回 0;逐字存 `docs/reviews/2026-08-03-e10-a5a-k1-codex.md`)。主要改動:F1 新增 `ALLOCATED_BELOW_RECEIVED` 碼 / F2 RPC 入口 `SET CONSTRAINTS … IMMEDIATE` 關 deferred 逃逸 / F3 no-op 短路移到停用檢查之前(重放冪等不被停用狀態擊破)/ F6 戳記改 `clock_timestamp()` / F8 新增 C 區衝突輸入矩陣 / F12-13 跨 RPC 呼叫紀律 + S2 barrier 格 / F14 結構 DO 補 order_items / F20-21 措辭去誇大 + 業務日記債。
> 🔀 **v3**:折入關卡1 R2(codex 同模型確認輪,NO-GO:9 must-fix;R1 24 條中 18 條判已關、駁回 0)。改動:R2-1 `received_quantity` 文字錨改「僅以 `v_before.received_quantity` 讀取形式出現」/ R2-2 C 區列全相鄰對 / R2-4 Q1 拍板後同步修訂 master plan `:379` 字面 / R2-5 新增 B20b 更新路徑停用 barrier / R2-6 新增 B21 A5a×receipts barrier / R2-7 runbook drain 改 xact_start 錨定+排除自身 / R2-8 時間界端點寫死 / R2-9 業務日來源欄位寫死。Q1(R2-3)= 唯一未關項,等 Sean 拍板。
> 🔀 **v5**:折入**關卡2**(codex gpt-5.6-sol xhigh 審 staged diff,NO-GO:12 must-fix + 9 nit、駁回 0)。主要改動:MF3 §3.5 鎖序宣稱**改寫**(舊「單一全序」是錯的 —— 新建路徑實際是 suppliers 先於 procurement、非調升更新根本不碰 suppliers;無環改由「supplier 端只取共享鎖」論證)/ MF4 上游 trigger 前置改驗(表×函式×enabled)三元組 / MF5 ACL 補有效權限(role 繼承面)/ MF6 suppliers 零留痕改業務欄指紋 + updated_at 已知留痕誠實列出 / MF7 稽核 before/after 逐欄 + 七種更新各自留痕 / MF8 新增「12 條拒絕碼一律零寫入零稽核」格 / MF9 補 C 區 (0b,1) / MF10 barrier 改 `pg_blocking_pids` 指認 blocker 恰為 A / MF11 補 19 格覆蓋(allowlist 四值、時間界端點、單號長度與控制字元、reason 控制字元、其餘三種零寬)/ MF12 B4 加摘要連動斷言 / 九條 nit 全清。
> 🔴 **本片自測另抓到一條關卡1、關卡2 都沒抓到的**:`TIMESTAMPTZ '2020-01-01'` 這種**不帶偏移**的界字面在 runtime 是用**呼叫端 session 的 TimeZone** 解讀 ⇒ 同一輸入在不同時區 session 判定不同(本機 Asia/Taipei 下端點竟通過)。已釘死成 `'2020-01-01 00:00:00+00'`,並加 I21b/I21c 兩格(UTC / America/New_York)當漂移守門。
> 🔀 **v4**:折入關卡1 R3(**換模型換角度**:adversarial-reviewer/Fable,視角 = 假設審查/災難日可用性/修法回歸/測試假綠;NO-GO:4 must-fix + 3 nit、駁回 0)。改動:F1/F2 兩個不可構造 C 格刪除重寫(見 C 區)/ F3 lost-update 災難路入債②(全欄 hydrate + 先讀後送)/ F4 B13/B14 擴為三文字欄逐欄 / F5 §3.5 殘文同步 11g / F6 SET CONSTRAINTS 交易域入 migration 註解 / F7 qty=1 選錯供應商的 owner 處方入債④。R3 正面確認:SET CONSTRAINTS 目標名實存皆 deferrable、isolation GUC 與 SECDEF 無交互(A2b1 已實證)、有列時 supplier 必存在、B21 鎖語意成立、PostgREST 單 statement 交易使 B16b 屬縱深而非主防線。

## §0 鏈上位置與上游狀態

- 鏈:`A2b1 ✅ → A2b2 ✅ → A4a ✅ → A4b ✅ → A5a(本片)`(§5.0 DAG `:255-258`;上游已在 dev `e32d3d5`,**未 apply 正式站**,A4a/A4b apply-DoD 在佇列等 Sean)。
- 🔀 v2(R1-23):migration 版本序 = 本片 `20260803160000` > RW1a `20260803150000` > A4a `20260803140000` ⇒ `db push` 佇列中 A4a 先於本片落地,行為前提(重算/守門)成立。本片**不含**任何 A2b1/A4a 職責的重複實作(row 32 逐字)。
- 下游消費者(未建):A9d1 server actions、A9h 批次 coordinator、A10b UI。

## §1 目標(擋掉哪個具體的錯)

員工記錄「這個品項向哪家供應商訂了幾件、對方回了什麼」目前物理上做不到(表對所有應用 role 零寫 GRANT)。本片開出**service_role 應用路徑的唯一寫入口**(🔀 v2 R1-20:owner/SECDEF 天花板照 §3.6,不宣稱「繞過稽核的路徑不存在」):
1. service_role 不持表寫權 ⇒ 應用層繞過同交易稽核的路徑不存在(S2/A6 同構)。
2. 停用的供應商不能再接新單(S1b 契約債,`20260801150000:170-171`)。
3. A9h 批次重送天然冪等:同 payload 重放 = no-op、零稽核噪音、不動日期 —— **含「供應商事後被停用」的重放**(🔀 v2 R1-3)。
4. 員工輸入錯誤(超量/低於已到貨/非法值)回**固定業務碼**,不是 raw SQLSTATE 冒到 UI。

## §2 親讀契約(本 session 親驗,檔案:行號)

| # | 事實 | 依據 |
|---|---|---|
| K1 | upsert 業務鍵 = `UNIQUE (order_item_id, supplier_id)`,約束名 `order_item_procurement_business_key` | `20260801150000:142-143` |
| K2 | 可寫欄 = allocated / reply_status / contact_channel / submitted_at / supplier_order_no / exception_reason / expected_arrival_date;`received_quantity` 禁直寫(A4a BT guard,P4A01) | `20260729020000:51-64`、`20260803140000:194-217` |
| K3 | `first_ordered_at` 僅首寫、`status_changed_at` 每次更新,合約指給 A5a | `20260729020000:62-64`、master plan `:379` |
| K4 | 總量守門在 A2b1(P2B01,constraint `a2b1_allocation_within_orderable`),名稱序保證 P2B01 先於 A4a 23514;guard 為 **DEFERRABLE INITIALLY IMMEDIATE**(可被呼叫端 defer) | `20260803130000:152-157,176-179` |
| K5 | A2b1/A4a 隔離閘只認 read committed(P2B02);A5a 走 PostgREST 預設 RC | `20260803130000:114-121` |
| K6 | A5a 單列 upsert 無環的前提 = 不顯式鎖 order_items(procurement → order_items 由 trigger 執行) | `20260803130000:32-36`、a2b1 plan `:106` |
| K7 | 拒收 `is_active=false` 供應商是本片契約;FK 只驗存在 | `20260801150000:170-171`、master plan `:379` |
| K8 | A2 欄位 CHECK 全集:allocated 1..100000、**received 0..allocated(調降 allocated 低於已到貨 = 23514 `order_item_procurement_received_range`)**、reply_status 五值、order_no 首尾非空白+四種零寬禁、reason/channel 非空白 | `20260729020000:72-110` |
| K9 | 稽核表八欄 + actor/request_id nonempty CHECK;service_role 對 audit 只有 INSERT | `20260712210000:45-58` |
| K10 | suppliers 停用 = `is_active=false` 不可刪;S2 改名/停用走 `FOR UPDATE` 鎖列 | `20260801140000:30-45`、`20260801160000:251-254` |
| K11 | 契約債⑦:本片回寫 rollback runbook 步驟① 具體 REVOKE + 重看 `:124` 誠實界 | A4a plan §11、runbook `:11-16` |
| K12 | 型別重 gen 是 apply 之後硬前置 + 貼回 create_order 三處校正 | `20260801160000:69-73` |
| K13 | provision 依檔名序套全部 migrations;harness 用 port 54329、LC_ALL=C | `scripts/d1t2-rehearsal.sh:26-63` |
| K14 | A2b1 債③:死配額列膨脹 SUM 誤攔改派(fail-closed 方向,第 3 批解);UI 文案債在 A10b/A12b | `20260803130000:49-52` |
| K15 | 🔀 v2:S2 owner 憑證面 =「手動 SQL + pg_cron job + 持 owner 憑證的服務」(runbook 停寫前提要引同一口徑) | `20260801160000:303-306` |
| K16 | 🔀 v2:catch P2B01(immediate)時 statement 級子交易會回滾該 DML 與全部 trigger 效果、零半套持久化(R1 查無欄確認);破口只在 deferred 逃逸(→ §3.4b) | A2b1 `:171-179` + R1 查無欄 |

## §3 設計

### 3.1 簽章(11 參數,RETURNS text)

```sql
public.admin_upsert_item_procurement(
  p_order_item_id         uuid,
  p_supplier_id           uuid,
  p_allocated_quantity    integer,
  p_reply_status          text,
  p_contact_channel       text,
  p_submitted_at          timestamptz,
  p_supplier_order_no     text,
  p_exception_reason      text,
  p_expected_arrival_date date,
  p_actor                 text,
  p_request_id            text
) RETURNS text  -- SECURITY DEFINER, search_path=public,pg_temp, EXECUTE 僅 service_role
```

- **結構性不可寫**:`received_quantity` / `first_ordered_at`(更新面)/ `status_changed_at`(呼叫端)不在參數表。`first_ordered_at` 只出現在 INSERT 欄清單、不在任何 SET。
- **全量 payload 語意**(非 patch):選填欄 NULL = 該欄為 NULL。create/update 由**列存在性**分流,不由參數 NULL 分流(S2 NULL-dispatch 降級形狀結構上不存在)。

### 3.2 回傳固定碼(🔀 v2:17 碼;呼叫端必須斷言 ∈ 全集)

`CREATED` / `UPDATED` / `NO_CHANGE` / `ORDER_ITEM_NOT_FOUND` / `SUPPLIER_NOT_FOUND` / `SUPPLIER_INACTIVE` / `OVER_ALLOCATION` / **`ALLOCATED_BELOW_RECEIVED`**(🔀 v2 R1-1:已到貨 4 件把 allocated 5→3 會撞 `received_range` raw 23514 ⇒ 更新路徑鎖列後預檢 `p_allocated < v_before.received_quantity`,受 proc 列鎖保護無競態 —— receipts sync 對同列取 NKU 互斥)/ `INVALID_INPUT` / `INVALID_ALLOCATED` / `INVALID_REPLY_STATUS` / `INVALID_CONTACT_CHANNEL` / `INVALID_SUPPLIER_ORDER_NO` / `INVALID_EXCEPTION_REASON` / `SUBMITTED_AT_OUT_OF_RANGE` / `SUBMITTED_AT_IN_FUTURE` / `EXPECTED_ARRIVAL_OUT_OF_RANGE`

- `OVER_ALLOCATION` = A2b1 P2B01 的翻譯,**conname 以 `IS DISTINCT FROM` 驗**(🔀 v2 R1-15:`<>` 在 CONSTRAINT_NAME 為 NULL 時判定為 NULL、靜默吞掉非目標錯誤;S2 既有寫法有同型弱點,本片不順手改它、只自己用對)。非目標 P2B01 一律 re-RAISE。
- `NO_CHANGE` = 七 payload 欄(正規化後)與現值全部 `IS NOT DISTINCT FROM` ⇒ 零寫入、零稽核、不動日期;**判定在停用檢查之前**(→ 3.3 步 11a)。
- RAISE 面:actor/request_id(S2 形狀:剝 v_ws → 非空 → ≤200 → 零控制字元;不加 slug regex —— audit 僅 nonempty CHECK,K9)+ 隔離閘 P2B02 + 防衛枝。

### 3.3 檢查順序(🔀 v2 重排;先命中先回傳,順序 = 合約,C 區衝突矩陣承重)

```
0  隔離閘:transaction_isolation <> 'read committed' → RAISE P2B02
   (a5a_isolation_read_committed_only;理由 3.4a)
0b 🔀 v2(R1-2):SET CONSTRAINTS order_item_procurement_allocation_guard_ac,
   order_item_procurement_summary_recompute_zc IMMEDIATE
   —— 呼叫端若先 DEFERRED,本句把兩支拉回 immediate ⇒ 本 RPC 的 DML 違規必在
   statement 末發火、落在 catch 內。若外層交易有「先前 statement 的 pending 事件」,
   會在本句立即發火成 raw P2B01/23514 —— 那是先前寫入的違規,归因正確、fail-loud,
   不翻譯(翻譯會把別人的錯講成這次呼叫的錯)。
1  actor / request_id RAISE 面(先剝後驗)
2  p_order_item_id 或 p_supplier_id NULL → INVALID_INPUT
3  p_allocated_quantity NULL 或 NOT BETWEEN 1 AND 100000 → INVALID_ALLOCATED
4  p_reply_status NULL 或 ∉ 五值 → INVALID_REPLY_STATUS(NULL 不默認)
5  contact_channel 正規化;非 NULL 時 >200 或 [[:cntrl:]] → INVALID_CONTACT_CHANNEL
6  supplier_order_no 正規化;非 NULL 時 >200、[[:cntrl:]]、或內部含七種隱形字
   (U+200B/200C/200D/FEFF/2800/3164/00AD;🔀 v2 R1-24 由四擴七)→ INVALID_SUPPLIER_ORDER_NO
7  exception_reason 正規化;非 NULL 時 >500 或 [[:cntrl:]] → INVALID_EXCEPTION_REASON
   (正規化 = btrim(v_ws) 後,再以七隱形字+[[:space:]] 判「肉眼全空」→ 全空即 NULL;
    三個文字欄同一套,🔀 v2 R1-24)
8  p_submitted_at 非 NULL:NOT(> TIMESTAMPTZ '2020-01-01' AND < TIMESTAMPTZ '2100-01-01')
   → SUBMITTED_AT_OUT_OF_RANGE(🔀 v3 R2-8:兩端皆開區間、端點值即拒,鏡像 A2 receipts
   received_at_sane 的 >/< 形式);> clock_timestamp()+5min → SUBMITTED_AT_IN_FUTURE
9  p_expected_arrival_date 非 NULL:NOT(>= DATE '2020-01-01' AND <= DATE '2100-01-01')
   → EXPECTED_ARRIVAL_OUT_OF_RANGE(🔀 v3 R2-8:date 為閉區間、端點值合法;未來合法)
10 order_items 存在性:普通 SELECT 不鎖(K6)→ ORDER_ITEM_NOT_FOUND
11 upsert 本體(FOR i IN 1..2 迴圈):
   SELECT * … WHERE 業務鍵 FOR UPDATE;
   ├ 11a 有列 + 七欄全同 → RETURN 'NO_CHANGE'
   │   (🔀 v2 R1-3:在任何供應商狀態檢查之前 —— 重放已提交事實 = 零寫入,
   │    停用與否不改變「什麼都不寫」的安全性;A9h 重送冪等因此不被停用擊破)
   ├ 11g 🔀 v3(R2-5)供應商閘**單一落點**(走到這裡 = 必有寫入企圖):
   │   need_gate := (無列) OR (有列且依 §7 Q1 拍板的擋更新條件成立)
   │   need_gate 時:SELECT is_active … FOR SHARE
   │     → 查無 → SUPPLIER_NOT_FOUND(僅無列路徑可達;有列時 FK 保證存在)
   │     → false → SUPPLIER_INACTIVE
   │   (單一落點 ⇒ 函式體 `for share` 恰 1 次的文字錨同時保證更新路徑不會用
   │    普通 SELECT 頂替 —— R2-5 的死枝形狀被錨與 B20b 雙面釘死)
   ├ 11b 有列 + 有差異 →
   │   ├ p_allocated < v_before.received_quantity → ALLOCATED_BELOW_RECEIVED(R1-1)
   │   ├ UPDATE 七欄 + status_changed_at = clock_timestamp()(🔀 v2 R1-6:
   │   │   now() 是交易起始時間,同交易兩次真更新會拿到同值 ⇒ 戳記一律 clock_timestamp)
   │   │   catch P2B01(conname IS DISTINCT FROM 目標 → re-RAISE)→ OVER_ALLOCATION
   │   ├ v_row_id := v_before.id(🔀 v2 R1-11:audit target 不得落 NULL)
   │   └ v_result := 'UPDATED'
   └ 11c 無列 →
       ├ INSERT 七欄 + first_ordered_at/status_changed_at = clock_timestamp()
       │   catch P2B01 → OVER_ALLOCATION;
       │   catch unique_violation(conname IS DISTINCT FROM business_key → re-RAISE)
       │   → 續迴圈(兄弟併發首建:23505 在對方 COMMIT 後才拋 ⇒ 第二圈 FOR UPDATE
       │      必見已提交列走 11a/11b;無 DELETE writer ⇒ 不再空手;
       │      🔀 v2 R1-9:此宣稱由 B19 的 barrier 實測承重,非引文)
       └ v_result := 'CREATED'
   迴圈耗盡 → RAISE 防衛枝(不列守門計數)
12 audit 恰一句 INSERT(action = procurement.create|update、target = 'procurement:'||v_row_id、
   before = 舊七欄 jsonb|NULL、after = 新七欄+兩鍵 jsonb)→ RETURN v_result
```

### 3.4 兩道自我防護的理由

- **a. 隔離閘**:A2b1/A4a 的閘只護 trigger 寫入路;本 RPC 的 no-op 路(零寫入)與 is_active 判定是自己的 read-decide-write,RR 下會拿快照決策。呼叫端只有 PostgREST 預設 RC,拒收零成本。tag 分名保錯誤歸因。
- **b. SET CONSTRAINTS IMMEDIATE**(🔀 v2 R1-2):A2b1 guard 是 DEFERRABLE II,呼叫端 defer 後 P2B01 會在 COMMIT 才發火、逃出本函式 catch ⇒ `OVER_ALLOCATION` 合約失效。入口強制 IMMEDIATE 把發火點拉回 catch 範圍。副作用(外層 pending 事件提早發火)歸因正確,見步 0b。「先超後補」的 defer 需求屬 A9h 編排層,**不得經由本 RPC**(§9 債①)。

### 3.5 鎖面與死結(🔀 v2 修訂)

- 🔀 v5(關卡2 MF3)取鎖序**逐路徑**(舊字面「單一全序」已證偽):①新建 = procurement 查無列(不留鎖)→ suppliers SHARE → INSERT tuple;②更新且調升 = procurement 列鎖 → suppliers SHARE;③更新非調升 = procurement 列鎖、**不碰 suppliers**;④no-op = procurement 列鎖後立即返回。之後才是 [trigger: order_items NKU]。①與②序**相反**,但 supplier 端一律共享鎖 ⇒ 兩個 A5a 交易不可能互等 supplier ⇒ 無環;A5a×S2、A5a×receipts sync 皆單向。**前提 = 對 suppliers 只取共享鎖**(結構驗收的 `for share` 錨與表名配對檢查守住)。供應商閘仍是單一落點 11g(v4 R3-F5)。S2 只鎖 suppliers;receipts sync = procurement NKU → order_items;無反向持有 ⇒ 單次呼叫無環。
- 🔀 v2(R1-12)**呼叫紀律成為合約**:「無環」限定**每交易單次呼叫本 RPC、且同交易不混呼 S2**(A6 `:52-54` 同款誠實界)。同交易先呼 A5a(持 supplier SHARE)再呼 S2(同 supplier 升 FOR UPDATE)可與另一等待者成環 —— PG 偵測 40P01 fail-closed,但合約寫明「A9d1 一請求一呼叫;A9h 只呼本 RPC、逐 statement」。migration 註解明文。
- 🔀 v2(R1-22)FOR SHARE 理由精確化:對 S2 的停用路徑(先 FOR UPDATE 鎖列)KEY SHARE 也擋得住;FOR SHARE 額外擋的是**未來任何裸的非鍵 UPDATE 路徑**(NO KEY UPDATE 鎖與 KEY SHARE 相容、與 SHARE 不相容)——防的是還沒出生的 writer,不只 S2。
- 時間戳:兩戳記 = `clock_timestamp()`(R1-6)。「業務日 Asia/Taipei」= 讀模型層推導,本片不存業務日欄;記債 §9-②③(🔀 v2 R1-21:入債不只口頭)。

### 3.6 誠實邊界

- actor 自陳(E8-B 前無真身分);稽核不能反證真寫入;RPC 執行期無 lock_timeout;owner/SECDEF 可繞過本 RPC 直寫表(A4a BT guard 擋 received,其餘欄不擋)—— 皆家族既有天花板。
- 併發同鍵雙建收斂與 S2 停用 TOCTOU 由 harness barrier 格實測(B19/B20);「同品項異供應商」互動不重測(a2b1-verify 承重)。
- 死配額列(K14):OVER_ALLOCATION 可能是死列膨脹 SUM 的誤攔,fail-closed 接受,UI 文案債照 A2b1 債③。

## §4 產物

| 檔 | 動作 |
|---|---|
| `supabase/migrations/20260803160000_m4b_e10_a5a_admin_upsert_item_procurement.sql` | 新增:RPC + REVOKE/GRANT + 檔內結構 DO |
| `scripts/a5a-verify.sh` | 新增:行為 harness(三計數器 + 身分閘 + 零留痕) |
| `docs/runbooks/a4a-summary-rollback.md` | 回寫步驟①(契約債⑦)+ `:124` 誠實界 |
| `docs/reviews/2026-08-03-e10-a5a-k1-codex.md` | 關卡1 findings 逐字 |
| 本 plan + handoff | docs |

檔內結構 DO(照 S2 5a-5g + A2b1 3f/3g):SECDEF / proconfig / 簽章逐字 / proacl 恰 `service_role:EXECUTE:false` / PUBLIC 零 / 🔀 v2(R1-14)owner 對齊**四表**(order_item_procurement、suppliers、admin_audit_log、**order_items**)+ 四表 `relforcerowsecurity=false` / 表級 ACL 未放寬(仍 `service_role:SELECT:false` + 零欄級 ACL)/ audit 八欄在 + owner 可 INSERT / 文字錨(出現次數實作定稿時 grep 釘死;🔀 v2 R1-16:**以 lower(函式定義) 比對**免大小寫繞過、加「本體零動態 SQL `EXECUTE`」錨;誠實界照 A2b1 3f —— 文字比對非控制流,行為證據在 harness):`first_ordered_at` 恰 1、🔀 v3(R2-1)`received_quantity` 出現次數 = `v_before.received_quantity` 出現次數且 ≥1(只准以讀取形式出現,不得成為賦值目標;v2 的「0 次」與 ALLOCATED_BELOW_RECEIVED 預檢自相矛盾,正確函式會被自己的驗收拒絕)、`order_item_quantity_summary` 0、`for no key update` 0、`for share` 恰 1(單一落點 11g)、`for update` 恰 1、`set constraints` 恰 1、procurement INSERT/UPDATE 各恰 1、audit INSERT 恰 1、`clock_timestamp` ≥3、`is distinct from`(catch conname)≥2。

## §5 a5a-verify harness 設計(計數器實作時釘死)

- 用法:`d1t2-rehearsal.sh provision <work>` → `scripts/a5a-verify.sh <work>`。身分閘照 a4a 五重 + 本片函式存在閘。
- **B 區(行為;BEGIN…ROLLBACK 零留痕,committed 格誠實列出並附清理+殘留斷言)**:
  B1 CREATED:列值逐欄、雙戳記、A4a 摘要連動、audit 恰 +1(action/target/after 逐欄)
  B2 同 payload 重放 → NO_CHANGE:零寫、雙戳記不動、audit 不增
  B2b 🔀 v2(R1-3):建立 → 停用該供應商(owner UPDATE suppliers)→ 同 payload 重放 → 仍 NO_CHANGE
  B3 改 reply_status → UPDATED:status_changed_at 動、first_ordered_at 不動、audit before/after、target='procurement:'||id(R1-11)
  B3b 🔀 v2(R1-7):**七欄逐欄更新矩陣** —— 每個 payload 欄單獨改值→UPDATED+落庫值斷言;非 NULL→NULL→UPDATED;NULL→NULL 不觸發;每欄改完重放→NO_CHANGE
  B4 調升 allocated 合法 → UPDATED、摘要連動
  B5/B6 首建/調升超量 → OVER_ALLOCATION、零列/列不變
  B6b 🔀 v2(R1-1):到貨 4 件後 allocated 5→3 → ALLOCATED_BELOW_RECEIVED(非 raw 23514);5→4 合法 UPDATED(邊界)
  B7 停用供應商首建 → SUPPLIER_INACTIVE(row 32 指定負測)
  B8 停用供應商 × 更新路徑(依 Q1 拍板定期望)
  B9/B10 SUPPLIER_NOT_FOUND / ORDER_ITEM_NOT_FOUND
  B11 同品項第二家 → CREATED、摘要 = SUM(1:N)
  B12 INVALID 面逐碼可達(NULL 鍵×2、allocated 0/100001/NULL、reply bogus/NULL、channel cntrl/超長、order_no 內部零寬(七種各一)/cntrl、reason 超長、submitted 界外/未來、arrival 界外)
  B13 🔀 v4(R3-F4)正規化**三文字欄逐欄**:contact_channel / supplier_order_no / exception_reason 各一組
      「'  值  ' 入庫為 '值'」+ 落庫值斷言(channel/reason 的首尾空白**無 A2 CHECK 後盾**,漏 btrim 只有這裡會紅);
      全空白→NULL;肉眼全空(U+2800 等)→NULL
  B14 正規化後等值重放 → NO_CHANGE(同樣三欄各一格 —— 乾淨值重放回 UPDATED = A9h 冪等破功的形狀)
  B15 RAISE 面:actor/request_id 缺/空/非法
  B16 RR 交易 → P2B02(a5a tag)
  B16b 🔀 v2(R1-2):呼叫端先 `SET CONSTRAINTS … DEFERRED` 再呼 RPC 超量 → 仍回 OVER_ALLOCATION(不逃逸)
  B17 ACL:service_role 可執行、anon/authenticated 不可、表級直寫仍 42501
  B18 received_quantity 全程 0 + 直寫仍 P4A01(A4a 兄弟不受污染)
  B19 🔀 v2(R1-9/10)併發同鍵雙建(FIFO 雙連線,committed 格):**先以 pg_blocking_pids 斷言 B 真的阻塞在 A 的 unique 上**、A COMMIT 後 B 走 catch 收斂;**同 payload ⇒ 恰回 NO_CHANGE**、恰一列、恰一筆 create 稽核
  B20 🔀 v2(R1-13)A5a×S2 停用 TOCTOU barrier(首建):A 持 S2 停用未 commit → B 呼 A5a 首建同供應商 → 斷言 B 阻塞於 supplier 列 → A commit → B 回 SUPPLIER_INACTIVE
  B20b 🔀 v3(R2-5)同型 barrier(**更新路徑**):既有列;A 持 S2 停用未 commit → B 呼 A5a 調升 allocated(Q1 兩案都必擋的形狀)→ 斷言 B 阻塞於 supplier 列 → A commit → B 回 SUPPLIER_INACTIVE —— 證明 11g 的 FOR SHARE 真的在更新路徑執行,不是死枝
  B21 🔀 v3(R2-6)A5a×receipts barrier:既有列已到貨 2 件;A 交易內 INSERT 第三批 receipt 未 commit(sync trigger 持 proc NKU)→ B 呼 A5a 調降 allocated 至 3 → 斷言 B 阻塞於 proc 列 → A commit(received=5)→ B 在鎖下重讀 → 回 ALLOCATED_BELOW_RECEIVED(非 raw 23514)—— 證明預檢讀的是鎖下最新值
- **C 區 🔀 v3(R2-2)衝突輸入矩陣(相鄰對列全;每格 = 同時違反兩步的輸入,斷言回前面那步的結果)**:
  (0,1) RR + 缺 actor → P2B02;(0b,1) 外層 pending 超量 + 缺 actor → raw P2B01;
  (1,2) 缺 actor + NULL 鍵 → RAISE;(2,3) NULL 鍵 + allocated 0 → INVALID_INPUT;
  (3,4) allocated 0 + reply bogus → INVALID_ALLOCATED;(4,5) reply bogus + channel cntrl → INVALID_REPLY_STATUS;
  (5,6) channel cntrl + order_no 零寬 → INVALID_CONTACT_CHANNEL;(6,7) order_no 零寬 + reason 超長 → INVALID_SUPPLIER_ORDER_NO;
  (7,8) reason 超長 + submitted 界外 → INVALID_EXCEPTION_REASON;(8,9) submitted 界外 + arrival 界外 → SUBMITTED_AT_OUT_OF_RANGE;
  (8a,8b) submitted 同時界外且未來(2101 年)→ OUT_OF_RANGE 先;(9,10) arrival 界外 + 假 order_item → EXPECTED_ARRIVAL_OUT_OF_RANGE;
  (10,11g) 假 order_item + 假 supplier → ORDER_ITEM_NOT_FOUND;(11g,11g') 假 supplier vs 停用 supplier 各自可達;
  (11a,11g) 停用供應商 + 同 payload → NO_CHANGE(11a 先於閘);
  🔀 v4(R3-F1/F2)兩格重寫 —— 原 (11g,11b①)「停用+調升至低於 received」與 (11b①,11b②)「低於 received 且超量」
  皆**物理不可構造**(received ≤ old_allocated ⇒「低於 received」必為調降;調降不觸 A2b1、調升恆不低於 received)⇒
  改為可構造的 (11g,11b②):停用 + 調升超量 → SUPPLIER_INACTIVE 先於 OVER_ALLOCATION;
  ALLOCATED_BELOW_RECEIVED 與 OVER_ALLOCATION 無共同輸入,先後序不需 C 格,由 M7 突變承重。
  (Q1=B 時另補 (11g,11b①)「停用+調降低於 received → SUPPLIER_INACTIVE 先」—— 該組合僅在 B 案可達。)
  順序突變由 C 區承重,不再只靠單一可達性格。
- **MUT 區**(DB 內函式突變,anchor 三重 preflight):
  M1 拿掉 is_active 檢查 → B7 觀察 CREATED(翻面)
  M2 拿掉 no-op 比對 → 重放觀察 UPDATED+戳記動(翻面)
  M3 拿掉 P2B01 翻譯 → 超量觀察 raw P2B01(翻面)
  M4 SET 清單注入 first_ordered_at → 更新觀察首寫被覆蓋(翻面)
  M5 🔀 v5(關卡2 n6 字面同步)拿掉 **contact_channel** 正規化 → 帶空白寫入後乾淨值重放回 UPDATED 而非 NO_CHANGE(翻面)—— 挑 channel 不挑單號:單號漏剝會被本 RPC 自己的 regex 擋下(看得見),channel 沒有那道後盾,唯一症狀就是冪等靜默破功
  M6 竄改 audit action 字面 → 稽核斷言翻面
  M7 🔀 v2(R1-1):拿掉 ALLOCATED_BELOW_RECEIVED 預檢 → B6b 觀察 raw 23514(翻面)
  M8 🔀 v2(R1-2):拿掉 SET CONSTRAINTS 句 → B16b 觀察逃逸(翻面)
- 收尾:三計數閘 + 零留痕斷言(兩表 + audit + summary 基準比對)。
- 🔀 v2(R1-17)兄弟連動:本片零 trigger、零表結構改動 ⇒ 家族期望不變;收工家族序跑 **provision → a5a → a4a 65 → a4b 33 → a2b1 69 → a2b2 37 → a6 157 → s1b 48 → a5a(尾=首)**,a4b 不再漏跑;a7/a7t/a7bt 三支既有排除照舊(A4a handoff 已載明)。

## §6 runbook 回寫(契約債⑦;🔀 v2 R1-18/19)

`docs/runbooks/a4a-summary-rollback.md` 步驟① 改為:
1. `REVOKE EXECUTE ON FUNCTION public.admin_upsert_item_procurement(uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text) FROM service_role;`
2. **drain 斷言**(R1-18;🔀 v3 R2-7:查 query 字面會命中自己、且漏掉「呼完 RPC 換跑別的 SQL 還沒 COMMIT」的舊交易 ⇒ 改錨交易起點):REVOKE 後記下 `SELECT now() AS revoke_at`,快照前反覆跑
   `SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND xact_start IS NOT NULL AND xact_start < <revoke_at>` 直到 0 —— 任何在 REVOKE 前開始的交易(無論現在跑什麼)都可能已通過 EXECUTE 檢查,必須等它們全部終結。
3. 停寫前提口徑對齊 K15(R1-19):殘餘寫入面 = owner 手動 SQL + pg_cron job + 持 owner 憑證的服務,非只「手動」。
4. `:124` 誠實界重寫:成員式子集檢查的承重由「三表零寫 GRANT」改為「REVOKE+drain 已執行、owner 面靜默」。

## §7 決策題(🏁 **Sean 2026-08-03 晚拍板 Q1=A**;拍板前本節為實作前置)

- Q1 停用供應商 × 既有採購列的更新:**✅ A**(擋新建 + 擋 allocated 調升;其餘欄照常)——
  A=擋新建 + 擋 allocated **調升**;其餘欄(回覆狀態/單號/異常原因/預計到貨等事實記錄)照常(推薦 —— row 32 的 rationale 是「不能下新單」,調升=追加訂購;把「登記對方缺貨回覆」也擋掉會逼員工棄單,且與 S2 的 DUPLICATE_LABEL-停用死角同型)
  B=擋新建 + 該列全凍結(字面最嚴;停用後任何欄都不可再改,更正紀錄要先重啟用供應商)
  (🔀 v2 R1-5:原 C 案「只擋新建、更新全放行」已撤 —— 允許停用後調升 = 繼續向停用供應商追加訂購,違 master plan `:379` 字面,不是合規選項。)
- 🔀 v3(R2-4)**拍板即同步 master plan**:無論 A/B,「no-op 重放不受停用影響」與「Q1 選定的更新範圍」都是對 row 32「拒收 is_active=false 供應商」字面的精確化 ⇒ Q1 拍板後**同一 commit** 在 master plan `:379` 加 🔀 註記(同 A2b1 Q4=A 同日修訂先例),消除雙權威。

## §8 驗收條件(逐條 yes/no)

1. migration 檔內 DO 全綠且 from-zero provision 含本片成功。
2. `scripts/a5a-verify.sh` 全綠、三計數閘吻合、SKIP 0、零留痕。
3. 🔀 v2(R1-21)row 32 五合約落點:supplier_id-only(簽章)/ 同 payload no-op(B2/B2b/B14)/ 拒停用(B7/B8/B20)/ first_ordered_at 僅首寫(B3+M4)/ status_changed_at 每次更新(B3/B3b)——四項 DB 綠格;**第五項「業務日 Asia/Taipei」= 記債轉交 §9-②③(讀模型/表單層),本片無 DB 綠格、不宣稱**。
4. OVER_ALLOCATION 走 A2b1 翻譯而非重複實作(M3 + 函式體零 SUM 守門邏輯)。
5. 契約債⑦ runbook 已回寫(含 drain 斷言與 K15 口徑)且簽章逐字一致。
6. 家族序跑(§5 尾段,含 a4b)零污染。
7. 三綠(typecheck/lint;零 .ts/.tsx 則 build 免)。
8. 關卡1 + 關卡2 findings 全折或親驗駁回。

## §9 rollback 與 contract 債

- down = `DROP FUNCTION …(11 型別簽章)` 乾淨。下游先撤:A9d1/A9h/A10b(未建)。已寫入列與稽核 = 營運資料不回收。A2b1/A4a 單獨回滾時 A5a 須同停(= §6 REVOKE + drain)。
- contract 債(migration 註解明文):
  ① A9h:多列/跨 statement 寫入受 A2b1 債④排序契約;「先超後補」的 defer 編排**不得經由本 RPC**(入口強制 IMMEDIATE);批次一律逐 statement 呼本 RPC、不繞過直寫。
  ② A9d1/A10b:必須斷言回傳碼 ∈ 17 碼全集;`datetime-local` 的 offset 由 server 補 Asia/Taipei(8 小時位移前科);一請求一呼叫、不與 S2 混呼同交易(§3.5 呼叫紀律);🔀 v4(R3-F3)**全量 payload 的 lost-update 防線**:表單必**全欄 hydrate 自最新列、先讀後送**(未帶滿七欄的呼叫端會把其餘欄清 NULL;兩員工並發編輯後送者靜默蓋掉前者 —— 月 100-300 單多人後台,「量小」論證已被拍板禁用);若上線後實際發生並發互蓋,升級方案 = 加 `p_expected_status_changed_at` CAS 參數(另片、動簽章)。
  ③ A9a 讀模型:業務日以 `AT TIME ZONE 'Asia/Taipei'` 推導(row 32 第五合約的落地層);🔀 v3(R2-9)**來源欄位寫死**:「下單日」← `first_ordered_at`、「最後異動日」← `status_changed_at`(皆 server `clock_timestamp()` 產,天然符合「server 端算」)、「送出供應商日」← `submitted_at`(staff 供給,timestamptz 帶偏移,offset 由債② 的 server action 補 Asia/Taipei —— 此欄的「server 端算」指 offset 解讀,不指值本身);缺列正規化照 5.0b 矩陣。
  ④ 死配額列誤攔的 UI 文案債(K14,A10b/A12b);🔀 v4(R3-F7)**qty=1 選錯供應商的當日處方**:allocated 下限 1 + 本 RPC 無 delete ⇒ 單件品項指錯供應商後,改派正確家永遠 OVER_ALLOCATION —— 當日出路 = owner 手動 `DELETE FROM order_item_procurement WHERE id=…`(A4a trigger 會自動重算摘要;受 receipts FK RESTRICT 保護不會帶走到貨事實),寫進 migration 註解;根治歸第 3 批採購退貨線。
  ⑤ 未來任何在 suppliers 上新增「非鍵欄 UPDATE」writer 的片,必須重看 §3.5 FOR SHARE 論證(R1-22)。
  ⑥ 🔀 v4(R3-F6)步 0b 的 `SET CONSTRAINTS … IMMEDIATE` 是**交易域、函式 RETURN 後不回復**:同交易呼叫端自己的 DEFERRED 模式會被靜默撤銷到交易結束 —— 呼叫紀律(一請求一呼叫)下無害,migration 註解載明防日後 A9h debug 誤歸因。
