# Slice Plan — M-3 RF2a「退款帳本 schema + partiallyRefunded enum」

> 上位權威 = PRD `docs/specs/2026-07-24-refund-automation-line-prd.md` §0b/§4(退刷線 RF1→RF8)。
> 前一片 = RF2a-0 凍結運費規則(`a698ba8`,已 apply production)。
> 拍板落檔 = memory `project_m3-rf2a-refund-ledger-decisions`。
> **版本:v3**(2026-07-25)。審查歷程:codex 關卡1 **R1 = NO-GO 14 must-fix + 4 nit**(折入紀錄 §13)→ **R2 = NO-GO,11 條 HOLDS / 4 條 INADEQUATE + 2 新 must-fix**(折入紀錄 §14)。**plan 層 2 輪上限已用盡、不跑 R3**。

---

## 0. 片型 / 分級 / 鐵則判定

| 項目 | 判定 | 依據 |
| --- | --- | --- |
| 內容分級 | **L1**(schema 與型別,非後台 CRUD 內容) | 鐵則 9 |
| 片型 | 🔴 **高風險片** | 鐵則 12 ①錢(`payment_status` 金流紅線欄)+ ③DB 結構(新表 + enum 加值 + **動既有表 `order_items` 加 UNIQUE**) |
| 鐵則 8 | ✅ **命中,本檔即 plan、待 Sean 批** | 動 schema |
| 審查鏈 | 不降級:codex 關卡1(R1 已跑)→ 實作 → 三綠 → code-reviewer → codex 關卡2 | 鐵則 12 |
| 估時 | **50-60 分鐘**(v1 估 35-45,折入 R1 後 schema 約束與驗證顯著擴張)⚠️ **超鐵則 4 上限;Sean 2026-07-25 拍 Q4=B「不拆、一片做完」= 知情接受**(§12.1) | 鐵則 4 |

---

## 1. 目標

1. 建**退款帳本**(`order_refunds` + `order_refund_items`),供 RF2b RPC 落帳、RF8 隔日覆核、RF6 後台顯示。
2. `payment_status` enum 加第 5 值 **`partiallyRefunded`**(Q1=A、收 backlog #26)。
3. TS 側同步(Q2=A):型別、狀態機、**所有陣列型硬編碼列舉**、label map、測試。

**本片不做**:退款 RPC(RF2b)、`TapPayChargeAdapter.refund()`(RF3)、admin TapPay 基建(RF4)、server action(RF5)、後台 UI(RF6)、settle-charge 重分類(RF7)、隔日覆核(RF8)。
🔴 **本片交付後兩表零寫入端**——這是刻意的,也是 §11 R6 部署窗口安全的**唯一依據**。

---

## 2. Sean 拍板(2026-07-25)

- **Q1=A**:`partiallyRefunded` 允許**自我轉移**,多次連續部分退都停在同一狀態。只對此值開例外、其餘維持禁自我轉移。
- **Q2=A**:**同片一起改 TS**。⚠️ **R1 更正**:同 slice ≠ 部署原子(db push 與 Vercel deploy 是兩個獨立動作)⇒ 真正的安全依據是「本片零寫入端」,不是同 commit。部署順序約束見 §11 R6。
- **Q3=A**:**拆兩支 migration** + **Supabase preview branch 完整實測**。
- **Q4=B**(2026-07-25,codex R1 折入後追加):**本片不拆成兩片**,一片做完。Sean 在我明確揭示「折入後估 50-60 分鐘、超鐵則 4 的 15-45 分鐘上限」後裁示 B ⇒ **超時為知情接受、非疏漏**。⚠️ 連帶:本片不可中途交付半成品,收工前 §10 驗收九條需一次走完。

---

## 3. 🔴 硬約束:交易模擬在 §5.1 不可用

PostgreSQL 17 官方文件逐字(2026-07-25 親讀 `https://www.postgresql.org/docs/17/sql-altertype.html` Notes):

> "If `ALTER TYPE ... ADD VALUE` (the form that adds a new value to an enum type) is executed inside a transaction block, the new value cannot be used until after the transaction has been committed."

- 正式站實測 PG = **17.6.1.111**(project `bmpnplmnldofgaohnaok`)。
- 本 repo **`ADD VALUE` 零先例**(`grep "ADD VALUE" supabase/migrations/*.sql` 無命中)。
- ⇒ RF2a-0 的手法(`BEGIN` → 套用 → 合成 INSERT → 驗 → `RAISE`)**在 §5.1 物理不可行**。
- ⇒ **§5.2 不受此限**(不含 `ADD VALUE`)⇒ **§5.2 必須自帶顯式 `BEGIN;…COMMIT;`**(R1 F17)。
- ⇒ **不得宣稱「本片已做交易模擬」**;可誠實宣稱的是「§5.2 交易模擬 + §9.1 preview branch 實測」。

---

## 4. 偵察 pass:連動面(實查)

碰 `payment_status`/`paymentStatus` 的檔 = **62 個**。

### 4.1 🔴 加值會**靜默**壞掉的(typecheck 抓不到,必須逐一 grep)

| 位置 | 型別 | 不同步的後果 |
| --- | --- | --- |
| `packages/adapters/src/payment/PgChargeAttemptAdapter.ts:310` | `readonly PaymentStatus[]` 手寫 4 值 | 🔴 **最嚴重**:`:326` 做 fail-closed 驗證 ⇒ 該狀態訂單只要有 active charge attempt 即 `ChargeAttemptParseError` throw |
| `apps/admin/src/lib/orders/order-list-view.ts:46` | `PAYMENT_STATUS_VALUES` 陣列 | 新值不出現在後台篩選;URL 參數被白名單靜默丟棄 |
| `apps/admin/src/lib/orders/order-list-view.test.ts:225` | 迴圈依上一列陣列衍生 | **假綠**:永遠測不到第 5 值 |
| `packages/domain/src/order/state-machine.test.ts:146` | `allPayment` 字面 4 值 | 跨軸負向斷言不涵蓋新值 |
| `packages/adapters/src/supabase/database.types.ts:1709,1841` | codegen 產物 | 見 §8.6(不重 gen、手加) |

### 4.2 ✅ 加值會**編譯錯誤或測試轉紅**(自我回報)

| 位置 | 機制 |
| --- | --- |
| `packages/domain/src/order/state-machine.ts:31` | `Record<PaymentStatus, readonly PaymentStatus[]>` 缺 key → 編譯錯 |
| `apps/admin/src/lib/orders/order-list-view.ts:75` | `Record<PaymentStatus, string>` → 編譯錯 |
| `apps/storefront/src/lib/orders/order-display.ts:44` | `switch` + `const _exhaustive: never` → 編譯錯 |
| 🆕 `apps/storefront/src/lib/orders/order-display.test.ts:11-37` | `STATUS_CASES` 4×4=16 組窮舉 + **`expect(STATUS_CASES).toHaveLength(16)` 硬斷言** → **測試轉紅**(R1 F14 抓到、v1 漏列) |

### 4.3 SQL 側:天然安全(不需改)

多數為 `= 'unpaid'` / `= 'paid'` 等值比較或 `NOT IN` denylist ⇒ 新值待遇同現行 `refunded`/`partiallyPaid`。代表:`20260611120000:150,161`、`20260615120001:166`、`20260624120006:96`、`20260701130000:96`、`20260621120000:69`。

**既有缺口(揭示、不在本片修)**:`20260714120000:142` 的 `workflow_status` seed CASE 對新值落 `ELSE NULL`(`:137` 註解已記載 `partiallyPaid`/`refunded` 同樣落 NULL)⇒ 缺口從 2 值擴為 3 值,**非本片新增回歸**。

🆕 **R1 F15**:`apps/admin/src/lib/orders/workflow-select-options.ts:5,33,39` 的 `isVisibleForPayment` 對新值落 `return true` catch-all(行為安全),但其文案與測試只列 `partiallyPaid`/`refunded` ⇒ **納入 §8 清單補齊**,防日後 fallback 收緊時靜默回歸。

### 4.4 命名(🔴 v1 字面已更正)

- `order_refunds` / `order_refund_items` 在 **`supabase/` schema 層零命中**(實跑 `grep -rn 'order_refunds' supabase/` 無結果)⇒ 不撞既有表。
- ⚠️ **v1 誤寫「全 repo 零命中」= 未實跑該 grep 的推測**(R1 F1 抓到,屬實)。實際 `STATUS.md:163`、`docs/archive/.../2026-07-25-rf2a0-freeze-shipping-handoff.md:41` 皆已提及此表名(規格文字,非 schema 定義)。
- `bank_refund_id` = TapPay 官方 **String(20)、不可重複**(`docs/reference/tappay-reference.md:94`)。

---

## 5. 設計 A:兩支 migration(Q3=A)

### 5.1 `20260725130000_m3_rf2a1_payment_status_add_partially_refunded.sql`

- 僅一句 `ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'partiallyRefunded';`
- 🔴 **不自己包 `BEGIN/COMMIT`**;🔴 **不可與 §5.2 合併**。
- 排序 `enumsortorder` = 5;**不用 `BEFORE/AFTER` 定位**(已 grep 確認 repo 無依賴 enum 順序的邏輯)。
- 冪等:`IF NOT EXISTS`。
- ⚠️ **不可逆**:PG 不支援移除 enum 值 ⇒ rollback 註解須誠實寫「無法移除,只能不使用」。

### 5.2 `20260725130100_m3_rf2a2_order_refunds_ledger.sql`

🔴 **自帶顯式 `BEGIN;` … `COMMIT;`**(R1 F17):否則 `CREATE TABLE` 成功而後續 `REVOKE`/RLS/斷言失敗時,會留下「表已建、Supabase 新物件預設 grant 仍在」的直寫面。

內容:`order_items` 加 UNIQUE → 建兩表 → ACL/RLS → 索引 → 一致性 trigger → fail-closed 斷言。
🔴 **不引用 `'partiallyRefunded'` 字面**(帳本 `status` 用自己的 text CHECK、與 `payment_status` 解耦)⇒ 兩支之間**無 enum 依賴**,只有邏輯先後。

---

## 6. 設計 B:帳本兩表(v2 已折入 R1 的 7 條 schema must-fix)

### 6.1 為何兩張表

`bank_refund_id` 是 **per-退款請求**唯一鍵(PRD §0b Q3=A「非 per-品項」),而一次請求可含多品項(RF2b RPC 名 `admin_refund_order_items`,複數)⇒ 單表會讓同一 `bank_refund_id` 出現多列、直接撞唯一鍵。

> 🔴 **PRD 字面矛盾(本片順手更正)**:PRD §5 D2 仍寫「每**品項**一筆退款鍵」,與 §0b Q3=A 的「per-**退款請求**」相反。§5 自述為保留供背景的舊文 ⇒ 以 §0b 為準,同片修掉該行。

### 6.2 前置:`order_items` 加複合唯一鍵(R1 F5)

```sql
ALTER TABLE public.order_items ADD CONSTRAINT order_items_order_id_id_key UNIQUE (order_id, id);
```

🔴 **這是動既有 live 表**(純加唯一索引、不改資料、不改既有約束語意)。目的=讓 §6.4 的複合 FK 能在 **DB 層**強制「明細的品項必須屬於本退款的訂單」。開工前須確認 `order_items` 現有 PK 為 `id`、且 `(order_id, id)` 現無重複(apply 當下以 `DO` 斷言,不成立即 `RAISE`)。

### 6.3 `public.order_refunds`(退款請求層級)

| 欄 | 型別 | 約束 |
| --- | --- | --- |
| `id` | uuid | PK `DEFAULT gen_random_uuid()` |
| `order_id` | uuid | NOT NULL, FK `orders(id)` |
| — | — | **UNIQUE (`id`, `order_id`)** ← 供 §6.4 複合 FK 反向引用 |
| `bank_refund_id` | text | NOT NULL, **UNIQUE**, CHECK `char_length BETWEEN 1 AND 20` |
| `tappay_refund_id` | text | NULL;🆕 **partial UNIQUE `WHERE tappay_refund_id IS NOT NULL`**(R1 F9) |
| `items_amount` | integer | NOT NULL, CHECK > 0 |
| `shipping_fee_before` | integer | NOT NULL, CHECK >= 0 |
| `shipping_fee_after` | integer | NOT NULL, CHECK >= 0 |
| `shipping_delta` | integer | NOT NULL |
| `refund_amount` | integer | NOT NULL, CHECK > 0 |
| `status` | text | NOT NULL, CHECK IN (`processing`,`confirmed`,`failed`) |
| `reason` | text | NOT NULL, CHECK `btrim(reason) <> ''` |
| `actor` | text | NOT NULL, 🆕 CHECK `btrim(actor) <> ''`(R1 F8) |
| `request_id` | text | NOT NULL, 🆕 CHECK `btrim(request_id) <> ''`(R1 F8) |
| `failed_reason` | text | NULL |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |
| `confirmed_at` | timestamptz | NULL |

**CHECK 清單**:

1. `refund_amount = items_amount - shipping_delta` — RF1 公式釘在 DB 層。
2. `shipping_delta = shipping_fee_after - shipping_fee_before`。
3. 🆕 **運費值域**(R1 F2):`shipping_fee_before` 與 `shipping_fee_after` 皆 `IN (0, orders 凍結的 shipping_home_fee)` 不可直接寫成 CHECK(跨表)⇒ 改**兩道**:
   - CHECK `shipping_fee_before <= 100000 AND shipping_fee_after <= 100000`(絕對上界、擋 R1 舉的 `before=10000` 荒謬值)
   - 🔴 **真正的權威驗證在 RF2b RPC**:同交易 `JOIN orders` 驗 `shipping_fee_before = orders.shipping_fee` 且 `shipping_fee_after` 由 `orders.shipping_free_threshold`/`shipping_home_fee`(RF2a-0 凍結欄)重算得出。**本片於表註解明寫此約定**,並在 §12 列為 RF2b 的硬前置。
4. 🆕 **狀態一致性**(R1 F7):
   - CHECK `(status = 'confirmed') = (confirmed_at IS NOT NULL)`
   - CHECK `(status = 'failed') = (failed_reason IS NOT NULL AND btrim(failed_reason) <> '')`
   - CHECK `status <> 'processing' OR (confirmed_at IS NULL AND failed_reason IS NULL)`

5. 🆕 **狀態轉移合法性 trigger**(R2 新 must-fix、v3 折入):上列 CHECK 只驗**單列內部自洽**,擋不住「已 `confirmed` 的列被改回 `failed`」——RF8 覆核一旦有 bug,會把一筆銀行端已成功的退款覆寫成失敗,帳本語法合法但語意矛盾、且**不可靠地驅動退款回滾**。
   ⇒ 加 `BEFORE UPDATE` trigger `order_refunds_status_transition_bu`,合法轉移**僅**:
   - `processing → confirmed`
   - `processing → failed`
   - 同值(冪等重寫)
   `confirmed` 與 `failed` 皆為**終態**,轉出一律 `RAISE`。此為 DB 層硬防線,不依賴 RF8 自律。

### 6.4 `public.order_refund_items`(品項明細)

| 欄 | 型別 | 約束 |
| --- | --- | --- |
| `id` | uuid | PK |
| `refund_id` | uuid | NOT NULL |
| `order_id` | uuid | NOT NULL ← 🆕 冗餘欄,存在只為下方兩道複合 FK |
| `order_item_id` | uuid | NOT NULL |
| `quantity` | integer | NOT NULL, CHECK > 0 |
| `unit_price` | integer | NOT NULL, CHECK >= 0 |
| `line_amount` | integer | NOT NULL, CHECK > 0, CHECK `line_amount = unit_price * quantity` |

🆕 **兩道複合 FK 合力封死跨單串接**(R1 F5):

```sql
FOREIGN KEY (refund_id, order_id)      REFERENCES order_refunds(id, order_id)   ON DELETE RESTRICT
FOREIGN KEY (order_id, order_item_id)  REFERENCES order_items(order_id, id)     ON DELETE RESTRICT
```

⇒ 明細的 `order_item_id` **在 DB 層**被強制屬於該退款 header 的 `order_id`。單靠兩個獨立 FK 做不到這件事(R1 舉的 order A header 掛 order B 品項)。

- **UNIQUE (`refund_id`, `order_item_id`)** — 同一次退款不得重複列同品項。

### 6.5 🆕 主從一致性:CONSTRAINT TRIGGER(R1 F3 + F4)

CHECK 無法跨列聚合 ⇒ 用 `CREATE CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`,於**交易 COMMIT 時**驗:

1. 每筆 `order_refunds` **至少一列**明細(擋「空明細 header」)。
2. `order_refunds.items_amount = SUM(order_refund_items.line_amount)`(擋「header 100 / 明細 1000」)。

DEFERRED 是必要的:RPC 會先插 header 再插明細,立即驗會誤擋合法流程。

🔴 **v3 更正(R2 判 INADEQUATE、屬實)**:v2 只寫「用 CONSTRAINT TRIGGER」**未指定掛哪張表與哪些事件** —— 若只掛 `order_refund_items`,則「header 插入後一列明細都沒插」的情境**永遠不會觸發任何 trigger**,空明細 header 完全擋不住。正確配置需**兩個** constraint trigger 呼叫同一驗證函式:

| trigger | 掛表 | 事件 | 擋什麼 |
| --- | --- | --- | --- |
| `order_refunds_ledger_consistency_ac` | `public.order_refunds` | `AFTER INSERT OR UPDATE` | 空明細 header(此路徑是唯一能抓到它的)+ 該 header 的 sum |
| `order_refund_items_ledger_consistency_ac` | `public.order_refund_items` | `AFTER INSERT OR UPDATE OR DELETE` | 明細增刪改後 sum 失衡(含 `DELETE` 後 sum 變小、v2 漏列的事件) |

兩者皆 `DEFERRABLE INITIALLY DEFERRED FOR EACH ROW`,共用函式 `pcm_assert_refund_ledger_consistent()`(零參數 trigger 函式,refund_id 由 TG_OP/NEW/OLD 推導),函式內驗:

1. 該 refund 明細列數 `>= 1`。
2. `items_amount = COALESCE(SUM(line_amount), 0)`。
3. 🆕 **每列明細對照 `order_items` 本體**(R2 新 must-fix、§6.4 連動):`quantity <= order_items.quantity` 且 `unit_price = order_items.unit_price`(以 `order_item_id` 單列查詢,非跨列聚合)。
   ⚠️ 這只擋「單次退款超過原始數量」與「捏造單價」;**跨次累積超退仍不擋**(§6.6 不變)。
`DELETE` 事件下以 `OLD.refund_id` 取值;header 被刪時明細受 `ON DELETE RESTRICT` 保護,不會出現孤兒。

### 6.6 🔴 跨退款請求累積超退:本片**不**在 DB 層擋(R1 F6,明確揭示)

R1 正確指出 `UNIQUE(refund_id, order_item_id)` 只防同一次重複,擋不住「同品項用兩個不同 `bank_refund_id` 各退一次」。

**本片的處置(誠實)**:

- DB 層不加此防線。理由=正確判準需要「該品項原始數量 − 已退數量之和 ≥ 本次數量」,涉及跨表聚合 + 併發,`CONSTRAINT TRIGGER` 做得到但需 `FOR UPDATE` 鎖 `order_items`,與 RF2b RPC 的鎖順序耦合 ⇒ **應與 RPC 同片設計,否則兩處鎖策略打架**。
- ⇒ 列為 **RF2b 的硬前置驗收條件**(§12.2),並在本片的表註解明寫「累積超退防線在 `admin_refund_order_items` RPC,本表未強制」。
- 本片提供 `order_refund_items(order_item_id)` 索引讓該聚合查詢可用。
- 🔴 **不得因此宣稱帳本已防超退**。

### 6.7 索引

- `order_refunds(order_id)`
- `order_refunds(status) WHERE status = 'processing'`(RF8 覆核掃描)
- `order_refund_items(order_item_id)`(RF2b 算剩餘可退數量)

---

## 7. 設計 C:ACL

樣板 = `20260712210000_m4a_admin_audit_log.sql:82-89`(RLS zero-policy 縱深 + 全 REVOKE + 精準 GRANT + fail-closed 斷言)。

🔴 **與 audit 的差異**:帳本 `status` 要能 `processing → confirmed/failed`(RF8)⇒ 不可只 GRANT INSERT。

```sql
ALTER TABLE ... ENABLE ROW LEVEL SECURITY;          -- zero policy = 客戶端零讀取
REVOKE ALL ON TABLE ... FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE ... TO service_role;          -- admin 顯示用(RF6)
```

寫入(INSERT/UPDATE)**不 GRANT** ⇒ 一律走 RF2b 的 SECURITY DEFINER owner RPC,對齊 `orders`/`order_items` 現況(`20260714130000:251` 註解:「orders 對 service_role 已 REVOKE 直寫」)。

🔴 **v3 再更正(R2 判 v2 的 `role_table_grants` 版本仍 INADEQUATE、屬實)**:`information_schema.role_table_grants` **看不到**繼承而來的有效權限、`PUBLIC` 授權與**欄級** grant(`pg_attribute.attacl`)⇒ 仍可能漏判。改對齊 **repo 既有模式**(`20260717020000_m4a_email_outbox.sql` 的 ACL 斷言段,同款寫法亦見於 S2 片):

- `aclexplode(coalesce(relacl, acldefault('r', relowner)))` 逐條展開 **direct ACL**(含 `PUBLIC` = grantee oid 0)
- `pg_attribute.attacl` 逐欄檢查**欄級** grant(v2 完全沒驗)
- `has_table_privilege('<role>', '<table>', '<priv>')` 驗**有效**權限(涵蓋角色繼承)
- 三者皆須成立才放行;任一不符即 `RAISE`

**逐項驗收清單**:

- anon / authenticated / PUBLIC:`role_table_grants` **零筆**
- service_role:**恰 1 筆且 `privilege_type = 'SELECT'`**
- 明確斷言 service_role 對兩表**無** INSERT / UPDATE / DELETE / TRUNCATE
任一不符即 `RAISE` 拒絕套用。

---

## 8. TS 側同步清單(Q2=A;逐項可勾)

1. `packages/domain/src/order/types.ts:30` — union 加 `'partiallyRefunded'`。
2. `packages/domain/src/order/state-machine.ts:31-36` — 加 key;`paid: [..., 'partiallyRefunded']`、`partiallyRefunded: ['partiallyRefunded', 'refunded']`(**Q1=A 自我轉移**);同步改 `:21-29` 註解(現寫「自我轉移非法」,將與程式不符)。
3. 🔴 `packages/adapters/src/payment/PgChargeAttemptAdapter.ts:310` — 陣列加值(**靜默破口、最易漏**)。
4. `apps/admin/src/lib/orders/order-list-view.ts:46` 陣列 + `:75` label map。
5. `apps/storefront/src/lib/orders/order-display.ts:44` — switch 加 case;文案「已退部分」(須與 RF6 一致)。
6. 🆕 `apps/storefront/src/lib/orders/order-display.test.ts:11-37` — `STATUS_CASES` **16 → 20 組**(5 payment × 4 fulfillment)+ `toHaveLength(16)` → `(20)` + describe 標題數字(R1 F14)。
7. 🆕 `apps/admin/src/lib/orders/workflow-select-options.ts:5,33,39` — 補新值分支文案與測試(R1 F15)。
8. `packages/domain/src/order/state-machine.test.ts:146` — `allPayment` 加值 + **新增自我轉移正向測試** + **其他 4 值仍禁自我轉移的負向測試**。
9. `apps/admin/src/lib/orders/order-list-view.test.ts:225` — 補**不從 `PAYMENT_STATUS_VALUES` 衍生**的獨立斷言(見 §9.2 M6)。
10. 🆕 **`database.types.ts` 手動加值,不重跑 codegen**(R1 F13,手法已更正):
    - 檔頭 `:1-4` 明文規定重 gen 用 `--project-id bmpnplmnldofgaohnaok`、**禁用 `--linked`**;而該 project = **production**,本片未 apply production ⇒ 重 gen 只會拿回 4 值、且會把無關的 live 漂移一併拉進來。
    - repo 既有慣例即**手加**(PROGRESS 多處「database.types 手加 N 處」)。
    - ⇒ 手動加 `:1709` 與 `:1841` 兩處;commit body 註明「未重 gen、理由同上」。
    - **正式站 apply 後**由後續片重 gen 對齊(列入 §12.2)。

---

## 9. 驗證計畫(Q3=A)

### 9.1 Supabase preview branch 完整實測

1. 建 preview branch → 套用兩支 migration → 綠。
2. 驗 enum:`pg_enum` = **5 值**、新值 `enumsortorder` = 5。
3. 驗結構:兩表 + `order_items` 新 UNIQUE 存在;欄型別/NOT NULL/DEFAULT 逐欄比對;**所有 CHECK `convalidated = true`**;兩道複合 FK、三個索引、partial unique、CONSTRAINT TRIGGER 存在。
4. 🆕 **正向測試(R1 F12,v1 只有負向)**:插入合法列必須**成功**——
   - Sean 範例:`items_amount=3000, before=0, after=100, delta=100, refund=2900` ✅
   - 全退回退運費:`items_amount=5500, before=0, after=0, delta=0, refund=5500` ✅
   - **負 `shipping_delta`**(退款使運費回退):`items_amount=1000, before=100, after=0, delta=-100, refund=1100` ✅
5. **負向測試(金額)**:`refund_amount` 與公式不符 → `check_violation`;`refund_amount = 0` → `check_violation`。
6. **負向測試(冪等鍵)**:同 `bank_refund_id` 兩次 → `unique_violation`;21 字元 → `check_violation`。
7. 🆕 **負向測試(主從一致,R1 F11)**:
   - header 無明細直接 COMMIT → CONSTRAINT TRIGGER `RAISE`
   - `items_amount` ≠ `SUM(line_amount)` → `RAISE`
   - **跨單串接**:order A 的 header 插 order B 的 `order_item_id` → `foreign_key_violation`
8. 🆕 **負向測試(狀態一致性)**:`status='confirmed'` 而 `confirmed_at IS NULL` → `check_violation`;`status='failed'` 而 `failed_reason` 空 → `check_violation`。
9. 🆕 **負向測試(ACL,R1 F10/F11)**:以 anon / authenticated SELECT → 拒;**service_role INSERT / UPDATE / DELETE 三者皆拒**(v1 只測 INSERT)。
10. **新值可用性**(交易模擬做不到的那段):`UPDATE orders SET payment_status='partiallyRefunded'` 真實執行 → 成功;TS 同步後驗 `PgChargeAttemptAdapter` fail-closed 路徑不 throw。
11. 🆕 **v3 新增(R2 連動)**:
    - **空明細 header**:插 header、**不插任何明細**、COMMIT → 必須 `RAISE`(這是 v2 配置會漏掉的那條,證明 trigger 掛對表)
    - **明細 DELETE 後失衡**:插合法 header+明細 → 刪一列明細 → COMMIT 必須 `RAISE`
    - **單次超量**:`quantity` 大於 `order_items.quantity` → 必須 `RAISE`
    - **捏造單價**:`unit_price` ≠ `order_items.unit_price` → 必須 `RAISE`
    - **狀態轉移**:`confirmed → failed`、`failed → confirmed`、`confirmed → processing` 三者皆必須 `RAISE`;`processing → confirmed` 必須成功
    - **ACL 欄級**:對單一欄位 `GRANT SELECT (reason)` 給 anon → fail-closed 斷言必須抓到(驗 `pg_attribute.attacl` 真的有在看)
12. 用完刪除 preview branch;記錄 branch id 與各項實際輸出貼進交接。

### 9.2 突變測試(沿用 RF1 教訓:讓壞值**只**觸發被測那道守門,避免遮蔽)

| # | 突變 | 預期 |
| --- | --- | --- |
| M1 | 拿掉守恆 CHECK | 錯誤金額列插得進 → 紅 |
| M2 | `PgChargeAttemptAdapter.ts:310` 不加新值 | 新值 + active attempt 解析測試轉紅 |
| M3 | `state-machine` 移除自我轉移 | 多次部分退測試轉紅 |
| M4 | 自我轉移開給所有值 | 「其他 4 值仍禁自我轉移」負向測試轉紅 |
| M5 | `bank_refund_id` 拿掉 UNIQUE | 重複插入測試轉紅 |
| M6 | `order-list-view.ts:46` 陣列不加值 | 🔴 **v1 預期仍綠**(假綠)⇒ §8.9 補獨立斷言後**必須轉紅** |
| 🆕 M7 | 移除 §6.4 其中一道複合 FK | 跨單串接測試(§9.1-7)轉紅 |
| 🆕 M8 | CONSTRAINT TRIGGER 改 `INITIALLY IMMEDIATE` | 合法「先 header 後明細」流程被誤擋 → 正向測試轉紅(證明 DEFERRED 是必要的、非裝飾) |
| 🆕 M9 | ACL 斷言只驗筆數不驗 `privilege_type` | 把 GRANT 改成 UPDATE 後斷言仍過 → 證明 §7 強化有效 |
| 🆕 M10 | **只掛 `order_refund_items` 那一個 trigger**(= v2 的配置) | 空明細 header 測試**必須轉綠→紅的反向**:v2 配置下該測試會**通過**(漏擋)⇒ 本突變證明 §6.5 兩個 trigger 的必要性,非裝飾 |
| 🆕 M11 | 移除 §6.3-5 狀態轉移 trigger | `confirmed → failed` 測試轉紅 |
| 🆕 M12 | ACL 斷言退回 v2 的 `role_table_grants` 版本 | 欄級 `GRANT SELECT (reason)` 給 anon 的測試轉紅(證明 `attacl` 那段在做事) |

### 9.3 三綠 + full test

typecheck / lint / build(動 .ts);full test 全綠;`git diff --check` 乾淨。

---

## 10. 驗收條件(逐條 yes/no)

1. 兩支 migration 存在、命名對齊時戳慣例;§5.2 自帶顯式 `BEGIN/COMMIT`。
   🔴 **冪等性字面更正(code-reviewer〔Fable〕抓到 v3 此處不實)**:**只有 §5.1 冪等**(`ADD VALUE IF NOT EXISTS`);
   **§5.2 不冪等** —— 全檔零 `IF NOT EXISTS`(實查 = 0 處),成功套用後重放會在第一句 `CREATE TABLE` 撞 duplicate。
   **這是刻意的**:`CREATE TABLE IF NOT EXISTS` 會讓「表已存在但結構不同」**靜默通過**,在金流帳本上比直接炸更危險
   ⇒ 寧可重放時明確失敗、由人判斷。正常 `db push` 有 `schema_migrations` 記錄、不會重放;
   ⚠️ 但本 repo 有**版本漂移前例**(MCP `apply_migration` 自行重編號 ⇒ 記錄對不上),真發生時需人工判斷,不可盲目重跑。
2. §9.1 十一項於 preview branch 全 PASS,**實際輸出貼進交接**(不寫「應該會過」)。
3. §9.2 九項突變**實測**,M1-M5、M7-M9 全紅;M6 於 §8.9 補斷言後轉紅。
4. §8 十項 TS 同步全數完成;三綠 + full test 全綠。
5. 🆕 **全樹複查用兩種模式**(R1 F16):
   - `grep -rn "readonly PaymentStatus\[\]"`(型別字面)
   - `grep -rnE "'(unpaid|paid|partiallyPaid|refunded)'" --include=*.ts --include=*.tsx`(值字面,可抓 `Array<[PaymentStatus,...]>`、zod、mock、fixture)
   - 兩份結果逐一確認已含第 5 值或確認不需改(附理由)。
6. PRD §5 D2 的 per-品項字面已改為 per-退款請求。
7. commit 訊息**不含**「交易模擬」字面(§3)。
   🔴 **v3 更正(codex 關卡2 抓到本條與 §15 自相矛盾)**:v2 這裡原寫「誠實寫『§5.2 交易模擬 + preview branch 實測』」,
   但 §15.1 明載**檔內顯式 `BEGIN/COMMIT` 本次未被直接執行驗證**(MCP 自帶交易、未重複送)。
   ⇒ 正確口徑 = **只宣稱 preview branch 實測**;**§5.2 的原子性屬「已寫入、未驗證」**,其作用對象是 `supabase db push`,
   真正驗證要等 Sean apply 當下觀察(或日後在能執行整檔的環境重測)。
8. 表註解明寫兩件事:①運費權威驗證在 RF2b RPC(§6.3-3)②累積超退防線在 RF2b、本表未強制(§6.6)。
9. 未 push、未 apply production、未開任何 flag、未動 `.env*`。

---

## 11. 風險與殘餘

| # | 風險 | 緩解 | 殘餘 |
| --- | --- | --- | --- |
| R1 | `ADD VALUE` **不可逆** | 值名經 Sean 拍板;`IF NOT EXISTS` | 🔴 日後改名只能新增另一值 + 資料遷移。**需 Sean 知情** |
| R2 | 交易模擬在 §5.1 不可用 | preview branch 完整實測 + §5.2 自帶交易 | 🔴 preview branch ≠ 正式站資料;apply 後仍須獨立驗證 |
| R3 | 半套用:§5.1 成功、§5.2 失敗 | 兩支獨立且冪等;§5.1 只加值、無人使用 | 低:多一個沒人用的 enum 值 |
| R4 | 🆕 半套用:§5.2 **內部**失敗(表已建、ACL 未套) | **顯式 `BEGIN/COMMIT`**(§5.2)⇒ 整檔回滾 | 低 |
| R5 | `PgChargeAttemptAdapter` 靜默破口漏改 | §8.3 + M2 突變 + §10.5 **兩種** grep 模式 | 低 |
| R6 | 🆕 **db push 與 deploy 非原子**(R1 F17) | 🔴 **本片零寫入端**=無人寫入新值 ⇒ 舊程式不會遇到它。**部署順序硬約束:RF2b(第一個寫入端)上線前,§8 的 TS 必須已部署到 production** | 🔴 若有人繞過後台直接 SQL 寫入新值,舊程式會 throw。列入 RF2b 前置 |
| R7 | 🆕 動既有 live 表 `order_items` 加 UNIQUE | 純加唯一索引、不改資料;apply 當下先斷言無重複 | 大表加索引有鎖表時間 ⇒ **需量測 `order_items` 列數**(現 33 筆訂單量級,可忽略) |
| R8 | 跨次累積超退 DB 層無防線 | §6.6 明確揭示 + 列 RF2b 硬前置 + 表註解 | 🔴 **RF2b 落地前,帳本不保證不超退**。不得宣稱已防 |

---

## 12. 後續與待確認

### 12.1 🔴 估時超鐵則 4 → 拆片建議

v2 折入後估 **50-60 分鐘**,超過 15-45 分鐘上限。建議拆:

- **RF2a-i**:§5.1 enum 加值 + §8 全部 TS 同步 + §9.2 M2/M3/M4/M6(不碰帳本表)
- **RF2a-ii**:§5.2 帳本兩表 + §6/§7 全部約束與 ACL + 其餘驗證

兩片各約 25-30 分鐘,且切點乾淨(§5.1 與 §5.2 本就無 enum 依賴、§6.5 刻意不引用該 enum 值)。
⇒ 🏁 **Sean 2026-07-25 裁示 = B「不拆」**(拍板全文見 §2 Q4=B)。上述拆法**不執行**,保留於此僅作為日後回顧「當時評估過拆片、Sean 知情選擇不拆」的紀錄。
⇒ 連帶風險:單片工時偏長 ⇒ 實作時**依 §8 十項與 §6 各節逐項推進、每完成一段即自檢**,避免長片中段失去可中斷點(鐵則 4 的原意)。

### 12.2 移交給後續片的硬前置

1. **RF2b**:①同交易 `JOIN orders` 驗 `shipping_fee_before` 與重算後的 `shipping_fee_after`(§6.3-3)②跨次累積超退驗證 + 鎖策略(§6.6)③`kind` 分類鏡像 RF1 §3.3-10b。
   🆕 **v3 補(R2)**:④`quantity` 與 `unit_price` 對照 `order_items` 本體 —— **DB 層已由 §6.5-3 擋單次超量與捏造單價**,RF2b 仍須在 RPC 內先驗並回明確 rejection kind(不能只靠 trigger `RAISE`,那會讓後台看到 500 而非可讀錯誤)。
2. 🆕 **RF8**(v3 補、R2):覆核只能走 `processing → confirmed|failed`;§6.3-5 的 trigger 會硬擋其他轉移 ⇒ RF8 需先讀狀態、已終態則 no-op,不可盲目 UPDATE。
3. **正式站 apply 後**:重跑 `database.types.ts` codegen 對齊(§8.10)。
4. **RF6**:`partiallyRefunded` 前後台文案一致(§8.5)。

### 12.3 不擋 plan 審查的待確認

- preview branch 建立需 Supabase 配額;S2 片已實證流程可行。

---

## 13. codex 關卡1 R1 折入紀錄(2026-07-25、`-s read-only`)

**判定 = NO-GO,14 must-fix + 4 nit。全數處置如下**(逐條核對後折入,未盲從)。

| R1 finding | 處置 |
| --- | --- |
| §6.2 守恆 CHECK 未綁 orders 實際運費 | ⚠️ **部分折入(v3 誠實改標;R2 判 v2 標「✅ 折入」過度)**:值域上界只擋荒謬值、**不構成與 orders 的綁定** ⇒ 正確定位 = **延後至 RF2b 的 invariant**,非本片已修 |
| §6.3 header/child 金額無約束 | ✅ 折入 §6.5 DEFERRED CONSTRAINT TRIGGER |
| §6.3 可存在空明細 header | ✅ 折入 §6.5 |
| §6.3 `order_item_id` 未綁 header 的 order | ✅ 折入 §6.2 + §6.4 兩道複合 FK(連帶 `order_items` 加 UNIQUE) |
| §6.3 跨次累積超退無防線 | ⚠️ **不在本片解**,改為 §6.6 明確揭示 + RF2b 硬前置 + 表註解 + §10.8 驗收(理由:鎖策略須與 RPC 同片設計) |
| §6.2 status/confirmed_at/failed_reason 無一致性 | ✅ 折入 §6.3 CHECK 清單 4 |
| §6.2 actor/request_id 無非空 CHECK | ✅ 折入 §6.3 |
| §6.2 `tappay_refund_id` 無保護(nit) | ✅ 折入 partial UNIQUE |
| §7 「恰 1 筆」不證明是 SELECT | ✅ 折入 §7 逐項驗 `privilege_type` + 明確斷言無 I/U/D/T + M9 突變 |
| §9.1 驗證未涵蓋主從/同單/空明細/UPDATE | ✅ 折入 §9.1-7/8/9 |
| §9.1(4)/M1 只有負向無正向 | ✅ 折入 §9.1-4 三組正向(含負 delta) |
| §8(6)/§9 codegen 來源 | ⚠️ **問題成立、手法駁回**:codex 稱「既有慣例 `--linked`」**不實**——`database.types.ts:1-4` 明文用 `--project-id` 且**明文禁用 `--linked`**。改採 repo 既有慣例=**手加**,理由寫入 §8.10 |
| `order-display.test.ts` 16 組(nit) | ✅ 折入 §4.2 + §8.6(16→20 + `toHaveLength`) |
| `workflow-select-options.ts`(nit) | ✅ 折入 §4.3 + §8.7 |
| §10.5 grep 模式不足 | ✅ 折入 §10.5 兩種模式 |
| §2 Q2=A/R3 部署非原子 | ✅ 折入 §2 更正 + §11 R6 部署順序硬約束 |
| §5.2/R3 內部半套用 | ✅ 折入 §5.2 顯式 `BEGIN/COMMIT` + §11 R4 |
| §4.4 表名非零命中(nit) | ✅ 折入 §4.4,**並承認 v1 該斷言未實跑 grep**(字面值三來源律違反) |

**額外自行發現(非 R1 提出)**:折入後估時超鐵則 4 上限 ⇒ 已提 §12.1 拆片建議,**Sean 2026-07-25 裁示 B「不拆」**(§2 Q4=B)。

---

## 14. codex 關卡1 R2 折入紀錄(2026-07-25、`-s read-only`)

**判定 = NO-GO**。R2 的主任務是「驗證 R1 的修法是否真的成立」而非找新問題。結果:**11 條 HOLDS、4 條 INADEQUATE、2 條新 must-fix**。

### 14.1 HOLDS(codex 確認 v2 修法成立,11 條)

`cross-order`(複合 FK 真的擋住,且確認 `order_items.id` 現為 PK ⇒ `(order_id,id)` 天然唯一、`RESTRICT` 不妨礙 RPC insert)、`cumulative-overrefund`(揭示一致且延後理由技術上成立)、`status-fields`、`actor-request`、`tappay-refund-id`、`validation-coverage`、`positive-cases`、`codegen`、`display-matrix`、`workflow-options`、`grep-coverage`、`deploy-atomicity`、`migration-atomicity`(確認 §5.2 所有語句皆可在單一交易內執行、無非交易語句)、`name-collision`、`overtime-slice`(確認唯一中間態=已套用但無人使用的 enum 值,安全)。

🔴 **codex 自認 R1 有一條錯**:`R1-codegen` —— 它 R1 宣稱「既有慣例是 `--linked`」,R2 實查後確認 `database.types.ts:1-4` 明文用 `--project-id` 且明文禁用 `--linked`,**我的駁回成立**。

### 14.2 INADEQUATE + 新 must-fix(6 條,全數折入 v3)

| R2 finding | 判定理由 | v3 處置 |
| --- | --- | --- |
| `empty-header` | 🔴 **硬技術錯誤**:child-table trigger 在「零明細」時**永遠不會 fire** ⇒ v2 的空 header 防線等於不存在 | ✅ §6.5 改為**兩個** trigger(header `AFTER INSERT OR UPDATE` + child `AFTER I/U/D`)共用驗證函式;§9.1-11 加「插 header 不插明細必 RAISE」;§9.2 **M10 專門突變證明 v2 配置會漏** |
| `child-sum` | v2 未指定掛表與事件,且漏 `DELETE`(刪明細後 sum 變小不會被驗) | ✅ 同上,child trigger 明列 `OR DELETE`;§9.1-11 加刪明細測試 |
| `acl-assertion` | `role_table_grants` 看不到繼承有效權限、`PUBLIC`、**欄級** grant;repo 既有模式用 `aclexplode`/`attacl`/`has_table_privilege` | ✅ §7 改對齊 repo 既有模式(三者並用);§9.1-11 加欄級 grant 負向測試;§9.2 M12 突變 |
| `shipping-range` | 100000 上界不構成與 orders 的綁定,§13 標「✅ 折入」**過度宣稱** | ✅ §13 該列改標 ⚠️ **部分折入**、正確定位為 RF2b invariant(誠實性修正,非技術修正) |
| 🆕 `quantity/unit_price` 未綁 `order_items`(新) | 可記錄 quantity 2 對原始 quantity 1、或捏造單價,所有 FK 與 sum CHECK 皆過 | ✅ §6.5-3 驗證函式加單列對照(`quantity <= order_items.quantity`、`unit_price =` 本體);§9.1-11 兩條負向測試;§12.2-1④ RF2b 仍須先驗以回可讀錯誤 |
| 🆕 `status` 轉移無約束(新) | 單列 CHECK 擋不住 `confirmed → failed` 覆寫,RF8 一有 bug 即產生語意矛盾的帳 | ✅ §6.3-5 加 `BEFORE UPDATE` 狀態機 trigger(僅允許 `processing` 轉 `confirmed` 或 `failed`,以及同值冪等);§9.1-11 三條負向;§9.2 M11;§12.2-2 RF8 須先讀狀態 |

### 14.3 為何不跑 R3

`~/.claude/rules/00-work-rules.md` §5:**plan 層審查上限 2 輪**。R1→R2 收斂明顯(14 must-fix → 4 INADEQUATE + 2 新,且 11 條經獨立確認 HOLDS),且 R2 全部 findings 皆為**具體可修的技術缺陷、非方向問題** ⇒ 依規則折入後收工,不開 R3(RF1 那片的 R3 是 Sean 特別授權的破例,不可自行比照)。

🔴 **誠實邊界**:v3 的修法**未經第三輪獨立審查**。其中 §6.5 兩-trigger 配置與 §7 的 `aclexplode`/`attacl` 斷言是本輪新寫、**尚未被任何審查者看過** —— 這兩處的正確性將由 §9.1-11 的負向測試與 §9.2 M10/M12 突變在**實作階段**驗證,而非現在宣稱已正確。

---

## 15. Supabase preview branch 實測紀錄(2026-07-25、branch `acfzyhavudpnyyaejyeb`、用畢已刪)

### 15.1 環境誠實邊界(重要)

- 🔴 **branch 自動套用 main migration 歷史時 `MIGRATIONS_FAILED`**,停在 `20260712142722`(下一支 `20260712183000` 起失敗)。
  **非本片造成**(我的兩支是 `20260725130000/130100`、離該點 30+ 支)。⇒ 本次實測的 schema **落後 production 24 支 migration**。
  已確認我的兩支所需前置在 branch 上齊備(`orders` / `order_items` / `payment_status` 4 值 / `order_items` PK 單欄 id),故結論在「本片兩支 migration 的行為」範圍內成立;
  **不可據此宣稱「已在等同 production 的環境驗過」**。該既有失敗值得另立 backlog 追(本片不處理)。
- 套用方式 = MCP `execute_sql` 分段送**可執行語句**(檔頭大段註解不送,對齊 RF2a-0 慣例);
  `BEGIN/COMMIT` 未重複送(MCP 自帶交易 —— 且實測確認:一批語句中途失敗會整批 rollback)。
  ⇒ **檔案內的顯式 `BEGIN/COMMIT` 本次未被直接執行驗證**,它的作用對象是 `supabase db push`。

### 15.2 🔴 第一批負向測試無效(遮蔽)——過程誠實紀錄

首輪把 11 條負向測試包進單一 `DO` block、以 `SET CONSTRAINTS ALL IMMEDIATE` 逐條捕捉,結果 **11 條全 RED**。
**但那個「全紅」是假的**:逐條看錯誤訊息,T3/T6/T7/T8/T11 全部回報「**沒有任何品項明細**」——
IMMEDIATE 模式下 INSERT header 當下 trigger 就炸了,**後面的明細 INSERT 根本沒執行**,
於是這 5 條測的都是同一條防線(空明細),而非它們各自宣稱的目標。

⇒ 全部改為**各自獨立交易、DEFERRED 預設模式**重測,且**每條只違反一項**(避免 OR 條件互相遮蔽):

| 重測 | 手法 | 實際結果 |
| --- | --- | --- |
| 跨單串接 | order A 的 header 掛 order B 的品項 | `23503` **複合 FK** 擋下,訊息逐字指出 `(order_id, order_item_id)` 組合不存在 |
| 單次超量 | 單價用原始值、sum 一致,**只**讓 quantity 2 > 原始 1 | `P0001` line 42(第 ③ 段) |
| 捏造單價 | quantity 合法,**只**讓 unit_price 1 ≠ 原始 3000 | `P0001` line 42 —— 與上一條走同一個 `OR`,**分開測才證明兩半都有效** |
| header/明細不符 | 明細完全合法,**只**讓 header `items_amount` 100 ≠ 明細 2500 | `P0001` line 32,訊息含實際數字 |
| 刪明細失衡 | 刪掉唯一一列明細 | `P0001` line 28 —— **證明子表 trigger 的 `OR DELETE` 有效**(v2 漏列、R2 抓到) |

> **可複用教訓**:`SET CONSTRAINTS ALL IMMEDIATE` 會讓「先 header 後明細」的合法流程提前失敗,
> 因此**不能**用它來測那些需要明細就位才成立的不變式 —— 會把所有測試都遮蔽成同一條。
> 反過來說,這也順帶證明了 `DEFERRABLE INITIALLY DEFERRED` 不是裝飾:正向三組在 IMMEDIATE 下必然失敗。

### 15.3 通過項目(實跑輸出)

- **enum**:5 值、`partiallyRefunded` `enumsortorder = 5`。
- **新值可用性**(交易模擬做不到的那段):`UPDATE orders SET payment_status='partiallyRefunded'` 成功。
- **正向 3 組全數插入成功**:Sean 範例(items 3000 / before 0 / after 100 / delta 100 → **refund 2900**)、
  全退回退運費(delta **−100** → refund 1100)、delta 0 → refund 2500。
  ⇒ 守恆 CHECK **不會誤擋合法案例**(v1 只有負向測試、無法排除「CHECK 寫反」)。
- **負向**:金額不符公式 / 重複 `bank_refund_id` / 21 字元 / `confirmed` 但 `confirmed_at` NULL 全數 `check_violation` 或 `unique_violation`。
- **狀態轉移**:`processing → confirmed` 成功;`confirmed → failed` 被 `P0001` 擋下(終態不可轉出)。
- **ACL 以 `SET LOCAL ROLE service_role` 實測**:INSERT / UPDATE / DELETE 三者皆 **42501**,SELECT 正常 ⇒ 寫入確實只能走 SECURITY DEFINER RPC。
- **fail-closed 斷言**(當時 7 段:client 7 權限 / service_role 應有 / 應無 / `role_table_grants` / `relacl` / `attacl` / RLS + trigger 存在)套用時全數通過。
  ⚠️ **字面更正(codex 關卡2 R2 nit)**:關卡2 折入後**增為 9 段** —— 新增 **7i**(TRUNCATE 攔截 trigger 兩支皆在)與 **7j**(三支 trigger 函式的 EXECUTE 零外授)。本節描述的是**§15 當時**那一輪的狀態,最終交付物以 migration 檔為準。

### 15.4 🔴 兩條「揭示成立」的反面實證(不是嘴上說說)

1. **欄級 grant 只有 `attacl` 段抓得到**。對單欄下 `GRANT SELECT (reason) ... TO anon` 後三段偵測:
   `attacl` = **1 筆(抓到)** / `role_table_grants` = **0 筆(看不到)** / `relacl` = **0 筆(看不到)**。
   ⇒ codex R2 判 v2 的 `role_table_grants` 版本 INADEQUATE **經實測成立**;若照 v2 寫,此欄級洩漏會安靜通過全部斷言。
   (探針以 `RAISE` 結尾 ⇒ 交易 abort、GRANT 未留下。)
2. **跨次累積超退確實不擋**。品項原始數量 1、已退 1,再用**另一個** `bank_refund_id` 退 1 → **INSERT 成功**,
   查得 `original_qty=1 / refunded_qty_total=2 / over_refunded=true`。
   ⇒ §6.6 的揭示屬實、非形式免責。**RF2b 落地前不得宣稱帳本已防超退。**

---

## 16. codex 關卡2(diff 層)R1 折入紀錄(2026-07-25、`-s read-only`、審 commit `91d6642`)

🔴 **流程違反自陳**:鐵則 12 要求高風險片「**commit 前**」跑關卡2,本片是 commit 後才補跑。
已於下方修完並另開 commit(不 amend —— 並行 session 期間 amend 有改到別人 commit 的風險)。

**判定 = NO-GO,6 must-fix + 3 nit。逐條核對後:5 條成立、1 條駁回。**

| finding | 處置 |
| --- | --- |
| 子列 UPDATE 換 `refund_id` 只驗 NEW header,舊 header 不再驗 | ✅ **成立、已修**:函式改為 `TG_OP='UPDATE'` 時取 `ARRAY[OLD.refund_id, NEW.refund_id]` 並 `FOREACH` 迴圈驗。**已實測**(下方 16.1) |
| row-level trigger 對 `TRUNCATE` 完全不觸發 | ✅ **成立、已修**:兩表各加 `BEFORE TRUNCATE ... FOR EACH STATEMENT` 攔截 + 斷言 7i。**已實測** |
| 兩支 SECURITY DEFINER 函式保有預設 `PUBLIC EXECUTE` | ✅ **成立、已修**:三支函式全 `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` + 新斷言 7j(`pg_proc.proacl` 逐條驗無 owner 以外 grantee) |
| 對 live `order_items` 加 UNIQUE 前無 `lock_timeout` | ✅ **成立、已修**:`SET LOCAL lock_timeout = '5s'`,等不到即整支回滾、改挑離峰重跑 |
| plan §10.7 驗收條件與 §15 自相矛盾 | ✅ **成立、已修**:§10.7 改為「只宣稱 preview branch 實測」,`BEGIN/COMMIT` 定位為**已寫入、未驗證**(作用對象是 `db push`) |
| `confirmed` 列仍可帶非空 `failed_reason` | ❌ **駁回(實測)**:CHECK `(status='failed') = (failed_reason 非空)` 在該情境為 `false = true` → **不通過**。production 唯讀純表達式求值實證:`confirmed + 失敗原因 → false`(擋下)、`failed + 原因 → true`、`confirmed + NULL → true`。該情境早已被擋 |
| `ON DELETE RESTRICT` 因果不精確(nit) | ✅ 已修註解:實際第一個擋點通常是 `order_refunds.order_id → orders(id)` 的預設 NO ACTION,非 cascade 後的 child RESTRICT |
| §15 無保存 SQL/result transcript(nit) | ⚠️ **接受、不補**:branch 已刪、無法回溯補。已在此明記此限制;日後同類驗證應保留逐條輸出 |
| 測試數字無 committed runner output(nit) | ⚠️ **接受**:repo 既有慣例即如此(數字寫進 commit body 供人工複跑);不為本片單獨改變慣例 |

### 16.1 修正後重驗(preview branch `cjmkbdctedddyvcfxpuz`,用畢已刪)

兩支 migration 全段重新套用成功,**含新增的 7i / 7j 斷言**。針對兩個新修的洞做**精確重現**測試:

1. **UPDATE 換 `refund_id`**:把 refund A 的唯一明細改掛到 B,**同時**把 B 的 `items_amount` 調成 5500(= 2500+3000)
   ⇒ **B 側完全合法、無任何違反**,唯一問題是 A 變零明細。
   結果:`P0001` 且訊息**指名 A**(`fa000000…`)⇒ 證明 `OLD.refund_id` 確實被驗到。
   🔴 舊版(只取 `NEW`)在此案例只會驗 B、直接放行 —— 這條測試設計成「只有 A 違反」才殺得死該 bug。
2. **`TRUNCATE order_refund_items`**:被 `pcm_refund_ledger_block_truncate` 擋下(`P0001`)。

⚠️ 誠實邊界同 §15.1:branch schema 仍落後 production 24 支(既有 `MIGRATIONS_FAILED`,非本片);
檔內顯式 `BEGIN/COMMIT` 依然**未被直接執行驗證**(MCP 自帶交易)。

---

## 17. codex 關卡2 R2 確認輪(2026-07-25、`-s read-only`、審 `7faf004` + `a10b12a`)

**判定 = GO,0 surviving must-fix。** R2 的任務是驗證 R1 的修法是否真的成立(非找新問題)。

| R1 finding | R2 判定 |
| --- | --- |
| UPDATE 換 `refund_id` | **HOLDS** — `OLD/NEW` 都逐一查 header,`CONTINUE WHEN NOT FOUND` 緊接 `SELECT INTO`,不會跳過仍存在的 A/B 或驗到 NULL |
| TRUNCATE | **HOLDS** — `BEFORE TRUNCATE` 擋直接與 `CASCADE` 截斷;一般 owner 也會觸發,僅**刻意 disable trigger 的 owner／superuser** 可繞過;函式維持 SECURITY INVOKER 正確 |
| 函式 EXECUTE 收斂 | **HOLDS** — REVOKE 後 ACL 為非空 owner-only;撤 EXECUTE **不會**阻斷 trigger 執行 |
| `lock_timeout` | **HOLDS** — 顯式 `BEGIN` 內的 `SET LOCAL` 覆蓋其後全部 DDL 至 `COMMIT`;逾時中止交易、回滾整檔 |
| `confirmed` + `failed_reason`(我方駁回) | **HOLDS** — `(false = true)` 為 false、CHECK 確實拒絕 ⇒ **駁回成立** |
| 交易模擬字面 | **HOLDS** — 文件已只宣稱 preview 實測,並明示檔內 `BEGIN/COMMIT` 尚未直接驗證 |
| 全部誠實揭示 | **HOLDS** — 跨退款超退、運費未綁 orders、§5.2 非冪等、顯式交易未驗、preview 落後 24 支,均仍正確揭示 |

### 17.1 R2 的 2 個 nit(已順手清)

1. 🔴 **7j 斷言把 `proacl IS NULL` 當安全**——PostgreSQL 中 `proacl IS NULL` 代表「沿用預設權限」,
   而函式預設就是 **PUBLIC 有 EXECUTE** ⇒ 「函式被 DROP+CREATE 卻沒補 REVOKE」會靜默放行。
   → 改用 `has_function_privilege` 直接問四個角色能否執行,NULL 情況自然涵蓋。
   **production 實證判準可用**:已 REVOKE 的 `admin_adjust_wallet` / `admin_set_customer_tier` / `create_order`
   三支皆 `proacl IS NULL = false` 且 `has_function_privilege('public',…) = false`。
   ⚠️ **誠實邊界**:7j 的**改版本身未經 preview branch 重跑**(僅其判準經 production 唯讀實證);
   apply 當下若 REVOKE 成功則四項皆 false、斷言通過,行為與改版前一致。
2. plan §15.3 仍寫「斷言 7 段」,關卡2 折入後實為 **9 段**(新增 7i/7j)→ 已標註為「§15 當時狀態」並指向 migration 檔為準。
