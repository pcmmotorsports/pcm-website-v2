# A 段 · 依車輛搜尋 引擎統一(B′) — 接線計畫

> 2026-08-03 開立 · 分支 `home-redesign`(worktree 已 `git merge --ff-only dev` 對齊 `1b8f842`)
> **本檔只是計畫,零 code 異動。**
> 規範權威 = `vehicle-picker-spec.md`(全檔已讀:§1 三個絕不碰、§2 內臟統一 11 條、§3 兩個行為變更、§4 十條實作地雷、§5 拍板紀錄)
> 字面權威 = `vehicle-picker-design.html`(A 統一字面總表 / B 元件標準版 / C 六入口 before→after / D 清除語意矩陣 / E 交接註記)
> 拍板 = **Q1=A 廠牌 · Q2=A 選擇或輸入 · Q3=A 桌機清除連分類 · Q4=A 首頁選廠牌即可搜**(spec §5)
> 🔴 §10 有一題必須 Sean 拍板(字面標點衝突)。🔴 D 段的 §9 Q1(design 真權威住哪)同樣是本段開工前提。

---

## 0 · 一句話

**容器與動線全不動,只統一引擎。** 六個選車入口的位置、開合、節奏維持現狀;
統一的是字面、輸入行為細節、愛車膠囊的殼。唯二動到行為的是 Q3(桌機清除連坐分類)與 Q4(首頁門檻放寬)。

---

## 1 · 三個「絕不碰」(spec §1,逐條實查後確認仍成立)

### 1a 六個容器的動線

| 入口 | 維持的現狀 | 實查位置 |
|---|---|---|
| 首頁 N°01 VehicleFinder | 三欄攤開直排 + 「搜尋部品」送出鈕(草稿制) | `VehicleFinder.tsx:126-163` |
| 目錄桌機 CascadeFilterTop | sticky 列三欄攤開、**即選即套** | `CascadeFilterTop.tsx:74-127` |
| 目錄手機 | ADR-0007 全套:大塊 CTA / 黏頂精簡列 / MobileVehicleSheet 草稿制 + 送出鈕 | `ProductsMobileControls.tsx:97-154`、`MobileVehicleSheet.tsx` |
| PDP §7 ProductFitmentCheck | 內嵌卡、選到車型即判定、手機預設收合單顆鈕 | `ProductFitmentCheck.tsx:225-282` |
| 購物車 CartVehicleField ×2 | 頂部整車欄 + 單列覆寫欄、自由輸入 fallback | `CartVehicleField.tsx:127-214` |
| 帳號 InlineVehicleForm | 字典雙下拉 + 自行輸入 fallback | `account/InlineVehicleForm.tsx:165-213` |

規則(= 把現狀寫成規則,零行為變更):**攤開列 = 即選即套;蓋住內容的面板 = 草稿制 + 送出鈕;內嵌卡 = 選到車型即生效。**

### 1b 儲存架構 —— 三個 sessionStorage 鏡寫入點,一個都不能少

| # | 寫入點 | 實查(2026-08-03 本 worktree) |
|---|---|---|
| 1 | 首頁搜尋 push 前 | `VehicleFinder.tsx:149` ✅ |
| 2 | 目錄換車/清車,與寫 URL **同一 effect 單點寫/清** | `products-url-state.tsx:366-375`(寫)/ `:379`(清) ✅ |
| 3 | PDP §7 commit 與 URL 解析成功時回寫 | `ProductFitmentCheck.tsx:118`(mount)/ `:144,149`(URL 變更)/ `:167`(commit) ✅ |

- URL `?vehicle=brandId:modelId[:year]` **恆為第一真相**;長版 `?brand=&model=` 舊書籤仍收(`products/page.tsx:60-61`)。
- 目錄側 **mount 無車不清鏡**(`products-url-state.tsx:376-380` 的 `pendingRestoreRef === false` 守門)——
  直接逛 `/products` 不得洗掉他頁寫的鏡。
- PDP 無 URL 參數時讀鏡、URL `'invalid'` 三態**不讀鏡**(`ProductFitmentCheck.tsx:88-126`)。

### 1c 「我的愛車」機制

- 顯示條件 = **登入且車庫非空**(`garage.length === 0 → return null`,`GarageChips.tsx:64`);
  不是「有主車才顯示」—— `isPrimary` 只影響購物車預填(`CartView.tsx` 的 run-once 預填)。
- 決策腦單一來源 `resolveGarageChip`(`lib/garage-chip.ts`),年份閘門(四位數 + 在字典年份內才帶)收在純函式,**不得複製第二份**。

---

## 2 · 哪些元件改字面(逐檔逐行,字面取自 A 表)

> 🔴 下表所有行號 = **2026-08-03 本 worktree 實讀**。實作當天必須重新 grep,
> 因為 §8 的 D 段可能已經動過 `VehicleFinder.tsx`。

### 2.1 `components/VehicleSelect.tsx` — 全站選車核心,改這裡會擴散到三個掛載點

| 行 | 現況 | 改成 | 影響誰 |
|---|---|---|---|
| `:228` | `label="選擇品牌"` | `label="選擇廠牌"` | 首頁 finder + PDP §7 + 購物車 + 帳號表單(全部走 `VehicleSelect`/`VehicleCombo`) |
| `:231` | `placeholder={variant==='finder' ? '—' : '品牌'}` | `'選擇或輸入廠牌'`(finder 殼是否保留 `—` 見下方註) | 同上 |
| `:235` | `slotLabel="品牌"` | `slotLabel="廠牌"` | finder 變體 |
| `:242` | `placeholder={… : '車型'}` | `'選擇或輸入車型'` | 同上 |
| `:246` | `slotLabel="車型"` | `slotLabel="車型 · 可不選"` | finder(設計稿 C2 After 逐字) |
| `:253` | `placeholder={modelNoYears ? '不限年份' : … : '年份'}` | `modelNoYears ? '不限年份' : '選擇或輸入年份'` | 同上 |
| `:257` | `slotLabel="年份"` | `slotLabel="年份 · 可不選"` | finder |
| `:238/:249` | `label="選擇車型"` / `label="選擇年份"` | **不變**(A 表的 aria 已是這兩個字) | — |

> **finder 變體的 placeholder**:設計稿 C2 的 Before/After 兩張圖,三個 slot 都畫成 `—`(未選)/ `YAMAHA`(已選),
> 沒有畫出打字提示。A 表的 `選擇或輸入廠牌` 是**通用定版**。
> → 實作採 **A 表定版**(A 表標題逐字寫「實作端逐字照抄」),finder 的 `—` 退場。
> 若 Sean 看過覺得首頁那排太吵,一行改回即可、不影響任何行為。

### 2.2 `components/CascadeFilterTop.tsx` — 桌機 sticky 列

| 行 | 現況 | 改成 |
|---|---|---|
| `:87` | `label="選擇品牌"` | `label="選擇廠牌"` |
| `:90` | `placeholder="搜尋或選擇廠牌"` | `placeholder="選擇或輸入廠牌"` |
| `:99` | `crossLayer ? '搜尋或選擇車型，例:R6' : '搜尋或選擇車型'` | `crossLayer ? '選擇或輸入車型，例:R6' : '選擇或輸入車型'` |
| `:100` | `crossLayer ? '查無符合的車款，請調整關鍵字' : '查無符合的車型，請調整關鍵字'` | **不變**(已符合 A 表;標點見 §10) |
| `:112` | `modelHasNoYears ? '不限年份' : '搜尋或選擇年份'` | `modelHasNoYears ? '不限年份' : '選擇或輸入年份'` |
| `:83-84` | `選擇適用車輛` + `可直接選擇，也可輸入搜尋` | **不變**(設計稿 C1 的 After 圖逐字保留這兩行) |
| — | 廠牌欄**沒有 `emptyHint`** | 🔴 **補** `emptyHint="查無符合的廠牌，請調整關鍵字"`(A 表要求三欄同式;現況只有車型欄有) |
| — | 年份欄沒有 `emptyHint` | 補 `"查無符合的年份，請調整關鍵字"`(對齊 `MobileVehicleSheet.tsx:212`) |
| — | 年份欄 label 旁無「可不選」標示 | 補(A 表條 3;桌機列現況三欄都沒標) |

### 2.3 `components/MobileVehicleSheet.tsx` — 手機面板(**改動最小,它就是標準版的原型**)

| 行 | 現況 | 改成 |
|---|---|---|
| `:175` | `<span className="mvs-field-label">廠牌</span>` | **不變** ✅ |
| `:177` | `label="廠牌"` | `label="選擇廠牌"`(A 表:aria 統一「選擇 X」) |
| `:180` | `placeholder="選擇或輸入廠牌"` | **不變** ✅ |
| `:181` | `emptyHint="查無符合的品牌，請調整關鍵字"` | 🔴 `"查無符合的廠牌，請調整關鍵字"`(A 表條 8 明列的「品牌」殘留) |
| `:189/:203` | `車型<small>可不選</small>` / `年份<small>可不選</small>` | **不變** ✅(這兩行是全站規範的來源) |
| `:190/:204` | `label="車型"` / `label="年份"` | `label="選擇車型"` / `label="選擇年份"` |
| `:194-195` | 車型 placeholder / emptyHint | **不變** ✅ |
| `:210` | `modelHasNoYears ? '不限年份' : draft.model===null ? '請先選擇車型' : '選擇或輸入年份'` | **不變** ✅ |
| `:170` | 「清除」鈕字面 | **不變** —— 🔴 spec §4-2:草稿制的「清除」= 只清草稿,**不可**被統一文案改成清已套用車輛 |

### 2.4 `components/GarageChips.tsx` — 升為唯一 chips 元件

| 行 | 現況 | 改成 |
|---|---|---|
| `:94-97` | sheet 變體才有 `我的愛車` + `點一下直接套用` | 🔴 **推廣到四個掛載點**(A 表:副註「點一下直接套用」四處都要) |
| `:111` | toggle 版只有 `我的愛車`、無副註 | 加副註(桌機 toggle 展開後的面板頂) |
| `:148` | `無法對應「{query}」到車款字典,請用上方車款選單選擇` | `無法對應「{query}」到車款字典,請改用車款選單選擇`(A 表定版,三版收一版) |
| `:121/:137` | `className="cat-garage-chip"` | **不變** ✅ —— 這就是升為唯一 class 家族的那一個 |

### 2.5 `components/VehicleFinder.tsx` — 首頁(字面 + 行為,行為見 §3)

| 行 | 現況 | 改成 |
|---|---|---|
| `:77` | `精準匹配車款、年份、引擎代號` | 🔴 `選廠牌即可搜尋,選到車型、年份更精準`(A 表:「引擎代號」不存在於選車輸入 = 超賣) |
| `:79-93` | 自刻 `.ed-finder-garage` + `.ed-finder-garage-chip` chips | 換 `GarageChips`(見 §4) |
| `:94-125` | 自刻建議清單 `.ed-finder-suggest` | 隨 chips 一起收進 `GarageChips` |
| `:121` | `無法對應「{query}」到車款字典,請從下方選單選擇` | 隨上一條退場(改由 `GarageChips` 出 A 表定版) |
| `:75` | `輸入你的車輛` + `:74` `01 ·` | **不變**(容器規則);⚠️ 編號撞號是 **D 段**的事,見 §8 |

### 2.6 `components/ProductFitmentCheck.tsx` — PDP §7

| 行 | 現況 | 改成 |
|---|---|---|
| `:231-240` | 自刻 `.pfc-garage` chips(`我的愛車` + 直接 map) | 換 `GarageChips` 行內密度(設計稿 C4 After) |
| `:241-257` | 自刻建議清單 | 隨上收進 `GarageChips` |
| `:254` | `無法對應此車款,請用下方選單選擇` | 隨上退場 |
| `:198-219` | 四態判定文案(`適用你的…` / `未列於適用清單` / `但有年份限制` / `已記下你的車款`) | 🔴 **逐字不動**(§7 正確性紅線:錯誤 ✓ 比空白更糟) |
| `:222` | `更改車款` | **不變** |
| `:229` | `先前的車款連結已失效,請重新選擇你的車。` | **不變**(三態文案都要留,spec §4-5) |
| `:260` | `選擇車款,確認是否適用` | **不變**(手機收合入口 CTA、容器規則) |

### 2.7 `components/CartVehicleField.tsx` — 購物車

| 行 | 現況 | 改成 |
|---|---|---|
| `:144-153` | 自刻 `.cvf-garage` chips | 換 `GarageChips` 行內密度(設計稿 C5) |
| `:154-173` | 自刻建議清單 + 「以自由輸入記下」出口 | 🔴 **建議清單換 `GarageChips`,但「以自由輸入記下」那顆留在 CartVehicleField** —— 它是購物車專屬的零命中出口,`GarageChips` 沒有這個概念 |
| `:129` `:136` `:138-140` `:199` `:210` | `給哪台車用…` / `可能不適用…` / `更改` `清除` / `找不到?直接輸入車款(例:2017 R6)` / `+ 選擇車款` | **全部不變**(設計稿 C5 逐字:購物車語境專屬、保留) |

### 2.8 `components/account/InlineVehicleForm.tsx` — 帳號表單

| 行 | 現況 | 改成 |
|---|---|---|
| `:170` | `<span>品牌</span>` | `<span>廠牌</span>` |
| `:172` | `label="選擇品牌"` | `label="選擇廠牌"` |
| `:175` | `placeholder="YAMAHA"` | `placeholder="選擇或輸入廠牌"`(A 表)⚠️ 現況是範例值不是提示 |
| `:188` | `<span>車型</span>` | **不變** ✅ |
| `:189` | `label="選擇車型"` | **不變** ✅ |
| `:194` | `placeholder="YZF-R6"` | `placeholder="選擇或輸入車型"` |
| `:117` | `請選擇品牌與車型,或改用自行輸入` | `請選擇廠牌與車型,或改用自行輸入` |
| `:211` | `清單裡找不到你的車?改用自行輸入` | **不變** |

### 2.9 `components/FilterDrawerVehicleTab.tsx` — ⚠️ 邊界情況,先確認再動

| 行 | 現況 |
|---|---|
| `:122` | `<div className="fd-step-label">選擇品牌</div>` |
| `:130` | `查無符合的品牌,請調整關鍵字` |
| `:117` `:146` `:179` | `查無符合的車款/車型/年份,請調整關鍵字` |

這支是 **ADR-0007 之前**手機「篩選抽屜裡的車輛 tab」。`ProductsMobileControls.tsx:5-9` 檔頭寫明手機選車已改走
`MobileVehicleSheet`,但 `FilterDrawerVehicleTab` 仍存在且有測試。
→ **本計畫的作法:一起改字面**(廠牌 / 統一 emptyHint),**不改行為、不刪檔**。
理由:它若還被渲染,不改就是漏一個入口;若已不被渲染,改字面零風險。
⚠️ 開工第一件事:`grep -rn "FilterDrawerVehicleTab" apps/storefront/src` 確認實際掛載點,結果寫進 commit body。

### 2.10 明確**不改**的檔案

`app/dev-preview/mobile-catalog-ux/*`(`VehiclePickerFields.tsx` `DesktopVehiclePicker.tsx` `MobileCatalogUxPreview.tsx` 及其測試)
—— 它們**看起來**該改(裡面就有「選擇或輸入廠牌」),但那是 **ADR-0007 拍板當時 Sean 看過的核准預覽**,
是決策的歷史證物。改了等於竄改被核准的東西。dev-preview 整族本來就要在 M-6 前移除(backlog #147)。

---

## 3 · 兩個行為變更(唯二動到行為的點)

### 3.1 Q3=A · 桌機「清除車輛」連坐分類

- **現況**:`CascadeFilterTop.tsx:125` → `onClick={() => dispatch(clearVehicle())}` 只清車。
- **目標**:對齊手機 `ProductsMobileControls.tsx:83-87` 的 `clearVehicleAndCategory`,改為 `clearVehicle()` + `clearCategory()`。
- **實作**:`CascadeFilterTop.tsx:25-30` 的 import 加 `clearCategory`(實查已由 `@pcm/ui` 匯出:`packages/ui/src/filters/cascadeFilterReducer.ts:153`)。
- **鈕字面不變**(設計稿 C1:「清除車輛」照舊)。
- 🔴 **改的是既有桌機行為** → 實作 slice 必須重跑目錄回歸,含 `ActiveChips` 膠囊狀態(spec §3 逐字)。
- 🔴 **不可順手把 `CascadeFilterTop.tsx:92` 那個 `onClear={() => dispatch(clearVehicle())}` 一起改** ——
  那是**廠牌欄 combobox 清空**,屬「輸入操作」不是「清除車輛」(設計稿 §D callout 明列:combobox 單欄「×」不在清除矩陣裡)。

### 3.2 Q4=A · 首頁送出門檻放寬到「選廠牌即可搜」

- **現況**(`VehicleFinder.tsx:50`):
  `const ready = !!brandObj && !!modelObj && (modelHasYears ? vehicle?.year != null : true);`
- **目標**:`const ready = !!brandObj;`
- **連動 1 —— push 段數**(`VehicleFinder.tsx:143-159`):
  現況 `if (!brandObj || !modelObj) return;` + `const parts = [brandObj.id, modelObj.id];`
  → 改成 `if (!brandObj) return;` + `const parts = [brandObj.id]; if (modelObj) { parts.push(modelObj.id); if (vehicle?.year != null) parts.push(String(vehicle.year)); }`
  🔴 **年份只有在有 model 時才能 push** —— `?vehicle=brandId:year` 是不存在的格式,
  `parseVehicleFromUrl` 會把第二段當 modelId 解析。
- **連動 2 —— 鏡寫**(`VehicleFinder.tsx:149-156`):`modelId` / `modelName` / `year` 全部改成條件帶入。
  參考已經寫對的那一份:`products-url-state.tsx:366-375` 用 `modelObj?.id` /
  `modelObj != null && vehicle.year != null ? vehicle.year : undefined`。**照抄它,不要自己想**。
- **server/URL 端零改動**:brand-only 早已支援 —— `products/page.tsx:57-59` 逐字記載
  「品牌-only 車輛選擇由 client 同步寫短版 `?vehicle=brandId`(單段)」,`MobileVehicleSheet.tsx:100-106` 也已實測。
- **年份欄同步標「可不選」**(§2.1 的 `slotLabel`)。

---

## 4 · GarageChips 收斂(§2 條 6:4 份 JSX → 1 份)

`vehicle-picker-spec.md` §4-1 明列這是最大的一顆地雷:

> GarageChips 吃 `dispatch<CascadeFilterAction>`(`GarageChips.tsx:47`),
> 首頁 VehicleFinder 是 local `useState`(`VehicleFinder.tsx:38`)。**不是 drop-in,別直接換了就跑。**

實查後,四個掛載點的套用出口各不相同:

| 掛載點 | 套用時要做的事 |
|---|---|
| 目錄桌機/手機 | `dispatch(selectVehicleBrand/Model/Year)` 三連發 ← 現行 `GarageChips` 就是這個 |
| 首頁 VehicleFinder | `setVehicle({brand, model, year})`(local state) |
| PDP §7 | `commit({brandName, modelName, year})` → 寫鏡 + 寫 URL |
| 購物車 | `commitDict(brand, model, year, 'garage')` → `onChange` CartItem |

**做法(推薦)**:給 `GarageChips` 加一個**互斥的** `onApply?: (a: GarageChipApply) => void` prop:

- 有 `onApply` → 呼叫它,**不 dispatch**;`dispatch` 改成 optional。
- 無 `onApply` → 維持現行 dispatch 三連發(目錄兩處零改動)。
- `onApplied?.()`(關面板)保持現狀。

> 為什麼不做成「兩個元件」或「dispatch 轉接器」:轉接器要在首頁憑空造一個 cascade reducer 只為了把
> action 再翻譯回 `setVehicle`,那是為了讓介面好看而多養一層。一個 optional 回呼就夠。
> `resolveGarageChip` / `resolveSuggestionLabel` 的決策腦與年份閘門**完全不動**(spec §1c:不得複製第二份)。

**CSS**:`.ed-finder-garage-chip` 家族(`styles/home.css:697-740`)退場、併進 `.cat-garage-chip`
(`styles/filter-cascade.css:251` 起)。設計稿 §B 逐字:「深色底時同形換色票」。
⚠️ `home.css:726-740` 有一段 ≤900px 的橫向捲動修正(Sean 07-15 真機回報「我的愛車會被推到下一行」爆版),
**這個行為要跟著搬到新 class,不能弄丟**。

---

## 5 · 導覽小修(Sean 2026-08-03 拍 B 案「同落地 + 開燈」)

### 5.1 Header「依車輛搜尋」

- **現況**:`Header.tsx:98` → `{ id: 'vehicle', label: '依車輛搜尋', href: '/#vehicle-finder' }` —— **全站寫死錨點**。
- **目標**:首頁維持 `/#vehicle-finder`,其他頁改連 `/products?pick=vehicle`。
- **實作**:`Header` 已經收 `currentPage`(`Header.tsx:44`,預設 `'products'`)。改成
  `href: currentPage === 'home' ? '/#vehicle-finder' : '/products?pick=vehicle'`。
  `navItems` 目前是 render 內的常數陣列,直接讀 `currentPage` 即可,**不需要 `useMemo`**。
- **實查掛載點**:13 處,只有 `app/page.tsx:94` 是 `currentPage="home"`;
  其餘 `catalog`/`cart`/`checkout`/`account`/`login`/`register`/`legal`/`shipping`/`error` 全部落到 `?pick=vehicle`。
  ⚠️ `Header.test.tsx:86` 渲染 `<Header isMobile={false} />` **不帶 `currentPage`** → 吃預設 `'products'` → 會走 `?pick=vehicle`。

### 5.2 MobileTabBar「找車」解除停用

- **現況**:`MobileTabBar.tsx:60-74` → `href: '#'` + `disabled: true` + `matches: () => false`;
  render 端 `:112-125` 把 disabled 的畫成 `<span aria-disabled="true" aria-label="找車(尚未開放)">`。
- **目標**:`href: '/products?pick=vehicle'`,拿掉 `disabled: true`。**不必新路由**(backlog #195 因此結案)。
- 🔴 **`matches` 維持 `() => false`,不要改成「?pick=vehicle 時亮起」**:
  `MobileTabBar` 掛在 `app/layout.tsx:106`(root layout),要判斷 query 就得用 `useSearchParams()`;
  在 root layout 的 client 元件裡用它、又沒有 `Suspense` 邊界,會讓**全站每一頁**掉進 client-side rendering bailout。
  代價遠大於「找車 tab 會不會反白」。
  → 副作用:在 `/products?pick=vehicle` 上,亮的是「商品」tab(`matches` 收 `p.startsWith('/products')`)。可接受。
- backlog #195 的「依賴:Sean 拍板『找車』是 hash anchor 還是獨立路由」由 08-03 B 案回答 → 該條可標結案。

### 5.3 `?pick=vehicle` 的落地行為(這是本段唯一的**新**功能)

| 裝置 | 行為 |
|---|---|
| 桌機 | 捲到 `CascadeFilterTop` 並**聚焦廠牌欄** |
| 手機 | 自動開 `MobileVehicleSheet` |

實作面(三處,依賴鏈由上而下):

1. **`ProductsPage.tsx`** 已有 `const searchParams = useSearchParams()`(`:195`)。
   加 `const pickVehicle = searchParams.get('pick') === 'vehicle'`。
2. **手機**:傳 `openVehicleOnMount={pickVehicle}` 給 `ProductsMobileControls`;
   它的 `panel` state(`:59`)改成 `useState<Panel>(pickVehicle ? 'vehicle' : null)`(**initializer,不是 effect** ——
   effect 會在客人已經關掉面板後又把它打開;參考 `MobileVehicleSheet.tsx:72-75` 已經因為同一個理由選了 initializer)。
3. **桌機**:`CascadeFilterTop` 收 `autoFocusBrand?: boolean`,往下傳給廠牌 `VehicleCombo`;
   `VehicleCombo` 現在**沒有 `autoFocus` 也沒有 ref 出口**(`VehicleSelect.tsx:14-35` 的 `ComboProps`)→ 需加一個 optional `autoFocus?: boolean` 綁到 `<input autoFocus>`。
   捲動:`autoFocus` 本身就會把元素捲進視野,**不必自己寫 `scrollIntoView`**。
   ⚠️ 桌機與手機同時掛載(靠 CSS 各自隱藏),所以 `autoFocus` 與「自動開面板」會**同時發生**。
   `.cft-bar` 在 ≤1024px 是 `display:none` → 隱藏元素的 `autoFocus` 不會生效,實務上沒事;
   但這是**假設**,必須在真機兩個斷點各驗一次(§7 驗收)。
4. **`?pick=vehicle` 不進 cascade 狀態機**:它不是篩選條件,`useDeepLinkRestore`(`products-url-state.tsx:403-438`)
   與 `useCatalogFilterUrlSync` 都**不要**認識它。
   🔴 但 `useCatalogFilterUrlSync` 用 `new URLSearchParams(window.location.search)` 原樣拷貝、
   只改寫 pbrand/category/price/pmin/pmax 五軸(`:270-274` 的紅字前提),
   所以 `pick` 會**留在網址上**。可接受(語意 = 「這次進站要開燈」),
   若要開完就清,得再 `router.replace` 一次 —— **本計畫不做**,多一次導覽換一個沒人看的乾淨網址不划算。

---

## 6 · 被字面鎖住、必須同 commit 改的測試(逐檔逐行)

| 測試檔 | 行 | 鎖住的字面 | 對應改動 |
|---|---|---|---|
| `components/CascadeFilterTop.test.tsx` | 44, 84, 131, 155 | `搜尋或選擇廠牌` | §2.2 |
| | 48 | `搜尋或選擇車型` | §2.2 |
| | 86, 122, 138 | `搜尋或選擇車型，例:R6` | §2.2 |
| | 87, 99 | `搜尋或選擇年份` | §2.2 |
| | 141 | `查無符合的車款，請調整關鍵字` | 字面不變,但廠牌欄新增 emptyHint 可能改變 DOM 內查詢數 → 需重跑確認 |
| | 64, 73, 133 | `清除車輛` | §3.1(字面不變、**行為變**)→ 需**新增**一條「清除車輛同時清掉分類」的斷言 |
| `components/VehicleSelect.test.tsx` | 56, 66, 78, 95, 108, 126, 143 | `combo('選擇品牌')` ×7 | §2.1 → 全部改 `選擇廠牌` |
| | 134 | `不限年份` | 不變 |
| `components/VehicleFinder.test.tsx` | 58, 69, 85, 125, 135, 140, 154, 170, 179 | `選擇品牌` ×9 | §2.1 |
| | 71 | `combo('選擇年份').placeholder === '不限年份'` | 不變 |
| | 114 | `queryByText('我的愛車')` 為 null(未登入) | §4 換 `GarageChips` 後 DOM 結構變,語意需維持 |
| | — | **無 brand-only 送出的測試** | 🔴 §3.2 必須**新增**:選了廠牌就 `ready`、push `?vehicle=<brandId>` 單段、鏡不帶 modelId |
| `components/ProductFitmentCheck.test.tsx` | 66, 111 | `combobox name '選擇品牌'` | §2.1 |
| `components/CartVehicleField.test.tsx` | 45, 52 | `選擇品牌` | §2.1 |
| `components/account/InlineVehicleForm.test.tsx` | 58, 68, 73, 75, 99, 114, 135, 141, 154 | `選擇品牌` ×9 | §2.1 / §2.8 |
| | 82 | `/請選擇品牌與車型/` | §2.8 → `請選擇廠牌與車型` |
| `components/MobileVehicleSheet.test.tsx` | 104, 119, 121 | `我的愛車` | §2.4 加副註後 `getByText('我的愛車')` 仍成立,需確認 |
| | 160, 171 | `清除車輛輸入欄位` | 不變(草稿制) |
| | 245, 251 | `不限年份` | 不變 |
| | 277 | `查無符合的車款，請調整關鍵字` | 不變 |
| `components/GarageChips.test.tsx` | 36, 49, 63, 82, 100, 123 | `我的愛車` ×6 | §2.4;另需**新增** `onApply` 回呼 variant 的測試 |
| `components/FilterDrawerVehicleTab.test.tsx` | 70 | `查無符合的車款,請調整關鍵字`(**半形逗號**) | §2.9 → §10 |
| `components/Header.test.tsx` | 94-101 | `expect(actual).toEqual([...])` 完整 nav 對照表,含 `['依車輛搜尋', '/#vehicle-finder']` | 🔴 §5.1 → 該筆改 `/products?pick=vehicle`(因為測試不帶 `currentPage`),**並新增**一條 `currentPage="home"` 仍為錨點的案例 |
| `components/MobileTabBar.test.tsx` | 70-75 | 「找車 tab disabled(`<span aria-disabled="true">`)」+ `aria-label === '找車(尚未開放)'` | 🔴 §5.2 → 整條改寫成「找車 tab 連 `/products?pick=vehicle`、非 disabled」 |
| `components/ProductsMobileControls.test.tsx` | 258-259 | 「清除車輛」回全部商品並清分類 | 不變(手機本來就是目標行為);可當 §3.1 桌機新斷言的範本 |
| `app/dev-preview/mobile-catalog-ux/*.test.tsx` | — | 預覽字面 | 🔴 **不改**(§2.10) |

**不會被碰到的守門**(確認過,列出來是為了不被誤改):
`components/ProductsPage.test.tsx:125`(手機入口不在 `.cft-bar` 內)、`styles/products-mobile.test.ts`(15 條斷點守門)
—— A 段不動容器與斷點,這兩支必須**保持全綠且不修改**。任一支需要改,就代表動到了 spec §1a 的「絕不碰」,**停下回報**。

---

## 7 · 風險與 rollback

| # | 風險 | 為什麼會發生 | 對策 | rollback |
|---|---|---|---|---|
| R1 | **改 `VehicleSelect.tsx` 一顆,炸到四個掛載點** | 它是首頁 / PDP / 購物車 / 帳號共用的核心殼(`:193-261`) | 這正是「統一」的目的;但 commit 必須把四個掛載點的測試一起跑,**不能只跑改到的那支**(memory `feedback_run-full-vitest-after-shared-component-change`) | 單片 revert |
| R2 | **`GarageChips` 加 `onApply` 把目錄兩處弄壞** | dispatch 變 optional | `onApply` 與 `dispatch` **互斥**、無 `onApply` 時行為逐字不變;新增測試同時覆蓋兩條路徑 | 單片 revert |
| R3 | **brand-only push 產生 `?vehicle=brandId:year`** | §3.2 若只改 `ready` 沒改 push | 照抄 `products-url-state.tsx:366-375` 的條件帶入;測試斷言 URL **整串字面** | — |
| R4 | **鏡的第四個寫入點被「順手」加進來** | 改 `VehicleFinder` 時很想在別處也寫一次鏡 | spec §4-8 逐字:**禁止**。V-2c R2 已經修過一次「換車不寫鏡 → PDP 顯舊車」,再加一處 = 重新引入雙寫競態 | — |
| R5 | **草稿制「清除」被統一文案改成清已套用車** | §2.3 `MobileVehicleSheet.tsx:170` 與 §3.1 的「清除車輛」字面接近 | spec §4-2 + 設計稿 §D 清除矩陣三列各守各的;測試 `清除車輛輸入欄位` 的 aria-label 不動即是守門 | — |
| R6 | **無年份車型出口被字面統一堵死** | 37/94 車型 fitment 缺年份,「不限年份」可直接送出、不 dispatch year | spec §4-3:首頁/桌機/手機三處都有這條路;三支測試(`VehicleFinder.test:64`、`MobileVehicleSheet.test:245`、`VehicleSelect.test:124`)是守門 | — |
| R7 | **跨層直搜比對邏輯被動到** | 換文案時順手改 `modelFieldOptions` | spec §4-7:桌機與手機共用 `lib/vehicle-options` 同一顆,**只換文案、不動比對** | — |
| R8 | **`autoFocus` 在手機也生效 → 鍵盤彈出 + 面板同時開** | §5.3 的桌機/手機同時掛載 | `.cft-bar` 在 ≤1024px `display:none`(`styles/products-mobile.test.ts` 鎖住)→ 理論上不生效。**這是假設,必須真機兩斷點各驗一次** | 拿掉 `autoFocus`,改成純捲動 |
| R9 | **`?pick=vehicle` 被 URL 狀態機吃掉或引發重查** | `products-url-state.tsx` 三個 hook 都在改寫 query | §5.3-4:`pick` 不進任何 parser;`useCatalogFilterUrlSync` 只改寫五軸(`:270-274` 前提)→ `pick` 原樣留著。**實作前重讀那段紅字註解** | 拿掉 `?pick=`,tab 退回 `#vehicle-finder` |
| R10 | **PDP §7 四態判定文案被誤改** | 換 chips 殼時整段重寫 | §2.6 紅線:只換 chips 區,`:196-223` 的判定分支逐字不動;`ProductFitmentCheck.test.tsx` 是守門 | — |

### 片型與鐵則

- **不命中鐵則 12 任一類**:無錢 / 無權限 / 無 schema / 無 `next.config`·`vercel.json`·CI / 無對外寄送;
  `GarageChips` 與 `VehicleSelect` 在 `apps/storefront/src/components/`,**不是 `packages/ui/`** → 第 ⑥ 類不觸發。
  → codex 對抗審查非強制;`code-reviewer` subagent 必跑(標準片)。
- **命中鐵則 8**:跨 3+ 檔 + 動共用元件(`VehicleSelect` / `GarageChips`)→ **本檔即為 plan,等 Sean 批**。
- **鐵則 5**:`GarageChips.tsx` + `filter-cascade.css` + `home.css` 的 chips 收斂算同一片,不拆。
- **鐵則 4**:切片見 §9。

### 三綠與驗收

- 每片 `/slice-checkpoint`(typecheck + lint + build)。
- **動共用元件 → 跑完整 `pnpm test`**,不是只跑改到的那支。
- `agent-browser` CLI 真機驗:**桌機 1440 + 手機 390 兩斷點**,`?pick=vehicle` 兩種落地各驗一次,
  **互動必用 production build**(memory `reference_pcm-mobile-device-verify-dev-vs-prod`)。
- **不 push**。

---

## 8 · 與 D 段(首頁 + 品牌頁接線)的交集與先後順序

完整交集表與定序在 **`docs/specs/2026-08-03-storefront-home-brand-page-wire-plan.md` §8**(權威版,不在此重複)。

A 段這一側需要記住的三件事:

1. **A 段拆兩批,中間夾著 D 段的品牌線**:
   - **A-nav**(§5,Header + MobileTabBar + `?pick=vehicle`)排在**最前面** —— 它與 D 幾乎零交集。
   - **A-engine**(§2 §3 §4,選車器內臟)必須排在 **D5 首頁重排之前**。
     理由:A 改 `VehicleFinder.tsx` 的判斷邏輯,D 改它的外殼與定位。先殼後內臟 = 在剛搬過家的檔案上改邏輯,
     兩次都要重讀同一段,而且會讓「三個鏡寫入點有沒有被弄掉」在 diff 裡更難看出來。
2. **`Header.test.tsx:94-101` 那張 nav 對照表兩段都要改** —— A-nav 改「依車輛搜尋」那一列,
   D4 改「品牌」那一列與 `/brands` 的否定斷言。後做的那一片開工前先 `git log -1` 確認 HEAD 是自己那筆。
3. **`styles/home.css`(777 行)兩段都會動** —— A 讓 `.ed-finder-garage*` / `.ed-finder-suggest*`(L697-740)退場,
   D 做整頁重排。A 先做,D 開工時 `.ed-finder-*` 家族已經瘦下來,重排的對象比較單純。

> 首頁 finder 的**編號撞號**(Hero `N°01` vs finder `01 ·`,brief 問題 6)是 **D 段**的事,A 段不碰
> —— 它是版面編號不是選車引擎。

---

## 9 · 切片建議(鐵則 4:每片 15-45 分鐘)

| 片 | 內容 | 檔案 | 依賴 |
|---|---|---|---|
| A1 | Header 條件 href + MobileTabBar 解除停用 + 兩支測試改寫 | `Header.tsx` `MobileTabBar.tsx` + 2 test | — |
| A2 | `?pick=vehicle` 落地開燈(桌機 autoFocus / 手機開面板) | `ProductsPage.tsx` `ProductsMobileControls.tsx` `CascadeFilterTop.tsx` `VehicleSelect.tsx`(加 `autoFocus` prop) | A1 |
| A3 | `VehicleSelect.tsx` 字面統一(廠牌 / 選擇或輸入 / 可不選) + 4 支測試 | `VehicleSelect.tsx` + `VehicleSelect/VehicleFinder/ProductFitmentCheck/CartVehicleField/InlineVehicleForm` test | — |
| A4 | `CascadeFilterTop` 字面 + 兩個 emptyHint 補齊 + 年份「可不選」 | `CascadeFilterTop.tsx` + test | A3 |
| A5 | `MobileVehicleSheet` + `FilterDrawerVehicleTab` 字面對齊 | 2 檔 + 2 test | A3 |
| A6 | 帳號表單 `InlineVehicleForm` 字面 | 1 檔 + test | A3 |
| A7 | **Q3=A** 桌機清除連坐分類 + 目錄回歸 | `CascadeFilterTop.tsx` + test(新斷言) | A4 |
| A8 | **Q4=A** 首頁門檻放寬(`ready` + push 段數 + 鏡條件帶入) | `VehicleFinder.tsx` + test(新案例) | A3 |
| A9 | `GarageChips` 加 `onApply` variant + CSS 家族收斂 | `GarageChips.tsx` `home.css` `filter-cascade.css` + test | A3 |
| A10 | 四個掛載點換用 `GarageChips`(首頁 / PDP / 購物車) | `VehicleFinder.tsx` `ProductFitmentCheck.tsx` `CartVehicleField.tsx` + 3 test | A9, A8 |

A9/A10 是最重的兩片(共用元件介面 + 四個消費端),若超過 45 分鐘就把 A10 再拆成三片、一片一個掛載點。

---

## 10 · 🔴 停下等 Sean 拍板

> 設計稿 `vehicle-picker-design.html` §E 交接註記逐字:「兩檔對不上時,**先停下來問 Sean,不要自行仲裁**。」
> 這一題正是那種情況。

```
背景:
統一字面時撞到一個逗號的問題。同一句話,正式站的 code 跟設計稿用的是不同的逗號。

正式站現況(實查):
  CascadeFilterTop.tsx:99   選擇或輸入車型，例:R6      ← 全形逗號 ，
  CascadeFilterTop.tsx:100  查無符合的車款，請調整關鍵字  ← 全形逗號 ，
  MobileVehicleSheet.tsx:195 查無符合的車款，請調整關鍵字  ← 全形逗號 ，
  FilterDrawerVehicleTab.tsx:117 查無符合的車款,請調整關鍵字 ← 半形逗號 ,
  (連正式站自己都不一致,兩種都有在用)

設計稿(統一字面總表 A 表)全部用半形逗號:
  查無符合的廠牌,請調整關鍵字
  選擇或輸入車型,例:R6

這不是挑剔:逗號不同 = 字串不同 = 測試 getByText 直接紅,
而且它會決定我要不要動到三支「本來不在改動範圍內」的測試斷言。
鐵則 1 說 design 直接搬不翻譯,照這條就該全站改成半形;
但正式站目前顯示中的、Sean 看過的那些字用的是全形。

Q2:選車器統一後的字面,逗號用哪個?
A) 全形 ，—— 照正式站目前顯示的樣子,把 FilterDrawerVehicleTab 那支半形的改成全形
   好:客人看到的字面零變化;要改的測試最少(只有 FilterDrawerVehicleTab.test.tsx:70 一條)
   壞:設計稿字面沒有被逐字照搬,鐵則 1 開了一個(標點層級的)口

B) 半形 , —— 照設計稿逐字,把全形那幾處改成半形
   好:設計稿 = 真權威,一字不差
   壞:客人看到的中文標點會變窄;要改的測試多三條
      (CascadeFilterTop.test.tsx:86/122/138/141、MobileVehicleSheet.test.tsx:277)

A: A | B
```

⚠️ **另外**:D 段計畫 §9 的 Q1(design 真權威住 Open Design 還是 submodule)**同樣是 A 段的開工前提** ——
A 段的字面權威 `vehicle-picker-design.html` 也在 Open Design,不在 submodule。Q1 拍板前兩段都不開工。

---

## 11 · 相關既有紀錄與連動面(規劃前偵察 pass)

| 命中 | 內容 | 影響 |
|---|---|---|
| backlog **#195** | `/vehicle-search` 路由建立(MobileTabBar 找車 disabled 解除);**依賴 = Sean 拍板 hash anchor 還是獨立路由** | 08-03 B 案回答了 → §5.2 落地後可標結案(且**不需要新路由**,比 backlog 預估的省) |
| backlog **#200** | 「我的愛車」車款 → products filter 快速帶入,綁 Phase 2 | §4 的 `GarageChips` 收斂讓這條的實作面變小,但**不在本段範圍** |
| backlog **#287 / #288** | `?pbrand=` 重複 key 與 Next segment 碰撞、E2E 守門未建 | §5.3-4 的紅線:`?pick=` 絕不進 `products-url-state.tsx` 的改寫路徑 |
| ADR-0007 | 手機選車面板草稿制、三個獨立入口 | §1a 的容器規則來源;§2.3 / R5 的守門依據 |
| memory `feedback_run-full-vitest-after-shared-component-change` | 動共用元件跑完整 `pnpm test` | §7 R1 |
| memory `reference_agent-browser-cli-real-browser-verify` | 動前台 TSX/CSS 收工前必真瀏覽器驗、viewport 390×844 | §7 驗收 |
| memory `feedback_visual-verification-is-sean-only` | 「肉眼驗✅」是 Sean 專屬用詞 | 本計畫任何驗收都只寫「程式驗」 |

---

## 12 · 開工前逐條自檢

- ☐ Sean 已回答 §10 Q2(逗號)與 D 計畫 §9 Q1(design 真權威)
- ☐ 行號全部重新 grep(本檔行號 = 2026-08-03 快照,D 段若先動過 `VehicleFinder.tsx` 即作廢)
- ☐ `grep -rn "FilterDrawerVehicleTab"` 確認實際掛載點(§2.9)
- ☐ spec §4 十條實作地雷逐條讀過(不是掃過)
- ☐ 每片標 L1(字面統一 = L1,年 0-1 次)與片型(標準片)
- ☐ `ProductsPage.test.tsx` 與 `styles/products-mobile.test.ts` 保持全綠**且未被修改**(§6)
- ☐ 動共用元件 → 完整 `pnpm test`,不是只跑改到的那支
- ☐ 真機 1440 + 390 兩斷點、production build
- ☐ 精準 `git add`、不 push、不動 `STATUS.md` 與 `CURRENT.md`
