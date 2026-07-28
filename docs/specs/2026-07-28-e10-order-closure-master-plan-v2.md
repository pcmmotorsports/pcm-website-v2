# M-4b E10 訂單閉環總規劃 **v2**(2026-07-28 重寫)

> **狀態:** 🟡 提案,**待 Sean 批准 + codex 關卡1 通過才動第一片 code**(鐵則 8/12)
> **取代:** `docs/specs/2026-07-27-e10-order-closure-master-plan.md` v1 —— v1 經 codex 關卡1 **FAIL、67 條 findings(62 must-fix + 5 nit)**,判定重寫非修補。逐條裁定 = `docs/reviews/2026-07-28-e10-k1-findings-triage.md`(駁回 0 條)
> **驗收唯一標準:** `docs/specs/2026-07-25-admin-backend-rebuild-spec.md` §1「員工的一天」27 項
> **北極星(Sean 逐字):**「可以完整上線給員工使用,操作,修改網站。而且他們不是工程師」
> **輪次:** 🔴 **Sean 2026-07-28 拍 Q8=B 解除 plan 層兩輪上限**(逐字:「就算有第四輪第五輪都沒差,我要把全貌做好後再用視覺顯示完整一次 才開始動工」)。
> 已跑:**R1 67**(審 v1)→ **R2 33** → **R3 31** → **R4 32** → **R5 26 must-fix + 2 nit**,五輪皆 FAIL,findings 各存 `docs/reviews/2026-07-28-e10-k1-r{2,3,4,5}-codex.md`。
> 🔴 **R5 診斷(codex 回答主對話的追問)**:「反覆產生 finding 的核心,是新模型/新決策加進正文後**沒有同步生成唯一 DAG 與『schema→writer→reader→UI→驗收』閉環矩陣**;主因是規格深度不足,但 **P1 後綴、已到貨取消、取消原因映射、HCT 允許字元確實尚未定案**」。
> ⇒ 本檔為 R5 折入後版本:**§5.0 改為唯一 DAG + 閉環矩陣(其他段落只准引用、不准複述順序)**;四項真未定需求集中在 **§8.6 待 Sean 拍板**。下一步送 **R6**(Sean 指示:再審一輪後才問他 §8.6)。
> ✅ **動工前置之一已滿足**:完整視覺全貌已交付且 Sean 批准方向(artifact `ed7a6276-70fc-44f3-b09c-61c8991b5294`)。剩餘前置 = 關卡1 通過。
>
> ⚠️ **R2 的基線瑕疵(誠實記錄)**:主對話在 R2 審查**進行中**改了本檔(452 → 464 行),違反「送審前必先凍結版本」。
> codex 自己在 nit 抓到。⇒ R2 findings 的行號不可信,折入時一律以**內容**比對。**R3 送審前本檔必須先 commit 凍結。**

---

## §0 v1 為什麼會 FAIL(重寫的立足點)

67 條裡有 **44 條**可歸到同三個結構性錯誤,不是各自獨立的疏漏:

1. **片是按「功能」切的,不是按「層」切的** —— 每片都混了 schema + RPC + ACL + audit + UI,於是全部超過鐵則 4 的 15-45 分鐘(#58/#59/#60 三條總結,另 #11/#13/#21/#23/#57 各自點名)。
2. **欄位先於模型** —— 單號先放 `orders`、包裹模型後建,製造永久雙寫真相(#6/#24);供應商先放品項、採購模型不存在,表達不了同 SKU 分兩家(#45)。
3. **把「有欄位」當成「該項會變綠」** —— 帳本只有 SELECT 權就宣稱退款能做(#29/#30)、稽核表沒有 SELECT 權就宣稱稽核 UI 能做(#35/#36)、顯示片映射到輸入功能(#37)。

v2 的 §1 四原則就是針對這三件事,不是風格偏好。

---

## §1 四條結構原則(v2 的骨架)

### 原則 1 — 一片一層

每片**只能**是下列其一,混層即拆:

| 型 | 內容 | 收工證據 |
|---|---|---|
| **M** | migration:建表 / 加欄 / 回填 / CHECK / ACL / RLS。**零行為改動** | 交易模擬(BEGIN→模擬→驗→ROLLBACK)+ ACL fail-closed assert |
| **R** | owner RPC + EXECUTE ACL + 同交易 audit。**無 UI** | RPC 單元測 + 權限矩陣實查 + 零留痕 |
| **D** | domain 純函式 / 型別 / 狀態機 + 測試。**不碰 DB、不碰 UI** | 單元測 + typecheck |
| **A** | 應用層:adapter 投影、row mapper、read-model 型別、server action、查詢合約。**不碰 schema、不畫 UI** | 單元測 + 型別對齊 + 實跑一次讀取路徑 |
| **U** | UI,只消費**已存在**的 RPC 與 **A 型片已建好的讀模型**。**不碰 schema、不改投影** | 三綠 + smoke test + agent-browser 實看 |
| **docs** | 查證 / 對帳 / 規格凍結。**零 code、零 DB** | 產出檔 + 每條斷言附 `檔案:行號` 或實查輸出 |
| **runbook** | 一次性 production 資料操作。**不進 migration 序列**(寫死正式站識別值,在本機 / preview 必然重播失敗) | 匯出備份 + 還原演練 + 環境身分守門 + 前後對照矩陣 |

> 🔴 **A 型是 R2 補的**(codex R2:「M/R/U 沒有 adapter、read-model、server action 類型,但 A9-A12 必須改投影、mapper、domain view type 與 action,無法維持『U 只有 UI』」)。
> 沒有這一型,所有 UI 片都會偷渡投影改動 —— 那正是 v1「片按功能切」的復發路徑。
> **判別法**:這片會不會動 `SupabaseOrderAdapter` 的 select 字串、mapper、或新增 server action?會 → 它是 A 型,不是 U 型。

> 片型與高風險的關係:**M / R 一律高風險**(鐵則 12 ②③);**A / D / U 依內容判**。
> v1 把高風險總數寫成 13 / 12、實際表裡是 15(`grep -c` 實測)⇒ **不預先宣稱總數**,逐片標、開批時當場數(#61/#62)。

### 原則 2 — 模型先於欄位

某件事的真相若屬於一個尚未存在的實體(包裹、採購、收款、退貨),**先建那個實體**,再開輸入、通知與列印。
`orders` / `order_items` **永遠不會**拿到 `tracking_number`、`supplier_name` 這類欄位;它們最多只持有「最新摘要」,而摘要必須由 trigger 從真相表推導、標明可重算。

🔴 **計數器欄同樣受這條管**(Q9=B;codex R2 抓「計數器是第二真相會漂」):
`order_items` 的每一個數量計數器,**只能在它對應的真相模型已經存在之後才加**——

| 計數器 | 真相來源 | 可以加的時機 |
|---|---|---|
| `ordered_quantity` / `instock_quantity` | `order_item_procurement` | **第 1 批**(A2 同批建表) |
| `cancelled_quantity` | `order_cancellations` | **第 1 批**(A7 同批建表) |
| `shipped_quantity` | `shipments` / `shipment_items` | **第 2 批** |
| `return_requested_quantity` / `return_received_quantity` | `order_returns` / `order_return_items` | **第 3 批** |

🔴 **「摘要由 trigger 推導」是實作要求、不是比喻**(R5 抓:原則寫 trigger、片表卻寫「RPC 寫完手動呼叫重算」⇒ 漏呼叫就是第二真相)。
⇒ **A4 定為 constraint trigger**:掛在 `order_item_procurement` / `order_cancellation_items` 上,明細一動就同交易重算 `order_items` 摘要欄,**不存在「忘記呼叫」這條路**;另附漂移 assert(隨機抽單重算比對)。

🔴 **每加一軸,同片必須補齊它與所有既存軸的跨欄不變式**(codex R2 抓「現在允許 `shipped=3` 且 `cancelled=3`、或退貨數 > 出貨數」)。
單看「各值 ≤ `quantity`」是不夠的 —— 已出貨的不能又被取消、退貨數不能超過出貨數。
**不變式清單隨軸成長,不是一次寫完**;缺哪條就是缺哪條,不得以「之後再補」帶過。

### 原則 3 — 🔴 客人讀得到的表不放內部資料

`orders` 與 `order_items` **兩張表都對登入客人整表開放 SELECT**(欄位級全開)+ own-order RLS:

- `20260604120000_m3_s2a_orders_order_items.sql:190-191` 逐字 `GRANT SELECT ON TABLE orders TO authenticated` / `GRANT SELECT ON TABLE order_items TO authenticated`
- `20260716120000_m4a_d2_order_items_workflow_status.sql:21-23` 逐字「新欄會員查自己單品項時可直讀」

⇒ **內部備註、供應商名稱與單號、採購異常原因、聯絡紀錄、負責人、內部取消原因 —— 一律進 service_role-only 新表**,一個 byte 都不放這兩張表。

> codex 只抓到 `internal_note`(#10);`order_items` 這一半是主對話本輪自查補的(triage §3 N-1)。對代購生意而言後者更嚴重:客人可以直接繞過 PCM 找上游。

### 原則 4 — 每片自帶「做完哪一項會變綠」,且不得虛報

片級 plan 必須寫「本片做完,27 項的第 N 項從 X 變成 Y」。
**不能宣稱變綠的情況**:所需權限尚未 GRANT、所需寫入 RPC 尚未存在、本片只做顯示。
`ALTER TYPE ... ADD VALUE` **不可逆、不能 contract** ⇒ v1「所有 DB 片一律 expand/contract」的字面作廢(#17),改為:**加欄可 contract,加 enum 值不可** —— 故加 enum 值前必須先確定它有 writer 也有 reader。

---

## §2 現況實查(含 v1 錯誤更正)

### 2.1 資料層(2026-07-27 production `information_schema` 實查,本輪未重跑)

`orders` 34 欄 / `order_items` 13 欄。

| 需求 | 現況 |
|---|---|
| 訂單備註 | ❌ 無 `note` / `internal_note` / `tags` |
| 快遞單號與時間軸 | ❌ 無 `tracking_*` / `shipped_at` |
| 逐品項計數器 | ❌ 零計數器欄,只有 `quantity` |
| 取消 | ⚠️ `cancelled_at` / `cancelled_reason`(text)欄在,**但後台沒有任何取消動作**(見 2.2) |
| 退款帳本 | ✅ `order_refunds` / `order_refund_items` 在 production,**但只給 service_role SELECT** |
| 退貨(貨的軸) | ❌ 無 `order_returns` |
| 運費快照 | ✅ RF2a-0 已上 |

**enum 實值**:`fulfillment_status` = `notOrdered, ordered, inStock, shipped`(4 值);`payment_status` = 5 值,夠用。

**ACL 現況(本輪親查,決定了片型)**:

| 表 | authenticated | service_role |
|---|---|---|
| `orders` / `order_items` | **SELECT(整表)** + own RLS | **SELECT only** —— INSERT/UPDATE/DELETE 已 REVOKE(`20260611120000:240`)⇒ 一切寫入必走 owner RPC |
| `order_refunds` / `order_refund_items` | 零 | **SELECT only**(`20260725130100:326-327`)⇒ 退款寫入 RPC 不存在 |
| `admin_audit_log` | 零 | **INSERT only**(`20260712210000:88`)⇒ 稽核 UI 現在讀不到,該檔逐字寫「稽核 viewer slice 才顯式 GRANT SELECT」 |

### 2.2 admin 應用層(本輪親查)

- 業務頁面 7 個 route;**server action 檔 6 個**(v1 寫 7 = 錯,第 7 個是 `staff-actions.test.ts`;`'use server'` grep = 6)(#63)
- 既有 admin owner RPC **4 支**:`admin_adjust_wallet` / `admin_set_customer_tier` / `admin_update_order_workflow` / `admin_update_order_item_workflow`
- 🔴 **取消訂單在後台完全不存在** —— `order-detail.tsx:233-239` 只在 `cancelledAt` 有值時渲染「已取消」,**沒有任何取消入口**。v1 §2 把第 19 項標成「⚠️ 自由文字」是低估:欄位是自由文字**且動作不存在**
- ✅ 既有稽核型別已內建對客/內部分流:`apps/admin/src/lib/audit/types.ts:22` 逐字「內部原因(不對客;對客文案另走 `orders.cancelled_reason`)」⇒ #14 的解法在 repo 已有先例,照抄即可
- 🔴 `<AdminDataTable>` 自陳「批次選取 = 後續片」,且 `admin-data-table.tsx:15-19` ponytail 註解逐字警告:拿去接 `orders-table` 會因桌機/手機雙渲染產生**重複表單與重複 client 狀態**(#23)
- `order_refunds` 在 `apps/admin/src` 零引用

### 2.3 domain 層(#18/#19/#20 的事實基礎,本輪親讀)

- `packages/domain/src/order/types.ts:57`:`FulfillmentStatus` = 4 值 union
- `packages/domain/src/order/state-machine.ts:50-55`:`FULFILLMENT_TRANSITIONS` 逐級線性、**禁跳級 / 禁倒退 / 禁自我轉移**,`shipped` 為終態
- `packages/domain/src/order/display-id.ts:18`:`/^PCM-\d{4}-\d{4,}$/`;`:81-85` `parseDisplayId` 假定三段格式並回 `{year, seq}`
- ✅ `delivered` 未進 domain 亦未進 DB(P2′=B 後未回歸,#19 確認)

🔴 **N-2 衝突(codex 未抓、主對話補)**:Sean 拍板的「訂貨/出貨狀態**可隨時來回改**」與上述禁倒退狀態機直接牴觸。
✅ **已由 Q1=B 消解**(§8.1):既然不再從計數器驅動 `fulfillment_status`,就碰不到那張轉移表;品項層的來回改 = 計數器加減,本無方向限制。
⚠️ 但這條**不能忘**:任何未來想「順便把訂單層狀態同步一下」的片,會當場撞回這個禁倒退規則。

### 2.4 誠實邊界

- `orders` 現有筆數、E11 積木是否已被兩頁採用、27 項逐項現況 —— **沿用 2026-07-26 read-back,本輪與 v1 皆未重驗**,列為 A0
- 視覺 artifact `87d397af-…` 本輪未讀取 ⇒ **版面規格以本檔 §5.1 的欄位清單文字為準**,artifact 僅供視覺參考、**不是 repo 真權威**(#66);列高/欄寬「不增加」的推論**降級為待實測**,不當已驗事實(#67)

---

## §3 三個前置的現況

| # | 前置 | 現況 |
|---|---|---|
| **C1** | 送新竹的識別值 | ⚠️ **拍板兩次、格式仍未定**。~~2026-07-27 P1:訂單編號自動加 `-1`/`-2`~~ → 🔴 **2026-07-28 Q10=A 推翻基底**:改為包裹自己的 `shipment_reference`、與訂單編號脫鉤(理由:U1 併箱時沒有唯一基底訂單號)。**產號合約見 §8.5**;**新竹 `epino` 的長度與字元限制尚未驗證 ⇒ 出貨片不得開工**。`hct-logistics-api-reference.md` §8 已同步 |
| **C2** | `create_order` 不可用於手動建單 | ❌ 仍在:`:284` `auth.uid` 為 NULL 直接 exception;`:356`/`:360` 品項必須是既有 catalog 變體 ⇒ 需另開 admin 專用 RPC |
| **C3** | schema 要吃 U1 包裹 / U2 改單 / U3 多筆匯款 | ❌ 未建模 ⇒ 由 §5.2 / §5.3 的模型片承接 |

**不在我方控制**:🔴 Sean 待辦 —— 向新竹站所申請物流 API 帳號(**查貨與出貨是兩張不同申請表**)。
申請時**勾「用新竹貨號查詢」、不要勾訂單編號**(`:49` 逐字「只能擇一查詢,申請時即選定,**要改須聯繫營業所**」—— v1 寫「送出即不可改」是誤述,#64)。

---

## §4 已核准決策折入對照表(#34/#39/#40/#41/#42)

v1 最大的漏是**沒把 2026-07-26 UX 審查已核准的條目排進片**。以下每條都指定落點,片級 plan 必引用。

| 來源 | 內容 | 落點 |
|---|---|---|
| **U1** | 包裹實體,一單多包 **+ 多單併一箱**;包裹卡顯示品名/變體/數量/訂單單號/收件人姓名/電話 | 第 2 批 `shipments` + `shipment_items` |
| **U2** | 改單「改全部」(姓名/電話/地址/品項數量);直改極簡、差異寫時間軸;差額只記不動錢;**已裝箱部分鎖定** | 第 3 批 改單線(硬依賴包裹與帳本) |
| **U3** | 多筆匯款 + 已收累計/應收/差額/處置四格;少款掛催款、溢款強制處置;結清才離開對帳清單 | 第 3 批 `order_payments` |
| **U4** | 內部通知:即時走 **LINE OA 推播給兩位員工** + **每日彙整 Email**;Chrome 網頁推播不做 | 第 2 批(出貨)起接,第 3 批補齊事件 |
| **U5** | 每單負責人 + 下次跟進日;待辦顯示「逾期跟進 / 沒人認領」 | 第 3 批 `order_internal`(service_role only,原則 3) |
| **U6** | 缺貨**只做告知義務**:記異常原因 + 已告知客人(時間/管道/摘要);**不設回覆期限、不做等客人決定關卡** | 第 1 批 `order_item_procurement` + `order_notes` |
| **U7** | 🔴 **B 送達完全不做**(override 07-26 的 A)⇒ 不加 `delivered` enum、不加 `delivered_at` | 全域約束,§2.3 已確認未回歸 |
| UX §1 #3 | 銀行匯款退款去向:受款帳戶(客人提供+複核)、轉帳參考號、待匯/完成/失敗、防重複匯款 | 第 3 批 匯款退款片 |
| UX §1 #4 | 部分取消(品項層);已出貨品項禁勾;預設全選 = 既有整單行為不變 | 第 1 批 取消 RPC(禁勾規則此時無出貨資料 ⇒ 介面留、規則第 2 批生效) |
| UX §2 #5 | 採購事實:聯絡管道 / 送出時間 / 回覆狀態(未回·已確認·改價·缺貨·部分出貨)/ 異常原因 | 第 1 批 `order_item_procurement` |
| UX §2 #7 | 到貨登錄:依**供應商單號**搜尋 + 批次「標記到貨」 | 第 1 批(搜尋)/ 第 2 批(批次動作) |
| UX §2 #9 | 供應商自由文字正規化:trim + 大小寫歸一 + 相似值警告 | 第 1 批 procurement RPC |
| UX §3 #11 | **通知矩陣**(8 事件 × Email/LINE)—— 事件清單見 UX 審查 §3;E10 前 Sean 勾選 | 第 2 批開批前拍板 |
| UX §3 #12/#13 | 通知 = 可追蹤交付(寄了什麼/成功失敗/重試)+ 人工登記「已用 LINE/電話通知」,統一進時間軸 | 第 1 批 `order_notes`(登記)+ 第 2 批(寄送紀錄) |
| UX §3 #14 | **前台回路**:#240 訂單詳情頁(逐包裹單號+追蹤連結+品項進度)、RF6 部分退款顯示 | 第 2 批(#240)/ 第 3 批(RF6) |
| UX §4 #17 | 新竹 API 失敗與重送安全:請求識別值 + 原始回覆 + 三段狀態;只允許安全重試 | 第 2 批 |
| UX §4 #18/#19 | 物流異常佇列;逆物流前置守門(件數只能 1) | 第 2/3 批 |
| UX §5 #21 | 狀態旁固定顯示「下一步」,同一套詞彙貫穿 | 第 1 批列表 + 明細 |
| UX §5 #23 | **手機出貨兩步守門**(先選快遞→依快遞驗必填→送出摘要;失敗保留草稿) | 第 2 批 |
| UX §5 #24 | 高風險動作「影響範圍」複核頁(品項/金額/收件快照/不可逆後果) | 第 1 批(取消)起,每個破壞性動作 |
| UX §5 #26 | 「編輯訂單」拆入口(訂單資料 / 修改品項與地址 / 付款調整),不可做的顯示原因 | 第 1 批(拆入口)/ 第 3 批(填內容) |
| UX §5 #25 | 空狀態三動作(清除篩選 / 建手動單 / 查詢範例) | 第 1 批列表 |

---

## §5 施工序與拆片

### 5.0 唯一 DAG + 閉環矩陣(R5 結構修法;順序**只寫在這裡**,其他段落只准引用)

> 🔴 **本節是全檔唯一的順序權威。** R2-R5 反覆出現「同一修正在別處留下舊順序」——根因是順序被複述在多個段落。
> 從本版起:**§5.4、§8.4、§8.5 一律不得自帶順序敘述**,只寫「順序見 §5.0」。

```
第1批  A0a/A0b/A0c 現況重驗 (docs)
         ↓
       D0 legacy_display_id + CHECK 放寬 + pending_invoices CHECK 加 voided (M, 可重播)
         ↓
       D1 舊訂單清理+改號 (runbook)  ← 🔴 Sean 獨立批准閘 (閘序見 §8.4)
         ↓
       A2 採購真相 → A3 備註 → A7 取消真相 → A7b 退款工作表
         ↓
       A1 摘要欄 → A2b 總量守門 → A4 重算 trigger
         ↓
       A5b(D) → A5a/A6/A8 (R)
         ↓
       A5c/A9a/A9b/A9c/A9s/A9d1/A9d2/A9g/A9h (A)
         ↓
       A9e/A9f/A10a-c/A11a-c/A12a-b/A13a-b/A14a-c (U)

第2批  N3a 共用產號 helper (R)  ← 🔴 R5 前移:shipment_reference 要用它
         ↓
       shipments + shipment_items (同客人限定, Q16=A) → 出貨 RPC/UI/通知/列印 → 前台 #240
       (order_items.shipped_quantity 此時才加; A8 的已出貨禁取消 contract 債同批清)

第3批  order_payments / order_returns / RF2b-RF8 退款線 (吃 A7b 的 queued)
       order_internal / 改單 / 稽核線 / 待辦對帳 / 匯出
       admin 建單 RPC (呼叫 N3a; N3a 已在第 2 批存在)
         ↓
       N3b create_order 換產號器 → N3c 收窗+CHECK 收緊

獨立   N2 domain 換格式 (D; 對結帳零 runtime 影響, D1 之後任意時點)
```

#### 5.0b 閉環矩陣(每個資料域:schema → writer → 讀模型 → UI → 綠燈;缺一格 = 該綠燈不得宣稱)

| 資料域 | schema(M) | writer | 讀模型(A) | UI(U) | 綠燈 |
|---|---|---|---|---|---|
| 採購 | A2 + A2b | A5a(key 由 A5b 算) | A9a / A9b / A5c | A10b / A10c | **5, 6** |
| 備註·聯絡·告知 | A3 | A6 | A9a | A10a | **3**;**7 = A10a+A10b 聯合驗收**(告知在 A10a、異常原因在 A10b,缺一不綠) |
| 計數器摘要 | A1 | **A4 trigger**(由 A2/A7 明細驅動,無手填入口) | A9c | A11a-c | — |
| 批次訂貨 | — | (走 A5a) | **A9h 批次 coordinator** | A12a / A12b | **4(僅訂貨面)** |
| 取消 | A7 | A8 | **A9g** | A13a / A13b | **19 = A13b + refund job 看得到,聯合驗收** |
| 退款工作 | **A7b** | A8(同交易 enqueue);worker = 第 3 批 | A9g | A13b | (併入 19) |
| 列表投影 | — | — | A9c(admin)/ **A9s(storefront)** | A9e / A9f / A11a-c | **1(部分)** |
| 編號 | D0 | D1(runbook)/ N3a / N3b / N3c | A9b(**含 legacy_display_id 命中**) | — | — |

**閉環檢查**:每個綠燈的整條鏈都在同一批;第 1 批不依賴包裹、不依賴帳本、不依賴 N3a(D1 用寫死映射,§8.4)。

### 5.1 第 1 批(詳片級;可直接開工)

**Sean 做完會看到**:訂單列表換成新版 12 欄三軸;訂貨軸真的能標(含分配數量、含批次);明細頁能寫內部備註與聯絡紀錄、能記供應商單號與預計到貨;取消訂單這個動作**第一次存在**。
**Sean 這批看不到**:出貨軸(顯示灰色「未出貨」、唯讀,第 2 批才會動)。

⚠️ **關於「只剩 3 張」的精確說法**(codex R2 抓上一版自我矛盾):
**D1 apply 的那一瞬間**訂單表剩 3 張、且**那 3 張**是新 6 碼格式。
但 `create_order` 要到 **N3b** 才改產號器 ⇒ **D1 之後任何真實結帳都會再長出舊格式的新單**。
所以 Sean 驗收第 1 批時看到的是「3 張新格式 + 期間累積的若干張舊格式」,**新舊並存是預期狀態、不是 bug**;
「只剩 3 張」**只在 D1 apply 當下成立**,不是第 1 批的驗收條件。(收窗由 N3c 負責。)

🔴 **R2 重拆**:codex R2 判定原 14 片仍有 6 片超過 45 分鐘、且 `U` 型裝不下投影改動。以下為重拆後版本。
🔴 **Q9=B 連動**:第 1 批**只加「訂貨」這一軸的計數器**(`ordered_quantity` / `instock_quantity`);
`shipped_quantity` 等包裹模型(第 2 批)、`return_*` 等退貨模型(第 3 批)才加 —— **不讓欄位早於它的模型**。

🔴 **R3 再修正**:①施工序改成**真相表先於摘要欄**(原表把 A1 計數器排在 A2 採購表之前,與依賴圖相反)②再拆 6 片。

| # | 片 | 型 | 內容 | 做完哪項變綠 |
|---|---|---|---|---|
| 1 | **A0a** | docs | 資料現況重驗:`orders` 筆數 / 各相依表列數 / 金流狀態分佈 | — |
| 2 | **A0b** | docs | 程式現況重驗:E11 積木採用度 / `orders-table`·`order-detail` 現況盤點 | — |
| 3 | **A0c** | docs | **27 項逐項對帳**(對照 07-26 read-back、標出漂移) | — |
| 4 | **D0** | M | `orders` 加 `legacy_display_id`(nullable、unique、索引)+ `display_id` CHECK 放寬成暫收新舊兩種格式 + 🔴 **`pending_invoices` 的 status CHECK 加 `voided`**(R5 實查:live CHECK 逐字 `ARRAY['pending','issued']` ⇒ D1 要寫的排除值**現在會直接被擋**)。**可重播、無 production 識別值**、與 D1 分開 | — |
| 5 | **D1** | runbook | 🔴 **舊訂單清理 + 改號**(Q2=A / Q5 / Q7=C;完整規格見 §8.4)。**本批唯一不可逆**,前有獨立批准閘。🔴 **不是 migration**(寫死 production UUID,在本機 / preview 必然重播失敗)⇒ 與 D0 拆開、**不進 migration 序列** | — |
| 6 | **A2** | M | `order_item_procurement` 新表(**採購真相**,每 line 1:N)。🔴 **兩個數量欄**:`allocated_quantity`(這筆採購負責幾件)+ **`received_quantity`(這筆實際到貨幾件)** —— R3/R4 兩次抓:少了後者,`instock_quantity` **無來源可推導**。其餘:供應商名、`supplier_canonical_key`、聯絡管道、送出時間、供應商單號、回覆狀態、異常原因、預計到貨、`first_ordered_at`、`status_changed_at`。CHECK `received_quantity ≤ allocated_quantity`。ACL = service_role only + RLS zero-policy。🔴 **排在 A1 之前**(真相表先於摘要欄) | — |
| 7 | **A3** | M | `order_notes` 新表(append-only):內部備註 / LINE·電話聯絡紀錄 / 「已告知客人」登記(U6)。ACL 同 A2 | — |
| 8 | **A7** | M | 🔴 **`order_cancellations` 新表**(取消真相,合約見 §5.1b)。**內部取消原因不進 `orders`**(原則 3);對客的 `orders.cancelled_reason` / `cancelled_at` 原封不動 | — |
| 9 | **A7b** | M | 🔴 **`order_refund_jobs` 新表**(R5 抓:A8 要原子建 refund job,但上一版全表**沒有任何片建它的 schema**):`status` ∈ `queued/processing/completed/failed`、應退金額(整數分)、冪等鍵、`failed_reason`、`order_refunds.id` nullable FK(第 3 批回填)、`cancellation_id` FK。ACL = service_role only + RLS zero-policy。worker = 第 3 批退款線 | — |
| 10 | **A1** | M | `order_items` 加**摘要欄**:`ordered_quantity` / `instock_quantity`(來源 A2)、`cancelled_quantity`(來源 A7)。加欄 nullable → 回填 0 → `SET DEFAULT 0` + `SET NOT NULL` → 跨欄 CHECK(§5.1c)。🔴 **只加這三欄**(Q9=B) | — |
| 11 | **A2b** | M | `allocated_quantity` / `received_quantity` 跨列總量守門:**constraint trigger + 先鎖 parent `order_items` 列**(R4 抓:只有 trigger 時,併發兩筆各自讀到舊合計仍會一起超量)。鎖序固定 `order_items` → `order_item_procurement`。**必附雙交易競態負向測試** | — |
| 12 | **A4** | M | 🔴 **重算 constraint trigger**(R5 抓:原則寫 trigger、實作卻是「RPC 記得呼叫」⇒ 漏呼叫 = 第二真相):掛 `order_item_procurement` / `order_cancellation_items` AFTER INSERT/UPDATE/DELETE,同交易重算 parent `order_items` 的 `ordered/instock/cancelled_quantity`。**無手填入口、無「忘記呼叫」路徑**;附漂移 assert(抽單重算比對)+ 雙交易競態負測試 | — |
| 13 | **A5b** | D | 🔴 **排在 A5a 之前**(R4 抓:A5a 要寫 canonical key,但算法在 A5b 才定)。供應商正規化**純函式**:`supplier_canonical_key` = trim → 全半形歸一 → 大小寫歸一 → 連續空白收斂;**顯示值原樣保存**。相似度 = **Levenshtein 距離 ≤ 2**,或**一方為另一方前綴且較短者 ≥ 4 字元**(R4 nit:無下限時短字串會對一堆供應商噴警告);候選來源 = 既有 canonical key,上限回 5 筆 | — |
| 14 | **A5a** | R | `admin_upsert_item_procurement` owner RPC(窄)。🔴 **只收顯示值、自己呼叫 A5b 產 canonical key**,不讓呼叫端傳 key(確保全站同一算法):upsert + `allocated_quantity` 上限守門 + `first_ordered_at` 僅首寫 / `status_changed_at` 每次更新 / **no-op 不動日期** / 業務日 Asia/Taipei server 端算(摘要由 A4 trigger 自動重算,**本片不碰計數器**)| — |
| 15 | **A5c** | A | 相似候選查詢 + 警告資料合約(供 A10b 顯示;**警告不阻擋送出**,只提示) | — |
| 16 | **A6** | R | `admin_append_order_note` owner RPC | — |
| 17 | **A8** | R | `admin_cancel_order` owner RPC(合約見 §5.1b):整單 / 品項層部分取消、寫 `order_cancellations`(摘要由 A4 trigger 重算)、已付款單**同交易寫入 A7b 的 refund job(`queued`)** | — |
| 18 | **A9a** | A | 讀模型:訂單明細的 notes + procurement 投影、型別、mapper | — |
| 19 | **A9b** | A | 跨單搜尋合約:依**供應商單號** + 🔴 **依 `legacy_display_id` 舊號命中**(R5 抓:alias 存了卻沒有任何查詢路徑 = 永久對照實際不可用;客服查舊號走這裡)。**定死走 adapter 投影、不開 DB RPC** | — |
| 20 | **A9c** | A | 列表投影改造:三軸欄位進 `ADMIN_ORDER_LIST_SELECT`。🔴 **只做 admin 資料契約層**(adapter select / mapper / domain view type)—— R4 抓:上一版宣稱「移除全部 stale reader」,但 storefront 的 TSX 顯示端**不是 A 型**、adapter 與 domain 型別也還在讀 | — |
| 21 | **A9d1** | A | server actions:counters / procurement 兩支 | — |
| 22 | **A9d2** | A | server actions:note / cancel 兩支 | — |
| 23 | **A9s** | A | 🔴 **storefront 資料契約**(R5 抓:A9c 只管 admin、A9f 只改 TSX,但 storefront 的 `ORDER_LIST_SELECT`、mapper、`OrderListItem.fulfillmentStatus` 型別**仍在讀並傳遞 stale 值**):投影移除該欄、mapper 與型別同步、消費端測試更新 | — |
| 24 | **A9g** | A | 🔴 **取消 + 退款工作讀模型**(R5 抓:A13 要顯示「歷次取消、剩餘可取消量、refund job 狀態」,但 A9a 只有 notes/procurement ⇒ A13 無資料可讀):cancellations 歷程投影、逐品項剩餘可取消量、refund job 狀態 | — |
| 25 | **A9h** | A | 🔴 **批次訂貨 coordinator**(R5 抓:A12b 是純 U 片,但批次動作需要 application 層合約 —— A9d1 的單筆 action ≠ 批次閉環):每列冪等、併發上限、**逐列結果型別**(成功/失敗/原因),供 A12b 消費 | — |
| 26 | **A10a** | U | 明細頁:內部備註 + 聯絡紀錄時間軸;🔴 **含 U6「已告知客人」的結構化欄位**(時間 / 管道 / 摘要)寫入與讀回 | **3** |
| 27 | **A10b** | U | 明細頁:逐品項採購表單(含分配數量、到貨數量、異常原因、相似值警告) | **5, 6, 7**(🔴 R5 抓:第 7 項 = **A10a+A10b 聯合驗收** —— 告知紀錄在 A10a、異常原因在 A10b,兩片皆完成才綠) |
| 28 | **A9e** | U | 🔴 **stale `fulfillment_status` 顯示端下架**(R4 抓,A9c 只做資料契約層):`order-detail.tsx:202` / `customer-detail-sections.tsx:71` 移除該欄改顯示品項層訂貨狀態;`order-filter-bar.tsx:36` 與 `order-list-view.ts:31,149,184` 移除篩選參數 | — |
| 29 | **A9f** | U | 🔴 **storefront 顯示端**(Q12=B):`OrdersTab.tsx:45` / `OverviewTab.tsx:108` 改顯示「處理中」。**跨 app、面向客人**,單獨成片 | — |
| 30 | **A10c** | U | 依供應商單號搜尋畫面 | — |
| 31 | **A11a** | U | 列表桌機:**12 欄骨架 + rowSpan 分組重算**(§7.2) | — |
| 32 | **A11b** | U | 列表桌機:**三軸膠囊元件**(付款單層 / 訂貨·出貨品項層,`n/m` 顯示;出貨軸唯讀灰) | — |
| 33 | **A11c** | U | 列表**手機卡片版**(通用 UI 規範 §4-1) | **1(部分)** |
| 34 | **A12a** | U | 列表批次選取(選取狀態 + 全選 / 反選 + 跨頁行為)。🔴 **不套 `<AdminDataTable>`**,理由見 §7.3 | — |
| 35 | **A12b** | U | 批次標記訂貨動作 + **部分失敗逐列顯示**(UX §4 #20) | **4(僅訂貨面)** |
| 36 | **A13a** | U | 取消訂單 **影響範圍複核頁**(UX §5 #24:品項 / 數量 / 金額 / 收件快照 / 不可逆後果) | — |
| 37 | **A13b** | U | 取消訂單主流程 + 已付款分流提示(消費 **A9g** 的歷程 / 剩餘可取消量 / refund job 狀態) | **19**(🔴 聯合驗收:取消動作成功 **且** refund job 建立後在 UI 看得到) |
| 38 | **A14a** | U | 狀態旁固定「下一步」(UX §5 #21),同一套詞彙貫穿列表 / 明細 | — |
| 39 | **A14b** | U | 「編輯訂單」入口拆分(UX §5 #26):訂單資料 / 修改品項與地址 / 付款調整;不可做的顯示原因 | — |
| 40 | **A14c** | U | 空狀態動作(UX §5 #25)。🔴 **不放「建手動單」**(第 3 批才有 = 死按鈕);只放「清除篩選」與「查詢範例」 | — |

**第 1 批 = 40 片。片型(`awk` 逐列數、非手算):U 15 / A 9 / M 8 / docs 3 / R 3 / runbook 1 / D 1。**

🔴 **高風險(判準:M / runbook / R 一律;A 型命中「service_role-only 表讀取投影」或「server action 授權邊界」才算)**:
M 8 + runbook 1 + R 3 + A 7(A5c / A9a / A9b / A9g 讀 service_role-only 表;A9d1 / A9d2 / A9h 是授權邊界)= **19 片**。
A9c / A9s 不算(只收縮客人可讀表的投影,無權限面);docs / D / U 不算。

⚠️ **同一段話我在 R3 與 R4 各寫錯一次片型分佈**(R3 寫 R5/A7/U10、R4 寫 M5/A7)。
⇒ **這兩個數字一律以 `awk` 當場數為準,禁止手算後直接寫進文件。**

🔴 **估時紀律(R5 抓「無可信 45 分鐘證據」)**:每片開工前的片級 plan **必附估時與單一驗收條件**;
估超 45 分鐘**當場再拆、不得先開工再說**。本表只定範圍與依賴,不代替片級 plan。

#### 5.1b `order_cancellations` 與取消 RPC 資料合約(R3 抓「合約未定不得開工」)

| 項 | 定死 |
|---|---|
| cardinality | `order_cancellations`(header,每次取消動作一列)1:N `order_cancellation_items`(每品項一列、帶 `cancelled_quantity`)。**同一張單可取消多次**(部分取消可分次) |
| 冪等鍵 | `(order_id, idempotency_key)` unique。🔴 **不能「由 server action 產生」**(R4 抓:重新呼叫會拿到新鍵 ⇒ 等於沒防護)。**鍵在使用者開啟取消畫面時就產生一次並寫進表單 hidden field**,整段互動(含重試、含瀏覽器重新送出)沿用同一個;RPC 端**額外驗 `actor` 與 payload hash**,同鍵不同內容 = `RAISE`,不是靜默覆寫 |
| 對客欄何時動 | **整單取消**(所有品項剩餘量歸零)⇒ 同交易寫 `orders.cancelled_at` + `cancelled_reason`;**部分取消** ⇒ **兩欄都不動**(訂單還活著)。多次部分取消累積到全量時,**最後那次**才寫這兩欄。`cancelled_quantity` 各欄一律 `> 0` 且 `(cancellation_id, order_item_id)` unique |
| 內部 vs 對客 | `reason_code`(受控 code,內部)存本表;**對客文字**寫 `orders.cancelled_reason`,兩者由 RPC 同交易寫入。🟡 **allowlist 與映射 = §8.6 Q18 待 Sean 拍板**(草案已擬在該節);未知 code 一律 `RAISE` fail-closed;**Q18 未答 ⇒ A7/A8 不得開工** |
| 與採購連動 | 取消後 `cancelled_quantity` 上升 ⇒ `ordered_quantity` **不自動下降**(已向供應商下的單不會因客人取消就消失);差額由第 3 批的採購退貨處理。🟡 **已到貨後取消的語意 = §8.6 Q17 待 Sean 拍板** —— R5 抓:§5.1c 的 `instock + cancelled ≤ quantity` 會**直接擋掉「已到貨再取消」**,與本格「差額走採購退貨」自相矛盾;Q17 未答 ⇒ 該條不變式**暫不進 A1 的 CHECK**(只上另外三條) |
| 🔴 已出貨禁取消 | **上一版寫反了**(R4 抓,成立):我寫「包裹真相不存在 ⇒ 無法證明未出貨 ⇒ 不得取消」,但第 1 批**本來就沒有包裹模型** ⇒ 條件恆假、**一件都取消不了**,卻同時宣稱第 19 項變綠。**正確寫法**:第 1 批 `shipped_quantity` 欄**不存在**,出貨這件事在系統裡尚未發生 ⇒ 不變式 `cancelled ≤ quantity − shipped` **退化為 `cancelled ≤ quantity`、恆真**,取消照常運作。🔴 **但這是有期限的正確**:第 2 批建包裹模型時,**同一片**必須把 `shipped_quantity` 加進不變式並改寫本 RPC —— 列為 **A8 的 contract 債**,寫進第 2 批的 definition of done,**不是「日後自動生效」** |
| 🔴 已付款取消 | **不得只回旗標**(R3),**也不能只有一個布林 + 金額**(R4)。⇒ 取消時**同交易**建立一筆 **退款工作(refund job)**:`status` ∈ `queued / processing / completed / failed`、應退金額、**自己的冪等鍵**、`failed_reason`、以及 **`order_refunds.id` 的 nullable 關聯**(第 3 批退款帳本建好後回填)。第 3 批的退款線以 `queued` 為工作來源;失敗補償 = 既有 `email_outbox` 的 retry/死信慣例(**指名該機制,不寫「走 outbox 慣例」這種沒有指涉的話**)。🔴 **第 19 項的綠燈掛在退款工作能被建立且看得到,不是掛在取消按鈕能按** |

#### 5.1c 計數器跨欄不變式(第 1 批版本)

`ordered_quantity ≤ quantity`、`instock_quantity ≤ ordered_quantity`、`cancelled_quantity ≤ quantity`。
🟡 第四條 **`instock + cancelled ≤ quantity` 暫不上**(它會禁止「已到貨再取消」,而那個語意 = §8.6 **Q17** 待拍;Q17 答完由對應片補上或永久移除)。
⚠️ 出貨與退貨的不變式**隨它們的軸在第 2/3 批一起加**(§1 原則 2),此處不預先寫。

🔴 **綠燈只掛在鏈末**(原則 4;codex R2 抓「A4/A5/A6 只有 RPC 就宣稱變綠」):
schema 片與 RPC 片**一律不宣稱任何項變綠**,綠燈落在**同時具備讀取路徑與 UI 且有驗收證據**的那片。
本批綠:**3, 4, 5, 6, 7, 19**,以及第 **1** 項的一部分(看得到今天有什麼,完整待辦要等第 3 批)。

⚠️ D1 是本批**唯一不可逆**的一片 ⇒ 見 §8.4 的獨立批准閘與驗收矩陣。

#### 5.1a 版面規格(repo 內可驗字面,取代 artifact)

**12 欄**:訂單編號(含付款軸小字)/ 日期 / 品牌 / 料號 / 品名 / 數量 / 金額 / 客戶(含等級小字)/ 訂貨 / 出貨 / 發票 / 操作。

| 動作 | 欄 | 理由 |
|---|---|---|
| 合併 | 單價 + 總金額 → 「金額」 | 🔴 **2026-07-28 實查更正**:39 個品項列 **`quantity` 全為 1**(`max(quantity)=1`)⇒ 單價 = 該列小計,兩欄數字相同;**但有 5 張單是多品項單**(39 列分佈在 29 張單)⇒ 那 5 張的整單總額 ≠ 任一列單價。**規則必須是「品項列 >1 **或** 任一列 `quantity` >1 就在合併格顯示整單總額」** —— v1 只寫了 `quantity >1` 這半條,會讓多品項單看不到總額 |
| 移除 | 會員等級 | 併進客戶格第二行小字 |
| 移除 | 商品狀態(9 碼下拉) | 退場,原地換成訂貨 + 出貨兩欄 |
| 改寫 | 日期 → `07/25` | **跨年才補年份**(`2025/06/27`);完整時間戳仍在 DB |

**三軸落點**:付款 = 訂單層(rowSpan 合併格內小字,「待付款」PCM 紅 `#E73928`)/ 訂貨、出貨 = **品項層**膠囊。
🔴 **膠囊顯示 `n/m` 不是二元**(#44):`已訂 2/3` 這種混合態必須看得出來,滿量才變純色(訂貨黃、出貨綠;未做灰)。
🔴 快遞單號在列表點一下即複製、**單號本身就是按鈕**、不另加圖示(第 2 批生效)。
⚠️ 「列高/欄寬不增加」= **待實作時實測**,不是已驗事實(#67)。

🔴 **驗收盲區(D1 的副作用,誠實列出)**:那 5 張多品項單全都在要被刪的 26 張裡(3 張留存單各只有 1 個品項,實查)
⇒ **D1 之後 production 沒有任何多品項單、也沒有任何 `quantity` >1 的列**。
於是 rowSpan 合併格、`n/m` 膠囊、整單總額顯示這三件事**在第 1 批無法用真實資料肉眼驗**。
**對策**:A11/A12 必須附 smoke test 用假資料覆蓋「多品項 + 部分數量」情境,並在 plan 明寫「Sean 這批看不到合併格效果」,
**不得因為畫面上看起來正常就宣稱這三件事已驗**。

### 5.2 第 2 批(工作項 + 依賴;開批時才拆片)

> **為什麼不現在拆到片**:第 1 批會改變 `order_items` 的形狀與 RPC 慣例,現在拆的片八成要重拆。v1 的 67 條裡有 3 條總結性 must-fix 就是「片太大」——**現在硬拆等於再猜一次**。開批前跑一次拆片 + 關卡1,是比較便宜的路。

0. 🔴 **N3a 共用產號 helper**(R5 前移:`shipment_reference` 要共用它;順序見 §5.0)
1. `shipments` + `shipment_items` 模型(U1;🔴 **Q16=A 同一位客人 + 同一份收件資料**,DB 層擋;**soft delete、永不硬刪**)
2. 出貨 owner RPC(`shipment_reference` 由 N3a 產生、重試在本層;🟡 後綴語意待 §8.6 **Q19**)
2b. 🔴 **A8 contract 債**(§5.1b):`shipped_quantity` 加進不變式 + 改寫已出貨禁取消檢查 —— **本批 definition of done**
3. 出貨輸入 UI + 追蹤連結 + 單號點擊複製(列表出貨軸此時才「活」)
4. 手機出貨兩步守門(UX §5 #23)
5. 新竹 API 失敗/重送安全:請求識別值 + 原始回覆 + 三段狀態(UX §4 #17)
6. 出貨通知給客人(接既有 `email_outbox`,**不另起管道**)
7. 內部通知(U4:LINE OA 推播 + 每日彙整 Email)—— **前置 = 通知矩陣拍板 + 兩位員工加 OA 好友取得 userId**
8. 列印出貨單 / 揀貨單
9. **前台 #240 訂單詳情頁**(逐包裹單號 + 追蹤連結 + 品項進度)

### 5.3 第 3 批(工作項 + 依賴;開批時才拆片)

1. `order_payments` 收款帳本(U3 多筆匯款 / 四格 / 催款 / 溢款處置)
2. 匯款退款去向(受款帳戶 + 複核 + 參考號 + 防重複匯款,UX §1 #3)
3. `order_returns` / `order_return_items` + `order_refunds.return_id`(#31)
4. 🔴 **退款寫入線 RF2b-RF8** —— 見 §6.2 與 **Q3**
5. `order_internal`(U5 負責人 + 下次跟進日,service_role only)
6. 改單(U2 改全部 + 直改極簡 + 已裝箱部分鎖定 + 逐動作 event log)
7. 稽核線:**先補 `GRANT SELECT ON admin_audit_log TO service_role` 的 M 片**,再做讀取 RPC,最後才 UI(#35/#36)
8. 待辦檢視 / 今日對帳(依賴 1、5,以及第 2 批的出貨與異常)
9. 訂單匯出
10. **admin 專用建單 RPC + 手動建單表單** —— 🔴 **開批決策閘**:自由品項的價格算法、稅/折扣、客戶與地址、付款狀態、庫存影響、經銷價權限**六題未拍板,未拍不開工**(#33)

### 5.4 訂單編號改 6 碼亂碼(獨立線)

> 🔴 **順序見 §5.0(唯一權威),本節不再自帶順序**(R5 抓:全檔曾同時存在三個相反順序)。
> 摘要:D0/D1 在第 1 批;**N3a 已前移到第 2 批最前**(`shipment_reference` 要共用它,R5 抓依賴不閉合);
> N3b/N3c 在第 3 批末;N2 獨立。admin 建單 RPC(第 3 批)自然晚於 N3a。

**動機(Sean)**:避免客人從 `PCM-2026-0104` 推測年度訂單量。

**碰撞機率更正**(v1 數字錯,#51):字母表依 v1 自己的字面 = 36 英數 −(`0`,`O`,`1`,`I`,`L`)−(`A`,`E`,`U`)= **28 字元**,不是 32。

| 長度 | 28 字元可能組合 | 10 年約 3000 張單「首抽至少一次碰撞」 |
|---|---|---|
| 5 碼 | 17,210,368 | 約 **23.0%** |
| **6 碼(採用)** | 481,890,304 | 約 **0.929%** |

結論用 6 碼**仍成立**(0.9% 且有重試),但這是**首抽碰撞率、不是建單失敗率**(#52)。

#### 5.4a 產號合約(codex R2 抓「規格沒寫死就不算銷案」,#52/#53 的真正解)

以下全部是**可測合約**,片級 plan 不得再改寫:

| 項 | 值 |
|---|---|
| 字母表 | `23456789BCDFGHJKMNPQRSTVWXYZ` —— 28 字元(去 `0O1IL` 易混淆、去 `AEU` 母音);**大寫 only** |
| 長度 | 固定 **6** |
| 前綴 | **無前綴**(舊格式的 `PCM-` 不沿用;要靠前綴辨識就失去「看不出量」的目的) |
| regex | `^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$` |
| 亂數源 | `gen_random_bytes()`(pgcrypto);**禁 `random()`**(非密碼學安全、可預測 ⇒ 客人能猜別人單號) |
| 取樣法 | rejection sampling(256 mod 28 有偏差 ⇒ 落在 `>=252` 的 byte 丟棄重抽),**不得用 `% 28`** |
| unique | 具名約束 `orders_display_id_key` |
| 重試 | 上限 **5** 次,只捕捉 `unique_violation` **且** `constraint_name = 'orders_display_id_key'`;其他 unique violation **原樣上拋** |
| 用盡 | `RAISE EXCEPTION` **明確報錯、不靜默、不降級**(前例:報價單短編號用盡誤報成 500 系統當機)。🔴 **告警落點定死**(R5 抓「三選一沒選」):DB 函式只負責 `RAISE`(SQLSTATE `P0001` + message 含 token `pcm_display_id_exhausted`);**application 層(placeOrder use-case 與 admin 建單 action)catch 該 token 後,走既有 `LineAlertNotifierAdapter` 送 LINE 告警 + server log**。不走 `email_outbox`(其 event allowlist 不含此事件,R5 實查;不為告警動 migration)|

#### 5.4b 拆片(R2 重拆:原 2 片仍混層)

| 片 | 型 | 內容 |
|---|---|---|
| ~~**N1**~~ | — | ❌ **取消**(Q2=A):domain 永遠不需要同時吃新舊兩種格式 |
| **N2** | **D** | `display-id.ts` 依 §5.4a 換成新格式 + 測試。🔴 **不是只刪 `parseDisplayId`** —— `formatDisplayId(year, seq)` 也**還在產舊格式**,連同 `DISPLAY_ID_PATTERN`、`MIN_SEQ_DIGITS`、barrel export、型別註解、消費端測試**全部一起換掉**(R3 抓) |
| **N3a** | R | 🔴 **共用產號 helper**:`public.pcm_generate_display_id() RETURNS text`。**先於任何消費端存在**(R1 #32 / R2 / R3 / R5 四次點名);🔴 **R5 前移到第 2 批最前** —— `shipment_reference` 也要用它。合約:SECURITY DEFINER、`SET search_path = ''`、pgcrypto 函式一律 schema-qualify(`extensions.gen_random_bytes`)、建後 `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`(只留 owner 與需要的 definer 函式)、依賴檢查 assert pgcrypto 已裝 |
| **N3b** | R | `create_order` 改呼叫 helper。🔴 **重試迴圈寫在這一層、不在 helper 裡**(R3 抓:helper 只回候選值,不可能捕捉 INSERT 的 unique violation)—— 迴圈上限 5、只捕捉 `unique_violation` 且 `constraint_name = 'orders_display_id_key'`、用盡 `RAISE` + 告警。654 行金流函式,必過 codex 關卡2 + Sean 1 元真刷 smoke |
| **N3c** | M | 🔴 **收窗**:把 D1 之後、N3b 之前產生的**舊格式新單一併改號**,再把 CHECK contract 成新格式 only。**同一交易**:鎖列 → 逐列改號(舊號寫進 `legacy_display_id`)→ 收緊 CHECK → assert 零舊格式殘留。🔴 **逐列產號合約**(R5 抓漏):每列各自有界重試(同 §5.4a 上限 5)、只捕捉 `orders_display_id_key`、**任一列用盡 = 整交易 `RAISE` 回滾**(不留半改狀態);附負向碰撞測試(預插衝突值證明會重試) |

🔴 **D1 需要 3 個新號但 N3a 還不存在**(R3 抓):
⇒ D1 **不呼叫 helper**,而是在 runbook 內**寫死經 §5.4a 合約產生並人工驗證過的 3 組 `舊號 → 新號` 映射**,
並 assert 三個新號符合 regex、彼此不重複、且不與任何既有值衝突。**第 1 批因此仍不依賴 N3a。**

🔴 **codex R2 抓到而上一版漏掉的**:D1 到 N3b 之間 `create_order` 仍在產舊格式,
所以**「N3 直接收緊 CHECK」不成立** —— 那個窗口內會有新的舊格式單。**N3c 就是為此存在的**。
⚠️ N3b 與 N3c 之間的窗口要盡量短(同一次部署),但 N3c 必須**獨立驗證零殘留**,不能假設窗口為空。

⚠️ **一個我原本寫錯、已更正的約束**:先前寫「N2 與 N3 必須同一次部署,否則結帳全斷」——
**不成立**。實查:`assertDisplayId` 的唯一呼叫點是 domain factory `createOrder`(`order.ts:253`),
而 **`createOrder` 全樹沒有任何生產呼叫端**(只有測試用;結帳走 `placeOrder` → `create_order` RPC,
拿回的 `displayId` 是**純字串直接傳遞**,`packages/use-cases/src/place-order.ts:18` 註解逐字說明兩者同名不同物)。
⇒ **N2 是純型別/測試層改動、對結帳零 runtime 影響,可獨立上線。**

**已移除的 v1 待做項**:「排序改 `created_at`」—— 實查 `SupabaseOrderAdapter.ts:270-272` 已是 `created_at DESC, id DESC`,不是待做(#54)。
⚠️ `orders.display_position` 實查全為 NULL、未使用,不可當排序鍵。

---

## §6 完成定義與誠實邊界

### 6.1 E10 完成 = 27 項中這 17 項全綠

1(今天要處理什麼)/ 3(備註)/ 4(標進度·批次)/ 5(已向供應商下單·item 層)/ 6(供應商單號與到貨)/ 7(缺貨要等)/ 8(輸入快遞單號)/ 9(單號追蹤)/ 10(列印)/ 11(出貨通知)/ 12(手動建單)/ 13(改訂單)/ 15(匯款確認)/ 16(今日對帳)/ 17(退款)/ 18(退貨)/ 19(取消)

🔴 **加上前台回路**(UX §3 #14 明定,v1 漏,#41):**#240 訂單詳情頁**與 **RF6 部分退款顯示**。後台做完而客人端仍斷 = 沒閉環。
🔴 **第 27 項(誰改了什麼)的天花板**:UI 可做,但操作者仍是自己下拉挑的(`session/actor.ts:6` 自陳非授權邊界)⇒ **E8-B 上線前不得宣稱第 27 項達成**。

### 6.2 🔴 第 17 項(退款)做不完的實情

`order_refunds` 帳本在 production,但:

- ACL = **service_role SELECT only**(`20260725130100:326-327`)
- 寫入依設計走 **RF2b 的 owner RPC —— 該 RPC 尚未施工**;RF2b→RF8 整段在 `PROGRESS.md:780-787` 明列待做

⇒ v1 說 O14 是「接既有帳本做 UI」**不成立**;做完 UI 仍然按不下退款(#29/#30)。
Sean 已拍 N5「訂單域做到目標狀態才算數、不接受做一半」⇒ **E10 要嘛吃下 RF2b-RF8,要嘛第 17 項不綠**。這是 **Q3**。

### 6.3 其他誠實邊界

- **不給總片數與總工期**。**第 1 批 = 40 片**(R5 折入後;**唯一有效來源是 §5.1 那張表、且一律 `awk` 當場數**)。第 2/3 批開批時才拆片,**現在給的數字必然是假的** —— v1 同檔寫過 24 / 22、高風險 13 / 12(實際 15),就是這麼來的(#61/#62)
- 🔴 **第 1 批 14 → 26 → 31 → 34 → 40 片是五輪審查的結果、不是範圍擴張** —— 同樣的工作拆到每片真的能在 45 分鐘內做完並獨立驗收。**「片太大」R1/R2/R3/R4 四輪都判**,是本線最頑固的一類 finding
- 🔴 **片型分佈我親手寫錯過兩次**(R3 寫 R5/A7/U10、R4 寫 M5/A7)⇒ 該行**只准 `awk` 數完貼上**,禁止手算
- 27 項現況沿用 2026-07-26 read-back,**至今未重驗**(A0 補)
- 視覺 artifact 未讀取,版面以 §5.1a 文字為準(#66)
- E8-B plan v3 的 34 條 must-fix **仍未重寫折入**;本檔只記錄狀態
- 報價單 repo **不能跑 `supabase db push`**(本地 146 檔 vs ledger 160 筆版本號零重疊)—— 與 E10 無關,但 E8-B 開工前必處理

---

## §7 實作約束

### 7.1 逐批啟用閘(#3)

`dev` = pcm-admin 正式站,**推即部署**,沒有「先上測試站看看」。⇒

- **M 片可以先上**(expand-only、零行為改動、舊程式照跑)
  🔴 **D1 不在此列 —— 它是 runbook 型不是 M 型**(R5 nit 抓片型字面):刪 production 資料、不可逆、沒有 flag 能擋。
  走 §8.4 的獨立閘序,**不與任何 M 片同批 apply**
- **U 片**一律掛 **env flag**(預設 off),Sean 肉眼驗過該批再開
- 新版列表版面(A11)與舊版**共存於同一 flag 之下**,回退 = 關 flag,不是 revert migration
- 🔴 **migration 不能靠 `git revert` 回復**(revert 檔案不會移除已套用的 schema)

### 7.2 訂單列表的 rowSpan(v1 寫錯,已更正 #48/#49/#50)

🔴 **v1 說「篩選必須在資料層做」—— 這是錯的。** 親讀 `orders-table.tsx:64-77`:`rows = order.lines`、`rowSpan = rows.length`,rowSpan 是從**手上這份 lines** 算的。
**正確約束**:篩完之後**必須重新分組並重算 rowSpan**;**禁止**對既有 DOM 用 CSS/JS 隱藏列(那才會讓合併格連同單號與客戶一起消失)。資料層或畫面層都可以篩,重算與否才是關鍵。

🔴 **v1 說「不做整單彙總徽章」—— 過度概化。** `:86-93` 註解逐字只證明:`!inner` 投影回不完整品項時,拿那份資料算彙總會把混合單誤顯為全同。**完整投影或 DB 聚合仍可正確顯示。**
**正確約束**:彙總的資料來源必須是完整的品項集合;用篩選後的投影算彙總 = 錯。

**分頁維持以「訂單」為單位**(`ORDERS_PAGE_SIZE = 20`,`order-list-view.ts:26`)。改成品項分頁會拆散 rowSpan 群組(#50)。300 張單的列數壓力由篩選與待辦視圖吸收,不靠改分頁單位。

### 7.3 為什麼第 1 批不套 `<AdminDataTable>`(#23)

積木自陳批次選取未做,且註解逐字警告:接 `orders-table` 會因桌機/手機雙渲染產生**重複表單與重複 client 狀態**(`ItemWorkflowStatusCell` 是包 `<form action>` 的 Server Component)。
⇒ 批次選取**直接做在 `orders-table`**。積木化等**第三個消費端**出現再說 —— 這正是「E11 積木按需長出來」的意思,不是推翻 N4=A。

### 7.4 其他紅線(沿用)

- 金額一律整數(分/角)或 `Decimal`,**禁 `number`**
- 經銷價:員工可見、一般會員 client 全擋,三層防護不得放寬
- **訂單量預期 1-300 筆** ⇒「量小所以不用做」一律失效
- codex 關卡2 `-m gpt-5.6-sol` **必顯式帶**(預設是 terra);它說「因沙箱限制未驗證」= **未知**,不等於會過;**build 一律主對話自跑**
- 突變測試先 `grep` 驗替換真的發生
- UI **禁 emoji 與驚嘆號**(CLAUDE.md 標紅線)
- **不自動 push**

---

## §8 Sean 2026-07-28 拍板

| 題 | 拍板 | 連動 |
|---|---|---|
| **Q1 整單彙總狀態** | ✅ **B 不維護** —— `orders.fulfillment_status` **凍結不動、不再由計數器驅動**;篩選改走品項層條件(例「有品項還沒訂貨」) | 見 §8.1 |
| **Q2 舊訂單處理** | ✅ **A 砍 26 張無金流的 + 3 張有金流的改號** —— 雙格式支援整片取消,見 §8.3 / §8.4 |
| **Q5 `PCM-2026-0104` 的 NT$1,180** | ✅ **Sean 2026-07-28 口頭確認「TapPay 都已經退款」+ 授權「怎麼處理都好」** ⇒ D1 片一併把 0052 / 0104 的 `payment_status` 改為 `refunded` 讓 DB 對齊事實。🔴 **來源=Sean 口述,未經 TapPay API 查證**(`TapPayChargeAdapter.recordQuery` 可查,需要時再跑) |
| **Q3 退款完成定義** | ✅ **A E10 吃下 RF2b-RF8** —— 第 17 項才算真的綠 | 見 §8.2 |

### 8.1 Q1=B 的連動(四條 findings 因此消失)

- ❌ **不加 `backorder` enum 值** ⇒ v1 的 O5 整片取消。連帶 #17(enum 不可 contract)、#20(order 層 vs item 層)、#19(`delivered` 無 writer)**不再適用**
- ❌ **不做「計數器 → 訂單層 enum」的同步 trigger** ⇒ #16 只剩「誰原子更新計數器」一半(A4 owner RPC 回答)
- ✅ **N-2 衝突自動消解**:既然不驅動 `fulfillment_status`,`FULFILLMENT_TRANSITIONS` 的禁倒退規則就碰不到;品項層「來回改」= 計數器加減,本來就沒有方向限制
- ⚠️ **代價(明寫)**:訂單列表**失去**「整單出貨到哪」的單欄快篩。替代 = 品項層條件篩(`order_items` 已有 `workflow_status` 索引與 `!inner` 投影先例)。主規格 §3.1 曾寫「PCM 必須維持實體 enum 欄 + 索引,由 trigger 從計數器同步」(引 Medusa issue #14095)—— **該句被本次拍板推翻**,理由:那是研究結論非 Sean 拍板,且 PCM 的篩選需求在品項層就滿足
- 🔴 `orders.fulfillment_status` 欄**保留不 DROP**,但 COMMENT 必須標 **「E10 起停止維護、值為 legacy stale、不得當現況真相」** —— **不可寫成「衍生顯示」**(codex R2 抓:既然沒有 writer 在維護它,叫「衍生顯示」會讓後人以為它跟得上真相)
- 🔴 **A9c 同片移除現行用 `fulfillment_status` 的列表篩選**,改成品項層條件。留著舊篩選 = 給員工一個會騙人的篩選器

### 8.2 Q3=A 的連動(E10 範圍變大,明寫)

E10 **吃下退款寫入線**:`order_refunds` 的寫入 owner RPC(RF2b)+ ACL + 覆核(RF8)進第 3 批。
⇒ 第 3 批的體積明顯大於 v1 估計。**這是 Sean 知情後的選擇**(N5「訂單域做到目標狀態才算數」的一致結果),不是範圍蔓延。
⚠️ RF2b-RF8 的既有規格散在 M-3 退款線文件,第 3 批開批時要先把它們對齊本檔的一片一層原則,**不是直接照抄舊拆片**。

### 8.3 🔴 Q2:「訂單都是假的」實查後不成立於全部 29 張

2026-07-28 production 實查(`bmpnplmnldofgaohnaok`):

| 單號 | 金額 | 付款狀態 | 實況 |
|---|---|---|---|
| 其餘 **26** 張 | — | `unpaid`、無 `paid_at` | ⚠️ **不是「零風險」** —— 其中 3 張有 `pending` 刷卡紀錄(見下)。正確說法 = **經 Sean 外部查證 TapPay 後核准刪除**,證據等級記在下方 |
| `PCM-2026-0052` | NT$6,800 | **`paid`**(2026-06-23) | 有 TapPay 交易紀錄。早於正式站首筆真刷(07-24 的 0102)⇒ 推測為 sandbox。**推測不算證據** ⇒ 由下方「金流證據前置」統一以 TapPay read-back 定案 |
| `PCM-2026-0102` | NT$101 | `refunded`(2026-07-24) | 史上第一筆正式站真刷,已退款 |
| `PCM-2026-0104` | NT$1,180 | **`paid`**(2026-07-25) | RF2a-0 驗證真刷。**Sean 2026-07-28 確認 TapPay 端已退款**(DB 尚未反映 ⇒ D1 第 9 步對齊) |

**三張 `order_refunds` 帳本列數皆為 0** —— 因為 RF2b 寫入 RPC 從未施工,0102 的退款是在系統外做的、只把狀態翻成 `refunded`。

**刪除的實際阻擋(FK 實查)**:`order_items`(39 列)與 `order_legal_consents`(4 列)是 CASCADE 可自動走;但
`payment_charge_attempts`(27 列,NO ACTION)、`pending_invoices`(3 列,NO ACTION)、`email_outbox`(0 列,RESTRICT)
的 FK 規則**不會自動 CASCADE**,所以**指向待刪訂單的子列**必須先處理。
🔴 **但實查後只有 `payment_charge_attempts` 真的需要動(24 筆)** —— `pending_invoices` 那 3 筆**全部屬於要保留的訂單、一筆都不能碰**,`email_outbox` 是 0 列。
詳見下方相依資料表。`payment_charge_attempts` 是 3DS 雙扣防護的刷卡嘗試帳本。

**關鍵事實(讓第三條路成立)**:🔴 **TapPay 的 `order_number` 送的是 `orders.id`(UUID)、不是 `display_id`**
(`packages/adapters/src/tappay/TapPayChargeAdapter.ts:91` 逐字 `order_number: payload.orderId`)
⇒ **改 `display_id` 不會影響 TapPay 對帳**。

**因此有第三條路(推薦)**:砍掉 26 張沒金流的,**把 3 張有金流的改號成新格式**。
效果 = 全表統一新格式(雙格式支援不用做,Sean 要的省事達成)+ 金流紀錄與雙扣帳本完整保留。
⇒ **N1 片(display-id 雙格式)可整片取消。**(CHECK 的最終狀態是新格式 only,但中間仍需一段暫時同時接受兩種的期間 —— D0 放寬 → N3c 收緊,順序見 §5.0。)

✅ **Sean 2026-07-28 拍 A**(砍 26 + 改號 3)。

### 8.5 R3 之後 Sean 再拍三題(2026-07-28)

| 題 | 拍板 | 落地 |
|---|---|---|
| **Q10 併箱的新竹編號** | ✅ **A 包裹自己有一組獨立編號**(`shipments.shipment_reference`),送新竹用它、**與訂單編號脫鉤** | 解掉 **P1 與 U1 互相矛盾**(兩者都是 Sean 拍板):P1 的後綴以「訂單編號-序」為基底,但 U1 允許一箱裝多張訂單 ⇒ 該箱沒有唯一基底訂單號。新竹只要求「同日不重複」、未要求必須是訂單號(`hct-logistics-api-reference.md:121`)⇒ 獨立編號完全滿足。**P1 的「自動加後綴」語意改為:後綴掛在 `shipment_reference` 上,不是掛在訂單編號上** |
| **Q11 文件深度** | ✅ **C 兩份分開** | **本檔 = 施工規格**(給 AI / codex 審,深度不設限、細節愈死愈好);**全貌給 Sean = 視覺呈現**(artifact,Q8=B 的動工前置)。⇒ 本檔不再為了「Sean 看得懂」而犧牲精確度;Sean 端的可讀性由視覺物件負責 |
| **Q12 前台 stale 出貨狀態** | ✅ **B 前台改顯示「處理中」**,等第 2 批包裹真相就緒再換真資料 | 見下方 stale reader 清單 |

#### 🔴 `fulfillment_status` 的 stale reader 全樹清單(R3 抓,主對話 grep 補完)

Q1=B 之後這個欄位**沒有 writer 在維護**。上一版只排了「移除列表篩選」,實查**全樹 8 處在讀**:

| 位置 | 面向 | 處置 |
|---|---|---|
| `apps/storefront/…/OrdersTab.tsx:45` | 🔴 **客人** | Q12=B:改顯示「處理中」 |
| `apps/storefront/…/OverviewTab.tsx:108` | 🔴 **客人** | 同上 |
| `apps/admin/…/order-detail.tsx:202` | 員工 | 移除該欄,改顯示品項層訂貨狀態 |
| `apps/admin/…/customer-detail-sections.tsx:71` | 員工 | 同上 |
| `apps/admin/…/order-filter-bar.tsx:36` | 員工 | 移除篩選 |
| `apps/admin/…/order-list-view.ts:31,149,184` | 員工 | 移除參數與解析 |

⚠️ **這是我這輪的復發**:codex 只點名了明細頁,我原本也只排了列表篩選。
**同類必須全掃** —— memory `feedback_claimed-sync-but-only-patched-touched-lines` 記著「已復發 9 次以上」,這是第 10 次。

#### 🔴 併箱的客人邊界 —— R4 再修正:光靠投影擋不住

R3 的解法是「表 service_role only + own-order 安全投影」。**R4 指出那還是漏的,成立**:
同一箱只有**一個快遞單號**與**一份收件快照**,不管投影怎麼切,
把追蹤號給了 A 客人就等於把「B 客人那箱」的追蹤號也給了他 —— 他查得到整箱的物流狀態。
而且一箱只能有一份收件人資料,多客人併箱在物理上就矛盾。

⇒ **併箱限制為「同一位客人 + 同一份收件資料」**,不符即**禁止建立該包裹**(DB 層 CHECK / trigger,不只 UI 擋)。
✅ **Sean 2026-07-28 拍 Q16=A 確認要限制**(在得知這縮小了 U1 原始語意、以及「若實務上會把不同客人的貨併箱寄同一地點就會被擋」之後仍選 A)。
⇒ **U1「多單併一箱」的最終語意 = 同一位客人的多張訂單併一箱**,跨客人併箱**不做**。
這是對 07-26 U1 的**範圍縮小、非推翻**:併箱能力仍在,只是限定同客人。

#### 🔴 `shipment_reference` 產號合約(Q10=A 引入,R4 抓「只說獨立編號、不可施工」)

| 項 | 值 |
|---|---|
| 用途 | 送新竹的 `epino`(訂單編號欄),**與 PCM 訂單編號完全脫鉤** |
| 唯一範圍 | **全表 unique**(不是「同日 unique」——新竹只要求同日不重複,全表 unique 是更強的保證且更好查) |
| 格式 | 沿用 §5.4a 同一組字母表與長度(**6 碼**),**共用 `pcm_generate_display_id()` helper**,不另發明第二套 |
| 分批後綴 | `shipment_reference` 本身即唯一 ⇒ 技術上**不需要後綴**。🟡 **但 P1「自動加後綴」是 Sean 拍板,主對話不得自行作廢 ⇒ §8.6 Q19 待 Sean 正式裁定**(R5 抓:同檔一處說後綴掛 reference、一處說不需要後綴 = 兩個語意並存) |
| 刪除後 | **永不重用**。🔴 **實作 = 包裹永不硬刪**(R5 抓:live-row UNIQUE 在 DELETE 後會釋放值,「永不重用」光靠 unique 約束**不成立**)⇒ `shipments` 走 soft delete(`deleted_at`),列與 reference 永久保留 = tombstone;重送同一包裹沿用原值 |
| 長度守門 | ✅ **長度已驗**:`epino` = **Char(30)**(`hct-logistics-api-reference.md:81`,R5 抓:我寫「未驗」但答案就在自己檔案裡)⇒ 6 碼遠低於上限。🟡 **允許字元仍未知**(文件未載)= 外部確認閘,Sean 申請 API 時問新竹;**只有這一項擋出貨片** |

🔴 **P1 的字面必須全樹統一**(R4 抓「同檔存在兩個基底語意」):
`§3 C1`、`§5.2`、`docs/reference/hct-logistics-api-reference.md` 三處的「訂單編號-1/-2」**一律改為 `shipment_reference`**。
HCT 參考檔已於本輪同步;C1 與 §5.2 見下。

#### 🔴 D1 是 runbook 不是 migration(R3 抓)

D1 寫死 production UUID 與「29 → 3」斷言 ⇒ **在本機 / preview / 全新 DB 重播必然失敗**。
⇒ **拆兩件**:①可重播的 schema migration(CHECK 放寬)②**一次性 production data runbook**(含環境身分守門:
執行前 assert 連到的是 production 專案、否則 abort)。**不要把一次性資料操作放進 migration 序列。**

#### 🔴 其他 R3 修正

- **A14 的「建手動單」是死按鈕** —— 建單第 3 批才有 ⇒ 第 1 批**不放該動作**(或放但 disabled 並寫明原因),第 3 批再啟用
- **改號會讓客人手上的舊單號失效** —— D1→N3b 窗口內寄出的信帶舊號,N3c 又改號 ⇒ **必須保留永久 alias**(`orders.legacy_display_id`),客服與查詢都吃得到舊號
- **計數器不得獨立手填**(R3 重申 R2 未解):`ordered_quantity` / `instock_quantity` **由 `order_item_procurement` 的具名數量與狀態原子推導**,A4 不提供「直接改數字」的入口
- **`allocated_quantity` 跨列合計不能用一般 CHECK**(CHECK 只看單列)⇒ 改用 **owner RPC 內鎖住該 `order_item` 後重算** 或 constraint trigger,並補併發負向測試
- **FK 匯出清單補 `payment_double_charge_anomaly_events`**(實查存在、0 列,經 `payment_double_charge_anomalies` 間接關聯 orders)
- **D1 鎖列範圍**:不只鎖 29 張 orders,**同時鎖住目標 child rows**(`payment_charge_attempts` 等),否則重驗後、刪除前仍可能被付款流程改成 charged

### 8.4 Q2=A 的落地(D1 片)與它省掉的東西

**再查兩層(讓改號安全的關鍵)**:

1. `assertDisplayId` 全樹只出現在 `packages/domain/src/order/order.ts:253`(domain factory `createOrder` 內)
   + barrel export + 測試;`apps/` 與 `packages/adapters/` **零命中**
2. 而 **`createOrder` 這個 factory 全樹沒有任何生產呼叫端** —— 結帳走 `placeOrder` → `create_order` RPC,
   回來的 `displayId` 是**純字串直接傳遞**(`packages/use-cases/src/place-order.ts:18` 註解逐字點明
   `placeOrder` 與 domain factory `createOrder` 同名不同物);admin row mapper 同樣只當字串傳

⇒ **改號後的 3 列不會被任何路徑驗證或拒絕。** 唯一會擋的是 DB 的 CHECK 約束,而那正是 D1 第 4 步在處理的。

**因此省掉的**:
- ❌ **N1 舊新雙格式支援整片取消**(#55/#56 的解法從「同時吃兩種」降級為「換掉」)—— domain 只需在 N2 把舊格式**換成**新格式,永遠不必同時支援兩種
- ⚠️ **但 DB 的 CHECK 仍需一段「暫時接受兩種」的期間**(**D0 放寬 → N3c 收緊**)。這跟 domain 無關,純粹因為 `create_order` 在 N3b 之前還在產舊格式。**別把這兩件事搞混**:domain 零雙格式、CHECK 有一段雙格式窗口

**D1 片(runbook 型、🔴 高風險:③DB 不可逆 + ①錢面資料;R5 nit 抓「仍稱 M 型」已更正)—— 順序見 §5.0**:

**🔴 相依資料實查(2026-07-28,`paid_at IS NOT NULL` = 留存的 3 張)—— 上一版寫錯,已更正**:

| 相依表 | 屬於留存 3 張 | 屬於待刪 26 張 | D1 要做什麼 |
|---|---|---|---|
| `payment_charge_attempts` | **3** | **24** | 刪那 24 筆(NO ACTION、不先清會擋住 DELETE) |
| `pending_invoices` | **3** | **0** | 🔴 **一筆都不能動** —— 3 筆全屬留存單。上一版寫「刪 26 張的 pending_invoices」是錯的:不但是 no-op,照字面做還會刪到要保留的發票紀錄 |
| `order_legal_consents` | **2** | **2** | CASCADE 帶走 2 筆(全表 4 筆,**不是 4 筆全走**) |
| `order_items` | **3** | **36** | CASCADE 帶走 36 列(全表 39) |
| `email_outbox` / `order_refunds` / `order_refund_items` / `payment_double_charge_anomalies` | 0 | 0 | 全表零列,無動作 |

**trigger 實查**:`orders` 只有 `orders_freeze_shipping_snapshot_bi`(**BEFORE INSERT**)⇒ D1 的 DELETE 與 UPDATE 都不會觸發它;`order_items` 零 trigger。

#### 🔴 待刪組裡有 3 筆 `pending` 刷卡紀錄 —— Sean 已裁定

實查:待刪的 24 筆 `payment_charge_attempts` 狀態分佈 = `failed` 12 / `released` 9 / **`pending` 3**。
`pending` = **刷卡送出但系統從未收到結果**,不是失敗、是不知道:

| 訂單 | 金額 | 訂單狀態 | 刷卡紀錄 | 日期 |
|---|---|---|---|---|
| `PCM-2026-0064` | NT$17,300 | `unpaid` | **pending** | 2026-06-26 |
| `PCM-2026-0090` | NT$31,400 | `unpaid` | **pending** | 2026-06-27 |
| `PCM-2026-0101` | NT$2,400 | `unpaid` | **pending** | 2026-07-21 |

⚠️ 這與既有金流紅線牴觸(memory `project_tappay-production-blackhole-settle-line` 逐字:
**「只有明確 failed 才動單、查不到/已扣款絕不移、移除須改標記非硬刪」**)。

✅ **Sean 2026-07-28 拍 Q7=C 並提供事實:「都沒扣到錢,已確認」** ⇒ 三筆照刪。
🔴 **證據等級寫明**:來源 = **Sean 本人查 TapPay 後的確認**,非系統 read-back;migration 註解與匯出檔都要記這句。
🔴 匯出存檔仍必須完整包含這三筆(刪除後唯一的紀錄就是那份檔)。

#### D1 執行規格

**閘序(R5 抓:上一版把批准閘放在 restore 演練之前 ⇒ Sean 批准時演練還沒做)**:
**步驟 1-6 全部做完**(含 restore 演練、TapPay read-back、完整 dry-run)→ 🔴 **停下、把全部證據交給 Sean、
取得「apply D1」明確批准** → 才跑步驟 7 起的正式交易。批准前不得執行任何正式 DELETE。此閘**不可與 A1 的確認點合併**。

**🔴 三組改號映射(依 §5.4a 合約產生、已驗 regex 與唯一性;R4 抓「宣稱寫死但全文沒有」)**

| 舊號 | 新號 | 備註 |
|---|---|---|
| `PCM-2026-0052` | **`YWP3PC`** | 舊號寫入 `legacy_display_id`(D0 已建欄) |
| `PCM-2026-0102` | **`BKPR5M`** | 同上 |
| `PCM-2026-0104` | **`ZNHY8B`** | 同上 |

執行前 assert:三值皆符 `^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$`、彼此不重複、與全表 `display_id` 及 `legacy_display_id` 皆不衝突。

| 步 | 動作 | 守則 |
|---|---|---|
| 1 | **環境守門**:assert 連線的 project ref = production(`bmpnplmnldofgaohnaok`),否則立即 abort | 🔴 **runbook 的第一行、不是註解**(D0 等 migration **不含**此 assert —— 它們可重播) |
| 2 | **固定 cohort**:以 `orders.id`(UUID)寫死 **26 筆待刪 / 3 筆留存** 的 allowlist **在 runbook 內** | 🔴 不用動態條件;**不進 migration**。🔴 **所有數量斷言一律 cohort 口徑**(R5 抓:全表 29→3 在「D1 前有新單進來」時必然失敗、還會誘使人擴大刪除範圍) |
| 3 | **cohort 匯出**:29 張及依 FK 反查的完整相依集合(`order_items` / `order_legal_consents` / `payment_charge_attempts` / `pending_invoices` / `email_outbox` / `order_refunds` / `order_refund_items` / `payment_double_charge_anomalies` / `payment_double_charge_anomaly_events`) | 🔴 **匯出工具 = 逐表 `COPY (SELECT … WHERE order_id = ANY(cohort)) TO`**(R5 抓:`pg_dump --data-only` **不能按列篩**,上一版寫法做不到)+ cohort manifest + 逐表 `sha256`。**0 列的表也要匯**(留空檔證明當時為 0)。`age` 加密、金鑰存 1Password、保存 180 天後銷毀、路徑與 checksum 回報 Sean |
| 4 | **兩支版本化 restore script + 實跑還原演練**(隔離 DB) | 🔴 依 FK 逆序;`restore-pre-n3c.sql`(舊 CHECK 環境)與 `restore-post-n3c.sql`(新 CHECK 環境,含 display_id 映射還原)**各演練一次** |
| 5 | **TapPay read-back**(金流證據,詳下節) | 對不上即 abort |
| 6 | **完整 dry-run**:`BEGIN` → 步驟 7-13 全跑 → 驗整張矩陣 → `ROLLBACK` | 🔴 R5 抓:上一版模擬只跑到鎖列就宣稱能驗 29→3 |
| 7 | 🔴 **Sean 批准閘**:1-6 的全部證據(匯出 checksum、演練紀錄、read-back 結果、dry-run 矩陣)交給 Sean,取得明確「apply D1」 | 批准前零正式寫入 |
| 8 | **正式交易 + fail-fast**:`BEGIN` → `SET LOCAL lock_timeout='5s'` / `statement_timeout='60s'` → 依固定鎖序 `FOR UPDATE`:①`orders`(cohort 29 列,按 `id` 排序)②`order_items` ③`payment_charge_attempts` ④`pending_invoices` → 交易內重驗 cohort 計數與金流狀態,漂移即 `RAISE` | 🔴 **鎖住 orders 列即同時擋住所有新 FK 子列**(FK 驗證需 KEY SHARE、與 FOR UPDATE 互斥)⇒ `email_outbox` 等 0 列表**不需列級鎖**,交易內重驗 = 0 即可(R5 抓「鎖清單與匯出清單不一致」的正確解法,附機制依據) |
| 9 | 刪 cohort 26 張的 `payment_charge_attempts`(assert = **24 筆**) | 🔴 **不碰 `pending_invoices`** |
| 10 | 刪 cohort 26 張 orders | CASCADE 預期:`order_items` **36 列**、`order_legal_consents` **2 筆** |
| 11 | 3 張留存單:`legacy_display_id ← 舊號`、`display_id ← 新號`(上表) | D0 已放寬 CHECK,本步不動約束 |
| 12 | `PCM-2026-0052` / `PCM-2026-0104` 的 `payment_status` → `refunded`(Q5) | 依步驟 5 的 read-back 證據 |
| 13 | 三筆 `pending_invoices` 的 `status` → **`voided`** | 🔴 R5 實查:live CHECK 只允許 `pending/issued` ⇒ **D0 必須先把 `voided` 加進 CHECK**,否則本步直接失敗。runbook 以 postgres 身分執行,不受 service_role SELECT-only 限制 |

#### 🔴 金流證據前置(D1 的硬前置,R3/R4 兩次抓)

Sean 已口頭確認「TapPay 都已退款」(Q5)與「那 3 筆 pending 都沒扣到錢」(Q7)。
**那是唯一讓紅線放行的事實,但它不是可稽核的紀錄。** ⇒ D1 執行前必須補一次 **TapPay read-back**:

| 對象 | 要取回並存檔 |
|---|---|
| `PCM-2026-0052` / `PCM-2026-0102` / `PCM-2026-0104` | `rec_trade_id`、授權金額、**`refunded_amount`(須等於授權金額 = 全額退)**、`record_status`、`transaction_time_millis` |
| `PCM-2026-0064` / `PCM-2026-0090` / `PCM-2026-0101`(3 筆 `pending`) | 同上;**確認為未授權 / 已取消** |

🔴 **「退款時間」拿不到、不列為證據**(R5 抓,主對話實查確認):`recordQuery` 的 wire 只回
`refunded_amount` 與 `transaction_time_millis`(`packages/adapters/src/tappay/wire.ts:68,87`),**沒有退款時間欄**。
證據以「`refunded_amount` = 授權金額」為準;要退款時間就得擴充 port,**本線不做**(足夠證明全額退)。

工具:`TapPayChargeAdapter.recordQuery`(唯讀、既有實作)。
**對不上就 abort,不進入刪除步驟。** 結果連同 Sean 的原話寫成一份 remediation audit 存進備份包。
⚠️ **這一步不是不信任 Sean** —— 是讓「當初憑什麼刪」在半年後翻帳時還查得到,而不是只剩一句對話。

**驗收矩陣(前後對照,codex R2 抓「只驗 orders 與 attempts 不夠」)**:

🔴 **全部 cohort 口徑**(R5 抓:全表數字在 D1 前有新單進來時必然失敗):

| 檢查 | 期望 |
|---|---|
| cohort 26 張待刪 orders | → **0**;cohort 3 張留存 → **仍在** |
| **非 cohort 訂單** | 列數與內容**逐 byte 不變**(執行前後快照 checksum 比對) |
| cohort 的 `order_items` | 36 → 0;留存 3 列仍在 |
| cohort 的 `order_legal_consents` | 2 → 0;留存 2 筆仍在 |
| cohort 的 `payment_charge_attempts` | 24 → 0;留存 3 筆仍在**且 status 未變** |
| `pending_invoices` | **3 → 3、一筆未刪;三筆 `status` 皆改 `voided`**、不再出現在待開票查詢(R5 nit:上一版「一筆未動」與「三筆改狀態」字面打架) |
| cohort 相關 `email_outbox` / `order_refunds` / `order_refund_items` / `payment_double_charge_anomalies` / `payment_double_charge_anomaly_events` | 0 → **0** |
| `display_id` | 留存 3 列**全為新 6 碼**且等於映射表;unique 無碰撞 |
| `legacy_display_id` | 3 列**全為原舊號**、unique、A9b 可查 |
| CHECK | `orders_display_id_format` 存在且 **VALID**;`pending_invoices` CHECK 含 `voided` |
| 金流一致性 | 留存 3 張 `payment_status` 全 `refunded`;`paid_at` 未動;`refunded_amount` = 授權金額(read-back) |
| 零殘留 | 無任何 FK 指向已刪 `order_id`(逐表 assert,含 0 列表) |

dry-run(步驟 6)與正式 apply 後**各驗一次同一張矩陣**(R5 抓:檔尾曾殘留「跑到 1-6、只驗 orders/attempts」的舊字面,本版已刪)。

**N3c 之後**才把 CHECK contract 成新格式 only(D0 放寬 → N3c 收緊;順序見 §5.0)。
🔴 **D1 到 N2 之間**:那 3 列的 `display_id` 是新格式而 domain 尚未支援 ⇒ **不得餵進 domain `Order` factory**(讀取路徑本來就不會,新寫的 code 要守這條)。

### 8.6 🟡 待 Sean 拍板(R5 判定「真未定需求」,非規格深度問題;R6 之後一次問)

| 題 | 內容 | 擋住誰 |
|---|---|---|
| **Q17 已到貨後取消** | 貨已到 PCM 手上,客人才說不要 —— 可取消(變庫存)?不可(走退貨)?可但多一道確認? | §5.1c 第四條不變式、A8 的一條分支;**Q17 未答前該不變式不上、A8 對此情境 fail-closed** |
| **Q18 取消原因 allowlist 與對客映射** | 草案:`customer_request`→「依您要求取消」/ `out_of_stock`→「商品供貨中斷,已為您取消」/ `long_leadtime`→「交期無法配合,已為您取消」/ `price_change`→「依您要求取消」/ `duplicate_order`→「重複訂單,已為您取消」/ `internal_error`→「依您要求取消」(刻意不對客講實話,Sean 需知情)/ `other`→ 手寫必填 | **A7 / A8 不得開工**(未知 code 一律 fail-closed) |
| **Q19 P1 後綴的正式下場** | Q10=A 之後 `shipment_reference` 本身唯一 ⇒ 技術上不需要後綴;但 P1「自動加後綴」是 Sean 拍板,**只有 Sean 能作廢** | 第 2 批出貨 RPC 的編號組法 |
| **HCT 允許字元**(外部) | `epino` 長度已確認 Char(30);**允許字元文件未載** ⇒ Sean 申請 API 時問新竹站所 | 第 2 批出貨片的最後一道外部閘 |

— END —
