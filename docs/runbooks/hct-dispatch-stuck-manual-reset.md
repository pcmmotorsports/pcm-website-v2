# 叫車卡住的箱怎麼救出來(2026-09-10 · `⟦ship-DISPATCHORDER⟧`)

> **誰會用到這一份**:後台按了「叫車」之後,畫面說了什麼不對勁的話,
> 而**那顆鈕從此按不下去**(那是刻意的)。
>
> ## 🔴🔴 先讀這一段 —— **動手的人在賭一件沒有人問過的事**
>
> **「同一箱重複派遣會怎樣」新竹的規格 V15 §8 一個字都沒寫,而我們【沒有問過他們】,也沒有試過。**
> ⇒ 📌 **那正是那個佔位存在的理由**:在分不出來的時候再打一發,
> 等於用一個我們沒有的知識去做一個**不可回收**的動作。
> ⇒ ⇒ 🛑 **所以清掉那個佔位【本身就有風險】,而風險的大小沒有人知道。**
> **可能的結果**:①新竹當成新的一筆 ⇒ **兩台車**  ②新竹當成更正 ⇒ 沒事  ③回一個錯 ⇒ 沒事。
> **我們分不出來是哪一種。**
>
> ## ⚪ 而這一份**一次都沒有被走過**
> 它是**照碼寫出來的,不是照經驗**。每一個欄位名、每一道 trigger、每一句 SQL 都當場開檔量,
> 檔案:行號附在旁邊 —— **而「照著做會發生什麼」沒有人看過。**

---

## 🛑 第 0 步 —— **什麼時候【不准動】**

```
❌ 還沒打電話問新竹 ⇒ 不准動
   📌 那張單有沒有排到車, 只有新竹答得出來。而你要做的決定完全取決於那個答案。
   ☎️ 問法:「箱號 <shipment_reference> · 貨號 <hct_request_id> · 客代 1307,
             這張單有沒有排到車?」
❌ 那一箱已經標了出貨(shipped_at 非空)⇒ 不准動
   📌 那代表整條路走完了 —— 佔位在那裡是【正常】的, 不是卡住。
❌ 只是「畫面上那顆鈕按不下去」⇒ 不准動
   📌 那可能只是它已經叫過車了。先做下面第一步。
```

---

## 一、🔴 先分清楚:它到底卡住了沒有

**唯讀,一發就好**(`bash scripts/readonly-prod-sql.sh <檔>`):

```sql
SELECT shipment_reference,
       hct_status,
       hct_dispatch_attempted_at AS 開始叫車,
       hct_dispatched_at         AS 新竹確認,
       shipped_at                AS 標出貨,
       deleted_at                AS 作廢
  FROM public.shipments
 WHERE shipment_reference = '<箱號>';
```

### 四種形狀,而只有一種是「卡住」

| 開始叫車 | 新竹確認 | 標出貨 | 這是什麼 | 該做什麼 |
| --- | --- | --- | --- | --- |
| `NULL` | `NULL` | — | **還沒叫過車** | 🟢 那顆鈕應該按得下去。按不下去是別的原因(看狀態欄) |
| 有值 | 有值 | 有值 | 🟢 **正常走完了** | **什麼都不要做。** 這是負對照 —— 認得出它,才不會去動一個沒壞的東西 |
| 有值 | 有值 | `NULL` | 🟡 **叫到車了而沒標出貨** | 車會來。**不要清佔位** —— 去補標出貨那一步 |
| 有值 | `NULL` | `NULL` | 🔴 **這一份講的那一種** | 往下讀 |

🎯 **最後那一種的意思是**:我們**開始**叫車了,而**新竹有沒有收到我們不知道**。
📌 **⇒ 而那正是為什麼第 0 步要先打電話** —— 電話會把它變成上面兩種其中之一。

---

## 二、🔴 那道守門:它叫什麼、在哪裡

```
trigger   shipments_hct_dispatched_at_write_once_bu
函式      public.pcm_b2_shipments_hct_dispatched_at_write_once()
migration supabase/migrations/20260910130000_m4b_hct_dispatch_recorded.sql
它守什麼  hct_dispatch_attempted_at 與 hct_dispatched_at 【兩欄】——
          一旦有值就不可改、不可清空
```

🛑 **它擋得住我們自己的碼** —— 那是刻意的:
> 清掉它等於把「不准再按」解掉,而那台車可能已經在路上。

---

## 三、🛑 怎麼停、怎麼清、怎麼開回來 —— **這是【資料庫擁有者】的手,不是後台的鈕**

> 🔴 **後台沒有任何一顆鈕做得到下面這件事。** 要跑它得有正式庫的 owner 連線。
> **⇒ 那是 Sean 或他明文授權的那一次。**

### 順序(三步,而中間那一步是唯一會改資料的)

```sql
-- ① 停掉那道守門(owner)
ALTER TABLE public.shipments DISABLE TRIGGER shipments_hct_dispatched_at_write_once_bu;

-- ② 清掉那一箱的佔位 —— 🔴 只清【那一箱】, WHERE 一定要帶箱號
UPDATE public.shipments
   SET hct_dispatch_attempted_at = NULL
 WHERE shipment_reference = '<箱號>'
   AND hct_dispatched_at IS NULL      -- 🔴 保險:已確認叫到車的不准清
   AND shipped_at IS NULL;            -- 🔴 保險:已出貨的不准清

-- ③ 🔴🔴 **開回來 —— 這一句不准忘**
ALTER TABLE public.shipments ENABLE TRIGGER shipments_hct_dispatched_at_write_once_bu;
```

> ## 🛑🛑 **②跑完就要跑③,不要中間去做別的事**
> **一個停在半路的守門,比沒有守門糟** —— 因為所有人都以為它還在。

### ✅ 事後斷言(唯讀,兩發都要跑)

```sql
-- ⓐ 那道守門真的開回來了嗎(期望 tgenabled = 'O')
SELECT tgname, tgenabled
  FROM pg_catalog.pg_trigger
 WHERE tgrelid = 'public.shipments'::regclass
   AND tgname = 'shipments_hct_dispatched_at_write_once_bu';

-- ⓑ 那一箱真的回到「可以再按一次」了嗎(期望:兩欄都 NULL)
SELECT shipment_reference, hct_dispatch_attempted_at, hct_dispatched_at
  FROM public.shipments WHERE shipment_reference = '<箱號>';
```

🔵 **而 ⓐ 的負對照**:`tgenabled` 是 `'D'` = **還停著** ⇒ 回去跑第 ③ 步。
📌 **兩個值印出來只差一個字母,而它們差很多。**

---

## 四、🛑 這一份【證不到】什麼

1. 🔴 **照著做會發生什麼,沒有人看過** —— 本檔一次都沒有被走過。
2. 🔴 **清掉佔位之後再按一次,新竹那邊會怎樣 —— 未知**(見檔頭)。
3. **那三句 SQL 我一發都沒有跑過**,它們是照 migration 的本體寫出來的。
   🔵 而那支 migration 的行為在拋棄式 PG 上驗過(write-once 兩欄、四道拒絕、併發只有一個贏)——
   **而那不等於這三句在正式庫上會如你所願。**
4. **`DISABLE TRIGGER` 需要什麼權限、Supabase 那條連線給不給** —— 我沒有試過。

---

## 五、量到的事實(這一份的地基)

```
2026-09-10 唯讀正式庫:
  shipments 十八欄, 其中 hct_dispatch_attempted_at / hct_dispatched_at 是本片加的
  那一箱 S9FC6P:hct_request_id = 8947081964 · hct_status = submitted
                hct_dispatch_attempted_at = NULL(還沒叫過車)
2026-09-10 逐一查過 docs/runbooks/:叫車卡住【沒有】任何一支 runbook
  ⇒ 那正是本檔存在的理由
```
