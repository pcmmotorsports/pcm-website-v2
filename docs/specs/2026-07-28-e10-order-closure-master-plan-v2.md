# M-4b E10 訂單閉環總規劃 **v2**(2026-07-28 重寫)

> **狀態:** 🟡 提案,**待 Sean 批准 + codex 關卡1 通過才動第一片 code**(鐵則 8/12)
> **取代:** `docs/specs/2026-07-27-e10-order-closure-master-plan.md` v1 —— v1 經 codex 關卡1 **FAIL、67 條 findings(62 must-fix + 5 nit)**,判定重寫非修補。逐條裁定 = `docs/reviews/2026-07-28-e10-k1-findings-triage.md`(駁回 0 條)
> **驗收唯一標準:** `docs/specs/2026-07-25-admin-backend-rebuild-spec.md` §1「員工的一天」27 項
> **北極星(Sean 逐字):**「可以完整上線給員工使用,操作,修改網站。而且他們不是工程師」
> **輪次:** plan 層兩輪上限,v1 已用掉 R1 ⇒ 本檔只剩 **1 輪 R2**。R2 仍不收斂 = 方向問題,整理決策題給 Sean。

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
| **U** | UI,只消費**已存在**的 RPC。**不碰 schema** | 三綠 + smoke test + agent-browser 實看 |

> 這條同時解掉「哪些片要跑 codex 關卡2」的爭議:**M 與 R 一律高風險**(鐵則 12 ②③),**U 依內容判**。v1 把總數寫成 13 / 12、實際表裡是 15(`grep -c` 實測)⇒ v2 **不預先宣稱高風險片總數**,逐片標、開批時當場數(#61/#62)。

### 原則 2 — 模型先於欄位

某件事的真相若屬於一個尚未存在的實體(包裹、採購、收款、退貨),**先建那個實體**,再開輸入、通知與列印。
`orders` / `order_items` **永遠不會**拿到 `tracking_number`、`supplier_name` 這類欄位;它們最多只持有「最新摘要」,而摘要必須由 trigger 從真相表推導、標明可重算。

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
| **C1** | 同日分批出貨的訂單編號後綴 | ✅ **已解除** —— Sean 2026-07-27 拍 P1:系統自動加 `-1`/`-2`。落地規則(#26):**序號取自包裹建立序、永不重排(刪包裹後續號繼續往下走)、重送沿用原值**。`hct-logistics-api-reference.md` §8 已同步(不再記「未定案」) |
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

### 5.0 模型依賴圖(先閉環,再談片)

```
        ┌─ D1 舊訂單清理 + 3 張改號 (最先跑; 後面所有片只面對 3 列)
        │
        ├─ order_items 計數器 ─┬─ order_item_procurement (採購真相, 1:N per line)
第1批 ──┤                      └─ order_notes (內部備註 / 聯絡紀錄 / 已告知登記)
        │
        └─ orders.cancel_reason_code (內部;對客 cancelled_reason 原封不動)
                    ↓
第2批 ── shipments + shipment_items (包裹真相; 一單多包 + 多單併一箱)
             ├─ 出貨輸入 / 追蹤連結 / 分批後綴
             ├─ 出貨通知 (email_outbox) + 內部通知 (LINE OA)
             ├─ 列印出貨單 / 揀貨單
             └─ 前台 #240 訂單詳情頁
                    ↓
第3批 ── order_payments (收款帳本) ─┐
         order_returns/_items ──────┤
         order_refunds 寫入 RPC ─────┼─ 改單 (U2) / 待辦+對帳 / 稽核 UI / 匯出
         order_internal (負責人/跟進日)┤
         admin 建單 RPC ─────────────┘
                    ↓
        N2 domain 換格式 (可獨立上線) + N3 create_order 產號器 & CHECK 收緊
        (§5.4; 刻意不與第 1 批同批 —— N3 動的是 654 行結帳金流函式)
```

**閉環檢查**:每個箭頭下游都不早於上游;第 1 批不依賴包裹、不依賴帳本、不依賴新編號 ⇒ 可獨立驗收(#1/#2/#7/#8/#9)。

### 5.1 第 1 批(詳片級;可直接開工)

**Sean 做完會看到**:訂單列表換成新版 12 欄三軸;列表只剩 **3 張單**且**單號已是新的 6 碼格式**(D1);訂貨軸真的能標(含部分數量、含批次);明細頁能寫內部備註與聯絡紀錄、能記供應商單號與預計到貨;取消訂單這個動作**第一次存在**。
**Sean 這批看不到**:出貨軸(顯示灰色「未出貨」、唯讀,第 2 批才會動)。
⚠️ **新單號只有那 3 張是新格式** —— `create_order` 要到 N3 才改產號器,所以第 1 批之後**新進來的真實訂單仍是舊格式** `PCM-YYYY-NNNN`。這是刻意的(不在同一批動結帳金流函式),但 Sean 驗收時會看到新舊並存,**不是 bug**。

| 片 | 型 | 內容 | 做完哪項變綠 |
|---|---|---|---|
| **A0** | docs | 規格凍結 + 現況重驗:`orders` 筆數 / E11 積木採用度 / **27 項逐項重驗**(現值是 07-26 的,已隔兩天) | — |
| **D1** | M | 🔴 **舊訂單清理 + 改號**(Q2=A / Q5;完整六步與守則見 §8.4):匯出存檔 → 刪 26 張無金流單及其 `payment_charge_attempts`/`pending_invoices` → 3 張有金流的改新格式 → 0052/0104 狀態改 `refunded` → CHECK 暫收兩種格式。**排在 A1 之前**,讓 A1 的計數器回填只面對 3 列 | — |
| **A1** | M | `order_items` 加計數器欄(`ordered/instock/shipped/return_requested/return_received/cancelled_quantity`)。**同片做完**:加欄 nullable → 回填 → `SET DEFAULT 0` + `SET NOT NULL` → CHECK 不變式(各值 ≤ `quantity`;`ordered ≥ instock ≥ shipped`)。🔴 回填規則 = **全部 0**,理由:既有 9 碼 `workflow_status` 是自由 code、映射不可靠。⚠️ D1 先跑 ⇒ **本片只面對 3 張留存單**(那 3 張是真刷過的驗證單,非一般營運單,歸零不影響對帳:錢的真相在 `payment_status` 與 `payment_charge_attempts`,不在計數器)(#15) | — |
| **A2** | M | `order_item_procurement` 新表(每 line **1:N**,吃同 SKU 分兩家 / 同家分批確認,#45)。欄:供應商名(自由文字)、聯絡管道、送出時間、供應商單號、回覆狀態、異常原因、預計到貨、`first_ordered_at`、`status_changed_at`。ACL = service_role only + RLS zero-policy(原則 3) | — |
| **A3** | M | `order_notes` 新表(append-only):內部備註 / LINE·電話聯絡紀錄 / 「已告知客人」登記(U6)。欄:管道、對內對客、摘要、承諾日期、操作者。ACL 同 A2 | — |
| **A4** | R | `admin_set_item_counters` owner RPC —— CAS 用既有 `order_items.version`、同交易寫 audit、超量 fail-closed。**擴充既有 `admin_update_order_item_workflow` 的形狀,不另發明**(#16) | 4,5 |
| **A5** | R | `admin_upsert_item_procurement` owner RPC —— 含供應商文字 trim + 大小寫歸一(UX §2 #9);`first_ordered_at` 僅首次寫入、`status_changed_at` 每次更新;**no-op 不動任何日期**;業務日一律 Asia/Taipei server 端算(#46/#47) | 6,7 |
| **A6** | R | `admin_append_order_note` owner RPC | 3 |
| **A7** | M | `orders` 加 `cancel_reason_code`(內部受控 code)。🔴 **不取代** `cancelled_reason`(那是**對客**文字,`audit/types.ts:22` 已有此分流先例)(#14) | — |
| **A8** | R | `admin_cancel_order` owner RPC —— 帶 `cancel_reason_code` + 品項層部分取消(寫 `cancelled_quantity`)。已出貨品項禁取消的規則寫進 RPC(本批無出貨資料 ⇒ 條件恆真,第 2 批自動生效) | 19 |
| **A9** | U | 明細頁:內部備註 + 聯絡紀錄時間軸 | 3 |
| **A10** | U | 明細頁:逐品項採購表單(供應商/單號/管道/回覆狀態/異常原因/預計到貨)+ 依供應商單號搜尋 | 5,6,7 |
| **A11** | U | 訂單列表新版版面(§5.1a);出貨軸唯讀灰 | 1(部分) |
| **A12** | U | 列表批次標記訂貨。🔴 **不套 `<AdminDataTable>`** —— 直接做在 `orders-table`,理由見 §7.3(#23) | 4 |

**第 1 批 = 14 片(A0、D1、A1-A12)。片型分佈:docs 1 / M 5 / R 4 / U 4。M 與 R 共 9 片一律高風險、對抗審查不降級。**
⚠️ D1 是本批**唯一不可逆**的一片(刪 production 資料)⇒ 匯出存檔沒做完不得執行,且它與 A1 之間要留一個 Sean 確認點。

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

1. `shipments` + `shipment_items` 模型(U1 全形狀:一單多包 **+ 多單併一箱**)
2. 出貨 owner RPC(含分批後綴 C1 規則:建立序、永不重排、重送沿用)
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

> **落點已定**:既有 3 張單的改號在 **D1(第 1 批最前)**;`display-id.ts` 換格式(N2)與 `create_order` 產號器 + CHECK 收緊(N3)**排在第 3 批之後**,刻意不與第 1 批同批 —— N3 動的是 654 行結帳金流函式,不放在一堆新東西同時上線的那一批。

**動機(Sean)**:避免客人從 `PCM-2026-0104` 推測年度訂單量。

**碰撞機率更正**(v1 數字錯,#51):字母表依 v1 自己的字面 = 36 英數 −(`0`,`O`,`1`,`I`,`L`)−(`A`,`E`,`U`)= **28 字元**,不是 32。

| 長度 | 28 字元可能組合 | 10 年約 3000 張單「首抽至少一次碰撞」 |
|---|---|---|
| 5 碼 | 17,210,368 | 約 **23.0%** |
| **6 碼(採用)** | 481,890,304 | 約 **0.929%** |

結論用 6 碼**仍成立**(0.9% 且有重試),但這是**首抽碰撞率、不是建單失敗率**(#52)。

**Q2=A 之後只剩 2 片**(原 3 片,#55/#56/#57):

| 片 | 型 | 內容 |
|---|---|---|
| ~~**N1**~~ | — | ❌ **整片取消**(Q2=A)。原本要做「舊新雙格式並存」,但 26 張舊單被刪、3 張改號後全表已是新格式 ⇒ domain 不需要同時吃兩種 |
| **N2** | U(domain) | `display-id.ts` 把舊格式**換成**新 6 碼格式 + 測試。🔴 `parseDisplayId` 現回 `{year, seq}`,新格式**沒有這個語意** ⇒ 直接刪除該函式(全樹只有測試在用) |
| **N3** | R | `create_order` 產號改亂碼 + **有界重試**:亂數源指定、**只捕捉具名 constraint**(不是所有 unique violation,#53)、上限用盡**明確報錯不靜默**、超限告警;**同一 migration** 把 D1 留下的寬鬆 CHECK contract 成新格式 only。🔴 這支是 **654 行 SECURITY DEFINER 金流函式**,本片必過 codex 關卡2 + Sean 1 元真刷 smoke |

🔴 **真正的順序約束只有一條(DB 側)**:任何時刻 `orders_display_id_format` 必須接受 `create_order` 當下產出的格式。
所以「換產號器」與「收緊 CHECK」必須在**同一個 migration**(N3 內),中間不能有一次部署的空窗。

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

- **不給總片數與總工期**。**第 1 批 = 14 片**(§5.1 逐片列出、當場數;唯一有效來源是 §5.1 那張表)。第 2/3 批開批時才拆片,**現在給的數字必然是假的** —— v1 同檔寫過 24 / 22、高風險 13 / 12(實際 15),就是這麼來的(#61/#62)
- 27 項現況沿用 2026-07-26 read-back,**至今未重驗**(A0 補)
- 視覺 artifact 未讀取,版面以 §5.1a 文字為準(#66)
- E8-B plan v3 的 34 條 must-fix **仍未重寫折入**;本檔只記錄狀態
- 報價單 repo **不能跑 `supabase db push`**(本地 146 檔 vs ledger 160 筆版本號零重疊)—— 與 E10 無關,但 E8-B 開工前必處理

---

## §7 實作約束

### 7.1 逐批啟用閘(#3)

`dev` = pcm-admin 正式站,**推即部署**,沒有「先上測試站看看」。⇒

- **M 片可以先上**(expand-only、零行為改動、舊程式照跑)
  🔴 **唯一例外 = D1**:它刪 production 資料、改單號、改付款狀態,**不是 expand-only、不可逆、沒有 flag 能擋**。
  ⇒ D1 走**獨立的守則**(§8.4:匯出存檔先行 + 交易模擬 + apply 後 read-back),且**不與其他 M 片同批 apply**
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
- 🔴 `orders.fulfillment_status` 欄**保留不 DROP**、改 COMMENT 標「E10 起停寫、衍生顯示」,比照 `orders.workflow_status` 在 D-2 的處理先例

### 8.2 Q3=A 的連動(E10 範圍變大,明寫)

E10 **吃下退款寫入線**:`order_refunds` 的寫入 owner RPC(RF2b)+ ACL + 覆核(RF8)進第 3 批。
⇒ 第 3 批的體積明顯大於 v1 估計。**這是 Sean 知情後的選擇**(N5「訂單域做到目標狀態才算數」的一致結果),不是範圍蔓延。
⚠️ RF2b-RF8 的既有規格散在 M-3 退款線文件,第 3 批開批時要先把它們對齊本檔的一片一層原則,**不是直接照抄舊拆片**。

### 8.3 🔴 Q2:「訂單都是假的」實查後不成立於全部 29 張

2026-07-28 production 實查(`bmpnplmnldofgaohnaok`):

| 單號 | 金額 | 付款狀態 | 實況 |
|---|---|---|---|
| 其餘 **26** 張 | — | `unpaid`、無 `paid_at` | ✅ 從未有金流,**砍掉零風險** |
| `PCM-2026-0052` | NT$6,800 | **`paid`**(2026-06-23) | ⚠️ 有 TapPay 交易紀錄。依 memory,正式站首筆真刷是 07-24 的 0102 ⇒ 本筆**極可能是 sandbox**,但需 Sean 確認 |
| `PCM-2026-0102` | NT$101 | `refunded`(2026-07-24) | 史上第一筆正式站真刷,已退款 |
| `PCM-2026-0104` | NT$1,180 | **`paid`**(2026-07-25) | 🔴 **RF2a-0 驗證真刷,錢還沒退回來** |

**三張 `order_refunds` 帳本列數皆為 0** —— 因為 RF2b 寫入 RPC 從未施工,0102 的退款是在系統外做的、只把狀態翻成 `refunded`。

**刪除的實際阻擋(FK 實查)**:`order_items`(39 列)與 `order_legal_consents`(4 列)是 CASCADE 可自動走;但
`payment_charge_attempts`(**27 列**,NO ACTION)、`pending_invoices`(3 列,NO ACTION)、`email_outbox`(0 列,RESTRICT)
**會直接擋住 DELETE**,必須先清。其中 `payment_charge_attempts` 是 3DS 雙扣防護的刷卡嘗試帳本。

**關鍵事實(讓第三條路成立)**:🔴 **TapPay 的 `order_number` 送的是 `orders.id`(UUID)、不是 `display_id`**
(`packages/adapters/src/tappay/TapPayChargeAdapter.ts:91` 逐字 `order_number: payload.orderId`)
⇒ **改 `display_id` 不會影響 TapPay 對帳**。

**因此有第三條路(推薦)**:砍掉 26 張沒金流的,**把 3 張有金流的改號成新格式**。
效果 = 全表統一新格式(雙格式支援不用做,Sean 要的省事達成)+ 金流紀錄與雙扣帳本完整保留。
⇒ **N1 片(display-id 雙格式)可整片取消。**(CHECK 的最終狀態是新格式 only,但中間仍需一段暫時同時接受兩種的期間 —— 原因見 §8.4 第 6 步。)

✅ **Sean 2026-07-28 拍 A**(砍 26 + 改號 3)。

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
- ⚠️ **但 DB 的 CHECK 仍需一段「暫時接受兩種」的期間**(D1 第 6 步 → N3 收緊)。這跟 domain 無關,純粹因為 `create_order` 在 N3 之前還在產舊格式。**別把這兩件事搞混**:domain 零雙格式、CHECK 有一段雙格式窗口

**D1 片(M 型、🔴 高風險:③DB 不可逆 + ①錢面資料)—— 排在 A0 之後、A1 之前**:

**🔴 相依資料實查(2026-07-28,`paid_at IS NOT NULL` = 留存的 3 張)—— 上一版寫錯,已更正**:

| 相依表 | 屬於留存 3 張 | 屬於待刪 26 張 | D1 要做什麼 |
|---|---|---|---|
| `payment_charge_attempts` | **3** | **24** | 刪那 24 筆(NO ACTION、不先清會擋住 DELETE) |
| `pending_invoices` | **3** | **0** | 🔴 **一筆都不能動** —— 3 筆全屬留存單。上一版寫「刪 26 張的 pending_invoices」是錯的:不但是 no-op,照字面做還會刪到要保留的發票紀錄 |
| `order_legal_consents` | **2** | **2** | CASCADE 帶走 2 筆(全表 4 筆,**不是 4 筆全走**) |
| `order_items` | **3** | **36** | CASCADE 帶走 36 列(全表 39) |
| `email_outbox` / `order_refunds` / `order_refund_items` / `payment_double_charge_anomalies` | 0 | 0 | 全表零列,無動作 |

**trigger 實查**:`orders` 只有 `orders_freeze_shipping_snapshot_bi`(**BEFORE INSERT**)⇒ D1 的 DELETE 與 UPDATE 都不會觸發它;`order_items` 零 trigger。

| 步 | 動作 | 守則 |
|---|---|---|
| 1 | **先匯出存檔**:29 張 orders + `order_items` + `payment_charge_attempts` + `pending_invoices` + `order_legal_consents` 全欄 dump | 🔴 含 `shipping_address_snapshot`(真實地址)⇒ **存本機、不進 git**;路徑回報 Sean |
| 2 | 刪**屬於那 26 張**的 `payment_charge_attempts`(預期 **24 筆**) | 🔴 **不要碰 `pending_invoices`** —— 那 3 筆全屬留存單。條件一律用 `order_id IN (待刪集合)`,**不要用 `NOT IN (留存集合)` 以外的寫法**,並在刪前 assert 筆數 = 24 |
| 3 | 刪 26 張 orders | CASCADE 預期帶走 `order_items` **36 列**、`order_legal_consents` **2 筆**;刪後 assert 兩者剩 **3 列 / 2 筆** |
| 4 | 3 張留存單改號成新 6 碼格式 | DROP 舊 CHECK → UPDATE → ADD 新 CHECK,同一 migration |
| 5 | `PCM-2026-0052` / `PCM-2026-0104` 的 `payment_status` → `refunded`(Q5) | 🔴 `paid → refunded` 是狀態機合法轉移(`state-machine.ts:41`);DB 層無 UPDATE trigger 擋;**來源=Sean 口述、非 TapPay 查證**,migration 註解要寫明 |
| 6 | 新 CHECK **暫時同時接受兩種格式** | ⚠️ 這一步不能省:`create_order` 在 N3 之前仍產舊格式,CHECK 若立刻收成新格式 only,**下一筆真實結帳當場被擋** |

**N3 之後**才把 CHECK contract 成新格式 only。
🔴 **D1 到 N3 之間的約束**:那 3 列的 `display_id` 是新格式而 domain 尚未支援 ⇒ **不得把它們餵進 domain `Order` factory**(讀取路徑本來就不會,但新寫的 code 要守這條)。

**驗收**:交易模擬(BEGIN→跑完 1-6→驗筆數/格式/狀態→ROLLBACK)、匯出檔逐列比對、
apply 後 read-back 確認 `orders` 剩 3 列且全為新格式、`payment_charge_attempts` 剩屬於那 3 張的列數。

— END —
