# 訂單車輛帶入(per-item)+ 可打字車款選擇器 — 設計 v0.2(2026-07-15 Fable;深夜 Sean 拍板折入)

> ✅ **已核准並落地的歷史設計合約。** 本檔仍是 V 線 migration／行為來源證據，
> 但不是目前施工入口；現況與下一步以 `STATUS.md`、`docs/handoff/CURRENT.md` 為準。

> **v0.2 拍板(Sean 2026-07-15 深夜,原文回覆)**:Q1=A(每商品可各標、整車套用)/ Q2=A(搜尋情境自動帶入可改)/ **Q3=B 不回存車庫**(下單填的車款不寫回 customer_vehicles;車庫管理仍在會員中心)/ Q4 擴充=**「選擇我的愛車」要出現在所有車款選擇點**:①首頁「依車輛搜尋」②商品目錄篩選 ③商品頁「確認適用車款」附近 ④購物車車款欄——**全站連動、同一套元件**。並授權:依建議流程直接做完不等批、過夜執行、審查輪上限放寬(>2 輪可 3/4/5 輪)。

> **Sean 需求(2026-07-15 口述)**:客人下單時可在商品下選車款(廠牌/年份/車款);帶入管道=①車輛篩選表 ②打字快速輸入(ya→YAMAHA、r6→R6)③由車款搜尋加入購物車時自動帶入 ④會員車庫既有車款/主要車款。旁邊提示「建議填寫車款,方便我們協助確認商品是否適用」。原則=**方便客人、我們好確認適用、不造成選擇負擔**。另:現行商品目錄車款篩選不能打字=同一個痛點、一併解。
> 狀態:設計 draft、未動 code。與 `2026-07-15-m4a-order-list-redesign-slice-d-plan.md` 決策 B 銜接(本檔取代 B1/B3 的擱置態=B2 正式成案+擴為 per-item)。

## 1. 資料地基(2026-07-15 實查,非憑記憶)
- **車輛字典已在站上**:`product_fitments_effective`(搜尋線同步、10 萬+列 live)→ typeahead/三層篩選的資料源。🔴 **車種鐵律**:選項只出字典字面、不 AI 正規化/不猜。
- `customer_vehicles`(車庫):year+name(自由文字)+is_primary(+engine/km/mods)→ 帶入管道④。
- `VehicleFinder.tsx`(88 行):現=brand→model→year 三層原生 `<select>`、**不能打字**=Sean 痛點確認。
- 購物車=client 端狀態(DB 無 cart 表);**持久化點=create_order**(items 陣列)。orders/order_items 車輛參照=0 欄(實查)。

## 2. UX 設計
**車款欄位置**:購物車每列一個「給哪台車用」欄 + 🔑 **預設整車套用**:購物車頂一個車款欄、填一次全列帶入;單列可各自改(混車訂單才需要)。=「不造成選擇太多」的解。
**帶入優先序(由零操作到手動)**:
1. **搜尋情境自動帶**:客人由車款搜尋(URL/搜尋 context 有車款)加入購物車 → 該商品自動標該車、顯示可改(「已依你的搜尋帶入 2017 YAMAHA R6」)。
2. **車庫預填**:登入會員有唯一車或 primary 車 → 預填+標示「來自你的車庫」。
3. **打字 typeahead(核心互動)**:單一輸入框逐層補全——`ya`→YAMAHA→`r6`→R6→年份;prefix 匹配字典、鍵盤上下+Enter/點選皆可。
4. **三層篩選表**:點開=可打字 combobox 版三層(**同一元件覆用到商品目錄篩選**=順手解型錄痛點)。
5. **自由輸入 fallback**:字典沒有的照打照存(標 `freetext`、顯示端註記),**不擋單**——Sean 本來就要人工確認適用。
**提示文案(hint、非強制)**:「建議填寫車款,方便我們為你確認商品是否適用」;不填不擋結帳。

## 3. 資料模型
- cart item(client)加 `vehicle?: { year, brand, model, raw, source: 'search'|'garage'|'picker'|'freetext' }`。
- `create_order` items 每項多帶 optional vehicle → **`order_items.vehicle_snapshot` jsonb 新欄**(下單時凍結、不隨車庫改動)。🔴 動 create_order=金流 RPC=鐵則 8+12 全套(交易模擬+Fable+Codex 兩段審);可順手併 C3(snapshot 補 brand)一次審。
- admin 訂單列表「年份廠牌車種」欄=`order_items.vehicle_snapshot` 直出(取代 Slice D plan 決策 B 的近似方案)。
- 會員可見自己單的 vehicle(order_items own SELECT 既有)=他自己填的、無洩漏面;經銷價無涉。

## 4. Slice 拆解(每片可獨立部署)
- **V-1 可打字 combobox 三層元件**:先落商品目錄篩選(解現有痛點、立刻可感)→ 元件覆用。不動 schema。
- **V-2 購物車車款欄**:整車套用+單列覆寫+四帶入路徑+hint。純 client+投影,不動 schema。
- **V-3 持久化**:order_items.vehicle_snapshot migration + create_order 參數擴充 + admin 列表欄點亮。**硬閘雙審**。
- **V-4(待拍)**:下單車款回存車庫(方便下次)。
- 排程與 Slice D 關係:D-1(每商品一列列表)不等本線;車款欄在 V-3 落地自然點亮。

## 5. 拍板紀錄(v0.2 已定,見檔頭)
Q1=A / Q2=A / **Q3=B 不回存車庫** / Q4=擴充如下 §6-§7 + 過夜直接做完。

## 6. 🆕 全站連動:「選擇我的愛車」統一元件(Sean Q4 擴充)
**一個 `VehicleSelect` 元件、五個掛載點、同一份選中車款 context**:
1. **首頁「依車輛搜尋」**(HomeHero/VehicleFinder 現址):三層改可打字 combobox + 登入會員多一排「我的愛車」快選鈕(車庫車輛 chips、一鍵套用)。
2. **商品目錄篩選**:同元件(解「不能打字」痛點)+ 愛車快選。
3. **商品頁「確認適用車款」附近**:愛車快選/輸入車款 → 立即在 fitment 清單標示比對結果(§7 保守規則)。
4. **購物車車款欄**:§2 設計 + 愛車快選。
5. (結帳確認頁沿用購物車值、只顯示不重選。)
**連動原則**:任一處選定車款=寫入同一個 client 車款 context(URL param / storage),跨頁帶著走——首頁選了車→型錄已篩→商品頁自動比對→加購物車自動帶入(=Q2 自動帶的一般化)。訪客可用(不強制登入);登入才有愛車快選。

## 7. 🆕 商品頁「是否適用我的車」保守匹配規則(🔴 正確性紅線)
目的=Sean 的「方便客人、我們也好確認適用」;錯誤的「適用✓」比空白更糟(買錯裝不上=信任毀)。規則:
- 車款選擇**來自字典(picker/typeahead/搜尋帶入)**→ 與 `product_fitments_effective` 做**字典鍵精確比對**(brand+model+年份區間):命中=「✓ 適用你的 2017 YAMAHA R6」;未命中=「✗ 未列於適用清單」+「不確定?聯絡我們確認」。
- 車款是**自由輸入(freetext)或車庫舊自由文字**(customer_vehicles.name 未經字典)→ **不做自動判定**,顯示「已記下你的車款,下單後我們人工確認適用」。🔴 禁模糊/相似度匹配、禁 AI 猜(車種鐵律);字典匹配屬「對抗驗證不降級」清單=實作後必實測樣本。
- 所有判定結果僅顯示層;不寫庫、不擋加入購物車。

## 8. Slice 拆解 v0.2(過夜順序=後台線先、前台線後)
- **D-1/D-3/D-2**(admin 列表改造線,依 Slice D verdict)先行。
- **V-1**:VehicleSelect 統一元件(可打字三層+愛車快選)落型錄+首頁(鐵則 1:動前台先 grep design-reference 對齊)。
- **V-2**:購物車車款欄(整車套用+單列覆寫+四帶入+hint)+ 商品頁適用比對(§7)。
- **V-3**:order_items.vehicle_snapshot migration + create_order optional 參數 + admin 列表車款欄點亮。**高風險硬閘:交易模擬+Fable 對抗審+Codex 盲審(輪上限 5、Sean 拍板放寬);不 apply、morning batch。**
