# A9h 批次訂貨 coordinator — plan v2(🔴 關卡1 NO-GO,受阻於片界問題)

> **狀態:🔴 關卡1 NO-GO**(codex `gpt-5.6-sol`,11 must-fix + 1 nit,四個指定面全 FAIL)⇒ **不開工**。
> findings 全文 + 我的親驗 = `docs/reviews/2026-08-06-e10-a9h-k1-codex.md`。
>
> 🔴 **must-fix #1 會改變片界**:批次只填數量 ⇒ A5a 全量覆寫會把
> `submitted_at` / `supplier_order_no` / `exception_reason` / `expected_arrival_date`
> **四個人工填寫欄清成 `null`**(我親開 migration `20260803160000:354-360` 證實無條件覆寫)。
> codex 裁定「警告不能把資料損失變可接受」⇒ 需 A5a 加 `preserve` 模式或另建窄版 patch RPC
> ⇒ **A9h 不再是純應用層 `A` 型片、要 migration** ⇒ **已送決策題,不自行擴張片界。**
>
> 其餘 10 條 must-fix **全掛在簽章上,待 #1 定案後一起折 —— 先折會白折**。
> §7 三題(`E-123-A`)仍有效,但 **Q1=A 的形狀正是 #1 的來源**。零行 code。
> 產出視窗 = E(九碼退場窗),依 `E-121-A` ②。
> 事實全部親查於 worktree `pcm-refund-wire` @ `cb53f65`;引用一律附 `檔案:行號`。
>
> 🔴 **題號消歧**(對齊母 plan §8 的同名警告):本檔 §7 的 **Q1-Q3 專指 A9h 這三題**;
> 文中出現的 `E-121-A` **Q1=A / Q2=B 是另一套題**(施工序與 A12a 落點)—— 跨檔引用一律帶信號。
>
> **本檔三題定案(2026-08-06 Sean 拍):**
> - **Q1=A** 共同欄 + 逐列數量(整批一家供應商 / 一個回覆狀態 / 一個聯絡管道,每列只填分配數量)
> - **Q2=A** 整批同一個 `request_id`(audit 看得出批次邊界)
> - **Q3=B** **序列先行**(併發 1;主視窗自裁,Sean 報備中一字歧義確認中 —— 若翻成併發 5,
>   只需改 A9h-2 的一個常數與 §8 假設 A1 那格實測,**不影響簽章**)

---

## §0 這份 plan 最重要的三句話

1. **A9h 是「編排」不是「新寫入路徑」** —— 它逐列呼叫既有的 A5a RPC,**自己一行 SQL 都不寫**。
   冪等完全靠 A5a 的業務鍵 upsert 與同值 no-op(母 plan `:436` R7 收斂:**本片不自建批次冪等**)。
2. **A5a 每列要 8 個業務欄,而「每列訂多少」天生逐列不同**(`procurement-repository.ts:88-111`)。
   ⇒ **Q1=A 已拍**:整批共用「供應商 / 回覆狀態 / 聯絡管道」,**每列只填分配數量**。
   簽章照此寫(§3.1),其餘四個選填欄批次一律送 `null`(§3.1.1 有為什麼)。
3. **序列先行、不做併發**(Q3=B 已拍)。原因不是保守:A2b1 守門**鎖 parent order**
   (`FOR NO KEY UPDATE`,memory `project_m4b-a2b1-guard-decisions`)⇒ 同單多列本來就會在鎖上排隊,
   而 Q1=A 的形狀(整批共用一家供應商)幾乎保證**這批就是同一張單**
   ⇒ 併發 5 在本片最常見情境是零收益還多佔連線。母 plan `:436` 的「5」寫在它還沒有 A2b1 鎖行為時。

---

## §1 現況與前置

### 1.1 A9h 目前是零實作

全樹 grep(排除 `node_modules`/`.next`/`dist`)`batch` / `bulk` / `coordinator` / `批次` / `procure`
五種變體:**src 零命中**。唯一的採購寫入路徑是單列的
`apps/admin/src/lib/orders/procurement-actions.ts:116`(`upsertItemProcurementAction`)
→ `procurement-repository.ts:121`(`upsertItemProcurement`)→ RPC `admin_upsert_item_procurement`。

### 1.2 為什麼現在做它(Q7=A 的真正目標)

`docs/specs/2026-08-06-e10-a11a-list-rebuild-plan.md:176-178` 逐字:
**A11a-1 一落地,27 項第 4 項「標商品進度」就從 ⚠️ 掉到 ❌(完全沒有入口),直到 A12b 上線才回到「4(部分綠)」。**

⇒ 關掉這個退步窗口的是 **A12b**,而 A12b「消費 A9h 的逐列結果」(母 plan `:456`)
⇒ **A9h 是整條鏈上唯一還不存在的一環**,且它是 `A` 型片(無畫面)、不需肉眼驗、可夜跑。

誠實補充(同 plan `:181-183`,不要把話講得比事實嚴重):A10b 明細頁逐品項採購表單**已上線**,
員工仍可在明細頁逐品項記採購。退步的精確範圍 = **列表上的快速標記 + 批次**。

### 1.3 前置狀態

| 前置 | 狀態 | 證據 |
|---|---|---|
| A5a upsert RPC | ✅ 已上線正式站 | `supabase/migrations/20260803160000_*.sql`;17 固定碼見 `procurement-repository.ts:16-34` |
| A2b1 總量守門 | ✅ 已上線 | A5a catch P2B01 翻成 `OVER_ALLOCATION`(`procurement-repository.ts:55-57`) |
| A10b 單列表單 | ✅ 已上線 | `components/orders/item-procurement-form.tsx` |
| 供應商主檔 | ✅ 已上線 | `lib/supplier.ts` / `supplier-repository.ts` |
| **A12a 列表批次選取** | ❌ 未做 | A9h **不依賴它**(A9h 是 server 端函式,可先於 UI 落地) |

⇒ **A9h 沒有未滿足的前置,今天就能開工。**

---

## §2 A5a 契約(A9h 必須遵守、不得繞過的既有事實)

逐條親驗自 `procurement-repository.ts`:

1. **每列 11 個參數**(`:127-137`):`order_item_id` / `supplier_id` / `allocated_quantity` /
   `reply_status` / `contact_channel` / `submitted_at` / `supplier_order_no` / `exception_reason` /
   `expected_arrival_date` / `actor` / `request_id`。
   🔴 **全量 payload、逐欄具名送、不 spread**(`:116-119`)—— 漏送一欄不是「不動它」而是型別紅。
2. **回 17 個固定碼之一**(`:16-34`);未知碼 / null = RPC 漂移 ⇒ `ProcurementCallerBugError`
   (`:156-159`)。**不得靜默當成功。**
3. **兩個 SQLSTATE 當呼叫端 bug**(`:51-66`):`P0001`(actor/request_id 缺失、常數自檢)、
   `P2B02`(隔離閘)。🔴 `P2B01` **刻意不列** —— 走到 JS 層代表 A5a 沒翻譯它,那是真異常。
4. **`request_id` 是稽核關聯 id、不是冪等鍵**(`:105-110` 親驗 migration 全檔:
   只寫進 `admin_audit_log.request_id`、零唯一性約束)。⇒ **A9h 不得拿它當批次冪等鍵。**
5. **稽核由 RPC 同交易寫**(`:7-8`)⇒ A9h **不碰 `admin_audit_log`**。
6. **`submitted_at` 的 `+08:00` 偏移由 server 補**(`:95-97`),不在瀏覽器。
7. **`NO_CHANGE` 是成功型**(`procurement-actions.ts:55-56`):送上來與現況完全相同、零寫入。
   ⇒ **重送批次時已成功的列自然 no-op,這就是 R7 說的「冪等完全靠 A5a」。**

### 2.1 三類語意的既有分類器 —— 🔴 A9h 必須共用、不得複製

`procurement-actions.ts:60-82` 的 `classifyResult()` 已把 17 碼分成
「成功型(CREATED/UPDATED/NO_CHANGE)」與「失敗碼」。

🔴 **A9h 絕對不可以自己再寫一份 switch** —— 兩份分類器會在加碼時漂移,而漂移的症狀是
「某個碼在單列是失敗、在批次是成功」。⇒ 本片**先把 `classifyResult` 抽到共用模組**
(`procurement-result.ts` 之類),單列與批次同一個來源。這是本片唯一動到既有 code 的地方。

---

## §3 設計

### 3.1 簽章(Q1=A 定案後的形狀)

```
type BatchProcurementInput = {
  /** 整批共用(Q1=A:一批一家供應商) */
  supplierId: string;
  replyStatus: ProcurementReplyStatus;
  contactChannel: string | null;
  /** 逐列;順序 = 送出順序、也 = 回傳陣列順序 */
  rows: { orderItemId: string; allocatedQuantity: number }[];
};

type BatchProcurementRowResult =
  | { orderItemId: string; ok: true;  code: 'CREATED' | 'UPDATED' | 'NO_CHANGE' }
  | { orderItemId: string; ok: false; code: ProcurementFailureCode | 'NOT_ATTEMPTED' };
```

🔴 **`ok` 與 `code` 兩個都留、不只留 code**:A12b 要能「不認識某個新碼也知道該列失敗了」。
🔴 **不設計成 `Record<orderItemId, ...>`**:同一批次可能同時含**同一品項的多列**(不同供應商),
鍵會撞;用陣列、順序 = 送出順序。
🔴 **`NOT_ATTEMPTED` 進聯集**(§3.3):中止時未送出的列必須有值,留白會被讀成成功。

#### 3.1.1 🔴 剩下四個選填欄批次一律送 `null` —— 這是有代價的決定,不是省略

A5a 是**全量 payload**(`procurement-repository.ts:116-119`:漏送一欄不是「不動它」)。
Q1=A 的批次介面沒有 `submitted_at` / `supplier_order_no` / `exception_reason` /
`expected_arrival_date` 這四欄的入口 ⇒ 批次送出時它們一律是 `null`。

**代價講白**:對**已經有採購列、且那四欄已填**的品項下批次,會把那四欄**清成 `null`**。
這不是理論風險 —— 「先在明細頁記了供應商單號、之後又被批次掃到」是很正常的動線。

⇒ **A9h-2 必須把這個行為當成規格寫進測試**,而 **A12b 的畫面必須警告**
(母 plan `:456` 的「部分失敗逐列顯示」不涵蓋這條,這是另一件事)。
🔴 **列為關卡1 的重點打擊面之一** —— 若審查認為「靜默清空既有事實欄」不可接受,
替代方案是批次前先讀回現值逐列帶入(多一次往返、且要處理讀回與寫入之間的競態),
那會改變簽章 ⇒ **現在就要打,不要等 A9h-2 寫完才發現。**

### 3.2 編排規則

| 面 | 規則 | 理由 |
|---|---|---|
| 授權 | `authorizeAdminMutation()` **整批一次**、在讀任何欄位之前 | 對齊 `procurement-actions.ts:120-127`;未授權者不得從錯誤訊息反推表單規則 |
| 品項歸屬 | **逐列**驗 `findOrderIdForItem`(`procurement-repository.ts:78`) | 同 MF4:RPC 只認 `order_item_id`,不驗會「從 A 單寫進 B 單」 |
| 併發 | 🏁 **序列(併發 1)**,Q3=B 已拍 | A2b1 鎖 parent order ⇒ 同單多列本來就排隊;而 Q1=A 幾乎保證同批就是同一張單。母 plan `:436` 的「5」寫在它還沒有 A2b1 鎖行為時 |
| `request_id` | 🏁 **整批同一個**,Q2=A 已拍 | 它是稽核關聯 id、零唯一性約束(§2 第 4 條)⇒ 同一個值讓 `admin_audit_log` 看得出批次邊界。**不是**冪等鍵,不得拿來擋重送 |
| 業務失敗 | 記進該列結果、**繼續跑下一列** | 部分失敗是常態,那正是逐列結果存在的理由 |
| 🔴 呼叫端 bug | **整批中止**、已完成的列照實回報 | `ProcurementCallerBugError` = RPC 契約漂移;繼續跑 = 拿壞掉的契約再寫 N 次 |
| 交易 | **無跨列交易**(每列各自一個 RPC 交易) | A5a 是單列 RPC;跨列原子性要 DB 端新 RPC = 超出本片 |
| 稽核 | 不碰 | RPC 同交易寫 |

### 3.3 🔴 「部分完成」是規格、不是缺陷

因為沒有跨列交易,批次跑到一半失敗 ⇒ **前面的列已經寫進去了**。
這一條必須寫進 A12b 的畫面文案(母 plan `:456` 的「部分失敗逐列顯示」就是為它存在),
**也必須寫進 A9h 的回傳**:呼叫端要能分辨「這列沒跑」與「這列跑了但失敗」。
⇒ 中止時,未送出的列回 `{ ok: false, code: 'NOT_ATTEMPTED' }`,**不要留白**(留白會被讀成成功)。

---

## §4 片拆

| 片 | 內容 | 片型 | L | 前置 | 估時 |
|---|---|---|---|---|---|
| **A9h-1** | 抽共用分類器(§2.1)+ 逐列結果型別(§3.1)。**零行為改動**、單列路徑走新模組 | 標準片 | L1 | 無 | 20-30 分 |
| **A9h-2** | coordinator 本體(§3.2 編排規則)+ 單元測試 | 標準片 | L1 | A9h-1 | 35-45 分 |

🔴 **拆兩片的理由**:A9h-1 是**零行為改動的重構**,它單獨落地時全套測試數應**完全不變**
(Δ = 0)——那是「我沒有順手改到單列路徑」的唯一證明。混在 A9h-2 裡做就失去這個對帳點。

---

## §5 相關既有紀錄與連動面

### 5.1 🔴 主視窗已推翻母 plan §7.3(Sean 鐵則 8 回核時請看這條)

`E-121-A:10-11` 裁定 **Q2=B:A11c 手機卡片版先行、A12a 批次選取蓋在 `<AdminDataTable>` 上**,
**推翻母 plan §7.3(`:775-778`)「批次選取直接做在 `orders-table`、不套 AdminDataTable」的字面。**

裁定依據(我親驗):`apps/admin/src/components/shared/admin-data-table.tsx:16-22` 自標
> 「本段原本的理由已過期(A11a-1):`orders-table` 曾內含 `ItemWorkflowStatusCell`…
> 那個 cell 已下架,orders-table 現在零互動、零 client 邊界 ⇒ **這個特定阻礙不再成立**。」

⇒ §7.3 的**承重理由已消失**,而換上來的新理由(雙渲染對帶互動欄位的顧慮)**正好指向 A12a 自己**。
**Sean 不同意可翻**;A9h 本身不受這條影響(A9h 無畫面)。

### 5.2 A12a 的技術約束(`E-121-A:17` 要求原樣帶進未來 A12a plan)

1. 選取 island **只能吃 `order id`**,不得吃到金額 / tier —— `orders-table.tsx:32` 的鐵則 12
   註記逐字:「金額 + 會員等級同列 = 經銷價脈絡,全 server-render → 敏感值不序列化進 client bundle」,
   而 `:33` 自陳「本片拆掉唯一的 client 元件後,本檔已無任何 client 邊界」
   ⇒ **現行防護是靠「零 client 邊界」成立的,A12a 是把它拿掉的那一片。**
2. ⇒ A12a **命中鐵則 12⑥、codex 關卡2 不降級**。
3. 分頁走 `searchParams` server navigation ⇒ 換頁 React state 必被清空,「跨頁選取」不是加個 state 就好。

### 5.3 其他連動

- **A9v**(REVOKE 九碼 item RPC)與本片無交集 —— 本片動的是採購線,不是九碼線。
- **A7-t 合約債**:本片**不 DELETE / UPDATE** `order_cancellation_items` / `order_refund_items`
  的既有列 ⇒ 母 plan `:389` 那條合約債**不觸發**。
- **`listOrderStatusOptions` 讀取鏈**已於 `cb53f65` 退場,與本片無關。

---

## §6 鐵則 12 命中面(自標,依 `E-121-A:16` 要求)

| 類 | 命中? | 判定 |
|---|---|---|
| ①錢(order/payment/refund/pricing/經銷價/tier/儲值金) | **否** | 採購 = 供應商與分配數量,不動任何金額欄;A5a 的 SET 清單零 price 欄 |
| ②權限(auth/RLS/GRANT/service_role/server-client 邊界) | **是(弱)** | A9h 是 server-only、走 service_role;但**不新增任何權限面**,沿用 A5a 既有路徑 |
| ③**DB 結構與大量/不可逆寫入** | 🔴 **是** | **本片的定義就是「一次寫 N 列」** —— 批次寫入正是這一類 |
| ④平台設定 | 否 | 不動 next.config / vercel.json / Prisma / CI / env |
| ⑤對外不可回收 | 否 | 不寄信、不對外發布 |
| ⑥共用元件 packages/ui 行為 | 否 | 本片零 UI |

⇒ **命中 ③(+②弱)⇒ codex 關卡2 不降級。** 另因跨檔數與新增 server 寫入編排,**命中鐵則 8**
(重大改動)⇒ 本 plan 需 Sean 批准才開工。

---

## §7 決策題 —— 🏁 三題全拍(`E-123-A`,2026-08-06),**已無活選項**

| 題 | 拍板 | 連動到哪 |
|---|---|---|
| **Q1** 批次 UI 填到什麼程度 | 🏁 **A 共同欄 + 逐列數量**(整批一家供應商 / 一個回覆狀態 / 一個聯絡管道,每列只填分配數量) | 簽章 §3.1;**§3.1.1 的四欄清空代價由本案引入** |
| **Q2** 批次的 `request_id` | 🏁 **A 整批同一個**(audit 看得出批次邊界;它零唯一性約束、非冪等鍵) | §3.2 表 |
| **Q3** 併發 | 🏁 **B 序列先行(併發 1)** ⚠️ 主視窗自裁,Sean 報備中一字歧義**確認中** | §3.2 表、§8 假設 A1 |

⚠️ **Q3 的唯一活口**:若 Sean 翻成「併發 5」,**只改 A9h-2 的一個常數 + §8 假設 A1 那格實測**,
**不影響簽章、不影響任何其他段落**(`E-123-A:7` 逐字)。⇒ 不因這題卡開工。

🔴 **原始三選項與推薦理由已移除,不留活字**(避免「拍完了但檔案裡還躺著選項」被下一個人讀成未決)。
決策全文與 Sean 的拍板語境留在 `E-123-A`,本檔只留結論與連動。

---

## §8 假設清單(開工前要打掉或確認,不確認就不准依它施工)

| # | 假設 | 為何可疑 | 怎麼驗 |
|---|---|---|---|
| **A1** | ~~併發 5 對同單批次有收益~~ 🏁 **Q3=B 已拍序列 ⇒ 本假設下架、不再是開工前置**。留紀錄:當初懷疑它的理由(A2b1 鎖 parent order)**仍成立**,將來若要加併發,**這格要先復活並實測**,不得直接調常數 | — | 若 Sean 翻成併發 5:對同一張單的 5 列實測總時長 vs 序列,結果寫進 A9h-2 commit body |
| **A2** | `classifyResult` 抽出後單列行為零變 | 重構最常見的自捅 | A9h-1 落地時全套 Δ **必須 = 0** |
| A3 | 17 碼在批次情境語意不變 | `NO_CHANGE` 在單列是成功,批次重送時會大量出現 | A9h-2 測試含「整批重送 ⇒ 全列 NO_CHANGE 且 ok=true」 |
| A4 | 逐列 `findOrderIdForItem` 的 N 次往返可接受 | N=50 時是 50 次單列查詢 | 若 Q1=A(共同一張單),可改成一次 `in` 查詢;列進 A9h-2 |

---

## §9 驗收條件(逐條 yes/no)

1. A9h-1 落地後全套測試數 **Δ = 0**(零行為改動的證明)。
2. 單列與批次共用**同一個** `classifyResult`,全樹 grep 只有一份 switch。
3. 批次重送 ⇒ 全列 `NO_CHANGE` 且 `ok: true`(冪等靠 A5a 的證明)。
4. 業務失敗列不中斷批次;`ProcurementCallerBugError` **中止**批次且已完成列照實回報。
5. 中止時未送出的列回 `NOT_ATTEMPTED`,**不留白**。
6. A9h 全檔零 `admin_audit_log` 字面(稽核歸 RPC)。
7. 三綠 + codex 關卡2(鐵則 12③,不降級)。

---

**未批准不得開工。** 回核後若 §7 三題有拍板變動,本檔同 commit 更新、不留過期字面。

— E 窗(九碼退場窗),2026-08-06
