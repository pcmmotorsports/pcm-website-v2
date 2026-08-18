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

## 2-5 🔴🔴 **補查改變了本節:出貨線【有】重放路徑,所以要兩組 action 碼**
> 主視窗指定先查的第 ② 格。**它不是補充,它改 plan 的內容。**

`20260807160000_…shipping_idempotency_layer.sql`(840 行)逐字:
```
:15 「pcm_b2_shipping_idem_response(shipment_id, snapshot, replay) —— **回傳形狀的唯一產生處**」
:16 「pcm_b2_shipping_idem_claim(action, key, hash) —— **認領 / 重放分派**」
:20 「五支 RPC 的 body 換成【隔離閘 → 指紋 → 認領 → **重放回傳** → 業務層】」
:93 「兩條路都必須呼叫這支,差別**只有** `idempotent` 那個旗標。**這是 W3 的硬契約。**」
```
⇒ **五支全部都有重放路徑,而且是統一的一層。**

🔴 **所以 `#423` 那條「重放用不同 action 碼」在這裡【必須抄】,理由是它的不變式**:
```
#423 檔頭逐字:「`action` 與正常路徑**刻意不同碼**:查『這張單有幾筆收款』的人濾 `payment.record`,
               重放列不會被誤算進去(**『稽核列數 = 狀態變更數』這條不變式靠 action 區隔保住**)」
⇒ 套到出貨:若重放與首次共用 `shipment.ship`,
  **「這張單出過幾次貨」會被重放灌水** —— 而那正是出貨線最會被問的問題。
```
⇒ **§2 的五個 action 各要一個 `.replay` 對應**:
```
shipment.create / shipment.create.replay
shipment.items.add / shipment.items.add.replay
shipment.ship / shipment.ship.replay
shipment.void / shipment.void.replay
shipment.unvoid / shipment.unvoid.replay
⇒ **十個碼,不是五個。** 而寫入點在冪等層的兩條路上,不是各支自己判。
```
⚠️ **而寫在哪一層要判**:冪等層是**共用的**(`:93` 逐字「兩條路都必須呼叫這支」)
  ⇒ 寫在冪等層 ⇒ 一處寫五支通吃,而 action 碼要能從 `p_action` 推出來
  ⇒ 寫在各支 ⇒ 五處重複,而各自可控
  🔴 **我傾向寫在冪等層**(它已經是「回傳形狀的唯一產生處」⇒ 稽核跟著它才不會有第二個真相)
  ⚠️ **而那是我的判斷,不是抄的** ⇒ 要審查裁。

## 2-6 ✅ ERRCODE:掃完了,`P2B` 這一段**已用到 44**
```
全樹已占用(82 個):P2B01-02 / P2B10-12 / P2B20-44 / P2B50 / P2C13 / P2E… / P5A… / P7C… / P8C…
量法:git grep -oh "'P[0-9A-Z]\{4\}'" -- 'supabase/migrations/*' | sort -u
🔴 而 **P2B22 / P2B24 正是這條出貨線自己的重放錯誤碼**(idempotency layer :40,:42)
⇒ 本片新碼建議走 **P2B45 起**(P2B50 已占 ⇒ 可用 45-49,五個剛好)
⚠️ 而「P2B 是不是這條線的專屬前綴」我沒查 ⇒ 標未確認
```

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

素材:五支的上一版本體在 20260807170000 / 20260807230000 / 20260808100000
✅ **而「中間有沒有別的 migration 改過」查完了(repo 側)**:
```
每支的【所有】定義出現在哪些 migration(不是只看最後一個):
  admin_create_shipment        20260807160000(冪等層佔位)/ **20260807170000** ← 最後
  admin_add_shipment_items     …160000 / …180000 / **20260807230000**        ← 最後
  admin_mark_shipment_shipped  …160000 / …190000 / **20260808100000**        ← 最後
  admin_void_shipment          …160000 / …200000 / **20260808100000**        ← 最後
  admin_unvoid_shipment        …160000 / …210000 / **20260808100000**        ← 最後
⇒ **我 §0-b 列的三檔就是最後一版,repo 側成立。**

而那三支【真的 apply 了】(帳本):
  grep -c 20260807170000 / 20260807230000 / 20260808100000 supabase/APPLIED.tsv ⇒ **1 / 1 / 1**
  負向對照(同尺對確定沒 apply 的 M-4a 那支)⇒ 20260819010000 ⇒ **0** ⇒ 尺會動
```
🔴 **而仍有一格【我在本機查不到】**:
```
「有沒有人在 migration 之外直接改過 live 的函式本體」—— 那要正式庫存取
⇒ 而本 repo 有前例證明那不是空想(`20260810170000:` COMMENT 逐字「**繞得過 owner 直寫**」)
⇒ **標未確認;要升成量到的,只差一發唯讀 `pg_get_functiondef` 比對**
  —— 而那要 Sean 的憑證,與 M-4a 那發 `pg_proc` 查詢同一類,建議併同一批問。
```
觸發判準:apply 後任一出貨動作開始 RAISE 稽核相關錯誤 ⇒ 立刻回滾,不要現場除錯
         (出貨是客人收不收得到貨,不能停在半路)
```

---

## 5. 我沒查的(實作前要補)
```
~~· 出貨線有沒有重放/冪等路徑~~ ✅ **查完,見 §2-5:有,而且是統一的一層 ⇒ 要十個 action 碼不是五個**
· 🔴 admin_audit_log 現在有誰在讀、有沒有人濾 action
~~· 五支 live 定義是不是等於那三檔~~ ✅ **repo 側查完**(見 §4:三檔是最後一版、且帳本各 1)
  🔴 **而「有沒有人繞過 migration 直改 live」查不到** ⇒ 要正式庫,已併進要問 Sean 的批次
~~· ERRCODE 哪些已被占用~~ ✅ **掃完,見 §2-6**(82 個;P2B 段已到 44 + 50 ⇒ 建議 P2B45 起)
· admin_audit_log 的完整欄位定義(我只從 #423 的 INSERT 反推八欄)
```
