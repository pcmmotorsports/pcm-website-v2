# A8c2 片級 plan:`confirm_order_payment` 金流 confirm 側取消守門(v3)

> 2026-08-04 視窗A(refund-wire)。片型=**高風險**(鐵則 12①錢)⇒ 全 9 步、關卡1 codex、
> 關卡2 雙線不降級。母計畫 row 35(:382):「同 A8c1 合約套在 `confirm_order_payment`(實名)。
> 附負測」。**同構繼承** `docs/specs/2026-08-04-e10-a8c1-begin-cancel-guard-plan.md`(下稱 A8c1 plan;
> 其 §2b 鎖張力先驗、§2c 偵察命中、§3.7 mark 家族分析、§5 harness 形狀全部沿用,本檔只寫差異)。
> **migration 不 apply**(⛔ 停點;Sean 手動)。取消線進度:A8c1 已收割(dev `57612b1`)→ 本片
> → A8a1 → A8a2。
> **v2→v3**:關卡1 codex R1 FAIL(10 must-fix,`/tmp/a8c2-k1-codex-r1.txt`)全折入——鎖面更正/
> P6 優先序/C7b/M2 回歸/P7b+結構 pin/PC1 rowcount 格/部署鏈 pin/診斷表 confirm 行/rollback
> COMMENT+決策樹修向。R2:8/10 closed、殘 2 條(矩陣 C7b 欄/rollback 中間分支)本版折入;
> 輪次判停=同層收斂(07-29 拍板),關卡2 雙線續審。

## §0 位置與行為變化

R8 部署序第二片:confirm 側守門。上線後行為變化:
- 守門對現網恆放行前提同 A8c1(`order_cancellations` 0 列、`cancelled_at` 全 NULL——apply 前名單同查)。
- **鎖面(v2 更正;v1「零新增」字面錯)**:列鎖面全屬既有(orders `FOR UPDATE`=PF-B
  `20260611120000:137-142`;不觸 attempts=r1c3:25 親驗 ⇒ mark 家族環不適用、無 arbiter 邊)。
  **新增一個 relation 級面**:守門 EXISTS 對 `order_cancellations` 取 `ACCESS SHARE` ⇒ 與
  `ACCESS EXCLUSIVE`(如 §7 rollback 維護交易)互斥=新等待/55P03 可能。負測=E2′ 格;
  ⚠️ 同一面 A8c1 的 begin 守門同樣存在(其 plan 未列),隨 STOP 檔一併對帳。
- **隔離閘**:同 A8c1 ①(RR 洞同構:confirm 等鎖醒來後 EXISTS 舊快照漏看已 commit 取消)⇒
  非 RC 一律 P8C01。

## §1 目標

R8 窗口的 confirm 側:取消後遲到的 TapPay callback/settle 重放仍能把已取消單翻 paid(收原額)。
本片在 confirm 入口對「存在任何取消紀錄」的單 RAISE 拒確認;**含最危險的 C7 形狀:已取消且已
paid 的單重放同 rec 同額,不得回 `{confirmed:true, idempotent:true}`**(守門在 paid 冪等樹之前)。

## §2 親讀契約(差異項;其餘=A8c1 plan §2)

| 契約 | 出處 | 約束 |
|---|---|---|
| 片規格 | master plan row 35 `:382` | 同 A8c1 合約套 confirm、附負測 |
| 基底本體 | `20260611120000:117-199`(唯一定義,全 repo grep 親驗) | PF-B FOR UPDATE 已在(:137-142);PF-D 冪等樹(:149-167);PF-C rowcount(:186-190);PF-E 通用訊息 `confirm_order_payment: 付款確認失敗`;PF-G 5 欄;unique backstop(:194-197) |
| 輸入驗序 | `:132-135` | `p_rec_trade_id` 非空檢查在 PF-B 之前(非觸表、具體訊息)——隔離閘插最前、此檢查順位不變 |
| TS 呼叫端 | `packages/adapters/src/payment/PaymentConfirmerAdapter.ts:128`(唯一,親驗) | pg client 直呼;RAISE→throw 既有路徑 ⇒ 零 TS 改動 |
| confirm 不觸 attempts | `20260624120010:25` | 列鎖面全屬既有的依據(relation 級新面另列 §0/E2′)|

## §3 設計

### 3.1 產物形狀

`supabase/migrations/20260804150000_m4b_e10_a8c2_confirm_cancel_guard.sql`,自帶 BEGIN/COMMIT。
= confirm CREATE OR REPLACE + COMMENT 更新 + **前置閘兩支**(①confirm functiondef md5=現值
②**begin md5=A8c1 新版 `f621a562…`——部署鏈 pin,A8c1 未落地不得套本片**;R8 序 DB 層強制)+ ACL 窮舉 assert(含 GRANT OPTION 指紋,同 A8c1 版式)
+ SECDEF fail-open 面 assert(orders/order_cancellations owner 對齊+FORCE RLS off;confirm 不讀
attempts ⇒ 兩表)+ 結構碼錨 assert。

### 3.2 相對基底的改動 —— 四處、逐處具名

① **隔離閘**(入口第一檢查、在 `p_rec_trade_id` 輸入驗之前):同 A8c1 字面,訊息
`confirm_order_payment: isolation guard`、ERRCODE **P8C01**。**v2 更正:錯誤優先序有變**——
RR/serializable 下空 rec 會先收 P8C01(fail-closed 最前置的代價,刻意);RC 下 P6 訊息不變。
交叉格 C9c 釘死此語意。
② PF-B SELECT(:138)加欄 `cancelled_at`(`FOR UPDATE` 既有、不動)。
③ `NOT FOUND`(:145-147)後、**paid 冪等樹(:150)之前**新增取消守門塊(字面同 A8c1 ③,
`v_generic_msg` 用 confirm 自己的)。順序=硬要求:守門在冪等樹前,C7 才成立。
④ COMMENT ON FUNCTION 更新(取消守門、隔離閘、C7 語意)。
其餘(輸入驗、PF-D 樹、cross-order pre-check、PF-G UPDATE、PF-C、EXCEPTION backstop)
**一字不動**;基底無過時註解(A8c1 ④ 的等價物不存在,親讀確認)。

### 3.3 誠實邊界

- 「cancel 樣式」仍為手動 SQL 模擬(A8a1 未上線);同 A8c1 §3.6。
- 🔴 **A8a1 硬前置(K2 折入;比 A8c1 §2b「重開 40P01」更重)**:A8a1 若「先 INSERT
  `order_cancellations` 再鎖 orders」,confirm 可先取列鎖、RC 下 EXISTS 看不到未 commit 子列
  ⇒ 翻 paid 後 cancel 才 commit=paid+cancelled 並存=**守門被靜默繞過**(harness C4 只蓋
  lock-first 序)。A8a1 plan 必引:orders FOR UPDATE 恆第一觸表動作=守門互斥的成立前提。
- P8C01 在呼叫端(`PaymentConfirmerAdapter.ts:198-209`)落 unreachable「連線失敗(可重試)」
  分支——§7-6 apply 前隔離三層檢查是正確擋法;若正式站真見 P8C01,勿當連線問題重試,
  走 §7 診斷表。
- C5 反向格:confirm 先完成翻 paid → cancel 樣式取鎖 → allowed-set 模擬(paid 單)判拒——
  證機制、A8a1 片真驗。
- 不宣稱 27 項綠燈。

## §4 產物清單(=§6 allowlist,恰 3 路徑)

1. migration `20260804150000_m4b_e10_a8c2_confirm_cancel_guard.sql`
2. `scripts/a8c2-verify.sh`
3. 本 plan 檔。
(無 backlog 項:#321 已存在、本片零新債。)

## §5 harness 設計(`scripts/a8c2-verify.sh`;形狀=a8c1-verify.sh 全套慣例:身分閘、
黃金差分、COMMENT md5 pin、前置閘負向格、剝殼模擬格、preflight、九表零留痕、計數閘)

### 5.1 行為 cells

**回歸格 P1-P7(PF-D 樹逐支;fixture 慣例同 A8c1)**:
P1 unpaid+額符+rec 新 → `{confirmed:true,idempotent:false}` 且 orders 翻 paid 恰 5 欄
(payment_status/tappay_rec_trade_id/paid_at/payment_method='tappay'/updated_at)。
P2 paid+同 rec+同額重放 → `{confirmed:true,idempotent:true}` 且零 UPDATE(updated_at 不刷)。
P3 paid+異 rec → RAISE 通用。P4 `payment_status='refunded'` → RAISE(同 rec 也不復活)。
P5 額不符/NULL → RAISE。P6 rec NULL/空白 → RAISE『交易識別碼缺失』(具體訊息,基底既有)。
P7 cross-order rec 重用(單連線序列)→ RAISE。
**P7b(v2 補;backstop 判別)**:兩張乾淨單、兩連線併發同 rec → 恰一 confirmed、另一 RAISE
(UNIQUE backstop 承重的那條路);**結構 pin**:`orders.tappay_rec_trade_id` 的 UNIQUE indexdef
逐字 assert(migration 內)——pre-check 與 backstop 行為同訊息不可判別(誠實認列,同 A7-1
「被支配檢查」課),安全承重=UNIQUE 索引存在性+P7b。
**守門格**:
C1 `cancelled_at` 非空(unpaid)→ RAISE 通用。C2 header+item → RAISE。C2b header-only
(ROLLBACK 合成態)→ RAISE。C3 乾淨單 → P1 語意照常。
C4a/C4b 併發(整單/部分樣式;cancel 持鎖寫入未 commit → confirm 阻塞
〔`pg_blocking_pids` barrier、app_name 唯一化〕→ cancel COMMIT → confirm 醒來 RAISE)。
C5 反向序列化(confirm 先;見 §3.3)。
C6 跨單隔離 → confirmed。
**C7 冪等樹前置(本片核心負測)**:單先走 P1 翻 paid → 補寫 `cancelled_at`(合成防禦縱深態)
→ 同 rec 同額重放 → **RAISE、非 idempotent 成功**。
**C7b(v2 補;EXISTS 分支的冪等樹前置變體)**:P1 翻 paid → 插 header+items(`cancelled_at`
NULL=部分取消合成態)→ 同 rec 同額重放 → RAISE 非 idempotent——擋「EXISTS 分支被移到
冪等樹後」這型變異(M3 下本格紅)。
C8 cancel ROLLBACK(SAVEPOINT)→ confirmed。C9a RR → P8C01;C9b SERIALIZABLE → P8C01;
**C9c(v2)**:RR+空 rec → P8C01(優先序語意釘死)。
**PC1(v2;PF-C rowcount 承重格)**:in-tx 建 BEFORE UPDATE 回 NULL 的抑制 trigger(合成)→
confirm(unpaid、額符)→ UPDATE 0 列 ⇒ **必 RAISE 通用**(不得回 confirmed 而單仍 unpaid);
ROLLBACK 清 trigger。
**鎖格**:L2′ 序列化格(cancel 樣式 vs confirm 兩向阻塞-完成、零 40P01;`pg_blocking_pids`)。
**E2′(v2;relation 級新面)**:另 session 持 `order_cancellations` ACCESS EXCLUSIVE → confirm
(`SET lock_timeout='1s'`)→ 55P03 且訂單未翻 paid(§0 新面的可觀察證據)。
不設 L3/L4(列鎖面零新增,§0;A8c1 家族格同庫已由 a8c1-verify 覆蓋)。

### 5.2 突變矩陣(七個 mutant × 全 vector;紅綠逐格、多紅少紅皆 FAIL;fixture 生命週期同 A8c1)

| 突變 \ 格 | P1-P7 | C1 | C2 | C3 | C4a | C4b | C5 | C6 | C7 | **C7b** | C8 | C9a | C9b | **C9c** | **PC1** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| M1 拿掉整塊守門 | 綠 | 紅 | 紅 | 綠 | 紅 | 紅 | 綠 | 綠 | 紅 | 紅 | 綠 | 綠 | 綠 | 綠 | 綠 |
| M2 拿掉 `FOR UPDATE` | 綠 | 綠 | 綠 | 綠 | 紅* | 紅* | 綠** | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 |
| M3 只拿掉 EXISTS 分支 | 綠 | 綠 | 紅 | 綠 | 綠 | 紅 | 綠 | 綠 | 綠 | **紅**(R2-3)| 綠 | 綠 | 綠 | 綠 | 綠 |
| M4 只拿掉 `cancelled_at` 分支 | 綠 | 紅 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 紅 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 |
| M5 拿掉隔離閘 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 紅 | 紅 | 紅 | 綠 |
| M6 EXISTS 掉 WHERE | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 紅 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 |
| M8 拿掉 PF-C rowcount 塊 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | 綠 | **紅** |

排除格(不進突變 vector):E2′/P7b/L2′/C2b(環境事實/backstop/合成態;M 期間跳過,同 A8c1 慣例)。

*M2-C4 oracle=終態斷言:無鎖時 confirm 的守門讀不到未 commit 取消、其 UPDATE 列鎖仍會等
cancel 的 FOR UPDATE(阻塞觀察由別的機制供給——A8c1 M2-C5 同課),cancel commit 後 EPQ 重查
`payment_status='unpaid'` 仍成立 ⇒ 翻 paid 完成=「confirmed 與 cancelled 並存」終態=紅。
**M2-C5=綠(無判別力,明列)**:cancel 樣式仍被 confirm 的 UPDATE 列鎖擋住。
C4a/C4b 在 M1 下同為終態斷言。M5 附 RR 洞示範(**計分格**、含 blocker barrier;v3 更正原「非計分」字面)。M8 的 PC1 紅=回 confirmed 而 orders 仍 unpaid 的壞終態。

### 5.3-5.4 oracle 與零留痕

同 a8c1-verify.sh:①庫內物件差分(REPLACE 回基底→A→重放 migration→B→黃金 diff byte-exact)
②檔內定義唯一性 ③碼錨(code-exact)④md5 封條 ⑤COMMENT md5 pin ⑥前置閘負向格(confirm 漂移
⇒ RAISE)⑦剝殼模擬格 ⑧九表零留痕+CLEANUP_FAIL ⑨計數閘。

## §6 驗收條件(逐條 yes/no)

1. 黃金差分 byte-exact + 檔內唯一性 + 碼錨全過。
2. P1-P7 回歸全綠(P2 含 updated_at 不刷斷言)。
3. C1-C9c + C2b + C7/C7b + PC1 + E2′ + P7b 全綠(C4/C5/L2′ 含 pg_blocking_pids barrier)。
4. 突變七組(M1-M6 去 M7 + M2 回歸 + M8)× 全 vector 逐格吻合;還原後 md5=基準。
5. migration 內 assert:前置閘兩支(confirm md5+begin=A8c1 新版)+ ACL 窮舉(含 GRANT OPT)
   + SECDEF fail-open 面 + `tappay_rec_trade_id` UNIQUE indexdef pin。
6. 三綠:tc+lint(零 .ts ⇒ build 非必;完整 pnpm test 對數字)。
7. 剝殼模擬格綠;九表零留痕。
8. changed-path allowlist 恰 §4 三路徑。

## §7 apply 前置檢查與 rollback

**⛔ apply 停點**。apply 前唯讀六條(隨 STOP 檔交付):
1. confirm 現定義 md5=前置閘已知值。2. **begin md5=A8c1 新版(部署鏈;未符=先 apply A8c1)**。
3. ACL 窮舉=payment_confirmer,postgres 零 GRANT OPT。4. `order_cancellations`=0。
5. `cancelled_at` 非空名單(非零=硬停、Sean 逐單批准)。6. 隔離預設三層=RC。

**apply 後 read-back(獨立於前六條;v3 分節)**:confirm md5=新版、碼錨+順序錨在、COMMENT md5=新值。
**災難日診斷表(v2:confirm 專屬行,不沿用 begin 行字面)**:
| 症狀 | 一鍵 SQL | 處置 |
|---|---|---|
| `permission denied`(confirm)| `SELECT has_function_privilege('payment_confirmer','public.confirm_order_payment(uuid,integer,text)','EXECUTE');` + `SELECT md5(pg_get_functiondef('public.confirm_order_payment(uuid,integer,text)'::regprocedure));` | md5=**新版**才准 GRANT 回;=基底且取消資料非零=rollback 中途態,走決策樹 |
| P8C01 / 55P03 | 同 A8c1 表(閘與 timeout 家族共用)| 同 A8c1 |
| 「付款確認失敗」大量 | §7-5 名單查詢 + `order_cancellations` 計數 | 名單異常增長=守門讀錯來源 |
**rollback(v2 修向)**:
- 取消資料=0 且取消 writer 不存在:單一交易(LOCK orders EXCLUSIVE → LOCK cancellations
  ACCESS EXCLUSIVE → assert 資料零+writer 無 → REPLACE 回基底 + **還原基底 COMMENT**(v1 漏;
  否則 catalog 仍宣稱守門在)→ COMMIT)。
- **資料零但取消 writer 活著(R2-10 補):先 `REVOKE EXECUTE` admin_cancel_order(全角色)**
  ⇒ writer 依可執行定義轉「不存在」→ 進上一分支交易(其 LOCK 排乾在途)→ assert 資料仍零+
  EXECUTE 已收 → REPLACE+還原 COMMENT → COMMIT;日後恢復取消功能=重新 GRANT(Sean 拍板)。
- 🔴 **回退後的重新前進序(K2 折入;消「回基底後 GRANT writer」自撞)**:分支1/中間分支完成
  回基底後,恢復取消 writer(GRANT admin_cancel_order)之前**必須先重套 A8c1+A8c2 守門**
  (兩支 md5=新版)——R8 部署序在回退後同樣成立,先守門後 writer,永不反向。
- **取消資料已存在:任何守門(A8c1 或本片)一律不得回退**——v1「同批回退才閉窗」方向寫反:
  兩支都退=同時重開兩個付款入口對已取消單收款。唯一路=先處置全部取消資料(結案/退款線),
  資料歸零後才回到上一分支。in-flight attempt 殘窗同 A8c1 §7 註記。檔尾逐字。

## §8 已定非決策項

- 訊息=confirm 的 `v_generic_msg` 逐字;隔離閘 P8C01 家族同碼。
- 守門不讀摘要表(A1 契約)。
- 內容分級:N/A。零 Sean 決策題(全由母計畫 row 35 + A8c1 已拍框架定死)。
- A8c1 §2b 附帶紀律(先寫子列再鎖 orders=禁)本片自動滿足:守門塊零寫入、鎖=基底既有第一動作。
