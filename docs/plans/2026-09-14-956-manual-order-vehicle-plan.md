# #956 乙 · 後台建單「車種」一格 · plan(鐵則 8:schema + RPC;等主視窗批)

Sean 2026-09-14 拍乙(看 `~/pcm-mailbox/0914-品味題/956-B-一格.png`):一格「車種」,照 Excel 寫法打(例 `2021 CBR`),打字下面帶字典,對到就帶入,沒有就照存。存法:一張單一台車(08-28 plan 甲已定)。

## 1. 現況(量到的)
- `orders` **沒有**車輛欄;車在品項上(`order_items.vehicle_snapshot`, 20260716180000:26, 形狀 `{kind:'dict',brand,model,year?,source}` / `{kind:'free',raw,year?,source}` + CHECK `order_items_vehicle_snapshot_shape`)。
- `admin_create_manual_order` 第 8 代(20260914030000:83)13 個參數, 對 vehicle 命中 0 ⇒ 手動單今天寫不進車。
- 字典 = `vehicle_taxonomy_public`(moto_brand / model_code / year_start / year_end;正式庫 12,379 列 / 66 廠, service_role 可 SELECT)⇒ 太大, 不能整包下到表單, 要邊打邊查。
- 後台顯示:`order-focal-row.tsx:39-42` 稿有 `order-vehicle` 格而我方沒訂單級欄, 今天用品項的;`order-list-view.ts:1078` `formatOrderItemVehicle` 已能印兩種 kind。

## 2. 改什麼
### DB(migration `20260914140000`, 已掃 ✅ 已佔 stub)
1. `ALTER TABLE orders ADD COLUMN vehicle_snapshot jsonb`(可 NULL)+ CHECK `orders_vehicle_snapshot_shape` **逐字抄** order_items 那道;COMMENT 寫清「手動單一張單一台車;顧客站的單這欄恆 NULL(它的車在品項)」。
2. `admin_create_manual_order` 第 9 代:DROP 第 8 代 + CREATE 加 **`p_vehicle jsonb DEFAULT NULL`**(排最後, 舊 TS 送 13 個名字仍唯一命中);body 只多一段:`p_vehicle` 非 NULL ⇒ 白名單重組(只收 kind/brand/model/raw/year, `source` 固定 `'admin_manual'`;year 收 1900-2100 整數或省略;dict 缺 brand/model、free 缺 raw ⇒ RAISE)⇒ INSERT orders 多寫一欄。其餘一字不動(從第 8 代逐字抄, 用 `latest-definition-of.sh`)。
3. rollback:DROP 第 9 代 + 貼回第 8 代 body(內含完整 body)+ DROP COLUMN。
4. `admin_order_list_v` **不動**(列表車種欄照舊用品項;訂單級只在明細 / 焦點列印)—— 要不要進列表另議。

### App(admin, 同一 slice)
5. `database.types.ts`:orders Row/Insert/Update 加 `vehicle_snapshot: Json | null`;RPC Args 加 `p_vehicle?`。
6. 建單表單 `manual-order-form-body.tsx` 加一區「車輛」一格 `車種`(對圖:標題「車輛(這張單一台車;照你平常的寫法打, 有對到字典就帶入, 沒有就照存)」);
   打字 ≥2 字 ⇒ server action `searchVehicleDictionary(q)`(service_role select `vehicle_taxonomy_public` where `model_code ILIKE q%` 或 `brand||' '||model` 命中, limit 8, 去年份前綴後比對)⇒ 下拉:命中列印「`<年份> <model_code>`　`<brand> · 字典有`」, 最後一列恆「照打:「q」　字典沒有也存」。
   選字典 ⇒ hidden `vehicle={kind:'dict',brand,model,year?}`;照打 ⇒ `{kind:'free',raw,year?}`(年份 = 開頭 4 碼數字就拆出來, 其餘進 raw)。
7. `manual-order-form.ts` parse:加 `vehicle` 欄驗形狀(zod 同判別式), 送 RPC `p_vehicle`。
8. 顯示:`AdminOrderDetail` 加 `vehicle: OrderItemVehicleSnapshot | null`(loader 多讀一欄);`order-focal-row.tsx` 的 `order-vehicle` 格:**訂單級有就印它, 沒有才退回品項那套**(`formatOrderItemVehicle` 直接復用)。
- 不動:顧客站、`create_order`、`order_items.vehicle_snapshot`、列表 view、export。

## 3. 風險 / 界線
- 第 9 代 DROP+CREATE ⇒ 貼的那一瞬舊 TS 叫不到(同第 8 代那次做法;貼與部署要同一時段)。
- 字典查詢走 service_role 直讀 view(不新開 RPC、不 GRANT);純讀。
- 「字典有」只證 model_code 在表裡, 不證年份在 year_start-year_end 內(年份維持自由填, 08-28 plan 同句)。

## 4. 驗收(yes/no)
1. 拋棄式 PG:p_vehicle NULL / dict / free / 壞形狀四發 ⇒ 前三寫進 orders.vehicle_snapshot、第四 RAISE;第 8 代 13 參呼叫仍唯一命中。
2. 本機後台 `/orders/new`:打「2021 CBR」下面出現字典列 + 「照打」列;選字典建單 ⇒ 焦點列印「2021 HONDA CBR1000RR-R」;照打建單 ⇒ 印「2021 CBR」;不填 ⇒ 退回品項那套。（Sean 肉眼那格由主視窗排）
3. 三綠 + 單測(parse 三形狀 / 焦點列優先序)+ codex 兩輪(schema + RPC + 錢線的 RPC)。
估 2 片:DB 半 45 分、app 半 45 分。
