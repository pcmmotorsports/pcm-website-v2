# ⟦0e-LEDGERVSLIVE1⟧ 那些「在 repo 而帳本查無」的 migration,對正式庫逐支實查

> 線【出貨】`-0e` 2026-09-01 22:xx · **只讀,零寫入**(全程 `SELECT`,唯讀連線 `PCM_READONLY_DATABASE_URL`)
> 🔴 **本檔的分母是我自己重算的,不是接受轉述** —— 主視窗說 27 支,**我算到 25 支**。

---

## 0. 🔴 先講最重要的一格:**我的尺有一種結構性的假陽性,而我只是碰巧知道**

```
判準:「這支 migration 建的物件在正式庫上存在 ⇒ 它 apply 過了」
🔴 而【補版控型】的 migration 打破它:它存在的理由就是「那個物件早就在正式庫上了」
⇒ ⇒ 物件當然全在, 而那支 migration 一次都沒跑過
```
**實例(而它是我自己寫的,所以我第一手知道)**:`20260901170000_..._pfe_ddl_into_version_control.sql`
```
它建的 5 個物件 ⇒ 全在正式庫(pfe_table_exists=1)
而它【未 apply】—— 它今天才被寫出來, 而且已經被搬去 docs/specs 當草稿
⇒ 我的分類器把它放進「乙 apply 了而沒記帳」⇒ 🔴 那是假的
```
📌 **⇒ 而我抓到它的唯一原因是【那一支剛好是我的】。**
🛑 **⇒ 名單裡如果還有別的補版控型,我抓不到,而它們會安靜地留在乙那一堆。**
⇒ 🎯 **所以下面的乙那一堆要讀成「上界」,不是「就是這幾支」。**

---

## 1. 分母(自己算的,指令在下)

```
grep -v '^#' supabase/APPLIED.tsv | cut -f1 | grep -E '^[0-9]{14}$' | sort -u   ⇒ 235 個版本號
ls supabase/migrations/*.sql | xargs -n1 basename | cut -d_ -f1 | sort -u        ⇒ 260 支
comm -23 repo ledger  ⇒ 🔴 在 repo 而帳本查無 = 25 支
comm -13 repo ledger  ⇒ 🟢 在帳本而 repo 查無 = 0 支(帳本沒有幽靈列)
```
✅ 而我那支草稿(`20260901190000`)**不在名單裡** ⇒ 它已經搬出 `supabase/migrations/` ⇒ 清單是新的。

## 2. 🟢 七把尺的雙向自檢(先證明它們在兩個世界印不同的東西,再拿去用)

```
func    有 confirm_order_payment=1        / 無 zzq_fn=0
table   有 orders=1                       / 無 zzq_tbl=0
view    有 admin_customer_list_v=1        / 無 zzq_view=0
policy  有 orders_select_own=1            / 無 zzq_pol=0
trigger 有 pcm_e13_orders_subtotal_guard=1/ 無 zzq_trg=0
index   有 ux_pfe_row=1                   / 無 zzq_idx=0
column  有 orders.total=1                 / 無 orders.zzq_col=0
```

## 3. 🔴 而函式那一把尺,我第一版是壞的 —— 正對照救了它

```
第一版:在 SQL 裡算 md5(regexp_replace(btrim(prosrc),'\s+',' ','g'))
⇒ 🔴 12 支【全部】印 DIFF
⇒ 而正對照(20260812150000, 帳本上、我今天早上已用另一種方法驗過它與正式庫相同)⇒ 也印 DIFF
⇒ ⇒ 📌 **正對照該 SAME 而印 DIFF ⇒ 是我的比法壞了, 不是世界。**
   (成因推測:`\s` 在 shell → psql 的傳遞過程中沒有活著。未逐字確認,而不影響結論。)
✅ 改成【兩邊都拉回 python 正規化】重跑:
   20260812150000 ⇒ SAME(len 11239 = 11239)✅ 與我早上的獨立量測一致
   20260811030000 ⇒ DIFF ✅ 而那是【對的】:正式庫跑的是第二代 20260812140000, 不是它
⇒ ⇒ 🟢 **尺在兩個方向都證明過了, 才拿去跑那 25 支。**
```

---

## 4. 三堆

### 🔴 甲 真的沒 apply(15 支)

| 版本號 | 依據 |
|---|---|
| 20260826150000 | 3 個 policy 全不在 |
| 20260826160000 | 2 個 policy 全不在 |
| 20260827180000 | 它是 `search_catalog_by_vehicle` 的**最新代**而函式體 DIFF |
| 20260828060000 | 它是 `pcm_cron.expire_unpaid_orders` 的最新代而 DIFF |
| 20260828090000 | 4 支函式皆為最新代而 DIFF |
| 20260828100000 | `orders.tax_total` / `orders.invoice_requested` 兩欄都不在 |
| 20260830050000 | 2 支函式 ABSENT |
| 20260831155000 | `coupon_redeem_order_problem` ABSENT |
| 20260831160000 | `redeem_coupon` ABSENT |
| 20260901020000 | `orders.coupon_id` 不在 |
| 20260901021000 | `coupon_redeem_on_paid` ABSENT |
| 20260901030000 | 2 支 ABSENT + 2 支最新代 DIFF |
| 20260901080000 | `pcm_pending_refund_on_cancel` ABSENT(而它建的 8 個物件全不在) |
| 20260901160000 | `get_manual_customer_search_summary` ABSENT |
| 🔴 **20260901170000** | **從乙移過來** —— 我第一手知道它未 apply(見 §0) |

### 🔵 乙 apply 了而沒記帳(**4 支,而這是上界**)

| 版本號 | 依據 | 強度 |
|---|---|---|
| 20260828080000 | 5 支函式體全 SAME,**而更早定義 `admin_saved_order_views` 的 migration = 0 支** ⇒ 沒有別的東西能解釋它的存在 | 🟢 最強 |
| 20260827150000 | `search_catalog_by_vehicle` 函式體 SAME ⇒ 線上跑的**正是這一代** | 🟢 強 |
| 20260831180000 | `admin_create_manual_order` 函式體 SAME ⇒ 同上 | 🟢 強 |
| 20260826140000 | view + 2 索引全在,**而更早也定義那支 view 的有 1 支** ⇒ 那一支可以解釋 view,**而兩個 `customers_birthday_idx` / `customers_birth_month_idx` 只有本支建** | 🔵 中 |

### ⚫ 丙 判不出來(6 支)

```
20260828070000 / 20260829180000 / 20260829193000 / 20260901050000
  ⇒ 這四支【零建立語句】(只有 COMMENT / 註解 / 規則說明)⇒ 它們在正式庫上沒有可查的足跡
20260829140000 / 20260901003000
  ⇒ 它們定義的函式【被更晚的一代蓋過】⇒ DIFF 是預期的, 分不出「沒 apply」與「apply 過又被覆寫」
```

---

## 5. 🎯 這一發的答案

```
乙 = 4 / 25 ⇒ 🔵 帳本【大致可信,而不是完全可信】
⇒ 而 APPLIED.tsv 檔頭那句「一列不在這裡 ⇒ 什麼都不代表」**是對的**, 而現在它有數字:
   在這 25 支裡, 至少 4 支【確定已經在正式庫上】而帳本查無
🔴 而那個 4 是【上界不明】的:§0 那個假陽性表示乙可能被高估, 而丙那 6 支表示它也可能被低估
⇒ ⇒ 📌 所以正確的一句是:「25 支裡, 15 支確定沒 apply、4 支確定 apply 了而沒記、6 支查不出來。」
```

## 6. 🛑 本檔證不到什麼

```
· 丙那 6 支 —— 4 支沒有可查足跡、2 支被更晚的一代蓋過。要答它們得看 apply 當下的紀錄, 而那不存在
· 乙那 4 支的【apply 時間】—— 我只證得出「線上跑的是這一代」, 證不出「什麼時候上去的」
· 🔴 §0 那個假陽性:名單裡如果還有別的補版控型 migration, 我的尺抓不到
· 我沒有查【那 15 支甲各自不 apply 的後果】—— 那是另一件工作
· 全程唯讀:零 apply、零 CREATE、零 GRANT
```

---

## 7. 🎯 追加:那 15 支「真的沒 apply」裡,**還有沒有第三支是有呼叫端在等的**

> 主視窗 `-0a` 2026-09-01 22:xx 交辦。**答案:0 支。**

### 🟢 尺先自檢(兩個方向)
```
已知有呼叫端 admin_record_manual_payment ⇒ 3 支非測試檔
             confirm_order_payment       ⇒ 5 支非測試檔
🔴 負對照 現造物件名 zzq_no_such_object_20260901 ⇒ 0
```

### 🔴 而第一版的尺【太寬】,我自己收窄了
```
第一版:拿那 15 支建的【所有】物件去 grep apps/ packages/
⇒ 印出 5 支「有呼叫端」(含 search_catalog_by_vehicle 8 支、create_order 35 支…)
🔴 而那些物件【已經在正式庫上】(舊一代)⇒ 有呼叫端不代表【有人在等這一支】
✅ 收窄成:只 grep 那些【正式庫上確實不存在】的物件 ⇒ 剩 3 支候選
```

### 🔴 而那 3 支候選,**逐處開檔之後全部是註解**
```
20260828100000  tax_total
  apps/admin/src/components/orders/manual-order-lines.tsx:88   ← 註解(而它自己就寫著「那兩檔都還沒 apply」)
  apps/admin/src/lib/orders/manual-order-catalog.ts:151        ← 註解
20260831160000  redeem_coupon
  packages/adapters/src/supabase/mappers/order.ts:88 / :166    ← 兩處皆註解
  packages/domain/src/order/types.ts:1632                      ← 註解
20260901030000  settle_zero_total_order
  apps/storefront/src/lib/orders/order-display.ts:192          ← 註解
```
🛑 **⇒ 三支候選、6 個命中,【全部】在 `//` 或 `/* */` 裡。零個真的呼叫。**
📌 **⇒ 而那正是「命中之後要逐處開檔看它在哪種上下文」那條 —— 名字 grep 會命中註解, 而註解最會講那件事。**

### ✅ 結論
```
那 15 支「真的沒 apply」裡, 【有真呼叫端在等】的 = 0 支
⇒ 🔵 而那是好消息:上線前不必再貼別的東西(就這 15 支的範圍而言)
```
🛑 **而它證不到什麼**:
```
· 我只 grep 【物件名】 —— 若呼叫端用 RPC 字串拼接、或用別名, 我看不見
· 我的分母是 apps/ packages/ —— scripts/ 與別的 repo(報價單)不在裡面
· 而「沒有人在等」不等於「不必 apply」:那 15 支各自的目的我沒有逐支讀
  ⇒ 例如 20260901080000(待退款)零呼叫端, 而它是 Sean 今天拍板要做的東西
  ⇒ ⇒ 📌 **零呼叫端量的是「今天有沒有碼在等它」, 不是「它重不重要」。**
```
