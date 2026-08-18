# `#200`「我的愛車」→ 商品篩選 —— **判定:已經做完並上線了**

> 作者:G1 · 2026-08-19 · **這份是判定,不是 plan。** 主視窗要我答四格,而查完之後四格都不必答了。

## ⓪ 結論
```
`#200` 要的東西 = `apps/storefront/src/components/GarageChips.tsx`
最後一次改動 cc53a72a（2026-08-07）；`git merge-age --is-ancestor … origin/main` ⇒ rc=0
⇒ **已在 origin/main、已上線。**
```
🔴 **而條目的四個前提【每一個】都已經不成立。** 下面逐條對。

## ① 條目前提逐條複驗

| 條目寫的 | 今天實查 |
|---|---|
| 「`customer_vehicles.name` 是**自由文字**」 | ❌ 過期。表已有 `dict_brand_name` / `dict_model_name`(字典欄)。而 `GarageChips.tsx:7` 逐字:**「車種鐵律:picker/typeahead/garage 命中恆字典字面(`kind:'dict'`);自由輸入明標 `kind:'free'`、零猜」** |
| 「products filter **現照搬 design 不過濾**(依賴 `#152`)」 | ❌ 過期。真過濾走 RPC `search_catalog_by_vehicle(p_brand text, p_model text, p_year int, …)`,`GarageChips.tsx:9-11` 逐字「既有 `useVehicleUrlSync` 負責**下推 DB 重查**」 |
| 「③ 加『用我的愛車找配件』鈕」 | ✅ **做了**。`GarageChips` 掛在 **6 個地方**:`CascadeFilterTop:145`(桌機型錄)/ `FilterDrawerVehicleTab:107`(手機型錄)/ `MobileVehicleSheet:187` / `ProductFitmentCheck:269`(商品頁)/ `CartVehicleField:147`(購物車)/ `VehicleFinder:79`(首頁) |
| 「`CustomerVehicle` 與 `FitmentSpec` **零邊相連**、需跨 context 架橋」 | ❌ 已架好。`lib/garage-chip.resolveGarageChip` 是共用決策腦,檔頭逐字「**與首頁 VehicleFinder 共用單一來源、不複製第二份**」 |

## ② 主視窗要我答的四格 —— 逐格
```
1「我的愛車今天存在嗎、存什麼」
   ⇒ 存在。customer_vehicles:dict_brand_name / dict_model_name / year / engine / km / mods /
     service / name / is_primary（**有 is_primary ⇒ 可存多台**）
2「剩下那個依賴（Phase 2 結構化 vehicles entity）會不會擋住這片」
   ⇒ 🔴 **不會，而且問題本身已經過期** —— RPC 吃的是 `p_brand text / p_model text / p_year int`，
     而 customer_vehicles 存的正是 dict_brand_name / dict_model_name / year
     ⇒ **形狀天生對得上，不需要 Phase 2 entity。**
3「design 有沒有這條路」
   ⇒ design-reference **沒有**（AccountPages.jsx 的「我的愛車」空狀態逐字
     「尚未新增愛車 — 新增後可**記錄改裝履歷**」＝指向 Phase 2 的用途，不是篩選）
   ⇒ 🔴 **而 OD 有整份稿**:`vehicle-picker-design.html`（GarageChips、副註「點一下直接套用」、
     推廣到四個掛載點）+ `handoff/pages/vehicle-picker-spec.md` §1c「我的愛車機制(**Sean 點名保留**)」
     + `products-list-page.html:437/440` 與 `cart-page.html:431` 都畫了
   ⇒ 真權威在 OD（同 #240 / #309 那條線）。而 OD 自己也記著
     `pcm-product.css:1084`「**因為設計稿沒有「我的愛車」資料源**」⇒ **design-reference 的缺席是已知且已記錄的。**
4「體積 + 鐵則」
   ⇒ **不適用** —— 沒有東西要做。
```

## ③ 🔴 而條目裡那個「Phase 1.5 盡力版」**沒有被採用,而做出來的東西比它好**
```
條目寫的替代方案:「free-text → filter **best-effort prefill**，對映不保證準」
實際做的        :`kind:'dict'` 精確命中才套用；多命中/零命中 → **出建議清單，不猜**
⇒ 🔴 那個「別名對不上就變空」的老問題，是用【不猜】解掉的，不是用【正規化別名】解掉的
⇒ 所以條目的 ④「車款名稱正規化」也不是這片的前置了
```

## ④ ⚠️ 我沒做/沒查的
```
· **沒有登入看過真畫面** —— GarageChips 有 `garage.length > 0` 閘（檔頭 :14 逐字
  「未登入/讀取失敗 → garage=[] → 整個鈕不顯示」）⇒ 匿名開網頁看不到它，
  **我證的是「code 在、已上線」，不是「客人真的按得到」**。要那一格得登入（G3 那條線有）。
· 沒有實測「點一下真的套用並重查」—— 那要登入 + 有存車的帳號
· 沒查 #152 / #177 的現況（條目把它們列為依賴，而本判定不依賴它們成立）
```

## ⑤ 建議處置
```
把 #200 的狀態改成 ✅ 已完成（指向 GarageChips.tsx 與 cc53a72a），
並就地劃掉那四個過期前提 —— 否則下一次盤點會再把它撿起來當「待實作」。
🔴 而條目標題自己就是誤導:「綁 Phase 2 結構化 vehicles」—— 那句今天已經不成立。
```
⚠️ **改條目要主視窗點頭**(`docs/phase-1-backlog.md` 多窗在寫),我沒有自己動。
