# 2026-09-15 · 逾期自動取消也寄取消信 + 留操作紀錄 —— plan

> 施工窗(pcm-admin-ui)。主視窗派工:Sean 還沒答「逾期自動取消要不要寄信、留痕」,先把 plan 備好,他說要就能開工。
> **本檔只是 plan,零碼改動。** 碰 view / RPC / cron 函式(schema)+ 寄信 ⇒ 鐵則 8 + 12,等批。

## 0. 🛑 先講清楚:這不是一題「還沒答」,是要不要【推翻】09-03 的乙

- 正式庫裡已經寫著 Sean 09-03 拍過「逾時自動取消【不寄】」:
  `supabase/migrations/20260903040000_m4b_outbox_order_unpaid_cancelled_event.sql:100-102`(`email_outbox.event_type` 的 COMMENT)逐字
  「order_unpaid_cancelled 的射程(Sean 2026-09-03 拍乙):只涵蓋【員工在後台按下取消】的未付款單。`expire_unpaid_orders` … 【不涵蓋】—— Sean 逐字『不寄, 只有員工按下取消才寄』。」
- 同一句也在 `packages/ports/src/IUnpaidCancelledOrderScanner.ts:19-30`;那裡把舊的「= Sean【未拍板】(題 2)」**劃掉**了,理由是「把已落檔的拍板記成待決 = 把決定重新打開」。
- 派工說的「題 2 Sean 未拍板」那一行:**不在 `20260916030000` 檔頭**(檔頭只有「逾時不算員工取消」);全 repo 只剩一處還寫「Sean 未拍板」:`apps/storefront/src/app/api/cron/email-sweep/route.ts:590` —— 那是**沒跟著改的舊註解**。
- 09-02 那題(`~/pcm-mailbox/題目-取消信要不要寄-20260902.md`)Sean 答甲,問的是「員工取消的未付款單要不要寄」,不是逾時。
- ⇒ **問 Sean 的題要寫成「推翻 09-03 乙嗎」**,並把當時的理由放在旁邊:一輪上限 500 張、收件人是「下單沒付錢、可能早就忘了」的人、信寄出去收不回。

## 1. 白話

- 客人選匯款 / 現金下單,5 天內(第 5 天整天都算)沒付,系統隔天 00:00 自動把單取消。刷卡沒付完的單 1 天後取消。
- 今天這種自動取消:**不寄信、後台操作紀錄也沒有一筆**。客人只在會員中心看得到「已逾期」。
- 員工在後台手動取消未付款單:**會寄**「您的訂單 X 已取消」,也有操作紀錄。
- 匯款單成立時,客人已經被告知「請於 X 月 X 日(含)之前完成匯款,逾期訂單將自動取消。」(`packages/domain/src/order/remittance-info.ts:127`)。
- **今天的量(正式庫唯讀,2026-09-15 23:2x 台北)**:有史以來自動逾期取消 **1 張**(09-12,匯款,有信箱);還開著的未付款單 **1 張**(匯款)。

## 2. 現況怎麼跑(每一格都有出處)

### 2a. 自動逾期取消 `pcm_cron.expire_unpaid_orders`
- 現行一代:`20260906600000_m4b_expire_day_boundary.sql`(`scripts/latest-definition-of.sh expire_unpaid_orders` ⇒ newest = live = 20260906600000;live 指帳本,不是正式庫實查)。
- 排程每小時整點(`20260809170000:77` `'0 * * * *'`),一輪 `LIMIT 500`。
- 挑單條件:`payment_status='unpaid'`、`cancelled_at IS NULL`、`payment_channel IN ('tappay','bank_transfer','cash')`、到期(tappay 建單 1 天;匯款 / 現金 = 台北日界 +5 天 +1 天 00:00)、沒有非 failed 的刷卡嘗試、已收淨額 ≤ 0。
- **只寫 `orders` 三欄**:`cancelled_at = now()`、`cancelled_reason = 'payment_expired'`、`updated_at = now()`。
  - 不寫 `order_cancellations`、不寫 `admin_audit_log`、不寫 `email_outbox`。
  - 另外寫 `RAISE LOG` 筆數 + 成功心跳(心跳失敗包在 EXCEPTION 裡,不影響取消)。
- `payment_expired` 是機器碼,員工取消理由打不進去(`20260903093000` 保留字閘)。

### 2b. 取消信的掃描面 `pcm_unpaid_cancelled_email_pending`
- 現行一代:`20260916030000_m4b_unpaid_cancel_email_staff_full_cancel_audit_evidence.sql`。
- 身分判準 = **有員工整單取消的稽核列**:`admin_audit_log.action='order.cancel'`、`target='order:<id>'`、`after->>'closed'='true'`(只有 `admin_cancel_order` 在同交易寫,筆數守恰 1)。
- 為什麼要這麼窄:舊判準「曾有 `order_cancellations`」會把「員工先部分取消、之後整張被系統取消」當成員工取消 ⇒ 誤寄(codex R1 MF1 → `20260915210000`;R2 MF1 → `20260916030000`)。
- 第二道網:`cancelled_reason IS DISTINCT FROM 'payment_expired'`(`20260915210000` 加的)。
- 其他條件:outbox 還沒有這封(skip 碼清單除外)、至少一個信箱、手動建單沒填通知信箱不寄。
- 告警 RPC `get_order_unpaid_cancelled_gap_counts` 用**同一套述詞**(兩端口徑一致是承重的)。

### 2c. 排信與寄信(TS)
- 掃描:`packages/adapters/src/email/SupabaseUnpaidCancelledOrderScannerAdapter.ts:182` `.gte('cancelled_at', cutoff)`,cutoff = env `B4_DEPLOY_CUTOFF`(沒設 ⇒ 整段不跑,也不認領)。
- 一輪最多掃 50(`route.ts:177` `ENQUEUE_LIMIT`);一輪「新信」超過 20 封整批 throw 不排(`packages/use-cases/src/enqueue-batch-cap.ts:52`)。
- 去重鍵 = orderId(`SupabaseEmailOutboxAdapter.ts` `case 'order_unpaid_cancelled'`)⇒ 一張單一輩子最多一封。
- 主旨 `PCM 訂單 X 已取消`(`order-email-assembly.ts:344`)。
- 內文(`sweep-email-outbox.ts:1177` `buildOrderUnpaidCancelledText`):
  「您的訂單 X 已取消。」+〔取消理由,只印白名單五句〕+「這張訂單尚未付款，不會有任何款項產生。」+ 會員中心 / LINE / 公司段。
  - `payment_expired` **不在白名單**(`order-email-copy.ts:382-388`)⇒ 今天就算排進去,理由那行也不會印。
- 🔴 **寄送前不重查這張單還是不是取消狀態**:`SUPPRESS_WHEN_ORDER_INELIGIBLE.order_unpaid_cancelled = false`(`packages/ports/src/IEmailOutbox.ts:119`,理由「取消本身就是內容」)。

### 2d. 逾期單可以「補登記收款後復活」(Sean 09-15 Q1 乙)
- `20260915234000:400`:期限內匯款、客人沒另下新單 ⇒ `cancelled_at = NULL, cancelled_reason = NULL`,寫稽核 `order.revive_expired`。
- ⇒ **員工取消的單不會復活**(P2B52 擋),所以 2c 那個「寄前不重查」對員工取消無害;**對逾期取消就有害**(見 §5)。

## 3. 怎麼讓逾期取消也進取消信佇列 —— 三條路

| # | 做法 | 好處 | 壞處 |
|---|---|---|---|
| **甲(推薦)** | **view 多認一種身分**:`cancelled_reason = 'payment_expired'` 且 `payment_channel IN ('bank_transfer','cash')` 且 `cancelled_at >= 起算時刻`。原本「員工整單取消稽核列」那一支不動,兩支用 OR。 | 不動每小時跑的 cron 函式;`payment_expired` 員工打不進去,拿它當身分安全;復活會清掉 reason ⇒ 復活的單自動離開掃描面 | 身分又回到讀理由欄 —— 但只讀這一個保留碼 |
| 乙 | 逾期函式多寫一筆稽核列(例 `order.expire_unpaid`),view 認這個 action | 同時解決「留痕」;身分判準仍是稽核列 | 要改 cron 熱路徑(一輪 500 張);稽核表的 actor 欄要能放「系統」(開工前查限制);寄信與留痕綁死,拆不開 |
| 丙 | 逾期函式寫一列 `order_cancellations` | —— | ❌ 不做。那張表是員工取消帳本(append-only、冪等 token、payload_hash、D5 帳本核對面板都讀它),塞機器列會壞掉部分取消與結果面板的不變式 |

**推薦:寄信走甲;留痕另外問(Q2),要的話用「乙的寫法、但 view 不認它」**:
- 逾期函式的 `UPDATE` 改成 CTE,`INSERT INTO admin_audit_log … SELECT FROM updated RETURNING` 同一句寫完(不是迴圈)。
- 兩件事拆開:信壞了不影響留痕,留痕壞了不影響信。

## 4. 起算時刻(避免一上線就補寄舊單)

- 現有 cutoff `B4_DEPLOY_CUTOFF` 是**早就過去的時間** ⇒ 只靠它,09-12 那張逾期單會在上線那一輪收到一封晚了好幾天的「已取消」。
- **做法**:view 的逾期那一支自己帶一個**寫死的起算時刻**(`cancelled_at >= '<貼板當下,例 2026-09-16 12:00+08>'::timestamptz`),貼之前填。不另開 env(多一顆 env = 多一個忘了設的安靜失敗)。
- 前置閘在同一個交易裡數「套上新 view 當下會進佇列的逾期單」,**> 0 就 RAISE 停下**(起算時刻寫錯年份的那一種)。
- 第二道網仍在:一輪新信 > 20 封整批不排(§2c)。
- ⚠️ 那道 20 封的網在「真的一小時逾期 > 20 張」時會**每輪 throw、永遠排不進去**。今天量級(有史以來 1 張)碰不到;碰到那天要回來改成分批。

## 5. 復活競態(甲、乙都要處理)

- 情境:09-11 00:00 自動取消 ⇒ 00:05 信排進佇列 ⇒ 00:07 員工補登記收款、單復活 ⇒ 00:10 認領寄出「已取消」給一張活著的單。
- 今天 `order_unpaid_cancelled` 寄前不重查(§2c)。
- **做法**:把這一封的寄前規則從 `false` 改成「**單已經不是取消狀態 ⇒ 不寄**」。
  - 新增一個 `IneligibleSuppressRule` 值(例 `'not_cancelled'`),`IIneligibleOrderEmailScanner` 對它查 `cancelled_at IS NULL`。
  - 員工取消的單不會復活 ⇒ 對它們零行為差異。
- 寄出**之後**才復活:收不回來 ⇒ 文案要先埋一句(§6 第三句)。

## 6. 文案(共用同一個模板,多一句理由)

- **共用** `order_unpaid_cancelled` 這個事件 + 主旨 + 模板。
  - 不另開事件型別:要一支新的 CHECK migration + 新去重鍵,而內容只差一句。
  - 去重鍵是 orderId ⇒ 「逾期 → 復活 → 又逾期」第二次不會再寄(可接受,寫明)。
- 在 `customerFacingCancelReason` 對 `payment_expired` 這個**機器碼**特判出一句固定字(不進白名單那張「DB 對客中文」表,它不是 DB 文字)。
- **草稿(待 Sean 定稿)**:
  ```
  您的訂單 PCM-2026-XXXX 已取消。

  這張訂單超過付款期限，系統已自動取消。

  這張訂單尚未付款，不會有任何款項產生。
  如果您在期限內已經完成匯款，請直接聯繫我們，我們會協助處理。
  ```
  - 第二句說出「過期未付款自動取消」,對上客人收過的「逾期訂單將自動取消」。
  - 第四句是給「錢其實有匯、只是晚登記」那種人的(§5 寄出後才復活)。
  - 刷卡(tappay)若也要寄(Q4 乙),第四句要改寫,因為刷卡沒有「匯款」。

## 7. 要改的東西(做的時候)

| 層 | 改什麼 | 備註 |
|---|---|---|
| migration A(版本號待配) | `pcm_unpaid_cancelled_email_pending` + `get_order_unpaid_cancelled_gap_counts`:身分改成「員工整單取消稽核列 **OR** 逾期那一支(§3 甲 + §4 起算)」;拿掉 `cancelled_reason IS DISTINCT FROM 'payment_expired'` 那道網(改成只在員工那一支) | 逐字照 `20260916030000` 抄,只換身分那三處;前置閘收兩個指紋(改前 view `bc74e696b28afbb91bd7078545e9b0a5` / fn `1a4042834023367339e5cb656b5a3238`,取自 `20260916030000` 檔頭的「本檔目標」,開工當天對正式庫重量)+ 本檔目標;ACL 改前改後比;§4 的「會立刻進佇列 > 0 就停」 |
| migration A 同檔 | `email_outbox.event_type` 的 COMMENT 重寫:09-03 乙那三行改成新拍板(舊字留「⛔ 已由 <日期> Sean 推翻」) | 正式庫讀 `\d+` 的人只看得到這段 |
| migration B(Q2 甲才做,版本號待配) | `expire_unpaid_orders` 的 UPDATE 改 CTE,同一句寫 `admin_audit_log` | 逐字照 `20260906600000` 抄;開工前查 `admin_audit_log` 的 actor / request_id 欄限制;心跳那段不動 |
| TS | `customerFacingCancelReason` 特判 `payment_expired` + 新句子常數 | `packages/use-cases/src/order-email-copy.ts` |
| TS | `SUPPRESS_WHEN_ORDER_INELIGIBLE.order_unpaid_cancelled` 改新規則 + scanner 支援 | `packages/ports/src/IEmailOutbox.ts:119`、`IIneligibleOrderEmailScanner` |
| TS 註解 | `IUnpaidCancelledOrderScanner.ts:10-30`、`route.ts:590`、`composition.ts:295` 的射程句改成新拍板 | 不改會留下「兩份互相矛盾的真相」 |
| 測試 | 見 §9 | |

**順序**:TS 先上(新句子、寄前規則;對今天的佇列零影響)⇒ 再貼 migration A。
- 反過來(view 先貼)⇒ 逾期信照寄,但沒有理由那句、也沒有復活保護。
- 同一支 view、沒有新名字 ⇒ 部署時序閘不擋,**要靠這一條順序**。

## 8. 影響

- 客人:匯款 / 現金單逾期被自動取消 ⇒ 收到 1 封信。今天量級 0-1 封/天。
- 員工取消那條路:身分判準那一支不變 ⇒ 零行為差異(拋棄式 PG 驗)。
- 告警:`no_recipient_count` 會把「逾期、兩個信箱都空」的單算進去 ⇒ 可能第一次響(手動建單沒填信箱那種已由 manual 規則排掉;顧客站單理論上都有信箱)。
- 會員中心顯示不變(本來就標「已逾期」)。

## 9. 驗(拋棄式 PG + TS)

1. 員工整單取消 ⇒ 寄(不得退步)
2. 起算時刻之後逾期,匯款 ⇒ 寄,內文有「超過付款期限」那句
3. 起算時刻之前逾期 ⇒ 不寄
4. tappay 逾期 ⇒ 不寄(Q4 甲)
5. 部分取消 → 之後逾期 ⇒ 寄(那張單真的被系統取消了)
6. 部分取消 → 被刷卡取代(`superseded_by_card`)⇒ 不寄(不得退步)
7. 逾期 → 掃描前就復活 ⇒ 不在 view
8. 逾期 → 排進佇列 → 寄前復活 ⇒ 標終態不寄
9. 前置閘:起算時刻填成去年 ⇒ RAISE
10. 告警 RPC 與 view 對同一組資料數字一致
11. Q2 甲:一輪逾期 3 張 ⇒ 稽核 3 列、心跳照寫;稽核寫入失敗 ⇒ 整輪回滾(或依決定分開),要明寫選哪個

鐵則 12:碰寄信 + schema ⇒ 高風險審一輪(codex 額度到 09-20,期間走 adversarial-reviewer 並註明)。

## 10. 回滾

- migration A:`supabase/rollbacks/<版本>-rollback.sql` 把 view 與告警 RPC 退回 `20260916030000` 逐字定義;COMMENT 退回。
- migration B:退回 `20260906600000` 逐字定義(已寫的稽核列留著,不刪)。
- TS:revert 那顆 commit。
- ⚠️ **已經寄出去的信收不回來。**
- 緊急停線:拔掉 `B4_DEPLOY_CUTOFF` 會連排信帶認領一起停(`sweep-email-outbox.ts:591`),**但員工取消的信也一起停**。

## 11. 要 Sean 答的題

```
Q1 推翻 09-03 的「逾期自動取消不寄」嗎?
   (當時理由:客人沒付錢、可能早忘了;信寄了收不回。今天量級:有史以來 1 張)
A: 甲 寄(主視窗推薦)| 乙 維持不寄

Q2 自動取消要不要在後台操作紀錄留一筆?
A: 甲 要,跟取消寫在同一句 SQL(推薦)| 乙 不要

Q3 信裡那段話用 §6 的草稿嗎?
A: 甲 用草稿(推薦)| 乙 我改字

Q4 哪些付款方式寄?
A: 甲 只有匯款、現金(推薦:只有它們被告知「逾期將自動取消」)| 乙 刷卡沒付完的也寄

Q5 上線前已經逾期的那張(09-12)要補寄嗎?
A: 甲 不補,從貼上那一刻開始算(推薦)| 乙 補寄
```
