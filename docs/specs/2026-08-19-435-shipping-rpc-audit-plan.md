# Plan — `#435` 出貨線五支 RPC 補同交易稽核(抄 `#423`)

> **狀態:未批。** 命中 **鐵則 12③**(改 SECURITY DEFINER 函式本體 = migration)⇒ 要對抗審查。
> 🔴 **12① 不命中 —— 而這次是量到的,不是推的**(見 §0-b)。
> 偵察見 `docs/probes/2026-08-19-435-shipping-rpc-audit-probe.md`。

---

## 0-a 🔴 檔頭前置:**本片的 apply 順序排在 M-4a 那支之後**
```
repo 現在已經有一支在等 Sean apply:
  supabase/migrations/20260819010000_m4a_close_manual_review_attempt.sql
  ⇒ 而它在【不得 apply 清單】上(gate = 完整範圍就緒)
⇒ 🔴 **本片交出來之後也要等他,而且排在那支後面。**
⇒ 寫在檔頭而不是內文,因為「什麼時候輪得到」是讀這份 plan 的人第一個會問的。
```

## 0-b ✅ 12① 那格:**逐檔量過了,零命中**
```
五支的定義檔(最新版本):
  admin_create_shipment        20260807170000_…w3a_create_shipment.sql
  admin_add_shipment_items     20260807230000_…w4b_impl_extract_and_no_batch.sql
  admin_mark_shipment_shipped  20260808100000_…w7d1_ship_deadlock_retry.sql
  admin_void_shipment          同上
  admin_unvoid_shipment        同上

grep -ciE "amount|total|price|payment|refund|金額|付款|退款" <三檔> ⇒ **0 / 0 / 0**
負向對照(同一把尺對確定碰錢的檔):#423 那支 ⇒ **120** ⇒ 尺會動
```
⇒ **12① 不命中。** ⚠️ 而限定:**這是掃字面,不是逐行讀邏輯** —— 我讀了三檔的稽核相關段落,
沒有逐行讀完 683+ 行的全部本體。**若審查者要更硬的,那要逐行。**

---

## 1. `#423` 的形狀 —— **逐條列出來,標明哪些照抄**(第 1 格)

`20260812150000_m4b_e10_423_payment_audit.sql` 的稽核寫入(逐字):
```sql
INSERT INTO public.admin_audit_log
  (actor, action, target, request_id, before, after, reason, source_app)
VALUES
  (p_actor, 'payment.record.replay', 'payment:' || v_existing.id::text,
   p_request_id::text,
   pg_catalog.jsonb_build_object('payment_id', …, 'amount', …),
   pg_catalog.jsonb_build_object(…),
   NULL, 'admin');
GET DIAGNOSTICS v_audit_n = ROW_COUNT;
IF v_audit_n <> 1 THEN
  RAISE EXCEPTION '…稽核落 % 列(期望恰 1)…本交易整筆回滾', v_audit_n
    USING ERRCODE = 'P2B40', CONSTRAINT = 'pcm_op5_audit_replay_row_count';
END IF;
```

| # | `#423` 的做法 | 本片 |
|---|---|---|
| a | 八欄 `(actor, action, target, request_id, before, after, reason, source_app)` | ✅ **照抄** |
| b | **同交易**寫(不是 trigger、不是事後補) | ✅ **照抄** —— 稽核與狀態變更同生共死 |
| c | `GET DIAGNOSTICS` 驗 **ROW_COUNT 恰 1**,不是 1 就 `RAISE` 整筆回滾 | ✅ **照抄** |
| d | 專屬 `ERRCODE` + `CONSTRAINT` 名 | ✅ 照抄形狀,**而碼要換**(見 §2-4) |
| e | 稽核筆數用**獨立變數** `v_audit_n`,**刻意不共用** `v_n` | ✅ **照抄** —— 該檔檔頭寫明理由(既有 harness 的順序錨取首次命中) |
| f | 🔴 **重放路徑用不同的 `action` 碼** | ⚠️ **要判**:出貨線有沒有重放路徑?見 §3 未查 |
| g | `before`/`after` 只放識別欄,不放全量 | ✅ 照抄 |

🔴 **失敗時怎麼辦:照抄 c ⇒ 稽核寫不進去,整個動作回滾。**
```
理由(#423 的錯誤訊息逐字就寫了):「失敗的是稽核寫入,不是收款不存在;請勿重新登錄」
⇒ 出貨線的對應訊息要自己寫,而**形狀照抄**:講清楚失敗的是哪一半,免得員工重按。
```

---

## 2. 五支各自寫什麼進 log(第 2 格)

> 甲/乙 主視窗已裁 **甲(一律寫)**,理由逐字:「**判準說的是『至少要有』不是『不准多』**」。

```
admin_create_shipment       action 'shipment.create'
                            target 'shipment:<id>'
                            before NULL / after {shipment_id, order_id}
admin_add_shipment_items    action 'shipment.items.add'
                            after  {shipment_id, item_ids 或 筆數}
                            ⚠️ **放 id 還是筆數要判** —— #423 的原則是「只放識別欄」
admin_mark_shipment_shipped action 'shipment.ship'
                            after  {shipment_id, carrier, tracking_number}
                            🔴 **兩族都寫**(甲):有單號的照寫、`other` 那族 tracking_number 為 NULL
                            ⇒ 而那個 NULL **本身就是資訊**(它說明這一族沒有外部佐證)
admin_void_shipment         action 'shipment.void'
                            before {status 前} / after {status 後, reason}
                            🔴 reason 要不要必填?⇒ #423 的 reason 欄可為 NULL,而**作廢是可疑動作**
                            ⇒ 我建議必填,⚠️ 而**那是我加的,不是抄的** ⇒ 要審查裁
admin_unvoid_shipment       action 'shipment.unvoid'
                            🔴 **這支最重要** —— 作廢又復原之後狀態長得跟沒發生過一樣
                            ⇒ 稽核是**唯一**看得到那段時間的東西
```

### 2-4 ERRCODE 與 CONSTRAINT 名
```
#423 用 'P2B40' + 'pcm_op5_audit_replay_row_count'
⇒ 本片要**新的碼**,不可共用(否則呼叫端分不出是哪條線的稽核失敗)
⚠️ 而「哪些碼已被占用」我沒有全樹掃 ⇒ **實作前要掃一次 `P2B`/`P5A` 之類的既有碼**,標未查
```

---

## 3. 影響面(鐵則 8 必備)
```
動的檔:一支新 migration(改五支函式本體)
不動:  packages/ / apps/ / 任何前端 —— **稽核是 DB 層的事**
下游:  admin_audit_log 多五種 action ⇒ 🔴 **有沒有人在讀那張表、會不會被新 action 搞混?**
       ⚠️ **我沒查** —— 而 #423 檔頭提過「查『這張單有幾筆收款』的人濾 payment.record」
       ⇒ 表示**確實有人在濾 action** ⇒ 這一格要查清楚才不會弄壞既有查詢
```

---

## 4. Rollback(鐵則 8 必備)
```
🔴 而這一片的 rollback 有一個特別的性質:**稽核寫入是【加】不是【改】**
⇒ 回滾 = 把五支函式貼回上一版(移除那段 INSERT)
⇒ **已經寫進 admin_audit_log 的列不必刪**(它們是真的發生過的事)
⇒ 這比 M-4a 那片的回滾便宜很多 —— 那片改的是【查詢的述詞】,回滾要對齊指紋

素材:五支的上一版本體在
  20260807170000 / 20260807230000 / 20260808100000
⇒ 🔴 而**要確認 live 定義等於那三檔的內容**(中間有沒有別的 migration 改過)——
  **我沒查**,而那是 rollback 素材的前提。實作前必查。
觸發判準:apply 後任一出貨動作開始 RAISE 稽核相關錯誤 ⇒ 立刻回滾,不要現場除錯
         (出貨是客人收不收得到貨,不能停在半路)
```

---

## 5. 我沒查的(實作前要補)
```
· 🔴 出貨線有沒有【重放 / 冪等】路徑(#423 有,而它用不同 action 碼)
  ⇒ 20260807160000 檔名叫「shipping_idempotency_layer」⇒ **很可能有** ⇒ 必查
· 🔴 admin_audit_log 現在有誰在讀、有沒有人濾 action
· 🔴 五支的 live 定義是不是等於那三個檔(rollback 素材的前提)
· ERRCODE 哪些已被占用
· admin_audit_log 的完整欄位定義(我只從 #423 的 INSERT 反推八欄)
```
