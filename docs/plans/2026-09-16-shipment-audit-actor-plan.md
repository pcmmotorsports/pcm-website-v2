# 出貨線補操作紀錄(要加「誰做的」這個參數)

> 2026-09-16 B 窗寫。**本檔只是計畫,一行碼都還沒動。** 等 Sean 批。
> 起因:後台全流程走查(`~/pcm-mailbox/後台全流程走查-0915.md` 問題 B)。

## 一句話

**做完之後,「這箱是誰出的」查得到;不做的話,查不到。**

## 現在是什麼情況

後台的操作紀錄表(`admin_audit_log`)是給日後查帳、查責任用的。
出貨那條線八個動作裡,**三個有留紀錄、五個沒有**:

| 動作 | 有沒有留紀錄 |
|---|---|
| 訂貨(新增採購) | ✅ 有 |
| 到貨登記 | ✅ 有 |
| 填 / 改貨運單號 | ✅ 有 |
| **建箱** | ❌ 沒有 |
| **加箱內品項** | ❌ 沒有 |
| **標出貨** | ❌ 沒有 |
| **作廢出貨** | ❌ 沒有 |
| **還原作廢** | ❌ 沒有 |

怎麼確認的(兩路各自獨立):
1. 逐支去讀資料庫函式的本體,看裡面有沒有寫那張表。
2. 2026-09-16 在本機探針站**真的走一遍**:建箱 MDYXS9 + 標出貨,
   紀錄表共 13 列、**出貨相關 0 列**。

⚠️ 有一個地方容易看錯:檔案 `apps/admin/src/lib/shipping/shipment-action-audit.ts` 名字像稽核,
**它其實只是印到伺服器 log**,不是寫進紀錄表。該檔自己逐字寫著
「本片(A1)只加閘,**一列 `admin_audit_log` 都沒有寫**;DB 層的稽核列是 A2 的事」。
⇒ **A2 一直沒做。** 另外 `shipment-actions.ts:252` 也寫著「它呼叫的五支 RPC 是唯一零 `admin_audit_log` 的一組」
⇒ 這件事**早就有人發現並寫下來,只是沒補**。本片是收尾,不是新發現。

## 為什麼不是「多寫一行」就好

原本以為每支函式多一行 INSERT 就結束。實際查下去不是:

| 事實 | 怎麼量的 |
|---|---|
| 紀錄表的 `actor`(誰做的)與 `request_id`(哪次請求)兩欄**都不准空白** | `information_schema.columns` 實查 |
| 要補的**五支函式全部收不到**「誰做的」這個資訊(沒有 `p_actor` / `p_request_id` 參數) | `pg_get_function_identity_arguments` 實查 |
| 只有已經有紀錄的那支 `admin_update_shipment_tracking` 有這兩個參數 | 同上 |
| 網站這一層其實知道是誰(員工已登入、選過操作人員),只是**沒有往下傳** | `apps/admin/src/lib/shipping/shipment-repository.ts:105-175` |

⇒ **沒有「誰做的」,這張紀錄就答不出它唯一要答的問題。**

## 要動哪三處

### ① 資料庫:五支函式加兩個參數
`admin_create_shipment` / `admin_add_shipment_items` / `admin_mark_shipment_shipped` /
`admin_void_shipment` / `admin_unvoid_shipment`,各加 `p_actor text` 與 `p_request_id text`,
並在本體裡寫一列紀錄。

🔴 **加參數不能用 `CREATE OR REPLACE`** —— 那會變成「另一個同名函式」,舊的那支還在、而且照樣不留紀錄。
⇒ 必須 `DROP FUNCTION` 舊簽章 + 重建 + 重新 GRANT,寫成一支新的 migration。

🔵 實作細節:`admin_add_shipment_items` 本體只有一行,真正在做事的是 `pcm_b2_add_items_impl`。
⇒ 紀錄寫在**外層那一支**、拿它回傳的快照就好,**不動 impl**。

紀錄的寫法**逐格照抄已經有的那一支**(`admin_update_shipment_tracking` 本體):

```sql
INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id, source_app)
VALUES (
  p_actor,
  'shipment.tracking.update',                  -- 這一支的動作名
  'shipment:' || p_shipment_id::text,          -- 對象
  pg_catalog.jsonb_build_object('tracking_number', v_ship.tracking_number),  -- 改之前
  pg_catalog.jsonb_build_object('tracking_number', p_tracking_number),       -- 改之後
  p_request_id,
  'admin'
);
```

五支的動作名(照既有那支的點號風格,名詞在前、動作在後):
`shipment.create` / `shipment.items.add` / `shipment.shipped.mark` / `shipment.void` / `shipment.unvoid`。

🔴 **「改之前 / 改之後」只放非個資的狀態欄**(出貨時間、快遞商代號、作廢時間、件數)。
**收件人姓名、電話、地址、貨運單號一律不進去** —— 紀錄表是給人事後查的,不該變成第二個個資落點。
(這條沿用出貨線既有的白名單理由。)

🔵 `reason`(原因)欄**只有作廢那一支要帶**。現況統計:會填原因的只有取消訂單、退款、事故那幾類「人給理由」的動作;
訂貨、收款、建單都留空。而作廢包裹本來就強制要員工填原因,順手記下來。

### ② 網站程式:兩層接線
- `apps/admin/src/lib/shipping/shipment-repository.ts` 的五支函式,收下並往下傳 `actor` / `requestId`。
- 五個呼叫端把 `auth.actorId`(員工身分)與 `getRequestId()` 傳進去。

### ③ 部署順序:**板先貼、碼後推**
新簽章算「新函式」⇒ 碼先上線會找不到它。
部署時序閘本來就會擋這種情況(它盯 `.rpc(`)。
⇒ **這片程式在 Sean 貼板之前不能推。**

## 這是房規,不是我們又要發明東西

每一支有留紀錄的函式**都是用同一套參數**,實查簽章:

- `admin_upsert_item_procurement(… , p_actor text, p_request_id text, …)`
- `admin_record_item_receipt(… , p_actor text, p_request_id text)`
- `admin_record_manual_payment(… , p_actor text, …)`
- `admin_create_manual_order(… , p_actor text, …)`
- `admin_cancel_order(… , p_actor text, …)`

⇒ 出貨那五支加這兩個參數,是**把出貨線拉回跟其他人一樣的形狀**。

## 另一個選項(能做,但不建議)

**不改簽章,「誰做的」那一欄寫死 `'system'`。**

- 好處:不用改簽章、網站程式零改動、不用等貼板,今天就能上。
- 代價:**紀錄有了,卻答不出誰出的貨。**

不建議的理由:這件事要回答的問題就只有「誰做的」。寫死 `system` 之後,
紀錄表會**看起來**補齊了 —— 而真的要查的那一天才發現它答不出來。
那是一道看起來在守、實際上守不到的閘。

Sean 有權選這一條,但要在知道代價的情況下選。

## 不會改變任何現有行為

- 只多一個 INSERT。既有的 UPDATE、回傳值、冪等鍵(同一個動作按兩次不會做兩次)一個都不動。
- **不動 schema**:`admin_audit_log` 那張表十二個欄位全都現成,一欄都不用加。
- 出貨還是照原本出貨,員工看到的畫面一個字都不會變。

## 出錯了怎麼退(rollback)

一支 rollback migration:`DROP` 新簽章 + 用舊的完整本體重建五支舊函式 + 重新 GRANT。
五支舊本體已經留檔(2026-09-16 從正式庫 schema 起跳的探針庫 `pg_get_functiondef` 原樣匯出,
行數 108 / 20 / 137 / 91 / 144)。
已經寫進去的紀錄列**不刪**(那張表是 append-only,而且留著沒有害處)。

網站程式那邊 revert 那顆 commit 即可。

## 驗收(怎麼知道做對了)

1. 在本機探針站走一遍:建箱 → 標出貨 → 作廢 → 還原。
2. 每一步在紀錄表都要多一列,而且 `actor` 是**當時那位員工**,不是 `system`、不是空白。
3. **負對照**(這條最重要):把那一行 INSERT 拿掉 ⇒ 對應的測試必須紅。
   只斷言「有寫一列」不夠,要斷言動作名、對象、以及「改之前 / 改之後」的內容。
4. 檢查紀錄列裡**沒有**收件人姓名 / 電話 / 地址 / 貨運單號。

## 要 Sean 決定的

```
Q1:出貨線補操作紀錄,怎麼做?
A: 甲(推薦)= 五支函式加「誰做的」參數,查得到是誰出的貨。要貼板、要等。
   乙       = 不改簽章、寫死 system。今天就能上,但查不到是誰。

Q2:什麼時候排?
A: 甲 = 跟下一批板一起貼。
   乙 = 等目前積著的板(197 / 198)貼完再說。
```
