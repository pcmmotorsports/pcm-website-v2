# Plan:刷卡單的錢每動一次,客人都收得到信(`auth-PARTIALREFUNDCANCELGAP` 完整版)

> 2026-09-12 · 施工窗 A · 樹 `~/pcm-shop` 分支 `agent/shop-3`(= origin/dev `184841ce0`)
> Sean 2026-09-12 Q2 拍**甲 上線前做**,並推翻最小版,逐字「**那就補完整版不就好了? 何必又做一半**」(`docs/handoff/CURRENT.md:518`)。
> 最小版(告警計數 `get_partial_refund_cancel_gap_counts`,`20260909110000`)已做完、已貼;**本檔講的是客人那一側**。
> **本檔只是 plan。** 碰錢 + 寄信 + schema(view)⇒ 鐵則 8 / 12:等 Sean 批,實作後多角度審查。

## 0. 白話

- **今天**:刷卡單的退款信只有兩條線,中間有洞。有些單的錢退了,客人卻一封信都沒收到。
- **改完**:刷卡單只要錢動了(退了一部分、退到全額、取消後退款),客人一定收到一封說清楚的信,而且不會收到兩封重複講同一筆錢。
- **錯了會怎樣**:最壞是客人多收一封,或某一封還是沒寄(跟今天一樣)。**不會動到錢**,只改「要不要寄、寄什麼字」。
- **要 Sean 做的**:批這份 plan,加上第 6 節兩題(3 句新文案、匯款 / 現金退款要不要一起做)。

## 1. 現況(已量,附出處)

兩條刷卡退款信的撈單條件:

| 線 | 撈單條件 | 出處 |
|---|---|---|
| ④ 取消信 `order_cancelled` | 刷卡 · `payment_status = 'refunded'`(**全額**)· **已取消** · 沒有人工退款 · 一張單寄一封 | `supabase/migrations/20260907230000_m4b_pending_views_allow_recipient_stale.sql:437-470` |
| ⑤ 部分退款信 `order_partially_refunded` | 刷卡 · `payment_status = 'partiallyRefunded'` · **沒取消** · 每一筆 `order_refunds`(confirmed)寄一封 | `supabase/migrations/20260908080000_m4b_partial_refund_email_pending_view.sql:115-150` |

另外兩道相關的閘:
- 退款只改 `payment_status`,**不會順便取消訂單**。退到全額 ⇒ `'refunded'`,`cancelled_at` 仍是空的(`20260905010000_m4b_manual_refund_syncs_payment_status.sql:309-313`)。
- 寄出前的「這張單還能不能寄」閘:只要單已取消**或**已全額退款,⑤ 就不寄(`packages/ports/src/IEmailOutbox.ts` 的 `SUPPRESS_WHEN_ORDER_INELIGIBLE` 那一格是 `true`;判準 `packages/adapters/src/email/SupabaseIneligibleOrderEmailScannerAdapter.ts:54` = `payment_status.eq.refunded,cancelled_at.not.is.null`)。

正式庫唯讀實量(2026-09-12,`pcm_readonly`,當作分母;**真客人的單 0 張**,這些都是自己人的單):

```
payment_method  payment_status  已取消  張數
tappay          refunded        否      1   ← 洞 G2 的實例:全額退了、沒取消,寄信紀錄裡沒有退款信
tappay          refunded        是      1   ← ④ 有寄(email_outbox order_cancelled sent 1)
(空)            refunded        否      1
(空)            unpaid          否/是   1 / 5
order_refunds confirmed = 2 · email_outbox order_partially_refunded = 0 列
```

## 2. 洞在哪(刷卡單)

| # | 狀態 | 今天 | 說明 |
|---|---|---|---|
| G1 | 部分退款 + **已取消** | ❌ 沒信 | 本列原本那一格。④ 要全額、⑤ 要沒取消,兩邊都撈不到 |
| G1b | ⑤ 已排隊,寄出前單被取消 | ❌ 沒信 | 寄出前那道閘擋掉 ⑤;單又落在 G1 ⇒ 什麼都沒有 |
| G2 | 分批退到**全額**,**沒取消** | ❌ 最後那一筆沒信 | 退到全額那一刻變 `refunded` ⇒ ⑤ 撈不到(要 partiallyRefunded)、④ 撈不到(要取消)。**正式庫已有 1 張** |
| G3 | 取消信寄了之後,又退了一筆 | ❌ 沒信 | ④ 一張單只寄一封;⑤ 排除已取消的單 |
| — | 卡 + 現金混合退款的取消單 | ❌ 沒信 | **另一列** `b4-CANCELMAILMIXEDRAIL`,板上註明不要合併 ⇒ 不在本 plan |
| — | 只有匯款 / 現金退款的單 | ❌ 沒信 | 兩條線都只收 `tappay`。板上**沒有**專門的一列 ⇒ 第 6 節 Q2 |

## 3. 做法:兩條線重新分工

一句話:**④ 講「取消,以及到那一刻為止退了多少」;⑤ 講「在那之外的每一筆退款」。** 每一筆錢只被一封信講到。

**④ 取消信**
- 撈單條件:`payment_status = 'refunded'` 改成 `IN ('refunded', 'partiallyRefunded')`(補 G1)。
- 退款金額那一行本來就有(`pcm_order_card_refunded` = 到那一刻為止刷卡退回的總額;view 也已經算好 `refund_kind` full / partial)。
- 文案:全額照舊;**部分**多一句(第 6 節 Q1 ①)。今天 `refund_kind !== 'full'` 刻意什麼都不印(`sweep-email-outbox.ts` `buildOrderCancelledText` 的註解:「部分退款要不要寄 Sean 沒拍過」)⇒ 這次由 Sean 拍掉。

**⑤ 退款信**(一筆退款一封,照舊)
- 撈單條件:拿掉 `cancelled_at IS NULL`,`payment_status` 改成 `IN ('partiallyRefunded', 'refunded')`(補 G2、G3)。
- **去重規則(新)**:這筆退款**已經被 ④ 講過**就不寄。判準:這張單有 `order_cancelled` 那一列,而且它排進佇列的時間**晚於**這筆退款確認的時間(④ 印的是「到那一刻為止」的總額,所以一定包含這一筆)。
- 文案分三種,在排進佇列那一刻決定(寫進 payload,一個新欄位 `order_state`):
  - `active`:照舊(「未退款的部分仍會照常出貨」)
  - `fully_refunded`:這筆退完之後已經全數退回,**不能**說照常出貨(Q1 ②)
  - `cancelled`:單已取消後又退的這一筆(Q1 ③)
- 寄出前那道閘(補 G1b):⑤ 只在「單已取消,而且這封信的 `order_state` 不是 `cancelled`」時才擋。擋下之後,單的取消會讓 ④ 排進來,④ 的時間晚於這筆退款 ⇒ ④ 會把它講到。**已全額退款不再是擋 ⑤ 的理由**(否則 G2 的信永遠寄不出去)。

**不變的**
- 還沒退款的取消單(已付款、已取消、錢還沒退):照今天,等錢動了才寄(④ 存在的理由是「錢動了」)。
- 匯款 / 現金 / 混合:不在這次(見第 2 節最後兩列)。
- 未付款取消 ③:不相關,不動。

## 4. 要改的東西

| 層 | 檔 | 改什麼 |
|---|---|---|
| DB(migration 一支) | `pcm_cancelled_email_pending` | `payment_status` 條件放寬到 `IN (...)`。`CREATE OR REPLACE VIEW`,欄位不變;`WITH (security_invoker = true)` 照寫 |
| DB(同一支) | `pcm_partial_refund_email_pending` | 拿掉 `cancelled_at IS NULL`、放寬 `payment_status`、加去重規則、**在最後面**加一欄 `order_state`(view 的 REPLACE 只能往後加欄)。`WITH (security_invoker = false, security_barrier = true)` 照寫;權限 / owner 不動 |
| DB(同一支) | 事後閘 | 兩張 view 的 `pg_get_viewdef` 含新條件、reloptions 沒被改掉、ACL 沒變;對正式資料數一次各狀態會撈到幾張(記在 NOTICE) |
| 排信 | `packages/adapters/src/email/order-email-assembly.ts` | ⑤ 的 payload 多一個 `order_state`(bump `event_version`,照該檔的防線規矩登記) |
| 寄信 | `packages/use-cases/src/sweep-email-outbox.ts` | `buildOrderCancelledText`:部分退款那句;`buildOrderPartiallyRefundedText`:依 `order_state` 選三種句子;**讀不懂 `order_state` ⇒ 當 `active`?還是 fail-closed?** ⇒ 實作時用 fail-closed(計 error 重試),不猜 |
| 寄出前的閘 | `SupabaseIneligibleOrderEmailScannerAdapter.ts` + `IEmailOutbox.ts` 的 `SUPPRESS_WHEN_ORDER_INELIGIBLE` | ⑤ 從「取消或全額退款就擋」改成「取消而且 `order_state` 不是 `cancelled` 才擋」。那張表今天是「每種信一個布林」,⑤ 要變成條件式 ⇒ 兩條查詢路(`listDueIneligible` / `listIneligibleAmong`)都要改(`packages/ports/src/IIneligibleOrderEmailScanner.ts:28` 的警告:少改一條就等於沒修) |
| 測試 | 拋棄式 PG + vitest | 見第 7 節 |

HTML 版型不用另外做:④⑤ 已經走今天剛上的共用外框(`customer-email-html.ts`),新句子進 body 就自動有排版。

## 5. 影響與 rollback

- **影響**:只有刷卡單的退款 / 取消通知信。不動錢、不動退款流程、不動後台畫面。
- **上線那一刻會補寄**:正式庫那 1 張 G2 的單(自己人的)會在上線後被 ⑤ 撈到,寄一封「已全數退回」。**要先決定那張要不要寄**,不寄就先在 `email_outbox` 塞一列 skipped(那是正式庫寫入 ⇒ 要 Sean 授權),或接受它寄出(收件人是自己人)。
- **排序**:DB 先貼(view 放寬),碼後上。反過來:碼先上而 view 沒放寬 ⇒ 什麼都不會多寄,只是新句子用不到;DB 先上而碼沒上 ⇒ ⑤ 的 payload 沒有 `order_state` ⇒ 讀不懂 ⇒ fail-closed 不寄(計 error)⇒ **所以 DB 與碼要同一天、DB 先**。
- **rollback**:
  - 碼:`git revert` 那一顆(或兩顆)。
  - DB:rollback 檔用 `CREATE OR REPLACE VIEW` 貼回舊定義(逐字抄自上面兩個出處);`order_state` 那一欄是往後加的,REPLACE 回舊定義時要先 `DROP VIEW` 再 `CREATE`(REPLACE 不能刪欄)⇒ rollback 檔要照原 migration 重下權限。實作時用拋棄式 PG 演練一次 rollback。

## 6. 要 Sean 答的

```
Q1:三句新文案(每一句都是「這種情況下,信裡要說什麼」)
  ① 取消了、只退了一部分(④):
     「您支付的款項已退回 NT$ X 至原付款方式。其餘款項如有疑問,請加入官方 LINE 與我們聯繫。」
  ② 分批退到全額、訂單沒取消(⑤):
     「這筆退款後,這張訂單的款項已全數退回原付款方式。」
  ③ 訂單已取消之後又退回一筆(⑤):
     「您已取消的訂單 X 又退回一筆款項。」
A:  甲 用這三句(推薦)
  | 乙 Sean 改字(直接改上面那三句回傳給窗 A)

Q2:只有匯款 / 現金退款的單(不刷卡),今天也一封退款信都沒有。這次要一起做嗎?
A:  甲 這次只做刷卡,匯款 / 現金另開一列(推薦)
       ⇒ 那一群的退款是員工手動登記的另一張表,要另外設計;
          而「卡 + 現金混合」那一列已經有自己的決定(整張不寄),一起做會撞在一起
  | 乙 一起做
       ⇒ 範圍大約多一倍,上線前時間會更緊
```

## 7. 驗收(做的時候)

- 拋棄式 PG(照 `scripts/20260912010000-verify.sh` 的做法):造出 G1 / G1b / G2 / G3 與今天正常的四種單,逐格斷言「④ 撈到幾張、⑤ 撈到幾筆」;每一筆刷卡退款**恰好被一封信講到**(不是零、不是兩封)。突變:拿掉去重規則 ⇒ 那一格要紅;把 `IN (...)` 改回 `=` ⇒ G1 / G2 那一格要紅。
- vitest:三種 `order_state` 的全文逐字;`order_state` 讀不懂 ⇒ 不寄、計 error;寄出前閘的四種組合(取消 × order_state)。
- 三綠 + 動到的測試檔。
- 審查:碰錢 + 寄信 + schema ⇒ 照 Sean 對 Q7 的要求「多重對抗審查」—— Fable 5.1 兩個角度(錢與寄信正確性 / 權限、view、遷移、回捲)各一輪;09-15 codex 回來後補一輪。
- 貼後:唯讀數一次各狀態撈到幾張,跟事後閘 NOTICE 對得上。
- **做完 = Sean 在正式站用自己的單走一次:部分退款 → 取消 → 收到信;再一張分批退到全額 → 收到信。**
