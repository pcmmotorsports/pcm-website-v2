# A9h 批次訂貨 coordinator — plan v3(片界已升格:含 migration)

> **狀態:關卡1 R1 NO-GO 的 11 條已全數折入,等 R2。零行 code。**
> 🏁 **Sean 2026-08-06 拍板 A**(`E-124-A`):A5a 加 preserve 模式 ⇒ **A9h 升格為含 migration 的片**
> ⇒ 鐵則 12③ **codex 關卡2 不降級** + **apply = Sean 手動停點**。
> 選型(preserve 模式 vs 窄版 patch RPC)由本檔 **§3 提案並附理由**。
>
> **本檔是整份重寫、不是逐行補丁** —— 片界都變了,補丁式修改會在隔壁留過期字面
> (本 repo 復發 9+ 次的頭號形狀,memory `feedback_claimed-sync-but-only-patched-touched-lines`)。
>
> - 關卡1 R1 findings 全文 + 我的親驗 = `docs/reviews/2026-08-06-e10-a9h-k1-codex.md`
> - 事實親查於 worktree `pcm-refund-wire` @ `ec6256d`;引用一律附 `檔案:行號`
> - 🔴 **題號消歧**:本檔 §9 的 Q1-Q3 專指 A9h;`E-121-A` 的 Q1/Q2 是另一套題(施工序與 A12a 落點)

---

## §0 這份 plan 最重要的三句話

1. **A9h 現在是兩片:一片 migration(A5a 加 preserve)+ 一片應用層編排。**
   原本「純 `A` 型片」的判定被關卡1 打掉 —— 因為 A5a 是全量覆寫,批次只填數量會清掉四個人工欄。
2. **preserve 只動 UPDATE 分支。** CREATE 分支(`20260803160000:383-391`)插 `null` 本來就對(新列無舊值可保留)
   ⇒ 改動面可精確界定成 `:354-360` 那段 SET 清單,不是「改一支 RPC」那麼大。
3. **序列(非併發)的結論不變,但理由換掉。** 舊理由「整批同供應商≈同一張單」**被關卡1 證偽**
   (跨訂單挑同一家供應商才是正常批次)。新理由見 §4.2。

---

## §1 現況與前置

### 1.1 為什麼現在做(Q7=A 的真正目標)

`docs/specs/2026-08-06-e10-a11a-list-rebuild-plan.md:176-178` 逐字:
A11a-1 一落地,27 項第 4 項「標商品進度」從 ⚠️ 掉到 ❌(完全沒有入口),**直到 A12b 上線才回到「4(部分綠)」**。
而 A12b「消費 A9h 的逐列結果」(母 plan `:456`)⇒ **A9h 是這條鏈上唯一還不存在的一環**。

誠實補充(同 plan `:181-183`):A10b 明細頁逐品項採購表單**已上線**,員工仍可逐品項記採購。
退步的精確範圍 = **列表上的快速標記 + 批次**。

### 1.2 前置狀態

| 前置 | 狀態 | 證據 |
|---|---|---|
| A5a upsert RPC | ✅ 已上線正式站(**本片要改它**) | `supabase/migrations/20260803160000_*.sql`;11 參無預設值 `:108-118` |
| A2b1 總量守門 | ✅ 已上線 | A5a catch P2B01 → `OVER_ALLOCATION`(`:392-399`) |
| A10b 單列表單 | ✅ 已上線 | `components/orders/item-procurement-form.tsx` |
| A12a 列表批次選取 | ❌ 未做 | A9h **不依賴它**(server 端函式可先落地) |

---

## §2 A5a 契約(不得繞過的既有事實;逐條親驗)

1. **11 個參數、無預設值**(`20260803160000:108-118`)。
2. **UPDATE 分支無條件覆寫四個選填欄**(`:354-360`):`submitted_at` / `supplier_order_no` /
   `exception_reason` / `expected_arrival_date` —— **零 COALESCE、零 preserve 分支**。🔴 這就是本片的病灶。
3. **CREATE 分支**(`:383-391`)同樣由參數插入 —— 但新列**沒有舊值可保留** ⇒ preserve 不適用、不需改。
4. **回 17 個固定碼**(`procurement-repository.ts:16-34`);未知碼 / null = RPC 漂移 ⇒ `ProcurementCallerBugError`。
5. **兩個 SQLSTATE 當呼叫端 bug**:`P0001`、`P2B02`(`procurement-repository.ts:51-66`)。
   `P2B01` 刻意不列(A5a 自己翻成 `OVER_ALLOCATION`)。
6. **`request_id` 是稽核關聯 id、不是冪等鍵**(`:105-110`,零唯一性約束)。
7. **稽核由 RPC 同交易寫** ⇒ A9h **不碰 `admin_audit_log`**。
8. **`NO_CHANGE` 是成功型**:送上來與現況完全相同、零寫入 ⇒ 重送批次時已成功的列自然 no-op
   = 母 plan `:436` R7「冪等完全靠 A5a」的機制。

### 2.1 三類語意的既有分類器 —— 🔴 必須共用、不得複製

`procurement-actions.ts:60-82` 的 `classifyResult()` 已把 17 碼分成成功型與失敗碼。
**A9h 絕不可以自己再寫一份 switch** —— 兩份會在加碼時漂移,症狀是「同一個碼在單列失敗、在批次成功」。

---

## §3 🔴 選型提案(`E-124-A` 指定由我提)

### 3.1 提案:**A5a 加 preserve 模式**,不做窄版 patch RPC

新增第 12 個參數:

```
p_preserve_optional_fields boolean DEFAULT false
```

`true` 時,**UPDATE 分支**(`:354-360`)那四欄改為保留現值;`false`(預設)= 現行行為完全不變。
CREATE 分支不受影響(§2 第 3 條)。

### 3.2 為什麼不做窄版 patch RPC(這是決定性的一條)

窄版 RPC 必須**複製 A5a 的全部守門**:A2b1 的 `P2B01` catch 與 constraint 名比對、
`unique_violation` 併發首建重試圈、17 碼的完整分流、同交易 audit、隔離閘 `P2B02`、
`FOR NO KEY UPDATE` 鎖序。

⇒ **兩份守門必然漂移,而「批次路徑少了一道單列路徑有的守門」正是本 repo 反覆踩的坑**
(memory `feedback_guard-drawn-at-narrowest-surface-not-invariant`;我上一片才因同族問題被 R1 抓)。
**一支 RPC 一個守門面**,比兩支各自維護安全得多。

### 3.3 為什麼這個答得了 codex 對 COALESCE 的反對

codex 逐字:「單純 `COALESCE` 會讓合法清空失效」。**同意,所以不用 COALESCE。**

差別在:`COALESCE` 是**永遠**不能清空(null 一律被當成「不提供」);
**顯式旗標**只在呼叫端**明說**自己沒有那四欄時才保留 ⇒
- 明細頁單列表單(有那四欄)照舊送 `false` ⇒ **員工想清空某欄照樣清得掉,能力零損失**
- 批次(沒有那四欄)送 `true` ⇒ 保留

「不提供」與「明確清空」由**呼叫端的意圖**區分,不是由值區分。這正是 codex 要的「明確 preserve 模式」。

### 3.4 🔴 這個改動的三個連帶,必須同批處理

1. **overload 必須清乾淨。** 加參數 = 新簽章;若舊 11 參版還在,PostgREST 會遇到兩個 overload 而歧義。
   ⇒ migration 必須 **DROP 舊 11 參簽章**,並斷言 `proname='admin_upsert_item_procurement'` 的
   **`COUNT(*) = 1`**。repo 前例:A8a1/A8a2「5 參已 DROP、恰 1 個 overload」
   (memory `project_m4b-a8-cancellation-line-decisions` 相關段;STATUS 有 `pronargs=6、pronargdefaults=1` 的實查紀錄)。
2. **`NO_CHANGE` 的比較基準要跟著改。** preserve=true 時,那四欄**不參與**「有沒有變」的比較
   (它們本來就不是這次要送的內容)。否則會出現「保留了舊值、卻因為比對到 null 而回 UPDATED」
   ⇒ 假的寫入紀錄 + `status_changed_at` 被無謂推進。
3. **`service_role` 的 EXECUTE 要重新 GRANT。** DROP 舊簽章會一併帶走它的 ACL
   (該 migration `:809-814` 自己就寫了這件事)⇒ 新簽章必須顯式 GRANT + fail-closed 斷言
   (memory `reference_supabase-service-role-execute-default-grant`)。

---

## §4 設計

### 4.1 簽章(Q1=A 定案 + 關卡1 MF2/MF3/MF4/MF5 折入)

```
type BatchProcurementInput = {
  /** 🔴 MF2:orderId 補回 —— 沒有它,findOrderIdForItem() 沒有可比對的對象,
   *  單列路徑那道「從 A 單的表單寫進 B 單的品項」防護(procurement-actions.ts:192)就消失了 */
  orderId: string;
  /** 整批共用(Q1=A) */
  supplierId: string;
  replyStatus: ProcurementReplyStatus;
  contactChannel: string | null;
  /** 逐列;順序 = 送出順序 = 回傳陣列順序 */
  rows: { orderItemId: string; allocatedQuantity: number }[];
};

type BatchProcurementRowResult =
  | { orderItemId: string; ok: true;    code: 'CREATED' | 'UPDATED' | 'NO_CHANGE' }
  | { orderItemId: string; ok: false;   code: ProcurementFailureCode | 'NOT_ATTEMPTED' }
  /** 🔴 MF3 第三態:RPC 可能已 commit 但回應沒回來(網路在 commit 後斷)。
   *  A12b 必須畫成「狀態未知,請重新整理確認」而**不是**失敗 —— 畫成失敗會誘發重送。 */
  | { orderItemId: string; ok: 'unknown'; code: 'RESULT_UNKNOWN' };
```

🔴 **MF4:陣列而非 `Record<orderItemId, …>` 的理由換掉。**
v2 寫「同品項可有不同供應商」——**那在 Q1=A(整批一家供應商)下自相矛盾**,是 v1 的殘句。
正確理由:**輸入允許重複 `orderItemId`**(員工誤選),而重複列需要各自的回報位置;
且陣列保住「送出順序」這個 A12b 要用的資訊。

🔴 **MF5:執行期驗證 + 批次上限**(型別不是執行期保證):
- `rows` 空陣列 → 直接回空結果、不進授權後的寫入迴圈
- **重複 `orderItemId` → 整批拒收**(而不是靜默連打同一業務鍵;那會讓結果無穩定對應)
- `allocatedQuantity` 非負整數
- 🔴 **批次上限**:見 §4.3 與 §10 假設 A2(數字由逾時預算反推,不是拍腦袋)

### 4.2 編排規則

| 面 | 規則 | 理由 |
|---|---|---|
| 授權 | `authorizeAdminMutation()` **整批一次**,在讀任何欄位之前 | 對齊 `procurement-actions.ts:120-127` |
| 🔴 session 過期(MF9) | **靠批次上限 + 總時長上限**把整批視為「一次已接受的命令」;上限見 §4.3 | 逐列重驗會讓「跑到一半權限沒了」變成新的部分完成來源,更糟 |
| 品項歸屬 | 逐列驗 `findOrderIdForItem` **並比對 `input.orderId`** | MF2;RPC 只認 `order_item_id` |
| 併發 | **序列(併發 1)**,Q3=B 已定案 | 🔴 理由換新,見下 |
| `request_id` | **整批同一個**,Q2=A | 稽核關聯、零唯一性約束 ⇒ 讓 audit 看得出批次邊界 |
| 業務失敗 | 記進該列、**繼續下一列** | 部分失敗是常態 |
| 🔴 呼叫端 bug | **整批中止**,已完成的列照實回報,未送出的回 `NOT_ATTEMPTED` | `ProcurementCallerBugError` = 契約漂移;繼續跑 = 拿壞掉的契約再寫 N 次 |
| 🔴 一般 DB/網路例外(MF8) | 該列記 **`RESULT_UNKNOWN`**、**中止整批** | `procurement-repository.ts:149` 是裸 throw;分不清「沒送到」與「送到了但沒回來」⇒ fail-closed |
| 交易 | 無跨列交易 | A5a 是單列 RPC |
| 稽核 | 不碰 | RPC 同交易寫 |

🔴 **序列的新理由**(舊理由已被關卡1 證偽 —— 「整批同供應商≈同一張單」不成立,
跨訂單挑同一家供應商才是正常批次):
① 併發會讓「部分完成」的邊界從**一個前綴**變成**一個不確定的子集**,A12b 的逐列顯示與員工的重送判斷都變難;
② A2b1 鎖 parent order,同單片段仍會排隊 ⇒ 收益本來就不均勻;
③ 先序列可量到真實 P95,再決定要不要加(§10 假設 A2)。**先簡單、先可解釋。**

### 4.3 🔴 逾時預算(MF10/MF11;v2 完全沒有這段)

- `apps/admin/vercel.json` **沒有釘 `maxDuration`**(親驗:只有 `framework` / `regions`)。
- 但 repo **已有前例**:訂單明細頁顯式 `export const maxDuration`,並由
  `apps/admin/src/lib/payment/composition-tappay-wiring.test.ts:151` 守門(斷言 ≥45)。
  ⇒ 本 repo 的慣例是「長工作要顯式釘 + 用測試釘住」。

⇒ **A9h-2 必須**:① 顯式 `export const maxDuration` ② 依實測 P95 反推**批次上限**
③ 補一條同形狀的守門測試 ④ **逾時是可觀察的失敗** —— 見下。

🔴 **MF11(失聯):函式逾時或回應中斷時,前面的列已 commit、但結果陣列送不到 A12b。**
`NOT_ATTEMPTED` 救不了這個(它只在我還活著時才寫得出來)。
⇒ **A12b 端必須有 read-back**:批次回來後(或沒回來後)重讀那批品項的採購現況再畫,
不能只信 A9h 的回傳。**這條是 A9h 對 A12b 的契約義務,寫進本檔讓 A12b plan 接得住。**

### 4.4 「部分完成」是規格、不是缺陷

沒有跨列交易 ⇒ 批次跑到一半失敗,前面的列**已經寫進去了**。
呼叫端要能分辨三件事:**這列沒跑**(`NOT_ATTEMPTED`)/ **跑了但失敗**(失敗碼)/
**跑了但不知道結果**(`RESULT_UNKNOWN`)。三者都不得留白 —— 留白會被讀成成功。

---

## §5 片拆與 DAG

```
A9h-M (migration:A5a 加 preserve + DROP 舊簽章 + 重 GRANT + overload=1 斷言)
   ↓  ⛔ apply = Sean 手動停點(主視窗排;🔴 與 B 線 S2b 是兩條線各自的批、絕不混批)
A9h-1 (抽共用分類器;零行為改動)
   ↓
A9h-2 (coordinator 本體 + maxDuration + 批次上限 + 測試)
```

| 片 | 內容 | 片型 | 前置 | 估時 |
|---|---|---|---|---|
| **A9h-M** | migration:preserve 參數、UPDATE 分支保留四欄、`NO_CHANGE` 比較基準跟改(§3.4-2)、DROP 舊 11 參簽章、service_role EXECUTE 重 GRANT + fail-closed 斷言、overload `COUNT(*)=1` 斷言;交易模擬 BEGIN→驗→ROLLBACK 零留痕 | 🔴 **高風險片**(鐵則 12③)| 無 | 40-60 分 |
| **A9h-1** | 抽 `classifyResult` 到共用模組;**零行為改動** | 標準片 | 無(可與 A9h-M 平行)| 20-30 分 |
| **A9h-2** | coordinator + 執行期驗證 + 批次上限 + `maxDuration` + 測試 | 標準片 | A9h-M **已 apply** + A9h-1 | 40-50 分 |

🔴 **A9h-1 與 A9h-M 沒有相依** ⇒ 等 apply 的空檔可以先做 A9h-1。

---

## §6 關卡1 R1 十一條 must-fix 折入對照(逐條,不漏)

| # | findings | 折在哪 |
|---|---|---|
| 1 | 四欄被清空 = 資料損失 | **§3 全節**(Sean 拍 A、選型提案) |
| 2 | 簽章掉了 `orderId` ⇒ MF4 防護消失 | §4.1 `orderId` 補回 + §4.2 品項歸屬列 |
| 3 | 表達不了「已 commit 但結果未知」 | §4.1 第三態 `RESULT_UNKNOWN` + §4.2 一般例外列 |
| 4 | 「同品項不同供應商」與 Q1=A 自相矛盾 | §4.1 理由換成「允許重複 orderItemId + 保住送出順序」 |
| 5 | 無執行期驗證、無批次上限 | §4.1 MF5 四條 + §4.3 上限由逾時預算反推 |
| 6 | `Δ=0` 不是行為證明 | §11 驗收條件 1(宣稱降級 + 補三個條件) |
| 7 | 「單列 byte 級不變」未定義 | §11 驗收條件 2(定義成可驗的三條) |
| 8 | 一般 DB/網路例外無策略 | §4.2 一般例外列(`RESULT_UNKNOWN` + 中止) |
| 9 | session 只驗一次、可能中途過期 | §4.2 session 列(批次上限 + 總時長上限) |
| 10 | 「同供應商≈同一張單」不成立 | §0-3 與 §4.2 序列理由**整段換掉** |
| 11 | 逾時/失聯時結果送不到 A12b | §4.3 MF11(A12b 端 read-back 契約義務) |
| nit | Q3 活字 | §9 已清(Sean 一字確認序列定案,`E-124-A:8`) |

---

## §7 相關既有紀錄與連動面

### 7.1 主視窗已推翻母 plan §7.3(Sean 鐵則 8 回核時請看)

`E-121-A:10-11` 裁定 **A11c 手機卡片版先行、A12a 批次選取蓋在 `<AdminDataTable>` 上**,
推翻母 plan §7.3(`:775-778`)。依據 = `apps/admin/src/components/shared/admin-data-table.tsx:16-22`
自標「本段原本的理由已過期(A11a-1)…那個 cell 已下架 ⇒ 這個特定阻礙不再成立」。
**Sean 不同意可翻。** A9h 本身不受影響(無畫面)。

### 7.2 A12a 的技術約束(`E-121-A:17` 要求原樣帶進未來 A12a plan)

1. 選取 island **只能吃 order id**,不得吃金額 / tier(`orders-table.tsx:32-33`:現行鐵則 12 防護
   是靠「零 client 邊界」成立的,A12a 是把它拿掉的那一片)
2. ⇒ A12a **命中鐵則 12⑥、codex 關卡2 不降級**
3. 分頁走 `searchParams` server navigation ⇒ 換頁 React state 必被清空

### 7.3 其他

- **A9v** 與本片無交集(九碼線 vs 採購線)。
- **A7-t 合約債**:本片不 DELETE / UPDATE `order_cancellation_items` / `order_refund_items` ⇒ 不觸發。
- 🔴 **apply 排程**:A9h-M 與 B 線 S2b 是**兩條線各自的批、絕不混批**(`E-124-A:10`);
  migration commit 押本分支等收割,apply 時機由主視窗排給 Sean。

---

## §8 鐵則命中面

| 類 | 命中 | 判定 |
|---|---|---|
| ①錢 | 否 | 採購 = 供應商與分配數量;A5a 的 SET 清單零 price 欄 |
| ②權限 | **是** | A9h-M **DROP 舊簽章會帶走 ACL**、必須重 GRANT service_role EXECUTE(§3.4-3) |
| ③**DB 結構 / 大量寫入** | 🔴 **是(雙重)** | A9h-M = migration;A9h-2 = 一次寫 N 列 |
| ④平台設定 | **是(弱)** | A9h-2 要顯式 `export const maxDuration` |
| ⑤對外不可回收 | 否 | 不寄信、不對外發布 |
| ⑥共用元件 `packages/ui` | 否 | 零 UI |

⇒ **命中 ②③④ ⇒ codex 關卡2 不降級**;**A9h-M apply = Sean 手動停點**;**命中鐵則 8** ⇒ 需批准。

---

## §9 決策(全部已拍,**無活選項**)

| 題 | 拍板 | 連動 |
|---|---|---|
| **Q1** 批次 UI 填到什麼程度 | 🏁 **A** 共同欄 + 逐列數量 | §4.1 簽章;**本案引入四欄清空問題 ⇒ 導致 Q4** |
| **Q2** `request_id` | 🏁 **A** 整批同一個 | §4.2 |
| **Q3** 併發 | 🏁 **B 序列**(Sean 一字確認定案,`E-124-A:8`;**活字已清**)| §4.2、§10 |
| **Q4** 四欄清空怎麼走 | 🏁 **A** A5a 加 preserve(`E-124-A:3`)| §3 全節、§5 片拆升格 |

**選型(preserve 模式 vs 窄版 patch RPC)= §3.1 提案 preserve 模式,理由 §3.2**,待主視窗核。

---

## §10 假設清單(不確認不准依它施工)

| # | 假設 | 為何可疑 | 怎麼驗 |
|---|---|---|---|
| **A1** | preserve 只需改 UPDATE 分支 | CREATE 分支也送那四欄 | 已驗:`:383-391` 是新列、無舊值可保留 ⇒ **成立** |
| **A2** | 批次上限的數字 | v2 完全沒有這個數字;拍腦袋會直接撞 `maxDuration` | A9h-2 實測單列 P95 → 反推上限 → 寫進常數 + 守門測試 |
| **A3** | 抽 `classifyResult` 後單列行為零變 | 重構最常見的自捅 | §11 驗收 1（Δ=0 **不夠**,見那條）|
| **A4** | DROP 舊簽章後無其他呼叫端受影響 | PostgREST 以外可能有 SQL 內部呼叫 | A9h-M 前 grep 全 migration 樹 + `pg_proc` 實查 |
| ~~A5~~ | ~~併發 5 有收益~~ | Q3=B 定案後下架 | 將來要加併發,**這格要先復活並實測**,不得直接調常數 |

---

## §11 驗收條件(逐條 yes/no)

1. 🔴 **A9h-1 零行為改動的證明 —— `Δ=0` 不夠**(關卡1 MF6:刪一補一、改斷言、skip 都能維持 Δ=0)。
   三條同時成立才算:① 全套 Δ=0 ② **既有測試檔清單與測試名稱矩陣逐字不變**(diff 為空)
   ③ 17 碼 / 未知碼 / null / 兩類 throw **各有一個案例穿過公開的單列 action**。
2. 🔴 **「單列 byte 級不變」的可驗定義**(關卡1 MF7:原字面未定義且整檔不可能成立):
   ① 分類器函式本體**逐位元組**搬移(`git show` 舊檔該段 vs 新模組該段,`diff` 為空)
   ② `procurement-actions.ts` 的 diff **只准**「加 import + 刪除原函式整塊」,呼叫點字面不變。
3. 批次重送 ⇒ 全列 `NO_CHANGE` 且 `ok: true`。
4. 🔴 **preserve 的正負對照**:preserve=true 更新一列 ⇒ 四欄**原值保留**;
   preserve=false 同樣輸入 ⇒ 四欄**被清成 null**(證明旗標真的在做事,不是恆真)。
5. 🔴 **清空能力未受損**:單列表單顯式送空值 + preserve=false ⇒ 該欄**真的變 null**
   (證明 §3.3 的宣稱)。
6. A9h-M:`proname='admin_upsert_item_procurement'` 的 `COUNT(*)=1`;service_role EXECUTE=true;
   交易模擬零留痕。
7. 業務失敗不中斷;`ProcurementCallerBugError` 與一般例外**都中止**;未送出列 `NOT_ATTEMPTED`、
   結果未知列 `RESULT_UNKNOWN`,**無留白**。
8. 重複 `orderItemId` 整批拒收;空陣列不進寫入迴圈。
9. A9h 全檔零 `admin_audit_log` 字面。
10. 三綠 + **codex 關卡2 不降級**(鐵則 12②③④)。

---

**未經主視窗核 §3 選型 + 關卡1 R2 PASS,不得開工。**

— E 窗(九碼退場窗),2026-08-06
