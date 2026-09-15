# 2026-09-15 · 重試放棄章在單已處理後不會消失 —— plan(v3)

> A 窗寫。主視窗 pcm-website-v2-b7 派工;Sean 逐字「甲、甲」= 先寫計畫給他看。
> **本檔只是 plan,零碼、零 migration。** 會碰健康檢查函式定義(schema)+ 告警文案(錢的告警)⇒ 鐵則 8 + 12。Sean 已拍 §8(甲、甲、甲)⇒ 本 plan 過審查、主視窗核過回「可以開工」才寫碼。
> 來源:P1-6 文案片 adversarial-reviewer R2 的 nit(`9b9f846a5` commit body 末段)。
> v1 `599bf2a63`;v2 = Sean 拍板(§8-0)+ plan 審查 R1(FAIL:MF1 流程 + S1–S3 + N1–N5)全數收進;v3 = plan 審查 R2(PASS-with-comments)的 C1–C3 與 nit 收進。落點見 §10。

## 1. 白話

- 匯款 / 現金單收了錢而狀態沒翻,重試排程每 10 分鐘會再算一次;連續 5 次失敗就蓋一個「放棄章」。
- 告警信的【匯款單修不好】【現金單修不好】兩段,數的就是「身上有放棄章的單」。
- **問題**:員工後來把那張單處理好(補登收款、沖銷、整單取消、客人同一購物車改刷卡…),單就不在排程的重試範圍裡了 ⇒ **排程再也不會碰它 ⇒ 章永遠留著 ⇒ 那兩段每天都會叫同一張已經處理好的單。**
- 同一件事還有另一半:放棄那一刻寫的事故紀錄(`settle_retry_gave_up`)也永遠算「未處理」—— 而**所有種類的事故都一樣**,因為事故表的「已處理」欄位今天沒有任何寫入端(§8 Q2、Q3)。
- 正式庫今天那張表 **0 列**(§2 事實 #9)⇒ 目前沒有實害;這是「上線後第一次有單被放棄、又被人工處理掉」那天才會出現的噪音。

## 2. 查到的事實

| # | 事實 | 出處 |
|---|---|---|
| 1 | 排程候選 = 匯款 / 現金、未取消、(unpaid 且淨額 > 0)或(partiallyPaid 且淨額 >= total)、沒有未作廢人工退款;另加「沒章或章已滿 24 小時」 | `20260916060000_m4b_p16_settle_recompute_failure_visibility.sql:427-438` |
| 2 | 章只有兩個地方會被拿掉:① 重算成功(`gave_up_at = NULL`)② 滿 24 小時後重開、第一次失敗從 1 起算(`gave_up_at` 回 NULL)—— **兩者都要單先被候選查詢撈到** | 同檔 `:436`、`:454` 起的成功 / 失敗 upsert |
| 3 | 候選但 OP6a 判 overpaid / needs_human 的單:迴圈跳過、**不寫 attempts** ⇒ 章也不會被拿掉 | 同檔 `:454`(只處理 settled / underpaid)、`:417` ponytail 註解 |
| 4 | 放棄健康檢查只看 `gave_up_at IS NOT NULL`(JOIN orders 分匯款 / 現金),**不看單現在還在不在候選** | 同檔 `:629-673`(`'gave_up_count',` 在 `:641`) |
| 5 | 全 repo 沒有任何 `DELETE FROM public.pcm_settle_retry_attempts`;表只有 PK、沒有 FK 到 orders | grep migrations / scripts / apps / packages 零命中;建表 `20260905220000:47-53` |
| 6 | 讀這張表的只有:排程、放棄健康檢查、`pcm_readonly` 欄位 SELECT | `20260905220000`、`20260916060000:629`、`20260906380000:151` |
| 7 | 事故 `settle_retry_gave_up` 只在「這次 upsert 蓋了新章」時寫、同單未解決不重寫;`resolved_at` 全 repo 無寫入端(後台事故頁只讀) | `20260916060000` 排程事故段;`apps/admin/src/lib/incidents/incident-repository.ts:51`(只讀 `openOnly`) |
| 8 | 告警 `shouldAlert` 含 `pcmIncidentOpenTotal > 0`;`open_total` = `resolved_at IS NULL` 的列數 ⇒ **任何一筆事故寫下之後,每天都會觸發告警信**(不限本 kind) | `packages/use-cases/src/check-anomaly-alerts.ts:3138`;`20260905290000:200` |
| 9 | **正式庫唯讀量(2026-09-15)**:`pcm_settle_retry_attempts` 0 列、放棄章 0、attempts > 0 的 0;匯款單 unpaid 6 / refunded 1、現金單 0;`pcm-settle-retry` 排程 `*/10 * * * *` active。🔴 `pcm_incident` **未量**:唯讀角色對該表 permission denied | `bash scripts/readonly-prod-sql.sh`(查詢檔在 A 窗 scratchpad,只數不印單號) |
| 10 | 信件文案「放棄章 24 小時後會被拿掉」只在單仍是候選時成立 | `check-anomaly-alerts.ts:1823`、`:2447`(`GAVE_UP_SECTION_SPLIT`) |

### 2-1 單會離開候選的寫入路徑(逐條查最新一代)

盤點方法:grep migrations 寫入語句 ⇒ `scripts/latest-definition-of.sh` 取最新一代 ⇒ grep apps / packages 找呼叫端(Explore 盤點,A 窗抽核關鍵行)。

| 路徑 | 最新定義 | 讓單離開候選的方式 | 呼叫端 |
|---|---|---|---|
| **員工補登收款**(匯款 / 現金) | `admin_record_manual_payment` `20260915234000:92` | INSERT order_payments ⇒ trigger 重算 ⇒ 翻 paid / partiallyPaid(淨額 < total) | `apps/admin/src/lib/orders/payment-repository.ts:207,212` |
| **員工沖銷收款** | `admin_reverse_manual_payment` `20260812150000:344` | INSERT 反號列 ⇒ 重算 ⇒ 淨額降到 0(unpaid 且淨額 0)或 partiallyPaid 且淨額 < total | `payment-repository.ts:269` |
| 重算本身(收款 trigger / 排程) | `pcm_noncard_settle_recompute` `20260916060000:150` | 狀態翻對 ⇒ 不再是候選(若是排程那一次成功,章會被拿掉;**若是員工補登觸發的那一次成功,章不會被拿掉**) | trigger `pcm_noncard_settle_after_payment_ai`;排程 |
| **員工整單取消** | `admin_cancel_order` `20260914050000:295` | `cancelled_at` 有值 | `apps/admin/src/lib/orders/cancel-repository.ts:299` |
| 員工登記人工退款 | `admin_record_manual_refund` `20260912040000:63` | 🔴 **對候選單不可達**(R1 S1):它無條件呼叫 `pcm_sync_order_refund_payment_status`(`20260912040000:313`),最新一代(`20260914060000:215`)狀態不在 paid / partiallyRefunded / refunded 就 RAISE ⇒ unpaid / partiallyPaid 的單整筆回捲。只有更早寫進去的舊資料會命中排程那條 NOT EXISTS | `apps/admin/src/lib/payment/manual-refund-repository.ts:203` |
| 員工作廢人工退款 | `admin_void_manual_refund` `20260912040000:319` | 同上,也呼叫 sync(`:395`、`:458`)⇒ 對候選單不可達 | `manual-refund-void-repository.ts:102` |
| 客人同一購物車改刷卡(supersede) | `begin_charge_attempt` `20260904050000:65`;`mark_charge_attempt_charged(_fallback)` `20260906700000:158/:354`;`confirm_order_payment` `20260906700000:522` | 同 cart 的 unpaid 匯款單被 `cancelled_at` | checkout 卡片流程(`PgChargeAttemptAdapter.ts:66,76`、`SupabaseChargeAttemptFallbackAdapter.ts:33`、`PaymentConfirmerAdapter.ts:128`) |
| 卡片確認付款 | `confirm_order_payment` `20260906700000:522` | 本體只驗 `payment_status='unpaid'`、不驗管道 ⇒ 理論上可把匯款 / 現金 unpaid 單翻 paid | 同上;**未確認**實際可達(卡片流程只傳卡片單) |

排除(與候選互斥,不會咬到):`pcm_cron.expire_unpaid_orders`(要求淨額 <= 0)、`admin_mark_order_cancelled`(只收刷卡且 refunded)、`settle_zero_total_order`(total = 0;repo 找不到呼叫端,**未確認**接線)。
`payment_channel` 建單後沒有 UPDATE 寫入端;沒有任何 DELETE orders。`orders.total` 有一個寫入端 `admin_update_order_item_amount`(最新一代 `20260915060000:1805` 寫 `total = v_total`),而它在 `:1702-1709` 只要有任何收款列就 RAISE ⇒ **碰不到候選單**(候選單一定有收款列)(R2 nit)。

## 3. 缺口

| 缺口 | 現況 | 後果 |
|---|---|---|
| G1 放棄數不分「還在候選」 | 事實 #2、#4 | 單被處理好後【匯款單 / 現金單修不好】每天叫同一張 ⇒ 真正修不好的單混在噪音裡 |
| G2 事故「曾經放棄過」永遠未處理 | 事實 #7、#8 | 告警信每天寄(事故段);**這一條所有事故種類都一樣**,不是本 plan 造成的 |
| G3 文案「24 小時後會被拿掉」不完全對 | 事實 #10 | 讀信的人以為章會自己消失 |
| G4(既有、只記不修)候選但判 overpaid / needs_human 的單章不會被拿掉 | 事實 #3 | 那張單【修不好】段會一直在。匯款單同時會出現在 A / B 世界(卡住 / 多收)⇒ 重複講;🔴 **現金單不會**(A / B 只看匯款,`20260916060000:567-575`)⇒ 對現金單,放棄段是它唯一的出口 ⇒ **留著是對的**(R1 N2) |

## 4. 做法(推薦甲;§8 Q1)

### 甲(推薦):健康檢查只數「還在候選」的章 —— 讀端過濾,不刪任何資料

- 新增 `public.pcm_settle_retry_still_candidate(p_order_id uuid) RETURNS boolean`:SQL、STABLE、SECURITY DEFINER、`SET search_path = ''`;條件逐字等於排程候選的【單那一半】(事實 #1,不含 attempts / 24 小時那一條)。owner postgres、四道 REVOKE、零 GRANT(照 `pcm_settle_verdict_safe` 的形狀)。
- `CREATE OR REPLACE get_settle_retry_gaveup_health`:`gave_up_count` / `oldest_gave_up` / `sample_order_ids` 與現金三鍵,都加 `AND public.pcm_settle_retry_still_candidate(a.order_id)`;兩個 sample 鍵的過濾寫在子查詢 `x` 裡、`LIMIT 5` **之前**(寫在外層會先截 5 張再濾 ⇒ 少列)(R2 nit)。**鍵名、鍵數不變** ⇒ TS adapter 與 key-contract 測試不用改。`tracked_total` 語意不變(全表列數)。
- 排程**不動**(它的候選查詢是集合查詢 + LIMIT,改成逐列呼叫函式會變慢)。
  - ponytail:條件在排程與新函式各寫一份。上限:有人改排程候選條件而忘了改這支 ⇒ 兩者漂開。擋法:驗收世界 13(兩者對同一批 fixture 判定逐張相同);升級路徑:兩支都改讀同一個 view。
- 章與 attempts 列**原樣留著**:單之後若又回到候選(例:沖銷後又補登),排程照舊處理、24 小時重開規則照舊。
- migration 細節(R1 S3 / N1 / N3):
  - **前置閘**(照 `20260916060000:31-57`):`get_settle_retry_gaveup_health()` 同名只有 1 支、md5 = `77690bb08e3aea51714ec53251ca296c`、owner postgres、SECURITY DEFINER、`proconfig = {search_path=""}`、ACL = `{postgres=X/postgres,service_role=X/postgres,payment_confirmer=X/postgres}`;`public` 裡名叫 `pcm_settle_retry_still_candidate` 的函式 **0 支**(按名字數,不只查 `(uuid)` 簽名)(R2 nit)。
    🔴 **也釘排程 `pcm_settle_retry_sweep()`**(R2 C1):md5 = `92eb9d8c534804dc74776b9dbad5adb0`(repo `20260916060000` 那一代本體,從檔案算;**貼前對正式庫再量一次**)、owner postgres、ACL `{postgres=X/postgres}`。新函式是排程候選條件的複本 ⇒ 別窗若在寫碼到貼板之間出了一代新排程改候選條件,本片要擋下而不是靜靜漂開。任一不符停(不讓別窗出的新一代被靜靜蓋掉)。
  - `CREATE OR REPLACE` 會整組換掉 SET 子句 ⇒ 新一代照寫 `SET search_path = ''`;`jsonb_build_object` **每個鍵獨佔一行、逗號結尾**(`20260916060000:637` 註解;key-contract 正則靠它抽鍵)。
  - **事後閘**(照 `20260916060000:698-709`):新函式存在、owner postgres、definer、search_path 空、STABLE、ACL `{postgres=X/postgres}`;對 anon / authenticated / service_role / payment_confirmer / pcm_readonly 零 EXECUTE;anon 經 SET ROLE 切得過去而可執行的角色零列(`docs/patterns/revoking-function-execute-in-supabase.md` §3.5);健康檢查 ACL 與改之前逐角色相同;本體含 `pcm_settle_retry_still_candidate`。
  - 收權斷言清單 `v_functions text[] := ARRAY[...]` 要列新函式(`migration-new-file-static-checks.sh` 規則③)。
- 🔴 **上線順序拆兩顆**(R1 MF1,照 P1-6 前例):
  1. **第 1 顆** = migration(版本號 `20260916070000`)+ rollback,只寫檔不貼、commit 不推。
  2. 主視窗合進 dev ⇒ 端 Sean 貼板 ⇒ **貼完同批跑 `pcm_acl_approve_latest`(p_note 帶 `20260916070000`)**(R1 S2;每日 ACL 摘要把 public 每支函式都算進去,`20260909060000:136-143`,多一支不核准就轉紅;前例 `20260916040000:22`)⇒ `APPLIED.tsv` 那一列同顆 commit、推。
  3. **第 2 顆** = TS 文案兩處(跟上 dev 之後才 commit)。🔴 文案不能早於 DB 生效:信寫「已不在重試範圍時不再算」而 DB 還照算 ⇒ 字面與事實不符。
  - 兩顆之間 `anomaly-alert-key-contract.test.ts` 的「最新一代要在 APPLIED.tsv」那格對 `get_settle_retry_gaveup_health` 會紅(`:325-336`)⇒ **預期**;第 1 顆 commit 不 stage adapter,那條 lint-staged 不觸發;推之前主視窗的整包 `pnpm test` 會看到它,要貼板記帳後才綠 ⇒ **第 1 顆合進 dev 到貼板記帳之間,主視窗不推別的批次(或先貼板)**(R2 nit)。
- 文案(TS,第 2 顆):`GAVE_UP_SECTION_SPLIT`(`check-anomaly-alerts.ts:2447`)與事故段 `settle_retry_gave_up` 那行(`:1823`)改成「單已不在重試範圍(已補登 / 沖銷 / 取消)時不再算進這一段;事故那筆紀錄照樣留著」;兩處都拿掉「章 24 小時後會被拿掉」的全稱句(G4 的單不成立)(R1 N4)。🔴 **另兩行同一種話一起改**(R2 C2):【匯款單修不好】`:1762`、【現金單修不好】`:1779` 的「放棄有 24 小時冷卻, 一張單會反覆進出它」⇒ 改成「還在重試範圍的單, 放棄 24 小時後會再試一次;已處理掉的單不再算進來」。

### 乙:排程每輪把「已不在候選」的章清掉(寫端)

- 排程開頭多一句 `UPDATE pcm_settle_retry_attempts SET gave_up_at = NULL, attempts = 0 WHERE gave_up_at IS NOT NULL AND NOT still_candidate(order_id)`(或 DELETE)。
- 代價:排程多一條寫入路徑(SECURITY DEFINER、每 10 分鐘);最多延遲 10 分鐘;歷史(試過幾次、最後錯誤)被抹掉;要再過一次 P1-6 那 21 個排程世界。
- 不推薦:甲做得到同樣的告警結果而零寫入。

### 丙:在 orders / order_payments / order_manual_refunds 掛 trigger 清章

- 事實 #2-1 有 8 條路徑、3 張表 ⇒ 三個 trigger + 與既有 trigger 的順序問題(`project_0914-orders-trigger-two-standards-not-unified`)。**不推薦。**

## 5. 影響

- Sean / 員工:單處理好之後,【匯款單 / 現金單修不好】隔天就不再列它。
- 事故段不變:`settle_retry_gave_up` 那筆照樣算未處理、照樣讓告警每天寄(§8 Q2 / Q3 決定要不要另外處理)。
- 客人:無。
- 效能:新函式只對「有章的列」逐列呼叫;正式庫 0 列,上限是放棄過的單數。
- G4 不修。
- 附帶(R1 核):過濾後列出的單都滿足淨額 > 0 ⇒ 信上「這些人已經匯了錢」更準(以前沖銷到 0 的單也會被列)。

## 6. Rollback

- 同一交易:`CREATE OR REPLACE get_settle_retry_gaveup_health` 回 `20260916060000:629` 那一代(前置閘釘本片 md5;事後閘驗 md5 回到 `77690bb08e3aea51714ec53251ca296c`)⇒ `DROP FUNCTION pcm_settle_retry_still_candidate(uuid)`(先退呼叫端再 DROP)。
- `CREATE OR REPLACE` 保留 ACL / owner;事後閘逐角色核 `{postgres=X/postgres,service_role=X/postgres,payment_confirmer=X/postgres}`。
- 不會被撤銷的事實:無(甲零寫入)。
- 🔴 **退完同批跑 `pcm_acl_approve_latest`**(p_note 帶 `20260916070000` rollback)(R1 S2)。
- 順序:先 revert TS 第 2 顆(文案)⇒ 再退 DB(否則信會說「不再算」而 DB 已回舊版照算)。鍵沒變,任一邊先退都不會 503。

## 7. 驗收

**拋棄式 PG**:從最新 schema dump 起,依序套到 188(`20260916060000`)⇒ 再套本片。每個世界先造一張「被蓋了放棄章」的單(attempts 5、`gave_up_at` 有值),再走一條路徑:

1. 仍是候選(什麼都不做)⇒ `gave_up_count = 1`(匯款)/ `gave_up_cash_count = 1`(現金)。
2. 員工補登收款到足額 ⇒ 重算翻 paid ⇒ 放棄數 0;attempts 列還在。
3. 員工補登到「部分付款且淨額 < total」⇒ 0。
4. 員工沖銷到淨額 0(unpaid)⇒ 0。
5. 員工整單取消 ⇒ 0。
6. 有未作廢人工退款 ⇒ 0;作廢那筆退款 ⇒ 回到 1。🔴 **用 fixture 直接寫 `order_manual_refunds`(含 `voided_at` 三欄),不走 RPC** —— RPC 對候選單會 RAISE 回捲(§2-1,R1 S1);這一格驗的是等價,不是可達。
7. 同 cart 改刷卡 supersede(直接寫 `cancelled_at`,原因 superseded_by_card)⇒ 0。
8. 訂單被刪(直接刪 fixture;正式碼沒有 DELETE)⇒ 0(JOIN 不到)。
9. 候選但 OP6a 判 overpaid(事實 #3,G4)⇒ 仍算 1(本 plan 不修,驗收寫明)。
10. 現金單把 1–6 各跑一次(同上結果)。
11. `tracked_total` 全程 = 全表列數,不因過濾改變。
12. `settle_retry_gave_up` 事故列全程不變(甲不碰事故表)。
13. 🔴 **條件對齊**:對一批 fixture 逐張比「排程候選查詢撈得到(去掉 attempts 條件)」與 `pcm_settle_retry_still_candidate()` ⇒ 全部相同。🔴 **比對用的查詢要從排程這一代本體逐字貼**(`20260916060000:420-433` 的 FROM / JOIN / WHERE,md5 釘 `92eb9d8c…`),只拿掉 attempts / 24 小時那三行;**不得照新函式重寫一份**(那是拿自己比自己)(R2 C3)。fixture 必含邊界(R1 N5):partiallyPaid 淨額 = total、partiallyPaid 淨額 = total − 1、unpaid 淨額 0、unpaid 淨額 > 0 而已取消、card(tappay)管道、paid 狀態、有已作廢人工退款、有未作廢人工退款、有沖銷列。
14. 新函式以 PUBLIC / anon / authenticated / service_role / payment_confirmer / pcm_readonly 呼叫 ⇒ 全部 permission denied;anon 經 SET ROLE 繞路枚舉零列;健康檢查以 service_role / payment_confirmer 呼叫照常(R1 N1)。
15. 前置閘:健康檢查 md5 被改過 / 排程 md5 被改過 / 新函式(按名字)已存在 ⇒ 各自擋下(R1 S3、R2 C1)。
16. rollback 後 md5 回到 `77690bb0…`、新函式不存在、ACL 逐角色相同。
- 靜態:`migration-new-file-static-checks.sh` 八道全過(含規則③收權斷言清單)、`rollback-locktimeout-gate.py`。
- 第 1 顆:三綠;key-contract 帳本格對 `20260916070000` 紅(預期,見 §4 上線順序)。
- 第 2 顆(貼板記帳後):文案兩處改字、測試釘字面;key-contract / incident-kind-two-truths 綠;整包 `pnpm test` 紅 0;三綠。
- 審查:adversarial-reviewer 每顆一輪(缺 codex 那一路,09-20 前);R2 仍有 must-fix 停。
- 貼板前再唯讀量一次 `pcm_settle_retry_attempts`(若 > 0,列出其中「已不在候選」的張數寫進回報)。

## 8. 要 Sean 拍的題

### 8-0 Sean 拍板(2026-09-15,主視窗轉,逐字「甲、甲、甲」)

| 題 | 答 | 落點 |
|---|---|---|
| Q1 章怎麼辦 | **甲**:章留著,健康檢查只數還在候選的章 | §4 甲 = 本片實作範圍 |
| Q2 `settle_retry_gave_up` 事故要不要跟著變已處理 | **甲**:不動,照留 | 本片不碰事故表(驗收 12) |
| Q3 事故「標記已處理」入口 | **甲**:要做,另寫 plan —— 主視窗派設計窗 | 不在本片射程 |

⇒ 流程:本 plan 先過 adversarial-reviewer(缺 codex 那一路),主視窗核過回「可以開工」才寫碼;migration 只寫檔不貼、commit 不推。

### 8-1 原題(保留)

```
Q1:放棄章在單被處理好之後怎麼辦?
A: 甲(推薦)告警只數「還在重試範圍裡」的章;資料不刪,單之後又出狀況照樣接得回來。
A: 乙 排程每 10 分鐘把已經處理好的單的章清掉;會多一條寫資料的路、會抹掉「試過幾次」的紀錄。
```

```
Q2:「重試放棄」那筆事故紀錄,單處理好之後要不要跟著變成「已處理」?
A: 甲(推薦)不動。它是「曾經放棄過」的紀錄,信裡已寫明是累計。
A: 乙 要。那等於新增「系統自動標已處理」的規則,要另寫 plan(會牽動事故表所有種類怎麼算已處理)。
```

```
Q3:事故表所有種類都沒有「標記已處理」的入口,只要有一筆事故,告警信就會天天寄。要處理嗎?
A: 甲(推薦)另開一片:後台事故紀錄頁加「標記已處理」按鈕(員工按,留操作紀錄),再寫 plan 給你看。
A: 乙 先不動,等真的有事故再說。
```

> ⚠️ Q3 的「天天寄」是讀碼推的(事實 #8),正式庫目前有幾筆未處理事故**沒量到**(唯讀角色讀不到 `pcm_incident`)。主視窗若有權限可補量。

## 9. 估時

甲:migration(新函式 + 健康檢查一支)+ 拋棄式 PG 16 個世界 ~90 分;TS 文案兩處 + 測試 ~20 分;審查另計。Q2 乙 / Q3 甲 各自另開 plan,不在此估。

## 10. 審查意見落點

### plan R1(審 v1 `599bf2a63`,FAIL)
| 條 | 內容 | 落點 |
|---|---|---|
| **MF1** | key-contract 帳本格與「只寫檔不貼」矛盾;TS 文案不能早於 DB | **§4 甲「上線順序拆兩顆」**、§6 退回順序、§7 第 1 / 2 顆分開 |
| S1 | 人工退款 / 作廢 RPC 對候選單會 RAISE,不可達 | §2-1 兩列改寫、§7 世界 6 用 fixture 直寫 |
| S2 | 貼板 / rollback 漏 `pcm_acl_approve_latest` | §4 上線順序第 2 步、§6 |
| S3 | 正向 migration 前置閘沒寫 | §4 甲 migration 細節「前置閘」、§7 世界 16 |
| N1 | 事後閘與世界 14 補 pcm_readonly、SET ROLE 枚舉 | §4 事後閘、§7 世界 14 |
| N2 | G4 對現金單理由不成立 | §3 G4 改寫 |
| N3 | SET search_path 照寫、每鍵獨佔一行 | §4 migration 細節 |
| N4 | 文案例子「退款」幾乎不可達;事故那行「24 小時後會被拿掉」一起改 | §4 文案 |
| N5 | 世界 13 fixture 補邊界 | §7 世界 13 |

### plan R2(審 v2,PASS-with-comments)
| 條 | 內容 | 落點 |
|---|---|---|
| C1 | 前置閘沒釘排程 md5 ⇒ 別窗改候選條件會靜靜漂開 | §4 前置閘加排程一列、§7 世界 15 |
| C2 | `:1762`、`:1779`「24 小時冷卻, 反覆進出」同一種話 | §4 文案 |
| C3 | 世界 13 比對查詢可能照新函式重寫 ⇒ 自己證自己 | §7 世界 13 逐字貼排程本體 |
| nit | orders.total 字面、sample 過濾在 LIMIT 前、按名字數 0 支、世界編號、兩顆之間不推別批 | §2-1、§4、§7、§9 |
