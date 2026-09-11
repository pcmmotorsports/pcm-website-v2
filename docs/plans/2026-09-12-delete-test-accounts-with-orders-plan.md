# plan · 刪測試帳號「連訂單一起刪」那 3 個 · 2026-09-12 · 窗 B

> 來源:主視窗轉 Sean 答 `docs/runbooks/2026-09-12-delete-test-accounts.md` §4:Q1「乙 = 連訂單一起刪」、Q2「甲 = 全刪」,
> 並親口確認 #3「公司帳號 partscheaper 要不要刪 刪掉啦」。
> 🛑 **只寫 plan,一發 DELETE 都沒跑。** 讀數全部 2026-09-11 下午正式庫唯讀(`scripts/readonly-prod-sql.sh`)。
> 鐵則 8(大量刪除 / 可能動 trigger)+ 鐵則 12(碰訂單)⇒ 等 Sean 批。

---

## 0. 白話(先看這段)

- 3 個帳號底下共 **5 張單**,**一毛錢都沒動過**(付款 0、退款 0、人工退款 0)。
- 🔴 **卡住的不是錢,是「箱子」**:#4、#5 各有 1 個出貨箱。系統有一條 8 月定下的規則 ——
  **「箱子永不硬刪,要撤就作廢;箱號永不重用」**(`20260805170000:172-178`:Q3=A 軟刪除 + MP §8.5;
  箱內容不可改是你 08-05 拍的 Q-a=C),資料庫用 3 道擋板守著它,刪箱子會直接被拒。
- ⇒ #3 可以照你說的整個刪掉;#4、#5 要整個刪,就得**先把那 3 道擋板暫時拆掉**。
- 新竹那一側不受影響:那張測試託運單(貨號 894-708-1964)依新竹規格 **30 天沒收件自動作廢**。
- 刪了回不去 ⇒ 刪之前先把這幾張單整包匯出一份。

---

## 1. 3 個帳號 × 5 張單

| 帳號 | 訂單 | 付款狀態 / 金額 | 已取消 | 箱子 |
|---|---|---|---|---|
| #3 in***@partscheaper.net(`3bac8bc3`) | `9FPJM2`(`b7741c78-…`) | unpaid / 4,900 | 否 | 無 |
| #4 g3-sandbox-test(`8d402365`) | `CH6D75`(`e3af8388-…`) | unpaid / 1 | 否 | **`S9FC6P`**(新竹,`submitted`,貨號 8947081964,未出貨) |
| | `MCGHHM`(`8e664f0b-…`) | unpaid / 1,050 | 是 | 無 |
| | `P7KZ55`(`3a4c75e3-…`) | unpaid / 1,000 | 是 | 無 |
| #5 ma***@manual…(`2cd553a0`) | `W9486K`(`d53eed7c-…`) | unpaid / 100 | 是 | **`ZNDXJP`**(其他貨運,已出貨、**已作廢**) |

## 2. 每張單連到哪些表(外鍵原文取自 `pg_constraint`;數字 = 這 5 張單 / 2 個箱子合計)

```
錢    order_payments 0 · order_refunds 0 · order_manual_refunds 0 · order_pending_refunds 0 · order_refund_jobs 0
      payment_charge_attempts 0 · payment_double_charge_anomalies 0 · pending_invoices 0 · pcm_settle_retry_attempts 0
      coupon_redemptions 0 · customer_wallet_ledger(related_order)0
品項  order_items 5(CASCADE)· order_item_quantity_summary 4(CASCADE)· order_legal_consents 1(CASCADE)
      order_item_procurement 2(RESTRICT;CH6D75、W9486K 各 1)
取消  order_cancellations 3 · order_cancellation_items 3(RESTRICT;MCGHHM / P7KZ55 / W9486K)
信    email_outbox 1(RESTRICT;9FPJM2 的 bank_order_created,已寄出)
箱子  shipments 2 · shipment_items 2(RESTRICT → order_items)· pcm_b2_shipping_idempotency 6
備註  order_notes 0
```

**刪除時會叫的 trigger(`pg_trigger` 查)**
```
會【擋】  shipments_block_delete_bd            「包裹永不硬刪 —— 要撤銷請走作廢, 否則包裹編號的『永不重用』保證會破」
          shipment_items_block_delete_bd        「包裹內容 append-only」(Sean 2026-08-05 Q-a=C)
          pcm_b2_shipping_idem_block_delete     tgenabled = 'A' ⇒ 連 replica 模式都擋
會【留痕】 orders / order_items / order_legal_consents 的 *_delete_audit_ad ⇒ 寫進 orders_deleted_log
不擋      pcm_e13_subtotal_guard(單已刪就直接 return)· 取消明細的 presence / summary recompute(照順序刪就不會叫)
不留痕    email_outbox · order_cancellations · order_item_procurement · shipments(假設拆了擋板)
```

## 3. 做法

### 甲 · #3 整個刪;#4、#5 的**單與箱子保留**,只刪登入帳號以外能刪的 ✅ 推薦

⚠️ 更正一句我會被問的:#4、#5 **連帳號都刪不掉** —— 箱子的 `customer_user_id` 外鍵是 RESTRICT,箱子在,客戶資料就刪不掉。
⇒ 甲 = **13 個刪 11 個**(10 個 runbook 那批 + #3),#4、#5 留著,在後台看得到 4 張測試單、2 個箱子。

#3 的刪法(一個交易,**用 DELETE 不用 TRUNCATE** —— `apply-paste-board.md` §0-b①):
```sql
BEGIN;
-- 前置閘:單還在、名下零付款零退款零箱子、outbox 恰 1 列(數字不符 ⇒ RAISE, 停)
DELETE FROM public.email_outbox WHERE order_id = 'b7741c78-be06-45a6-a71a-835bb6db3910';   -- 1 列, 不留痕
DELETE FROM public.orders       WHERE id       = 'b7741c78-be06-45a6-a71a-835bb6db3910';   -- CASCADE 帶走品項 / 同意書 / 數量摘要;留痕進 orders_deleted_log
-- 事後斷言:orders_deleted_log 有這張單的列、單不在、客戶名下 0 張單
COMMIT;
```
之後照 `docs/runbooks/2026-09-12-delete-test-accounts.md` §3 在 Dashboard 刪登入帳號(連帶 1 筆地址)。
🔴 **這段 SQL 還沒在拋棄式 PG 跑過**(沒有種這張單)⇒ 批了之後我先在拋棄式 PG 照原樣種一張跑一次,再給貼。

### 乙 · 13 個全刪:暫時拆掉 3 道擋板

```
一個交易內:ALTER TABLE shipments / shipment_items / pcm_b2_shipping_idempotency DISABLE TRIGGER <那 3 道>
⇒ 依序刪:shipment_items → pcm_b2_shipping_idempotency → shipments → order_item_procurement
          → order_cancellation_items → order_cancellations → email_outbox → orders(CASCADE)
⇒ ENABLE 那 3 道 ⇒ 斷言「3 道都回到啟用」, 否則整筆 RAISE
```
代價:
- 🔴 **「箱號永不重用」對 `S9FC6P`、`ZNDXJP` 失效** —— 唯一性是靠那兩列還在守的,刪了之後理論上可能再發出同一個號碼
  (機率很小:箱號 6 碼、29 個字元可選,`20260805170000:99`),而 `S9FC6P` 在新竹那邊掛到約 10-10(30 天)
- 🔴 `ALTER TABLE … DISABLE TRIGGER` 是 DDL,會鎖這三張表;在正式庫上跑要**另外授權**,而且要 Fable 審
- 箱子那三張表**不留任何刪除紀錄**

### 共同:刪之前先匯出(這就是 rollback —— 刪了沒有別的回法)

窗 B 用唯讀帳號把這 5 張單 + 2 個箱子 + 所有關聯列 `row_to_json` 匯出成一份 JSON,
🛑 **存在 `~/pcm-mailbox/`,不進版控**(裡面有客戶姓名電話地址)。要還原得手寫 INSERT,**而擋板與 trigger 會讓還原本身變難** —— 照實寫:這份匯出是「知道刪了什麼」,不是「一鍵回去」。

---

## 4. 我證不到的

1. 乙 的刪除順序是照外鍵推的,**沒有在拋棄式 PG 跑過**;甲 那段也還沒跑(見上)。
2. 司機這 30 天內來取件會不會再問「不是有兩件嗎」—— `docs/evidence/2026-09-10-那張測試單要不要取消.md` 寫過:規格沒寫、沒問過。
3. `S9FC6P` 刪掉之後,新竹若回傳這張單的狀態(若有回呼),我們這邊會找不到它 —— 今天沒有接新竹回呼,**推的**。

---

## 5. 給 Sean 的題

```
Q:有出貨箱的那 2 個測試帳號(g3-sandbox-test、後台手動建的那個)要怎麼辦?
    系統規則是「箱子永不刪、箱號永不重用」(8 月定的;箱內容不可改是你 08-05 拍的),它們各有 1 個箱子。
A:  甲 這 2 個先留著,其他 11 個照刪(推薦)
       ⇒ 後台會看到 4 張測試單、2 個箱子;不用動任何保護機制
  | 乙 13 個全刪:暫時關掉那 3 道保護、刪完再打開
       ⇒ 乾淨;但那 2 個箱號以後理論上可能被重發,而且要你另外授權一次改資料庫結構
```
