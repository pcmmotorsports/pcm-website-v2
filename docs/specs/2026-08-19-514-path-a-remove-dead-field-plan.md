# `#514` 路 A —— 把死欄位從型別與 mapper 移除(**不動 DB**)· plan

> 2026-08-19 G2。**未批准、零 code 改動。** 鐵則 8(跨 7 檔)⇒ 寫完等 Sean 批。
> 偵察在 `docs/probes/2026-08-19-514-fulfillment-status-recon.md`。
> **本片零 migration、零 apply、不進 Sean 的 apply 佇列** —— 那是它與路 B 最大的差別。

---

## 0. 🔴 路 A 自己的價值:**它不是清理,是讓那件事【不可能再發生一次】**

`#514` 的病不是「有人寫錯一行」,是:
```
一個【沒有 writer 在維護】的欄位,被 mapper 直送進 domain 型別
⇒ 於是它在型別上看起來與其他欄位【一模一樣】
⇒ 於是有人把它 render 到畫面上,而 typecheck 全綠、測試全綠
```
而那支 migration 的 COLUMN COMMENT **已經寫了警語**(`20260729010000:87` 逐字
「**任何新程式不得讀取本欄做判斷**」)—— **而它擋不住**,因為條目自己抓到的那句:
> **「不得讀取本欄做判斷」對「把它 render 到畫面上」零約束力 —— 因為 render 不是判斷。**

🔴 **路 A 是把那句警語換成機制**:欄位從型別裡消失 ⇒ **下一個人打不出 `detail.fulfillmentStatus`,tsc 會紅。**
⇒ **價值不是少幾行 code,是「再被引用一次」從【要靠人記得】變成【不可能】。**

---

## 1. 影響面(當場量,分母附上)

```
非測試檔 7 支(git grep -ln "fulfillmentStatus" -- apps packages | grep -v '\.test\.')
  apps/storefront/src/components/account/tabs/OrdersTab.tsx        :71  傳參
  apps/storefront/src/components/account/tabs/OverviewTab.tsx      :153 傳參
  apps/storefront/src/lib/orders/order-display.ts                  :54-56 簽章(第二參數已是 `_fulfillment`)
  packages/adapters/src/supabase/mappers/order.ts                  :188 / :373 直送
  packages/domain/src/order/types.ts                               4 處欄位宣告
  packages/domain/src/order/order.ts                               :232 / :243 / :252 / :292 建構與預設值
  packages/domain/src/order/state-machine.ts                       :120-125 withFulfillmentStatus
測試檔 20 支(同一把尺,`grep -c '\.test\.'`)
```
🔴 **7 檔 ⇒ 鐵則 8 命中(跨 3+ 檔)⇒ 要 Sean 批准才動手。**
⚠️ **座標更正**:`#514` 條目寫 mapper 直送在 `:180` ⇒ **實際是 `:188` 與 `:373`**(行號已漂)。

### 1-a ✅ 一個讓範圍變小的發現:**state machine 那半也是死的**

🔴 **而這個死家族有【五個成員】,不是兩個**(GR R1 MF-1;本檔第一版只列了兩個):
```
① withFulfillmentStatus        state-machine.ts:120   呼叫端 0(排測試/定義/barrel)
② assertFulfillmentTransition  state-machine.ts:93    同上
③ canFulfillmentTransition     state-machine.ts:66    🔴 第一版漏列
   —— 它的非測試命中只有三處:barrel 匯出(index.ts:73)、自己的定義、
      以及【被 ② 呼叫】(:97)⇒ ② 死了它就跟著死
④ FULFILLMENT_TRANSITIONS      state-machine.ts:50    轉移表,只被 ③ 讀(:70)
⑤ FulfillmentStatus 型別        types.ts / order.ts    + barrel 兩行匯出
```
⇒ **五個一起移除。** ③④ 是被 ①② 撐著的,不是獨立的東西。

---

## 2. 🔴 順序是硬的,而它是【被 code 自己寫下來的】

`apps/storefront/src/lib/orders/order-display.ts:41-42` 逐字:
> 簽章保留雙參數(消費端 OrdersTab/OverviewTab 零改動;`fulfillmentStatus` 契約收縮 = A9s 片、
> 依 DAG 在本片之後 —— **先砍型別會讓仍在讀的 TSX 編譯斷**)

```
① 先改【呼叫端】   OrdersTab.tsx:71 / OverviewTab.tsx:153 改成 orderStatusLabel(o.paymentStatus)
② 再收【簽章】     order-display.ts 拿掉第二個參數(它今天已經是 `_fulfillment`,零行為改變)
③ 再砍【型別】     types.ts / order.ts / state-machine.ts / mapper
④ 測試 20 支跟著改
```
🔴 **順序反了會編譯斷** —— 而那不是災難,是**噪音**:它會讓一次乾淨的移除變成一輪紅燈追逐。

---

## 3. 🔴 那個「沒有人量得到的數字」—— **本片不需要它**

審查很可能會問:「你怎麼知道正式庫今天不是別的值?先去量。」
**而那個量測需要 Sean 的憑證,會把這一片卡住。⇒ 這裡先把論證寫完:**

```
① 那一欄【零 writer】:
   條目查過全 migrations(建型別/建欄 DEFAULT 'notOrdered'/索引/舊 view CASE/COMMENT,無寫入)
   兩支寫入 RPC 明文排除:20260714130000:18 逐字「**絕不含** … fulfillment_status」
                        20260611120000:16 逐字「零 fulfillment_status」
② 應用層也零 writer(我複驗的那半):
   路 A 動的 7 支檔裡,**沒有任何一支在寫它** —— 全部是讀 / 傳 / 宣告
③ ⇒ 那一欄的值只能是 DEFAULT,或某個歷史時點被寫過而之後凍結
📎 **而有一個【曾經】的 reader,先寫出來免得下一個人嚇一跳**(GR R1 ② 獨立掃到):
   `supabase/migrations/20260714120000:140` 有一次性 backfill **曾經**讀過它。
   ⇒ 🔴 **那是歷史,不是 live** —— 一次性 backfill 跑完就結束,不是持續的 reader
   ⇒ **零 writer 的論證不受影響**;而寫在這裡的用途是:
     **下一個人 grep 到那一行時,不必重新判斷一次。**
🔴 而不論它今天是什麼值,**路 A 都不讀它、不寫它、不依賴它** ——
   路 A 做的是「把讀它的路都拆掉」。
⇒ **那個數字對本片的處置【零影響】。** 它只影響路 B(要不要 DROP、DROP 前要不要備份)。
```
📌 **這一段的用途**:讓審查者**不必**去要一個需要 Sean 才拿得到的數字。
(這是「先查有沒有一條讓這題不成立的路」的用法 —— 而我沒有假裝那個數字不重要,
 我說的是**它對這一片不重要,對下一片重要**。)

---

## 4. 路 B 的關係:**只寫一句,不判**

```
路 A 完成之後 ⇒ 「沒有任何東西讀那個欄位」這個前提【成立且可機械複驗】:
   git grep -c "fulfillmentStatus" -- apps packages ⇒ 期望 0(含測試)
   git grep -c "fulfillment_status" -- apps packages ⇒ 期望 0
⇒ **路 B(DROP COLUMN)的【應用層】前置就滿足了。**
⚠️ 🔴 **而那只是應用層那一半**(GR R1 nit-②):**DB 側還有沒有 reader**(view / 函式 / trigger 讀那一欄)
**屬於路 B 自己的偵察**,不在本片射程。本片只保證「apps 與 packages 不讀它」。
🔴 而**路 B 要不要做、什麼時候做,本片不判** —— 那碰 schema(鐵則 12③),是另一片、另一次拍板。
```

---

## 5. 驗收(逐條 yes/no)

```
□ 🔴🔴 **驗收的尺換成【詞幹級】,不要用 camelCase**(GR R1 MF-1 —— **我第一版的尺比宣稱窄**)
   ```
   ❌ 第一版:git grep -c "fulfillmentStatus" -- apps packages
      ⇒ 它是 **case-sensitive** 且只抓 camelCase 欄位名
      ⇒ 🔴 `FulfillmentStatus`(型別)/ `FULFILLMENT_TRANSITIONS`(常數)/
         `canFulfillmentTransition`(函式)**全部逃得掉** ⇒ 驗收照樣 0、照樣過,
         而型別還在、下一個人 import 得到 ⇒ **「不可能再發生」只做一半**
   ✅ 改成:git grep -ci "fulfillment" -- apps packages ⇒ **0**(詞幹級,一把蓋全形態)
   量到的差距(我自己重跑,2026-08-19):
     camelCase 尺 ⇒ 命中 **27** 個檔
     詞幹級尺     ⇒ 命中 **38** 個檔
     ⇒ 🔴 **11 個檔對我第一版的驗收是隱形的**
   ```
   ⚠️ `supabase/migrations/` **不在射程內**(欄位還在 DB,migration 的歷史紀錄不動)
   ⇒ 所以尺要限定 `-- apps packages`,不要掃全 repo。
□ 🔴 顧客站的訂單狀態文字**一個字都沒變**
   —— 那是本片的核心性質:`orderStatusLabel` 的 switch 只看 payment,第二參數今天已經沒在用
   ⇒ 突變:把 `orderStatusLabel` 改成回別的字 ⇒ 既有測試必須紅(**證明那組測試守得住文案**)
   🔴 **而突變證的是「有測試釘住【某些】字面」= 必要非充分**(GR R1 nit-④)⇒ 補兩格:
   ```
   · 突變要標【分母】:PaymentStatus 有 5 個值,這一輪的突變釘住了幾個?
   · 加一條機械檢查:**`orderStatusLabel` 的 switch 本體零 diff** —— 本片只准動【參數行】
     (若 switch 也被動到 ⇒ 那就不是「零行為改變」了,停下回報)
   ```
□ 🔴 **付款軸零 diff**(GR R1 nit-⑤):同一支檔裡就有付款軸的六個函式
   ⇒ 驗收要明確檢查它們**一個字沒動** —— 防「順手誤刪隔壁」。
□ 四綠 TURBO_FORCE=1(動 .ts/.tsx ⇒ 含 build)
□ 20 支測試檔全綠
□ 🔴 **零行為改變**:本片不應該改變任何一個畫面上的字或任何一條查詢
   ⇒ 若發現某處改了行為 ⇒ **停下回報**,那代表有人在讀那個值而我沒找到
```

## 6. 誠實揭示

```
· 「零 writer」的 migrations 那一半是 #514 條目查的,我複驗的是【應用層】那一半
· 我沒有量正式庫今天那一欄是什麼值(§3 論證了本片不需要它)
· 20 支測試檔我沒有逐支開過 —— 只數了檔數;實際改動量要動手時才知道
· 我沒有開瀏覽器 —— 「顧客站文字不變」那條是讀 order-display.ts 的 switch 推的,
  🔴 **而它應該由測試證,不是由我讀** ⇒ 已寫成驗收的突變那一格
```
