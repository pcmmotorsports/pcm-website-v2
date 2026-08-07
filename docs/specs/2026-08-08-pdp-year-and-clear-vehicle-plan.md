# PDP 年份欄修活 + Q28 清除車輛 · plan(簡式回核,2026-08-08,site-redesign 窗)

> **狀態:未批准。** 依 `D-220-A` ③ 走簡式回核 —— 主視窗核了才動工。
> 規格來源:Q27 = `D-218-A` 逐字;Q28 = **memory `project_site-redesign-content-pages-decisions.md:105`**
> (⚠️ `D-220-A` 寫「兩題規格以 `D-218-A` 字面為準」,但 **`D-218-A` 內沒有 Q28** —— 見 §4-1)。

---

## §1 片型與分級

| 項 | 判定 |
|---|---|
| 片型 | **標準片**(動 PDP 共用行為;不碰金流/schema/RLS/平台設定)|
| 內容分級 | **L1**(文案字面固定、非後台 CRUD 內容)|
| 鐵則 8(提 plan) | ✅ 本檔即是 |
| 鐵則 12 | Q27 不命中六類;**Q28① 若動 URL 狀態機 ⇒ 命中⑥共用元件行為**(見 §4-2)|
| codex | 主視窗已列補審清單(動 PDP 元件行為)|

## §2 Q27 年份欄修活 —— 規格清楚,但**最小改做不到它的目的**

### 2-1 `D-218-A` 逐字規格

1. `ProductFitmentCheck` 只改顯示條件:`showPicker = kind==='none' || editing || kind==='qualified'`
2. 配套:qualified 時 picker 手機(≤1023px)強制展開(`pfc-picker-open` 同款);qualified 的 picker label 換句
3. **判定邏輯與四態文案一個字不動**(§7 正確性紅線);GarageChips 照舊
4. 樣式:兩塊同時出現要 `margin-top`

### 2-2 🔴 **只做 1. 達不到目的**(開工前實查,這是本 plan 的重點)

現況實查:
- `sel` 初始恆 `null`(`ProductFitmentCheck.tsx:100`),**沒有任何地方從 `chosen` 回填**
- `commit()`(`:158-162`)一被呼叫就 `setSel(null)` + `setPickerOpen(false)`
- 年份欄 disabled 條件 = `!vehicle || vehicle.model == null || modelNoYears`(`VehicleSelect.tsx:418`)

⇒ qualified 時就算讓 picker 顯示,`vehicle={sel}` 仍是 `null`
⇒ **廠牌欄空、車型欄 disabled、年份欄 disabled**
⇒ 客人看到的不是「補年份」,是**重選整台車**。規格 1. 的目的(「留 picker 讓客人補年份」)**沒有達成**。

**⇒ 本片必須加一項規格外的改動(申報)**:qualified 時把 `sel` 從 `chosen` 回填
(`{ brand: chosen.brandName, model: chosen.modelName }`,**不帶 year**——年份正是要客人補的那格)。
只有這樣年份欄才會解鎖。

### 2-3 這片同時讓一段既有死碼第一次可達 —— 必須當新功能測

`onPickYear`(`:247-249`)在現況**不可達**:`sel.model` 只在 `:243` 被設成非空,**下一行 `:244` 就 `commit()`**
把 picker 卸載;唯一回到 picker 的路(`:214` 更改車款)第一件事也是 `setSel(null)`。
⇒ **年份欄從來不曾啟用過**(此結論為本窗先前實查、Fable R2 獨立複核過,已記 manifest)。

**Q27 = 那段死碼的解**。但這代表 `onPickYear` 這條路徑**上線即首次被客人走到**,
不能當「既有行為」對待 —— 驗收要把它當新功能測(見 §5)。

### 2-4 要改的檔

| 檔 | 改什麼 |
|---|---|
| `ProductFitmentCheck.tsx` | showPicker 條件、qualified 時回填 `sel`、qualified 的 picker label、手機強制展開 |
| `product-page.css` | 兩塊同時出現的 `margin-top`(以現站為準,OD 那條僅參考)|
| `ProductFitmentCheck.test.tsx` | 新增守門(見 §5)|

⚠️ **不動**:`checkFitment` 判定邏輯、四態文案、`GarageChips`、`commit()` 的既有語意。

## §3 Q28② 「更改車款」→「清除車輛」

memory `:105` 逐字:
> PDP 結果框「更改車款」**改成「清除車輛」**——文字+行為都改:點=清除全站車輛狀態
> (現況=`setSel(null)` 重選,沒選完離開則舊車跟著跑=Sean 逐字「很不方便」)

### 🔴 3-1 **這條的指令本身標著「未完」,我不打算猜**

同一條 memory 的**最後一句逐字**:

> ⚠️ Sean 第 2 點斷句未完,待補。

⇒ **Q28② 的規格在落檔當下就被記錄為不完整。** 照著做等於替 Sean 補完他沒講完的話。

**具體不確定的是**:「清除車輛」按下去之後,**畫面要變成什麼**?
- (a) 回到「現選入口」(picker 展開、可立刻選新車)= 比較接近現況「更改車款」的體感
- (b) 完全清空、回到未選車的初始態(連 picker 都收合)= 比較接近「清除」的字面
- (c) 清除並跳回列表

三者對客人的體感差很多,而 memory 只記到「點=清除全站車輛狀態」。
**⇒ 請主視窗代問 Sean,或確認 memory 那句「待補」已經補過而我沒讀到。**

## §4 Q28① 「PDP 選車寫回全站」—— 🔴 memory 記的病因與 code 不符

### 4-1 規格出處與 `D-220-A` 的字面出入

`D-220-A` ③ 寫「兩題規格以 `D-218-A` 字面為準」,但 **`D-218-A` 全文沒有提到 Q28**
(實查:`grep -n 'Q28' D-218-A.md` 零命中)。Q28 的權威字面在 memory `:105`。
**⇒ 不是照 `D-218-A`,而是照 memory。** 此處先申報,免得後面引錯來源。

### 4-2 🔴 memory 說「商品頁選車沒有寫回全站 context」= **與 code 不符**

實查:
- `ProductFitmentCheck.tsx:165` **有** `writeVehicleContext({...})`(`commit()` 內)
- ⇒ **PDP 選車確實有寫回 context**,memory 那句病因不成立

**Sean 看到的現象(跳回列表/切商品不同步)是真的,但機制不是「沒寫」,是「沒人讀」**:
- `/products` 的車輛狀態**只從 URL 初始化**(`products-url-state.tsx` → `parseVehicleFromUrl`)
- `vehicle-context` 在該檔的定位逐字是「**鏡恆跟隨 URL 真相**」(`:325`)—— 它是鏡子,不是來源
- ⇒ 從 PDP 跳回**沒有車輛參數**的 `/products`,清單當然不反映 PDP 的選擇

### 4-3 這改變了修法的體積與風險

「讓 PDP 寫回 context」= **已經做到了,零工作量**。
真正要做的是「**讓 `/products` 在 URL 無車時吃 context**」—— 那要動 `useVehicleUrlSync`/還原流程,
而那支 hook 裡有**還原窗口守衛**(`:334-340` 註解逐字:「mount 時 dispatch 尚未 flush…若 URL 帶可解析的
車輛參數,此時清 URL = 深連結被自己打掉」)與 StrictMode 雙跑保護。
⇒ **動它 = 動全站選車的真相來源**,風險與體積都遠高於 Q27,且會命中鐵則 12 ⑥。

**建議(請裁)**:

| 案 | 做法 |
|---|---|
| **A(推薦)** | **本片只做 Q27 + Q28②**,Q28① 另開一片專門處理「context → URL 的回灌」,單獨提 plan、單獨過審 |
| B | 三題同片 |
| C | 本片只做 Q27,Q28 整題等 Sean 把②那句話補完再一起做 |

推薦 A 的理由:Q27 是自足的、風險低、而且解掉一段既有死碼;
Q28① 是「全站選車真相來源」層級的改動,綁在同一片會讓 Q27 也一起卡在高風險審查裡。

## §5 驗收(每條都要有只紅它自己的突變)

1. qualified 態 ⇒ 結果框**與** picker 同時顯示(突變:條件改回舊版 ⇒ 只紅這條)
2. 🔴 qualified 態 ⇒ picker 的廠牌/車型**已回填**、**年份欄可用**(突變:拿掉回填 ⇒ 年份欄 disabled、只紅這條)
3. 🔴 qualified → 補年份 → 判定變 match/no-match、picker 自收(**`onPickYear` 首次可達,當新功能測**)
4. 其餘三態(none/match/no-match/undetermined)顯示行為**逐字不變**(反向守門:防「放寬條件」誤傷別態)
5. 判定邏輯與四態文案零改動(面層守門:`checkFitment` 與四句文案字面比對)
6. 手機 ≤1023px qualified 時 picker 強制展開
7. Q28②:鈕字面為「清除車輛」且點下去**真的清掉全站狀態**(不是只清本地 `sel`)

⚠️ **真瀏覽器**:PDP 在本 worktree 可渲染(不需登入),qualified 態需要一個「有年份限制」的 fixture 商品
⇒ 開工時先確認找得到,找不到就在 STOP 明說「這條只有單元測試」。

## §6 待回核的三件

1. **§4-3 的 A/B/C** —— Q28① 要不要拆出去(我推薦 A)
2. **§3-1** —— Q28② 的「清除之後畫面變成什麼」要問 Sean(或確認「待補」已補)
3. **§2-2 的規格外改動** —— qualified 時回填 `sel`。**不加它 Q27 就沒有意義**,但它超出 `D-218-A` 的「只改顯示條件」字面,故申報等核。

— site-redesign 窗,2026-08-08 凌晨
