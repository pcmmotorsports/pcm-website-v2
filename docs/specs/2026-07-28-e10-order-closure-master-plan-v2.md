# M-4b E10 訂單閉環總規劃 **v2**(2026-07-28 重寫)

> **狀態:** # ✅ **Sean 已最終批准(2026-07-29 凌晨,拍 A)— 施工中**。批准附帶指示:**過夜自跑只做「不需 Sean 批准」的部分**(D1c apply、production db push、任何 push/deploy 一律留到早上);主模型 Opus、Codex 寫機械片、Fable+Codex 審查。
> **取代:** `docs/specs/2026-07-27-e10-order-closure-master-plan.md` v1 —— v1 經 codex 關卡1 **FAIL、67 條 findings(62 must-fix + 5 nit)**,判定重寫非修補。逐條裁定 = `docs/reviews/2026-07-28-e10-k1-findings-triage.md`(駁回 0 條)
> **驗收唯一標準:** `docs/specs/2026-07-25-admin-backend-rebuild-spec.md` §1「員工的一天」27 項
> **北極星(Sean 逐字):**「可以完整上線給員工使用,操作,修改網站。而且他們不是工程師」
> **輪次:** 🔴 **Sean 2026-07-28 拍 Q8=B 解除 plan 層兩輪上限**(逐字:「就算有第四輪第五輪都沒差,我要把全貌做好後再用視覺顯示完整一次 才開始動工」)。
> 已跑:**R1 67**(審 v1)→ … → **R17 5** → **R18 7+1** → **R19 3 must-fix + 1 nit**,十九輪皆 FAIL,findings 各存 `docs/reviews/2026-07-28-e10-k1-r{2,…,19}-codex.md`(趨勢 67→33→31→32→26→24→15→17→16→7→5→4→7→10→10→6→5→7→**3**)。
> 🟢 **R10 大幅收斂**(16→7、零 nit):R9 約 12 條關閉、DAG/矩陣/算術一致。R10 修正 = A8c1 改鎖真正起點 `begin_charge_attempt`、job 表 `rec_trade_id` NOT NULL、`reconciling` 獨立相位(防 crash 後重呼 Refund)、A15 補 port 擴充、D1t 拆二。
> 🟢 **R9 性質**:零產品決策題、全為可機械折入的合約缺口。對策 = `submitted` 補 reconciler claim 出路、reconcile baseline 移 worker 初始化、同 `rec_trade_id` 單一 active job、D1 線 9→12 片(守門/匯出腳本/正式匯出拆開 + orchestrator tooling 片)、A15 adapter timeout 片、允許集合再收斂到 `unpaid` only、D1b1 判定矩陣數值寫死。
> 🟢 **R7→R8 收斂**:R7 對策(第 1 批取消 fail-closed 收斂到無退款需求的單、A8b 移第 3 批)成立;R8 再下探**跨 RPC 競態**(取消與付款相關 RPC 統一 `FOR UPDATE` 鎖序;R9 更正為三支 RPC 四施工片)、**TapPay 退款外部冪等**(`bank_refund_id` + reconcile 基準欄 + `submitted` 狀態 —— 退款隔日生效)、**D1 pooler 連線守門與 HTTP timeout**。兩條上升為產品決策 = §8.6 第 3 批開批閘(混合收款分軌 / partiallyPaid 應退額)。
> 🔴 **R5 診斷(codex 回答主對話的追問)**:「反覆產生 finding 的核心,是新模型/新決策加進正文後**沒有同步生成唯一 DAG 與『schema→writer→reader→UI→驗收』閉環矩陣**;主因是規格深度不足,但 **P1 後綴、已到貨取消、取消原因映射、HCT 允許字元確實尚未定案**」。
> 🟢 **R6 收斂判斷(codex 逐字摘要)**:N3a 前移、有界重試、告警通道、tombstone、cohort 口徑、dry-run/驗收矩陣、A14 拆片等類別**已實質關死**;剩餘 = 取消→採購反向守門、refund-job worker 合約、alias UI、鐵則 4 超大片、D1 細節與文件同步。
> ⇒ **R20 已 PASS(20 輪收官)**;本版另折入 **Fable 四線復盤 14 條 must-fix**(`docs/reviews/2026-07-28-e10-fable-retrospective.md`)。全檔唯一待決清單 = **§8.6**。閘序 = 關卡1 PASS ✅ → Fable 復盤 ✅ → **確認輪通過 → Sean 最終批准** → A0a 動工(進度以 STATUS 為準)。
> ✅ **動工前置之一已滿足**:完整視覺全貌已交付且 Sean 批准方向(artifact `d4229e23-1e68-4315-bd3f-5811372efcaa(2026-07-29 終版;舊 ed7a6276 已失效)`)。🔴 **剩餘前置(R24 同步)= ①確認輪通過 ②Sean 最終批准**(關卡1 R20 已 PASS;鐵則 8 —— 缺一不施工)。
>
> ⚠️ **R2 的基線瑕疵(誠實記錄)**:主對話在 R2 審查**進行中**改了本檔(452 → 464 行),違反「送審前必先凍結版本」。
> codex 自己在 nit 抓到。⇒ R2 findings 的行號不可信,折入時一律以**內容**比對。**R3 送審前本檔必須先 commit 凍結。**
>
> ---
>
> 🛑🛑 **2026-07-30 標註:D1 全線退場 + 訂單編號改制路線已換(本檔 D1/N3c 相關段落已非現行計畫)**
>
> Sean 2026-07-30 拍 **Q1=A**(`docs/specs/2026-07-30-order-renumber-instead-of-delete.md`):
> **只換產號器,既有舊格式訂單完全不動。**
> ⇒ **本檔以下內容已不執行**:D1a0-D1c 全線(含「砍 26 張 + 改號 3 張」)、**N3c 收窗**、
> 收緊 `orders_display_id_format` CHECK。`display_id` 新舊兩種格式**永久並存**(Sean 已知並接受)。
> ⇒ **現行施工 plan = `docs/specs/2026-07-30-n3a-n3b-display-id-generator-plan.md`**(N2 + N3a + N3b 三片)。
> ⚠️ **§5.4a 產號合約仍然有效、仍是真權威**,新 plan 逐條沿用、未改寫。
> ⚠️ **§5.4b 的 N2 字面(「domain 換成新格式 only」)已作廢** —— 那個字面預設 N3c 會收緊資料庫;
> N3c 不做之後「只認新格式」會擋掉真實舊單 ⇒ 新 plan §2a 改為**兩收**,理由詳該檔。
>
> 🔢 **本檔內「26 / 3 / 29」等筆數一律是 D1 cohort 的歷史定義,刻意不改寫**
> (它們記錄的是當時的盤點與那條已退場路線的口徑,改動等於偽造紀錄)。
> **現況口徑**:2026-07-30 正式站唯讀實查 = **30 張**訂單(新增 `PCM-2026-0105`、07-29 建立、`unpaid`)。
> 凡需要「現在還有幾張」一律以 30 為準、以 `STATUS.md` 為 SSoT,不引用本檔數字。

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
| **M** | migration:建表 / 加欄 / 回填 / 單列 CHECK / ACL / RLS。**零行為改動**(🔴 R6 修正:trigger 與 DB 函式**不屬 M 型**,那是行為 —— 歸 T 型) | 交易模擬(BEGIN→模擬→驗→ROLLBACK)+ ACL fail-closed assert |
| **T** | 🔴 **DB 內行為(R6 新增)**:constraint trigger、SQL helper 函式。DDL + 行為單元測**同片**;競態負測可拆獨立 T 片。**不碰 UI / app 層** | 行為測試綠 + 交易模擬;競態片附雙交易負測輸出 |
| **R** | owner RPC + EXECUTE ACL + 同交易 audit。**無 UI、無 app 層**(app 端 catch/composition 歸 A 型) | RPC 單元測 + 權限矩陣實查 + 零留痕 |
| **D** | domain 純函式 / 型別 / 狀態機 + 測試。**不碰 DB、不碰 UI** | 單元測 + typecheck |
| **A** | 應用層:adapter 投影、row mapper、read-model 型別、server action、查詢合約。**不碰 schema、不畫 UI** | 單元測 + 型別對齊 + 實跑一次讀取路徑 |
| **U** | UI,只消費**已存在**的 RPC 與 **A 型片已建好的讀模型**。**不碰 schema、不改投影** | 三綠 + smoke test + agent-browser 實看 |
| **docs** | 查證 / 對帳 / 規格凍結。**零 code、零 DB** | 產出檔 + 每條斷言附 `檔案:行號` 或實查輸出 |
| **runbook** | 一次性 production 資料操作。**不進 migration 序列**(寫死正式站識別值,在本機 / preview 必然重播失敗) | 匯出備份 + 還原演練 + 環境身分守門 + 前後對照矩陣 |

> 🔴 **A 型是 R2 補的**(codex R2:「M/R/U 沒有 adapter、read-model、server action 類型,但 A9-A12 必須改投影、mapper、domain view type 與 action,無法維持『U 只有 UI』」)。
> 沒有這一型,所有 UI 片都會偷渡投影改動 —— 那正是 v1「片按功能切」的復發路徑。
> **判別法**:這片會不會動 `SupabaseOrderAdapter` 的 select 字串、mapper、或新增 server action?會 → 它是 A 型,不是 U 型。

> 片型與高風險的關係:**M / T / R 一律高風險**(鐵則 12 ②③;T 直接改 DB 寫入行為);**A / D / U 依內容判**。
> v1 把高風險總數寫成 13 / 12、實際表裡是 15(`grep -c` 實測)⇒ **不預先宣稱總數**,逐片標、開批時當場數(#61/#62)。

### 原則 2 — 模型先於欄位

某件事的真相若屬於一個尚未存在的實體(包裹、採購、收款、退貨),**先建那個實體**,再開輸入、通知與列印。
`orders` / `order_items` **永遠不會**拿到 `tracking_number`、`supplier_name` 這類欄位。
🔴 **2026-07-31 更正**:~~「它們最多只持有最新摘要」~~ —— **數量摘要也不放這兩張表**,改放 service_role-only 的 `order_item_quantity_summary`(Sean 拍板;那兩張表對登入客人整表開放 SELECT ⇒ 摘要放上去等於把採購進度開給客人)。摘要仍必須由 trigger 從真相表推導、標明可重算。

🔴 **計數器欄同樣受這條管**(Q9=B;codex R2 抓「計數器是第二真相會漂」):
每一個數量計數器,**只能在它對應的真相模型已經存在之後才加**;
🔴 **落點自 2026-07-31 起 = `public.order_item_quantity_summary`(員工專用表),不是 `order_items`**——

| 計數器 | 真相來源 | 可以加的時機 |
|---|---|---|
| `ordered_quantity` / `instock_quantity` | `order_item_procurement` | **第 1 批**(A2 同批建表) |
| `cancelled_quantity` | `order_cancellations` | **第 1 批**(A7 同批建表) |
| `shipped_quantity` | `shipments` / `shipment_items` | **第 2 批** |
| `return_requested_quantity` / `return_received_quantity` | `order_returns` / `order_return_items` | **第 3 批** |

🔴 **「摘要由 trigger 推導」是實作要求、不是比喻**(R5 抓:原則寫 trigger、片表卻寫「RPC 寫完手動呼叫重算」⇒ 漏呼叫就是第二真相)。
⇒ **A4 定為 constraint trigger**:掛在 `order_item_procurement` / `order_cancellation_items` 上,明細一動就同交易重算 **`order_item_quantity_summary`**(🔴 **2026-07-31 起摘要不在 `order_items`**,見 §5.1 A1 列),**不存在「忘記呼叫」這條路**;另附漂移 assert(隨機抽單重算比對)。

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
| `order_refunds` / `order_refund_items` | 零 | **SELECT only**(`20260725130100:324-325`;復盤L2 修行號)⇒ 退款寫入 RPC 不存在 |
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
| **C1** | 送新竹的識別值 | ✅ **格式已定案**:~~2026-07-27 P1:訂單編號自動加 `-1`/`-2`~~(**Q19=A 正式作廢**,2026-07-28)→ `shipment_reference` 6 碼、與訂單編號脫鉤(Q10=A;理由:U1 併箱時沒有唯一基底訂單號)、**無後綴**。**產號合約見 §8.5**。長度已驗(`epino` Char(30));🟡 **允許字元未載 = C1 產號合約唯一未確認項**(§8.6);正式串接另有帳號申請、`escsno`/`esstno` 等**既知外部操作前置**(HCT ref §1,非決策題)。`hct-logistics-api-reference.md` §8 已同步 |
| **C2** | `create_order` 不可用於手動建單 | ❌ 仍在:`:284` `auth.uid` 為 NULL 直接 exception;`:356`/`:360` 品項必須是既有 catalog 變體 ⇒ 需另開 admin 專用 RPC |
| **C3** | schema 要吃 U1 包裹 / U2 改單 / U3 多筆匯款 | ❌ 未建模 ⇒ 由 §5.2 / §5.3 的模型片承接 |

**不在我方控制**:🔴 Sean 待辦 —— 向新竹站所申請物流 API 帳號(**查貨與出貨是兩張不同申請表**)。
申請時**勾「用新竹貨號查詢」、不要勾訂單編號**(`:49` 逐字「只能擇一查詢,申請時即選定,**要改須聯繫營業所**」—— v1 寫「送出即不可改」是誤述,#64)。

---

## §4 已核准決策折入對照表(#34/#39/#40/#41/#42)

v1 最大的漏是**沒把 2026-07-26 UX 審查已核准的條目排進片**。以下每條都指定落點,片級 plan 必引用。

| 來源 | 內容 | 落點 |
|---|---|---|
| **U1** | 包裹實體,一單多包 **+ 多單併一箱(🔴 ~~Q16=A 縮限:同一位客人 + 同一份收件資料~~ → **2026-08-05 Sean 拍 Q1=B 知情推翻後半**:只縮限「**同一位客人**」,收件資料以包裹自己的 `recipient_snapshot` 為準、可與訂單快照不同;跨客人仍不做。詳 §8.5 與 `docs/specs/2026-08-05-e10-b2-shipments-db-plan.md` §3.1)**;包裹卡顯示品名/變體/數量/訂單單號/收件人姓名/電話 | 第 2 批 `shipments` + `shipment_items` |
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
| UX §2 #9 | 🔀 **2026-08-01 Sean 拍板改路**:~~供應商自由文字正規化(trim + 大小寫歸一 + 相似值警告)~~ → **供應商主檔 + 下拉選單**,員工不再手打自由文字 ⇒ 正規化與相似值警告**都不需要**(同一家 = 同一個 uuid)。防重複的手段改成新增畫面的 **typeahead**(打「Webike」列出已有 TW/JP/EU 三筆)= 人眼判斷,而且比機器準 —— 機器會建議把那三家併成一家,那是錯的 | **S1a-S3b**(`docs/specs/2026-08-01-e10-supplier-master-plan.md`) |
| UX §3 #11 | **通知矩陣**(8 事件 × Email/LINE)—— 事件清單見 UX 審查 §3;**第 2 批開批前 Sean 勾選**(復盤L1 修:原「E10 前」與 §8.6 唯一權威矛盾)| 第 2 批開批前拍板(§8.6) |
| UX §3 #12/#13 | 通知 = 可追蹤交付(寄了什麼/成功失敗/重試)+ 人工登記「已用 LINE/電話通知」,統一進時間軸 | 第 1 批 `order_notes`(登記)+ 第 2 批(寄送紀錄) |
| UX §3 #14 | **前台回路**:#240 訂單詳情頁(逐包裹單號+追蹤連結+品項進度)、RF6 部分退款顯示 | 第 2 批(#240)/ 第 3 批(RF6) |
| UX §4 #17 | 新竹 API 失敗與重送安全:請求識別值 + 原始回覆 + 三段狀態;只允許安全重試 | 第 2 批 |
| UX §4 #18/#19 | 物流異常佇列;逆物流前置守門(件數只能 1) | 第 2/3 批 |
| UX §5 #21 | 狀態旁固定顯示「下一步」,同一套詞彙貫穿 | 第 1 批列表 + 明細 |
| UX §5 #23 | **手機出貨兩步守門**(先選快遞→依快遞驗必填→送出摘要;失敗保留草稿) | 第 2 批 |
| UX §5 #24 | 高風險動作「影響範圍」複核頁(品項/金額/收件快照/不可逆後果) | 第 1 批(取消)起,每個破壞性動作 |
| UX §5 #26 | 「編輯訂單」拆入口(訂單資料 / 修改品項與地址 / 付款調整),不可做的顯示原因 | 第 1 批(拆入口)/ 第 3 批(填內容) |
| UX §5 #25 | 空狀態三動作(清除篩選 / 建手動單 / 查詢範例) | 🔴 R14 修映射:**第 1 批只交付「清除篩選 + 查詢範例」**(A14c);「建手動單」**第 3 批 RPC 完成後才啟用**(死按鈕禁上) |

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
       A9b1 單號搜尋合約 (A: display_id + legacy 命中) → A10c1 單號搜尋 UI (U)
         ↓   ← 🔴 R6:alias 讀模型與 UI 先於 D1,驗過舊號命中(測試資料層級)才准 D1;
         ↓      否則改號後客服無路查舊號
       A15 adapter timeout (A; 獨立節點 — R23 更正: 第 3 批 worker 前置, D1 線不依賴;
         仍屬第 1 批 69 片、排程自由)

       D1a0 守門 → D1a1 匯出腳本 → D1a2 正式匯出 → D1a3 映射
         → D1a4/D1a5 restore scripts → D1a6 演練(pre-n3c)→ D1t1 交易核心 → D1t2 CLI/dry-run
         ↓   ← 🔴 Sean 07-29 拍板 Q2=A:**D1a7(post-n3c 演練)移出第 1 批、改排第 2 批**
         ↓      N3a 建好 `pcm_generate_display_id()` 之後才演練得了(restore-post 呼叫它、
         ↓      不自寫第二套產號器);而 post-n3c 還原本來就只在第 3 批 N3c 收窗後才用得到,
         ↓      第 1 批真要還原走的是 D1a6/pre-n3c,不受影響
         → D1t3 timeout/rollback 整合驗證 → D1b1 read-back → D1b2 dry-run+證據
         → 🔴 Sean 批准閘 → D1c apply (runbook ×14; 閘序見 §8.4)
         ↓
       A2 採購真相 → A3 備註 → A7 取消真相 (A7-1/A7-2) → A7-t 主從一致 trigger (T)
         ↓   ← 🔴 Sean 07-31 拍 Q1=A:A7-t 先單獨 apply + read-back,才套 A1
       A1 摘要表 (M; 新表 order_item_quantity_summary + 四條不變式 CHECK, Q17=B)
         ↓
       A7b-M 退款工作表 (M; 兩表 + 五道唯一性 + dormant gate) → A7b-T 六支守門 trigger (T)
         ↓   ← 🔴 Sean 07-31 拍 Q2=A 拆兩片;A7b-T 同交易移除 A7b-M 的 dormant CHECK(false)
         ↓      ⇒ T 失敗時表存在但寫不進去,而不是「可以被亂寫」(舊字面「同批 apply ⇒ 風險窗為零」已證偽)
         ↓
       S1a 供應商主檔 (M) → S1b 採購改 FK (M) → S2 owner RPC (R) → S3a 讀模型 (A) → S3b 設定頁 (U)
         ↓      🔀 2026-08-01 Sean 拍板換路:~~A5b 正規化 SQL 函式 (T)~~ **已作廢**
         ↓      供應商改「主檔 + 下拉選單」⇒ 名稱歸一問題在形狀層消失,不需要 canonical key
         ↓      片級 plan = docs/specs/2026-08-01-e10-supplier-master-plan.md
       A2b1 總量守門 trigger (T) → A2b2 競態負測 (T)
         → A4a 重算 trigger (T) → A4b 競態負測+漂移 assert (T)
         ↓
       A5a/A6 (R) → A8c1/A8c2 金流 RPC 取消守門 (R; 取消過的單拒收款)
         → A8a1 整單取消核心 → A8a2 品項部分取消 (R; 僅無退款需求的單, fail-closed)
         ↓   ← 🔴 R8:守門先上、取消才上 —— 反序的窗口內「取消後仍可被收原額」;
         ↓      三支 RPC(四施工片)統一先 orders FOR UPDATE 再檢查(跨 RPC 競態)
         ↓
       A9a/A9b2/A9c/A9d1/A9d2/A9g/A9h (A; 全部加法契約;~~A5c 相似候選~~ 2026-08-01 作廢)
         ↓
       A9e/A9f (U: 先停止消費 stale 欄) → A9s/A9r (A: 才收縮投影/mapper/型別)
         ↓   ← 🔴 R6:順序不可反 —— 先砍型別欄位會讓仍在讀的 TSX 編譯斷,逐片三綠失效
       A9w1/A9w2 (U: 九碼明細頁+週邊下架) → A9w3 (A: 投影收縮)
         → A9w4a/A9w4b/A9w4c (A: writer chain 三拆, R18)
         ↓
       A10a/A10b/A10c2/A11a-c (U 主建設前段)
         ↓
       A9v (M: 只 REVOKE item 支 + 撤 order_status_options 寫權, R18;
            恆在 A9w1-4c 與 A11a-c 全部之後, 全 consumer 零引用才跑)
         ↓
       A12a-b/A13a-b/A14a-c (U 主建設後段; R19 與片表統一 = A10/A11 → A9v → A12-A14)

第2批  N3a 共用產號 helper (T; R8 更正片型 — SQL helper 依本檔定義屬 T 非 R)
       ← 🔴 R5 前移:shipment_reference 要用它
         ↓
       shipments + shipment_items (同客人限定, Q16=A) → 出貨 RPC/UI/通知/列印 → 前台 #240
       (shipped_quantity 此時才加 —— 🔴 2026-08-05 更正:落點是 order_item_quantity_summary、
        **不是 order_items**(A1 07-31 已把摘要搬離 order_items);A8a1/A8a2/A8b 的 contract 債同批清
        —— ~~更正:清償方式 = 只加欄 + 新增 shipped <= instock,C6/C7 與取消公式都不動~~
        🔴 **2026-08-05 K1 R3 後狀態:本題重新開放、尚未定案** —— 「`shipped` 該在哪一層被強制」的兩次分析都被證偽(第一代「C7 已涵蓋」前提假=instock 非單調;第二代「移出摘要表」前提也假=receipts trigger 是 row-level、只重算受影響品項,不存在「無關的摘要列」,`20260803140000:258-287` 親驗)。⇒ **本行原有的施工字面全部作廢、不得依它施工**;B2 批已依停損只交付兩張表,摘要整合與契約債清償整批延後至下一線重新分析。
        storefront 兩張會員卡片接回包裹真相、移除「處理中」降級 —— A9f 的 contract 債)

第3批  order_payments (最先; A8b 的 partiallyPaid 實收真相靠它, R7)
         ↓
       已付款取消解鎖線 —— 🔴 R8 定死可逐片發布序 (rollback = 反向逐步關):
         ①worker R/A 片先上但 flag off (dormant) → ②A8b 上 (enqueue 開、UI 仍鎖)
         → ③UI 解鎖已付款取消 → ④enable worker flag ⇒ 第 19 項此時轉全綠
       (狀態機照 A7b 合約; 開工前置 = §8.6 退款線兩題拍板)
       order_returns / RF2b-RF8 退款線其餘
       order_internal / 改單 / 稽核線 / 待辦對帳 / 匯出
       admin 建單 RPC (呼叫 N3a; N3a 已在第 2 批存在; app 層 catch 見 N3b-app)
         ↓
       N3b-app 應用層 catch/告警 (A; 先上 = 安全 no-op) → N3b create_order 換產號器
         → N3c 收窗+CHECK 收緊 (R7: N3b 先上則窗口內用盡事件無 LINE 告警, 序不可反)

獨立   N2 domain 換格式 (D; 對結帳零 runtime 影響, D1 之後任意時點)
```

#### 5.0b 閉環矩陣(每個資料域:schema → writer → 讀模型 → UI → 綠燈;缺一格 = 該綠燈不得宣稱)

| 資料域 | schema(M/T) | writer | 讀模型(A) | UI(U) | 綠燈 |
|---|---|---|---|---|---|
| 採購 | A2 + **S1a/S1b** + A2b1/A2b2(T) | **S2**(供應商主檔 upsert)+ A5a(收 `supplier_id`,**不再收供應商名稱文字**) | A9a / A9b2 / **S3a** | A10b / A10c2 / **S3b** | **5, 6** |
| 備註·聯絡·告知 | A3 | A6 | A9a | A10a | **3**;**7 = A10a+A10b 聯合驗收**(告知在 A10a、異常原因在 A10b,缺一不綠) |
| 計數器摘要 | A1(**新表 `order_item_quantity_summary`**) | **A4a trigger**(由 A2/A7 明細驅動,無手填入口;負測 = A4b) | A9c 🔴 **必須用 PostgREST nested left embed**(`order_items(…, order_item_quantity_summary(…))`)—— `ADMIN_ORDER_LIST_SELECT` 是 select 字串、**寫不了 SQL `COALESCE`**;缺列會回 `null`,由 **mapper 在 TS 層正規化成三個 0**,並補「缺列」單元測 | A11a-c 🔴 **只接非 nullable 型別**(正規化在 A9c 的 mapper 完成,UI 片不做 join、不做 COALESCE) | — |
| 批次訂貨 | — | **A9h 批次 coordinator(writer 側:server 端逐列呼叫 A5a)**(🔴 R6:coordinator 是寫入編排、不是讀模型) | 批次逐列結果型別(A9h 內定義,供 A12b 消費) | A12a / A12b | **4(部分綠:僅訂貨面)** |
| 取消 | A7 | A8a1/A8a2(第 1 批,僅無退款需求單)+ A8c1/A8c2 金流守門(**先上**)/ A8b(**第 3 批**) | **A9g** | A13a / A13b | **19 = 部分綠(🔴 R8 精確化:整單取消 = 閉環;部分取消 = 安全可用但剩餘品項的卡付款被 A8c 封鎖、應收重算第 3 批,UI 明示);全綠隨第 3 批解鎖線** |
| 退款工作 | **A7b-M + A7b-T**(兩表 schema + 六支守門 trigger,第 1 批先建,合約定死;**排在 A1 之後**) | **全在第 3 批**:A8b(同交易 enqueue)+ worker(狀態機照 A7b) | A9g + dead-review 讀模型(第 3 批) | A13b + **dead 結案畫面(第 3 批,R17 補)** | (併入 19 的第 3 批部分) |
| 收款帳本(第 3 批) | `order_payments` schema(R15 補域列 —— 原漏) | **發布序寫死:schema → live writer(`confirm_order_payment` 擴充,含上線前已 paid 單的 replay upsert 負測)→ idempotent backfill(歷史)→ readers → A8b 分流** —— 切換窗口不漏記新卡款 | 對帳讀模型(第 3 批拆片) | U3 四格 UI | **15, 16**(第 3 批) |
| 列表投影 | — | — | A9c(admin 加法)/ **A9s(storefront 收縮)/ A9r(admin 收縮)**——兩者皆在 A9e/A9f **之後** | A9e / A9f / A11a-c | **1(部分)** |
| P3 九碼退場(R17 補列) | A9v(REVOKE item RPC + **撤 status-options 寫權** + 欄凍結;**鏈末**) | 停寫序:A9w4a(item writer)/ A9w4b(status-options writer)→ A9w4c(contract)→ A9v REVOKE | A9w3(投影/型別收縮) | A9w1(明細頁)/ A9w2(篩選·URL·status-options CRUD 下架)/ 列表 cell 隨 A11a-c 退場 | —(P3 是退場、無 27 項綠燈;驗收 = 全 consumer 零引用 grep) |
| 編號 | D0 | D1a0-D1c(runbook ×14)/ N3a / N3b / N3c | **A9b1**(display_id + legacy 命中) | **A10c1 單號搜尋**(🔴 R6:D1 前置,驗過舊號命中才准 D1) | — |

**閉環檢查**:每個綠燈的整條鏈都在同一批;第 1 批不依賴包裹、不依賴帳本、不依賴 N3a(D1 用寫死映射,§8.4)。

### 5.1 第 1 批(詳片級;可直接開工)

**Sean 做完會看到**:訂單列表換成新版 13 欄三軸(Sean 07-29 拍 A0b-1=B,見 §5.1a);訂貨軸真的能標(含分配數量、含批次);明細頁能寫內部備註與聯絡紀錄、能記供應商單號與預計到貨;取消訂單這個動作**第一次存在**。
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
| 1 | **A0a** | docs | 資料現況重驗:`orders` 筆數 / 各相依表列數 / 金流狀態分佈 / 🔴 **六筆 D1 相關 `payment_charge_attempts.rec_trade_id` 非 NULL 實查**(D1b1 硬前置)/ 🔴 **R14 補 + R15 修:`orders.payment_method` distinct 實查對照 legacy→canonical mapping**(mapping 至少含 **`tappay → card`** —— 現行 `confirm_order_payment` 寫的就是 `'tappay'`,`20260611120000:181` 親驗;R15 抓:上一版驗「非 canonical 必為零」照字面必 FAIL)**,驗收 = 「未映射值」必為零**(有未映射值 = 停下補 mapping,不硬塞) | — |
| 2 | **A0b** | docs | 程式現況重驗:E11 積木採用度 / `orders-table`·`order-detail` 現況盤點 | — |
| 3 | **A0c** | docs | **27 項逐項對帳**(對照 07-26 read-back、標出漂移) | — |
| 4 | **D0** | M | `orders` 加 `legacy_display_id`(nullable、unique、索引)+ `display_id` CHECK 放寬成暫收新舊兩種格式 + 🔴 **R15 併入:`COMMENT ON COLUMN orders.fulfillment_status`「E10 起停止維護、值為 legacy stale、不得當現況真相」**(§8.1 的要求原無片承接)+ 🔴 **`pending_invoices` 的 status CHECK 加 `voided`**(R5 實查:live CHECK 逐字 `ARRAY['pending','issued']` ⇒ D1 要寫的排除值**現在會直接被擋**)。**可重播、無 production 識別值**、與 D1 分開 | — |
| 5 | **A9b1** | A | 🔴 **單號搜尋合約(R6:D1 前置)**:搜尋詞同時比對 `display_id` 與 `legacy_display_id`(D0 已建欄)。**定死走 adapter 投影、不開 DB RPC**。D1 前 production 的 legacy 欄全 NULL ⇒ 舊號命中以測試資料驗(插入含 legacy 值的測試列、assert 命中) | — |
| 6 | **A10c1** | U | 🔴 **單號搜尋 UI(R6:D1 前置)**:消費 A9b1;輸入舊號 `PCM-2026-XXXX` 或新 6 碼皆命中。**本片與 A9b1 驗收通過 = D1 的開工前置** —— 否則改號後客服無路查舊號 | — |
| 7 | **A15** | A | 🔴 **TapPay adapter timeout 片(R9 新增)**:`TapPayChargeAdapter.recordQuery` 現行**無 AbortSignal 參數**(`TapPayChargeAdapter.ts:224` 實查)⇒ 加 `options.signal` 支援 + 🔴 **R10 補 + R11 定位:port 實名 = `packages/ports/src/ITapPayAdapter.ts` 的 `recordQuery` 簽章**(主對話親驗檔案實存;`settle-charge.ts:77` 只是呼叫點)—— port、adapter、typed callers、mocks 四處同步改,否則以 port 注入的 worker 仍傳不了 signal+ **timeout 負向測試**(模擬逾時、assert 中止且不留半掛請求)。動共用金流 adapter = 鐵則 12①⑥,必過 codex 關卡2。**第 3 批 worker(經 port 呼叫 adapter)的前置;🔴 R22 更正:D1 線不依賴本片 —— runbook client 獨立、fetch 原生 signal** | — |
| 8 | **D1a0** | runbook | 🔴 **D1 環境守門片**(R9 拆:與匯出混片超時):wrapper(direct host 或 pooler username 含 project ref 擇一命中、不印完整 URL)+ SQL 第一步 cohort 29 UUID 存在 assert(資料本身就是環境閘)。守門邏輯附負測(錯誤連線字串必 exit 1) | — |
| 9 | **D1a1** | runbook | 🔴 **D1 匯出腳本片**:逐表 `\copy` 匯出腳本 + cohort manifest 撰寫,**隔離 DB 測跑一次**(十表含 0 列表) | — |
| 10 | **D1a2** | runbook | 🔴 **D1 正式匯出片**:production 執行匯出 + 逐表 `sha256` checksum + `age` 加密 + 存放(金鑰 1Password、保存 180 天)、路徑與 checksum 回報 Sean | — |
| 11 | **D1a3** | runbook | 🔴 **D1 映射片**:26 組還原用新號映射(依 §5.4a 合約產生、驗 regex 與唯一、與現網及留存 3 組不衝突) | — |
| 12 | **D1a4** | runbook | 🔴 **D1 restore-pre 片**:`restore-pre-n3c.sql`(舊 CHECK 環境,26 張以原舊號還原;依 FK 逆序;**自帶守門:ref + `current_user='postgres'` + cohort 不存在反向 assert**,R21) | — |
| 13 | **D1a5** | runbook | 🔴 **D1 restore-post 片**:`restore-post-n3c.sql`(新格式-only CHECK 環境,用 D1a3 映射:`display_id ← 新號`、`legacy_display_id ← 原舊號`;**自帶守門同 D1a4 + 26 組映射當場重驗碰撞**,R21) | — |
| 14 | **D1a6** | runbook | 🔴 **D1 演練片①**:隔離 DB 實跑 `restore-pre-n3c.sql` 還原演練 | — |
| 15 | **D1a7** | runbook | 🔴 **D1 演練片②**:隔離 DB 實跑 `restore-post-n3c.sql` 還原演練。**🔴 Sean 07-29 拍板 Q2=A:移出第 1 批、改排第 2 批**(N3a 建好 `pcm_generate_display_id()` 才演練得了;post-n3c 還原只在第 3 批 N3c 之後才用得到)| — |
| 16 | **D1t1** | runbook | 🔴 **D1 orchestrator 交易核心片**(R11 再拆:CLI/dry-run 另片):交易執行函式本體(BEGIN → 鎖序 → 步驟 8b-13 → COMMIT;任一 API 失敗 / 斷言不符 = `ROLLBACK` 後 exit 非零)。🔴 **復盤L3 修 + R22 補全:不得直接 import `TapPayChargeAdapter`** —— 檔頭 `import 'server-only'` 在純 node/tsx 載入即 throw;runbook 用**獨立小 client**(複用 `wire.ts` 解析與 Record API 組裝、env 讀 Partner Key、**`TAPPAY_ENV=production` + 正式商戶 merchant id 斷言、fetch 原生 30s AbortSignal**),D1t2 單元測含「node 環境可載入」斷言。🔴 **不依賴 A15**(R22:A15 改的是 server-only adapter 的 port 簽章,是**第 3 批 worker** 的依賴;runbook client 的 signal 是 fetch 原生)。🔴 **鎖策略照 §8.4 步驟 8 的 NOWAIT fence 定案**(不留「施工時 grep」) | — |
| 17 | **D1t2** | runbook | 🔴 **D1 orchestrator CLI 片**:CLI 組裝 + dry-run 模式(模擬步驟 8-13、強制 ROLLBACK;CLI 語法定案 = action grammar `dry-run\|apply\|recover-sweeper\|verify-ca` 為第一個 token,**四個動作皆有同名旗標別名**(`--dry-run`/`--apply`/`--recover-sweeper`/`--verify-ca`)—— 本檔他處與 D1t1 錯誤訊息的舊旗標字面因此照舊有效(2026-07-30 兩輪審查對撞後定案:操作者字面安全 > 語法唯一性))+ 隔離 DB 假資料單元測 | — |
| 18 | **D1t3** | runbook | 🔴 **D1 timeout / rollback 整合驗證片**:六筆總體 3 分鐘上限、`SET LOCAL idle_in_transaction_session_timeout = '5min'`(大於總體 HTTP 預算 + 餘裕);**負測(R23 落片):①逾時後交易確實 rollback、不留半掛交易 ②雙交易 NOWAIT(反向持鎖時立即 abort、不等待)③kill -9 後啟動 self-heal(依 ownership state 檔恢復 sweeper)④🔴 **R24 fault-inject 兩個 crash 邊界:「state 已寫、job 未停」與「已恢復、state 未清」**(前者 self-heal 見 state+active=true ⇒ 只清 state;後者同)⑤🔴 **R25 雙 orchestrator 交錯負測:後取得者被 advisory lock 擋下**⑥🔴 **R26/R27 接管負測:A 寫 state、停 sweeper(`active=false`)後 kill -9;持不同 run id 的 B 取鎖 → state-first 分流進 recovery mode(不被正式分支的 active=true 斷言擋)→ CAS 接管、恢復、清 state**(隔離 DB 實跑) | — |
| 19 | **D1b1** | runbook | 🔴 **D1 read-back 片**:TapPay read-back 六筆,**判定矩陣寫死(R9;數值親驗 tappay-reference.md:85-86)**:逐筆以 `payment_charge_attempts.rec_trade_id` 為查詢鍵、top `status ∈ {0,2}`(查詢成功語意)、**唯一命中**;三筆已退單(0052/0102/0104)斷言 `record_status = 3`(REFUNDED)且 `refunded_amount` = 授權金額;三筆 `pending` 單(0064/0090/0101)允許 `record_status ∈ {-1 (ERROR), 5 (CANCEL)}` —— 🔴 **`0`(AUTH)與 `4`(PENDING;三筆 3DS 已啟動、4 是最可能實際值 —— 預期分支非異常)皆不自動放行:出現 = 保留 cohort、輸出證據、停下等 Sean,不進刪除**(R21 同步片列)。🔴 **0052 出口同步(R21+R22 措辭統一)**:0052 **正式商戶查無** ⇒ 步驟 12 對 0052 走保持原值路徑 + audit 記「正式商戶查無」(**不得寫「sandbox 已證實/推定成立」—— read-back 只能證明正式商戶無此交易**),不擋其餘;0102/0104 查無必 abort。其餘零筆、多筆、狀態外、金額不符 = 一律 abort。~~🔴 **硬前置(A0a 實查)**:六筆 attempts 的 `rec_trade_id` **全部非 NULL**(欄位 nullable);任一 NULL = 停下 raise Sean,不得用寬條件替代~~ ⇒ 🔴 **2026-07-29 已觸發並由 Sean 拍板放行(A0a-1),條件改寫見 §8.7 —— D1b1 施工以 §8.7 為準,不以本行舊字面為準** | — |
| 20 | **D1b2** | runbook | 🔴 **D1 dry-run + 證據片**:D1t2 CLI 帶 `--dry-run` 對 production 跑(模擬步驟 8-13、強制 ROLLBACK)+ 證據包(checksum / 演練紀錄 / read-back / dry-run 矩陣)交 Sean。**證據有效期 24 小時**(逾期重跑本片) | — |
| 21 | **D1c** | runbook | 🔴 **D1 apply 片**:Sean 明確批准後才可執行,跑 D1t1/D1t2 orchestrator 正式模式:鎖列 → 步驟 8b 重跑 read-back(**判定矩陣依 §8.7,只涵蓋五筆有 `rec_trade_id` 的**)→ 刪除 / 改號 / 狀態對齊 → 驗收矩陣。**本批唯一不可逆的一片**;🔴 不是 migration、不進 migration 序列。🔴 **新增前置(2026-07-29,Fable 關卡2 F5)**:A2/A3 兩張新表對 `orders` / `order_items` 都是 **`ON DELETE RESTRICT`**,而**實際 apply 序已變成 A2/A3 先落地、D1c 之後才跑**(D1 線今早才解封)。⇒ 鎖列後、DELETE 前必須先斷言 **`order_item_procurement`(經 `order_items`)與 `order_notes` 對 cohort 零引用**;非零 = abort 人工釐清,不得硬刪。少了這條,若 A5a/A6 已上線且有人對待刪單寫過採購或備註,DELETE 會被 RESTRICT 擋在半路(fail-closed、不會誤刪,但 orchestrator 會炸在中途) | — |
| 22 | **A2** | M | `order_item_procurement` 新表(**採購真相**,每 line 1:N)。🔴 **兩個數量欄**:`allocated_quantity`(這筆採購負責幾件)+ **`received_quantity`(這筆實際到貨幾件)** —— R3/R4 兩次抓:少了後者,`instock_quantity` **無來源可推導**。其餘:🔀 **2026-08-01(S1b)起供應商欄改形狀**:~~供應商名 + `supplier_canonical_key` 兩個文字欄~~ → **`supplier_id` uuid FK → `public.suppliers(id)`**(`ON DELETE/UPDATE RESTRICT`);顯示名一律 JOIN `suppliers.label`,本表不存供應商名稱文字。其餘欄不變:聯絡管道、送出時間、供應商單號、回覆狀態、異常原因、預計到貨、`first_ordered_at`、`status_changed_at`。CHECK(R6 補負值與上限):**`allocated_quantity BETWEEN 1 AND 100000`、`received_quantity BETWEEN 0 AND allocated_quantity`**(皆整數)。**upsert 唯一鍵 **`(order_item_id, supplier_id)`**(約束名 `order_item_procurement_business_key` 不變;~~`(order_item_id, supplier_canonical_key)`~~ 已於 S1b 換軸)**(A5a 冪等重放靠它)。ACL = service_role only + RLS zero-policy。🔴 **排在 A1 之前**(真相表先於摘要欄) | — |
| 23 | **A3** | M | `order_notes` 新表(append-only):內部備註 / LINE·電話聯絡紀錄 / 「已告知客人」登記(U6)。ACL 同 A2 | — |
| 24 | **A7** | M | 🔴 **`order_cancellations` + `order_cancellation_items` 兩表同片建**(R12 抓:items 原無具名 schema 落點,但 A4a trigger 與 A8a2 都要寫它;取消真相,合約見 §5.1b)。header 含 `reason_code`(7 值 CHECK,§5.1d)+ 🔴 **`reason_detail` text(R7 補:Q18 的 `other` 手寫文字原本無處可放)—— CHECK 鎖 `other` 必填非空白、其餘 code 必 NULL**。**內部取消原因不進 `orders`**(原則 3);對客的 `orders.cancelled_reason` / `cancelled_at` 原封不動。🔴 **2026-07-30 增補**:本列依鐵則 4 拆為 **A7-1**(migration)+ **A7-2**(行為驗證腳本)兩個施工片,並依 **Sean 07-30 拍 Q1=A** 增加 **A7-t**(T 型:兩支 DEFERRED CONSTRAINT TRIGGER 擋「有 header、零明細」,照 `order_refunds` 20260725130100:182-186 的形狀 —— 實查全檔無任何片承接此防線)。片級 plan = `docs/specs/2026-07-30-e10-a7-order-cancellations-plan.md`。🔴 **2026-07-30 晚 A7-t 收工**(plan = `docs/specs/2026-07-30-e10-a7t-cancellation-consistency-trigger-plan.md` v2、migration `20260730140000`、驗證 `scripts/a7t-verify.sh` **27/0** + `scripts/a7t-concurrency-probe.sh` **6/0**):四支 trigger(2 支 presence + 2 支 TRUNCATE 攔截,Sean 拍 Q2=A 不留逃生門)。**不變式恰一條**(至少一列明細);**併發面刻意不防** —— 漏洞實測為真但觸發前提(有人刪改取消明細)在現行規劃內不存在 ⇒ 改立合約債(見 A8a2 / A7b 兩列)。🔴 **A7-1 的「trigger = 0」斷言不改**(交接檔原指示已證偽:migration 依序執行、A7-1 早於 A7-t;實測 `a7-verify.sh` 仍 37/0) | — |
| 25 | **A7b-M / A7b-T** | M+T | 🔴🔴 **2026-07-31 Sean 拍板四題,本列原字面部分作廢** —— **①Q2=A:本片拆成 `A7b-M`(表 + CHECK + 索引 + ACL)與 `A7b-T`(守門 trigger + 行為測試)兩片**(對齊 M 片零行為的片型慣例,同 A7-1/A7-2/A7-t)。**②Q3=B:人工結案的併發控制改為「鎖列 + `reviewed_at IS NULL` 當 CAS 條件」** —— 🔴 **本列原本要求的「結案 RPC 走 token CAS」字面作廢**,理由:它與「`dead` 狀態的 `claim_token` 必須為 NULL」(避免舊 token 殘留被誤用)**互相矛盾、無法同時成立**(codex 關卡1 抓)。**③Q4=B:退款帳本必填欄的快照另開子表 `order_refund_job_items`**(對齊 A7 的 header/items 形狀);**不採「隔日重算」** —— 重算依據(運費規則、品項金額)隔日可能已變,等於讓「退多少錢」在兩個時間點各算一次。**④唯一性實為五道不是三道**(U1 世代 / U2 one-current cancellation / U3 one-current rec_trade_id / U4 `bank_refund_id UNIQUE` / U5 `refund_id` partial;**先前寫「四道」是計數錯誤**)。🔴🔴 **2026-07-31 關卡1 R2(18 must-fix)後,plan v3 另有五個設計改動推翻本列既有字面,以 v3 為準**:**D1 `retry_consumed_at` 欄整個刪除**(見下方原始規格中該段的更正)/ **D2 新增 `refund_call_attempted_at`**(lease 過期時判別「還沒打 TapPay」vs「打了但沒寫回」,否則只能二選一:重打 = 退兩次錢,或全部進人工)/ **D3 刪 `failed→dead` edge、改 `processing→dead` 原子進第六次失敗**(舊設計會先落地成 `failed` 且 count=6,中間仍可 `failed→queued`)/ **D4 A7b-M 加具名 dormant `CHECK (false)`、A7b-T 同交易移除**(舊字面「兩片同批 apply ⇒ 風險窗為零」**已證偽**:兩支各自 COMMIT)/ **D5 新增 `dead_reason` 值域 CHECK**(舊設計的 dead 沒有可顯示的死因 ⇒ 第 3 批 dead-review 畫面無東西可畫)。🔴🔴 **2026-07-31 關卡1 R3(換模型 Fable,11 must-fix + 3 nit)再補三條,plan 已升 v4**:**D6 新增 E2b「退款呼叫戳記」edge**(D2 要求 worker 先 commit 戳記再發 HTTP,但 v3 的 15 條 edge 沒有任何一條允許那個 UPDATE ⇒ 整條正向鏈物理上走不通)/ **🔴 D7 `resolution='retry_authorized'` 鎖死在 `dead_reason='retry_exhausted'`**(**本輪唯一設計層 BLOCKER**:v3 §3.3 的形式證明機械上成立,但它保證的是「一代一後繼」而非「同一筆錢只退一次」—— 一個**已被 TapPay 受理**的退款進 dead 後若被結成「授權重試」,下一代會帶**全新 `bank_refund_id`**,TapPay 的冪等鍵**不會擋** ⇒ 全合法、零違規路徑退第二次錢;CHECK 兩邊皆須 `IS (NOT) DISTINCT FROM`,用 `=` 會在 `dead_reason` 為 NULL 時靜默放行)/ **D8 明文 break-glass 更正程序**(結錯 `resolution` 在合約內是**永久死局**,唯一實際出路是 owner `DISABLE TRIGGER`,v3 隻字未提;同 D1 線「回滾守門在唯一需要它的那天擋死自己」的前科 ⇒ 必須帶明文 escape)。🔴 **R3 的 11 條 must-fix 有 4 條是 v3 修 R2 時自己開的新洞**(與 R1→R2 的 8/18 同一復發模式)⇒ plan v4 §7.4 新增**正向鏈 C/D**(重試迴圈、不確定送出鏈)專門讓這類洞轉紅 —— 舊的 24 負測 + 2 正向對三處靜態死鎖**全綠**。🔴🔴 **2026-07-31 關卡1 R4(codex,只打 v3→v4 diff 的靜態可達性與宣稱稽核,7 must-fix)再補兩條,plan 已升 v5**:**🔴 D9 重試授權的證據三條**(**R4 打掉了 D7 的承重論證** —— v4 宣稱「`retry_exhausted` 蘊含六次全明確失敗 ⇒ 零金額移動」,那是**把 worker 紀律講成 DB 層證明**;反例:TapPay 已受理但 worker 逾時、worker 錯誤地寫了 E5 ⇒ 戳記被清 ⇒ 最終合法拿到 `retry_exhausted` ⇒ D7 放行 ⇒ gen2 用新鑰匙再退。⇒ **D7 降級為「必要條件」**,補 D9a 授權必填 Record 證據 / **D9b 隔日閘**(TapPay 隔日生效,當天查 Record 看不到已受理的退款)/ **D9c 下一代 baseline 必須吻合前代證據,不等即 fail-closed**;新增欄 `first_refund_call_at`、`retry_auth_recorded_refunded`、`retry_auth_checked_at`)/ **D10 四條欄位生命週期寫死 + `tappay_refund_id` 首寫獨佔**(v4 的 **E1 / E5 / E12 三條 edge 靜態不可能** —— `next_retry_at` 與 `next_check_at` 沒有指定「誰設誰保留誰清」的 owner ⇒ 起點與終點的 truth table 對不上 ⇒ **整個重試迴圈死掉、dead 沒有可靠入口**;另 v4 只規定「E4 必須寫 `tappay_refund_id`」卻沒規定「只有 E4 能首次寫」⇒ E8/E10/E11/E9 可塞假 ID 而狀態形狀全合法;另 v4 掉了 E1 的 `claimed_at = now()` 錨點 ⇒ 呼叫者給未來時間可跳過 backoff)。🔴🔴 **另一句錯話已更正**:v4 寫「狀態機沒有任何路徑會重送同一筆 Refund」是錯的 —— **自動重試(最多 6 次)就是拿同一個不可變 `bank_refund_id` 重送,完全依賴 TapPay 冪等性,而 PCM 從未實測** ⇒ 列為第 3 批 **sandbox hard release gate**。🔴 **自捅復發已達第五次**(8/18 → 4/11 → 5/7)且**每次都是同一類**(改 truth table 或 edge 後某條 edge 靜態不可能、而負測全綠)⇒ plan v5 §7.5 依**機制優先律**新增**強制交付物「靜態可達性矩陣」**(15 edge 逐列填起點/終點/本 edge 改哪些欄/差集是否為空;差集非空 = 不准寫 SQL),並要求 A7b-T 的 harness **機器化實跑每條 edge**、跑不過當場中止,不靠眼睛看。🔴🔴 **2026-07-31 關卡1 R5(Fable 換模型,11 must-fix + 2 nit)再補三條,plan 已升 v6**:**D11 = Sean 拍 Q2=B** —— 結案選錯的補救**不走「工程師手動 DISABLE TRIGGER 改資料」**,改為 **DB 內正式更正 edge `E14` + RPC `admin_correct_dead_refund_resolution`**,規則 = 只准更正一次(`OLD.corrected_at IS NULL` 第二道 CAS)/ 該世代尚無後繼列 / `reviewed_at`·`reviewed_by` 不可改(原始結案人是稽核痕跡)/ 🔴 **`corrected_by <> reviewed_by`**(兩人簽核的 DB 層強制;**誠實邊界:只保證兩個 `staff.id`,不保證兩個人**)/ 更正後仍受 D7 + D9 全部約束。**推翻理由 = 我的前提數字錯了**:我用「訂單量一年 1-300 筆」推薦「手動處理」,**Sean 逐字更正「訂單一個月 100-300 筆」**(年 1200-3600)⇒ 手動路徑一年會走幾十次,是新的風險來源而非補救。/ **🔴 D9 三條全部改過(R5 F1-F5)** —— v5 宣稱「D9 讓錢已入帳的情況**必定被擋下**」**當時沒有任何 CHECK 做那個比對**(真正的擋點是「人看到數字變大要自己起疑」)= **同一個病的第三層**;且 **D9b 錨錯端點**(錨第一次呼叫、但風險在最後一次 ⇒ 第 4 輪逾時受理後當天即可結案重退、三條全綠)、`date_trunc('day', ts)` **隨 session TimeZone 走**(Supabase 預設 UTC ⇒ 台北早上 8 點閘門就開)、`checked_at` 無 `<= now()` 上界、`IS NULL` 分支 **fail-open**。⇒ 修法:**新增 D9d**(`retry_authorized` 必須 `retry_auth_recorded_refunded IS NOT DISTINCT FROM refunded_before`)、`first_refund_call_at` **改為 `last_refund_call_at`**、日界明定 `AT TIME ZONE 'Asia/Taipei'`、閘門 **fail-closed**、`checked_at <= now()`;並新增 **D12**(**E5/E5b 必須 `OLD.refund_call_attempted_at IS NOT NULL`** —— 沒呼叫過不得記「明確失敗」,這條讓 fail-closed 成立)。/ 另 **`processing.tappay_refund_id` 由 `−` 恢復 `N`**(v5 放寬的理由在 break-glass 情境不成立:trigger 被 DISABLE 時 CASE CHECK 是**唯一還活著的那層**)、正向鏈 C 第 2 輪起**不得再走 E2**(baseline 不可變 ⇒ v5 那條正向鏈**照字面靜態不可能**)、正向鏈 B 需**時間注入例外**且必須驗「拿掉注入後 E13 轉紅」。**§7.5 的 15 列矩陣 v6 已在 plan 本文填完**(v5 只留空表 = 又一次「要求未來再列」),並明文認列**它只擋 truth-table 差集這一類、看不到跨欄語意與時間類問題**。🔴🔴 **2026-07-31 關卡1 R6(codex,實作者視角 + 跨片介面,11 must-fix)—— plan 已升 v7**。**✅ 先記正向結果**:R6 親開五支既有 migration 逐條核,確認 `order_cancellations (id, order_id)` / `order_refunds (id, order_id)` / `order_items (order_id, id)` 三個被引用唯一約束**都存在且欄序正確**、`staff.id` 是 `text PRIMARY KEY`、**job↔ledger 的 11 欄全部存在且型別相容**、規格引用的既有行號名稱**未找到錯置**、最新 `create_order` **不讀寫本片新表**;另核可 §4.4 truth table 可落成單一 `CASE CHECK`、§5.6(a) 的 constraint trigger 語法成立。**折入的設計層七條**:**F1 exact-one edge classifier**(16 條 edge 各寫具名 predicate、算 `match_count`、**`=1` 才執行**,`=0`/`>1` 各自 fail-closed;**禁用 `IF/ELSIF` 首條命中** —— E2/E2b/E3 同為 `processing→processing`、E13/E14 同為 `dead→dead`,分支順序會直接改變結果)/ **F2 全欄位 canonical manifest + allowed-delta 白名單 + deny-by-default**(「其餘欄不得改」在 v6 出現多次卻沒定義「其餘」⇒ 一版漏比會放行竄改、另一版把 `updated_at` 列為不可變會讓合法 edge 永遠失敗)/ **F4 trigger 數量更正:六支 → 十支**(parent 6 + child 4;v6 是我自己的字面不一致,而 §7.1 要斷言 `tgtype` ⇒ 沒有 manifest 就產不出預期值)/ **F5 控制碼與空白的 CHECK 表達式逐碼位寫死 + 明文列出刻意不擋的 Unicode 邊界**/ **🔴 F7 E9 缺可跨越現行 ACL 的原子完成介面** —— service_role 對 job 有 UPDATE、對 `order_refunds` **只有 SELECT**(`20260725130100:312-325` 親驗)⇒ worker 直接 INSERT ledger 必吃 `42501`、拆兩次 RPC 則交易間 crash 會單邊完成 ⇒ **現在就立第三批具名合約 `complete_refund_job()`(SECURITY DEFINER、同交易建 ledger + items + 走 E9),不得以放寬 ledger 表權限代替** / **F8 七支 FK 的 `confdeltype` 全部寫死 `RESTRICT` 並納入結構驗收**(v6 有三支未指定,實作者可能寫成 CASCADE ⇒ 刪 staff 連 job 一起刪)/ **🔴 F9 鎖 manifest** —— 真正會擋結帳的**不是 dormant gate**(`ADD/DROP CONSTRAINT` 雖取 `ACCESS EXCLUSIVE` 但只鎖新表、且 gate 期間表恆空),而是**子表 FK 指向 `order_items` 時對被引用表取的 `SHARE ROW EXCLUSIVE`,與 `create_order` 的 `ROW EXCLUSIVE` 衝突**;且 `lock_timeout` **只保護 migration 等鎖、不保護結帳等待** ⇒ 必須沿用 A1 barrier lock probe 量持鎖窗上限、挑離峰 apply、超標則把 FK 拆成 `NOT VALID` + `VALIDATE` 兩支 / **F10 `pg_depend` preflight 由第六步移到任何 DROP 之前**,且**必須給 filter**(空表本來就有一堆 internal 依賴,「非空即 abort」會永遠 abort)/ **F11 M/T 三方狀態矩陣填出八格**(維度 = migration 版本登記 × schema 事實 × gate 與 row count;🔴 **最危險的是「SQL 已 COMMIT 但版本未登記」** ⇒ **禁止重跑、只補登**;另明文區分「migration ledger」與「`order_refunds` 業務帳本」兩個同名不同物)。🔴 **F3(完整 `CREATE TABLE` DDL manifest)與 F6(fixture 生成器輸入)未折入** —— 兩者等於「把 SQL 用中文再寫一遍」,關閉方式有兩條路,**流程層選擇屬 Sean**(plan v7 §14 Q5)。🔴 **關卡1 另抓到四條會直接造成「退第二次錢」的設計漏洞,v2 必須逐條關閉**:trigger 只有 `BEFORE UPDATE`(可直接 INSERT 成終態繞過狀態機)/ `reviewed_at` 可單獨寫入(兩道 partial unique 的 `reviewed_at IS NULL` 當場失效)/ **唯一性(無論幾道)只擋「同時」不擋「先後」** —— 擋「先後」的是 INSERT 守門,不是索引 / 表級 ACL 擋不住 owner·SECURITY DEFINER 的 DELETE·TRUNCATE。片級 plan = `docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md`;findings 逐字 = `docs/reviews/2026-07-31-e10-a7b-k1-codex.md`;決策 = memory `project_m4b-a7b-refund-jobs-decisions`。**以下為原始規格,除上述四點外仍然有效** —— 🔴 **`order_refund_jobs` 新表 + 完整工作狀態機合約**:`status` ∈ `queued / processing / submitted / reconciling / completed / failed / dead`(R10 加 `reconciling`)。`submitted` = TapPay 退款**隔日生效**(`docs/reference/tappay-reference.md` **§2.3**;引穩定章節不留漂移行號):refund API status 0 只是「已送出」;🔴 **R9 補 submitted 的合法出路** —— `submitted→reconciling`(🔴 **R10 新增獨立相位**:隔日 reconciler 以 token-CAS claim,`next_check_at` = 送出隔日 —— **不重用 `processing`**,否則 lease 過期重領後無法辨識該呼 Refund 還是 Record,crash/reclaim 會重送退款;附「`submitted` claim 後 crash/reclaim 不再呼 Refund」負測)→ Record API 對帳 🔴 **R14 三路寫死(皆 token CAS)**:累計 **=** `refunded_target` ⇒ **同交易寫 `order_refunds` + 回填 `refund_id` + 標 `completed`**;**<** target 且無誤 ⇒ 回 `submitted` 順延 `next_check_at`;**>** target ⇒ **`dead` + `manual_review_required = true`**;🔴 **R15 補 durable 告警 + R16 補結案合約**:`manual_review_required boolean` / `reviewed_at timestamptz` / `reviewed_by` **三欄入 schema**;結案 = 具名 **service_role-only 人工確認 RPC**(第 3 批 R 片;🔴 **2026-07-31 Q3=B 更正:併發控制是「鎖列 + `reviewed_at IS NULL` 當 CAS 條件」,不是 token CAS** —— token CAS 在此物理上不成立,因為 `dead` 狀態的 `claim_token` 必須為 NULL;RPC 具名 `public.admin_resolve_dead_refund_job(p_job_id, p_resolution, p_reviewed_by, p_note)`,`UPDATE … WHERE id=$1 AND reviewed_at IS NULL` **rowcount 必為 1**、同交易寫 audit **恰一筆**),不是誰都能改的欄位;🔴 **R18 補 resolution 分流 + R19 補原子消耗**:結案必填 `resolution` ∈ `retry_authorized / external_refund_confirmed / over_refund_writeoff` —— **只有 `retry_authorized` 允許開下一代 job**。🔴🔴 **2026-07-31 D1 更正:本段原本要求的 `retry_consumed_at`「消耗即戳」機制整個作廢、欄位刪除** —— 它與「`dead` 只允許 E13 且 `OLD.reviewed_at IS NULL`」**物理上互斥**(可被消耗的前代必已結案 ⇒ `reviewed_at` 非 NULL ⇒ 戳它的 UPDATE 被自己的守門拒絕 ⇒ 合法的第二次退款開不了;關卡1 R2 抓),而且它提供的防護是**零**:給定 U1 `UNIQUE (cancellation_id, generation)` + INSERT 守門要求「最大世代列 `M` 滿足 `M.generation = NEW.generation - 1` 且 `M.status='dead'` 且 `M.resolution='retry_authorized'`」+ DELETE/TRUNCATE 永久阻擋,**「任一世代最多只能開出一個後繼」已被嚴格蘊含**(第 N 代的後繼只可能是第 N+1 代,而 U1 使該世代最多一列)。⇒ **改為:開下一代 = INSERT 守門鎖該 cancellation 最大世代列 → 驗直接前代為 `dead + retry_authorized` → 不戳任何欄位**;「授權何時被用掉」的答案是後繼列的 `created_at`,`retry_consumed_at` 本來就只是它的抄本。**另加(R2)**:後代新列必須是**乾淨 `queued`**(否則拿到授權仍可直接 INSERT 成 `completed`),且業務 payload 與子表 item set **逐欄等於直接前代**(否則可拿「重試授權」去退另一筆錢)。負測 = 舊授權隔代重用開 gen3 必 `RAISE`、`external_refund_confirmed` 重開必 `RAISE`、超退結案不得重開、**併發重開恰一成功且另一筆精確紅在 U1 的 `23505`**;排程每輪掃 `dead AND manual_review_required AND reviewed_at IS NULL` 重發 LINE 直到結案(附「LINE 失敗後下輪重發」負測);外部在 TapPay portal 手動退過 ⇒ 帳已對不上,絕不自動視為完成;🔴 **Record 異常也只回 `submitted` 順延(`check_fail_count`+1;R12:此欄**列入本表 schema**,`integer NOT NULL DEFAULT 0` + CHECK ≥ 0;🔴 **R13 補歸零與寫入紀律:成功查到 Record 但未達標 ⇒ 同交易把 `check_fail_count` 歸零**(只計連續失敗)、**遞增與歸零一律帶當前 `claim_token` CAS 寫入**(舊 worker 不得覆寫)、依 CAS 後新值判斷第 6 次),連續 6 次 → `dead` 人工** —— R11 抓:走 `failed→queued` 會繞回送款相重呼 Refund;**`failed` 在 `submitted` 之後永不出現**。🔴 **R12 補 reconciling 的 reclaim 轉移寫死**:`reconciling` 中 crash ⇒ lease 過期 ⇒ 新 reconciler 重 claim **回 `reconciling`**(產新 token、舊 token CAS 作廢;**永不回 `processing`**);合法出口僅 `reconciling→completed / →submitted(順延或異常)/ →dead`。附「Record 異常與 lease reclaim 均不重送 Refund」負測。欄:`refund_amount`(整數元)、`cancellation_id` FK + 🔴 **R17 改世代式**(原 UNIQUE 與「結案後重開新 job」自相矛盾):`generation integer NOT NULL DEFAULT 1`,UNIQUE `(cancellation_id, generation)` + **one-current partial unique `cancellation_id WHERE status <> 'completed' AND reviewed_at IS NULL`**(同一取消同時只有一個未結案 job;dead 結案後重退 = `generation+1` 新列;附重開併發負測)、`payload_hash`、`bank_refund_id`(String ≤20,job 建立時產生、UNIQUE、重試沿用;tappay-reference.md:94 親驗;🔴 **R9 補 + R12 nit 更正:`order_refunds.bank_refund_id` 既有欄已是 NOT NULL + UNIQUE**(`20260725130100:86,108` 親驗,「第 3 批加欄」是錯的)⇒ 只需 **job↔ledger 等值不變式**(completed 時寫入帳本的值 = job 的值,immutable + DB assert))、`rec_trade_id`、`refunded_before` / `refunded_target`(🔴 **R9 更正初始化位置:DB RPC 不能打 TapPay ⇒ enqueue 時兩欄 NULL;worker 首次 claim 時呼叫 `recordQuery` 初始化 baseline 與 target(= before + refund_amount);初始化失敗或 NULL = fail-closed 不送**)、`failed_reason`、`retry_count`、`next_retry_at`、`next_check_at`、`claim_token` uuid、`claimed_at` / `claim_expires_at`(lease 5 分)、quote 快照、`order_refunds.id` nullable FK。🔴 **R9 補序列化 + R10 補 NULL 缺口:`rec_trade_id` 在本表 `NOT NULL`**(Postgres partial unique 對 NULL 不生效 ⇒ 多筆 NULL 可並存 active job;無 `rec_trade_id` 的單本來就進不了退款線)+ **partial unique index `rec_trade_id WHERE status <> 'completed' AND reviewed_at IS NULL`**(🔴 R16 修:原排除 `dead` 會讓未複核的 dead 不再擋同 `rec_trade_id` 新 job ⇒ 可能再退一次;**dead 在人工結案(`reviewed_at`)前一律視為 active**;結案後要重退 = 開新 job;附 NULL 拒收、併發 enqueue、dead 未結案仍阻擋三組負測) —— 同一筆 TapPay 交易同時只准一個 active job(兩個 job 讀同一 baseline 會讓累計越過兩個 target);enqueue 遇 active job = `RAISE` 等前一 job 終態。**轉移**:`queued→processing`(claim 產新 token)/ `processing→submitted`·`processing→failed`(**帶 token CAS**)/ lease 過期重 claim 舊 token 作廢 / `failed→queued`(backoff `5min × 2^retry`)/ `retry ≥ 6 → dead`(原子)。🔴 **R11 定界:本表 = 卡軌(TapPay)專用**,`rec_trade_id NOT NULL` 因此成立;**純匯款單的退款不進本表**,走第 3 批 UX §1 #3 匯款退款線(受款帳戶 + 複核 + 參考號 + 防重複匯款);付款管道以 `order_payments` 帳本為 server 權威判定;混合收款 = §8.6 開批閘。ACL = service_role only + RLS zero-policy。worker = 第 3 批,照本合約、不得另立。  🔴🔴 **合約債(A7-t 2026-07-30 立,對本片有約束力、不是「日後自動生效」)**:**若本片要 DELETE 或 UPDATE `order_cancellation_items` / `order_refund_items` 的既有列,必須先補上「trigger 內鎖 parent」+「隔離級 fail-closed 閘」** —— 否則取消側與退款側的主從一致防護都會靜默失效。依據:`REPEATABLE READ` 下兩交易各刪一列會雙雙放行(本機 PG17.10 實測,證據 harness = `scripts/a7t-concurrency-probe.sh`);**鎖 parent 單獨不足以補**(同一 harness 實測)。現行 append-only 寫法不觸發本條。 | — |
| 26 | **A1** | M | 🔴 **2026-07-31 Sean 拍板推翻本列原落點** —— ~~`order_items` 加三個摘要欄~~ **作廢**。改為**新建 service_role-only 表 `public.order_item_quantity_summary`**(`order_item_id` PK、`quantity` 去正規化 + 三個摘要欄 `ordered_quantity` / `instock_quantity`〔來源 A2〕/ `cancelled_quantity`〔來源 A7〕)。**推翻理由**:`order_items` 對登入客人有表級 SELECT(`20260604120000:191`)+ Data API 曝露 ⇒ 加在那裡等於 **apply 當下客人打 API 就讀得到採購進度**,與前台有沒有畫面無關;而 Sean 逐字要求「不讓客人知道進度、只有狀態顯示」⇒ 原設計做不到。**為什麼三欄一起搬**:四條不變式都要跟 `order_items.quantity` 比,只要拆表就會有一條跨表、只能用 A7-t 那種 trigger 補 ⇒ 繼承 #307 併發債;三欄同表 + **複合 FK `(order_item_id, quantity) → order_items(id, quantity)` 釘死 quantity** ⇒ §5.1c 四條全是同表 CHECK、零 trigger。**惰性建列**(有採購或取消活動才建列、**無列 = 三個 0**)⇒ `create_order` 零改動、無回填、不對 `order_items` 跑任何 UPDATE。**`order_items` 上唯一改動 = 加 `UNIQUE (id, quantity)`**(既有 `order_items_order_id_id_key` 是 `(order_id, id)`、欄組不同不能重用)。🔴 **連動契約債(承接者必須讀到)**:①「無列 = 全 0」**無 DB 強制力** ⇒ **A4a 負責建列;🔴 **讀 vs 守門要分開**:**守門(A2b1/A8a2 等會擋動作的路徑)一律回真相表重算、不得讀摘要**;**顯示**路徑才用摘要。讀取端契約以 §5 軸矩陣「計數器摘要」列為準 —— A9c 用 PostgREST nested left embed(`ADMIN_ORDER_LIST_SELECT` 是 select 字串、寫不了 SQL `COALESCE`)、缺列回 `null` 由 mapper 在 TS 層正規化成三個 0;A11a-c 只接非 nullable 型別、不做 join 也不做 COALESCE。🔴 純 SQL 的消費端(RPC / trigger / 守門)才用 `LEFT JOIN` + `COALESCE(…, 0)`** ②三個摘要值不再位於 `order_items` ⇒ 任何原本打算「一次 SELECT 就拿到」的讀模型要改成 join。片級 plan = `docs/specs/2026-07-30-e10-a1-order-item-summary-columns-plan.md` **v2**;決策全文 = memory `project_m4b-a1-summary-columns-decisions`。~~Q9=B「只加這三欄」的落點字面~~ 依本次拍板調整,**欄的內容與數量不變**。 | — |
| 27 | ~~**A5b**~~ | — | 🛑 **2026-08-01 作廢(Sean 拍板換路)**。原內容 = canonical key SQL 函式。取消理由不是「做不出來」——函式本體經三輪對抗審查都沒被擊破;是**形狀選錯**:供應商改成「主檔 + 下拉選單」之後,同一家供應商在 DB 裡就是同一個 uuid,「兩種寫法指向同一家」這個問題不再存在,整個名稱歸一算法沒有服務對象。取代者 = **S1a/S1b/S2/S3a/S3b 五片**,片級 plan `docs/specs/2026-08-01-e10-supplier-master-plan.md`。🔴 舊 plan `2026-08-01-e10-a5b-supplier-canonical-key-plan.md` 標作廢**保留備查**(§2 的 14 條 PG/Unicode 實測與形狀無關、可重用) | — |
| 28 | **A2b1** | T | `allocated_quantity` 跨列總量守門 constraint trigger + **先鎖 parent `order_items` 列**(R4 抓:不鎖時併發兩筆各讀舊合計仍會一起超量)。🔀 **2026-08-03 Sean 拍 Q4=A 修訂本列鎖字面**(A2b1 關卡1 本機 PG17 實測):鎖原語 = **`FOR NO KEY UPDATE`** —— 照舊 `FOR UPDATE` 會與 FK RI 檢查的 `KEY SHARE` 形成鎖升級死結(併發兩筆 INSERT 40P01 重現);~~鎖序固定 `order_items` → `order_item_procurement`~~ AFTER trigger 物理上先碰 procurement 列才鎖 parent ⇒ 改述「**守門互斥靠 parent 列鎖(NKU);跨物件取鎖紀律屬 writer**」。🔴 **R6 補 delta 守門**:新增或調升 allocation 時 assert **`合計 ≤ quantity − cancelled_quantity`**(取消後不得為已取消部分加開採購);**取消前已寫入的採購事實不動**。🔴🔴 **2026-07-31 連動(R3 抓,這條是設計層要求、不是寫法建議)**:`cancelled_quantity` 現在在
`order_item_quantity_summary`,而那張表是**惰性建立的非權威快取** ⇒ **守門不得讀它**。
具體壞法:`quantity=3`、真相(`order_cancellation_items`)已有取消 2、但摘要列還沒建 ⇒
`COALESCE(…, 0)` 讓守門以為取消 0 ⇒ 放行加開採購 2 ⇒ 最終摘要 `ordered=2 / cancelled=2 / instock=0`
**通過全部七條 CHECK,而那是錯的狀態**。
⇒ **A2b1 的守門必須:鎖 parent `order_items` 後,直接從真相表(`order_cancellation_items`)重算**,
或呼叫具名的 lock+recompute 函式(🔀 2026-08-03 Q4=A:~~「並對『真相非零但摘要列缺失』fail-closed」~~ 子句撤下 —— 直讀真相表變體使其語意落空,負測意圖由「竄改摘要列」負測承接)。
`COALESCE(…, 0)` 只准用在**顯示**路徑。負測必含「刪掉/竄改摘要列之後,守門仍然正確」。行為單元測同片 | — |
| 29 | **A2b2** | T | A2b1 的**負向測試片**:雙交易競態(兩 session 併發插入,assert 守門擋下)+ delta 守門負測(先取消再加購必須 `RAISE`) | — |
| 30 | **A4a** | T | 🔴 **重算 constraint trigger**(R5 抓:「RPC 記得呼叫」= 第二真相):掛 **`order_item_procurement` / `order_item_procurement_receipts` / `order_cancellation_items`** 三張表的 AFTER INSERT/UPDATE/DELETE,同交易重算 **`order_item_quantity_summary`**。🔴 **`order_item_procurement_receipts` 不可漏**(R3 抓):`received_quantity` 的真相來源是逐批到貨明細,只掛 `order_item_procurement` 的話,**「只 INSERT 一筆到貨明細」這個最常見的動作不會觸發任何重算** ⇒ `instock_quantity` 永遠是 0。驗收必含「只 INSERT receipt」案例 + 移除該 trigger 的突變(2026-07-31 起摘要不在 `order_items`)。**無手填入口、無「忘記呼叫」路徑**。🔴🔴 **併發序列化(codex 關卡2 2026-07-31 抓,必做)**:摘要列**惰性建立** ⇒ 採購交易與取消交易可能**同時**對同一品項首次建列,兩邊各自只讀得到自己那一軸、後寫者把另一軸覆蓋成 0,而**七條 CHECK 全數通過**(`0 <= quantity` 恆真)⇒ 靜默丟失更新。**修法寫死**:trigger 內**先 `SELECT … FROM order_items WHERE id = <parent> FOR NO KEY UPDATE`**(🔀 2026-08-03 Q4=A 改原語:與 A2b1 同一把鎖;`FOR UPDATE` 會與 FK RI 的 KEY SHARE 死結,A2b1 實測),**鎖到之後才重讀兩個來源表**並 upsert 摘要。**驗收必含雙連線遺失更新負測**(A4b:兩條連線分別寫採購與取消,結束後兩軸都必須正確)。
🔴🔴 **A4a 的 definition of done 另加一條硬前置(R3 抓)**:**本片上線前必須先寫出並演練
「摘要表已有真實資料時的回滾程序」** —— A1 的 §9 只寫了「A4a 之前直接 DROP」,
而 A4a 一上線那張表就有錢相關的衍生資料,屆時直接 DROP 會被 trigger/函式依賴擋住,
硬拆依賴又會讓 A9c/A8a2 當場壞掉。程序至少含:停寫與停守門 → 保存並對帳摘要 →
逆序撤下消費端 → 移除/替換 trigger → 由真相重算 → 切換。**依賴未清零前不得 DROP。****無鎖版本必須先被證明會壞**(消融),否則等於沒證明這道鎖有用。行為單元測同片 | — |
| 31 | **A4b** | T | A4a 的**負向測試片**:雙交易競態負測 + 漂移 assert(隨機抽單重算比對) | — |
| 32 | **A5a** | R | `admin_upsert_item_procurement` owner RPC(窄)。🔀 **2026-08-01 改**:**只收 `supplier_id`(uuid),不再收供應商名稱文字、不再有 canonical key**(A5b 已作廢):upsert 鍵 `(order_item_id, supplier_id)`(S1b 換軸後的 DB unique,約束名不變)、**同 payload 重放 = no-op**(A9h 批次重送靠這層冪等)。🔴 **新增契約債(S1b 帶來)**:FK 只驗「這家存在」、**不驗「這家可用」** ⇒ 本 RPC 必須自己**拒收 `is_active=false` 的供應商**,否則員工在停用之後仍能對它下新單;驗收條件必須含一條「指向已停用供應商 → 被拒」的負測。🔀 **2026-08-03 Sean 拍板 Q1=A 精確化「被拒」的範圍**(片級 plan `docs/specs/2026-08-03-e10-a5a-item-procurement-upsert-plan.md` §7;關卡1 三輪審查抓到本字面對「既有列更新」語意未定 = 雙權威):**拒 = ①新建指向停用供應商 ②既有列調升 `allocated_quantity`**(兩者皆屬「向停用供應商下新單」);**放行 = 既有列的事實記錄欄更新**(回覆狀態/單號/異常原因/預計到貨/聯絡管道/送出時間)—— 停用後往往正是要密集記錄「這家怎麼了」的時候,全鎖會逼員工把紀錄寫到系統外。**另:同 payload 重放(no-op、零寫入)不受停用影響**,否則 A9h 批次重送的冪等會被供應商狀態變化擊破+ `first_ordered_at` 僅首寫 / `status_changed_at` 每次更新 / no-op 不動日期 / 業務日 Asia/Taipei server 端算。摘要由 A4a trigger 自動重算、總量與 delta 守門在 A2b1 —— **本片不重複實作** | — |
| 33 | **A6** | R | `admin_append_order_note` owner RPC | — |
| 34 | **A8c1** | R | 🔴 **金流 begin 側取消守門**(🔴 R9:表序改為守門先於取消,與 §5.0 部署序一致;實查 `confirm_payment` 零 cancelled 檢查):**具名 = `begin_charge_attempt`**(R10 更正起點;🔴 **R11 更正基底版本:最新定義 = `20260613140000:73`(0c)**,非 130000 —— 0c 補了 `needs_settle` 回傳 `existing_bank_transaction_id`,照舊基底 CREATE OR REPLACE 會把它蓋掉。**以 0c 為基底只加鎖與取消守門,附「回傳仍帶 `existing_bank_transaction_id`」回歸測試**)。附**取消併發與全域鎖序負測**—— 先 `FOR UPDATE` 鎖 orders 列 → 存在任何取消紀錄(`cancelled_at` 非空或 `order_cancellations` 任一列)⇒ `RAISE` 拒開卡流程。**動既有金流函式 = 鐵則 12①,必過 codex 關卡2**;附負測 | — |
| 35 | **A8c2** | R | 🔴 **金流 confirm 側取消守門**:同 A8c1 合約套在 **`confirm_order_payment`**(實名)。附負測 | — |
| 36 | **A8a1** | R | `admin_cancel_order` **整單取消核心片**(合約 §5.1b / §5.1d):🔴 **鎖序合約:先 `SELECT … FROM orders WHERE id = $1 FOR UPDATE` 再做一切檢查** —— 本片與 A8a2(同一支 RPC 的第二施工片)、A8c1/A8c2 所改的兩支金流 RPC:**三支 RPC、四個施工片、同一鎖序**(R9 更正「五支 RPC」字面)。🔴 **允許集合(R9 再收斂):第 1 批只允許 `payment_status = 'unpaid'` 且該單 `payment_charge_attempts` 全為終態 `failed` 或零筆** —— `refunded` 分支移除(R9 抓恆假字面:真 TapPay 退款單保留 `charged` attempt,永遠過不了後半條;refunded 單要取消 = `RAISE` 走人工);其餘狀態一律 `RAISE`(退款線第 3 批)。冪等鍵 + payload hash、寫 header、對客欄(整單才寫 `orders.cancelled_*`、`other` 用 `reason_detail` 映射)。🔴🔴 **A7 定下的部署約束(Sean 2026-07-30 拍 Q2=A 寫進本列)**:**本片不得單獨發布** —— 必須與 **A8a2 同批**,或本片自己就寫入整單全部品項的 `order_cancellation_items`。理由:A8a1 單獨上線會產生**零明細 header** ⇒ A4a 重算掛在 items 上、看不到整單取消 ⇒ `cancelled_quantity` 恆 0,而 A8c 已因「存在取消紀錄」封鎖該單付款 ⇒ **單子既沒被真正取消、又收不到錢**;且 A8a2 後上線**不會自動修復**已寫下的列。**片級 plan 必須明確選一邊並寫進驗收條件,不得以「讀法待確認」開工**(詳 `docs/specs/2026-07-30-e10-a7-order-cancellations-plan.md` §6.1)。🔴🔴 **shipped_quantity 契約債(A1 2026-07-31 立)**:第 2 批建包裹模型的同一片必須把 `shipped_quantity` 納入 ~~A1 的兩條 CHECK~~ **C6 一條**(`cancelled + shipped <= quantity`;**C7 不動**,加 shipped 會與 instock 重複計數)~~與本片/A8a2 的可取消量守門~~ **(RPC 公式不動,由 C6 當表級 backstop)**。🔴 **2026-08-05 兩度更正的來由**:第一次以為「`shipped ⊆ instock` ⇒ 既有 C7 已涵蓋」,但**該推論的隱含前提「instock 單調不減」為假** —— receipts 的重算 trigger 是 `AFTER INSERT OR UPDATE OR DELETE`(`20260803140000:416`)⇒ 刪改到貨紀錄會讓 instock 下降到 shipped 以下,已寄出的件變回可取消。⇒ **~~必須有一條不依賴 instock 的表級不變式 = C6~~**。🔴 **2026-08-05 K1 R3(F3)作廢,本行不得依它施工**:C6′ 是掛在**衍生摘要表**上的 CHECK,而摘要值由 trigger 維護 —— A4a 的 break-glass `DISABLE TRIGGER` 程序(`20260803140000:82-121`)停用期間摘要不再反映真相、CHECK 比對的是過時值 ⇒ 它是「**trigger 通電時才成立的不變式**」,不是表級不變式。**「shipped 該在哪一層被強制」整題已重新開放、尚未定案**(三代分析全被證偽)。詳 A8a2 列與 `docs/specs/2026-08-05-e10-b2-shipments-db-plan.md` §0.1。🔴 **2026-07-31 連動**:整單取消的可取消量若要讀 `instock`,來源是 `order_item_quantity_summary` 且**列可能不存在** ⇒ 必須 `LEFT JOIN` + `COALESCE(…, 0)`| — |
| 37 | **A8a2** | R | **品項層部分取消擴充片**(同一支 `admin_cancel_order` 的第二施工片):`order_cancellation_items` 寫入、可取消量守門 `增量 ≤ quantity − instock − cancelled`(Q17=B)、多次部分取消累積至全量時補寫對客欄。🔴🔴 **2026-07-31 連動(R3 抓)**:`instock` / `cancelled` 現在在**惰性建立的非權威快取** `order_item_quantity_summary` ⇒ **可取消量守門不得讀它**(摘要列缺失時 `COALESCE` 成 0 會放行超量取消,而結果仍通過全部 CHECK)。**必須鎖 parent 後從真相表重算**,並對「真相非零但摘要列缺失」fail-closed。負測必含「刪掉摘要列後守門仍正確」。🔴🔴 **shipped_quantity 契約債(A1 2026-07-31 立,對本片有約束力)**:第 2 批建包裹模型時,**同一片**必須 ① 加 `shipped_quantity` ② **把它納入 `oiqs_cancelled_le_quantity`(2026-08-05 二度更正:**本項成立、必須做**;C6 改成 `cancelled + shipped <= quantity`)**;~~與 `oiqs_instock_cancelled_le_quantity`~~ **(C7 不動 —— 加 shipped 會與 instock 重複計數)** ③ ~~把本片的可取消量守門改成 `增量 ≤ quantity − instock − cancelled − shipped`~~
🔴🔴 **2026-08-05 B2 關卡1 更正:此字面是錯的、且第 2 批不執行**。`shipped ⊆ instock`
(出貨的貨必先到貨;Sean 08-05 拍板「無直送」)⇒ 已出貨的量**本來就含在 `instock` 裡**,
再減一次 shipped = **重複扣**,會把可取消量算得比實際少。
⇒ **正確做法 = 公式維持 `增量 ≤ quantity − instock − cancelled` 不動**(現行 `20260805160000` 未改;
`20260805100000:395` 該行註解自稱「shipped 退化式」—— 它不是退化式,它就是正確式)。
🔴 **注意:上面這段是 2026-08-05 的「第一代更正」,它自己也已被二度更正** ——
當時寫「第 2 批只剩 ①加欄 ②新增 `shipped ≤ instock` CHECK(C6/C7 不動)」,**兩處都錯**:
~~①`shipped ≤ instock` **不做成表 CHECK**(receipts 可刪 ⇒ instock 非單調 ⇒ 該 CHECK 會讓無關的摘要列變非法),
改走出貨側守門;②**C6 必須改**成 `cancelled + shipped <= quantity`(唯一不依賴 instock 的表級不變式)。~~
🔴 **第二代更正本身也已被 K1 R3 推翻(2026-08-05;主視窗清汙染時漏掉本行,B2 視窗補清)**:
①的理由(F6)**事實錯誤** —— A4a 重算是 **row-level、只重算受影響的那個品項**
(`20260803140000:277-296` 親讀)⇒ **不存在「無關的摘要列」**;
②(F3)C6′ 掛在**衍生摘要表**上,break-glass `DISABLE TRIGGER` 期間比對過時值 ⇒
**不是表級不變式**。⇒ **兩代結論全數作廢、本題重新開放尚未定案,任何一版都不得拿來施工。**
**現行唯一權威 = `docs/specs/2026-08-05-e10-b2-shipments-db-plan.md` §0.1**。
詳 `docs/specs/2026-08-05-e10-b2-shipments-db-plan.md` §0.1/§2(2026-08-05 停損改版後的段號)。同 A8a1 鎖序與允許集合;摘要由 A4a trigger 重算。🔴 **誠實邊界**:部分取消後 A8c 會封鎖該單的卡收款 ⇒ 剩餘品項的付款回路(應收重算)= 第 3 批,第 1 批部分取消「安全可用但未閉環」,UI(A13a)明示。🔴 **與 A8a1 的同批約束**:見 A8a1 列的「不得單獨發布」(Sean 2026-07-30 拍 Q2=A)—— 若 A8a1 選擇「自己寫整單 items」,本片仍須與它同批驗收部分取消路徑。  🔴🔴 **合約債(A7-t 2026-07-30 立,對本片有約束力、不是「日後自動生效」)**:**若本片要 DELETE 或 UPDATE `order_cancellation_items` / `order_refund_items` 的既有列,必須先補上「trigger 內鎖 parent」+「隔離級 fail-closed 閘」** —— 否則取消側與退款側的主從一致防護都會靜默失效。依據:`REPEATABLE READ` 下兩交易各刪一列會雙雙放行(本機 PG17.10 實測,證據 harness = `scripts/a7t-concurrency-probe.sh`);**鎖 parent 單獨不足以補**(同一 harness 實測)。現行 append-only 寫法不觸發本條。 | — |
| 38 | **A9a** | A | 讀模型:訂單明細的 notes + procurement 投影、型別、mapper | — |
| 39 | **A9b2** | A | 跨單搜尋合約:依**供應商單號**命中(讀 `order_item_procurement`)。走 adapter 投影、不開 DB RPC(單號搜尋的另一半 = A9b1,已在 D1 前完成) | — |
| 40 | **A9c** | A | 列表投影改造:三軸欄位進 `ADMIN_ORDER_LIST_SELECT`。🔴 **純加法片**(R6)—— stale 欄的 UI 下架在 A9e、契約收縮在 A9r | — |
| 41 | **A9d1** | A | server actions:counters / procurement 兩支 | — |
| 42 | **A9d2** | A | server actions:note / cancel 兩支 | — |
| 43 | **A9g** | A | 🔴 **取消 + 退款工作讀模型**(R5 抓:A13 要顯示「歷次取消、剩餘可取消量、refund job 狀態」,但 A9a 只有 notes/procurement):cancellations 歷程投影、逐品項剩餘可取消量、refund job 狀態(第 1 批因 A8a1/A8a2 fail-closed 恆為空集合,投影照建) | — |
| 44 | **A9h** | A | 🔴 **批次訂貨 coordinator(writer 側編排;R6 自「讀模型」格移正)**:server 端逐列呼叫 A5a。🔴 **R7 收斂:冪等完全 = A5a 的 business-key upsert 與 no-op 重放,本片不自建批次冪等**(上一版宣稱 `batch_id` 冪等但未持久化、無 DB unique = 空頭支票;重送批次 = 逐列重放、已成功列自然 no-op);**併發上限 = 5(固定值,序列分批)**;逐列結果型別(成功 / 失敗 / 原因),供 A12b 消費 | — |
| 45 | ~~**A5c**~~ | — | 🛑 **2026-08-01 作廢(Sean 拍板換路)**。原內容 = 相似候選查詢 + 警告資料合約。🔴 **取消理由是它在 PCM 真實資料上會給出錯的建議**:Sean 的 26 家名單裡 **Webike TW / JP / EU 是三家**(同公司、三個下單管道、不同價格運費前置時間),而任何「相似即合併」的規則都會建議把它們併成一家。取代者 = **S3b 新增畫面的 typeahead**(打「Webike」當場列出已有三筆)—— 用人眼防重複,而且比機器準 | — |
| 46 | **A9e** | U | 🔴 **admin stale `fulfillment_status` 顯示端下架**:`order-detail.tsx:202` / `customer-detail-sections.tsx:71` 移除該欄改顯示品項層訂貨狀態;`order-filter-bar.tsx:36,30`、🔴 **`order-filter-controls.tsx` 整檔**(復盤L2 抓漏)與 `order-list-view.ts:31,149,184` + VALUES/LABEL/OPTIONS 常數群(:56/:88/:127-129)移除篩選參數。🔴 **先於 A9r**(消費端先停,契約才收縮) | — |
| 47 | **A9f** | U | 🔴 **storefront 顯示端**(Q12=B + R7 修正):主對話實查 `order-display.ts` 的 `orderStatusLabel` **既有映射已是付款軸優先且 5 值 exhaustive + never 守門**(refunded→已退款 / unpaid→待付款 / partiallyPaid→付款確認中 / partiallyRefunded→已退部分)⇒ **本片只動 `paid` 分支**:`PAID_FULFILLMENT_LABEL[fulfillment]` 讀的是 stale 出貨軸 → `paid` 第 1 批一律回「處理中」,**其餘四值沿用既有鎖定文案、一字不動**(R7 抓:上一版自己發明新文案會覆蓋已拍板字面)。消費端 `OrdersTab.tsx:45` / `OverviewTab.tsx:108`。跨 app、面向客人,單獨成片;🔴 **contract 債:第 2 批接回包裹真相**(§5.2)。**先於 A9s** | — |
| 48 | **A9s** | A | 🔴 **storefront 資料契約收縮**:投影移除 `fulfillmentStatus`、mapper 與 `OrderListItem` 型別同步、消費端測試更新。🔴 **在 A9f 之後**(先砍型別會讓仍在讀的 TSX 編譯斷) | — |
| 49 | **A9r** | A | 🔴 **admin 資料契約收縮(R6 新增)**:`ADMIN_ORDER_LIST_SELECT` / 明細 adapter / 客戶摘要 adapter 與對應型別移除 `fulfillment_status`,消費端測試同步。**在 A9e 之後** | — |
| 50 | **A9w1** | U | 🔴 **九碼明細頁下架**(P3 退場;R16 拆:原 A9w 全塞一片超時):明細頁 `ItemWorkflowStatusCell` 移除、品項列改三軸顯示(消費 A9a/A9c 投影)。列表側的九碼 cell **隨 A11a-c 重建自然退場**、不另開片 | — |
| 51 | **A9w2** | U | 🔴 **九碼週邊 UI 下架**:九碼篩選與 URL 參數、`order_status_options` 狀態設定 CRUD 頁(九碼的管理入口)**一併下架**(R18 刪「或標唯讀」殘字 —— A9w4 已拍死單一路徑 = 下架) | — |
| 52 | **A9w3** | A | 🔴 **九碼契約收縮**:adapter 投影 / mapper / 型別 / 消費端測試移除 `workflow_status`(admin 側;在 A9w1/A9w2 之後) | — |
| 53 | **A9w4a** | A | 🔴 **九碼 item writer 拆除**(R18 拆三:原 A9w4 全鏈一片超時):item-workflow 的 server action 與 form parser 具名移除;**高風險(server action 授權邊界)** | — |
| 54 | **A9w4b** | A | 🔴 **九碼 status-options writer 拆除**:`status-option-actions` / `status-option-form` 具名移除(狀態設定的寫入端);**高風險(server action 授權邊界)** | — |
| 55 | **A9w4c** | A | 🔴 **九碼 contract / exports 收縮**:port、adapter 呼叫端、barrel exports、殘留型別與測試清除。在 A9w4a/A9w4b 之後 | — |
| 56 | **A10a** | U | 明細頁:內部備註 + 聯絡紀錄時間軸;🔴 **含 U6「已告知客人」的結構化欄位**(時間 / 管道 / 摘要)寫入與讀回 | **3** |
| 57 | **A10b** | U | 明細頁:逐品項採購表單(含分配數量、到貨數量、異常原因、**供應商下拉選單**)。🔀 **2026-08-01 改**:~~相似值警告~~ 隨 A5c 作廢;供應商改為從主檔選(`S3a` 的讀模型供料、字母序、typeahead),**不再是自由文字**。🔴 本片是 `suppliers.is_active` 的**第一個真實消費端** —— ~~停用的供應商不得出現在這個選單裡~~ 🔀 **2026-08-04 A10b 施工時修正為:停用的供應商不出現在選單,**除非本品項已經有一列採購指向它**。理由 = S1b `:183` 明文業務鍵不阻止採購指向已停用者,而 Sean 2026-08-03 晚拍 Q1=A 只擋「新建」與「調升 allocated」、**事實記錄欄照常可更新**(A5a `:326`)⇒ 照原字面把它從選單拿掉,那一列就**永遠改不了**了。選單仍標記「(已停用)」、A5a 為第二道。原字面早於 08-03 那次拍板,非推翻拍板。🟡 同 row 的 **typeahead 未實作**(A10b 用純 `<select>` + zh-TW 字母序)。**Sean 2026-08-04 拍板 A:這期不做,需求移入具名 backlog `#308`**(`docs/phase-1-backlog.md`;含「不修未來會痛在哪 = 供應商成長到 50+ 家時純下拉難找,現況 26 家可用」)—— 需求有家、不是被施工端註記關掉(在此之前 `is_active` 是無作用旗標) | **5, 6, 7**(🔴 R5 抓:第 7 項 = **A10a+A10b 聯合驗收** —— 告知紀錄在 A10a、異常原因在 A10b,兩片皆完成才綠) |
| 58 | **A10c2** | U | 依供應商單號搜尋畫面(消費 A9b2) | — |
| 59 | **A11a** | U | 列表桌機:🔴 **13 欄骨架**(Sean 07-29 拍 A0b-1=B;**欄位清單唯一權威 = §5.1a**,「12 欄」舊字面作廢)**+ rowSpan 分組重算**(§7.2) | — |
| 60 | **A11b** | U | 列表桌機:**三軸膠囊元件**(付款單層 / 訂貨·出貨品項層,`n/m` 顯示;出貨軸唯讀灰) | — |
| 61 | **A11c** | U | 列表**手機卡片版**(通用 UI 規範 §4-1) | **1(部分)** |
| 62 | **A9v** | M | 🔴 **九碼 writer 停寫(R16 修正誤殺)**:**REVOKE `admin_update_order_item_workflow`**(item 支)+ 🔴 **R18 補:撤 `order_status_options` 的 service_role INSERT/UPDATE 寫權 + ACL 終態斷言**(否則 P3 停寫不真 —— UI 下架了、寫權還在)—— `admin_update_order_workflow` **保留**:親驗 `20260716120000:76` 它已在 D-2 收窄(送 `workflow_status` key = RAISE)、現管運送方式與發票四欄,撤了會讓合法改單失效。前置 = **grep 驗證全部 consumer(A9w1-4c + A11 重建後)零引用**;`order_items.workflow_status` 欄凍結不 DROP。**表序已同步:本片排 A11c 之後**(R17 修 DAG 循環) | — |
| 63 | **A12a** | U | 列表批次選取(選取狀態 + 全選 / 反選 + 跨頁行為)。🔴 **不套 `<AdminDataTable>`**,理由見 §7.3 | — |
| 64 | **A12b** | U | 批次標記訂貨動作 + **部分失敗逐列顯示**(UX §4 #20;消費 A9h 的逐列結果) | **4(部分綠:僅訂貨面)** |
| 65 | **A13a** | U | 取消訂單 **影響範圍複核頁**(UX §5 #24:品項 / 數量 / 金額 / 收件快照 / 不可逆後果);🔴 **已到貨品項顯示「不可取消,需走退貨(第 3 批)」**(Q17=B);🔴 **已付款單顯示「取消需退款,退款線第 3 批開通」**(R7 fail-closed) | — |
| 66 | **A13b** | U | 取消訂單主流程(消費 **A9g** 的歷程 / 剩餘可取消量) | **19(部分綠:未付款取消閉環)**(🔴 R7 抓:已付款取消的 refund job 在 worker(第 3 批)存在前只會長期 `queued` = 假閉環 ⇒ 已付款取消 fail-closed 至第 3 批;**19 全綠隨第 3 批 A8b + worker**) |
| 67 | **A14a** | U | 狀態旁固定「下一步」(UX §5 #21),同一套詞彙貫穿列表 / 明細 | — |
| 68 | **A14b** | U | 「編輯訂單」入口拆分(UX §5 #26):訂單資料 / 修改品項與地址 / 付款調整;不可做的顯示原因 | — |
| 69 | **A14c** | U | 空狀態動作(UX §5 #25)。🔴 **不放「建手動單」**(第 3 批才有 = 死按鈕);只放「清除篩選」與「查詢範例」 | — |

**第 1 批片數:🔴 ~~「= 69 片」~~ 這個寫死的數字已失真、不要引用(關卡2 R2 抓)。**
本檔的規則本來就是「片數一律以 §5.1 表格 `awk` 當場數為準、不寫死」,而下面這行違反了它。
**2026-08-01 的組成變動**:`A5b`(row 27)與 `A5c`(row 45)標作廢 = **−2**;
供應商線改為 **S1a / S1b / S2 / S3a / S3b 五片 = +5**,但它們**刻意不列進本表**
(避免動到片號口徑),權威在片級 plan `docs/specs/2026-08-01-e10-supplier-master-plan.md` §4。
⇒ **要總數請當場數**:`awk` 數 §5.1 資料列、扣掉標 `~~` 的作廢列、再加供應商 plan §4 的 5 片。
舊的片型分佈(U / runbook / A / M / R / T / docs)同理:**數的時候一起重算,不要抄下面這串**。

🔴 **2026-07-30 增補說明(誠實記錄,不動上面兩個 `awk` 數字)**:
第 24 列(A7)實際對應 **3 個施工片**(A7-1 / A7-2 / A7-t;拆片依據 = 本節估時紀律「估超 45 分鐘當場再拆」,
新增 A7-t 依據 = Sean 07-30 拍 Q1=A)。
⇒ **本表列數仍是 69**、片型分佈那行也不動 —— 因為那兩個數字的定義是「對**本表列**的 `awk` 計數」,
而 A7 的三個施工片登記在第 24 列**列內**(先例:A7 的兩表同片建也是登記在一列裡)。
**施工片實數 = 71**。這行存在的理由:不寫的話,日後有人重新 `awk` 會以為片數對不上而「順手修正」某個數字 ——
本檔已經因為手算片數錯過兩次(§6.3)。

🔴 **高風險(判準:M / T / runbook / R 一律;A 型命中「service_role-only 表讀取投影」「server action 授權邊界」或「共用金流 adapter」才算)**:
M 7 + T 5 + runbook 14 + R 6 + A 10(A9a / A9b2 / **S3a**(~~A5c~~ 2026-08-01 作廢) / A9g 讀 service_role-only 表;A9d1 / A9d2 / A9h / **A9w4a / A9w4b(R18 補列 —— server action 授權邊界)** 是授權邊界;A15 動共用金流 adapter)= **42 片**。
A9b1 / A9c / A9s / A9r / A9w3 / A9w4c 不算(只動客人可讀表或退場中投影,無權限面);docs / D / U 不算。

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
| 內部 vs 對客 | `reason_code`(受控 code,內部)存本表;**對客文字**寫 `orders.cancelled_reason`,兩者由 RPC 同交易寫入。✅ **allowlist 與映射已定案 = §5.1d**(Q18,Sean 2026-07-28 拍「照這份」);未知 code 一律 `RAISE` fail-closed。A7/A8 開工阻擋解除 |
| 與採購連動 | 取消後 `cancelled_quantity` 上升 ⇒ `ordered_quantity` **不自動下降**(已向供應商下的單不會因客人取消就消失);差額由第 3 批的採購退貨處理。✅ **已到貨後取消 = 不可(Q17=B,Sean 2026-07-28)**:已到貨部分只能走第 3 批退貨流程 ⇒ §5.1c 第四條不變式 `instock + cancelled ≤ quantity` **成立、隨 A1 上 CHECK(2026-07-31 起該 CHECK 在新表 `order_item_quantity_summary` 上,不在 `order_items`)**;A8a2 可取消量守門 `增量 ≤ quantity − instock − cancelled`,違反 `RAISE`;A13a 對已到貨品項顯示「不可取消,需走退貨」。🔴 **R6 的反向守門同步解**:A2b1 的 delta 守門(取消後不得為已取消部分加開採購)與本格互為表裡 |
| 🔴 已出貨禁取消 | **上一版寫反了**(R4 抓,成立):我寫「包裹真相不存在 ⇒ 無法證明未出貨 ⇒ 不得取消」,但第 1 批**本來就沒有包裹模型** ⇒ 條件恆假、**一件都取消不了**,卻同時宣稱第 19 項變綠。**正確寫法**:第 1 批 `shipped_quantity` 欄**不存在**,出貨這件事在系統裡尚未發生 ⇒ 取消照常運作(Q17=B 的已到貨守門另計,見「與採購連動」格)。🔴🔴 **2026-08-05 B2 關卡1 更正**:~~不變式 `cancelled ≤ quantity − shipped`~~ 這個「完整式」**本身就寫錯了** —— `shipped ⊆ instock`(Sean 08-05 拍板「出貨必先到貨、無直送」)⇒ 既有的 `instock + cancelled ≤ quantity`(C7)**已經涵蓋**「已出貨不可取消」,不需要獨立的 `− shipped` 項。⇒ **contract 債的實質內容在第 2 批已由既有實作滿足**;第 2 批只需加 ~~`shipped_quantity` 欄 + `shipped ≤ instock` CHECK,**不改 RPC 公式**~~ 🔴 **2026-08-05 K1 R3 作廢(第一代字面;主視窗 08-05 清汙染時漏掉本行,B2 視窗補清)**:`shipped ≤ instock` 做成摘要表 CHECK 是 v2/v3 字面,已兩度被推翻且**本題重新開放、尚未定案**。**不得依本行施工。**詳 `docs/specs/2026-08-05-e10-b2-shipments-db-plan.md` §0.1 |
| 🔴 已付款取消 | 🔴 **R7 收斂 + R8 加嚴:第 1 批整個 fail-closed** —— A8a1/A8a2 只允許 **`payment_status = 'unpaid'`**(R9 再收斂:`refunded` 分支是恆假字面已移除)**且該單 `payment_charge_attempts` 全為終態 `failed` 或零筆**(R8:只排 `pending` 仍會取消到已扣款未回填的單),其餘一律 `RAISE`。🔴 **三支 RPC、四個施工片(`admin_cancel_order` 兩片 + `begin_charge_attempt` + `confirm_order_payment`;R10 更正起點實名)統一先 `orders FOR UPDATE` 再檢查**(R8:消「取消與付款各自檢查各自通過」的競態);**部署序 A8c 守門先上、A8a 取消才上**。第 3 批依 §5.0 解鎖線(worker dormant → A8b → UI → enable)開通:enqueue `order_refund_jobs`(狀態機、fencing、`bank_refund_id` 外部冪等、reconcile 基準、`submitted` 隔日確認全在 A7b 合約);金額矩陣在 A8b(§5.3)。🔴 **第 19 項第 1 批 = 部分綠:整單取消閉環;部分取消安全可用但剩餘品項卡付款被守門封鎖(應收重算第 3 批,A13a 明示)** |

#### 5.1c 計數器跨欄不變式(第 1 批版本;**四條全上**)

🔴 **落點(2026-07-31 Sean 拍板後)**:四條全部是 **`public.order_item_quantity_summary` 的同表 CHECK**
(`quantity` 去正規化進該表、由複合 FK 釘死)—— **不在 `order_items`**。實作為七條具名約束
(四條 + 三條非負下界;非負是必要補強:少了它 `instock = -5` 會同時滿足第二、四條而被放行)。
🟡 其中兩條在數學上被其他條蘊含、**行為層無法單獨觸發**(`ordered ≥ 0` 由非負+第二條蘊含;
`cancelled ≤ quantity` 由非負+第四條蘊含)⇒ A1 只對它們做結構層逐字比對,不宣稱行為獨立性。

`ordered_quantity ≤ quantity`、`instock_quantity ≤ ordered_quantity`、`cancelled_quantity ≤ quantity`、
✅ **`instock_quantity + cancelled_quantity ≤ quantity`**(Q17=B,Sean 2026-07-28:已到貨不可取消、走退貨 ⇒ 第四條成立,隨 A1 上 CHECK)。
🔴 第四條實作**必須轉 `bigint` 再相加**:兩個 `integer` 相加會先溢位成 SQLSTATE 22003、**根本到不了具名 CHECK**
(`order_items.quantity` 只有 `> 0`、無上限 ⇒ 三值同取 int 上限是合法輸入)。2026-07-31 本機 PG17.10 實測:
有 cast → 23514 命中該約束;無 cast → 22003 `integer out of range`。
⚠️ 出貨與退貨的不變式**隨它們的軸在第 2/3 批一起加**(§1 原則 2),此處不預先寫。

🔴 **綠燈只掛在鏈末**(原則 4;codex R2 抓「A4/A5/A6 只有 RPC 就宣稱變綠」):
schema 片與 RPC 片**一律不宣稱任何項變綠**,綠燈落在**同時具備讀取路徑與 UI 且有驗收證據**的那片。
本批綠:**3, 5, 6, 7 全綠**;🔴 **第 4 項 = 部分綠(僅訂貨面,出貨面第 2 批)**;
🔴 **第 19 項 = 部分綠(R8 精確化:整單取消 = 閉環;部分取消 = 安全可用但剩餘品項卡付款被 A8c 封鎖、應收重算第 3 批;已付款取消 fail-closed 至第 3 批解鎖線)**;
第 **1** 項亦為部分(看得到今天有什麼,完整待辦要等第 3 批)。

⚠️ D1 線十四片(D1a0-D1c;R11 再拆 D1t)中**僅 D1c 不可逆** ⇒ 見 §8.4 的獨立批准閘與驗收矩陣。

#### 5.1d 取消原因 allowlist 與對客映射(✅ Q18 定案,Sean 2026-07-28 拍「照這份」)

| `reason_code`(內部) | 對客文字(寫 `orders.cancelled_reason`) |
|---|---|
| `customer_request` | 依您要求取消 |
| `out_of_stock` | 商品供貨中斷,已為您取消 |
| `long_leadtime` | 交期無法配合,已為您取消 |
| `price_change` | 依您要求取消 |
| `duplicate_order` | 重複訂單,已為您取消 |
| `internal_error` | 依您要求取消(🔴 **刻意不對客揭露我方疏失** —— Sean 知情核准) |
| `other` | **手寫必填**(RPC 驗非空白;內部與對客同文字) |

映射表是**可測合約**:A7 的 CHECK 收斂 `reason_code` 到這 7 值;A8a1 依表產對客文字、未知 code `RAISE` fail-closed;測試逐 code 驗映射。
🔴 **`other` 的手寫文字落點 = `order_cancellations.reason_detail`**(R7 抓:原合約無處存放;部分取消不寫 `orders.cancelled_reason`,沒有這欄文字就遺失):CHECK 鎖 `other` 必填非空白、其餘 code 必 NULL;整單取消時 A8a1 把它映射為對客文字。

#### 5.1a 版面規格(repo 內可驗字面,取代 artifact)

🔴 **13 欄**(Sean 2026-07-29 拍板 A0b-1=B;原寫 12 欄):
訂單編號(含付款軸小字)/ 日期 / 品牌 / 料號 / 品名 / **年份廠牌車種** / 數量 / 金額 / 客戶(含等級小字)/ 訂貨 / 出貨 / 發票 / 操作。

> **為什麼從 12 改成 13**:A0b 逐欄對帳發現原清單把兩個現行欄悄悄拿掉、且全檔未寫理由 ——
> ①「年份廠牌車種」(V-3b 專門做的欄,`orders-table.tsx:104-107` 由 `vehicle_snapshot` 逐品項直出)
> ②「來源 · 管道」。Sean 看過三案並排視覺(artifact `68a00571-7efc-49e1-9758-472a650b156e`)後拍 **B**:
> **車種留下**(員工揀貨與確認相容性會看,拿掉等於每筆都要多點一次明細頁)、
> **來源 · 管道拿掉**(明細頁 `order-detail.tsx:203-206` 已有,不是每天要看的資訊)。
> ⇒ 欄數與現行 13 欄相同,擁擠度不比現況差。**A11a 依本行施工,不依「12 欄」舊字面。**

| 動作 | 欄 | 理由 |
|---|---|---|
| 合併 | 單價 + 總金額 → 「金額」 | 🔴 **2026-07-28 實查更正**:39 個品項列 **`quantity` 全為 1**(`max(quantity)=1`)⇒ 單價 = 該列小計,兩欄數字相同;**但有 5 張單是多品項單**(39 列分佈在 29 張單)⇒ 那 5 張的整單總額 ≠ 任一列單價。**規則必須是「品項列 >1 **或** 任一列 `quantity` >1 就在合併格顯示整單總額」** —— v1 只寫了 `quantity >1` 這半條,會讓多品項單看不到總額 |
| 移除 | 會員等級 | 併進客戶格第二行小字 |
| 移除 | 商品狀態(9 碼下拉) | 退場,原地換成訂貨 + 出貨兩欄 |
| 🔴 移除 | **來源 · 管道** | Sean 07-29 拍 A0b-1=B。明細頁 `order-detail.tsx:203-206` 已有,不是每天要看的資訊 ⇒ 列表讓位給三軸 |
| 🔴 保留 | **年份廠牌車種** | Sean 07-29 拍 A0b-1=B。V-3b 專門做的欄(`orders-table.tsx:104-107`,`vehicle_snapshot` 逐品項直出);員工揀貨與確認相容性會看,拿掉等於每筆多點一次明細頁 |
| 新增 | 發票 | 三軸之外的收尾軸(A11a 前置 = 既有 `pending_invoices` 四欄已在明細頁);列表只顯示載具別與開立與否 |
| 新增 | 操作 | 取消 / 檢視入口。第 1 批「取消訂單」這個動作第一次存在(27 項第 19 項),需要列表層入口 |
| 改寫 | 日期 → `07/25` | **跨年才補年份**(`2025/06/27`);完整時間戳仍在 DB |

**三軸落點**:付款 = 訂單層(rowSpan 合併格內小字,「待付款」紅 = **design token `--c-red`(#dc2626,`tokens.css:16`)** —— 🔴 復盤L2 抓:原寫的 `#E73928` 在 design-reference/packages/apps **零命中**,且 `2026-07-12-search-vehicle-work-plan.md:92` 早有先例裁定「品牌色 hex 是外部色、用網站 token 不照抄」)/ 訂貨、出貨 = **品項層**膠囊。
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
1. `shipments` + `shipment_items` 模型(U1;🔴 ~~Q16=A 同一位客人 + 同一份收件資料~~ → **Q1=B(2026-08-05)只守「同一位客人」**,DB 層 trigger 擋;收件逐字比對**不做**;**soft delete、永不硬刪**)
2. 出貨 owner RPC(`shipment_reference` 由 N3a 產生、重試在本層;✅ **Q19=A(Sean 2026-07-28):P1 後綴正式作廢、不加 `-1/-2`** —— reference 本身全表唯一已足)
   🔴 **本片的 DoD(2026-08-05 B2 DB 地基批交棒,**五條**;不是建議、是驗收條件)**:
   ① **`shipped` 的強制點在哪一層 = 尚未定案,本片開工前必須重新分析**。
      ~~B2 批刻意不做成摘要表 CHECK(理由:receipts 可刪、會讓無關的摘要列變非法)~~
      🔴 **該理由已於 K1 R3 被證偽**:receipts 重算 trigger 是 **row-level、只重算受影響的那個品項**
      (`20260803140000:258-287` 親驗)⇒ **不存在「無關的摘要列」**;被打紅的正是該品項本身,
      而「已出貨卻把到貨紀錄刪掉」本來就該紅。⇒ 兩個候選(摘要表 CHECK / 出貨側守門)**都還沒被正確比較過**。
      B2 批交付後這條在 DB 層零強制力 —— **這是已知缺口,不是已裁定的設計**。
   ② **可取消量守門要不要改成 `quantity − GREATEST(instock, shipped) − cancelled`** ——
      B2 批裁定「現在不做」(理由:本批 `shipped` 恆為 0、生產環境走不到該情境;
      為尚不可達的情境去動剛 apply 的取消 RPC 並付 a8a2 五十五格全回歸=時機錯)。
      **本片本來就要動取消線鄰接面、本來就要跑關卡2 ⇒ 在這裡做是順路。**
      🔴 **兩案(摘要表 CHECK / 出貨側守門)至今沒有被正確比較過**——三代分析全被證偽,見
      `docs/specs/2026-08-05-e10-b2-shipments-db-plan.md` §0.1 的證偽表;
      ~~信箱 `B-23-Q` 第五節的比較~~ 建立在已證偽的前提上、**不得引用**。
      本片開工前先取得主視窗另委的獨立分析結論(`B-31-A` ②)。
   ③ **三組併發 barrier 負測**(2×unvoid / shipment INSERT×unvoid / cancel×unvoid)+ **冪等重放 oracle** ——
      B2 批造不出來(作廢 writer 不在該批)、已標 inconclusive 不假裝補;**本片必須補齊**。
   ④ 🔴 **開工第一件事 = 實跑 `scripts/a1-verify.sh`,依實跑結果決定同批要改什麼**。
      背景:K1 R3 宣稱「摘要加欄後該 harness 保證全紅」,**B2 視窗親讀 harness 後複驗不成立**——
      它 `drop_a1()` 後**單獨重套 A1**(`scripts/a1-verify.sh:33`/`:113-119`/`:447-454`),
      結構斷言比對的是「A1 單獨重建出來的 5 欄表」⇒ 加欄不會讓它紅。
      **未確認**:provision 是否把新 migration 一起套進拋棄庫、行為探針會不會紅。
      ⇒ **動作保留、理由改成「實跑看結果」,不得寫成已知必紅。**
   ⑤ 🔴 **`shipment_reference` = `order_shipped` 去重鍵的候選**:outbox 的
      `dedup_key`「該批穩定識別」至今待定(`20260717020000:301`/`:349`),而 B2 批已交付全表唯一、
      永不重用的 `shipment_reference` ⇒ E4 落地時**不必另發明識別**。
2b. 🔴 **A8a1/A8a2/A8b contract 債**(§5.1b):~~`shipped_quantity` 加進不變式 + 改寫已出貨禁取消檢查~~
    → **2026-08-05 B2 關卡1 更正**:`shipped ⊆ instock`(Sean 拍板無直送)⇒ 既有 C7 已涵蓋「已出貨不可取消」。
    本批 definition of done = ①加 `order_item_quantity_summary.shipped_quantity` 欄
    ~~②新增 `oiqs_shipped_le_instock` CHECK ③C6/C7 與 `admin_cancel_order` 公式一字不動~~
    🔴 **2026-08-05 K1 R3 後狀態:本題重新開放、尚未定案** —— 「`shipped` 該在哪一層被強制」的兩次分析都被證偽(第一代「C7 已涵蓋」前提假=instock 非單調;第二代「移出摘要表」前提也假=receipts trigger 是 row-level、只重算受影響品項,不存在「無關的摘要列」,`20260803140000:258-287` 親驗)。⇒ **本行原有的施工字面全部作廢、不得依它施工**;B2 批已依停損只交付兩張表,摘要整合與契約債清償整批延後至下一線重新分析。
    詳 `docs/specs/2026-08-05-e10-b2-shipments-db-plan.md` §0.1/§2(2026-08-05 停損改版後的段號)
3. 出貨輸入 UI + 追蹤連結 + 單號點擊複製(列表出貨軸此時才「活」)
4. 手機出貨兩步守門(UX §5 #23)
5. 新竹 API 失敗/重送安全:請求識別值 + 原始回覆 + 三段狀態(UX §4 #17)
6. 出貨通知給客人(接既有 `email_outbox`,**不另起管道**)
   🔴 **本片 DoD(2026-08-05 B2 批交棒,F11)**:`order_shipped` 模板落地時**必須分流無單號情形**。
   依 B2 批的 A8 CHECK,`tracking_number IS NULL` 只可能發生在 `carrier_code='other'`(自取/自送,
   `carrier_note` 有說明)⇒ **不得寄出「已出貨但無追蹤號」的通用信**。
   現況(**B2 視窗 2026-08-05 親查**):`order_shipped` 在 DB CHECK allowlist(`20260717020000:315`)
   **但寄送端無模板、fail-closed `throw`**(`packages/use-cases/src/sweep-email-outbox.ts:113`)
   ⇒ 今日寄不出去;**風險窗從本片把模板補上那一刻開始**。
7. 內部通知(U4:LINE OA 推播 + 每日彙整 Email)—— **前置 = 通知矩陣拍板(§8.6 開批閘)+ 兩位員工加 OA 好友取得 userId**
8. 列印出貨單 / 揀貨單
9. **前台 #240 訂單詳情頁**(逐包裹單號 + 追蹤連結 + 品項進度)
10. 🔴 **storefront 兩張會員卡片接回包裹真相**(R6 抓:A9f 的「處理中」是降級顯示,第 2 批必須排回接片,否則客人永遠看不到真出貨狀態)——`OrdersTab` / `OverviewTab` 改讀包裹讀模型,移除「處理中」fallback;**本批 definition of done**

### 5.3 第 3 批(工作項 + 依賴;開批時才拆片)

1. `order_payments` 收款帳本(U3 多筆匯款 / 四格 / 催款 / 溢款處置)。🔴 **排本批最先**(R7:A8b 的 `partiallyPaid` 上限 =「實收額」,現行 schema 沒有實收金額真相,只有這張帳本能提供)。🔴 **R12 補 + R13 閉環「付款管道權威」**:**canonical `rail` enum 定死 = `card / bank_transfer / cash`**(R13 抓:nullable `payment_method` distinct 當值域會漏管道;實查 distinct 仍列 A0a、用來驗 canonical 集合有沒有漏,不反過來當定義);**無收款(none)不建腿**;各管道 writer 具名 —— `card` 腿:🔴 **R14 拆兩個 writer**:①**常態 writer** = `confirm_order_payment` 擴充片(本批 R 片):付款確認**同交易** insert card 腿,冪等鍵 `(order_id, rec_trade_id)` UNIQUE;②**backfill migration 僅處理歷史資料**(依 `payment_charge_attempts` 交易事實、跨付款狀態 —— R13:只回填 `paid` 會漏三張 `refunded`)、`bank_transfer` 腿 = 本批匯款登錄 RPC、`cash` 腿 = 同 RPC 的現金選項;**A8b 分流讀本表 rail**:純卡 → TapPay refund job;純匯款 → UX §1 #3 匯款退款線;純現金 → **現金退還登記合約(R15 補,不再只寫「同 #3 線」)**:獨立記錄(金額整數元、退還方式=現金交付、經手人、複核人、狀態 `pending/completed`、`cancellation_id` UNIQUE 防重複退還)+ 複核 UI 同 #3 線模式;🔴 **混合判定統一 = `COUNT(DISTINCT rail) > 1` 即 fail-closed**(R15:含所有 cash 組合;cash 單腿≠混合),§8.6 拍板前一律 `RAISE`;**A8b 測試矩陣逐組合列:純卡/純匯款/純現金/卡+匯款/卡+現金/匯款+現金/三者**
2. 匯款退款去向(受款帳戶 + 複核 + 參考號 + 防重複匯款,UX §1 #3)
3. `order_returns` / `order_return_items` + `order_refunds.return_id`(#31)
4. 🔴 **退款寫入線 RF2b-RF8** —— 見 §6.2 與 **Q3**。🔴 **含 A8b(已付款取消分支,R7 自第 1 批移入)與具名 refund-job worker 片(R + A);發布序照 §5.0 解鎖線(worker dormant → A8b → UI 解鎖 → enable worker,rollback = 反向逐步關)⇒ 第 19 項轉全綠**。🔴 **開工前置 = §8.6「退款線兩題」拍板**(混合收款分軌 / partiallyPaid 應退額語意,R8 判定為產品決策非規格深度)。
   **A8b 付款狀態 × 處置矩陣(可測合約;🔴 R11 補管道分流:先以 `order_payments` 帳本判付款管道 —— 卡款走 TapPay job、純匯款走 UX §1 #3 匯款退款線、混合 = §8.6 開批閘 fail-closed)**:`unpaid` = 不建 job(應收調整走本批 `order_payments`)/ `paid`(卡)= 建 job,金額 = server 權威 quote(公式沿用 `order_refunds` 不變式 `refund_amount = items_amount − shipping_delta`、單位整數元,`20260725130100:114-115`)/ `partiallyPaid` = 🟡 **本次應退額的推導語意 = §8.6 退款線兩題之一,拍板前 fail-closed**(R8:只有「上限 = `order_payments` 實收累計」不夠,兩個合法實作會退不同金額;帳本仍是前置 ⇒ 本片必晚於項 1)/ `refunded` = 不建 job / `partiallyRefunded` = 🔴 **逐品項**用 `order_refund_items` 算剩餘可退量後重跑 quote,**全單上限 = 實收 − `order_refunds` 已退累計**(R7 抓:上一版「quote − 全單已退累計」會把其他品項的既有退款重複扣、甚至負數)。呼叫端不得傳金額;quote 快照存 job。🟡 混合收款(卡+匯款)單的退款分軌 = §8.6 另一題,拍板前混合單 fail-closed。
   **worker**:R 片 = claim/submit/fail/reconcile-claim owner RPC + 🔴 **人工結案確認 RPC(R16:寫 `reviewed_at`/`reviewed_by`、service_role only、同交易 audit)**;🔴 **R17 補結案操作鏈落片(本批)**:dead-review 讀模型(A)+ server action(A)+ 結案畫面(U,列 dead 清單/金額/原因/備註、按確認呼 RPC)+ 結果與 audit 測試 —— 矩陣退款工作列的 UI 欄指向此畫面、不再只掛 A13b(狀態機、lease fencing(token CAS)、重試、死信**逐字照 A7b 合約**,不得另立);A 片 = 排程與 TapPay refund 組裝、**首次 claim 時初始化 reconcile baseline、送出前驗 baseline 可安全送**(A7b 合約)。🔴 **R9 更正流程:refund API status 0 只標 `submitted`(隔日生效);隔日 reconciler claim 後以 Record API 對帳,🔴 **三路逐字同 A7b:累計 < target 順延、= target 才同交易寫 `order_refunds`(`bank_refund_id` 等值沿用)+ 回填 `refund_id` + 標 `completed`、> target 進 `dead` 人工對帳**(R15 抓本句舊字面「達標即完成」會把 > 誤讀為完成)** —— 上一版「API 成功即寫帳本標 completed」是 R8 隔日生效問題的復發,已改
5. `order_internal`(U5 負責人 + 下次跟進日,service_role only)
6. 改單(U2 改全部 + 直改極簡 + 已裝箱部分鎖定 + 逐動作 event log)
7. 稽核線:**先補 `GRANT SELECT ON admin_audit_log TO service_role` 的 M 片**,再做讀取 RPC,最後才 UI(#35/#36)
8. 待辦檢視 / 今日對帳(依賴 1、5,以及第 2 批的出貨與異常)
9. 訂單匯出
10. **admin 專用建單 RPC + 手動建單表單** —— 🔴 **開批決策閘**:自由品項的價格算法、稅/折扣、客戶與地址、付款狀態、庫存影響、經銷價權限**六題未拍板,未拍不開工**(#33;列名 §8.6 待決清單)。🔴 建單 server action 必含 `pcm_display_id_exhausted` 的 catch + LINE 告警(同 N3b-app 合約)——**本片 definition of done**

### 5.4 訂單編號改 6 碼亂碼(獨立線)

> 🔴 **順序見 §5.0(唯一權威),本節零順序敘述**(R6 抓:上一版留了「摘要」還是在複述順序 —— 連摘要都不准)。

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
| **N3a** | **T** | 🔴 **共用產號 helper**(R8 更正片型:SQL helper 依 §1 定義屬 T 非 R):`public.pcm_generate_display_id() RETURNS text`。**先於任何消費端存在**(R1 #32 / R2 / R3 / R5 四次點名);🔴 **R5 前移到第 2 批最前** —— `shipment_reference` 也要用它。合約:SECURITY DEFINER、`SET search_path = ''`、pgcrypto 函式一律 schema-qualify(`extensions.gen_random_bytes`)、建後 `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`(只留 owner 與需要的 definer 函式)、依賴檢查 assert pgcrypto 已裝 |
| **N3b** | R | `create_order` 改呼叫 helper。🔴 **重試迴圈寫在這一層、不在 helper 裡**(R3 抓:helper 只回候選值,不可能捕捉 INSERT 的 unique violation)—— 迴圈上限 5、只捕捉 `unique_violation` 且 `constraint_name = 'orders_display_id_key'`、用盡 `RAISE`(SQLSTATE `P0001` + token)。654 行金流函式,必過 codex 關卡2 + Sean 1 元真刷 smoke。🔴 **R 片只到 RAISE 為止 —— app 層 catch 與告警在 N3b-app**(R6:R 片不得偷渡 application 行為) |
| **N3b-app** | **A** | 🔴 **R6 新增(告警的 application 落點原本沒有片)**:`placeOrder` use-case catch `pcm_display_id_exhausted` token → 走既有 `packages/adapters/src/payment/LineAlertNotifierAdapter` 送 LINE 告警 + server log,對客回一般結帳失敗(不洩內部細節)。**附負向測試**(模擬 RPC RAISE、assert 告警送出與正常錯誤回傳)。🔴 **部署序:N3b-app 先於 N3b**(R7 抓:N3b 先上則窗口內用盡事件無告警;catch 先上 = 永不觸發的安全 no-op)。admin 建單 action 的同款 catch = 第 3 批建單片 DoD(§5.3 項 10) |
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

- ACL = **service_role SELECT only**(`20260725130100:324-325`)
- 寫入依設計走 **RF2b 的 owner RPC —— 該 RPC 尚未施工**;RF2b→RF8 整段在 `PROGRESS.md:780-787` 明列待做

⇒ v1 說 O14 是「接既有帳本做 UI」**不成立**;做完 UI 仍然按不下退款(#29/#30)。
Sean 已拍 N5「訂單域做到目標狀態才算數、不接受做一半」⇒ **E10 要嘛吃下 RF2b-RF8,要嘛第 17 項不綠**。這是 **Q3**。

### 6.3 其他誠實邊界

- **不給總片數與總工期**。**第 1 批 = 69 片**(R18 折入後;**唯一有效來源是 §5.1 那張表、且一律 `awk` 當場數**)。第 2/3 批開批時才拆片,**現在給的數字必然是假的** —— v1 同檔寫過 24 / 22、高風險 13 / 12(實際 15),就是這麼來的(#61/#62)
- 🔴 **第 1 批 14 → … → 66 → 67 → 69 片是十八輪審查的結果、不是範圍擴張** —— 同樣的工作拆到每片真的能在 45 分鐘內做完並獨立驗收(69 = 67 + A9w4 拆三)。**「片太大」是最頑固的一類 finding**,是本線最頑固的一類 finding
- 🔴 **片型分佈我親手寫錯過兩次**(R3 寫 R5/A7/U10、R4 寫 M5/A7)⇒ 該行**只准 `awk` 數完貼上**,禁止手算
- ~~27 項現況沿用 2026-07-26 read-back,**至今未重驗**(A0 補)~~ ✅ **2026-07-29 A0c 已重驗**:25 項一致、2 項漂移(#19 ⚠️→❌ 取消動作不存在、#26 證據行過期),**分母更正 = ✅2 / ⚠️5 / ❌20**(Sean 同日拍板 Q2=A,主規格 §1 表已改)。§6.1 的 17 項組成不變、綠燈宣稱不變,只有「相對於什麼變綠」的基準改了。證據 `docs/reviews/2026-07-29-e10-a0c-27item-reconcile.md`
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

**分頁維持以「訂單」為單位**(`ORDERS_PAGE_SIZE = 20`,`order-list-view.ts:27`)。改成品項分頁會拆散 rowSpan 群組(#50)。300 張單的列數壓力由篩選與待辦視圖吸收,不靠改分頁單位。

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

> 🔴 **題號消歧(復盤L1)**:本表 Q 題號**僅限 2026-07-28 E10 線**;07-27 handoff §3 另有一套同號不同題的 Q1-Q9(先 E10/E12 不做/E8-B 等)。**跨檔引用一律帶日期**(例「07-28 Q2」),STATUS 兩處已同步。另:**Q13=B(視覺全貌先行)/ Q14=A(方向核准)**已由 artifact 交付+批准落實;**Q15=D(繼續折入下一輪,選項 A 停損重寫/B 改走人審/C 降級快篩/D 續折)**;Q6=C(自檢後再送審)。

| 題 | 拍板 | 連動 |
|---|---|---|
| **Q1 整單彙總狀態** | ✅ **B 不維護** —— `orders.fulfillment_status` **凍結不動、不再由計數器驅動**;篩選改走品項層條件(例「有品項還沒訂貨」) | 見 §8.1 |
| **Q2 舊訂單處理** | ✅ **A 砍 26 張無金流的 + 3 張有金流的改號** —— 雙格式支援整片取消,見 §8.3 / §8.4 |
| **Q5 `PCM-2026-0104` 的 NT$1,180** | ✅ **Sean 2026-07-28 口頭確認「TapPay 都已經退款」+ 授權「怎麼處理都好」** ⇒ 🔴 **R22 兩態化**:0104 由 read-back 證實後改 `refunded`;**0052 只在 read-back 命中 `record_status=3` 才改,正式商戶查無 ⇒ 保持原值 + audit(不得對 sandbox 下結論)**。來源=Sean 口述 ⇒ 已升硬閘:**D1b1 與 D1c 步驟 8b 兩次 read-back 皆強制** |
| **Q3 退款完成定義** | ✅ **A E10 吃下 RF2b-RF8** —— 第 17 項才算真的綠 | 見 §8.2 |
| **Q9 計數器落地方式** | ✅ **B 存欄、依軸分批加**(復盤L1 補列 —— 原僅存 memory,repo 零紀錄;A 案=從明細即時聚合,因 300 單×品項列表每次聚合會慢而未採)| 欄位不得早於真相模型;§1 原則 2 表、§5.1 A1 片 |
| **Q17 已到貨後取消** | ✅ **B 不可取消,走退貨**(2026-07-28) | §5.1c 第四條不變式上 CHECK;A8a2 守門;A13a 指路退貨 |
| **Q18 取消原因 allowlist** | ✅ **照草案**(2026-07-28) | 定案表 = §5.1d;A7/A8 開工阻擋解除 |
| **Q19 P1 分批後綴** | ✅ **A 作廢**(2026-07-28;P1 是 Sean 拍板、由 Sean 本人作廢) | `shipment_reference` 不加 `-1/-2`;§8.5 |

### 8.0 🔴 Sean 2026-07-29 晨拍五題(過夜施工回報後)

> 來源 = `docs/handoff/2026-07-29-e10-overnight-report.md` §2.3 的五個決策題。**題號沿用 A0a-1 / A0c-1 / A0b-1 / A3-1 / A2-1**,不與 07-28 的 Q 序混用。

| 題 | 拍板 | 連動 |
|---|---|---|
| **A0a-1** `PCM-2026-0101` 無 `rec_trade_id` | ✅ **Sean 逐字「都沒扣到錢,放心刪除」** ⇒ **cohort 維持 26 張、0101 不移出**;它的「無金流」證據等級 = **Sean 本人確認**,非系統 read-back | 🔴 D1 線解封;**但 0101 的 D1b1 判定矩陣不適用**(沒有查詢鍵)⇒ 見 §8.7 |
| **A0c-1** 27 項驗收表兩列與事實不符 | ✅ **A 改主表 + 小計 2/5/20** | `docs/specs/2026-07-25-admin-backend-rebuild-spec.md` §1 第 19/26 列與小計已改;同檔 §0 與 §5.6 兩處過期的 `staff.ts:3` hardcode 字面一併修正;§6.3 誠實邊界該條已結案 |
| **A0b-1** 新版列表欄位 | ✅ **B 13 欄:留「年份廠牌車種」、拿掉「來源 · 管道」**(看過三案並排視覺 artifact `68a00571-7efc-49e1-9758-472a650b156e` 後拍板) | §5.1a 欄位清單與動作表已改;§5.1 表 A11a 列已改;§5.0「Sean 做完會看到」已改。**「12 欄」全檔作廢** |
| **A3-1** `order_notes` 誤選「已告知客人」改不掉 | ✅ **A 現在就加更正機制** | A3 migration 加 `corrects_note_id` + 複合 FK(只能更正同單)+ partial unique(一筆最多被更正一次)+ `corrects_not_self` CHECK;**append-only 不破壞**;U6 稽核查詢形狀寫死在 migration 註解 ⇒ **列為 A9a 驗收條件**(附「被更正的不得算已履行」負測) |
| **A2-1** 採購只記到貨累計數 | ✅ **A 現在就加**(表未 apply、改檔最便宜) | A2 migration 加 `order_item_procurement_receipts` 逐批到貨明細(append-only、service_role only)。🔴 **新合約債**:`received_quantity` = 明細 SUM 這條等式**本片無 DB 層強制**(M 型零 trigger)⇒ **列為 A4a 驗收條件**,在 A4a 之前由 A4b writer 同交易自持 |

**另一題非阻擋、Sean 未答**(D0-1):全 repo migration 自寫 `BEGIN/COMMIT` 與 Supabase CLI 記帳的窄縫 —— 維持現狀,未開 backlog。

### 8.1 Q1=B 的連動(四條 findings 因此消失)

- ❌ **不加 `backorder` enum 值** ⇒ v1 的 O5 整片取消。連帶 #17(enum 不可 contract)、#20(order 層 vs item 層)、#19(`delivered` 無 writer)**不再適用**
- ❌ **不做「計數器 → 訂單層 enum」的同步 trigger** ⇒ #16 只剩「誰原子更新計數器」一半(A4 owner RPC 回答)
- ✅ **N-2 衝突自動消解**:既然不驅動 `fulfillment_status`,`FULFILLMENT_TRANSITIONS` 的禁倒退規則就碰不到;品項層「來回改」= 計數器加減,本來就沒有方向限制
- ⚠️ **代價(明寫)**:訂單列表**失去**「整單出貨到哪」的單欄快篩。替代 = 品項層條件篩(`order_items` 已有 `workflow_status` 索引與 `!inner` 投影先例)。主規格 §3.1 曾寫「PCM 必須維持實體 enum 欄 + 索引,由 trigger 從計數器同步」(引 Medusa issue #14095)—— **該句被本次拍板推翻**,理由:那是研究結論非 Sean 拍板,且 PCM 的篩選需求在品項層就滿足
- 🔴 `orders.fulfillment_status` 欄**保留不 DROP**,但 COMMENT 必須標 **「E10 起停止維護、值為 legacy stale、不得當現況真相」** —— **不可寫成「衍生顯示」**(codex R2 抓:既然沒有 writer 在維護它,叫「衍生顯示」會讓後人以為它跟得上真相)
- 🔴 **現行用 `fulfillment_status` 的列表篩選必須移除**,改成品項層條件 —— 留著舊篩選 = 給員工一個會騙人的篩選器。**責任分工(R6 修正:原寫「A9c 同片移除」與 A9e/A9r 重疊)**:篩選 UI 與參數解析下架 = A9e;admin 契約收縮 = A9r;A9c 純加法

### 8.2 Q3=A 的連動(E10 範圍變大,明寫)

E10 **吃下退款寫入線**:`order_refunds` 的寫入 owner RPC(RF2b)+ ACL + 覆核(RF8)進第 3 批。
⇒ 第 3 批的體積明顯大於 v1 估計。**這是 Sean 知情後的選擇**(N5「訂單域做到目標狀態才算數」的一致結果),不是範圍蔓延。
⚠️ RF2b-RF8 的既有規格散在 M-3 退款線文件,第 3 批開批時要先把它們對齊本檔的一片一層原則,**不是直接照抄舊拆片**。

### 8.3 🔴 Q2:「訂單都是假的」實查後不成立於全部 29 張

> 🔴 **筆數更新(2026-07-30 正式站唯讀實查)**:`orders` 現為 **31 列** = 舊格式 `PCM-` **30 張** + 新格式 **1 張**(`PTNGY2`,真刷)。
> 本節下表的 29 / 26 是**當時的歷史快照**、刻意不改;凡指「現在還有幾張單」一律以 **31**(舊格式 30)為準。

2026-07-28 production 實查(`bmpnplmnldofgaohnaok`):

| 單號 | 金額 | 付款狀態 | 實況 |
|---|---|---|---|
| 其餘 **26** 張 | — | `unpaid`、無 `paid_at` | ⚠️ **不是「零風險」** —— 其中 3 張有 `pending` 刷卡紀錄(見下)。正確說法 = **經 Sean 外部查證 TapPay 後核准刪除**,證據等級記在下方 |
| `PCM-2026-0052` | NT$6,800 | **`paid`**(2026-06-23) | 有 TapPay 交易紀錄。早於正式站首筆真刷(07-24 的 0102)⇒ 🔴 **交易環境未證實**(R23:不對 sandbox 下結論)⇒ 由「金流證據前置」read-back 兩態定案:命中 `record_status=3` → `refunded`;**正式商戶查無 → 維持原值 + audit** |
| `PCM-2026-0102` | NT$101 | `refunded`(2026-07-24) | 史上第一筆正式站真刷,已退款 |
| `PCM-2026-0104` | NT$1,180 | **`paid`**(2026-07-25) | RF2a-0 驗證真刷。**Sean 2026-07-28 確認 TapPay 端已退款**(DB 尚未反映 ⇒ D1 第 9 步對齊) |

**三張 `order_refunds` 帳本列數皆為 0** —— 因為 RF2b 寫入 RPC 從未施工,0102 的退款是在系統外做的、只把狀態翻成 `refunded`。

**刪除的實際阻擋(FK 實查)**:`order_items`(39 列)與 `order_legal_consents`(4 列)是 CASCADE 可自動走;但
`payment_charge_attempts`(27 列,NO ACTION)、`pending_invoices`(3 列,NO ACTION)、`email_outbox`(0 列,RESTRICT)
的 FK 規則**不會自動 CASCADE**,所以**指向待刪訂單的子列**必須先處理。
🔴 **但實查後只有 `payment_charge_attempts` 真的需要刪(24 筆)** —— `pending_invoices` 那 3 筆**全部屬於要保留的訂單 ⇒ 零刪除;唯一動作 = D1c 將三筆 `status` 更新為 `voided`**(全檔統一此字面,R6 抓兩種說法並存),`email_outbox` 是 0 列。
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
| **Q10 併箱的新竹編號** | ✅ **A 包裹自己有一組獨立編號**(`shipments.shipment_reference`),送新竹用它、**與訂單編號脫鉤** | 解掉 **P1 與 U1 互相矛盾**(兩者都是 Sean 拍板):P1 的後綴以「訂單編號-序」為基底,但 U1 允許一箱裝多張訂單 ⇒ 該箱沒有唯一基底訂單號。新竹只要求「同日不重複」、未要求必須是訂單號(`hct-logistics-api-reference.md:121`)⇒ 獨立編號完全滿足。~~P1 的「自動加後綴」語意改為掛在 `shipment_reference` 上~~ → **Q19=A(2026-07-28)整個作廢後綴,見 §8 表** |
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
| `apps/admin/…/order-filter-bar.tsx:36,30` | 員工 | 移除篩選(含 `fulfillmentOptions` prop) |
| 🔴 `apps/admin/…/order-filter-controls.tsx`(**整檔**::9 import、:41 寫回 URL、:56/:63/:105 渲染) | 員工 | **復盤L2 抓漏(同族第 11 次)**:整支篩選控制元件在消費同鏈,原清單漏列 —— A9e 一併移除 |
| `apps/admin/…/order-list-view.ts:31,149,184` | 員工 | 移除參數與解析 |

⚠️ **這是我這輪的復發**:codex 只點名了明細頁,我原本也只排了列表篩選。
**同類必須全掃** —— memory `feedback_claimed-sync-but-only-patched-touched-lines` 記著「已復發 9 次以上」,這是第 10 次。

#### 🔴 併箱的客人邊界 —— R4 再修正:光靠投影擋不住

R3 的解法是「表 service_role only + own-order 安全投影」。**R4 指出那還是漏的,成立**:
同一箱只有**一個快遞單號**與**一份收件快照**,不管投影怎麼切,
把追蹤號給了 A 客人就等於把「B 客人那箱」的追蹤號也給了他 —— 他查得到整箱的物流狀態。
~~而且一箱只能有一份收件人資料,多客人併箱在物理上就矛盾。~~
🔴 **2026-08-05 B2 K1 R2 反例:後面那句是假論證** —— A、B 兩位客人若都寄到**同一個第三方地址**
(例如同一間公司行號),一箱 + 一份 snapshot 在物理上完全一致、毫無矛盾。
⇒ **「跨客人不做」這條限制仍然保留,但理由是隱私/政策**(不讓 A 由物流查詢面看到 B 那箱),
**不是物理矛盾**。上一句的追蹤號外洩論證才是真正的理由,它單獨就足以支撐這條限制。

⇒ ~~**併箱限制為「同一位客人 + 同一份收件資料」**~~
🔴 **2026-08-05 Sean 拍板 Q1=B,知情推翻本段後半**(選項已標注與 Q16=A 衝突、Sean 仍選 B、未回撤):
**併箱只限制「同一位客人」**,不符即禁止建立該包裹(DB 層 trigger 擋,不只 UI)。
收件資料改以包裹自己的 `recipient_snapshot` 為準,**允許與訂單的 `shipping_address_snapshot` 不同**
(員工出貨當下可改寄送地址)。**已接受的代價**:訂單頁顯示的收件地址不等於實際寄達地址。
上方 R4 那段「一箱只能有一份收件人資料,多客人併箱在物理上就矛盾」的論證**仍然成立且仍是跨客人不做的理由**;
被推翻的只是「同客人之間也要逐字相同」這一條。
✅ **Sean 2026-07-28 拍 Q16=A 確認要限制**(在得知這縮小了 U1 原始語意、以及「若實務上會把不同客人的貨併箱寄同一地點就會被擋」之後仍選 A)。
⇒ **U1「多單併一箱」的最終語意 = 同一位客人的多張訂單併一箱**,跨客人併箱**不做**。
這是對 07-26 U1 的**範圍縮小、非推翻**:併箱能力仍在,只是限定同客人。

#### 🔴 `shipment_reference` 產號合約(Q10=A 引入,R4 抓「只說獨立編號、不可施工」)

| 項 | 值 |
|---|---|
| 用途 | 送新竹的 `epino`(訂單編號欄),**與 PCM 訂單編號完全脫鉤** |
| 唯一範圍 | **全表 unique**(不是「同日 unique」——新竹只要求同日不重複,全表 unique 是更強的保證且更好查) |
| 格式 | 沿用 §5.4a 同一組字母表與長度(**6 碼**),**共用 `pcm_generate_display_id()` helper**,不另發明第二套 |
| 分批後綴 | ✅ **不加後綴(Q19=A,Sean 2026-07-28 親自作廢 P1)**:`shipment_reference` 本身全表唯一,後綴要解決的「同日撞號」問題已不存在。全檔不再有任何 `-1/-2` 語意 |
| 刪除後 | **永不重用**。🔴 **實作 = 包裹永不硬刪**(R5 抓:live-row UNIQUE 在 DELETE 後會釋放值,「永不重用」光靠 unique 約束**不成立**)⇒ `shipments` 走 soft delete(`deleted_at`),列與 reference 永久保留 = tombstone;重送同一包裹沿用原值 |
| 長度守門 | ✅ **長度已驗**:`epino` = **Char(30)**(`hct-logistics-api-reference.md:81`,R5 抓:我寫「未驗」但答案就在自己檔案裡)⇒ 6 碼遠低於上限。🟡 **允許字元仍未知**(文件未載)= C1 合約唯一未確認項,Sean 申請 API 時問新竹;另有帳號等既知外部前置(HCT ref §1) |

🔴 **P1 的字面必須全樹統一**(R4 抓「同檔存在兩個基底語意」):
`§3 C1`、`§5.2`、`docs/reference/hct-logistics-api-reference.md` 三處的「訂單編號-1/-2」**一律改為 `shipment_reference`**。
HCT 參考檔已於本輪同步;C1 與 §5.2 見下。

#### 🔴 D1 是 runbook 不是 migration(R3 抓)

D1 寫死 production UUID 與「29 → 3」斷言 ⇒ **在本機 / preview / 全新 DB 重播必然失敗**。
⇒ **拆兩件**:①可重播的 schema migration(CHECK 放寬)②**一次性 production data runbook**(含環境身分守門:
執行前 assert 連到的是 production 專案、否則 abort)。**不要把一次性資料操作放進 migration 序列。**

#### 🔴 其他 R3 修正

- **A14 的「建手動單」是死按鈕** —— 建單第 3 批才有 ⇒ 第 1 批**完全不放該動作**(R18 刪掉「或放 disabled」替代案 —— 與 A14c「不放死按鈕」矛盾),第 3 批再出現
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

**D1 線(runbook 型、🔴 高風險:③DB 不可逆 + ①錢面資料;R11 拆十四片 —— D1a0 守門 = 步驟 1、D1a1 匯出腳本 + D1a2 正式匯出 = 步驟 2-3、D1a3 映射、D1a4/D1a5 restore scripts + D1a6/D1a7 演練 = 步驟 4、D1t1 交易核心 / D1t2 CLI·dry-run / D1t3 timeout 驗證(執行器本身)、D1b1 read-back = 步驟 5、D1b2 dry-run+證據 = 步驟 6,批准閘 = 步驟 7、D1c apply = 步驟 8-13)—— 順序見 §5.0**:

🔴 **D1c 執行器定義(R7 抓:交易鎖 + TapPay read-back 跨 DB/API 兩界,「跑 SQL 檔」做不到)**:
單一 **TS orchestrator script**,一個 `pg` client 連線從 `BEGIN` 到 `COMMIT` 全程同一 session 持鎖;
步驟 8b 的 read-back 經**同一支獨立 runbook client**在同一 process 內呼叫(R21 統一;唯讀 API,交易內無副作用);
**任何 API 失敗或斷言不符 = `ROLLBACK` 後 exit 非零**。dry-run(步驟 6)= 同一支 script 帶 `--dry-run` 旗標,模擬步驟 8-13 後強制 `ROLLBACK`。
🔴 **timeout 合約(R8:`statement_timeout` 管不到 HTTP,持列鎖打外部 API 必須自帶上限)**:
每次 `recordQuery` 綁 30 秒 `AbortSignal`(TapPay 官方建議值)、六筆總體上限 3 分鐘、
pg 連線設 `idle_in_transaction_session_timeout`;**任一逾時 = `ROLLBACK` 後退出**,不留半掛交易。

**🔴 相依資料實查(2026-07-28,`paid_at IS NOT NULL` = 留存的 3 張)—— 上一版寫錯,已更正**:

| 相依表 | 屬於留存 3 張 | 屬於待刪 26 張 | D1 要做什麼 |
|---|---|---|---|
| `payment_charge_attempts` | **3** | **24** | 刪那 24 筆(NO ACTION、不先清會擋住 DELETE) |
| `pending_invoices` | **3** | **0** | 🔴 **零刪除;唯一動作 = 步驟 13 將三筆 `status` 更新為 `voided`**(R6 抓字面統一)。3 筆全屬留存單 —— 上一版寫「刪 26 張的 pending_invoices」是錯的:不但是 no-op,照字面做還會刪到要保留的發票紀錄 |
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
🔴 **證據等級寫明**:來源 = **Sean 本人查 TapPay 後的確認**,非系統 read-back;~~migration 註解~~ **orchestrator audit JSON** 與匯出檔都要記這句(承接處依 T-Q3=A 改寫,見 §8.7 施工必做 2)。
🔴 匯出存檔仍必須完整包含這三筆(刪除後唯一的紀錄就是那份檔)。

#### D1 執行規格

**閘序(R5 抓:上一版把批准閘放在 restore 演練之前 ⇒ Sean 批准時演練還沒做)**:
**步驟 1-6 全部做完**(含 restore 演練、TapPay read-back、完整 dry-run)→ 🔴 **停下、把全部證據交給 Sean、
取得「apply D1」明確批准** → 才跑步驟 8 起的正式交易。批准前不得執行任何正式 DELETE。此閘**不可與 A1 的確認點合併**。
🔴 **證據有效期 = 24 小時**(R6 抓金流 TOCTOU:批准延遲期間 TapPay 端狀態仍可變):D1b2 證據產出後逾 24 小時才拿到批准
⇒ **重跑 D1b1/D1b2** 再 apply;且無論間隔多短,D1c 鎖列後、DELETE 前**必重跑六筆 read-back**(步驟 8b)。

**🔴 三組改號映射(依 §5.4a 合約產生、已驗 regex 與唯一性;R4 抓「宣稱寫死但全文沒有」)**

| 舊號 | 新號 | 備註 |
|---|---|---|
| `PCM-2026-0052` | **`YWP3PC`** | 舊號寫入 `legacy_display_id`(D0 已建欄) |
| `PCM-2026-0102` | **`BKPR5M`** | 同上 |
| `PCM-2026-0104` | **`ZNHY8B`** | 同上 |

執行前 assert:三值皆符 `^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$`、彼此不重複、與全表 `display_id` 及 `legacy_display_id` 皆不衝突。

| 步 | 動作 | 守則 |
|---|---|---|
| 1 | **環境守門(R6:必須可執行;R8 修 pooler 誤殺)**:①wrapper 檢查連線字串**兩種合法形態擇一命中**:direct host 含 `bmpnplmnldofgaohnaok`,**或** pooler 形態(host = `*.pooler.supabase.com`)時 **username 含 `.bmpnplmnldofgaohnaok` 後綴**(R8 抓:pooler 的 project ref 在 username 不在 host,只驗 host 會拒絕正確環境);**只比對 host/username、不印完整 URL**,不符 exit 1;②SQL 第一步 `DO` 區塊 assert cohort 的 29 個 UUID 在 `orders` 全數存在,否則 `RAISE` abort(本機 / preview 沒有這些 UUID ⇒ **資料本身就是環境閘**)③🔴 **復盤L3 補身分守門**:assert `current_user` = 預期 runbook 身分(`postgres`)—— 只驗專案不驗身分時,`payment_confirmer` 等窄權連線字串也能通過守門(repo 已有 current_user 斷言先例,照抄) | 🔴 **runbook 的第一行、不是註解**(D0 等 migration **不含**此 assert —— 它們可重播) |
| 2 | **固定 cohort**:以 `orders.id`(UUID)寫死 **26 筆待刪 / 3 筆留存** 的 allowlist **在 runbook 內** | 🔴 不用動態條件;**不進 migration**。🔴 **所有數量斷言一律 cohort 口徑**(R5 抓:全表 29→3 在「D1 前有新單進來」時必然失敗、還會誘使人擴大刪除範圍) |
| 3 | **cohort 匯出**:29 張及依 FK 反查的完整相依集合 **+ 🔴 Sean 07-29 拍板 Q1=A 補五張父表**(`customers` / `customer_addresses` / `products` / `product_variants` / `legal_terms_versions`)—— cohort **指向**它們,`orders→customers` 是 ON DELETE RESTRICT,**D1c 刪掉訂單那刻這層保護消失**,之後任一父列被刪(地址刪除是既有功能、商品會下架)還原就整批失敗。🔴 `auth.users` **不收**(拍板 Q3=A,含密碼雜湊);殘餘風險 = 客人自刪帳號則該筆救不回,已明列拍板接受(`order_items` / `order_legal_consents` / `payment_charge_attempts` / `pending_invoices` / `email_outbox` / `order_refunds` / `order_refund_items` / `payment_double_charge_anomalies` / `payment_double_charge_anomaly_events`) | 🔴 **匯出工具 = psql 客戶端逐表 `\copy` + 逐表寫死 selector**(🔴 R13 抓:通用 `WHERE order_id = ANY(cohort)` 對 `payment_double_charge_anomaly_events` **必然失敗 —— 該表只有 `anomaly_id`、無 order 欄**;它的 selector = JOIN `payment_double_charge_anomalies` 以 **`old_order_id`**(`20260624120003:48` 親驗)篩 cohort;`order_refund_items` 同理經 `order_refunds`;**restore 與零殘留驗收使用相同關聯**)(R6 抓:server-side `COPY … TO` 寫的是 **DB 伺服器**的檔案系統,Supabase 上拿不到;`\copy` 寫本機才成立。R5 已排除 `pg_dump --data-only` —— 不能按列篩)+ cohort manifest + 逐表 `sha256`。**0 列的表也要匯**(留空檔證明當時為 0)。🔴 **復盤L3 補新鮮度與格式**:匯出時間戳入 manifest,**apply 時距匯出 > 24h = 重跑 D1a2**;`\copy` 格式定死 **`WITH (FORMAT csv, HEADER, NULL '\N')`**(CSV 預設把 NULL 與空字串混同,還原會違反部分唯一索引語意;restore 同格式;附 NULL/空字串 roundtrip 負測)。`age` 加密、金鑰存 1Password、保存 180 天後銷毀、路徑與 checksum 回報 Sean |
| 4 | **兩支版本化 restore script + 實跑還原演練**(隔離 DB) | 🔴 依 FK 逆序;`restore-pre-n3c.sql`(舊 CHECK 環境,26 張以原舊號還原)與 `restore-post-n3c.sql`(新格式-only CHECK 環境)**各演練一次**。🔴 **復盤L3 補 + R21 補齊:兩支 restore 各自帶守門** —— host/username ref 同 D1a0 + **`current_user = 'postgres'` 身分 assert(D1a0 的身分守門不能保護日後獨立執行的 restore)** + **cohort UUID「不存在」反向 assert**(還原前提 = 已刪;D1a0 的「存在」assert 在 D1c 之後恆假,不能沿用);D1a4/D1a5 片列同步。🔴 **R6 抓:post-n3c 版還原 26 張舊號單會被新 CHECK 擋** ⇒ **D1a3** 依 §5.4a 合約**預產 26 組還原用新號映射**(驗 regex、彼此與現網不重複)、**D1a5** 版本化進 script:還原時 `display_id ← 新號`、`legacy_display_id ← 原舊號`,與留存 3 張同一模式;🔴 **復盤L3 補:restore-post 執行時當場重驗 26 組與現網 `display_id`/`legacy_display_id` 零碰撞**(N3b 換產號器後現網會隨機長出 6 碼新單,第 1 批凍結的映射可能過期;碰撞者 script 內依 §5.4a 重產、重產仍撞即 abort 人工);**D1a7** 演練必實跑此路徑 |
| 5 | **TapPay read-back**(金流證據,詳下節) | 對不上即 abort |
| 6 | **完整 dry-run**:D1c orchestrator 帶 `--dry-run` → `BEGIN` → **模擬步驟 8-13(不含批准步驟 7,R7 抓誤寫)** → 驗整張矩陣 → `ROLLBACK` | 🔴 R5 抓:上一版模擬只跑到鎖列就宣稱能驗 29→3 |
| 7 | 🔴 **Sean 批准閘**:1-6 的全部證據(匯出 checksum、演練紀錄、read-back 結果、dry-run 矩陣)交給 Sean,取得明確「apply D1」 | 批准前零正式寫入 |
| 8 | **正式交易 + fail-fast**:🔴 **前置(復盤L3 + R21 補全路徑恢復)**:暫停 pg_cron 的 settle sweeper —— **單一方式定死 = `cron.alter_job(job_id, active := false)`**(不 unschedule、原排程設定原地保留)、**先等待進行中的執行排空**(查 `cron.job_run_details` 無 running)再開始;**恢復(R22 落地化 + R23 補 ownership)**:🔴 **流程分流定死(R27:state 判斷先於一切 active 斷言)**:取 advisory lock → **先判 state** —— ①state 存在 ⇒ recovery mode(`active=false` 才恢復;`active=true` 只 read-back/清 state)→ 退出 ②**state 不存在的正式執行分支才** assert `active=true`(否則 abort 人工釐清 —— 不誤開別人的停用)並產生正式 run id;🔴 **single-flight(R25)**:orchestrator 啟動第一步取**具名 PG advisory lock**,涵蓋「啟動恢復 → 寫 state → 停 job → 執行 → 恢復 → 清 state」全段;取不到 = 另一實例在跑,立即 exit(禁雙執行);**恢復與清除的 run id 規則(R26 定死 takeover,否則 crash 後合法接管者被擋死)**:持鎖後 ①**發現既存 state ⇒ 進入 recovery mode**:CAS 把 state 的 owner run id 改為本次(接管紀錄保留原 id)→ 只做恢復/read-back/清 state → 退出,**不開始正式執行** ②**state 不存在 ⇒ 才產生新 run id 開始正式執行**;正常路徑的恢復/清除仍 compare run id = 本次(防仍存活的雙執行互清 —— advisory lock 已擋,此為第二道)。🔴 **crash-safe 順序定死(R24)**:①**先**原子寫入並持久化 ownership state 檔(job_id + 時間戳 + run id;write→fsync→rename)②**才** `alter_job(active := false)` —— 順序反過來會留下「已停用、無 state」的不可恢復窗;**恢復序**:①`active := true` ②read-back 驗證 ③**才**原子清除 state(殘留舊 state 會誤開日後別人刻意停用的 job);①`finally` 涵蓋成功與 throw ②**SIGINT/SIGTERM signal handler** 呼叫恢復 ③**啟動 self-heal 僅在 state 檔存在時恢復**(無 state 檔 = 非本次停用,不動、abort 人工)④**hard-crash 攔不到 ⇒ runbook 檢查表明列「orchestrator 異常死亡後操作者必跑 `--recover-sweeper`(讀 state 檔)並驗證」**;D1t3 負測加 **kill -9 後啟動 self-heal 實測**(cron 設定不受 DB ROLLBACK 保護);🔴 **dry-run(步驟 6)不動 cron** —— 全程 ROLLBACK 零寫入,sweeper 不需停、模擬時此步僅 log→ `BEGIN` → **`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`**(復盤L3:READ COMMITTED 下「非 cohort 逐 byte 不變」在併發結帳時必誤判)→ `SET LOCAL lock_timeout='5s'` / `statement_timeout='60s'` → 🔴 **鎖策略定死(R21 定向 + R22 修斷言矛盾:cohort attempts 實況 = failed 12 / released 9 / **pending 3**,「全終態」斷言必然 fail —— 改為可機械證明的 NOWAIT fence)**:①鎖序固定 `orders` → `order_items` → **`payment_charge_attempts` 用 `FOR UPDATE NOWAIT`**(任何反向持鎖者 —— 如 `mark_charge_attempt_charged` 先鎖 attempt —— 會讓 NOWAIT 立即 error ⇒ **ROLLBACK + exit 非零;🔴 R23 定死重試政策 = 不自動重試,操作者確認無並發後手動重跑 orchestrator**,與 D1t1「exit 非零」合約一致)→ `pending_invoices` ②鎖畢 assert:**failed/released 計數未變(12/9)、pending 三筆仍為 `pending` 且欄位未變**(不是「全終態」)③sweeper 已停(前置)④**雙交易負測證明反向持鎖時 NOWAIT 確實立即 abort、不等待** → 交易內重驗 cohort 計數與金流狀態,漂移即 `RAISE` | 🔴 **鎖住 orders 列即同時擋住所有新 FK 子列**(FK 驗證需 KEY SHARE、與 FOR UPDATE 互斥)⇒ `email_outbox` 等 0 列表**不需列級鎖**,交易內重驗 = 0 即可(R5 抓「鎖清單與匯出清單不一致」的正確解法,附機制依據) |
| 8b | 🔴 **鎖後重跑六筆 TapPay read-back**(R6 抓金流 TOCTOU:D1b 的 read-back 在批准前,批准延遲期間外部狀態可變) | 鎖列已擋 DB 側變動,本步封外部側:六筆斷言與 D1b1 完全相同,**任一對不上即 `ROLLBACK` abort**;結果併入 remediation audit。read-back 是唯讀 API、在交易內跑無副作用 |
| 9 | 刪 cohort 26 張的 `payment_charge_attempts`(assert = **24 筆**) | 🔴 **`pending_invoices` 零刪除**(唯一動作 = 步驟 13 的 status 更新) |
| 10 | 刪 cohort 26 張 orders | CASCADE 預期:`order_items` **36 列**、`order_legal_consents` **2 筆** |
| 11 | 3 張留存單:`legacy_display_id ← 舊號`、`display_id ← 新號`(上表) | D0 已放寬 CHECK,本步不動約束 |
| 12 | 🔴 **條件式兩態(R21 修:原無條件改 refunded 會與 0052 查無出口互相矛盾 → 必然驗收失敗 rollback)**:0102/0104 的 `payment_status` → `refunded`(必有 read-back 證據);**0052 只在 read-back 命中且 `record_status=3` 時才改 `refunded`;查無 ⇒ 保持原值 + audit 註記**(「正式商戶查無」—— 措辭不得寫成「sandbox 已證實」,查無只證明正式商戶無此交易) | 依步驟 5/8b 的 read-back 證據分流 |
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

工具:🔴 **獨立 runbook TapPay client**(R21 統一:**不是** `TapPayChargeAdapter` —— 該檔 `import 'server-only'` 在 node 載入即 throw;client 複用 `wire.ts` 解析、Record API 組裝與 **production endpoint(`TAPPAY_ENV=production`、正式商戶 merchant id 斷言)**,env 讀 Partner Key;附 node 可載入測試)。
🔴 **判定矩陣(R9 起數值寫死、不留給施工片;親驗 tappay-reference.md:85-86)**:逐筆以該單
`payment_charge_attempts.rec_trade_id` 為查詢鍵(🔴 **硬前置:A0a 實查六筆全部非 NULL**,
任一 NULL = 停下 raise Sean);top `status ∈ {0,2}`(查詢成功語意);**要求唯一命中**;
三筆已退單斷言 `record_status = 3`(REFUNDED)且 `refunded_amount` = 授權金額 ——
🔴 **0052 專屬出口(復盤L3;R23 措辭統一:0052 的交易環境未證實 —— 若其確非正式商戶交易,正式憑證查無即必然結果,原矩陣會把整條 D1 卡死)**:
**0052 零筆命中 ⇒ 步驟 12 對 0052 走保持原值路徑**(remediation audit 記「**正式商戶查無**、Sean 授權怎樣處理都好」;🔴 R22:**不得對 sandbox 下結論** —— 查無只證明正式商戶無此交易),**不擋其餘步驟**;
0102/0104 零筆 = 必 abort(正式站真刷必有紀錄)。

🔴 **0064/0090 條件式零筆出口(2026-07-30 D1b1 首跑實證後新增;Sean 當日拍板 A「窄化放寬」)**:
**本段推翻本規格原本的假設。** 原假設 =「rec_trade_id 來自 3DS 啟動 ⇒ TapPay 端必有紀錄」
(出處 `docs/reviews/2026-07-28-e10-fable-retrospective.md:82`,附 migration COMMENT 為證),
故 0064/0090 零筆原本一律 abort。**D1b1 首跑當場證偽**:兩張於正式商戶零命中,且 Sean 同日
於 TapPay 商家後台實查 **2026-06-26、2026-06-27 兩日零交易紀錄**(不是「查不到那一筆」,
是那兩天正式商戶什麼都沒有)。
⇒ **0064/0090 零筆僅在 `orders.payment_status = 'unpaid'` 時放行**(verdict `not-charged-no-hit`、
證據等級 `official-no-hit`、照常刪除);**`unpaid` 以外 = DB 說收過錢而正式商戶查無 = 兩邊矛盾,
一律 abort 停下重問**。措辭合約(R22)同樣適用:只能寫「正式商戶查無」,**不得寫「sandbox 已證實」**。
**反向支撐**(🔴 措辭於同日關卡2 更正,原文誤稱「金額逐格相符」= 未驗證即斷言):
同批 0102/0104 以**同一組 merchant id、同一條查詢路徑**各命中 1 筆,且 `rec_trade_id`
與 `order_number` 逐格相符(讀證據檔實查)⇒ **查詢鍵綁定與商戶身分**已被正向證明,
零筆不是查錯。**金額欄不在此列**,見下條。

🔴 **本出口不足以解封 D1(2026-07-30 關卡2 codex + code-reviewer 一致)**:D1b1 首跑在
0064 即 throw,`judgeHit` **從未對 0102/0104 執行**。直接讀證據檔比對,本規格對「已全額
退款紀錄」的三項假設與 TapPay 實回應不符,下次跑會改在 0102 abort:
①`amount` 實回 **0**(原額在 `original_amount`)②`refunded_amount` 實回 **101 / 1180**
(= orders.total),而矩陣要求它 `= amount`(0)③**`transaction_time_millis` 欄位不存在**
(實有 `time` / `cap_millis` / `transaction_complete_millis` / `bank_transaction_*_millis`)。
⇒ 需重查官方 Record API 文件、改 `packages/adapters/src/tappay/wire.ts` 欄名與本節矩陣、重審。**尚未進行。**
**殘餘風險(Sean 拍板時已明列)**:查無只證明「該商戶無此交易」,不排除別的商戶或 sandbox;
補強靠 Sean 後台人工查證(入 audit 註記、非系統證據)。實作 = `scripts/d1-readback.ts`
`NO_HIT_TOLERATED_WHEN_UNPAID`(名單寫死兩張、不沿用 `PENDING_ORDERS`,放寬須逐張明寫)。

三筆 `pending` 單**命中時**允許 `record_status ∈ {-1 (ERROR), 5 (CANCEL)}` ——
**`0`(AUTH)與 🔴 `4`(PENDING;復盤L3:三筆 3DS 已啟動、這是最可能的實際值)皆不在自動放行集合,
出現即 abort raise Sean 附證據**(交易在途不算「沒扣到」的直接證據;**預期會發生、不是異常路徑**)。
**其餘零筆、多筆、狀態不在集合內、金額不符 —— 一律 abort,不得人工解讀後放行。**
**對不上就 abort,不進入刪除步驟。** 結果連同 Sean 的原話寫成一份 remediation audit 存進備份包。
⚠️ **這一步不是不信任 Sean** —— 是讓「當初憑什麼刪」在半年後翻帳時還查得到,而不是只剩一句對話。

**驗收矩陣(前後對照,codex R2 抓「只驗 orders 與 attempts 不夠」)**:

🔴 **全部 cohort 口徑**(R5 抓:全表數字在 D1 前有新單進來時必然失敗):

| 檢查 | 期望 |
|---|---|
| cohort 26 張待刪 orders | → **0**;cohort 3 張留存 → **仍在** |
| **非 cohort 訂單** | 列數與內容**逐 byte 不變**(執行前後快照於**同一 REPEATABLE READ snapshot** 內取、sweeper 已暫停 —— 復盤L3:READ COMMITTED 下併發結帳必誤判 abort) |
| cohort 的 `order_items` | 36 → 0;留存 3 列仍在 |
| cohort 的 `order_legal_consents` | 2 → 0;留存 2 筆仍在 |
| cohort 的 `payment_charge_attempts` | 24 → 0;留存 3 筆仍在**且 status 未變** |
| `pending_invoices` | **3 → 3、一筆未刪;三筆 `status` 皆改 `voided`**、不再出現在待開票查詢(R5 nit:上一版「一筆未動」與「三筆改狀態」字面打架) |
| cohort 相關 `email_outbox` / `order_refunds` / `order_refund_items` / `payment_double_charge_anomalies` / `payment_double_charge_anomaly_events` | 0 → **0** |
| `display_id` | 留存 3 列**全為新 6 碼**且等於映射表;unique 無碰撞 |
| `legacy_display_id` | 3 列**全為原舊號**、unique、A9b 可查 |
| CHECK | `orders_display_id_format` 存在且 **VALID**;`pending_invoices` CHECK 含 `voided` |
| 金流一致性 | 🔴 **兩態(R21)**:0102/0104 `payment_status` = `refunded` 且 `refunded_amount` = 授權金額;**0052 = `refunded`(read-back 命中路徑)或保持原值 + audit 註記(正式商戶查無路徑)**;三張 `paid_at` 皆未動 |
| 零殘留 | 無任何 FK 指向已刪 `order_id`(逐表 assert,含 0 列表) |

dry-run(步驟 6)與正式 apply 後**各驗一次同一張矩陣**(R5 抓:檔尾曾殘留「跑到 1-6、只驗 orders/attempts」的舊字面,本版已刪)。

**N3c 之後**才把 CHECK contract 成新格式 only(D0 放寬 → N3c 收緊;順序見 §5.0)。
🔴 **D1 到 N2 之間**:那 3 列的 `display_id` 是新格式而 domain 尚未支援 ⇒ **不得餵進 domain `Order` factory**(讀取路徑本來就不會,新寫的 code 要守這條)。

### 8.6 🟡 待決清單(**全檔唯一**;R6 抓:真未定不只 R5 那四項 —— 通知矩陣與建單六題也是待決,此前散在各節)

**R5 的四項已清三項**(Q17=B / Q18 照草案 / Q19=A,2026-07-28 拍板,詳 §8 表)。現存待決:

| 項 | 內容 | 性質 | 擋住誰 |
|---|---|---|---|
| **HCT 允許字元** | `epino` 長度已確認 Char(30);**允許字元文件未載** ⇒ Sean 申請 API 時問新竹站所 | 外部確認 | **C1 產號合約唯一未確認項**(R19 nit:API 帳號申請、`escsno`/`esstno` 等是已知外部操作前置、屬 HCT ref §1 待辦,不是決策題、不入本表) |
| **通知矩陣**(UX §3 #11) | 8 事件 × Email/LINE,Sean 逐格勾選 | 開批閘 | 第 2 批項 7(內部通知)開工前 |
| **admin 建單六題** | 自由品項價格算法 / 稅·折扣 / 客戶與地址 / 付款狀態 / 庫存影響 / 經銷價權限 | 開批閘 | 第 3 批項 10(手動建單)開工前 |
| **退款線兩題**(R8) | ①混合收款(卡+匯款)單的退款分軌與分配順序(世代式 one-current 約束只涵蓋卡單軌,R18 nit 同步)②`partiallyPaid` 取消的本次應退額推導語意(只定上限不夠,兩個合法實作會退不同金額) | 開批閘 | 第 3 批退款線(A8b / worker)開工前;拍板前對應情境 fail-closed |

規則:任何新的未定需求**只准登記在本表**,其他段落只可引用「見 §8.6」;開批閘在對應批次開批時一次問 Sean,不零碎打斷。

---

### 8.7 🔴 A0a-1 拍板後的 D1b1 條件改寫(**D1b1 施工唯一權威**)

**背景**:A0a 實查命中 §5.1 D1b1 原本寫死的硬停條件 —— 六筆 attempts 裡,`PCM-2026-0101`(NT$2,400、`unpaid`、卡片 `pending`)的 `rec_trade_id` 是 **NULL**,而規格把該欄寫死成 D1b1 唯一查詢鍵、且明文「不得用寬條件替代」。過夜 session 依規格停下、未自作主張,D1 線 14 片全部未動。

**Sean 2026-07-29 晨拍板(逐字)**:「都沒扣到錢,放心刪除」。

#### 改寫後的 D1b1 條件

| 對象 | 走哪條路 | 證據等級 |
|---|---|---|
| 五筆**有** `rec_trade_id`(0052 / 0064 / 0090 / 0102 / 0104) | 🔴 **本列已被 2026-07-30 兩項事實取代,不得再照字面施工 —— 以 §8.7 為準**:①0064/0090 新增條件式零筆出口(降級,見 §8.7)②已退款矩陣的三項欄位假設經實測為誤。原字面:~~判定矩陣完全不變、不降級 …… 0052 正式商戶查無 = 保持原值 + audit,0102/0104 查無必 abort~~ | 0064/0090 = `official-no-hit`;其餘系統 read-back |
| 🔴 **`PCM-2026-0101`(唯一無鍵者)** | **不做 TapPay read-back**(物理上無查詢鍵)。**不得改用 `bank_transaction_id` 或任何寬條件替代** —— 那條禁令仍然有效,本次放行的是「缺這筆 read-back 也照刪」,不是「換個鍵去查」。仍留在待刪 cohort(26 張不變) | 🔴 **Sean 本人確認,非系統 read-back** |

#### 施工必做

1. D1b1 的證據包必須**逐筆標註證據等級**,0101 那筆寫死為「Sean 2026-07-29 口頭確認未扣款;無 `rec_trade_id`,未經 TapPay read-back」。
2. D1c 的 **orchestrator audit JSON、cohort manifest、D1c runbook 三處都要帶這句**(對齊 §8.4 對 Q5 的既有做法:「證據等級寫明,來源 = Sean 本人確認」)。~~原字面「migration 註解」~~ 無承接者 —— D1c 不是 migration、不進 migration 序列(2026-07-29 深夜 Sean 拍 T-Q3=A 改承接處,詳 memory `project_m4b-d1-restore-backup-completeness`)。
3. D1c 步驟 8b 的第二次 read-back 同樣**只涵蓋五筆**;不得因為少一筆就把整批 read-back 降級。

#### 🟡 殘餘風險(列出、不自宣接受)

- 0101 的「未扣款」在系統內**沒有可機械複驗的證據**。若日後對帳發現該筆其實有授權,匯出檔(`age` 加密、保存 180 天)是唯一還原路徑 —— 這正是 D1a2 匯出片存在的理由,**不得因本次放行而省略匯出**。
- 「都沒扣到錢」是口語,涵蓋範圍以本節表格為準:**只解除 0101 的無鍵硬閘**,不取消其餘五筆的 read-back。若 Sean 的原意更廣(例如整批都不必 read-back),須另行拍板,施工端不得自行擴張解釋。

— END —
