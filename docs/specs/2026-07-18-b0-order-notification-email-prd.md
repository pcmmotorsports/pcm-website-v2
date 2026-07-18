# B-0 PRD v3 — 訂單通知 email（結帳必填 + 訂單層快照）

> **審查史**：v1 → codex 18 findings + Fable 8 must-fix（皆 FAIL）→ v2 → **R2 雙審**：Fable FAIL（NF-1/NF-2 輕度）、codex FAIL（11 條）→ **本 v3 一次修完 13 條、整份重寫**（避免重蹈「只改被點名那一處」）。
> 🔴 **plan 層審查上限 2 輪已用盡 → 不再開第三輪全審**（PCM 規則）。本 v3 交 Sean 判斷是否動工。
> **Sean 拍板**：D1=A（結帳頁收件資料區塊內可直接填寫的 email 欄）／D2=A（兩階段：nullable 先行 → 獨立收緊片）／**D4=A′**（分開存、條件帶入）／D3 固定 A（只存訂單層、不回寫會員檔）。
>
> 🔴 **2026-07-18 收案三拍板（R3 後，Fable 要求落檔、不得以「PRD 已寫」視同已拍）**：
> · **Q1=A：Sean 明示接受 §5 R2 的 TapPay 殘餘風險**（超長／不合規 email 的 TapPay 端行為 UNVERIFIED、收單行風控無法由 sandbox 證明）→ 照計畫做，B-4 上線後由 Sean 跑一筆真實 3DS 交易驗證。
> · **Q2：outbox PII 保留期＝120 天**（Sean 定，覆蓋 Claude 的 90 天預設）。
> · **Q3=A：PRD 收案、不開第四輪審查、動工 B-1。**
> **審查史收斂曲線**：R1 26 條 → R2 13 條 → R3 4 條（皆既有條目補完、**新 BLOCKER＝0**）→ 全數修畢。
> R3 判定：Fable **PASS**／codex FAIL（4 條部分落地，已全修）。

## 1. 目標（字面已收斂）

讓每張新訂單帶一份**使用者提供、非已知合成域、格式有效**的 email，凍結於訂單層，付款成功後據以寄通知。
⚠️ **不宣稱「保證可投遞」**——拼字錯誤／他人信箱／拋棄式信箱／不存在網域皆無法排除。投遞真相只能由 Resend bounce/suppressed webhook 得知（＝C-2），**該片未完成前，本線不得宣稱「通知孤兒已消滅」**。

## 2. 已查證現況

| # | 事實 | 出處 |
|---|---|---|
| F1 | 結帳表單 schema `CheckoutInput` 只含 `addressId`/`shippingMethod`/`invoice`；完整付款 payload 另含 `lines`/`prime`/`cartSessionId`/`agreed` | `packages/schemas/src/index.ts:139-151`；`checkout-form-types.ts:13-15` |
| F2 | **結帳頁 Step1 顯示並選擇收件資料、Step3 複查；不能在結帳頁編輯**（編輯在會員中心） | `CheckoutView.tsx:240-272`；`CheckoutStep3.tsx:64-76`；`InlineAddressForm.tsx:105,110,115` |
| F3 | `create_order` = 8 參數，零 email 參數；**現行版含 vehicle snapshot／vehicle type guard／法律同意／cart dedup／價格與敏感欄防護** | `20260716200000_...:34-43,275-305` |
| F4 | 該檔註解「尚未 apply」＝過期字面；prod 已 apply 至 `20260717020000` | Supabase `schema_migrations` 實查 |
| F5 | TapPay `cardholder.email` 現取自 session `user.email`（LINE 客人＝合成假信箱）；既有拍板明訂 **cardholder 不收 client 值** | `TapPayChargeAdapter.ts:93-97,164-167`；`cardholder.ts:3,49-51,75` |
| F6 | **DB 層**：`payment_status='paid'` 唯一寫入點＝`confirm_order_payment`。**TS 層**：`confirmer.confirm` 全樹僅 2 個呼叫點（`confirm-payment.ts` / `settle-charge.ts`），但**其上游 caller 眾多**（見 §3.2） | `20260611120000:177-178`；Fable/codex R2 全樹實查 |
| F7 | `email_outbox` 生產零呼叫點 | `SupabaseEmailOutboxAdapter.ts:186,193` |
| F8 | `shipping_address_snapshot` = exact-key 白名單 CHECK `{name,phone,line}`，多一鍵即拒 | `20260604120000:97,126-129` |
| F9 | 存量：客戶 5／訂單 30（全 6 月測試期）／outbox 0 行／疑似同人 0 | R-1 prod 盤點 |
| F10 | Sean 授權舊測試單可刪可清 | Sean 2026-07-18 |
| F11 | **TapPay `cardholder.email` = `String(40)`、須合 RFC 5322、不符則「轉送預設值」（不報錯）**；該欄明載用於詐欺偵測／3DS 風險驗證；`name` 40、`phone_number` 16；**非必填欄位可帶空字串** | 官方三頁一致（zh/en `back.html`、zh `reference.html`）逐字引文 |

## 3. 設計

### 3.1 欄位
`orders.notification_email text` **nullable 先行**（D2=A）。不塞 `shipping_address_snapshot`（F8 硬約束）。
CHECK 🔴 **（現行契約 — 已與 migration `20260718120000` 逐字對齊；B-1 實作後經 code-reviewer 兩輪 + Codex 審查收斂，舊版「等值比對 + 無控制字元」字面已作廢）**：
```sql
notification_email IS NULL OR (
      notification_email = btrim(notification_email)
  AND notification_email ~ '^[!-~]+$'
  AND octet_length(notification_email) <= 254
  AND notification_email ~ '^[^@]+@[^@]+\.[^@]+$'
  AND rtrim(lower(split_part(notification_email,'@',2)), '.') <> 'line.pcmmotorsports.local'
  AND rtrim(lower(split_part(notification_email,'@',2)), '.') NOT LIKE '%.line.pcmmotorsports.local'
)
```
六條件逐條語意與 **B-3 app 層鏡像義務**見 §3.4。
🔴 **舊訂單全為 NULL 是預期狀態**（B-1 為 additive 加欄）→ 收緊策略見 B-6，**不得用裸 `SET NOT NULL`**。

### 3.2 觸發與失敗語意
🔴 **入口盤點（R2 雙審實查修正；v2 的「3DS initiate 後同步 confirm」是錯項、已刪）**：
- `confirmPayment()` ← 僅**同步刷卡**一個 caller。
- `settleCharge()` ← `checkout/callback` 頁、`tappay-notify` webhook、payment-status 輪詢、`settle-sweep` cron、**`preflightReleaseSibling`（重刷前置）**、**`adjudicateSettlement`（dedup）**、**`reconfirmExpiredOrphans`（孤兒再確認）**。
- 兩者皆呼 `confirmer.confirm`（全樹僅此 2 處）→ **enqueue 掛此 2 個 use-case 內、confirmer 成功之後**；**嚴禁掛 `charge-actions`**（掛那裡＝webhook/cron/孤兒路徑收斂的單永不寄信）。
- **測試須覆蓋全部上述入口 + idempotent replay**。

**失敗語意**：**付款結果優先**；enqueue 全 `catch` 不上拋（付款已成功不得回錯誤、避免誘發重刷）；缺列由 C-1 對帳補寄 + 訊號 4 告警兜底。⚠️ 用詞不得寫「fail-closed」（那是相反語意）。
**NULL 快照 fallback**：訂單欄 NULL → 取 `customers.email` → 既有 `isSyntheticEmail` 閘 → 合成域落 `skipped_no_real_email`（機制已存在 `SupabaseEmailOutboxAdapter.ts:156-163`）。

### 3.3 與 TapPay 持卡人 email 的關係（**D4=A′：分開存、條件帶入**）
- 訂單 `notification_email` 存**完整 canonical 值**（≤254 octet，不受 TapPay 40 拖累）。
- 送 TapPay：canonical 值 **≤40 octet 且通過 RFC 5322 驗證** → 帶入 `cardholder.email`。
- 🔴 **>40 或驗證不過時（v3 補：codex R2 抓的矛盾）**：**不可無條件改送 session email** —— session email 必須通過**同一套** canonical 驗證與 ≤40 octet 才可帶入；**兩者皆不合格 → 帶空字串**（F11：官方允許非必填欄位帶空字串），**絕不送已知不合規值**（TapPay 會靜默改預設值、我方無從得知）。
- 🔴 **v2 的「同一份值同時送 DB 與 TapPay」字面作廢**：訂單存的值與送 TapPay 的值**可能不同，且這個不同是刻意的**；兩者各自的來源與驗證規則如上，實作須分別命名（`notificationEmail` / `cardholderEmail`）避免混用。
- 🔴 仍放寬既有拍板「cardholder 不收 client 值」——**僅限 email 一欄、僅在通過上述驗證時**；name/phone 維持 server 權威。須更新 `cardholder.ts` 註解並記錄 Sean 07-18 授權。
- 🔴 **UI 揭露**：欄位說明明文「此信箱也可能用於信用卡付款驗證」。
- **已知限制（誠實揭示）**：>40 與 LINE 合成帳號情況下，TapPay 收到的是空字串或舊值＝**現況不變差、但沒修好**；完整修復屬日後獨立片。

### 3.4 正規化與長度單位（v3 補：codex R2 #6）
- **server 只正規化一次**產生 canonical（trim、domain 轉小寫、拒控制字元/CR/LF）。client 驗證只做 UX，**不得當安全閘**。
- 🔴 **長度一律以 UTF-8 octet 計，三處同源**：DB `octet_length(...) <= 254`；JS 判斷帶入用 `Buffer.byteLength(value,'utf8') <= 40`；TapPay `String(40)` **保守視為 octet**。
  ⚠️ 禁用 JS `.length`（UTF-16 code unit）或 PG `length()`（字元數）——三者對非 ASCII 不等值，會產生 DB 收下、TapPay 靜默改值的邊界縫。
- 🔴 **只允許可列印 ASCII（`^[!-~]+$`）**（B-1 code-reviewer 抓出的 Unicode 空白縫）：`btrim()` 只去 ASCII space、`[[:cntrl:]]` 不含 U+00A0/U+3000 → 舊述詞會放行 **NBSP / 全形空白 / 零寬空格**。此條一舉擋掉所有空白類、控制字元與非 ASCII。**已知代價＝不支援 IDN/UTF-8 國際化 email**（與 TapPay 要求 RFC 5322 相容，實務可接受）。實測 12 個重音/類 ASCII 對抗樣本（é/á/ü/ø/ß/西里爾 а/軟連字號/組合附加符號）**全擋**，`~`(0x7E)與 `!`(0x21) 邊界**全過**。
- 🔴 **禁合成域＝三重防繞過**（① 大小寫不敏感 ② **去尾點 FQDN**：`rtrim(...,'.')`，擋 `x@line.pcmmotorsports.local.` ③ **擋子網域**：`NOT LIKE '%.line.pcmmotorsports.local'`，擋 `x@sub.line…`）。實測「相似但不同域」`ok@notline.pcmmotorsports.local2.com` **未被誤擋**。
- zod schema 的 254 上限**與 DB CHECK 同值同源**（共用常數、禁各自寫死）。
- 🔴🔴 **B-3 app 層鏡像義務（硬性；漏做＝結帳 500）**：server canonical 驗證必須鏡像上列**全部**規則 —— 尤其 ① 只允許可列印 ASCII ② 去尾點 + domain **後綴**比對（非等值）。否則 app 層放行、DB 層才擋 → 使用者看到的是無意義的 500 而非欄位驗證訊息。**此為 B-3 驗收條件,不得省略。**

### 3.5 權限邊界
不擴大 `payment_confirmer`（現僅 EXECUTE `confirm_order_payment` 窄權）。enqueue producer＝獨立 server-only 組件，沿用 orders service-role SELECT + outbox 受控寫入。log／回應**禁帶 email 原值**。

## 4. 拆片

| 片 | 內容 | 標記 |
|---|---|---|
| B-1 🔴 | migration：`notification_email` **nullable** 加欄 + §3.1 CHECK（octet 單位）；不動既有單 | schema、Sean db push + 交易模擬 |
| B-2 🔴 | migration：**同一 migration 內 DROP 舊 8-param + CREATE 9-param（第 9 參 `DEFAULT NULL`）** + **ACL 鏡像重建 + `has_function_privilege` fail-closed 斷言**。🔴 **函式體必須以 prod 當下最新版為基底**（`pg_get_functiondef` 取出、**禁從舊 migration 複製**）並**逐行 diff 驗證** vehicle snapshot／vehicle type guard／法律同意／cart dedup／價格與敏感欄防護**零遺失**（codex R2：複製錯版＝靜默回滾已上線防護）；prod 交易模擬 | 金流 RPC、鐵則12 Packet |
| B-3 | 結帳頁收件資料區塊加 email 欄（D1=A）+ zod 驗證（254 octet、與 DB 同源常數,🔴 **必鏡像 §3.4 全部六條件**：可列印 ASCII / 去尾點 / 擋子網域 —— 漏做＝app 放行、DB 擋、結帳 500）+ 預填規則（會員真 email 預填／合成域空白）+ **UI 揭露文案** + smoke test；**gate＝單一 env flag 同時翻四層**（UI 顯示／client payload／server schema requirement／RPC 呼叫形態），**預設 off**、四層同刻翻轉＝**app 內無層間順序問題**。🔴 **但跨片有唯一合法順序（codex R3 #7）**：`B-1/B-2 完成並驗證 → B-3/B-4 部署但 flag 保持 off → 開 flag 並記錄精確切換時戳（＝§5 R3 的 cutoff）→ 觀察窗 → B-6`。**不得在 B-2 未完成前開 flag**（server 要求 email 但 RPC 尚無該參數＝結帳中斷） | 共用結帳元件 |
| B-4 🔴 | `charge-actions` 串接：canonical email 存入 `create_order`；**條件帶入** `buildCardholder`（§3.3 三分支：canonical 合格／session 合格／皆不合格帶空字串），三路徑各測試 + 40/41 octet 邊界測試；更新 `cardholder.ts` 拍板註解 | 金流 action、鐵則12 |
| B-5 🔴 | enqueue 掛 §3.2 兩個匯聚點；付款優先、全 catch；**可部署但不得宣稱功能上線**（gate 見 §6） | 鐵則12 |
| B-6 🔴 | **收緊片**：⚠️ 不可用裸 `SET NOT NULL`（會驗全部存量列，舊單與過渡窗 NULL 必炸；回填合成值又撞 §3.1 禁合成域 CHECK＝自相矛盾）→ 改 **cutoff 式 CHECK**：`created_at >= <切換時戳> → notification_email IS NOT NULL`；**同片移除 RPC 第 9 參數 DEFAULT**（否則 authenticated caller 可直呼 RPC 省略該參數繞過必填，app 層 schema 擋不住 — codex R2 #3）；明文 backfill／刪除政策 + 觀察窗 N 天 | schema、獨立片、**列入 §6 上線 gate** |

## 5. 風險 / rollback

- **R1 RPC 簽章與函式體**：見 B-2。DROP+CREATE 須同一 migration 原子完成；**最大風險是複製到舊版函式體而靜默回滾防護** → diff 驗證為硬性交付物。
- **R2 動 TapPay payload**：驗證矩陣見 §6。殘餘風險（收單行風控行為）**無法由 sandbox 證明**，須 Sean 明示接受或向 TapPay 確認。**TapPay 對超長／不合規的實際行為（是否單獨報錯）＝UNVERIFIED**。
- **R3 舊 cohort（兩審分歧已裁決）**：付款面採 Fable（payload 一次性、placeOrder 先於 charge → in-flight 零付款風險）；**通知面採 codex（風險成立）** —— B-4 前建立、之後才由 `settleCharge` 晚翻 paid 的舊單，`notification_email` 為 NULL，只能走 §3.2 fallback（多半落 `skipped_no_real_email`）。
  → **收斂（codex R3 #8 修正，v3 原字面有誤）**：cutoff **必須是「flag 實際開啟時戳」**，不是 B-4 部署時戳（B-4 部署後、flag 開啟前建立的單仍是 NULL，用部署時戳會把它們誤歸新 cohort）。
  🔴 **且界定欄位必須是 `created_at`、不能只用 `paid_at`**：C-1 現以 `orders.paid_at >= 下界` 掃描，舊單若在 cutoff **之後**才晚翻 paid 會被誤納入「應該有信」的集合 → **C-1 述詞須同時要求 `created_at >= cutoff`**。B-6 的 cutoff CHECK 使用**同一個時戳**。
- **rollback**：切回相容 app／RPC 路徑 + **保留 nullable 欄**。`DROP COLUMN` **不是日常 rollback**（永久刪 PII、且撤不回已送 TapPay 的 payload），僅能作日後另行批准的清理 migration。

## 6. 上線 gate（全數達成前，不得宣稱「通知功能上線」）

1. sweeper 排程確認實際在跑（**pg_cron 現況未確認**）
2. **C-1 對帳**（固定下界 NOT EXISTS，下界＝R3 時戳）
3. **A-1 paid-without-outbox 告警**（五訊號目前查無實作）
4. **C-2 Resend bounce／suppressed webhook**（§1 的誠實前提：沒有它就不知道信是否真的到）
5. **C-4 admin 可查／可改／可補寄**（v3 新增拆片，見下）
6. **B-6 必填收緊已完成**（否則 DB 仍接受省略第 9 參數 → 必填可被直呼 RPC 繞過）
7. 真實連通驗證：Sean 下一筆真單實際收到信
8. **TapPay 驗證矩陣**：同步成功／3DS challenge 成功／取消／逾時／callback 漏接後由 sweeper 收斂；每案比對改前後 TapPay 回應碼、status、Record API 結果

**C-4（v3 新增，補 codex R2 #9）**：admin 訂單頁顯示 `notification_email`、可修正打錯的信箱、可觸發補寄。
🔴 **結構障礙**：outbox 現以 `UNIQUE(event_type, dedup_key)`、`order_created` 一單一鍵 → **已送出的信不能直接再 INSERT 同事件**。🔴 **PRD 定調（codex R3 #9：不再遞延）＝採「新 event_type」`order_created_resend`**，不採 dedup_key 加序號。
理由：①不更動既有 `order_created` 唯一鍵語意（避免動到已驗證過的狀態機）②補寄可獨立稽核、可計數、可設次數上限 ③與原始事件分離，訊號與對帳述詞不會互相污染。
**C-4 片級交付範圍**：`event_type` CHECK 白名單擴充 migration ＋ sender 分派（eventType 窮舉 `satisfies never` 增員）＋ admin 觸發入口與權限 ＋ 補寄次數上限 ＋ 驗收（原始信與補寄信並存不互擋）。文案與次數上限數值留 C-4 片級 plan。

## 7. PII 生命週期（v3 補定案，非「須定義」）

| 副本位置 | 保留 | 刪除／處置 |
|---|---|---|
| `orders.notification_email` | 依交易／會計保存義務長期保留 | **不隨客戶刪除請求即刪**；以遮罩／匿名化處理，保留交易可對帳性 |
| `email_outbox.recipient_email` | 🔴 **120 天**（起算欄位＝`created_at`；**Sean 2026-07-18 拍板**，覆蓋 Claude 提的 90 天保守預設） | 清理 job（#281）刪除逾期列；**清理機制納入 §6 上線 gate**，且須有驗證（跑後「逾期列 count = 0」斷言） |
| TapPay（外部處理者） | 依其政策 | 我方不可控 → 屬**外部處理者告知**事項 |
| Resend（外部處理者） | 依其政策 | 同上 |

規則：log／告警／錯誤訊息／回應 body **一律禁帶 email 原值**（只帶 outbox id／event_type／counts）；admin 顯示需權限控管；隱私政策須揭露 TapPay／Resend 為外部處理者。

## 8. 連動面

`CheckoutView` → `useChargePayment` → `chargePaymentAction` → `PlaceOrderInput` → `mapPlaceOrderToCreateOrderArgs` → `create_order`；
另：`CheckoutStep2/3`、`InlineAddressForm`、`cardholder.ts`、`TapPayChargeAdapter`、`confirm-payment.ts`、`settle-charge.ts`、`checkout/callback/page.tsx`、`tappay-notify` webhook、payment-status 輪詢、`sweep-settlements.ts`、`preflightReleaseSibling`、`adjudicateSettlement`、`reconfirmExpiredOrphans`、`SupabaseEmailOutboxAdapter` + 全部對應 `.test`。
