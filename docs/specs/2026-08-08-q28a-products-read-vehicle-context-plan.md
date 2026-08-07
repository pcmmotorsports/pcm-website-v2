# Q28① `/products` 在 URL 無車時吃 vehicle-context · plan

> **狀態:未批准。** 鐵則 8 級(動全站選車的入站來源)⇒ 主視窗初核 → **Sean 晨間批次等批**,批了才動工。
> 規格來源:memory `project_site-redesign-content-pages-decisions.md:105` ①
> (⚠️ **不是** `D-218-A` —— 該檔零提 Q28,已於 `D-221-A` ② 雙方確認)。
> 偵察結果沿用 `2026-08-08-pdp-year-and-clear-vehicle-plan.md` §4 + 本檔 §2 補充。

---

## §1 片型與分級

| 項 | 判定 |
|---|---|
| 片型 | **標準片**,但**從嚴辦理**(動全站選車的入站來源、跨檔因果)|
| 內容分級 | L1 |
| 鐵則 8 | ✅ **命中**(動全站真相來源 + 跨 3 檔因果)⇒ 本檔即 plan,等批 |
| 鐵則 12 | ❌ **未命中**。⚠️ 前一份 plan 一度誤記為 12⑥,已更正:⑥ 字面限定「共用元件 **`packages/ui`**」,而本片動的 `products-url-state.tsx` 在 `apps/storefront/src/components/`(`D-221-A` ①-1)|
| codex | 恢復後補審清單照列 |

## §2 現況實查(全部主對話親自開檔)

### 2-1 病因不是 memory 寫的那個

memory `:105` ① 逐字:「現況=商品頁選車**沒有寫回**全站選車 context」——**與 code 不符**:
`ProductFitmentCheck.tsx:170` 的 `commit()` **有** `writeVehicleContext(...)`。
⚠️ 該行號在前一片(`01919296`)之後才是 `:170`;更早的 STOP/plan 引的 `:165` 是**被我自己那片推移前**的值。

**真正的機制**:寫了,但 `/products` **不讀**。

### 2-2 三條既有事實(決定本片形狀)

| # | 事實 | 位置 |
|---|---|---|
| A | `/products` 的車輛只從 **URL** 入站還原,mount-only、URL 什麼都沒有就**直接早退** | `products-url-state.tsx:414-417`(`useDeepLinkRestore`)|
| B | 鏡的定位是「**鏡恆跟隨 URL 真相**」——寫 URL 的同一時機單點寫鏡 | `:362-375`(`useVehicleUrlSync`)|
| C | 🔴 **鏡在「逛進 /products」時刻意不被清掉** —— 逐字「mount 無車(ref 仍 null)不清:直接逛 `/products` **不得洗掉首頁/他頁寫的鏡**(URL 無車≠使用者清車)」 | `:376-379` |

⇒ **C 是關鍵**:鏡子一直是活的、而且既有設計**已經刻意為這個情境保留了它**。
本片缺的只是「把它讀進來」這一步,**不需要動 `useVehicleUrlSync` 的還原窗口守衛**
(那是前一份 plan §4-3 的估計,**實查後下修**:守衛管的是「URL 有車但 dispatch 未 flush」,
與「URL 無車、改讀鏡」是不同分支)。

## §3 要改什麼

**單點**:`useDeepLinkRestore`(`products-url-state.tsx:403-438`)。

現行 `:414` `const v = parseVehicleFromUrl(...)`;`:417` 三者皆空即早退。
改成:**URL 沒有車時,才回退讀鏡**,並且鏡要**對 taxonomy 驗過**才採用。

```
const v = parseVehicleFromUrl(searchParams, motoBrands)
        ?? vehicleFromContext(motoBrands);   // 🔴 只有 URL 無車時才走這條
```

`vehicleFromContext` 新增於 `lib/vehicle-url.ts`(與 `parseVehicleFromUrl` 同檔、同一套 taxonomy 驗證):
讀 `readVehicleContext()` → `brandName`/`modelName` **逐一對照 `motoBrands` 驗存在** → 查無即回 `null`(零猜,對齊既有 fail-safe)。

**為什麼是這裡而不是別處**:它是全站唯一的「入站還原」點、mount-only、
且已經有 `skipPageResetOnce` / `brandAppliedOnce` 兩道 StrictMode 保護,不必另建一套。

## §4 為什麼要做

Sean 逐字:「PDP 適用性檢查選好的車 = **全站狀態,必須同步**」;現況跳回列表不同步。
本片是那句拍板在 `/products` 這一側的實作。

## §5 影響面(這節是本 plan 的重點)

### 5-1 🔴 可見的行為改變:URL 會被改寫

鏡入站後 `vehicle` 非 null ⇒ `useVehicleUrlSync` 會 `router.replace` 把車寫進 URL。
⇒ **逛到 `/products`(無參數)會變成 `/products?vehicle=…`。**

- **好處**:URL 重新成為真相、與架構一致,重整/分享/back 都穩定。
- **要 Sean 知道的**:別人分享一條乾淨的 `/products` 連結給你,你打開會**自動套上你自己 session 裡的車**。
  那是**你自己的**車、不是分享者的(鏡在 sessionStorage、不跨人),但畫面會與分享者看到的不同。
  ⇒ **這是「全站同步」的必然後果,不是 bug**;但它是行為改變,列出來讓 Sean 拍。

### 5-2 時序:PDP 寫鏡 × `/products` 讀鏡,會不會打架

不會。三條路徑逐一推過:
1. **PDP 選車 → 跳列表**:PDP `commit()` 同時寫鏡 + 寫 URL(`onPersistVehicle`)⇒ 跳回去時 URL 有車 ⇒ 走既有 URL 分支,**根本用不到鏡**。
2. **PDP 選車 → 開新分頁到裸 `/products`**:URL 無車 ⇒ 讀鏡 ⇒ 同步。**這正是本片要解的那格。**
3. **PDP 按「清除車輛」→ 逛列表**:上一片已讓清除同時清鏡 + 清 URL ⇒ 鏡是空的 ⇒ **不會把清掉的車復活**。
   🔴 **3 成立的前提是上一片(`01919296`)已 merge** —— 若本片先於它上線,清除會被鏡打回來。**順序不可對調。**

### 5-3 `skipPageResetOnce` 要不要跟著設(**需要拍板的細節**)

現行 `:418` 只要有任一來源就 `skipPageResetOnce.current = true`(避免 `?page=3` 被 mount dispatch 重置)。
鏡入站時 URL 通常**沒有** `page` ⇒ 設不設都看不出差別。但 `/products?page=3`(無車)+ 鏡有車 這格會分岔:

- **設**(與現行一致):停在第 3 頁,但清單內容已被車輛篩選過 ⇒ **可能整頁空的**
- **不設**:回第 1 頁 ⇒ 與「篩選條件變了就回第一頁」的通則一致

**推薦:不設**(鏡入站 = 篩選條件真的變了,與 URL 深連結還原「使用者本來就要看那一頁」語意不同)。
⚠️ 這條**我不自己決定**,列進待批。

### 5-4 陳舊鏡

鏡在 `sessionStorage`,同分頁 session 內有效。客人上週選的車不會殘留(關分頁即失效)。
但**同一 session 內很久以前選的車**會在裸 `/products` 自動套上 —— 屬「全站同步」的預期行為。

### 5-5 不受影響

`useVehicleUrlSync` 的還原窗口守衛、`brandAppliedOnce`、`useBrowseUrlSync`、
`useCatalogFilterUrlSync`、PDP 側全部零改動。

## §6 驗收(每條要有只紅它自己的突變)

1. URL 有車 + 鏡有**不同**的車 ⇒ **URL 勝**(鏡不得覆蓋;突變:把 `??` 順序反過來 ⇒ 只紅這條)
2. URL 無車 + 鏡有車 ⇒ 車被套上、且 URL 被改寫成含 `?vehicle=`
3. URL 無車 + 鏡有車但**車款已不在 taxonomy**(改名/下架)⇒ **忽略、不套**(零猜 fail-safe)
4. URL 無車 + 鏡空 ⇒ 行為與現況**逐字相同**(反向守門:防本片誤傷「乾淨逛列表」)
5. 🔴 **清除後不復活**:PDP 清除車輛(清鏡+清 URL)→ 逛 `/products` ⇒ 車不回來
6. `skipPageResetOnce` 依 §5-3 拍板結果各配一條
7. StrictMode 雙跑不重複 dispatch(沿用既有冪等性,補一條釘住)

⚠️ **真瀏覽器**:§5-1 的「URL 被改寫」與 §6-5 都值得真瀏覽器走一次;
`/products` 在本 worktree 可否渲染要開工時確認,不行就在 STOP 明說只有單元測試。

## §7 Rollback

單一 hook 的單點改動 + 一支新純函式,**`git revert` 即完整回退**,無資料遷移、無 schema、無 env。
若上線後發現 §5-1 的 URL 改寫造成困擾,可只拿掉 `?? vehicleFromContext(...)` 那一段
(其餘零依賴),退回現況。

## §8 待批(三件)

1. **本片是否批准**(鐵則 8)
2. **§5-1 的行為改變** Sean 是否接受(裸 `/products` 會自動套上 session 裡的車、URL 被改寫)
3. **§5-3** `skipPageResetOnce` 設或不設(我推薦不設)

⚠️ **順序硬約束**:本片必須排在 `01919296`(PDP 清除車輛同時清鏡+清 URL)**之後**,理由見 §5-2 第 3 條。
該片已 merge 入 dev(`f7da0c6f`)⇒ 前提已滿足。

— site-redesign 窗,2026-08-08 凌晨
