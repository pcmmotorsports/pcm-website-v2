# Plan · 匯款單逾期自動取消後,員工補登記收款(稽核 P0-2 · Sean 拍乙)

> 狀態:**plan R3 版,未實作、未寫 migration、未 commit**。碰錢 ⇒ 鐵則 8 + 12。
> 寫的人:施工窗(`~/pcm-admin-ui`,agent/adminui-1),2026-09-15。
> 來源:`~/pcm-mailbox/稽核-ecommerce-cia-20260915.md` P0-2;主視窗 `pcm-website-v2-b7` 派工。
> ⚠️ 實作 TS 片時更正:plan 原寫的 P2B45–P2B48 已被手動退款 `20260830050000` 佔用 ⇒ 全文改用 **P2B51–P2B54**(對應不變)。
> 審查:R1 `~/pcm-mailbox/codex-P02-plan-R1-final.md` FAIL · R2 `~/pcm-mailbox/codex-P02-plan-R2-final.md` FAIL(R1 ②–⑥ 判已修)。
> **Sean 拍:照 R2 再改一次,主視窗逐條核後直接端 Sean 批,不跑 R3;實作 diff 再過 codex。** 對照表 §12。

## 0. 已拍的字

- **Sean 2026-09-15 11:0x「q1: 乙」**:「登記 RPC 允許已逾期取消單入帳;匯款日在期限內 ⇒ 復活訂單;期限後 ⇒ 入帳並自動開待退款。」
- **Sean Q2 = 乙**,逐字「乙 = 不救回來, 錢入帳 + 排退款, 員工再決定」:逾期取消後客人已另下新單 ⇒ 不復活,走期限後那條。
- **Sean Q3 = 甲**,逐字「所有在職員工, 跟現在登記收款一樣, 系統會記是誰做的」:不加管理者閘。
- **Sean 範圍縮小(R2 後)**,逐字「甲 = 先不做, 這次只做匯款單。現金單逾期被取消, 系統擋下來, 請管理者人工處理」:
  補登放行**只收 bank_transfer**;現金逾期取消照舊拒、改具體訊息;**R1 版加的「實際收款時間」欄整段刪掉,現金表單不動**。
- **主視窗裁(技術題)**:Q1 甲(新 helper、不動排程、驗證腳本拿排程真跑逐格比界)· Q4 甲(已有待退款再來第二筆 ⇒ 拒)· 自動處理只收乾淨單 · G8 內容衝突不換鍵 · 新單判準與建單共用客人層級 advisory lock · 新單的界不用 `cancelled_at`。

🔴 **這一拍推翻一條舊拍板**:`20260809160000_m4b_lifecycle_l3a_expire_unpaid_orders_fn.sql:6` 逐字「Q2=A 不復活」。migration 檔頭寫明「09-15 乙取代 08-09 Q2=A,只限匯款單補登記收款、只限乾淨單」。

## 1. 現況(每一格都開檔核過)

| 事實 | 座標 |
|---|---|
| 登記 RPC 最新代 | `20260812150000_m4b_e10_423_payment_audit.sql:74`(`latest-definition-of.sh`:2 代,newest = live) |
| G5 只讀四欄、`orders FOR UPDATE` | 同檔 `:177-181` |
| 已取消就拒(通用訊息) | 同檔 `:191-193` |
| 退款態拒 P2B41 | 同檔 `:200-206` |
| G8 同鍵不同內容 ⇒ 通用訊息;重放只回三鍵 | 同檔 `:243-280`(內容衝突 `:279`、重放回傳 `:276-277`);並發 backstop `:339-341` 也回通用訊息 |
| 冪等唯一鍵是 `(order_id, request_id)` | `20260810100000_m4b_e10_op1_order_payments_m.sql:381` |
| 逾期取消最新代 | `20260906600000_m4b_expire_day_boundary.sql:175`(4 代,newest = live) |
| 逾期取消寫的值 | 同檔 `:310-311` `cancelled_at = now(), cancelled_reason = 'payment_expired'` |
| 期限算法(匯款) | 同檔 `:262-273` |
| 逾期取消其他條件 | 同檔 `:198-199`、`:281-285`、`:298-302` |
| 員工打不出 `payment_expired` | `20260903093000_m4b_b4cancelkind_reject_reserved_reason.sql` 檔頭 |
| 逾期取消不寄取消信 | `20260915210000_m4b_unpaid_cancel_cutoff_by_cancelled_at.sql` 檔頭②(板 177 已貼) |
| 錢落已取消單 ⇒ 按軌開待退款 | `order_payments` AFTER INSERT ⇒ `pcm_noncard_settle_recompute`(最新代 `20260905290000:227`)⇒ `pcm_pending_refund_open_for(order, false)`(`20260905070000:121`;每軌寫入 `:235-245`;唯一鍵 `(order_id, rail)`) |
| 重算把開列失敗吞成 incident;verdict 非 settled/underpaid 就不翻狀態 | `20260905290000` recompute(開列 EXCEPTION 區塊;`:379-402` settled⇒paid、underpaid 且已收 >0 ⇒ partiallyPaid、其餘 RETURN 不翻) |
| 結算器最新代與 verdict 值域 | `20260907170000_m4b_settlement_split_from_zero_total.sql:86`;P2 `:224-227`;品項 P3 `:228`;退款來源 `:258` 附近;verdict = `settled` / `underpaid` / `overpaid` / `needs_human`(`:290-293`) |
| 取消 trigger 非 NULL→NULL 直接 RETURN | `20260910210000_m4b_coupon_revert_wiring.sql:230` |
| 兌券一張單最多一列(含已退回) | `20260829150000_m4b_coupon_p1_tables.sql:182`、`reverted_at :164` |
| 付款信 = `email_outbox.event_type = 'order_created'`(LINE 也用它,R2 核 `sweep-email-outbox.ts:560`) | `20260907230000_m4b_pending_views_allow_recipient_stale.sql`;view 有「可重排」例外清單(R2 核 `:96`) |
| 每張單都有客人帳號 | `20260604120000:95` `customer_user_id uuid NOT NULL`;手動建單 NULL 就 RAISE(`20260910090000:309-310`) |
| **會建出 orders 列的函式只有兩支** | `grep 'INSERT INTO public.orders ('` 所有 migration ⇒ 只落在 `create_order` 與 `admin_create_manual_order` 的各代;10 參數多載已刪(`20260913090000:141`) |
| 前台建單拿客人層級 advisory lock | `create_order` 最新代 `20260915100000:121`,`:262` `pg_advisory_xact_lock(hashtextextended(v_uid::text, 0))`;之後只有不上鎖的 `PERFORM 1 FROM orders`,沒有鎖任何既有訂單列 |
| **後台手動建單沒有任何鎖** | `admin_create_manual_order` 最新代 `20260915170000:55`(12 代);檔內無 `advisory` / `FOR UPDATE`;`INSERT INTO public.orders` 在 `:779` |
| 刷卡開始付款的鎖序 = 訂單列 → 客人鎖 | `begin_charge_attempt` 最新代 `20260904050000:65`:`orders FOR UPDATE`(`:~90`)⇒ 已取消就拒 ⇒ 非 tappay 單 RETURN ⇒ 才 `pg_advisory_xact_lock(hashtextextended(customer_user_id::text, 0))`(`:~118`) |
| 表單「失敗沿用同一把鍵」是硬條款;「開始下一筆」只在 `error` / `rejected` 出現 | `payment-form.ts:338` 起;`payment-record-form.tsx:64-75` `RAIL_SWITCH_ALLOWED_CODES = {'error','rejected'}` |
| 後台收款表單在已取消單上照樣顯示 | `order-detail-money-tab.tsx:375` |
| 客服稿 Q4 | `docs/runbooks/bank-transfer-flag-flip-checklist.md:604-609` |

## 2. 改什麼(總覽)

**DB(一支 migration + rollback + 驗證腳本)**
1. **新一代 `admin_record_manual_payment`**(抄 `20260812150000:74-342`):
   - **G5** 多讀 `cancelled_reason`、`payment_channel`、`customer_user_id`。
   - **G8 搬到 G5 之後、G6 之前**;內容衝突改具體碼 P2B53、並發 backstop 同碼(§7.2)。
   - **G6** 分流樹(§3);B 分支拿客人層級 advisory lock(§7.1)。
   - 復活 UPDATE、事後結算判定、事後驗待退款列、多一列稽核、回傳多三鍵(§5、§6)。
   - 簽章不變 ⇒ owner / ACL 保留;`SECURITY DEFINER` 與 `SET search_path = ''` 逐字寫回,事後閘比 `prosecdef`、`proconfig`、owner、proacl 改前改後一致。
2. **新一代 `admin_create_manual_order`**(抄 `20260915170000:55` 起的本體):只在 `p_customer_user_id` 驗過之後、`INSERT INTO public.orders`(`:779`)之前加一行
   `PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer_user_id::text, 0));`
   —— key 與 `create_order:262`、`begin_charge_attempt` 逐字同一個算法。其餘一字不動。簽章不變;事後閘同上。
3. **新 helper** `public.pcm_bank_transfer_due_at(p_created_at timestamptz) RETURNS timestamptz`:`LANGUAGE sql STABLE`(時區名查表,不是 IMMUTABLE)、`SECURITY INVOKER`、`SET search_path = ''`、owner `postgres`、`REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`。事後閘驗 owner 與 proacl 只剩 owner。只收匯款,不帶 channel 參數(Sean 範圍縮小後沒有第二種)。
4. `supabase/rollbacks/<版本>-rollback.sql`、`scripts/<版本>-verify.sh`(形狀照 `scripts/20260913070000-verify.sh`)。
5. `scripts/cancelled-at-writers-lock-gate.test.ts` 登記新寫入端(它只證有鎖字面;鎖序靠 §10 並發格)。

**TS**
6. `payment-repository.ts` 讀新回傳鍵,**缺鍵一律當 false**(舊 RPC 相容)。
7. `payment-action-state.ts` 加碼:P2B51 / P2B52 / P2B53 / P2B54;**P2B53 不進 `RAIL_SWITCH_ALLOWED_CODES`**(§7.2)。
8. `payment-actions.ts` 成功訊息分三種(一般 / 已復活 / 已入帳並開待退款,後者帶「客人已另下新單」原因)。

❌ 不改:現金表單與現金收款時點、逾期取消排程、天數、日界、tappay、表結構、任何 view、付款信流程、券流程、`create_order`。

## 3. 分流樹(G6)

在 G5 `orders FOR UPDATE` 與 G8 冪等查詢之後。

```text
A. cancelled_at IS NULL                                   ⇒ 照舊(一般收款,含 P2B41)
B. cancelled_at 非空,且【逾期自動取消的匯款單】四條全成立:
     cancelled_reason = 'payment_expired'
     payment_status   = 'unpaid'
     payment_channel  = 'bank_transfer'
     p_rail           = 'bank_transfer'
   ── 先拿客人層級 advisory lock(§7.1),再判下面 ──
   B1. 不是乾淨單(§3.1)                                  ⇒ P2B51「這張單有歷史紀錄,請管理者人工處理」
   B2. 乾淨 且 p_received_at < due_at 且 沒有新單(§3.2)  ⇒ 復活(§5)
   B3. 乾淨 且(p_received_at >= due_at 或 有新單)        ⇒ 入帳 + 開待退款(§6)
C. cancelled_reason = 'payment_expired' 且(payment_channel = 'cash' 或 p_rail = 'cash')
                                                          ⇒ P2B54「現金單逾期取消後補登請管理者人工處理」
D. 其他已取消(員工手動取消 / superseded_by_card …)      ⇒ P2B52「這張單不是逾期自動取消的,不能補登記收款」
```

- C / D / B1 用**具體訊息**,理由同 `:195-197`:呼叫者已過 actor 閘、是後台員工,本來就看得到訂單狀態。
- C 同時涵蓋「匯款單卻用現金補登」:Sean 的範圍是「只做匯款單」,現金那一軌一律人工。
- `superseded_by_card` 走 D:客人已刷卡付過,再來的匯款是多付。

### 3.1 乾淨單 = 下面每一條都成立

| # | 條件(SQL) | 為什麼 |
|---|---|---|
| c1 | `NOT EXISTS (SELECT 1 FROM public.order_payments p WHERE p.order_id = o.id)` —— 任何一列,含沖銷列與被沖列 | 從沒登過錢;保證 §6 只會開 `bank_transfer` 一軌 |
| c2 | `NOT EXISTS (… public.order_cancellations c WHERE c.order_id = o.id)` 且 `NOT EXISTS (… public.order_cancellation_items ci WHERE ci.order_id = o.id)` | 部分取消過 ⇒ 結算 P2 永遠 false、剩餘應收重算沒接收款 INSERT(`20260914070000:222、385`) |
| c3 | `NOT EXISTS (… public.coupon_redemptions r WHERE r.order_id = o.id)` —— 含 `reverted_at` 非空 | 再兌會撞 `UNIQUE (order_id)` |
| c4 | `NOT EXISTS (… public.order_pending_refunds pr WHERE pr.order_id = o.id)` —— 含作廢 / 結清 | 錢曾經在這張單上動過 |
| c5 | `NOT EXISTS (… public.order_manual_refunds mr WHERE mr.order_id = o.id)`(欄位核過 `20260820010000:154`) | 同上,防守一格 |
| c6 | `NOT EXISTS (… public.email_outbox e WHERE e.order_id = o.id AND e.event_type = 'order_created')` —— 不論 status | 付款信 view 對既有列**大多**不重排(`skipped_order_ineligible` 不可翻轉;另有少數可重排的錯誤碼例外,R2 核 view `:96`)。**保守起見有任何一列就不自動處理**,不去逐碼判哪些會重排。只看 `order_created`:匯款單建單時就有的 `bank_order_created`(匯款資訊信)不擋 |
| c7 | `NOT EXISTS (… public.payment_charge_attempts a WHERE a.order_id = o.id AND a.status <> 'failed')` | 與逾期取消 `:281-285` 同條件 |

⚠️ 乾淨條件**不保證結算一定判得出來**(品項快照、改價、運費、稅額、退款來源都是結算器另外看的,R2 S1)⇒ B2 另加事後判定(§5.2),不靠 c1–c7 證明。

### 3.2 「客人已另下新單」怎麼認(Sean Q2 乙)

```sql
EXISTS (
  SELECT 1 FROM public.orders n
   WHERE n.customer_user_id = v_order.customer_user_id
     AND n.id <> v_order.id
     AND n.created_at >= v_due_at          -- 🔴 界 = 期限, 不是舊單的 cancelled_at
     AND n.cancelled_at IS NULL
)
```

**為什麼界用 `due_at`**(R2 M4):
- 排程每小時跑一次,`cancelled_at` 會比 `due_at` 晚 0–59 分鐘。用 `cancelled_at` 當界 ⇒ 客人在 00:10 重下、排程 01:00 才取消舊單 ⇒ 新單被當成「取消前就有」而漏認 ⇒ 舊單錯誤復活。不需要並發就會發生。
- 對客人來說,舊單在 `due_at` 那一刻就死了:畫面上寫的是「請於 X 日(含)之前完成匯款,逾期訂單將自動取消」(`packages/domain/src/order/remittance-info.ts:153`;`20260906600000:233` 引的是舊行號 `:127`)。過了那一刻才下的單 = 取代舊單。
- `due_at` 之前就下的另一張單 = 舊單還活著時的**另一筆購買**,不是取代 ⇒ 不算新單。
- `due_at` 由訂單自己的 `created_at` 算出,不受排程何時跑到影響。

其他:
- 看 `customer_user_id`(`NOT NULL`)⇒ **系統裡沒有訪客單**,不用另外處理 NULL。
- 不看 `cart_session_id`:刷卡失敗後 cart 不換、員工手動單可能不同 cart ⇒ 會漏認。
- 新單不論付款狀態、管道、是前台或員工建的都算。
- ⚠️ 天花板:若店裡有「門市散客共用一個客人帳號」,別人的單會讓這張走退款 ⇒ 方向安全(錢入帳 + 待退款,員工再決定)。
- 這個 EXISTS **必須在拿到客人鎖之後才跑**(§7.1),否則看不到正在建立的新單。
- 回傳 `new_order_exists`。

## 4. 期限

```text
due_at = pcm_bank_transfer_due_at(orders.created_at)
       = pg_catalog.timezone('Asia/Taipei',
           pg_catalog.date_trunc('day', pg_catalog.timezone('Asia/Taipei', p_created_at))
           + interval '5 days' + interval '1 day')

p_received_at <  due_at ⇒ 期限內
p_received_at >= due_at ⇒ 期限後(界上算逾期,與排程 `now() >= …` 同向)
```

- 本體逐字取自 `20260906600000:264-272` 的 `bank_transfer` 分支,只把 `o.created_at` 換成參數。
- 匯款軌 `p_received_at` = 台北入帳日 00:00(`payment-form.ts:284`,既有收款日欄位,不改)⇒ 第 5 天入帳 < 第 6 天 00:00 ⇒ 期限內;第 6 天 = due_at ⇒ 期限後。
- **同算法保證(Q1 甲)**:驗證腳本 4 個下單時刻(00:00 / 00:01 / 12:00 / 23:59)× `now()` 推到 `due_at - 1 秒` 與 `due_at`,真跑排程看取消與否,再問 helper,逐格一致。
- ⚠️ 信任邊界:`p_received_at` 是員工填的收款日,DB 核不了銀行入帳日;填早一天就能把期限後變期限內。本片不新增防線(R2 同意不是加管理者閘的理由),稽核列記 `received_at`、`due_at`,既有稽核有 actor 與登錄時間 ⇒ 可追責,不能證明入帳日。

## 5. B2 期限內 ⇒ 復活

### 5.1 動作(同一個交易、順序固定)

```sql
-- ① 復活(先)
UPDATE public.orders
   SET cancelled_at = NULL, cancelled_reason = NULL, updated_at = pg_catalog.now()
 WHERE id = v_order.id AND cancelled_reason = 'payment_expired';
-- ROW_COUNT 必須恰 1, 否則 RAISE
-- ② INSERT 收款(後)⇒ 既有 AFTER INSERT 鏈重算狀態
```

對調的話重算會看到「還是取消的」⇒ 開待退款、不翻狀態(§10 突變格證)。

### 5.2 事後結算判定(R2 S1)

INSERT 之後在同一個交易裡:

```sql
v_verdict := public.admin_compute_order_settlement(v_order.id) ->> 'verdict';
SELECT payment_status INTO v_after FROM public.orders WHERE id = v_order.id;
```

| verdict | 期望 `payment_status` | 不符 |
|---|---|---|
| `settled` | `paid` | RAISE 整筆回滾 |
| `underpaid` | `partiallyPaid`(c1 保證已收 = `p_amount` > 0) | RAISE |
| `overpaid` | `unpaid`(Sean 09-05 拍乙多匯不翻狀態只標字) | RAISE |
| `needs_human` 或 NULL | —— | RAISE |

- RAISE 用 P2B51 同一句「這張單有歷史紀錄,請管理者人工處理」,並把 verdict 帶進 DETAIL。
- 為什麼要驗 status 不只驗 verdict:重算把例外吞掉時,verdict 可能是 `settled` 而狀態仍是 `unpaid` ⇒ 不驗會回「復活成功」而單其實卡著。
- 回滾的結果 = 單維持逾期取消、收款沒入帳 ⇒ 員工看到具體訊息,轉管理者人工。**不會留下半套。**

### 5.3 乾淨單不用另外還原的東西

| 東西 | 理由 |
|---|---|
| `cancelled_at` / `cancelled_reason` | 兩欄都清(P2 兩欄都看) |
| 待退款 / 手動退款 | c4 / c5:從來沒有 |
| 券 | c3:從來沒兌過 ⇒ 取消時退券零寫入;翻 paid 時第一次兌 |
| 付款信 | c6:從來沒有付款信列 ⇒ 翻 paid 後 view 挑得到 |
| 取消信 | 逾期取消不寄 |
| 部分取消 | c2:從來沒有 |
| 庫存 / 採購 | 逾期取消不碰庫存(`20260906600000:361`);採購清單讀當下值 |
| 客人訂單頁 | `order-cancel-reason.ts:32` 看 `payment_expired`,清掉後回一般狀態 |
| 「付款信在取消之後」告警 | `20260915200000:89-93` 要求 `cancelled_at IS NOT NULL` ⇒ 不誤報 |
| 發票旗標 trigger | R1/R2 核:只看 `invoice_requested` 翻轉,清取消欄不命中 |

- 復活後已收淨額 > 0 ⇒ 排程淨額腿排除它。之後被沖銷回 0 ⇒ 下一個整點排程會再取消它 ⇒ 那時已不乾淨(c1),再補登走 B1。
- 券在這段期間被別人用完 ⇒ 兌換失敗照放行,既有行為(稽核檔 P1-5),本片不改。

### 5.4 稽核與回傳

- 多一列 `admin_audit_log`:`action = 'order.revive_expired'`、`target = 'order:<order_id>'`、`request_id = p_request_id`、`before = {cancelled_at, cancelled_reason}`、`after = {cancelled_at: null, payment_id, received_at, due_at, verdict}`,筆數守恰 1。
- 一般 `payment.record` 那列 `after` 加 `expiry_disposition: 'revived'`、`due_at`。
- 回傳 `{recorded, idempotent: false, payment_id, revived: true, refund_opened: false, new_order_exists: false}`。

## 6. B3 期限後(或有新單)⇒ 入帳 + 開待退款

- 單維持取消,直接 INSERT;既有 AFTER INSERT 鏈開待退款(不新增開列的碼)。狀態不翻(P2 false)。
- 🔴 INSERT 之後驗**完整列集合**,不成立 ⇒ RAISE 整筆回滾:
  ```sql
  (SELECT count(*) FROM public.order_pending_refunds WHERE order_id = v_order.id) = 1
  AND EXISTS (SELECT 1 FROM public.order_pending_refunds
               WHERE order_id = v_order.id AND rail = 'bank_transfer'
                 AND amount_at_cancel = p_amount
                 AND voided_at IS NULL AND settled_at IS NULL)
  ```
  「恰 1 列」只在乾淨單上是不變量(c1 + c4 保證開之前 0 列、只有一軌)。
- Q4 甲:第二筆來時 c1 已不成立 ⇒ 走 B1 拒。
- 稽核:`payment.record` 那列 `after` 加 `expiry_disposition: 'refund_opened'`、`due_at`、`new_order_exists`。
- 回傳 `{recorded, idempotent: false, payment_id, revived: false, refund_opened: true, new_order_exists}`。
- 客人不會收到信(狀態沒翻);退款真的出去時走既有退款信。

## 7. 並發與冪等

### 7.1 客人層級 advisory lock(R2 M3)

**key**:`pg_catalog.hashtextextended(customer_user_id::text, 0)`,與 `create_order:262`、`begin_charge_attempt`(`20260904050000:~118`)逐字同一個。

**誰拿**:
| 路徑 | 拿鎖時機 | 之後會鎖別的訂單列嗎 |
|---|---|---|
| 前台 `create_order` | 驗完身分、INSERT 之前(既有,`:262`) | 不會(只有不上鎖的 `PERFORM 1 FROM orders`) |
| 後台 `admin_create_manual_order` | **本片新增**:驗完 `p_customer_user_id`、INSERT(`:779`)之前 | 不會 |
| `begin_charge_attempt` | 先 `orders FOR UPDATE` 自己那張 ⇒ 才拿客人鎖(既有) | 會 UPDATE 同 cart 的活匯款單(supersede),只挑 `cancelled_at IS NULL` |
| **補登 RPC(本片)** | G5 `orders FOR UPDATE` 舊單 ⇒ **只在 B 分支**拿客人鎖 ⇒ 才判乾淨 / 新單 / 動作 | 不會 |

**鎖序:訂單列 → 客人鎖**,與 `begin_charge_attempt` 同向。會形成環的只有「先拿客人鎖、再等某張訂單列」的路徑:
- `create_order` / `admin_create_manual_order` 拿了客人鎖之後不鎖既有訂單列 ⇒ 不成環。
- `begin_charge_attempt` 拿了客人鎖之後 supersede 的 UPDATE 只挑未取消的匯款單;補登鎖住的是**已取消**的舊單(committed 值),UPDATE 的 WHERE 看不到它 ⇒ 不等它 ⇒ 不成環。⚠️ 這條是**推的**,§10 格 17 用兩連線實跑;若實測出 40P01,整筆回滾、員工同鍵重送即可(G8 前移後重送安全),並回頭調整鎖序。

**先後判準**:
- 建單先拿到鎖 ⇒ 補登在鎖上等 ⇒ 建單 commit ⇒ 補登拿到鎖後的 EXISTS 是新語句、READ COMMITTED 看得到新單 ⇒ 若 `created_at >= due_at` ⇒ B3。
- 補登先拿到鎖 ⇒ 建單在鎖上等 ⇒ 補登 commit(復活或開待退款)⇒ 建單照常建出。**這時舊單已復活而客人又多一張單**:那是客人在「補登已完成」之後才下的單,與 Q2 情境(客人以為舊單死了才重下)不同,本片不擋,員工從訂單列表看得到兩張。
- 只在 B 分支拿鎖:一般收款(A)不排隊,避免把每一筆收款都卡在同客人建單上。

**其他並發**:
| 情境 | 會怎樣 |
|---|---|
| 兩個員工同時登同一張乾淨逾期單(不同鍵) | G5 排隊。A 走 B2 ⇒ B 醒來單已復活 ⇒ 走一般收款 ⇒ 兩筆都入帳(既有邊界 `:240-242`);A 走 B3 ⇒ B 醒來單已不乾淨 ⇒ B1 拒 |
| 排程正在取消 vs 員工送出 | 排程 `FOR UPDATE SKIP LOCKED` 先拿到 ⇒ RPC 在 G5 等 ⇒ 排程 commit ⇒ RPC 醒來走 B |
| RPC 先拿到訂單列 | 排程跳過這張 ⇒ RPC 走 A ⇒ 已收 > 0 ⇒ 下一輪排除 |
| 隔離級 | G1 照舊 |

### 7.2 冪等(R2 M1、S2)

**G8 搬到 G5 之後、G6 之前。** 否則 B3 重送會先撞 B1(單已不乾淨)、待退款結清後重送會先撞 P2B41。
⚠️ 一般收款也會變:已登記的收款在單變退款態 / 取消之後原封重送,以前拒,之後回 `idempotent: true`。G8 在 INSERT 前返回,不會新增收款(R2 核同意)。

**同鍵不同內容 ⇒ 不換鍵(R2 M1)**:
- 現行 `:279` 回通用訊息 P0001 ⇒ TS 判 `rejected` ⇒ 畫面出「開始下一筆」讓員工換鍵(`payment-record-form.tsx:64-75`)。在補登情境:首送已復活入帳、回應斷線 ⇒ 員工改了收款日重送 ⇒ G8 拒 ⇒ 換鍵再送 ⇒ 單已復活走一般收款 ⇒ **一筆錢登兩次**。
- 改:`:279` 與 unique_violation backstop(`:339-341`)改 **P2B53**,訊息「送出的內容和同一次先前送出的不一樣,而先前那一次已經記進帳了。請看上方收款明細裡的那一筆:內容不對就先沖銷那一筆,再重新登記。不要改了內容再按送出。」(實作 TS 片時改字:原稿叫員工「重新整理頁面」,而重新整理會重鑄新鍵 = 改內容再送就是第二筆;失敗路徑本來就 revalidate,明細看得到那一筆。)
- TS:P2B53 對應新碼 `content_conflict`,**不加進 `RAIL_SWITCH_ALLOWED_CODES`** ⇒ 不出「開始下一筆」、保留原鍵。失敗路徑本來就 revalidate ⇒ 上方明細看得到已入帳那一筆;成功後才重鑄(既有生命週期規則,`payment-form.ts:338` 起)。
- 🔴 **DB 片注意(codex TS 片 R1)**:unique_violation backstop 改回 P2B53 之前,要確認撞到的是 `order_payments_request_id_uniq`(同單同鍵)—— 任意唯一性錯誤都講成「已經記進帳」會是假話;其他唯一鍵撞到照舊回通用訊息。
- 🔴 這也改到一般收款的同鍵衝突:以前能從「開始下一筆」換鍵,之後沒有這個出口,只能看明細、必要時沖銷再重登。G8 衝突的前提就是那把鍵已經有一筆 commit ⇒ 換鍵重送本來就是重複入帳的路,收掉是對的。

**重放回什麼(綁 payment_id,R2 S2)**:G8 找到 `v_existing.id` 之後:
- `revived` = `EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action = 'order.revive_expired' AND target = 'order:' || p_order_id::text AND request_id = p_request_id::text AND after->>'payment_id' = v_existing.id::text)`
- `refund_opened` / `new_order_exists` = `SELECT after->>'expiry_disposition' = 'refund_opened', after->>'new_order_exists' FROM public.admin_audit_log WHERE action = 'payment.record' AND target = 'payment:' || v_existing.id::text AND request_id = p_request_id::text`
- 缺列 ⇒ 三鍵皆 false(本片之前登記的收款沒有這些欄)。
- 重放稽核列(`payment.record.replay`)照舊寫。

## 8. 客服稿 Q4 要改的字

`docs/runbooks/bank-transfer-flag-flip-checklist.md:604-609`,換成:

> **Q4 客人問:我匯了,而單子被取消了怎麼辦?**
> 「您的款項不會消失。請告訴我們訂單編號和匯款帳號後五碼,我們登記後會通知您結果:
> 　 付款期限內匯的,訂單會恢復,並依實收金額確認付款狀態;超過期限才匯、或您已經另外重新下單的,我們會安排退款。」
> 🔵 安全:沒承諾「馬上」,也沒承諾「一定變已付款」(少付是部分付款、多付另外處理)。
> 🔬 依據:`<本片版本號>` —— 逾期自動取消、沒有其他收退款歷史的**匯款單**可補登記:期限內復活、期限後或已另下新單自動開待退款。
> 🛑 **下列情況客服不要照這句回,轉管理者人工**:現金單、員工手動取消的單、被刷卡取代的單、系統回「這張單有歷史紀錄」的單。
> 🛑 退款本身仍是人工 ⇒ 說「安排」不說「處理完成」。

舊的 🔬 依據那行(`20260901080000` 取消當下開待退款)只在取消前已登記才成立,改稿時刪掉。

## 9. 影響 / rollback

**影響**
- 錢路徑兩支 RPC 換代(收款、手動建單)⇒ 鐵則 12。
- 系統第一個 `cancelled_at` 非 NULL → NULL 的寫入端。
- 手動建單多一把客人鎖:同一個客人同時被前台建單 / 刷卡開始 / 補登佔住時,員工建單會等一下(交易都很短)。
- 員工面:逾期乾淨匯款單補登會成功;現金逾期單、其他取消單、不乾淨單看到具體原因;同鍵衝突不再出「開始下一筆」。
- 客人面:復活那條照一般流程收付款信;退款那條沒有信。

**rollback**
- `supabase/rollbacks/<版本>-rollback.sql`:
  - **前置閘**:線上 `admin_record_manual_payment` 與 `admin_create_manual_order` 的 prosrc md5 必須等於**本片目標**;不是 ⇒ 停(有人在本片之上又換過一代,盲目回滾會蓋掉它)。
  - `CREATE OR REPLACE` 兩支回 `20260812150000:74-342`、`20260915170000:55` 起的逐字本體(`SECURITY DEFINER` + `SET` 子句一起寫回);`DROP FUNCTION public.pcm_bank_transfer_due_at(timestamptz)`。
  - 事後閘:兩支 `prosecdef` / `proconfig` / owner / proacl 與回滾前一致。
- 🔴 **資料不回去**:已復活的單維持復活、已開的待退款維持開著(真收到的錢)。列出兩種受影響紀錄:
  ```sql
  SELECT action, target, after->>'expiry_disposition' AS disposition, created_at
    FROM public.admin_audit_log
   WHERE action = 'order.revive_expired'
      OR (action = 'payment.record' AND after ? 'expiry_disposition');
  ```
- ⚠️ **rollback 之後的重送**:B3 首送已成功、rollback 後員工原封重送 ⇒ 舊 RPC 在 G6 就因「已取消」回通用訊息(舊 G8 在 G6 之後)⇒ **那不代表沒入帳**。rollback 檔頭與 runbook 寫這一句;查上面那段 SQL 即可確認。
- **TS 相容**:新 TS 讀舊 RPC ⇒ 三鍵不存在當 false、走一般訊息;P2B51–54 舊 RPC 不會回,對應碼閒置無害。P2B53 在舊 RPC 下退回 P0001 ⇒ 回到今天的「開始下一筆」行為。

## 10. 驗收

### 10.1 拋棄式 PG(`scripts/<版本>-verify.sh`)

主視窗指定三格:
1. **期限內復活**:匯款單、**零筆收款歷史**、`created_at` 回填 6 天前 ⇒ 真跑 `pcm_cron.expire_unpaid_orders()` ⇒ 被取消 ⇒ 登記 `received_at = 第 5 天 00:00(台北)`、金額 = 應付 ⇒ 兩欄 NULL、`paid`、待退款 0 列、若有券則 `coupon_redemptions` 恰 1 列且 `reverted_at IS NULL`、`order.revive_expired` 稽核 1 列、`pcm_order_created_email_pending` 挑得到、回傳 `revived = true`。
2. **期限後開待退款**:同上但 `received_at = 第 6 天 00:00` ⇒ 單仍取消、`unpaid`、收款 1 列、待退款集合恰 {(bank_transfer, 金額, 活著)}、`refund_opened = true`。
3. **手動取消仍拒**:`admin_cancel_order` 取消的單 ⇒ P2B52、零寫入。

範圍與分流:
4. 現金 channel 逾期單用現金補登 ⇒ P2B54;匯款 channel 逾期單用現金補登 ⇒ P2B54;零寫入。
5. `superseded_by_card` ⇒ P2B52。
6. c1–c7 各造一張「只有這一條不乾淨」的逾期單 ⇒ P2B51、零寫入(c1 含收款 + 沖銷淨額 0;c3 含 `reverted_at` 非空;c4 含已作廢;c6 含 `skipped_order_ineligible` 與一個可重排錯誤碼各一)。負對照:只有 `bank_order_created` 信列 ⇒ 不擋。

結算判定(R2 S1):
7. 少付 ⇒ `partiallyPaid`、復活成功;多付 ⇒ `unpaid`、復活成功。
8. 品項快照與 subtotal 不一致(直接改 fixture)⇒ `needs_human` ⇒ P2B51、整筆回滾(單仍取消、收款 0 列)。
9. 合法改價後的單(走 `20260915060000` 改價 RPC)、含運費、開發票含稅三種 ⇒ 依應收判 settled / underpaid / overpaid,復活成功且狀態對。
10. 把 recompute 暫換成「吞例外不翻狀態」⇒ verdict settled 而狀態 unpaid ⇒ RAISE 回滾。

新單(R2 M4):
11. 新單 `created_at = due_at + 10 分`、排程在 `due_at + 60 分` 才取消舊單 ⇒ 補登期限內款項 ⇒ **B3**、`new_order_exists = true`(R2 那個反例)。
12. 新單 `created_at = due_at - 1 秒` ⇒ **仍復活**(舊單還活著時的另一筆購買)。
13. 新單已取消 ⇒ 仍復活;別的客人的新單 ⇒ 仍復活;員工手動建的新單(同客人、`>= due_at`)⇒ B3。

期限:
14. helper 與排程逐格同界:4 個下單時刻 × (`due_at - 1 秒`, `due_at`)。

冪等(R2 M1、S2):
15. 兩條路各重送同鍵 ⇒ `idempotent = true`,三鍵與首送相同,無第二列。
16. **首送成功但斷線 → 改收款日 → 重送** ⇒ P2B53、收款仍 1 列;TS 層 P2B53 不出「開始下一筆」、鍵不變。
17. B3 後把待退款結清(單變退款態)⇒ 原請求重送 ⇒ `idempotent = true`(不是 P2B41)。
18. 兩張單用同一個 request_id(各自一筆)⇒ 重放回傳只讀自己 `payment:<id>` 那列的處置。

並發(兩條真連線,R2 M3):
19. 建單先:連線 A `BEGIN; SELECT create_order(...)`(同客人)不 commit ⇒ 連線 B 補登期限內款項,確認卡在 advisory lock(`pg_locks` 看得到等待)⇒ A commit ⇒ B 走 B3。
20. 補登先:連線 B 補登不 commit ⇒ 連線 A `create_order` 確認卡在 advisory lock ⇒ B commit(復活)⇒ A 建出新單。
21. 19、20 各用 `admin_create_manual_order` 再跑一次。
22. 死鎖探測:連線 A `begin_charge_attempt`(同客人的刷卡單)與連線 B 補登兩種先後 ⇒ 期望無 40P01;若出現,記下並回頭調整鎖序(§7.1)。
23. 兩員工同單不同鍵:期限內 ⇒ 兩筆入帳、復活稽核 1 列;期限後 ⇒ 第二支 P2B51。
24. 排程與補登兩種先後(排程先拿鎖 / RPC 先拿鎖)。
25. 復活 → 沖銷回 0 → 排程再取消 → 再補登 ⇒ P2B51。

失敗注入 / 突變 / 權限 / rollback:
26. `pcm_pending_refund_open_for` 暫換成 RAISE ⇒ B3 整筆回滾、收款 0 列。
27. 突變:對調復活 UPDATE 與 INSERT ⇒ 格 1 紅;拿掉 §6 列集合驗證 ⇒ 格 26 紅;拿掉 §5.2 ⇒ 格 8、10 紅;拿掉 advisory lock ⇒ 格 19 紅;新單界改回 `cancelled_at` ⇒ 格 11 紅。
28. 函式屬性:兩支 RPC 改前改後 `prosecdef`、`proconfig`、owner、proacl 相同;helper owner = postgres、proacl 只有 owner、anon / authenticated / service_role 呼叫 ⇒ permission denied。
29. rollback:前置閘在「線上不是本片目標」時停;跑完後格 1、格 2 情境恢復成拒、一般未取消單收款成功、手動建單成功、helper 不在;格 2 的單原封重送 ⇒ 舊 RPC 拒,而 §9 那段 SQL 查得到它。

### 10.2 TS 單元
30. 回傳缺三鍵(模擬舊 RPC)⇒ 一般成功訊息、不 throw。
31. P2B51 / 52 / 53 / 54 ⇒ 對應訊息;P2B53 不在 `RAIL_SWITCH_ALLOWED_CODES`、帶回同一把鍵。

### 10.3 真表單
32. `bash scripts/admin-probe/up.sh` 起本機後台 + 拋棄式庫:造一張匯款逾期乾淨單,在真表單填期限內收款日 ⇒ 看到「已復活」、取消橫幅消失;另一張填期限後 ⇒ 看到「已入帳並開待退款」;現金逾期單 ⇒ 看到「現金單逾期取消後補登請管理者人工處理」。截圖寫 `~/pcm-mailbox/`。
33. 送出後斷網、改收款日重送 ⇒ 看到 P2B53 訊息、沒有「開始下一筆」、收款紀錄只有一筆。

完成的定義(CLAUDE.md):Sean 在正式站走一次 —— 一張測試匯款單等它逾期取消,員工補登記,看到訂單恢復。

## 11. 還要拍的題

無。

## 12. 審查對照表

### R1

| R1 | 處理 | 在哪 |
|---|---|---|
| must ① 現金無法填實際收款時間 | **範圍縮小後不適用**:Sean 拍現金逾期單不開放補登、現金表單不動(§0);現金逾期單走 C 拒 | §0、§3 |
| must ② `SUM = 0` 漏空帳本 | c1「一列都沒有」;格 1 明寫零筆收款(R2 判已修) | §3.1、格 1 |
| must ③ 部分取消單復活欠退款 | c2(R2 判已修) | §3.1 |
| must ④ 券已退回再兌撞鍵 | c3 含已退回(R2 判已修) | §3.1、格 6 |
| must ⑤ 付款信終態不重排 | c6(R2 判已修;理由已照 R2 nit 改準) | §3.1 |
| must ⑥ 恰一列不是不變量 | c1 + c4 + 列集合驗證(R2 判已修) | §3.1、§6 |
| should ⑦ G5 沒讀新欄 | G5 多讀三欄 | §2 |
| should ⑧ 重放 / 並發格 | G8 前移、重放從稽核列還原 | §7.2、格 15–25 |
| should ⑨ rollback / TS 相容 / proconfig / helper 權限 | §9、格 28–31 | §9、§10 |
| nit 結算器座標 | `20260907170000:86、224-227` | §1 |
| nit 客服稿承諾過滿 | 「依實收金額確認付款狀態」 | §8 |

### R2

| R2 | 處理 | 在哪 |
|---|---|---|
| M1 同鍵改內容被拒後換鍵 ⇒ 重複入帳 | G8 衝突與 backstop 改 P2B53,TS 不給「開始下一筆」、保留原鍵、叫員工看明細核對(不叫他重新整理);補「首送成功斷線 → 改內容 → 重送」驗收(DB + 真表單) | §7.2、格 16、33 |
| M2 現金分鐘精度撞 G7 | **消失**:Sean 拍現金欄位整段刪、現金表單不動 | §0 |
| M3 新單查詢沒與建單序列化 | 補登(B 分支)、前台 `create_order`(既有)、後台手動建單(本片新增)共用 `hashtextextended(customer_user_id::text, 0)`;鎖序訂單列 → 客人鎖,與 `begin_charge_attempt` 同向;EXISTS 在拿鎖後跑;兩連線兩種先後 × 兩種建單 + 死鎖探測 | §2、§7.1、格 19–22 |
| M4 新單以 `cancelled_at` 為界漏認 | 界改 `due_at`,理由:不受排程延遲影響、客人畫面上舊單在 `due_at` 就死;原「新單建於取消之前 ⇒ 仍復活」負對照改成「建於 `due_at` 之前 ⇒ 仍復活」,另補 R2 反例當正對照 | §3.2、格 11–13 |
| S1 乾淨單未證明結算判得出來 | B2 事後比對 verdict 與 payment_status,不符 / needs_human ⇒ 回滾;驗收補明細不一致、改價、運費、稅、吞例外 | §5.2、格 7–10 |
| S2 重放稽核須綁 payment_id | `payment.record` 綁 `target = 'payment:<id>'`;復活列綁 `after->>'payment_id'`;補同 request_id 不同單驗收 | §7.2、格 18 |
| S3 rollback 缺前置閘 / 只列復活 / 重送誤讀 | rollback 前置閘比本片目標 md5;列 B2 + B3 兩種紀錄;寫明 rollback 後重送被拒不代表沒入帳,驗收格 29 | §9、格 29 |
| nit c6 理由過滿 | 改寫成「大多不重排、有可重排例外,保守起見一律不自動處理」 | §3.1 |
