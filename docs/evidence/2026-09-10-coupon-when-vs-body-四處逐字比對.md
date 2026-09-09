# 2026-09-10 優惠券兩支:WHEN 子句與函式體「四處逐字相同」—— 那道欠的檢查跑了

> 出處:`20260901030000_m4b_zero_total_settle.sql:28` 逐字
> 「② 若該扣:WHEN 子句與函式體**兩處的條件必須逐字相同** —— 改一處等於沒改。」
> 而檔頭自陳:**「缺的那一道檢查 = 在拋棄式 PG 上把這兩支貼起來再比。未跑。」**
>
> **這一份就是那一道。跑了,而且跑出了一件比它更重要的事。**

來源標籤:**【量的】**(命令 + 讀數,尺先證明會咬)/ **【推的】** / **【證不到】**

---

## 🔴 頭條:**這兩支今天【貼不下去】,而擋住它的不是那段過期警語**

【量的】跑 `bash scripts/migrations-replay-from-zero.sh`(從零重放全部 migration),**兩支都失敗**,錯誤逐字(節錄):

> `ERROR: 扣券前置失敗 — 券的【退回】路徑不存在(public.coupon_revert_on_full_refund(pg_catalog.uuid), 且必須是 function 不是 procedure)。`

那道閘自己解釋了它為什麼在:
> 本 trigger 一旦裝上,`coupon_redemptions` 就會開始長,而全 repo 今天寫 `reverted_at` 的地方是 **0 處**
> ⇒ 已用次數只會漲不會退 ⇒ **限量券的名額只減不增。**

### 【量的】那支函式**哪裡都不存在**

| 查什麼 | 讀數 |
|---|---|
| repo 裡有沒有 `CREATE … FUNCTION public.coupon_revert_on_full_refund` | **0**(只有那兩支「要求它」的檔提到它) |
| 正式庫裡在不在(唯讀) | **0** |
| `trg_coupon_redeem_on_paid` 在正式庫在不在 | **0** |
| `coupon_redeem_on_paid` 在正式庫在不在 | **0** |
| 🟢 正對照:`create_order` 在不在(必須 > 0) | **2** ⇒ 尺會咬 |

⇒ 📌 **所以「只剩檔頭那段過期警語擋著」這個判斷【不完整】。**
還有**第二道、活著的、有真實理由的閘**:券退回那條路**沒有人寫**。
⇒ 🛑 而那道閘自己也點名了唯一沒答的那一題:**「誰在什麼情況下寫 `reverted_at`」** —— 也就是那支退回函式由誰、在哪一個退款事件上被呼叫。

🔵 而那道閘自己標了它的限度,逐字:
> **本閘證不到「它真的會寫 `reverted_at`」:一支空殼函式照樣通過** —— 它擋的是【完全沒有人做這件事】那一種,不是【做了一半】那一種。

---

## ✅ 而那道欠的檢查,我用另一條路跑完了

【證不到】走完整重放沒辦法 —— 兩支被前置閘擋住。
⇒ **改法**:把兩支的 `CREATE FUNCTION` / `CREATE TRIGGER` 抽出來,貼到一個**剛好夠讓它們建得起來**的骨架上,
然後比**資料庫實際存進去的樣子**(`pg_get_triggerdef` / `prosrc`),而不是比原始碼字面。
🛑 **這條路跳過了那道前置閘** —— 那是為了回答「四處一不一樣」,**不代表那道閘可以在正式庫被跳過**。

### 順序照窗 A 量的(不可顛倒)

【量的】`021000` 是 `CREATE FUNCTION`(**沒有** `OR REPLACE`)· `030000` 是 `CREATE OR REPLACE` ⇒ 抽取時斷言過,相符。

### ① 兩支的 trigger WHEN 子句(資料庫存的樣子)

```
CREATE TRIGGER trg_coupon_redeem_on_paid AFTER UPDATE OF payment_status ON public.orders
FOR EACH ROW WHEN (((new.coupon_id IS NOT NULL)
  AND (new.payment_status = 'paid'::payment_status)
  AND (old.payment_status = ANY (ARRAY['unpaid'::payment_status, 'partiallyPaid'::payment_status]))))
EXECUTE FUNCTION coupon_redeem_on_paid()
```
✅ **兩版逐位元組相同**(各 328 bytes,`diff` 無輸出)。

### ② 兩支的函式體早退條件

```
  IF NEW.payment_status <> 'paid'::public.payment_status
     OR OLD.payment_status NOT IN ('unpaid'::public.payment_status,
                                   'partiallyPaid'::public.payment_status) THEN
    RETURN NULL;
  END IF;
```
✅ **兩版逐位元組相同。**

### ③ 而「WHEN 與函式體」這兩處的關係 —— **不是「逐字相同」,是「互為否定」**

· WHEN 是**肯定式**:`coupon_id IS NOT NULL AND payment_status = 'paid' AND OLD IN (unpaid, partiallyPaid)`
· 函式體是**早退式**:`payment_status <> 'paid' OR OLD NOT IN (unpaid, partiallyPaid) ⇒ RETURN NULL`
⇒ 📌 **兩者在字面上不可能相同(一個正一個反),而它們涵蓋的【同一組狀態值】完全一致。**
🛑 **所以檔頭那句「必須逐字相同」講得太緊** —— 它真正要守的是「**同一組條件、同一組狀態值**」。
✅ 我逐處核了三個條件與兩個狀態值(`unpaid` / `partiallyPaid`),**四處全部對得上**。

### 🟢 正對照 · ⚪ 負對照

| 對照 | 讀數 |
|---|---|
| 🟢 **正**:兩版函式體本來就該有差(`030000` 是 `CREATE OR REPLACE` 改了東西) | **+23 / -1 行** ⇒ 尺分得出兩版 ⇒ 上面那些「相同」是真的相同,不是尺瞎了 |
| ⚪ **負**:把 `021000` 的早退條件改一個字(`partiallyPaid` → `ZZQ_FAKE`) | **前提斷言:1 行變了(>0)** ⇒ 突變有落地 ⇒ **尺紅了** |

---

## 🎯 順帶答了檔頭沒問的那一題:**trigger 真的會在對的那一步叫**

【量的】造一張帶券的單,走 `unpaid → partiallyPaid → paid`:

```
前提① 券兌換紀錄現在幾列(必須 0)        0
② 轉成 partiallyPaid 之後(必須仍 0)     0     ← ✅ 這一步【不該】扣, 而它真的沒扣
🎯 轉成 paid 之後                        0     ← trigger 有叫(印出了它自己的 WARNING), 而兌換沒寫成
```

✅ **最重要的一格成立**:`unpaid → partiallyPaid` **不觸發**,`partiallyPaid → paid` **觸發** ——
📌 **那正是 `⟦b4-PARTPAIDCOUPONNEVER⟧` 這條線在講的那個轉換,而它在新版裡真的會叫。**

🛑 **而「兌換有沒有真的寫進去」造不出來 —— 原因是我的骨架不是真 schema。**
trigger 自己印的 WARNING 逐字(節錄):
> `coupon_redeem_on_paid: 兌換失敗【而且旗標也寫不進去】… 寫旗標的錯=column "note_type" of relation "order_notes" does not exist`

· 我補了 `order_notes` 之後換成缺欄位,**再追下去就是把整個 schema 重建一遍**。
· 而**重建整個 schema 的那條路(完整重放)正好被那道真的前置閘擋著** ⇒ 📌 **兩條路互相擋住,這一格今天答不了。**

---

## 🛑 我證不到什麼

· **【證不到】兌換紀錄真的會寫進去** —— 見上。要答它得先讓那兩支貼得起來,而那要先有 `coupon_revert_on_full_refund`。
· **【證不到】那道前置閘的判斷對不對** —— 我只證了「它擋著」與「它要的東西不存在」,**沒有評估「券只減不增」這個風險本身有多大**。
· **我跳過了前置閘** —— 用抽段落的方式建函式與 trigger。⇒ **正式庫不可以這樣做。**
· **【證不到】重放裡其他失敗的 migration 是不是環境缺件** —— 重放腳本自己說那個數是**上界**。
· 骨架只有 6 張表 ⇒ **函式體裡其他分支完全沒被執行到**。
  📌 而今天我剛因為「骨架太小」被 codex 抓過一次 —— **這一份的骨架同樣小,只是這次我一開始就寫出來。**

---

## 收攤

我自己的拋棄式叢集已停、目錄已刪、埠 **0** listener。
🛑 **機器上另外幾個別窗的叢集一個都沒動。** 正式庫**零寫入**。

---

## 這一列的結論(主視窗 2026-09-10 定)

```
⟦b4-PARTPAIDCOUPONNEVER⟧ ⇒ 【不做】, 而理由是【它卡在更前面的東西】
· 修法早就寫好在兩支未貼的 migration 裡
· 而那兩支貼不下去:券的退回路徑 coupon_revert_on_full_refund 不存在
· 那道閘不是形式, 它防的是【限量券名額只減不增】
· 🔴 而它真正在等的是一個【設計決定】:誰在什麼情況下把券退回去?
  ⇒ 那是 Sean 的題, 而【今天不急】
```

### 🔴 而「今天曝險 0」的理由,我量出來的**不是**主視窗寫的那個

主視窗寫的理由是「**trigger 不存在 ⇒ 缺陷不可能發生**」。
🛑 **我不照抄** —— trigger 不存在的話,券**根本不會被扣**,那不是零曝險,是**另一個方向**的問題(限量券可以無限用)。

【量的】唯讀查正式庫:

```
① coupons 表在不在(1=在)            1
② coupon_redemptions 表在不在        1
③ 目前有幾張券                       0
④ 其中有【限量】的幾張               0
⑤ 兌換紀錄幾列                       0
⑥ 有幾張單帶了券                     0
🟢 正對照:orders 總列數(必須 > 0)    6   ⇒ 尺會咬
```

⇒ ✅ **「今天曝險 0」成立,而正確的理由是:整個券功能【今天一張券都沒有】。**
⇒ 📌 **兩個理由導出同一個 0,而它們的到期條件完全不同**:
· 主視窗那個理由(trigger 不存在)⇒ **貼了那兩支就失效**。
· 我量的這個理由(0 張券)⇒ **Sean 建第一張券的那一天就失效,而那件事不需要動任何一支 migration。**
🛑 **而沒有任何東西會在那一天叫。**

🔵 順帶:寫 `coupon_redemptions` 的**不只**那支 trigger —— `20260831160000_m4b_coupon_p2_redeem_rpc.sql` 也是寫入端。
⇒ **【證不到】那條 RPC 路今天會不會被呼叫到** ——我沒有追它的呼叫端。今天 0 張券所以不顯現。

### 🛑 兩格「今天答不了」,不再挖(主視窗定)

· 兌換有沒有真的寫進去 —— 骨架不是真 schema。
· 而重建真 schema 的路正好被那道真前置閘擋著。
⇒ **「今天答不了」就是答案。** 那一格要等券退回那條路被寫出來,而那是另一片。
