# 2026-09-15 · 刷卡全額退款自動取消之後，箱子不准再出貨 —— plan(R3 端 Sean 批版)

> 窗 B。來源:`~/pcm-mailbox/稽核-ecommerce-cia-20260915.md` P0-1。
> **碰 RPC / view / 新表 / ports ⇒ 鐵則 8 先 plan;碰錢 + schema ⇒ 鐵則 12 codex 審。本 plan 零碼改動、不 commit。**
> - codex R1 FAIL:`~/pcm-mailbox/codex-P01-plan-R1-final.md`
> - codex R2 FAIL:`~/pcm-mailbox/codex-P01-plan-R2-final.md`
> - Sean 拍:照 R2 改完,主視窗逐條核後直接端 Sean 批,**不跑 R3**;實作 diff 另過 codex。
> - 逐條對照在 §10。
>
> **已拍板**
> - Sean Q2 = 甲:刷卡單已出貨後全額退款 ⇒ **不變已取消**,維持「已出貨 + 已退款」,只寄退款信、不寄取消信。
> - Sean Q-A = 乙:已叫過新竹但還沒按已出貨時全額退款 ⇒ 不自動取消,跳過並寫 incident,給人確認。
> - 主視窗裁 R1 ⑥:合法出貨在先、取消在後 ⇒ 出貨信與改單號信照寄;只擋「取消在先」的。
>   - 🔵 2026-09-15 片 4a codex R1 後主視窗收窄(選乙):「照寄」= **新判準(clearance)不額外擋**合法出貨在先的信;既有閘 `SUPPRESS_WHEN_ORDER_INELIGIBLE`(`order_shipped` / `shipment_tracking_corrected` = `'refunded_or_cancelled'`,b72ef4fe1)**照擋**:信排入後、寄出前單被取消或全額退款 ⇒ 不寄。理由:b72ef4fe1 既有裁決 + Q2 甲「全退後只寄退款信」;窗口只在排信到寄出那幾分鐘。
> - Sean Q-B(R1 ④)= 甲,逐字「甲 = 擋下來不准出, 訂單保持「已出貨 + 已退款」」:部分已出、全額退款 ⇒ 不取消,剩下沒出的箱子與還沒裝箱的品項一律擋。
> - Sean R2 B3 = 甲,逐字「甲 = 要擋, 跟全刷卡退一樣」:刷卡單「卡退 + 人工退」合計全額 ⇒ 剩下沒出的照擋。

## 0. 白話

員工把刷卡單全額退款 ⇒ 系統自動把單標成「已取消」。但出貨那幾顆按鈕**完全不看訂單有沒有取消** ⇒ 員工照樣可以把那箱加品項、叫新竹、按已出貨,客人還會收到「已出貨」信。錢退了、貨也走了。

2026-09-15 那一次唯讀查詢**沒有找到目前受影響的資料**(§2)。這不代表以前沒發生過:已作廢的箱子不在查詢範圍內。

## 1. 現況(每一格有出處)

| 路 | 看不看 `orders.cancelled_at` | 出處 |
|---|---|---|
| 建箱 `admin_create_shipment` | 不看,**也看不到**:箱子只綁客人,不綁訂單 | `20260807170000:83` |
| 加品項 `admin_add_shipment_items` → `pcm_b2_add_items_impl` | 0 | `20260807230000:71-`;先鎖 `order_items`(:173),INSERT 時 parent guard 才鎖 shipment(`20260805170200:156`,只檢查已出貨 / 作廢) |
| 標已出貨 `admin_mark_shipment_shipped` | 0 | `20260808100000:177-`;`shipped_at = now()`(:255) |
| 叫車 `admin_claim_hct_dispatch` | 0 | `20260910130000:148-` |
| 復原作廢 `admin_unvoid_shipment` | 0 | `20260808100000:413-` |
| 送新竹建單 `admin_record_hct_submit` | 0 | `20260904170000:113-`;TS 在 HTTP **之前**就用它寫 `unknown` 佔位(`shipment-submit-hct-action.ts:233-240`) |
| 出貨信 `pcm_shipped_email_pending` / 缺收件人 `pcm_shipped_email_unsendable` | 0 | `20260907230000:149-` / `20260905040000:84-` |
| 改單號信規則底面 `pcm_tracking_correction_candidates` | 0 | `20260914090000:138-`(pending 與 `get_tracking_corrected_gap_counts` 都從它衍生) |
| 寄送當下 `loadShippedContext` | 0 | `sweep-email-outbox.ts:2221`(改單號)、`:2517`(出貨);adapter 只讀 shipments / items |
| 死信重排 `admin_requeue_dead_email` | 不經 view | `20260915040000:374`,原地翻回 pending,之後仍走寄送端 |
| 自動取消 `pcm_auto_cancel_on_full_card_refund` | **不看 shipments** | `20260914060000:65-158`;取消寫 `now()`(`20260903093000:793`) |

- **既有數量約束擋不到**:`admin_mark_order_cancelled` 只 UPDATE `orders`、`cancel_items_untouched = true`,`cancelled_quantity` 仍是 0 ⇒ `oiqs_cancelled_shipped_le_quantity` 永遠成立;出貨候選清單也把品項當成可出(`shipment-candidates.ts:217`)。
- **叫車動作的真實順序**(`shipment-dispatch-hct-action.ts:118-176`):claim RPC 提交 → HTTP 叫新竹 → `recordHctDispatch` → `markShipmentShipped`。三步不在同一個交易。claim 之後可能出現四種結果:
  - 開關被關、沒送出(:124)
  - 新竹拒絕(:146)
  - 回應看不懂 / 未知(:131、:153)
  - 成功
  前三種 `hct_dispatch_attempted_at` 都已經有值。
- **`now()` 是交易開始時間**,不是提交時間(`https://www.postgresql.org/docs/17/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT`)⇒ 兩張表的時間戳不能拿來判斷誰先拿到鎖。

## 2. 正式庫現況(唯讀,2026-09-15 查)

`bash scripts/readonly-prod-sql.sh <scratchpad>/p01-count.sql`,rc=0:
- 已取消的單,品項在「未作廢箱」裡:0(草稿 0、已出貨 0、新竹 submitted 0、取消後才出貨 0)。
- `admin_audit_log` 裡 `order.mark_cancelled`:1 列(自動與人工沒有分開數)。
- 分母**不含已作廢的箱子** ⇒ 只能說「這次查詢沒有找到目前受影響的資料」。

## 3. 共用規則(每一片都引用這一節,不各寫一份)

### 3.1 「這張單能不能開始出貨」

判準寫成**一支 SQL 函式** `pcm_order_ship_blocked(order_id) → text | NULL`(NULL = 可以出;非 NULL = 原因碼)。所有守門都叫它,不各抄一份。

| 原因碼 | 條件(欄位) |
|---|---|
| `cancelled` | `orders.cancelled_at IS NOT NULL` |
| `card_fully_refunded` | `orders.payment_method = 'tappay' AND orders.payment_status = 'refunded'` |

- **`refunded` 本來就含人工軌**:`pcm_sync_order_refund_payment_status` 以 `pcm_order_money_moved`(卡退 + 未作廢人工退 + 有效更正,`20260911170000:112`)算出 `refunded`,不分軌(`20260914060000:221`)。
  - 所以「卡退 600 + 人工退 400 = 總額 1,000」也會擋。**這是 Sean R2 B3 拍甲**,不是副作用。
  - 自動取消那邊的 `skipped:mixed_rail`(`20260914060000:107`)**不變**:混合軌不自動取消,但剩下的一樣擋出貨。
- **不新增旗標欄**:`payment_status` 是「已全額退款」唯一的寫入來源;多一個旗標等於多一份會漂的真相。
- 退款被作廢時 `payment_status` 會降回 `paid` 或 `partiallyRefunded`(同函式第 3 代起拿掉「只升不降」)⇒ `card_fully_refunded` 自己解開。`cancelled_at` 不會跟著解開。
- `partiallyRefunded` 不擋。非 `tappay` 的單(匯款 / 現金)全額退款不擋:Q-B 與 B3 問的都是刷卡單。

### 3.2 「開始出貨」與「補記已發生的事」分開

3.1 只擋**開始**出貨:
- 裝箱
- 送新竹建單(draft / failed → unknown 佔位)
- 叫車 claim
- 沒走新竹的箱子標出貨
- 復原作廢

**補記**不套 3.1,但只限**能證明貨已交出**的箱子(R2 B1):

| 箱子狀態 | `mark_shipped` 怎麼判 |
|---|---|
| `hct_dispatched_at IS NOT NULL`(新竹回成功,或 3.4 人工確認交貨) | 補記:不套 3.1,放行 |
| `hct_dispatch_attempted_at` 有值、`hct_dispatched_at` 空(沒送出 / 被拒 / 未知) | **套 3.1**:被擋就拒,訊息指向 3.4 |
| 沒叫過車 | 套 3.1 |

- Q-A 乙(不自動取消 + incident)照舊,只是「照事實補記」必須先有證據。
- 同一張全額退款的單可以同時有兩種箱子:派遣成功的箱子能補記出貨;其他沒出的箱子與品項照擋(Q-B 甲)。

### 3.3 出貨資格證明(取代 R2 版的時間戳比較;R2 ⑥)

**新表 `shipment_order_ship_clearances`**:一列 = 「這一箱在**持訂單鎖、判準通過**的那一刻,這張單是可以出的」。

| 欄 | 型別 | 說明 |
|---|---|---|
| `shipment_id` | uuid NOT NULL FK shipments RESTRICT | |
| `order_id` | uuid NOT NULL FK orders RESTRICT | |
| `cleared_via` | text NOT NULL CHECK IN (`'claim'`, `'mark_shipped'`, `'backfill'`) | |
| `cleared_at` | timestamptz NOT NULL DEFAULT `clock_timestamp()` | 只給人看,**任何判準都不讀它** |
| PK | `(shipment_id, order_id)` | 重複寫入用 `ON CONFLICT DO NOTHING` |

- **誰寫**(同一個交易、持 `orders FOR SHARE`、判準通過之後):
  - `admin_claim_hct_dispatch`:箱內每張訂單一列,`via = 'claim'`。
  - `admin_mark_shipment_shipped` 走「套 3.1 且通過」那一路時:每張訂單一列,`via = 'mark_shipped'`。
  - 補記那一路不寫:claim 當時已經寫過,且 R2 B2 保證 claim 之後箱內不會多出訂單。
- **寄信怎麼用**:`(shipment_id, order_id)` 有 clearance 列 ⇒ 照寄;沒有 ⇒ 不寄。**不比任何時間戳。**
  - 合法出貨在先、取消在後:出貨那一刻已寫下 clearance ⇒ 新判準不擋(主視窗裁 ⑥)。🔵 但寄出當下單已取消或全額退款 ⇒ 既有閘 `SUPPRESS_WHEN_ORDER_INELIGIBLE` 先擋下、落 `order_ineligible`(主視窗 2026-09-15 收窄,選乙)。實際照寄的是「出貨在先、寄出前沒被取消 / 全退」的信,以及出貨信早已寄出後才取消的單的改單號信 —— 後者同樣會被既有閘擋。
  - 取消在先:出貨守門會拒 ⇒ 永遠寫不出 clearance ⇒ 不寄。
  - 「取消交易先開始、出貨先拿鎖」:出貨持鎖時判準通過 ⇒ 寫 clearance ⇒ 照寄。R2 ⑥ 的反例因此消失(驗收 ㉔)。
- **權限**:ENABLE RLS、零 policy;REVOKE ALL FROM PUBLIC, anon, authenticated;GRANT SELECT TO service_role(寄送端 adapter 讀);寫入只經上面兩支 SECURITY DEFINER(owner postgres)。append-only:掛 BEFORE UPDATE OR DELETE trigger 直接 RAISE(形狀照 `pcm_b2_shipment_items_append_only`,`20260805170200:100-`),並 ENABLE ALWAYS。
- **回填**(同一支 migration、同一個交易):對**所有**(含已作廢)`shipped_at` 或 `hct_dispatch_attempted_at` 有值的箱子,展開 `(shipment_id, order_id)`,`via = 'backfill'`。條件是 `o.cancelled_at IS NULL OR o.cancelled_at >= COALESCE(s.hct_dispatch_attempted_at, s.shipped_at)`。
  - 這是**唯一**用時間戳的地方,只用在上線前的舊資料。舊資料沒有鎖可以證明先後,只能退回用時間。
  - 回填前先印「條件不成立、被排除的組數」,**大於 0 就停下問**(§2 的查詢是 0,但分母沒含作廢箱)。
  - 已作廢的箱子也回填,這樣舊箱子被復原之後寄信行為不變。

### 3.4 未知但確實已交貨:人工確認路徑(R2 B1)

新 RPC `admin_confirm_hct_handover(p_shipment_reference text, p_actor text, p_reason text)`,只給管理者用,形狀照 `admin_requeue_dead_email` 的權限閘(`20260915040000`:`staff.is_manager AND is_active`)。
- 前提:`hct_dispatch_attempted_at` 有值、`hct_dispatched_at` 為空、未作廢、`p_reason` 非空白。
- 動作:寫 `hct_dispatched_at = now()`(write-once trigger 允許 NULL → 值);同一個交易寫 `admin_audit_log` 一列(action `shipment.hct_handover_confirmed`、actor、reason)。
- 之後員工按 `mark_shipped` 會走 3.2 補記那一路。
- 被拒 / 沒送出、而貨其實沒交的箱子:不走這條。作廢箱子;需要取消的話按「標記已取消」。
- 後台入口:出貨區塊裡,「已叫車、未派遣成功」的箱子多一顆「確認已交貨」(管理者才看得到),必填理由。

## 4. 鎖順序(R1 ②③;片 1 共用)

**全線統一:`shipments` → `orders` → `order_items`。允許只走其中一段(子序列),例如只鎖 orders → order_items、或只鎖 shipments。**

| 路 | 今天 | 改後 |
|---|---|---|
| 一般取消 `admin_cancel_order` 系 | orders(UPDATE)→ items(NKU)(`20260914050000:427,660`) | 不動 |
| 退款 → 自動取消 | orders(NKU)→ 讀 shipments / clearances **不上鎖** | 不動 |
| 加品項 | items(NKU,:173)→ shipments(parent guard) ⚠️ 與取消反向 | shipments(NKU)→ orders(SHARE)→ items(NKU)→ INSERT |
| 標已出貨 | shipments(UPDATE)→ items(重算 trigger) | shipments(NKU)→ orders(SHARE)→ clearance INSERT → UPDATE shipments → items |
| 叫車 claim | shipments(UPDATE 一句) | shipments(NKU)→ orders(SHARE)→ clearance INSERT → 佔位 UPDATE |
| 復原作廢 | shipments → items | shipments(NKU)→ orders(SHARE)→ UPDATE → items |
| 送新竹佔位 | shipments(FOR UPDATE) | shipments(FOR UPDATE)→ orders(SHARE)(只在 draft / failed) |
| 人工確認交貨(3.4) | — | shipments(FOR UPDATE)only |

**成員集合怎麼不漏**
- 先鎖 shipment 那一列。parent guard 要同一列的 NKU,NKU 與 NKU 互斥 ⇒ 持鎖期間別人加不進品項。
- 加品項的集合 = 箱內既有訂單 ∪ `p_items` 的訂單 ⇒ 空箱也會鎖到輸入那幾張。集合是空的 ⇒ 拒。
- `orders` 依 `id` 排序上 `FOR SHARE`。SHARE 與 UPDATE / NKU 互斥(`https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS`)。
- 判準在鎖之後讀;前緣「講人話」那段可以留在迴圈外,以鎖後那一次為準。

**跨交易的成員變動(R2 B2)**:箱子 claim 之後(`hct_dispatch_attempted_at IS NOT NULL`)**不准再加品項**。
- 真正的判準寫在 `pcm_b2_shipment_items_parent_guard`(trigger,每一條寫入路都會經過;開工前 `latest-definition-of.sh` 抄最新一代)。
- `pcm_b2_add_items_impl` 另寫一句人話:「包裹 XXX 已叫過新竹,不能再加品項;要補寄請開新的包裹」。
- 送新竹建單之後、叫車之前,仍可加品項(新竹那端要更正,既有規則不變)。

**重試**:既有 40P01 重試是 `LOOP … BEGIN … EXCEPTION WHEN deadlock_detected` 子交易。上面這些鎖與 clearance INSERT **全部搬進那個 BEGIN 區塊** ⇒ 子交易回捲會放掉本圈的鎖與寫入,下一圈照同一順序重拿、重讀集合。冪等 claim 仍在迴圈外。`admin_claim_hct_dispatch` 今天沒有重試迴圈 ⇒ 不加。

**開工前要核(寫進片 1 驗收)**:grep 全 repo 各函式與 trigger 的最新代,找**禁止的反序**:
- 先鎖 `order_items`、後鎖 `orders` 或 `shipments`
- 先鎖 `orders`、後鎖 `shipments`

有的話列出來,§4 要改。「shipments → orders」「orders → order_items」是目標順序,**不算**。

## 5. 分片

### 片 1 · DB 出貨守門 + 資格證明表(一支 migration,~45 分,碰新表)

1. 新函式 `pcm_order_ship_blocked(uuid)`(3.1)。
   - `SECURITY DEFINER`、`search_path = ''`、owner postgres、零 GRANT(只給 definer 函式呼叫)。
   - 訂單不存在 ⇒ RAISE,不回 NULL,不讓「查不到」變成「可以出」。
2. 新表 `shipment_order_ship_clearances` + append-only trigger + 權限 + 回填(3.3)。
3. 新 RPC `admin_confirm_hct_handover`(3.4)。GRANT EXECUTE TO service_role,REVOKE anon / authenticated / PUBLIC。
4. 以下各支 `CREATE OR REPLACE`,**從 `scripts/latest-definition-of.sh` 的 newest 那一代抄**,簽章一字不動,`SET` 整組照抄,依 §4 改鎖序、加判準:
   - `pcm_b2_add_items_impl`:拒 `ship_blocked` 的品項、拒已 claim 的箱子;整批回捲,不部分寫入。
   - `pcm_b2_shipment_items_parent_guard`:加「已 claim ⇒ 拒」(真判準)。
   - `admin_mark_shipment_shipped`:依 3.2 的表判;套 3.1 並通過時寫 clearance。箱內任一訂單被擋 ⇒ 整箱拒。
   - `admin_claim_hct_dispatch`:套 3.1;通過後寫 clearance,再做佔位 UPDATE。
   - `admin_unvoid_shipment`:套 3.1。
   - `admin_record_hct_submit`:只在 `v_old_status IN ('draft','failed')` 時套 3.1;`unknown → *` 一律不擋。
5. **不改**:
   - `admin_create_shipment`:沒有訂單可看。
   - `admin_record_hct_dispatch`:補記事實。
   - `admin_void_shipment`:作廢永遠可以做。
6. 🟡 天花板:送新竹佔位提交之後才打 TransData HTTP ⇒ 取消落在這兩步之間時,新竹會多一張託運單,但叫不到車(claim 會擋)。員工作廢箱子即可。

### 片 2 · 自動取消分流(一支 migration,~40 分)

`pcm_auto_cancel_on_full_card_refund` 新一代,抄 `20260914060000:65-158`。在 `skipped:mixed_rail` 之後、找 actor 之前,讀這張單的**未作廢箱子**(只讀;§4 說明為什麼讀到的是已提交狀態):

```
A = 有箱子 hct_dispatch_attempted_at 有值、shipped_at 為空
S = 有箱子 shipped_at 有值
U = 有箱子沒叫車、沒出貨

A        ⇒ RETURN 'skipped:hct_dispatched'
           incident 'auto_cancel_skipped'(同單未解決只記一列,去重形狀照 :121-125)
           訊息:「刷卡已全額退款,但箱子 XXX 已叫過新竹、還沒標已出貨 ⇒ 沒有自動取消。
                 新竹回成功 ⇒ 按已出貨;結果不明而貨確實交出 ⇒ 管理者按『確認已交貨』再按已出貨;
                 貨沒交出 ⇒ 作廢箱子後按『標記已取消』」                                   ← Q-A 乙
否則 S   ⇒ RETURN 'skipped:shipped'                                                        ← Q2 甲
           U 也成立時:incident 'auto_cancel_skipped'
             「已出貨部分保留;剩下的箱子 XXX 已被擋住不能出,請作廢」                       ← Q-B 甲
否則 U   ⇒ 照常取消 + incident 'auto_cancel_live_shipment'
           「單已自動取消,但箱子 XXX 還沒作廢;新竹若已建單請去攔」
都沒有   ⇒ 照舊
```

- `pcm_incident_kind_check`:從最新 `20260914100000:54` 的五個值(`pending_refund_open_failed`、`refund_over_total`、`auto_cancel_skipped`、`auto_cancel_failed`、`line_forward_failed`)再加 `auto_cancel_live_shipment`。
- 混合軌(B3):照舊 `skipped:mixed_rail`,不寫新 incident;擋出貨由片 1 做,提醒由片 5 的退款區塊做。
- 呼叫端 `pcm_sync_order_refund_payment_status` 不動。
- Q2 甲的信件結果(靜態核過,片 2 驗收要實跑):
  - 取消信:單沒取消 ⇒ `order_cancelled` 不會排。
  - 退款信:`pcm_partial_refund_email_pending`(`20260912020000:152-`)收刷卡 `refunded` 的單,`order_state = 'fully_refunded'`,文案在 `order-email-copy.ts:297`。前提是 `PARTIAL_REFUND_EMAIL_CUTOFF` 已設(CURRENT.md 09-13 記 Sean 已設;本 plan 沒重核)。

### 片 3 · 掃描端寄信規則(一支 migration,~40 分)

三張 view 加**同一句**:`EXISTS (SELECT 1 FROM shipment_order_ship_clearances k WHERE k.shipment_id = s.id AND k.order_id = o.id)`。欄位清單一欄不動。
- `pcm_shipped_email_pending`:抄 `20260907230000:149-`。
- `pcm_shipped_email_unsendable`:抄 `20260905040000:84-`(缺收件人的計數與 pending 同一套資格)。
- `pcm_tracking_correction_candidates`:抄 **`20260914090000:138-`**(第三代)。pending 與 `get_tracking_corrected_gap_counts` 自動跟著;`pcm_tracking_corrected_email_pending` 不動。
- 前置閘:釘每張 view 線上定義的 md5,以及第三代的特徵字面(`sent_tracking_recorded`、`manual_phone`)。
- 🔴 部署順序:片 1(建表 + 回填)**必須先貼**,否則三張 view 會把所有既有出貨信擋掉。前置閘:clearance 表存在且列數 > 0。
- 🔴 改 view 之前:先補跑片 1a 那段回填(同一個鎖、同一個「取消早於交出 ⇒ 停」閘,ON CONFLICT DO NOTHING),再做**覆蓋率閘**:未作廢且 `shipped_at` 或 `hct_dispatch_attempted_at` 有值的(箱, 單)沒有 clearance 列的組數 = 0,否則整支停(§6)。

### 片 4 · 寄送端(TS,~40 分,碰 `packages/ports` ⇒ 鐵則 8)

兩種信寄出前都會叫 `loadShippedContext`(`sweep-email-outbox.ts:2221`、`:2517`)⇒ 普通重試、死信重排都會經過。
1. **資格**:`IShippedEmailContext` 的結果多一種 `{ kind: 'not_cleared' }`。`SupabaseShippedEmailContextAdapter` 用 service client `.from('shipment_order_ship_clearances')` 讀 `(shipment_id, order_id)`:
   - 有列 ⇒ 繼續。
   - 零列 ⇒ `not_cleared`。
   - 讀取錯誤 ⇒ 既有 `unavailable`(fail-closed:`releaseAfterPrepareFailure`,下一輪再試)。
   - TS 不自己判斷先後。
2. **落帳**(R2 should-fix 1):`IEmailOutbox` 加 `markSkippedNotCleared(id, claimedAttempts, dedupKey)`,`SupabaseEmailOutboxAdapter` 照 `markSkippedShipmentVoided`(`:1132`)的形狀:
   - 只在 `status = 'sending' AND attempts = claimedAttempts` 時更新(所有權檢查)。
   - 寫 `status` 為 skipped、`last_error_code = 'order_not_cleared_at_ship'`、清 `claimed_at`。
   - 回 `owned` 布林值;沒搶到 ⇒ `result.staleMarks++`。
   - `SweepResult` 加計數 `skippedNotCleared`。
   - 這個碼不放進五張 view 的「可重排」清單:dedup key 不變,放進去只會每輪撞唯一鍵。
3. **分批提醒文案**(R2 nit 2):adapter 算「還有沒出完」(`:187-219`)時,訂單 `pcm_order_ship_blocked` 非 NULL ⇒ 當成沒有剩餘,不印 `sweep-email-outbox.ts:1529` 那句分批出貨提醒。
   - 做法:adapter 多讀 `orders.cancelled_at, payment_method, payment_status`,用同一組條件判斷。
   - 🟡 這是 3.1 在 TS 的**第二份**:兩份會漂。片 4 加一格測試,把兩邊條件逐字對上(形狀照 `refund-alert-threshold-parity.test.ts`)。
4. 開工時先核 `email_outbox.last_error_code` 有沒有 CHECK 值域;有的話片 3 的 migration 一起擴。

### 片 5 · 後台畫面(TS,~40 分)

1. **退款區塊提醒**(`refund-section.tsx`,資料從 `order-detail-money-tab.tsx:243` 傳入;出貨資料同頁 `order-inline-head.tsx:81` 已經在讀)。只顯示、不擋、不用多勾:
   - 有叫過車、還沒出貨的箱:「退完這張單**不會**自動取消。請確認箱子 XXX 的貨有沒有交出。」
   - 有已出貨的箱:「已出貨,全額退款後不會變成已取消(當退貨),客人只收到退款信。剩下沒出的箱子和品項會被擋住,不能再出。」
   - 只有沒出貨的箱:「退完會自動取消。請把箱子 XXX 作廢;已送新竹建單的話要打給新竹攔。」
   - 刷卡單而這次是人工退款:「刷卡加人工合計退滿後,剩下沒出的會被擋住;單不會自動取消。」
   - 讀不到出貨資料:「讀不到出貨狀態,退款前先到出貨區看一眼。」
2. **出貨候選清單**(`shipment-candidates.ts`):`ship_blocked` 的品項標 `blockedReason`,`cancelled` 沿用既有值,另加 `refunded`(字:「已全額退款,不能再出」)。開工時核候選資料有沒有帶到訂單欄位,沒有就多撈。
3. **「確認已交貨」按鈕**(3.4):出貨區塊,管理者才顯示,必填理由。server action 叫 RPC;非管理者由 RPC 擋。
4. 送新竹前的 TS 檢查**不做**:片 1 已放進佔位那一格 RPC,同一件事不寫兩份。

## 6. 影響

- **客人**
  - 沒出貨的單全退 ⇒ 照舊收取消信,**不會再收到已出貨信**(掃描端與寄送端都擋)。
  - 已出貨的單全退 ⇒ 只收退款信(Q2 甲),出貨信不再說「其餘商品會另行通知」。
  - 出貨在先、取消在後 ⇒ 出貨信與改單號信照寄。
- **員工**
  - 被擋的單不能加品項、送新竹、叫車、標出貨、復原作廢,畫面會說明原因。
  - 叫過車的箱子不能再加品項。
  - 叫車結果不明而貨確實交出 ⇒ 管理者按「確認已交貨」。
  - 退款前多一段提醒。
  - 刷卡單卡退加人工退合計滿額 ⇒ 剩下的也擋(B3)。
- **資料**:新表一張(回填既有出貨)、incident 多一種 `auto_cancel_live_shipment`、`admin_audit_log` 多一種 action。
- **部署順序**:片 1 → 片 2 → 片 3 的 migration 先貼,片 4、片 5 的 TS 再上。
  - 片 3 依賴片 1 的表(前置閘擋)。
  - 片 4 `.from('shipment_order_ship_clearances')` 依賴片 1(部署時序閘會擋 `.from(`)。
  - 🔴 **片 1a(20260915230000)與片 1b 同一次、連續貼,中間不隔天、不插別的板**(主視窗 2026-09-15 補)。
    理由:1a 的回填是貼的那一刻的快照;1a 貼了而 1b(claim / mark_shipped 寫 clearance)還沒上時出貨的箱子沒有 clearance 列 ⇒ 片 3 的 view 或片 4a 的寄送端一上,那些出貨信會被靜默跳過。
  - 🔴 **片 3 的 migration 先補跑同一段回填(ON CONFLICT DO NOTHING),再做覆蓋率前置閘**:所有 `shipped_at` 或 `hct_dispatch_attempted_at` 有值、未作廢的(箱, 單)都要有 clearance 列 = 100%;不足 ⇒ 印缺的組數並停。
  - 🔴 **片 4a 的 TS 部署前**跑同一支唯讀覆蓋率查詢,= 100% 才部署(4a 在寄送端讀 clearance,與片 3 同樣會吞掉沒有證明的信)。
  - 🔴 `scripts/deploy-order-gate.sh` 的 `.from(` 比對只認 view、**不認新表**(codex 4a R1)⇒ 它擋不住「片 1a 還沒貼就部署 4a」。這一格只靠上面那條人工前置,不改閘(主視窗 2026-09-15 裁)。

## 7. 拍板紀錄

```
Q-B:一張刷卡單分兩箱,A 箱已出貨、B 箱還沒出。全額退款後,照 Q2 甲單不變已取消。那 B 箱(和還沒裝箱的品項)還能不能出?
A: 甲 = 擋住:全額退款的刷卡單,剩下的不准再出。已出貨的照舊保留   ← Sean 選這個
   乙 = 照出:只有「已取消」才擋,全退但沒取消的單剩下照樣可以出
```

```
B3:刷卡單卡退 600 + 人工退 400 = 總額 1,000。自動取消照舊跳過(mixed_rail)。剩下沒出的要不要擋?
A: 甲 = 要擋, 跟全刷卡退一樣   ← Sean 選這個
   乙 = 不擋
```

**本版沒有新題要 Sean 答。** 要 Sean 批的是整份 plan,特別是 3.3 新表(碰 schema)與 3.4 新管理者按鈕。

## 8. 驗收(拋棄式 PG 實跑;驗收 SQL 放 `~/pcm-mailbox/`,不新增 `scripts/`)

依序 apply 到各函式最新一代,再 apply 片 1–3。每格印**實際值**:

| # | 做什麼 | 期望 |
|---|---|---|
| ① | 刷卡單 + 草稿箱(新竹 submitted、沒叫車)→ 全額退款 | 單已取消;incident `auto_cancel_live_shipment` 1 列 |
| ② | 接 ① `admin_claim_hct_dispatch` | **RAISE;`hct_dispatch_attempted_at` 仍 NULL;clearance 0 列** |
| ③ | 接 ① `admin_mark_shipment_shipped` | RAISE;`shipped_at` 仍 NULL |
| ④ | 已取消單的品項加進**空箱** | RAISE;`shipment_items` 列數不變 |
| ⑤ | 作廢箱 → 取消單 → `admin_unvoid_shipment` | RAISE |
| ⑥ | 已取消單的新箱 `admin_record_hct_submit` draft → unknown | RAISE;同一箱 `unknown → submitted` 補記 ⇒ 成功 |
| ⑦ | 刷卡單已出貨 → 全額退款 | `skipped:shipped`;`cancelled_at` 仍 NULL;退款信 view 有列且 `order_state='fully_refunded'`;沒有 `order_cancelled` 列 |
| ⑧ | claim → 新竹成功 `record_hct_dispatch` → 全額退款 → `mark_shipped` | `skipped:hct_dispatched`;incident 1 列;mark_shipped 成功;`cancelled_at` 仍 NULL |
| ⑨ 併發 | A:claim 提交 → B:全額退款 → A:record + mark_shipped | B 回 `skipped:hct_dispatched`;A 兩步成功 |
| ⑩ 併發 | A:BEGIN、`mark_shipped` 拿到鎖不提交 → B:全額退款 | B 等 A;A 提交後 B 回 `skipped:shipped` |
| ⑪ 併發 | A:BEGIN、自動取消不提交 → B:同箱 `mark_shipped` | B 等 A;A 提交後 B RAISE;clearance 0 列 |
| ⑫ 分箱 | 一單兩箱,A 箱已出、B 箱未出(沒叫車)→ 全額退款 → B 箱 claim、mark_shipped、送新竹佔位 | `skipped:shipped`;`cancelled_at` 仍 NULL;incident 1 列;三步全 RAISE;A 箱不受影響 |
| ⑬ 併發 | A:鎖箱準備 `mark_shipped`(O1)→ B:把 O2 品項加進同一箱 → C:取消 O2 | B 等 A;最後不會出現「O2 已取消而其品項在已出貨箱」 |
| ⑭ | 同箱 O1、O2,只取消 O2 → `mark_shipped` | 整箱 RAISE;沒有部分寫入 |
| ⑮ 併發 | 加品項與一般取消同一張單,各跑 50 輪 | 零 40P01 外洩;結果一致 |
| ⑯ | 已出貨 → 退款(Q2 不取消)→ 員工手按「標記已取消」→ 改單號 | candidates 有列(clearance 在);照寄 |
| ⑰ | 已取消單 + 繞守門手動造的已出貨箱(無 clearance) | 三張 view 0 列;`get_tracking_corrected_gap_counts` 不算它 |
| ⑱ 寄送端 | **兩種事件各跑**:(a)已排入 → 手動刪 clearance(模擬)→ 普通重試 ⇒ skipped `order_not_cleared_at_ship`;(b)死信 → `admin_requeue_dead_email` → sweep ⇒ 同上;(c)正對照:出貨在先、寄出前沒被取消 ⇒ 照寄;(c')出貨在先、排入後才取消或全額退款 ⇒ 既有閘 skipped(`order_ineligible`,不是 `order_not_cleared_at_ship`),而且根本不讀 clearance;(d)clearance 讀取失敗 ⇒ 不寄、不 skip、下一輪重試;(e)`sending` 被別人搶走 ⇒ `staleMarks` +1 | vitest 打 sweep + 兩個 adapter(clearance 的 append-only 在 PG 那一側另驗) |
| ⑲ 正對照 | 沒取消的單走完加品項 → 送新竹 → 叫車 → 出貨 | 全部成功;clearance 1 列 `via='claim'`;出貨信 view 有列 |
| ⑳ rollback | ① 之後跑 rollback | 見 §9 |
| ㉑ 分箱 | 接 ⑫:同單還沒裝箱的品項加進新箱 | RAISE(`card_fully_refunded`) |
| ㉒ 分箱 + 叫車 | 一單三箱:A 已出、B claim 且新竹成功、C 沒叫車 → 全額退款 → B mark_shipped → C claim | `skipped:hct_dispatched`;B 成功(補記);C RAISE |
| ㉓ 解開 | 接 ⑫:把那筆退款作廢(`payment_status` 降回)→ B 箱 claim | 成功 |
| ㉔ ⑥ 反例 | C:BEGIN、`SELECT now()` 後停住(取消交易先開始)→ S:`mark_shipped` 拿鎖、提交 → C:自動取消並提交 | clearance 1 列;`cancelled_at < shipped_at`(時間戳顛倒)**而出貨信 view 仍有列** |
| ㉕ B1 | claim → 開關關閉沒送出(不寫 dispatched)→ 全額退款 → `mark_shipped` | `skipped:hct_dispatched`;mark_shipped **RAISE** |
| ㉖ B1 | claim → 新竹拒絕 → 全額退款 → `mark_shipped` | 同 ㉕ |
| ㉗ B1 | claim → 未知 → 全額退款 → 非管理者 `admin_confirm_hct_handover` ⇒ 拒;管理者 + 理由 ⇒ 成功 → `mark_shipped` | `hct_dispatched_at` 有值;`admin_audit_log` 1 列(actor、reason);mark_shipped 成功 |
| ㉘ B2 | O1 箱 claim → 加 O2 品項 | **RAISE**(parent guard);`shipment_items` 不變 |
| ㉙ B2 | O1 箱 claim → (繞 RPC 直寫 `shipment_items`)加 O2 → O2 全額退款 → record + mark_shipped | 直寫被 parent guard 擋 ⇒ 情境不成立;另印 O2 clearance 0 列 |
| ㉚ 範圍 | 部分退款(`partiallyRefunded`)的刷卡單 → claim | 成功 |
| ㉛ 併發 | A:BEGIN、作廢全額退款(`payment_status` 回 paid)不提交 → B:claim | B 等 A;A 提交 ⇒ B 成功。反向:B 先拿鎖 ⇒ 作廢等 B;B 在「作廢前」判 ⇒ RAISE |
| ㉜ | 已取消單 → 作廢退款 → claim | RAISE(`cancelled` 不因退款作廢解開) |
| ㉝ 範圍 | 匯款單全額人工退款 → claim | 成功(非 tappay 不擋) |
| ㉞ B3 | 刷卡單卡退 600 + 人工退 400 → 自動取消 → claim | `skipped:mixed_rail`;`cancelled_at` 仍 NULL;claim **RAISE**(`card_fully_refunded`) |
| ㉟ 回填 | apply 片 1 前造:已出貨箱(未取消)、已作廢已出貨箱、取消在先的違規箱 | 前兩者回填 2 列;第三者讓前置印數 > 0 ⇒ migration 停下 |
| ㊱ 部署縫 | apply 片 1a → 用**舊版** `admin_mark_shipment_shipped`(1b 之前)出貨一箱(沒有 clearance)→ apply 片 3 → 出貨信 view / 寄送端 | 片 3 的補回填寫進那一組;覆蓋率閘 = 100% 通過;那封信照寄。負對照:片 3 拿掉補回填 ⇒ 覆蓋率閘停下、view 沒被改 |

**每支函式、view、新表的前後閘**:
- 函式:簽章數 = 1、`prosecdef`、`proconfig` 整組、owner、`has_function_privilege`(anon / authenticated / service_role 各應是什麼,照上一代量出來寫死)、`md5(prosrc)`。
- view:`reloptions` 的 `security_invoker`、欄位清單。
- 新表:`relrowsecurity = t`、anon / authenticated 零權限、service_role 只有 SELECT、append-only trigger 是 ENABLE ALWAYS。
- `CREATE OR REPLACE` 保留既有 owner 與 GRANT ⇒ 閘要**量**,不是假設沒變(`https://www.postgresql.org/docs/17/sql-createfunction.html`)。
- incident CHECK 後閘:五個舊值加一個新值都在。

另外:三綠 + 片 4 / 片 5 動到的測試檔 + 3.1 兩份條件的對照測試 + codex 實作 diff 審(片 1、片 2+3、片 4 各一輪)。
**做完的定義**:Sean 在後台自己走一次「退款一張已出貨的單,看到提醒,單不變取消,剩下的箱子叫不了車」。

## 9. Rollback

- 片 1–3 各一支 `supabase/rollbacks/<版本>-rollback.sql`,**整支一個交易**,所有前置檢查在第一個寫入之前。
- **退的順序**:片 4 → 片 3 → 片 2 → 片 1。片 3 的 view 依賴片 1 的表;片 4 的 TS 讀片 1 的表。
- **片 1**
  - 函式回上一代逐字(釘本代 md5)。
  - `admin_confirm_hct_handover`、`pcm_order_ship_blocked` DROP。
  - clearance 表**不 DROP**,只保留:它是事實紀錄,舊函式不會讀也不會寫;DROP 會丟掉「誰在什麼狀態下出過貨」。
  - 期間經 3.4 寫下的 `hct_dispatched_at` 與稽核列保留。
- **片 2**:數 `pcm_incident.kind = 'auto_cancel_live_shipment'`。0 列 ⇒ CHECK 一起退;有列 ⇒ 只退函式、CHECK 保留擴充後的版本,印出列數。
- **片 3**:view 回上一代逐字。先數 `last_error_code = 'order_not_cleared_at_ship'` 的列並印出;那些信維持 skipped,不自動翻回。
- **不會被 rollback 撤銷的事實**:期間的取消、退款、incident、已寄或已跳過的信、clearance 列、人工確認交貨。
- 片 4、片 5 純 TS ⇒ revert 那顆 commit。
- 驗收第 ⑳ 格實跑一次:① 之後依序退片 3 → 2 → 1,印每一步停在哪、哪些資料留著。

## 10. 逐條對照

### R1

| # | codex 說 | 改在哪 | R2 判定 |
|---|---|---|---|
| ① 改單號信抄舊代 | 改抄第三代,條件放規則底面 | 片 3 | 已修 |
| ② 漏鎖並發加入的訂單 | 先鎖 shipment 凍結成員,集合含 `p_items`,空集合拒 | §4 | 已修 |
| ③ 插入位置與鎖序矛盾 | 全線 shipments → orders → items,鎖搬進重試子交易 | §4、片 1 | 已修 |
| ④ 任一箱已出就跳過 | Sean Q-B 甲:判準加 `card_fully_refunded` | 3.1、片 2、⑫㉑㉒㉓ | 修出 B3 ⇒ 見下 |
| ⑤ claim 後退款補不了紀錄 | 3.2 補記路 | 3.2、片 2、⑧⑨ | 修出 B1、B2 ⇒ 見下 |
| ⑥ 誤殺合法通知 | R2 版用時間戳 ⇒ 沒修好 ⇒ 本版改 3.3 資格證明表 | 3.3、片 3、片 4、㉔ | 見下 |
| ⑦ 已排入 / 重排繞過 view | 寄送端守 | 片 4、⑱ | 已修 |
| ⑧ 計數要同規則 | unsendable 與 candidates 一起改 | 片 3 | — |
| ⑨ record_hct_submit 含佔位 | 只擋 draft / failed → unknown | 片 1、⑥ | — |
| ⑩ rollback 有條件 | 單一交易、先檢查、CHECK 可保留、事實不撤 | §9、⑳ | — |
| ⑪ 閘只釘 md5 不夠 | 簽章 / config / owner / ACL / security_invoker 都量 | §8 | — |
| ⑫「還沒發生」措辭 | 改成「這次查詢沒有找到目前受影響的資料」 | §0、§2 | — |

### R2

| # | codex 說 | 改在哪 |
|---|---|---|
| ⑥ `now()` 是交易開始時間,時間戳比較會顛倒 | 不比時間:出貨 / 叫車持訂單鎖、判準通過時寫 clearance 列;掃描端三張 view 與寄送端 adapter 都只看有沒有這一列。時間只用在舊資料回填,排除數 > 0 就停 | 3.3、片 1、片 3、片 4、㉔㉟ |
| B1 叫車沒送出 / 被拒也能免檢查標出貨 | 補記只限 `hct_dispatched_at` 有值;沒送出 / 被拒 / 未知套 3.1;未知而確實交貨走 3.4 管理者確認(寫稽核) | 3.2、3.4、片 1、片 5、㉕㉖㉗ |
| B2 claim 後仍可加品項 | parent guard 加「已 claim ⇒ 拒」,真判準在 trigger | §4、片 1、㉘㉙ |
| B3 `tappay + refunded` 含人工 / 混合軌 | Sean 拍甲:要擋。判準不變,寫明是拍板;刪掉「範圍外」那段矛盾;`mixed_rail` skip 不變 | 3.1、片 2、片 5、§7、㉞ |
| should-fix 1 寄送端落帳介面、兩種事件重試驗收 | `markSkippedNotCleared` 照 `markSkippedShipmentVoided` 形狀(所有權檢查、清 claimed_at、計數);新表權限與讀取失敗行為寫明 | 片 4、3.3、⑱ |
| should-fix 2 退款狀態轉移與並發正反對照 | 部分退款放行、作廢與 claim 併發、已取消不因作廢解開、非刷卡範圍、混合軌 | ㉚㉛㉜㉝㉞ |
| nit 反序搜尋條件寫反 | 改成列「禁止的反序」,目標順序與子序列不算 | §4 |
| nit 全退後仍印「其餘商品會通知」 | adapter 算剩餘時,被擋的單當成沒有剩餘;兩份條件加對照測試 | 片 4 |

## 11. 範圍外

- 匯款 / 現金單全額退款後剩下沒出的要不要擋:這次只做刷卡單(3.1)。
- 稽核建議「出貨列表每列帶訂單狀態」:守門與候選清單已經擋住操作,先不做。

## 12. 估時

片 1 ~60 分(比 R2 多新表 + 回填 + 3.4 RPC,超過 45 分 ⇒ 開工時拆成「表 + 回填 + 3.4」與「五支守門」兩片)· 片 2 ~40 分 · 片 3 ~40 分 · 片 4 ~45 分 · 片 5 ~45 分 · codex 實作審三輪另計。
