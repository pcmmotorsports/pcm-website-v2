# `#477` 包裹單號換格式 —— plan(鐵則 8:動 schema,等 Sean 批)

> 落檔 2026-08-19 00:5x CST(`date` 實跑)。作者 G2(後台訂單線)。
> **狀態:未批准。** 鐵則 8(動 schema)+ 鐵則 12③(DB 結構)⇒ 要 plan 等批,且 commit 前要過 codex 關卡2。
> 🔴 **本檔不做決定,它把決定攤開。** 兩處要 Sean 拍,寫在 §5。

---

## 0. 🔴 先讀:本片的體積由一個【我拿不到的數字】決定

```
shipments 現在有幾列?   ⇒ 我沒有 DB access,答不出來。這不是還沒查,是查不到。
  = 0  ⇒ 路 A:改一行 CHECK + 產號器換長度,零遷移
  > 0  ⇒ 路 B:多一格「既有列怎麼辦」,而那一格要 Sean 拍
```
⚠️ **而這個數字正在變大**:2026-08-19 Sean 授權用真後台走完整訂單流,
**走到「出貨」就會產生真的 shipment 列**(來源:G6 寫進 `#477` 的查核段;
🔴 **那句「訂單流正在被走」是主視窗轉述的,我沒有直接看到**)。
⇒ 已請主視窗轉 G5:**①回報現在幾列 ②在本片定案前先不要按出貨**。**尚未收到回覆。**

### 🔴 那個數字的欄位 —— **填的時候一定要帶「誰、什麼時候、怎麼量的」**

```
shipments 列數 = ______
量的人   = ______        (要具名到窗代號)
量的時間 = ______        (`date` 實跑值,不要寫 00:5x 這種外插值)
量法     = ______        (一句 SQL、或後台哪一頁的哪個筆數欄)
```
🔴 **這個數字會過期,而且是【每按一次出貨就過期一次】。**
⇒ 引用它之前先看時間欄;**時間欄比數字欄重要**。
⇒ 若時間欄早於「最近一次有人按出貨」⇒ **這個數字作廢,要重量**,不要拿它決定走哪條路。
📎 這一格的形狀 = `docs/patterns/guard-and-instrument-traps.md`
  「數字要離開量測現場時,把環境/層級/時點寫在數字旁邊跟著走」。
  **表會被複製走,前後文不會。**

---

## 1. 現況(全部當場開檔,不吃轉述)

```
DB 側
  supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql:99
    CHECK (shipment_reference ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$')
  產號器 public.pcm_generate_display_id()
    supabase/migrations/20260730120000_m4b_e10_n3a_pcm_generate_display_id.sql:62
  後續動過 shipment_reference 的三支 migration
    20260807230000 / 20260808100000 / 20260810233000  ⇒ 沒有一支改長度(G6 查,我未重跑)

訂單號那一側(**注意:它不是本片要改的東西**)
  packages/domain/src/order/order-number-format.ts:27
    ORDER_NUMBER_RE = /^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/
  消費端只有 display-id.ts:53 的 isValidDisplayId
```
🔴 **兩者同形狀、同產號器,而 TS 那條 regex 只服務【訂單】** ——
`git grep 'shipmentReference|shipment_reference' -- packages/domain packages/schemas`(排除 test)⇒ **零命中**
(分母:`git ls-files packages/domain packages/schemas | wc -l` ⇒ 57)
⇒ **包裹單號在 TS 側【沒有任何形狀驗證】**,它只是被當字串搬。
⇒ ✅ **好消息:改包裹格式【不需要】動 `order-number-format.ts`,訂單號那條不受影響。**

---

## 2. 影響面(`git grep -l 'shipment_reference|shipmentReference' -- apps packages` ⇒ **18 檔**)

```
 8  apps/admin/src/components/orders          列表/面板顯示
 5  apps/admin/src/lib/shipping               邏輯層
 2  apps/admin/src/app/print/orders/[id]/shipping/[shipmentId]
 1  apps/admin/src/components/print           出貨單樣板
 1  packages/ports/src                        介面型別
 1  packages/adapters/src/supabase            讀寫
```
**它們全部把它當 `string` 用 ⇒ 改長度不會讓任何一支型別紅。** 🔴 而那正是風險所在。

### 🔴 2-a 真正會壞而【不會自己紅】的那一格:列印版面

```
apps/admin/src/components/print/shipping-doc.tsx:295   箱號 <b class='font-mono tracking-[0.04em]'>{shipmentReference}</b>
apps/admin/src/components/print/shipping-doc.tsx:452   箱號 {shipmentReference}
而測資把長度【釘死在 6】:
  apps/admin/src/app/print/orders/[id]/shipping/[shipmentId]/page-measure.test.tsx:188  'K7X2MP'
  apps/admin/src/app/print/orders/[id]/shipping/[shipmentId]/page.test.tsx:80           'K7X2MP'
```
🔴 **`page-measure.test.tsx` 是【量版面】的守門,而它量的是 6 碼那個世界。**
換成 8 碼或加前綴之後,**那格照樣綠** —— 因為測資沒跟著換。
⇒ 這正是 `docs/patterns/guard-and-instrument-traps.md`
  「測試環境裡每一個【釘死】,都是主動移除一個維度」與「測資裡不存在的維度,不可能以失敗的形式出現」。
⇒ **驗收條件必須含:測資換成新格式之後,版面守門仍綠。** 只改 code 不改測資 = 沒驗。
📎 出貨單本來就有截斷守門的歷史(`#`ee7b1f35 那條)⇒ **箱號變長是它的正面靶,不是邊角。**

---

## 3. 兩條路

### 路 A —— `shipments` 列數 = 0
```
① 新 migration:DROP 舊 CHECK、ADD 新 CHECK(新形狀)
② 產號器:pcm_generate_display_id 目前固定 6 碼且被【訂單】共用
   ⇒ 🔴 不要改它。包裹要自己的產號路徑,否則訂單號會一起變長。
   兩個做法(§5 Q2):加參數 / 另開一支 pcm_generate_shipment_reference()
③ TS 側:零改動(§1 已證零形狀驗證)
④ 測資:page-measure.test.tsx:188 與 page.test.tsx:80 換成新格式,並確認版面守門仍綠
⑤ 回退:新 migration 附 rollback 段(照本 repo 慣例)
```
估:**60-90 分**(⚠️ 這是看影響面估的,**沒有拆到步驟級**)。

### 路 B —— `shipments` 列數 > 0
路 A 全部,**加**:
```
⑥ 既有列怎麼辦 —— 三個形狀,代價不同,要 Sean 拍(§5 Q1)
   甲 舊列原地改號   最乾淨,而【已經印出去的出貨單上的箱號會對不上】
   乙 舊列保留舊格式,CHECK 放寬成「新格式 或 舊 6 碼」  零遷移,而混淆問題只解一半
   丙 舊列加前綴不改長度                                 折衷,仍要遷移
```

---

## 4. 這一片【不做】什麼(邊界,先寫死)

```
· 不動 packages/domain/src/order/order-number-format.ts —— 那是【訂單】號,不是包裹號
· 不動 pcm_generate_display_id 本體 —— 它被 create_order 共用,動它 = 訂單號一起變
· 不 apply、不 push。migration 寫好等 Sean apply(照 08-07 那次壞 8 小時的順序:先 apply 再上應用層)
```

---

## 5. 🔴 要 Sean 拍的兩題(**不要我替他選**)

```
Q1(只有路 B 才需要):既有的包裹列怎麼辦?
   甲 原地改號(已印出的單會對不上)
   乙 放寬 CHECK 收兩種格式(零遷移,混淆只解一半)
   丙 加前綴不改長度(折衷,仍要遷移)

Q2:新格式長什麼樣?他 2026-08-14 拍的是「B = 換不同長度」,而【幾碼】沒定。
   甲 8 碼、同字母表(最小改動;而 8 碼與 6 碼一眼還是有點像)
   乙 6 碼 + 固定前綴,例如 `S-` (一眼可分;而它會讓箱號變長 2 字元 ⇒ 撞 §2-a 版面)
   丙 換一組不同的字母表(一眼可分、長度不變、版面零風險;而員工要記兩套字母表)
```
⚠️ **我對 Q2 有傾向但不寫進選項**:三案的**版面風險**不同(丙 = 零),
而版面那格是本片唯一「不會自己紅」的風險 ⇒ **這一點應該讓他知道再選**,而不是我代選。

---

## 6. 誠實揭示

```
· shipments 現在幾列 —— 我拿不到,本檔所有「路 A 還是路 B」都懸在這個數字上
· 「訂單流正在被走」是主視窗轉述,我沒有直接看到
· G6 那三支 migration「沒有一支改長度」是它查的,我未重跑
· 60-90 分是看影響面估的,沒有拆到步驟級
· 我沒有開瀏覽器、沒有跑列印預覽 ⇒ §2-a 的版面風險是【讀 code 推的】,不是量到的
```
