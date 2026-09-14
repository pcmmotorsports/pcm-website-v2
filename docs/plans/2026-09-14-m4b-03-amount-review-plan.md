# M-4b-03 · 改金額審核(員工提案 → 管理者核 / 退 → 核了才改價)· plan(只 plan 不動碼;等 Sean 批)

`PHASE-1-MILESTONES.md:664`。前置 M-4b-01 P1(b0ea16c60)已把改單價升成管理者紅線 ⇒ **今天員工完全改不了單價**, 本件把「員工提、管理者核」那條路補回來。

## 0. 白話三句(給 Sean)
- **員工**在訂單頁看到「改成」那格變成「申請改成 ___ + 原因」;送出後那張單上掛一條「待審:料號 X 12,000 → 10,000(王小明, 原因…)」, **金額一分不動**, 客人那邊看到的還是原價。
- **管理者**在同一張單上看到那條待審 + 兩顆鈕「核准」「退回」。核准 ⇒ 系統用**管理者的名字**去改價(走今天那支 `admin_update_order_item_amount`, 一字不改);退回 ⇒ 寫一句理由, 金額不動。
- 稽核兩筆:員工提了什麼(`order.item.amount.request`)、管理者核 / 退了什麼(`order.item.amount.review`);改價本身照舊那支 RPC 自己寫的第三筆(`order.item.amount.change`, actor = 管理者)。

## 1. 存哪(schema, 鐵則 8)
新表 `public.order_amount_requests`(migration `20260915050000`, 已掃已佔 stub):
| 欄 | 型別 | 說明 |
|---|---|---|
| id | uuid PK | |
| order_id / order_item_id | uuid FK | 指哪張單哪一項 |
| expected_version | integer | 提案當下的 `orders.version`(核准時帶進改價 RPC 當樂觀鎖;單子中間被改 ⇒ 改價 RPC 回 CONFLICT ⇒ 申請自動退回「單子變了, 請重提」)|
| from_unit_price / to_unit_price | integer | 提案當下單價 → 想改成(整數, 同 RPC)|
| zero_price_reason | text NULL | to = 0 時必填(同 RPC 兩道互斥規則)|
| reason | text NOT NULL | 員工為什麼要改(≤500 字)|
| status | text CHECK IN ('pending','approved','rejected','superseded') | 狀態機見 §2 |
| requested_by / requested_at | text / timestamptz | 員工 slug + 時刻 |
| reviewed_by / reviewed_at / review_note | text NULL / timestamptz NULL / text NULL | 管理者 slug + 時刻 + 退回理由(核准可空)|
| request_id | text NOT NULL | 冪等鍵(表單 hidden uuid;同鍵重送回同一筆)|
- 部分唯一索引:`(order_item_id) WHERE status = 'pending'` ⇒ **一個品項同時只有一條待審**(第二條提 ⇒ 拒「已有待審, 先請管理者處理」;不自動 supersede —— 那會讓第一個人的申請無聲消失)。
- RLS enable + zero policy;`REVOKE ALL`、service_role 只 SELECT(列表用);寫入全部走 SECDEF RPC(表 GRANT 收乾淨, 同 admin_audit_log 慣例)。

## 2. 狀態機
```
pending ──核准(管理者)──▶ approved   (同交易呼 admin_update_order_item_amount, 回非 OK ⇒ 整筆回滾, 申請留 pending 並回錯給管理者)
pending ──退回(管理者)──▶ rejected   (review_note 必填)
pending ──單子被取消 / 品項被取消──▶ superseded(核准 RPC 先查:單已取消 ⇒ 標 superseded 回錯;不用 trigger 主動掃)
approved / rejected / superseded 都是終態, 不可再變。
```

## 3. 三支 RPC(全 SECURITY DEFINER, search_path '', service_role EXECUTE, 同交易寫 audit)
1. `admin_request_order_item_amount(p_order_id, p_order_item_id, p_expected_version, p_to_unit_price, p_zero_price_reason, p_reason, p_actor, p_request_id)` ⇒ INSERT pending;`p_actor` 必須是啟用中員工(不必管理者);from_unit_price 由 RPC 讀當下 `order_items.unit_price`(不信 client);audit `order.item.amount.request`(after = {from,to,reason,request_row_id})。冪等:`request_id` 同鍵回同筆。
2. `admin_review_order_item_amount(p_request_row_id, p_decision 'approve'|'reject', p_review_note, p_actor, p_request_id)` ⇒ **L3 管理者閘**(同 B 窗 P2 那 6 行 `'無權執行此操作'`);`FOR UPDATE` 鎖那一列, 非 pending ⇒ 拒;approve ⇒ `PERFORM public.admin_update_order_item_amount(order_id, item_id, to_unit_price, expected_version, p_actor, p_request_id, zero_price_reason)`, 回值 ≠ 'OK' ⇒ RAISE(整筆回滾, 申請留 pending, 訊息帶 CONFLICT / REJECTED 原因);reject ⇒ note 必填。audit `order.item.amount.review`(after = {decision, note, from, to, requested_by})。
3. `admin_list_order_amount_requests(p_order_id)` —— **不做**:列表用 service_role 直讀表(唯讀投影, 與 payments 同款), 少一支 RPC。

## 4. UI(訂單頁「更多」區, 不動焦點列)
- `order-more-section.tsx` 改金額那張表:**員工**(canManage ≠ yes)⇒ 「改成」格改成 `ItemAmountRequestForm`(金額 + 原因 + 0 元理由), 表頭「申請改成」;**管理者** ⇒ 照舊直接改(P1 不動)+ 同一張表上方多一塊「待審申請」列表(每條:料號 / 從 → 到 / 誰 / 原因 / 時間 + 核准 / 退回(退回要理由))。
- 兩支 server action:`requestOrderItemAmountAction`(一般員工閘 `authorizeAdminMutation`)、`reviewOrderItemAmountAction`(`authorizeManagerMutation`);結果碼走 `amount-action-state.ts` 加 `request_*` / `review_*` 兩族(裸碼登記到 result-banner 那張表)。
- 焦點列:不加格;訂單列表:不加欄(有待審 ⇒ 之後看要不要一顆小標, 另議)。
- 通知:**不做**(Sean 一天看幾次後台;要 LINE 推播另議, 不塞進本件)。
- 客人:核准之前 `orders.total` / 品項單價**一字不動** ⇒ 顧客站、信件、發票小抄全部照舊;核准後與今天管理者手改一模一樣。

## 5. Rollback
- DB:down.sql = DROP 兩支 RPC + DROP TABLE(申請紀錄會掉 —— 回滾前 `SELECT * FROM order_amount_requests` 匯出);改價本身走的是既有 RPC, 不在回滾範圍。
- App:`git revert` 那兩片;員工端退回「只有管理者能改」那一句(P1 現況)。

## 6. 分片(每片 ≤45 分、獨立三綠、獨立 commit;碰錢 ⇒ 每片 codex 一輪)
| 片 | 內容 | 驗收(yes/no)|
|---|---|---|
| A · DB | 表 + 索引 + RLS/GRANT + 兩支 RPC + down.sql | 拋棄式 PG:員工提 ⇒ pending 一筆 + audit 一筆;同品項第二條 ⇒ 拒;非管理者核 ⇒ 無權;管理者核 ⇒ 單價變 + 三筆 audit(request / review / change, change 的 actor = 管理者);單子中間改過 ⇒ 核准回 CONFLICT、申請仍 pending;退回 ⇒ rejected + note;終態再核 ⇒ 拒 |
| B · 員工提案 UI | ItemAmountRequestForm + action + 結果碼 + 列表(唯讀) | 本機:員工身分送出 ⇒ 待審列出現、金額不變;codex 一輪 |
| C · 管理者審核 UI | 核准 / 退回 + action + 結果碼 | 本機:管理者核准 ⇒ 單價變、待審消失;退回 ⇒ 理由留著;Sean 走一遍 |

## 7. 要 Sean 拍的
- Q1 待審通知:甲 不通知, 他進後台自己看(推薦;最短)| 乙 LINE 推一句「有 N 件改價待審」(要動推播線)。
- Q2 一個品項同時只准一條待審(甲, 推薦)| 乙 允許多條、核其中一條其餘自動作廢。
