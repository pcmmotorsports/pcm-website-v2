# plan · 取消帳本缺一道 `block_delete` · 2026-09-11 · 窗 C

> 🛑 **本份只寫 plan,一行 SQL 都沒寫,沒有貼正式庫,沒有 commit 任何 migration**(鐵則 8:碰錢 ⇒ plan 先)。
> 🟢 讀數:`pcm_readonly` @ 正式庫唯讀 · rc=0 · 真錯誤 0 格 · `2026-09-11 02:18:19 UTC`;repo 側靜態檢索(剝行註解)。

---

## 🔴 0. 先答那個決定「值不值得做」的問題:**漏了,還是刻意?**

### 答案:**兩者都有,而它們是【兩個不同的問題】——而這一格才是本份的重點。**

**【刻意的那一半】有人寫了理由,而且寫了三處:**
```
20260730140000_…_a7t_cancellation_consistency_triggers.sql:43-46 逐字
  「那條路要求【有人 DELETE 或 UPDATE 取消明細】, 而目前沒有任何 writer 會那樣做」
   ⇒ 當時實量 `DELETE` / `UPDATE` = 零命中
同檔 :50-54 逐字
  「①【零寫入 GRANT】**不等於**【無人能刪改】—— table owner、superuser…」
同檔 :56-57 逐字
  「⇒ 結論不變(現行規劃內無人刪改 ⇒ **不加鎖、不加隔離級閘**), 但它是**條件性**的」
同檔 :60,68  合約債:「日後任何片若要 DELETE 或 UPDATE … 漏洞立即可達」
```

> ## 🎯 **而那個決定的受詞是【鎖與隔離級閘】,不是【block_delete trigger】。**
> ## 📌 **⇒ 「要不要加一道擋 DELETE 的 trigger」這一題,那一段【沒有回答過】。**

🔵 佐證:`order_refunds` / `order_refund_items` / `shipments` 上的 `*_block_delete_bd` 解的是
**不可竄改**;而 `20260730140000` 那段解的是**併發**(`REPEATABLE READ` 下兩交易各刪一列雙雙放行)。
**兩件事。**

**【而有人已經發現這個落差,並且被糾正過一次】**
```
apps/admin/src/lib/orders/cancel-ledger-classifier.ts:24-27 逐字(R1 nit 5 更正原本指錯的錨點):
  明細表 order_cancellation_items 是 DB 層 append-only(20260805100000:17)
  **header 表 order_cancellations 沒有那道**, 靠的是 items→header 的 ON DELETE RESTRICT
  加上「現行規劃無任何片 DELETE/UPDATE 取消明細」
  ⇒ **結論不變, 但別把 header 的 append-only 講成 DB 保證的。**
```
✅ **⇒ 依「有人寫了理由就照那個理由走」:那個理由照走 —— 而它自己就說了「別把它講成 DB 保證的」。**

---

## 1. ① 這件事今天還成不成立 ⇒ **成立**

```
🔬 正式庫實量, 那兩張表上【所有】非內部 trigger:
  order_cancellations       block_truncate_bt        TRUNCATE
                            items_presence_ac        INSERT UPDATE
  order_cancellation_items  block_truncate_bt        TRUNCATE
                            items_presence_ac        DELETE INSERT UPDATE
                            summary_recompute_ac     DELETE INSERT UPDATE
  ⇒ 🔴 **兩張表都【沒有】任何 BEFORE DELETE 的擋門**

🟢 正對照(同一把尺,同一發):它們【有】
  order_refunds        order_refunds_a7c_block_delete_bd        DELETE
  order_refund_items   order_refund_items_a7c_block_delete_bd   DELETE
  shipments            shipments_block_delete_bd                DELETE
⚪ 負對照 現造 trigger 名 ⇒ 0 · 現造表名 ⇒ NULL
```
🔬 **repo 側同樣的形狀**(剝行註解掃全 migrations):`block_delete` / `no_delete` 家族共 7 支函式
` + 對應 trigger`,涵蓋 refunds / refund_items / shipments / shipment_items / suppliers / payments /
shipping_idem —— **取消帳本那兩張不在名單裡**,它們只有 `block_truncate`。

---

## 2. ② 沒有它會怎樣

### 2-1 🔴 **誰刪得掉 —— 具體到角色(實量)**
```
                       DELETE   UPDATE   SELECT
anon                     f        f        f
authenticated            f        f        f
service_role             f        f        t     ← 🟢 後台這條路【刪不掉】
payment_confirmer        f        f        f
pcm_readonly             f        f        t
🔴 postgres              t        t        t     ← 只有它
```
> ## 🎯 **⇒ 今天唯一刪得掉的是 `postgres`(owner)。而那條路只有一種走法:【有人手貼 SQL】。**
> 🔵 客人不行、後台程式不行、報表角色不行。
> 🛑 **而「手貼 SQL」在這個專案不是假想** —— 它是常態(代貼授權),而貼的人是 Sean 或代貼的窗。

### 2-2 🔴 一列被 DELETE 之後,**今天有沒有任何東西會叫?**
```
情況 A 只刪 header          ⇒ 🟢 會擋。FK `ON DELETE RESTRICT`(實量:
                               order_cancellation_items_cancellation_fk 逐字帶 RESTRICT)
情況 B 只刪 items           ⇒ 🟢 會叫。presence trigger 是 DEFERRED, COMMIT 時發現
                               header 還在而零明細 ⇒ RAISE
🔴 情況 C 同一交易刪 header + items ⇒ **兩道都不叫**
```
🔬 **依據是那支 trigger 自己的碼**(`20260730140000:168-170`)逐字:
```
-- header 已不存在(整筆取消於同交易內被刪)⇒ 該 id 無不變式可驗, 跳過。
SELECT id INTO v_dummy FROM public.order_cancellations WHERE id = v_x;
CONTINUE WHEN NOT FOUND;
```
> ## 🛑 **那不是 bug —— 那道 trigger 守的是【一致性】不是【不可刪】,而它把這件事寫在碼裡。**
> ## 📌 **⇒ 情況 C 走完,三張表全部一致、零告警、零留痕。**

🔴 **而留痕那一側也是空的**:那兩張表上**沒有任何 audit trigger**(上面 5 支逐支看過)——
對照:`orders` 有 `pcm_orders_delete_audit_ad` 寫進 `orders_deleted_log`。**取消帳本沒有對應物。**

---

## 3. ③ 今天的曝險

```
🔬 正式庫實量(2026-09-11 02:18 UTC):
   order_cancellations       3 列
   order_cancellation_items  3 列
   🟢 header 存在而零明細的   **0 列**   ← 不變式今天是乾淨的
```
🛑 **而「有沒有任何一列曾經消失過」——我證不到,而那本身就是本列的內容**:
```
沒有 audit trigger、沒有 deleted_log、沒有軟刪欄位
⇒ 📌 一列被刪掉之後, 與它【從來沒被寫進去過】, 今天在庫裡長得一模一樣。
⇒ 🛑 所以「0 列消失過」這句話我【說不出口】—— 我只能說「今天的 3 列彼此一致」。
```
🔵 而**曝險的分母**:3 列真實取消紀錄 · 而客人下過的單 = 0 張(板上 09-10 Sean 逐格答過)
⇒ **那 3 列是自己人的**。

---

## 4. ④ 甲(上線前補)/ 乙(上線後補)

```
甲 = 上線前補一道 BEFORE DELETE trigger(形狀抄 order_refunds_a7c_block_delete_bd)
     ✅ 它把「情況 C」從【零告警】變成【大聲失敗】
     ⚠️ 代價:碰 schema ⇒ 鐵則 8 + 12 ⇒ plan + codex + 拋棄式 PG 四格 + Sean 貼
     🔴 而它會擋住【我們自己】—— 哪天真的要刪一列錯的取消, 要先 DROP 它再建回去
        (那正是 order_refunds 那道今天的處境)

乙(推薦)= 上線後補
     ✅ 理由一:**唯一刪得掉的角色是 `postgres`** ⇒ 客人與後台都碰不到它
        ⇒ 它不是一個「會自己發生」的風險, 是一個「有人手貼 SQL 才會發生」的風險
     ✅ 理由二:今天 3 列且不變式乾淨, 而真客人訂單 0 張
     ✅ 理由三:上線那一週該花的 codex 輪次與拋棄式 PG 驗證, 有更靠近錢的地方要用
     🛑 而乙的前提要寫死:**在補上之前, 任何手貼 SQL 都不准 DELETE 那兩張表** ——
        而那是一句約定不是一道閘(📌 與「coupons 0 列」同一個形狀:**一個事實不是一道閘**)
```

### 🔴 而不論甲乙,**有一格現在就要做,而它不碰 schema**
```
把「那個【刻意】的理由不涵蓋這一題」寫進板 ——
20260730140000 那段決定的受詞是【鎖與隔離級閘】, 不是【block_delete trigger】
⇒ 📌 否則下一個人會拿那段話去關掉這一題, 而它從來沒有回答過這一題。
```

---

## 5. 🛑 我證不到什麼

1. **我沒有真的去刪一列。** 情況 A/B/C 三格全部是**讀 FK 定義與 trigger 碼推的**,
   不是跑出來的。🔴 尤其**情況 C**(同交易刪兩張)——那是本份最重的一格,而它**未實跑**。
2. **「沒有一列消失過」我說不出口**(見 §3)—— 沒有 audit,刪過與沒寫過在庫裡同形。
3. **只有 `postgres` 刪得掉**這一格答的是**表權**,不是**行為**;
   而我**沒有查有沒有 `SECURITY DEFINER` 函式替別的角色刪得掉**(那是另一把尺)。
4. repo 側「零 DELETE/UPDATE writer」我複量過,而 🔴 **我第一發的尺把一段【字串字面】
   讀成真語句**(`20260805100000:571-572` 是 `position('UPDATE public.order_cancellation_items' in v_def)`
   —— 一道**禁止**它的斷言),差點報成「今天有人在刪」。
   ⇒ 📌 **剝行註解剝不掉字串字面。這是今晚第 N 次同一族。**
5. 我用 `scripts/readonly-prod-sql.sh` 而不是 `~/pcm-mailbox/0905查證/run.sh` —— 理由見回報。
