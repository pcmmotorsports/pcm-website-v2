# A8c1 片級 plan:`begin_charge_attempt` 金流 begin 側取消守門(v6)

> 2026-08-04 視窗A(refund-wire)。片型=**高風險**(鐵則 12①錢)⇒ 全 9 步、關卡1 codex、
> 關卡2 雙線不降級。母計畫 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` row 34(:381)。
> **migration 不 apply**(Sean 手動;commit 後標 ⛔apply 停點)。
> 版本史:v1→R1 FAIL(codex,15MF+2nit)→ v2(折入;MF4 實測翻案、MF5 實錘、
> **Sean 2026-08-04 拍板 Q1=A**〔A-09-A〕)→ R2 FAIL(codex,8MF+3nit)→ v3(order_lock_idx
> 含 released 的倖存者證明)→ **R3 FAIL(Fable 換角度,6MF+5nit:victim 方向/oracle 綁定/
> prod pin/前置閘判別力/rollback 分支/災難日偵測)→ v4 → **R4 FAIL(codex 聚焦收斂輪,
> 5MF+1nit:L4 環成立時序/committed 例外全集/rollback 在途 writer drain/診斷 SQL 精度/
> GRANT 回前置)→ v5 → R5(codex 窄幅確認)3 關 3 未關(趟1 barrier/rollback 真 drain/
> §7-5 JOIN)→ v6(R5 殘項全折入)→ **R6(codex 極窄確認)三條全 closed = 關卡1 PASS**。
> findings=`/tmp/a8c1-k1-codex-r1.txt` / `-r2-out.txt` / `/tmp/a8c1-k1-fable-r3.txt` /
> `-codex-r4-out.txt` / `-r5-out.txt` / `-r6-out.txt`(⚠️ /tmp 揮發;每輪 MF 計數與主題
> 已摘要於本版本史,審計軌跡=STOP 檔+STATUS 收帳)。
> 關卡2 雙線 R1 皆 FAIL 已折入:code-reviewer(4MF+7nit:R6 版本史/preflight/C2b 字面/行號)
> + codex(13MF+7nit:SECDEF fail-open 面 assert/ACL 窮舉/碼錨/COMMENT md5 pin/L3 barrier/
> L4 sticky/0c 過時註解=§3.2④/剝殼格收編)——修法見 §5 各節與 migration。

## §0 這一片在鏈上的位置

取消線四片之首(§5.0 :258-261):**A8c1(本片)→ A8c2 → A8a1 → A8a2**。
🔴 **R8 部署序**:守門先上、取消才上 —— 反序的窗口內「取消後仍可被收原額」。
**上線後行為變化(誠實版)**:
- 守門對現網流量恆放行的前提=正式站 `order_cancellations` 0 列**且 `orders.cancelled_at` 全 NULL**
  ——資料事實非結構保證(欄自 `20260712203000` 存在),apply 前唯讀檢查必出**名單**(§7)。
- **新增等待面**:begin 從無鎖讀改 `FOR UPDATE` ⇒ 同單與 confirm/mark 家族/未來取消 RPC 序列化;
  `payment_confirmer` session 級 `lock_timeout='5s'`/`statement_timeout='8s'`(`20260611120000:73-74`
  親驗)⇒ 等待 >5s = **新的 55P03 失敗面**(通用錯誤、fail-closed、重試可癒)。
- **新增死結面(Sean 拍板 Q1=A 接受)**:與 released→charged genesis 的環;**單方 victim 回滾、
  倖存方走既有語意、兩向皆無新收款路徑**(§3.7 v3 修正版分析+L4 oracle)。backlog #321 記根治路。
- **隔離閘**:非 READ COMMITTED 呼叫一律 P8C01(§3.2①;正常流量=RC,見 §7 apply 前置檢查)。

## §1 目標(擋掉哪個具體的錯)

取消動作存在後(A8a1/A8a2),已取消的單若仍能走 `begin_charge_attempt` 開卡,客人會被收
「取消前的原額」。本片在開卡入口對「存在任何取消紀錄」的單 `RAISE` 拒開,並以 `orders` 列鎖
消「取消與付款各自檢查各自通過」的跨 RPC 競態(§5.0 :259-261)。

## §2 親讀契約(主對話親驗,檔案:行號)

| 契約 | 出處 | 對本片的約束 |
|---|---|---|
| 片規格 | master plan row 34 `:381` | 基底=0c、先 FOR UPDATE 再檢查、`cancelled_at` 非空或 `order_cancellations` 任一列 ⇒ RAISE、附取消併發與全域鎖序負測、附 `existing_bank_transaction_id` 回歸測試 |
| 基底本體 | `20260613140000:73-192` | 最新定義=0c(全 repo 僅 20260612150000/0b/0c 三支定義,親驗);初始 SELECT 無鎖且 :104-107 自陳理論 race |
| 🔴 per-order 鎖索引真相 | **`payment_charge_attempts_order_lock_idx` = UNIQUE (order_id) WHERE status IN ('pending','charged','released')**(拋棄庫 pg_indexes 親驗 2026-08-04)| **released 也佔鎖** —— 0c 函式字面的 ON CONFLICT 述詞(pending,charged)只是 arbiter 推斷條件,真 arbiter=此索引;§3.7 的倖存者分析建立在這條之上 |
| 鎖序合約 | §5.0 `:259-261` + row 36 `:383` | 三支 RPC 四施工片統一先 `orders FOR UPDATE` 再檢查 |
| 守門讀真相 | A1 契約 row 26 `:361` | 守門讀 `orders.cancelled_at`+`order_cancellations`,零摘要表讀取 |
| 取消真相表 | `20260730130000:68-176` | header FK→orders RESTRICT;EXISTS 有 `(order_id, created_at)` 索引(:194)|
| FOR UPDATE 前例 | `20260611120000:137-142`(PF-B)| confirm 已是鎖-先形狀 |
| 呼叫端資源護欄 | `20260611120000:73-74` | statement_timeout 8s / lock_timeout 5s ⇒ 55P03 新失敗面 |
| ACL 慣例 | `20260613140000:36`+`20260612150000:427` | begin EXECUTE=payment_confirmer only;CREATE OR REPLACE 保留 ACL、migration 內回歸 assert |
| migration 形狀 | 07-29 拍板 D0-1=A | 自帶 BEGIN/COMMIT;模擬須剝殼(A7 實錘)|
| 隔離閘前例 | `20260803130000:114-120`(A2b1)| 非 RC 下守門失義 ⇒ fail-closed 閘 |
| 鎖序不變式舊字面 | `20260624120010:24-27` + COMMENT `20260624120006:112`/`20260624120010:138` | 「attempt→order 無死結」字面被本片打破 ⇒ §3.8 COMMENT 更正(帶前置閘)|

**TS 連動面(親驗)**:唯一呼叫端=`packages/adapters/src/payment/PgChargeAttemptAdapter.ts:66`
(pg client 直呼;RAISE→query throw→既有錯誤路徑)⇒ 零 TS 改動(驗收=§6-10 allowlist)。

## §2b 鎖張力先驗(開工包指定;已實跑 7/7)

腳本=scratchpad `a8c-lock-tension-probe.sh`(收編 §5 L1/L2):
- **Part 1(抓得到)**:A2b1 死結形狀(先 INSERT orders 子列取 KEY SHARE、再升級 FOR UPDATE)
  → 40P01 重現於 orders ⇒ harness 有判別力。
- **Part 2(取消線內部安全)**:lock-first 序 → 零 40P01、後到者實際阻塞 1.5s 後序列化;
  COMMIT 版(A7-t deferred + A4a 重算真跑)亦綠。
結論:取消線內部照母計畫字面 `FOR UPDATE` 無死結(取鎖恆第一觸表動作、永不升級)。
⚠️ 附帶紀律(對 A8c2/A8a1/A8a2 有約束力):先寫 orders 子列再鎖 orders=重開 40P01。
🔴 「取消線 × mark 家族」是另一個環(§3.7)。

## §2c 偵察 pass 命中(subagent 全 repo+memory 掃;對本片零新約束,後續三片各 plan 必引)

1. **A8a2 鎖 `order_items` 原語=`FOR NO KEY UPDATE`**(A2b1 C8,`2026-08-03-e10-a2b1-…plan.md:37`
   + memory `project_m4b-a2b1-guard-decisions`):配隔離閘+函式級 lock_timeout;P2B01/P2B02 慣例。
   與 orders `FOR UPDATE` 不衝突(不同表、orders 恆第一)。
2. **多列 writer 排序契約**(`2026-08-03-e10-a4a-…plan.md:89`):A8a1/A8a2 多列寫入必按完整序。
3. **A7 五條債對 A8a1**(`2026-07-30-e10-a7-…plan.md:174-181`):payload_hash golden vector /
   對客欄一致性 / actor 停用負測 / 冪等三格 / 非空白正規化。
4. **A8a1 開工前置**:`docs/runbooks/2026-07-30-a7-rollback.md` 未寫(handoff :128)⇒ A8a1 片內補。
5. **地雷**:07-24/25 舊檔同名 `admin_cancel_order`=退款整合舊合約、未標作廢,不得照抄。
6. A8c1/A8c2:查無母計畫外約束。

## §3 設計

### 3.1 產物形狀

`supabase/migrations/20260804120000_m4b_e10_a8c1_begin_cancel_guard.sql`,自帶 BEGIN/COMMIT。
內容=begin CREATE OR REPLACE(簽章/回傳/SECDEF/`search_path=''` 不變)+ begin COMMENT 更新
+ §3.8 三支 COMMENT 更正(**各帶舊值前置閘**)+ ACL 回歸 assert + 結構 assert。

### 3.2 相對 0c 的改動 —— 五處、逐處具名(v6+K2:含 0c 過時註解更正)

① **隔離閘**(入口第一檢查、任何觸表之前):
`current_setting('transaction_isolation') <> 'read committed'` ⇒
`RAISE ... USING ERRCODE='P8C01'`。字面實測(PG17):RC/RR/SERIALIZABLE 分別回
`read committed`/`repeatable read`/`serializable` ⇒ 單一比對同時擋 RR 與 serializable。
理由(R1-MF2/MF3):RR 下 FOR UPDATE 等鎖醒來快照仍舊;部分取消不動 orders 列 ⇒ 不觸發 RR
序列化錯誤 ⇒ EXISTS 看不到已 commit 取消。函式內 fail-closed 判斷,不用函式 `SET` 選項
(`SET` 不能改交易隔離級、只能改 GUC 且時點錯)。
② 初始 SELECT(0c :91-94)加欄 `cancelled_at`、加 **`FOR UPDATE`**。
③ `NOT FOUND` 後新增**取消守門塊**:`v_order.cancelled_at IS NOT NULL OR EXISTS(
SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)` ⇒ RAISE `v_generic_msg`
(PF-E 通用訊息)。
④ **0c 過時註解更正**(K2 折入):原 :104-107「此讀無 row lock…理論 race」在新本體為假話,
改述「A8c1 起本讀持 FOR UPDATE、race 已關」——註解也是本體、假話不留(字面 vs 事實)。
⑤ begin 的 COMMENT ON FUNCTION 更新。
其餘一字不動;驗收=§5.3 **黃金差分 oracle**(非行數、非事後 md5)。

### 3.3 檢查順序(定案)

隔離閘 → `FOR UPDATE` 讀單 → `NOT FOUND` → **取消守門** → `cart_session_id` null → `not_unpaid`
→ advisory → dedup → in-flight → 佔鎖。守門在 `not_unpaid` 前=硬要求:①取消單多半 unpaid;
②「已取消且已 paid」必 RAISE 而非回 jsonb(C7 格)。

### 3.4 附帶效應(誠實列出)

- 關掉 0c :104-107 自陳理論 race(與 confirm 同鎖全序列化)。
- 等待/逾時語意變化見 §0;八情境**結果**不變(S 格逐驗)、等待語意變。
- RAISE=母計畫指定;storefront 對已取消單=通用付款失敗;取消語意 UI 屬 A13a。

### 3.5 鎖面與全域鎖序

本函式取鎖序=隔離閘(無鎖)→ orders 列鎖(第一觸表)→ advisory user lock。A8c2/A8a1/A8a2 同向;
取消線內部無環(§2b)。mark 家族環見 §3.7。

### 3.6 誠實邊界

- A8a1 未上線前 cancel 樣式以手動 SQL 模擬(鎖形狀相同、無業務檢查);A8a1 片以真 RPC 重驗。
- C5 只證序列化+allowed-set 模擬判拒(R1-MF1);該方向窗口由 A8a1 允許集合關。
- 不宣稱任何 27 項綠燈。

### 3.7 🔴 與 mark 家族的死結環(v3 修正版;實測 2026-08-04×3 輪)

背景:`r1c3:24-27` 不變式「無 order→attempt 反向鎖序 ⇒ 無死結」前提=confirm 不鎖 attempt;
本片讓 begin 成為第一個「持 orders 鎖、後觸 attempts」者。實測(真 RPC、腳本=scratchpad
`a8c-mark-family-cycle-probe.sh`,收編 L3/L4):

- **mark_failed × begin = 只阻塞、零 40P01**(其 UPDATE 在 orders 鎖後,begin 持鎖時它到不了
  UPDATE;begin 的 arbiter 對 lock-only 已提交列不等待)——實測 4 格。`close_released_attempt`
  同構(**L3b 以真 RPC 補實測**,COMMENT 才寫「實測」;R2-nit2)。
- **genesis(released→charged)× begin = 真死結 40P01**(genesis 先 UPDATE→charged=投機索引項、
  再 INSERT anomaly 等 orders KEY SHARE;begin 持 orders 等投機項)。
- 🔴 **倖存者分析(R2-MF1 修正;v2「雙方回滾/零錢風險」字面錯)**:PG 只中止一方。
  **關鍵事實=`order_lock_idx` 述詞含 `released`(§2 親驗)**:
  ①genesis=victim ⇒ 其回滾後 released 列**仍在鎖索引** ⇒ 倖存 begin 的 arbiter 重查必 conflict
  ⇒ **`order_locked`、開不出收款路徑**(獨立實測:released 存在下 begin 恆 `order_locked`);
  ②begin=victim ⇒ 通用錯誤、genesis 完成。兩向皆:victim 原子回滾、倖存方走既有語意、
  **零新增收款路徑/零新增終態**——「零錢風險」的正確證明是鎖索引含 released,不是「雙方回滾」。
- **只翻 r1b1c 一支不可行**(家族內開新反向環);根治=三支全翻 orders-first=**backlog #321**
  (Sean Q1=A;條目含「不修未來會痛在哪」:家族每加一支 orders-持鎖者或新投機索引寫入,
  環組合面再長一格,漏掉的那格只會在正式站以 40P01 現形)。
  🔴 **#321 條目必逐字保存本不變式(R3-N4/R4-nit)**:「任何把 attempt 列**移出**
  `order_lock_idx` 述詞的轉移(現=mark_failed 的 pending→failed、close 的 released→failed)
  **必先取 orders FOR UPDATE**」——倖存者證明(begin 倖存必 order_locked)依賴它;未來新增
  不鎖 orders 的退出轉移會靜默證偽三支 COMMENT,零測試翻紅。

### 3.8 三支 COMMENT 字面更正(零行為;字面 vs 事實;R2-MF8 帶閘版)

- `mark_charge_attempt_failed`(`20260624120006:112`)與 `close_released_attempt`
  (`20260624120010:138`):現 COMMENT 含「鎖序 attempt→order 無死結」→ 改述「A8c1 起 begin 持
  orders 先鎖;本函式對 begin 只阻塞不死結(2026-08-04 實測)」。
- `mark_charge_attempt_charged`(`20260624120005:163`):補述已知死結面(genesis×begin=40P01,
  Sean 2026-08-04 拍板接受、backlog #321;victim 單方回滾、倖存 begin 必 `order_locked`)。
- 🔴 **前置閘(v4=functiondef md5;R3-F4:COMMENT 句錨對 #321 重寫無判別力——ACL 句幾乎必然
  留存,閘照過、倒寫發生)**:migration 內 assert 四支(含 begin=0c)——即
  `md5(pg_get_functiondef(oid))` 各=當前已知值(拋棄庫量定、§7 於 prod apply 前重驗)——
  **不符=RAISE 停下人工對齊**(#321 重寫必改本體 ⇒ 完美判別;rollback 同理)。
  harness 配三條 post-oracle(新 COMMENT 逐字錨)。
- 歷史 migration 檔頭註解不回改(當時為真);更正只落 live COMMENT+本片檔頭。
- **函式內聯註解不改**(K2 nit 認列):mark_failed/close 本體內「無反向鎖序」舊句仍在
  functiondef——改本體=#321 範圍(會擊穿本片 md5 閘);更正通道=catalog COMMENT,
  live definition 的內聯句自相矛盾屬已知、#321 收。
- **md5 pin 非可攜語意證明**(K2 nit 認列):pg_get_functiondef 跨版本不保證 byte-identical;
  pin=同 PG17 內漂移偵測,不符=安全 false-stop 人工對齊。

## §4 產物清單(=§6-10 changed-path allowlist,恰 4 路徑)

1. `supabase/migrations/20260804120000_m4b_e10_a8c1_begin_cancel_guard.sql`
2. `scripts/a8c1-verify.sh`
3. 本 plan 檔
4. `docs/phase-1-backlog.md` 追加 **#321**

## §5 harness 設計(`scripts/a8c1-verify.sh`;port 54331、provision=d1t2 家族)

### 5.1 行為 cells

**回歸格 S1-S8**(照 0c 檔頭 :49-54 重建;fixture 事實已試駕:`orders_total_balances` 等式、
attempts 無 `charged_at`、bank txn `^[A-Z0-9]{1,19}$`):S1 duplicate/S2 needs_settle
**斷言 `existing_bank_transaction_id` 逐字**/S3 兩鍵 JSON null/S4 user_in_flight/S5 acquired/
S6 RAISE/S7 order_locked/S8 多 sibling 優先序。
**守門格**:
C1 `cancelled_at` 非空、header 0 列 → RAISE(通用訊息逐字)。
C2 header+item 1 組(`cancelled_at` NULL)→ RAISE。
C3 兩真相皆空 → acquired。
C4a 併發整單樣式:cancel tx 持鎖寫 `cancelled_at`+header+items 未 commit → begin 併發 →
**`pg_blocking_pids` 綁 waiter→blocker**(前例=`scripts/a2b2-concurrency-probe.sh:58-70`;
R2-nit1 更正引用)→ cancel COMMIT → begin RAISE。
C4b 同上部分樣式(僅 header+items)→ begin RAISE(EXISTS 承重;RR 洞的 RC 對照組)。
C5 反向:begin 先 acquired(持鎖)→ cancel 樣式阻塞(`pg_blocking_pids`)→ begin commit →
cancel 取鎖成功 → allowed-set 模擬判拒(attempts 含 pending)。兩向零 40P01。
C6 跨單隔離:他單有取消、目標單乾淨 → acquired。
C7 優先序:`cancelled_at` 非空(無 header)且 `payment_status='paid'` → RAISE(非 jsonb)。
C8 取消回滾:cancel 樣式寫入後 ROLLBACK → begin acquired。
C9a RR 下呼 begin → SQLSTATE=P8C01;C9b SERIALIZABLE 下呼 → P8C01(R2-MF4)。
C2b **來源表判別格(R3-N1;合成 fixture;實跑更正實作法)**:在 BEGIN…ROLLBACK 交易內插
header-only(0 items)→ 同交易呼 begin → RAISE——A7-t 的 DEFERRED 檢查只在 COMMIT 跑、
ROLLBACK 永不觸發 ⇒ **不需暫停 trigger、零復原負擔**(v6 原寫「暫停 triggers+復原斷言」
已過時);合成態(正式站不可達)註記不變。證守門讀 `order_cancellations` 本表、非 items 表。
E1 **55P03 面(R3-N3)**:harness session `SET lock_timeout='1s'` + 另 session 持 orders 鎖 →
begin → 斷言 SQLSTATE=55P03 且 attempts 零新列(§0 宣告的新失敗面第一次有格)。
**鎖格**:
L1 死結判別力(40P01 必現)/ L2 lock-first 無死結。
L3a 真 RPC mark_failed:阻塞後完成、零 40P01、arbiter 不等待(begin 側 DO NOTHING)。
L3b 真 RPC close_released_attempt:同構驗證(升證據等級;R2-nit2)。
L4 真 RPC genesis 環(**v6 oracle;R5 補趟1 barrier**):victim=「環已成立後、deadlock_timeout
先到期而自偵」的那方。**兩趟共用同一 barrier**:begin 樣式 session 先持 orders 鎖 → genesis
起跑(UPDATE→charged 後阻塞於 orders)→ **`pg_blocking_pids` 輪詢確認 genesis 已被 begin session
擋住**(=第一條邊成立、且 genesis 的投機索引項已存在)→ begin **才**發 INSERT(第二條邊、
環成立、begin 的等待自此起算)。趟間唯一差=timeout 不對稱:
- 趟1 釘 begin=victim:begin `SET deadlock_timeout='100ms'`、genesis `='10s'`——begin 等待起點
  即環成立點,其 100ms 檢查必在環內 ⇒ begin 40P01;斷言 genesis 完成(charged+anomaly 恰 1)。
- 趟2 釘 genesis=victim:begin `='10s'`、genesis `='500ms'`——barrier 後立即 INSERT(遠小於
  genesis 檢查窗殘餘)…genesis 的檢查若已在環成立前用掉(它先等)⇒ **以 barrier 時序保證
  begin 的 INSERT 在 genesis 阻塞後 ≤數百 ms 內發出**,並斷言 victim 身分——若 victim 錯落
  到 begin,該趟紅、不靜默(編排失誤可觀察)。倖存 begin=`order_locked` 非 acquired
  (released 仍佔 `order_lock_idx`)。
- 兩趟九表零半掛。⚠️ 誠實邊界:趟2 的 victim 釘定是「時序高機率+斷言把關」而非機制絕對
  (genesis 每次等待只檢查一次);斷言紅=重跑一次,連紅=編排 bug 修 harness。
L4b 獨立格:released 存在(無併發)⇒ begin=`order_locked`(倖存者分析的地基;已試駕)。

### 5.2 突變格與**完整**紅綠矩陣(R2-MF2:全格枚舉;runner 每個 mutant 跑滿全 vector 逐格比對,多紅/少紅皆 FAIL)

| 突變 \ 格 | S1-S8 | C1 | C2 | C3 | C4a | C4b | C5 | C6 | C7 | C8 | C9a | C9b |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| M1 拿掉整塊取消守門 | 綠 | 紅 | 紅 | 綠 | 紅 | 紅 | 綠 | 綠 | 紅 | 綠 | 綠 | 綠 |
| M2 拿掉 `FOR UPDATE` | 綠 | 綠 | 綠 | 綠 | 紅 | 紅 | 綠* | 綠 | 綠 | 綠 | 綠 | 綠 |
| M3 只拿掉 EXISTS 分支 | 綠 | 綠 | 紅 | 綠 | 綠 | 紅 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 |
| M4 只拿掉 `cancelled_at` 分支 | 綠 | 紅 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | **紅**(R2-MF3)| 綠 | 綠 | 綠 |
| M5 拿掉隔離閘 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 紅 | 紅 |
| M6 EXISTS 掉 WHERE | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 紅 | 綠 | 綠 | 綠 | 綠 |

- M2 的 C4a/C4b oracle=**終態斷言**(R1-MF6):begin 於 cancel commit 後完成且 acquired、
  已取消單上存在 active attempt=窗口實證;不斷言「不阻塞」(FK KEY SHARE 仍會等)。
  C5* **綠(2026-08-04 實跑更正原「紅」預期)**:M2 下 begin 雖無顯式鎖,其 attempts INSERT 的
  FK RI `KEY SHARE` 照樣與 cancel 的 FOR UPDATE 互斥 ⇒ 阻塞觀察被別種機制照樣提供
  (memory 教訓的實例)⇒ **C5 對 M2 無判別力**;FOR UPDATE 的獨立承重由 C4a/C4b 方向證明。
- M5 另附 RR 窗口示範(非計分格):RR 下 begin 於部分取消 commit 後仍 acquired=洞的實證。
- L 格與 C2b/E1 不進突變矩陣(驗環境事實/合成態,非本函式字面;M1-M6 期間跳過)。
- 突變=DB 內 CREATE OR REPLACE、anchor 三重 preflight、trap 還原、還原後 md5 對基準。
- **fixture 生命週期(R3-N2 + R4-2 修正)**:預設格 BEGIN…ROLLBACK 自帶 fixture;
  **committed 例外全集 = {C4a, C4b, C5, E1, L1, L2, L3a, L3b, L4, L4b, M5示範}**(C4a/C4b 的 cancel 必 COMMIT
  begin 才看得到、C5 的 begin 必 COMMIT cancel 才接得上;E1/L4b 跨 session 需 committed fixture
  ——v4「唯二例外」與 v5 六格字面均不全),每格自帶清理(🔴 含 `payment_double_charge_anomalies`
  ——anomaly FK RESTRICT 會擋 attempts/orders 刪除,漏刪=清理靜默失敗、charged 殘留毒化
  in-flight 閘,首跑實錘)+ 殘留斷言(清後計數=基準);C3/C6 起跑前 preflight assert 全庫
  `order_cancellations`=0(殘留=環境壞、當場 FAIL 而非矩陣紅集漂移)。

### 5.3 zero-regression oracle(v4=**庫內物件差分**;R2-MF7 + R3-F2)

① **主 oracle=`pg_get_functiondef` 差分(庫內生效物件、非檔案文字)**:harness 於拋棄庫
先 `CREATE OR REPLACE` 回 0c(照 0c 檔逐字)→ 取 `pg_get_functiondef` 存 A → 重放本片 migration
→ 取存 B → `diff -u A B` **逐字節等於 harness 內嵌黃金 diff 常數**(=§3.2 ①-④ 的精確 hunks;
⑤ COMMENT 不入 functiondef、由 §5.3⑥ 另證。關卡2 隨 diff 被人審)。**零正規化**(byte-exact;R3-F2「正規化判別力不可審」認列)。
② **檔內唯一性斷言(R3-F2)**:migration 檔內 `CREATE OR REPLACE FUNCTION
public.begin_charge_attempt` 恰出現 1 次(防「檔尾第二個定義才是生效版、awk 抽到第一個」)。
③ 錨斷言(輔助):新錨×4 各唯一;0c 錨全存(dedup ORDER BY 逐字/ON CONFLICT 述詞逐字/
`v_generic_msg` 句/五個既有 reason 字面)。
④ md5(`pg_get_functiondef`)=apply 後封條(部署完整性),不當正確性證明。
⑤ 行為層=S1-S8。⑥ §3.8 三 COMMENT post-oracle。

### 5.4 零留痕

起跑快照九表計數(orders/order_items/payment_charge_attempts/order_cancellations/
order_cancellation_items/order_item_quantity_summary/payment_double_charge_anomalies/staff/
customers),收尾逐表零差。

## §6 驗收條件(逐條 yes/no)

1. §5.3 庫內物件差分(pg_get_functiondef A→B)逐字節=黃金 diff + 檔內定義唯一性 + 錨斷言全過。
2. S1-S8 全綠;S2/S8 斷言 `existing_bank_transaction_id` 逐字。
3. C1-C9b + C2b 全綠(C4a/C4b/C5/L3/L4 含 `pg_blocking_pids` barrier 綁定;C2b=ROLLBACK 內合成態、零 trigger 操作)。
4. M1-M6 × 全格=§5.2 矩陣逐格吻合;還原後全綠、md5 同基準。
5. L1/L2/L3a/L3b/L4(兩趟、victim 各釘一向)/L4b + E1(55P03 面)全綠。
6. migration 內 assert:ACL 回歸(含窮舉+SECDEF fail-open 面)+ 前置閘四支 functiondef md5(§3.8 三支+begin=0c)。
7. 三綠:typecheck+lint(零 .ts ⇒ build 非必;完整 `pnpm test` 對數字)。
8. §5.4 九表零留痕。
9. 剝殼交易模擬於拋棄庫通過(**收編 harness 常設格**:回 0c → BEGIN→全文→ROLLBACK → md5 仍 0c → 重套)。
10. changed-path allowlist:恰 §4 四路徑。

## §7 rollback、apply 前置檢查(R2-MF4/MF5/MF6 可執行版)

**⛔ apply 停點**:commit 後不 apply。

**apply 前唯讀檢查(具體查詢、隨 STOP 檔交付;任一不符=硬停、Sean 批准前不得 apply)**:
1. 函式現定義=0c(md5 比對)。
2. ACL 矩陣(begin=payment_confirmer only)。
3. `SELECT count(*) FROM public.order_cancellations` —— 預期 0。
4. **名單查詢(R2-MF6)**:`SELECT id, display_id, payment_status, cancelled_at FROM public.orders
   WHERE cancelled_at IS NOT NULL ORDER BY cancelled_at` —— **非零列=硬停點**:名單交 Sean 逐單
   看過並明文批准「這些單 apply 後立即拒收款」才可 apply;零列=通過。
5. **隔離預設三層(R2-MF4;R5 修 JOIN 漏 role-only)**:`SHOW default_transaction_isolation;` +
   `SELECT COALESCE(d.datname,'(all-db)') AS db, COALESCE(r.rolname,'(all-role)') AS role,
   s.setconfig FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid=s.setdatabase
   LEFT JOIN pg_roles r ON r.oid=s.setrole WHERE s.setconfig::text ILIKE
   '%transaction_isolation%';` —— 任何層預設非 `read committed`=硬停
   (否則 apply 後所有 begin 打 P8C01=收款中斷)。
6. 四支 functiondef md5=§3.8 已知值+begin=0c(前置閘的站外預演)。
7. **鎖索引述詞 pin(R3-F3;§3.7 倖存者證明的地基)**:
   `SELECT pg_get_indexdef('payment_charge_attempts_order_lock_idx'::regclass)` 逐字=
   `…WHERE (status = ANY (ARRAY['pending'::text, 'charged'::text, 'released'::text]))` 版本
   (拋棄庫親驗字面)—— 不符=硬停(倖存 begin 必 order_locked 的斷言在 prod 失據)。

**apply 後驗證**:md5=新版、四新錨在、三 COMMENT=新字面、`order_cancellations` 仍 0。

**rollback 決策樹(R2-MF5 + R3-F5 + R4-3 可執行版)**:
- 分支1(回 0c 安全)——**單一交易內依序**(消 TOCTOU 含在途 writer;R5 補:只鎖 cancellations
  排不乾「已過 orders 鎖、尚未寫 header」的在途 cancel——它會排隊、在我們 COMMIT 後於 0c 下完成):
  ①`LOCK TABLE public.orders IN EXCLUSIVE MODE`——與 FOR UPDATE 的 ROW SHARE 衝突 ⇒ **等到所有
  在途 cancel/begin/confirm 結束、並擋住新進**(=真 drain;維護窗內付款短暫暫停,本來就是
  rollback 窗)②`LOCK TABLE public.order_cancellations IN ACCESS EXCLUSIVE MODE`(鎖序
  orders→cancellations 與 writer 同向、無死結)③assert `order_cancellations`=0 ④assert
  `orders.cancelled_at` 全 NULL ⑤assert 取消 writer 不存在(`pg_proc` 無 `admin_cancel_order`,
  或其 EXECUTE 已對全角色 false)⑥CREATE OR REPLACE 回 0c + 還原四 COMMENT ⑦COMMIT。
  任一 assert 敗=ROLLBACK 走分支2。
- 取消資料已存在或 writer 活著 ⇒ **回 0c 禁止單獨執行**;唯二路:
  ①先處置全部既有取消資料(結案/退款線)+ 停 writer,再回 0c;②同時 `REVOKE EXECUTE ON
  FUNCTION public.begin_charge_attempt(uuid) FROM payment_confirmer`(付款入口整個停)直到 ① 完成。
  ⚠️ **路②殘窗(R3-N5)**:REVOKE 前已 acquired 的 in-flight attempt 仍可走(A8c2 上線前無守門的)
  `confirm_order_payment` 完款——執行時先盤點
  `SELECT id, order_id, created_at FROM payment_charge_attempts WHERE status='pending'`
  並等其終態或人工處置。兩路皆=Sean 拍板動作,檔尾註記逐字。

**災難日一頁診斷表(R3-F6;隨 STOP 檔交付,Sean 可照抄)**——「全站付款突然全失敗」時按
SQLSTATE 分流(admin/Vercel log 或 DB log 取碼):
| 症狀碼 | 含義 | 一鍵診斷 SQL(完整可貼)| 處置 |
|---|---|---|---|
| `P8C01` | 隔離預設漂移(begin 全被隔離閘擋)| `SHOW default_transaction_isolation;` 加 `SELECT COALESCE(d.datname,'(all-db)') AS db, COALESCE(r.rolname,'(all-role)') AS role, s.setconfig FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid=s.setdatabase LEFT JOIN pg_roles r ON r.oid=s.setrole WHERE s.setconfig::text ILIKE '%transaction_isolation%';`(R4-4:LEFT JOIN 含 `setdatabase=0` 的 role-only 設定)| 把漂移層改回 read committed |
| `55P03` | 鎖等待逾時(5s)| `SELECT pid, state, wait_event, left(query,80) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock';` | 找長交易持鎖者;殺前先確認非取消/退款在途 |
| `permission denied` | begin 被 REVOKE(rollback 路② 或誤操作)| `SELECT has_function_privilege('payment_confirmer','public.begin_charge_attempt(uuid)','EXECUTE');` 加 `SELECT md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure));` | 🔴 **GRANT 回的前置(R4-5)**:md5=**新版**(守門在)才准 GRANT;若 md5=0c 且取消資料非零=rollback 中途態,GRANT 回=重開「取消後收款」,必須先走決策樹完成 rollback 或前滾 |
| 通用「付款處理失敗」大量出現 | 取消守門誤攔(理論上僅 cancelled 單)| §7 前置檢查第 4 條名單查詢 | 名單異常增長=守門讀錯來源,回報工程 |

## §8 已定的非決策項(實作紀律)

- RAISE=`v_generic_msg` 逐字(PF-E);隔離閘獨用 P8C01。
- 守門塊不讀 `order_item_quantity_summary`(A1 契約)。
- migration 檔頭=設計依據+模擬證據(慣例同 0c/A2b1)。
- 內容分級:N/A(本片零面向顧客內容、純 DB 守門)。
- **零待決**:§3.7 由 Sean Q1=A 拍板;v3 對 Q1=A 前提的修正=證明途徑更正(「零錢風險」由
  鎖索引含 released 證得,非「雙方回滾」),結論不變——**此措辭修正隨 STOP 檔回報主視窗對帳**。
