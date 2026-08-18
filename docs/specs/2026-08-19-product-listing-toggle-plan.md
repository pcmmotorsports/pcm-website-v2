# 後台上下架按鈕 —— plan(鐵則 8 + 12③,等批)

> 2026-08-19 G2。**未批准、零 code 改動、未 apply。**
> 路線由主視窗裁定 **甲(走 RPC)**,理由不是慣例:
> **上下架會改變客人看得到什麼,而它是一個會被事後追問「誰把它上架的」的動作 —— 直接 UPDATE 沒有地方記那件事。**

---

## 0. 🔴 這一片不是「補一個元件」,是**在商品域開出第一條寫入路**

```
git grep -n "\.update(|\.upsert(|\.insert(|\.rpc(" -- apps/admin/src/{lib,components,app}/products
  (排除 .test.)⇒ **0 命中**
正向對照(證明尺會動):同一把尺對 apps/admin/src/lib/orders ⇒ **5 個檔有 .rpc(**
```
⇒ 商品域今天**只讀不寫**。本片要建立的是那一整條路,不只是一顆鈕。

### 0-a 為什麼現在做:**決定做完了、實作做完了、只差一顆鈕**

```
Sean 2026-08-15 拍板 Q-B-2=甲 / Q-關哪一條=乙 ⇒ 下架權威從供應商移到員工
  證據在同步管線自己的 code:scripts/rpm-transform.ts:200-206 逐字
    「delisted_at 已從本型別移除,同步管線不再輸出這個 key」
    「🔴 不要把這一欄加回來 —— 加回來等於把下架權威還給來源,直接推翻本片與 Sean 的拍板」
  業務理由逐字:「如果原廠停產,但是我有現貨庫存,那我需要維持上架狀態」
⇒ 同步已經不碰這一欄了(實作完成)、Sean 已經拍了(決定完成)
⇒ 🔴 而**後台沒有任何介面可以按** ⇒ 那個拍板今天【一次都沒有被使用過】
```

### 0-b 🔴 OD 設計稿**刻意沒有畫這顆鈕**,而它的理由今天還成立

`pcm-product-edit-screen/brief.md:429` 逐字:
> **不提供下架按鈕。目前 `delisted_at` 與 `listing_set_by` 沒有任何既有寫入流程,
> 後台也沒有真正可用的下架能力;不能先畫一個看似可用、實際無法完成的按鈕。**

⇒ **那不是漏畫,是紀律** —— 它拒絕畫一顆按不動的鈕(同 repo 既有教訓)。
⇒ **所以本片沒有現成的視覺可以照抄**,位置那一題要另外決定(見 §3)。

---

## 1. 要做什麼(五樣)

```
① migration:新增 RPC public.admin_set_product_listing(...)
   樣板 = supabase/migrations/20260717010000_m4a_admin_set_customer_tier_rpc.sql(249 行)
   照它的六件:SECURITY DEFINER + SET search_path=public,pg_temp
             + 鎖列讀 before → 同值回 NO_CHANGE 零寫入
             + UPDATE 只 SET 該動的欄 → 同交易寫 admin_audit_log
             + REVOKE ALL FROM PUBLIC/anon/authenticated → 只 GRANT service_role
             + fail-closed DO 斷言
② 🔴 UPDATE 要同時寫兩欄:delisted_at 與 listing_set_by='staff'
   不寫第二欄 ⇒ 同步下一輪確實不會碰 delisted_at(已拍板),
   但【誰決定的】這個資訊就丟了 —— 而它正是 Sean 那個拍板的載體
③ repository 寫路徑(商品域第一條)+ server action
④ 元件:那顆鈕(位置見 §3)
⑤ 測試:含突變 —— 拿掉 listing_set_by 那半 ⇒ 必須有一格紅
```

### 1-a 稽核照既有形狀,**不發明**
```
admin_audit_log 由【RPC 內同交易 INSERT】—— 這是本 repo 既有做法,不是我選的
  git grep -l "INSERT INTO public.admin_audit_log" -- supabase/migrations ⇒ 6+ 支
  最近同族:admin_set_customer_tier / admin_adjust_wallet / admin_append_order_note
action 代碼照既有命名(customer.tier.change 那個形狀)⇒ 建議 `product.listing.change`
before / after 建議 = {delisted_at, listing_set_by} 兩欄
⚠️ 而另一個窗正在寫 #435(出貨線補稽核)⇒ **落檔前去對它的 action 命名**,不要各發明一套
```

---

## 2. 🔴 apply 順序:**本片與佇列裡另外兩支無先後依賴**(現在就判,不留給以後)

```
佇列現況(主視窗轉述,我未逐支核對 apply 狀態)
  ① M-4a 佇列出口那支      動 payment_charge_attempts 相關
  ② #435 出貨稽核          動 shipments / 稽核
  ③ 本片                    新增一支函式 + GRANT,UPDATE products 兩欄
判斷依據(機械的):三支動的 DB 物件【零交集】
  —— 本片不改任何既有函式、不改任何既有表結構,只新增一支函式
⇒ **無先後依賴,三支可以任意順序 apply。**
⚠️ 而若寫 code 時發現需要【動到既有 RPC】而不只是新增一支 ⇒ 🔴 **停下回報主視窗**
   (它明文說那是另一個風險層)
```

---

## 3. 🔴 那顆鈕放哪 —— **兩個位置,要主視窗選,我不自己拍**

**判準用走查那條線的語言:員工要下架一件商品,從登入算起要點幾下?**

```
甲 商品【列表】每一列一顆
   登入 → 商品 → 搜尋 → 按 = **3 步**
   ✅ 最快;批次處理多筆時明顯省事
   🔴 而列表已經很擠 —— #519 記著訂單列表 14 欄放不下的同型問題,
      商品列表今天 8 欄(窄)/14 欄(寬),再加一欄要重估
   🔴 而「一列一顆」的誤按代價是【客人立刻看不到那件商品】

乙 商品【詳情頁】一顆
   登入 → 商品 → 搜尋 → 點進詳情 → 按 = **4 步**
   ✅ 誤按風險低(要先點進來,已經在看這一件)
   ✅ 與 OD 設計稿的結構一致 —— 它的商品識別列右側就是放操作的地方
      (brief.md §①-A 逐字:「右側只有兩個操作:批次改特價 / 查看變更紀錄」)
   🔴 一次只能處理一件
```
🔴 **我傾向乙**,理由是誤按代價不對稱:**下架一件商品 = 客人立刻看不到**,
而多點一下的成本是**一次**,誤按的成本是**一通客訴 + 一次找不到原因的排查**。

### 🏁 裁定:**乙(詳情頁)**(2026-08-19,主視窗代裁,Sean 可推翻)

理由照我提的那條,而主視窗把它講得更死:
```
列表每列一顆(3 步):員工在【掃視】的狀態下按到 —— 而下架會改變客人看得到什麼
詳情頁(4 步)      :員工已經【打開這一件商品】—— 他知道自己在對誰動手
🔴 多一步的成本是【一次點擊】,誤按的成本是【一件商品從店裡消失,而沒有人知道】
```
⚠️ **而若之後出現「一次下架 20 件」的需求 ⇒ 那是【批次】,是另一片。**
**不要拿它來反推這一片該放列表。**(這句寫在這裡,是因為它會被拿來反推。)

---

## 4. 不做 / 邊界

```
· 不動 scripts/rpm-*(同步管線)—— 它已經照拍板停寫 delisted_at 了
· 不碰價格(Q-B1 的價格那半【沒有拍板】,同步今天仍每輪覆寫 price_general)
· 不做「型錄可見度」四值(repo 零命中,那是走在實作前面的東西)
· 不 apply、不 push
· 🔴 發現要動既有 RPC ⇒ 停,回報
```

## 5. 驗收(逐條 yes/no)

```
□ 按下之後,products.delisted_at 有值(下架)或為 NULL(上架)
□ 🔴 同一次寫入,listing_set_by = 'staff'
   突變:拿掉這半 ⇒ 對應那格必須紅
□ 同值再按一次 ⇒ NO_CHANGE、零寫入、零 audit 列(照樣板的行為)
□ admin_audit_log 多一列,actor / action / target / before / after 都對得上
□ EXECUTE 權限:anon / authenticated 打不到(照樣板的 REVOKE→GRANT)
□ 四綠 TURBO_FORCE=1(動 .tsx ⇒ 含 build)
□ 🔴 apply 前後對正式站跑一次 smoke:那支函式解析得到、具名參數對得上
   (08-07 那次壞 8 小時的教訓:應用層不得先於 migration apply 上線)
```

## 6. 誠實揭示

```
· 佇列裡另外兩支的 apply 狀態是主視窗轉述的,我沒有逐支核對
· #435 的 action 命名我還沒去看(§1-a 標了「落檔前去對」)
· 商品列表今天幾欄我沒重量(引 #519 的訂單列表數字當同型參照,不是同一張表)
· 我沒有畫任何視覺 —— §3 兩案是【位置】不是【樣式】,樣式要照 admin-design-system
· 🔴 我沒有實跑過任何寫入(本片零 code)
```
