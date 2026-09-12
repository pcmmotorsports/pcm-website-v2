# Plan:刷卡單的錢每動一次,客人都收得到信(`auth-PARTIALREFUNDCANCELGAP` 完整版)

> 2026-09-12 · 施工窗 A · 樹 `~/pcm-shop` 分支 `agent/shop-3`(= origin/dev `184841ce0`)
> Sean 2026-09-12 Q2 拍**甲 上線前做**,並推翻最小版,逐字「**那就補完整版不就好了? 何必又做一半**」(`docs/handoff/CURRENT.md:518`)。
> 最小版(告警計數 `get_partial_refund_cancel_gap_counts`,`20260909110000`)已做完、已貼;**本檔講的是客人那一側**。
> ✅ **2026-09-12 Sean 批了,答:Q1 甲(用下面那三句)· Q2 乙(匯款 / 現金一起做)· Q3 甲(那張自己人的單照寄)· 順序照推薦(本 plan 先上)。**
>   實作 = migration `20260912020000` + 碼(ports / adapters / use-cases)+ 測試;**未貼正式庫、未推**。
> 碰錢 + 寄信 + schema(view)⇒ 鐵則 8 / 12:實作後 Fable 5.1 二審。

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
| 非卡 | 只有匯款 / 現金退款的單 | ❌ 沒信 | 兩條線都只收 `tappay` ⇒ **Sean Q2 乙:這次一起做**(2026-09-12 正式庫有 1 張非卡單帶有效人工退款) |

## 3. 做法:兩條線重新分工

一句話:**④ 講「取消,以及到那一刻為止退了多少」;⑤ 講「在那之外的每一筆退款」。** 每一筆錢只被一封信講到。

**④ 取消信**
- 撈單條件:`payment_status = 'refunded'` 改成 `IN ('refunded', 'partiallyRefunded')`(補 G1)。
- 退款金額那一行本來就有(`pcm_order_card_refunded` = 到那一刻為止刷卡退回的總額;view 也已經算好 `refund_kind` full / partial)。
- 文案:全額照舊;**部分**多一句(第 6 節 Q1 ①)。今天 `refund_kind !== 'full'` 刻意什麼都不印(`sweep-email-outbox.ts` `buildOrderCancelledText` 的註解:「部分退款要不要寄 Sean 沒拍過」)⇒ 這次由 Sean 拍掉。

**⑤ 退款信**(一筆退款一封,照舊)
- 撈單條件:拿掉 `cancelled_at IS NULL`,`payment_status` 改成 `IN ('partiallyRefunded', 'refunded')`(補 G2、G3)。
- **去重規則(新)**:這筆退款**已經被 ④ 講過**就不寄。④ 印的是「到它排進佇列那一刻為止」的退款總額 ⇒ 判準:
  - 單**沒取消** ⇒ 照常寄。
  - 單**已取消**、而 `order_cancelled` 那一列**還沒排進來** ⇒ ⑤ **先等**(這一輪不排)。④ 排進來之後,它的總額就包含這一筆。
  - 單**已取消**、`order_cancelled` 已排進來 ⇒ 只有**確認時間晚於那一列排進佇列時間**的退款才寄(G3)。
  - 🔴 排信 cron 裡 **④ 要排在 ⑤ 前面**(同一輪兩邊都撈到時,④ 先落表,⑤ 就看得到它)。
  - ⛔ ~~原本只寫「有 ④ 且晚於這筆 ⇒ 不寄」~~:那樣在「同一輪裡取消 + 退款同時發生」時,⑤ 先排就會跟 ④ 重複講同一筆錢(2026-09-12 補第 3b 節時推演出來的)。
  - ⚠️ 已知盡頭:取消而 ④ 永遠不會排進來的單(卡 + 現金混合,④ 的撈單條件排除有人工退款的單)⇒ ⑤ 會一直等 ⇒ 沒有信。那一群屬於 `b4-CANCELMAILMIXEDRAIL`,跟今天一樣,不是本 plan 新造的。
- 文案分三種,在排進佇列那一刻決定(寫進 payload,一個新欄位 `order_state`):
  - `active`:照舊(「未退款的部分仍會照常出貨」)
  - `fully_refunded`:這筆退完之後已經全數退回,**不能**說照常出貨(Q1 ②)
  - `cancelled`:單已取消後又退的這一筆(Q1 ③)
- 寄出前那道閘(補 G1b):⑤ 只在「單已取消,而且這封信的 `order_state` 不是 `cancelled`」時才擋。擋下之後,單的取消會讓 ④ 排進來,④ 的時間晚於這筆退款 ⇒ ④ 會把它講到。**已全額退款不再是擋 ⑤ 的理由**(否則 G2 的信永遠寄不出去)。

## 3b. 🔴 會撞到的另一個拍板:「刷卡全額退款 ⇒ 自動標已取消」

Sean 2026-09-12 在後台 UX 改版拍了 Q1 乙:**刷卡單全額退款成功 ⇒ 自動標已取消**(memory `project_0912-admin-order-ux-redesign`,設計稿階段,**還沒實作**;下面簡稱「自動取消」)。它會改變 G2 的走向:

| 情況 | 只上本 plan | 只上自動取消 | 兩個都上 |
|---|---|---|---|
| G1 部分退 + 已取消 | ④ 接走(部分那句) | ❌ 仍沒信 | ④ 接走 |
| G1b ⑤ 排隊中被取消 | 被閘擋下,由 ④ 講總額 | ❌ 仍沒信 | 同左邊第一格 |
| G2 分批退到全額 | ⑤ 最後一筆用「已全數退回」那句 | 自動取消 ⇒ 變成「全額 + 已取消」⇒ **④ 接走**(「已取消 + 全額退回」) | ④ 接走;「已全數退回」那句**走不到** |
| G3 取消信後又退一筆 | ⑤ 接走(已取消那句) | ❌ 仍沒信 | ⑤ 接走 |
| 最後一筆讓單退到全額(同一刻被自動取消) | — | ④ 接走 | ⑤ 依去重規則等 ④,④ 的總額含這一筆 ⇒ **只一封** |

**誰先上比較安全**
- **自動取消先上、本 plan 後上**:中間那段時間 G1 / G1b / G3 仍沒信(跟今天一樣,不會更糟);G2 被 ④ 接走。本 plan 可以**少做一句**(「已全數退回」)。
- **本 plan 先上、自動取消後上**:中間那段時間四個洞都補上;自動取消上線那天起,G2 改走 ④,「已全數退回」那句與它的閘條件變成**走不到的碼**,要記得清掉。兩者交接那一刻不會重複寄(去重規則的「已取消、④ 還沒排 ⇒ ⑤ 等」擋住)。
- **一起做**:最乾淨 —— ⑤ 只剩「照常」與「已取消」兩句,寄出前的閘只看取消。代價是要等自動取消那一件做完(它碰錢,自己要 plan + 審查)。
- ⚠️ **自動取消如果不是跟退款在同一個交易裡做**(例如退款成功之後另外一步去標取消),中間會有一小段「全額退了、還沒取消」的時間 ⇒ 本 plan 的去重規則照樣接得住(那段時間算「沒取消」⇒ ⑤ 用「已全數退回」那句寄;或那一刻已取消 ⇒ 等 ④)。**所以本 plan 不需要知道自動取消怎麼實作。**
- ⇒ 第 6 節 Q3。

**非卡(匯款 / 現金)那一半 —— Sean Q2 乙新納入**
- 錢動的真來源 = `order_manual_refunds`(未作廢的列)。判準刻意**不看 `payment_status`**:非卡的狀態同步曾經漏過(`⟦b4-NONCARDPAID1⟧`)。
- ④ 取消信:非卡單只要有有效人工退款就寄;金額 = 卡退回 + 人工退款(對刷卡單那個和恆等於卡那一個數 ⇒ 主視窗 2026-09-05「信那句宣稱的是那張卡」在刷卡單上一字不變)。
- ⑤ 退款信:一筆有效人工退款一封,`refund_source = 'manual'`。
- 🔴 **非卡那封【不印】「款項將退回您原本付款的信用卡」** —— 那對現金 / 匯款是假話,而「非卡要怎麼措辭」Sean 沒拍過
  ⇒ 那一句整段不印(金額與其餘照印)。**已端 Sean**,見第 6 節 Q4。
- 🛑 卡 + 現金**混合**的取消單仍然不寄(`⟦b4-CANCELMAILMIXEDRAIL⟧` 主視窗 2026-09-05 裁「整張不寄」)⇒ 它們的退款會落在「已取消而 ④ 永遠不排」那一格。**與今天相同。**

**不變的**
- 還沒退款的取消單(已付款、已取消、錢還沒退):照今天,等錢動了才寄(④ 存在的理由是「錢動了」)。
- ⛔ ~~匯款 / 現金 / 混合:不在這次~~ ⇒ **Sean Q2 乙:匯款 / 現金這次一起做**(上面那一段);**混合**仍然不在(另一列)。
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
- 🔴 **排序訂正(2026-09-12 二審 must-fix 1):碼先上、DB 後貼。**
  ⛔ ~~DB 先貼(view 放寬),碼後上~~ —— **那個順序會出兩件事,其中一件補不回來**:
  ① 舊碼只選那八欄,照樣撈得到非卡的人工退款列 ⇒ 舊模板無條件印「款項將退回您原本付款的信用卡」⇒ **匯款 / 現金客人收到一句假話**。
  ② G2 / G3 那些列被**舊的**寄出前閘擋成終態 `skipped_order_ineligible`,而那個 code 不在 view 放行的 `last_error_code` 清單裡 ⇒ **anti-join 從此永遠擋住那一列,碼上了也補不回來**。
  ✅ 正確:**碼先上(Sean FF main、cron 跑過一輪)⇒ 再貼 migration**。中間那段時間:新碼 + 舊 view ⇒ 讀不到 `order_state` ⇒ 不排(計 `unusableAmount`)⇒ **退款信暫停、不是寄錯**;貼完之後那些退款會被重新撈到。
- ⚠️ **`order_state` 是「排信那一刻整張單的狀態」,不是「那一筆當下的狀態」**(二審 nit 6):兩筆退款積壓一起排時,第一封也會說「這筆退款後已全數退回」。今天正式庫只有 1 張自己人的單 ⇒ 接受;真客人多起來若覺得怪,再改成逐筆累計。
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

Q3:你在後台改版拍的「刷卡全額退款 ⇒ 自動標已取消」,跟這一件要怎麼排?(第 3b 節)
A:  甲 這一件先上,自動取消之後再上(推薦)
       ⇒ 上線前四個洞都補上;自動取消上線那天,把「已全數退回」那句清掉
  | 乙 等自動取消做完,兩件一起上
       ⇒ 少做一句、最乾淨;但這一件要等,上線前可能來不及
  (選乙的話,Q1 的第 ② 句就不用答)

Q4(實作時新冒出來的,要你答):非卡(匯款 / 現金)那封退款信,「錢會怎麼回到你手上」那一句要寫什麼?
    刷卡那封寫的是「款項將退回您原本付款的信用卡。」——對現金 / 匯款是假的。
A:  甲 那一句不印(現在就是這樣做的,推薦)
       ⇒ 信上只說「已退回 NT$ X」與訂單狀態;錢怎麼給是員工當面 / 匯款時已經處理過的事
  | 乙 加一句(請你直接把那句話寫給窗 A)
```

## ✅ Sean 2026-09-12 的答覆(已落地)
Q1 甲(三句照用)· Q2 **乙**(非卡一起做)· Q3 甲(那張自己人的單照寄)· 順序:本 plan 先上。
⛔ ~~Q4 是實作時才長出來的,**還沒答**~~ ⇒ ✅ **2026-09-12 Sean 答甲**:非卡那封信「錢怎麼回到你手上」那一句**整句不印** —— 與已經寫好的實作相同 ⇒ **零改動**。
守門:`sweep-email-outbox.test.ts` 那格「非卡 ⇒ 不得出現『信用卡』而金額照印」。

## 7. 驗收(做的時候)

- 拋棄式 PG(照 `scripts/20260912010000-verify.sh` 的做法):造出 G1 / G1b / G2 / G3 與今天正常的四種單,逐格斷言「④ 撈到幾張、⑤ 撈到幾筆」;每一筆刷卡退款**恰好被一封信講到**(不是零、不是兩封)。突變:拿掉去重規則 ⇒ 那一格要紅;把 `IN (...)` 改回 `=` ⇒ G1 / G2 那一格要紅。
- vitest:三種 `order_state` 的全文逐字;`order_state` 讀不懂 ⇒ 不寄、計 error;寄出前閘的四種組合(取消 × order_state)。
- 三綠 + 動到的測試檔。
- 審查:碰錢 + 寄信 + schema ⇒ 照 Sean 對 Q7 的要求「多重對抗審查」—— Fable 5.1 兩個角度(錢與寄信正確性 / 權限、view、遷移、回捲)各一輪;09-15 codex 回來後補一輪。
- 貼後:唯讀數一次各狀態撈到幾張,跟事後閘 NOTICE 對得上。
- **做完 = Sean 在正式站用自己的單走一次:部分退款 → 取消 → 收到信;再一張分批退到全額 → 收到信。**
