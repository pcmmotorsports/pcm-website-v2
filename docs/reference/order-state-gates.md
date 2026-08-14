# 訂單狀態閘表(自動產生 —— 不要手改)

> 產生指令:`bash scripts/state-gates.sh`。**改了 migration 就重跑**,不要手工維護。
> 用途 = 回答「**這條路走得到嗎**」。寫 finding、寫 plan、判 BLOCKER 之前先查這張表。
>
> 🔴 **強度 = 「經由 RPC」,不是「絕對」。** service_role 可以直接 UPDATE 繞過下面所有閘
> (`supabase/migrations/20260611120000_m3_s2c_confirm_payment_rpc.sql:230` 逐字寫著這件事)。
> 🔴 **閘是字面比對抽出來的,不是 SQL 語意分析** ⇒ 可能漏掉「用變數繞一手」寫的閘。
> **每一格都附行號:下判斷前開檔看那一行,不要只信本表。**
> 🔴 **`docs/` 一律不採信** —— 本表只讀 `supabase/migrations/*.sql`。
> 今天的病根就是「文件寫的 ≠ 程式碼實際擋的」;文件有述而 code 找不到的,本表標「**docs 有述、code 未見**」。

## 一、同名函式被 CREATE OR REPLACE 過幾代(**只有時間戳最大那代是 live**)

| 函式 | 代數 | 各代 (檔:行) | 🔴 live 那代 |
|---|---|---|---|
| `admin_add_shipment_items` | **4** | 20260807150000_m4b_e10_b2_w1_shipping_rpc_skeletons.sql:119<br>20260807160000_m4b_e10_b2_w2_shipping_idempotency_layer.sql:631<br>20260807180000_m4b_e10_b2_w3b2_add_shipment_items.sql:83<br>20260807230000_m4b_e10_b2_w4b_impl_extract_and_no_batch.sql:294 | `20260807230000_m4b_e10_b2_w4b_impl_extract_and_no_batch.sql:294` |
| `admin_cancel_order` | **2** | 20260804180000_m4b_e10_a8a1_admin_cancel_order.sql:83<br>20260805100000_m4b_e10_a8a2_partial_cancel.sql:80 | `20260805100000_m4b_e10_a8a2_partial_cancel.sql:80` |
| `admin_compute_order_settlement` | **2** | 20260811030000_m4b_e10_op6a_compute_order_settlement.sql:50<br>20260812140000_m4b_lifecycle_refund_manual_reversal.sql:356 | `20260812140000_m4b_lifecycle_refund_manual_reversal.sql:356` |
| `admin_create_shipment` | **3** | 20260807150000_m4b_e10_b2_w1_shipping_rpc_skeletons.sql:96<br>20260807160000_m4b_e10_b2_w2_shipping_idempotency_layer.sql:599<br>20260807170000_m4b_e10_b2_w3a_create_shipment.sql:83 | `20260807170000_m4b_e10_b2_w3a_create_shipment.sql:83` |
| `admin_initiate_order_refund` | **2** | 20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:423<br>20260812170000_m4b_lifecycle_l5b2_2f_initiate_advisory.sql:480 | `20260812170000_m4b_lifecycle_l5b2_2f_initiate_advisory.sql:480` |
| `admin_mark_shipment_shipped` | **4** | 20260807150000_m4b_e10_b2_w1_shipping_rpc_skeletons.sql:140<br>20260807160000_m4b_e10_b2_w2_shipping_idempotency_layer.sql:659<br>20260807190000_m4b_e10_b2_w3c3_mark_shipped.sql:110<br>20260808100000_m4b_e10_b2_w7d1_ship_deadlock_retry.sql:177 | `20260808100000_m4b_e10_b2_w7d1_ship_deadlock_retry.sql:177` |
| `admin_record_item_receipt` | **3** | 20260810233000_m4b_e10_352a2_receipt_write_rpcs.sql:53<br>20260811010000_m4b_e10_352c_item_level_room_guard.sql:23<br>20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql:608 | `20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql:608` |
| `admin_record_manual_payment` | **2** | 20260810200000_m4b_e10_op5_record_manual_payment.sql:106<br>20260812150000_m4b_e10_423_payment_audit.sql:74 | `20260812150000_m4b_e10_423_payment_audit.sql:74` |
| `admin_reverse_manual_payment` | **2** | 20260810210000_m4b_e10_opa12_reverse_manual_payment.sql:80<br>20260812150000_m4b_e10_423_payment_audit.sql:344 | `20260812150000_m4b_e10_423_payment_audit.sql:344` |
| `admin_search_orders` | **2** | 20260809180000_m4b_347_1_admin_search_orders.sql:158<br>20260810120000_m4b_347_3a_admin_search_orders_date_range.sql:65 | `20260810120000_m4b_347_3a_admin_search_orders_date_range.sql:65` |
| `admin_unvoid_shipment` | **4** | 20260807150000_m4b_e10_b2_w1_shipping_rpc_skeletons.sql:182<br>20260807160000_m4b_e10_b2_w2_shipping_idempotency_layer.sql:715<br>20260807210000_m4b_e10_b2_w3c2_unvoid_shipment.sql:75<br>20260808100000_m4b_e10_b2_w7d1_ship_deadlock_retry.sql:413 | `20260808100000_m4b_e10_b2_w7d1_ship_deadlock_retry.sql:413` |
| `admin_update_order_workflow` | **2** | 20260714130000_m4a_admin_update_order_workflow_rpc.sql:59<br>20260716130000_m4a_admin_update_order_item_workflow_rpc.sql:217 | `20260716130000_m4a_admin_update_order_item_workflow_rpc.sql:217` |
| `admin_upsert_item_procurement` | **3** | 20260803160000_m4b_e10_a5a_admin_upsert_item_procurement.sql:107<br>20260806200000_m4b_e10_a9h_m_a5a_preserve_optional_fields.sql:79<br>20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql:168 | `20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql:168` |
| `admin_void_shipment` | **4** | 20260807150000_m4b_e10_b2_w1_shipping_rpc_skeletons.sql:161<br>20260807160000_m4b_e10_b2_w2_shipping_idempotency_layer.sql:687<br>20260807200000_m4b_e10_b2_w3c1_void_shipment.sql:62<br>20260808100000_m4b_e10_b2_w7d1_ship_deadlock_retry.sql:308 | `20260808100000_m4b_e10_b2_w7d1_ship_deadlock_retry.sql:308` |
| `begin_charge_attempt` | **5** | 20260612150000_m3_s2d_charge_attempts.sql:168<br>20260613130000_m3_3ds_0b_cart_session_dedup.sql:350<br>20260613140000_m3_3ds_0c_bank_txn_pending_invoices.sql:73<br>20260804120000_m4b_e10_a8c1_begin_cancel_guard.sql:71<br>20260809210000_m4b_lifecycle_l4a1_begin_in_flight_order_id.sql:63 | `20260809210000_m4b_lifecycle_l4a1_begin_in_flight_order_id.sql:63` |
| `claim_order_poll_settle` | **2** | 20260621120000_m3_3ds_s2b_poll_settle_throttle.sql:53<br>20260624120009_m3_3ds_r1c2_poll_settle_released_predicate.sql:61 | `20260624120009_m3_3ds_r1c2_poll_settle_released_predicate.sql:61` |
| `claim_stuck_unsettled_attempts` | **4** | 20260615120001_m3_3ds_4a2_attempt_sweeper_rpc.sql:116<br>20260624120008_m3_3ds_r1c1_sweeper_released_policy.sql:80<br>20260810220000_m4b_lifecycle_l5b0s_supersede_sweeper_ceiling.sql:206<br>20260811060000_m4b_lifecycle_l5b2_2a_claim_returns_superseded_at.sql:117 | `20260811060000_m4b_lifecycle_l5b2_2a_claim_returns_superseded_at.sql:117` |
| `close_released_attempt` | **2** | 20260624120010_m3_3ds_r1c3_close_released_attempt.sql:62<br>20260812160000_m4b_lifecycle_l5b2_2e_close_advisory.sql:169 | `20260812160000_m4b_lifecycle_l5b2_2e_close_advisory.sql:169` |
| `confirm_order_payment` | **4** | 20260611120000_m3_s2c_confirm_payment_rpc.sql:117<br>20260804150000_m4b_e10_a8c2_confirm_cancel_guard.sql:52<br>20260810160000_m4b_e10_op3_confirm_card_leg.sql:362<br>20260810170000_m4b_lifecycle_l5b0_reject_superseded_charge.sql:328 | `20260810170000_m4b_lifecycle_l5b0_reject_superseded_charge.sql:328` |
| `create_order` | **8** | 20260604130000_m3_s2b1_create_order_rpc.sql:47<br>20260613130000_m3_3ds_0b_cart_session_dedup.sql:107<br>20260614130000_m3_create_order_stock_snapshot.sql:49<br>20260630120000_m3_241_checkout_consent.sql:75<br>20260716190000_m4a_v3a_create_order_vehicle_whitelist.sql:34<br>20260716200000_m4a_v3a_create_order_vehicle_type_guard.sql:34<br>20260719120000_m4a_b2_create_order_notification_email.sql:224<br>20260730120100_m4b_e10_n3b_create_order_new_display_id.sql:181 | `20260730120100_m4b_e10_n3b_create_order_new_display_id.sql:181` |
| `expire_stuck_attempts_at_ceiling` | **2** | 20260615120001_m3_3ds_4a2_attempt_sweeper_rpc.sql:86<br>20260810220000_m4b_lifecycle_l5b0s_supersede_sweeper_ceiling.sql:412 | `20260810220000_m4b_lifecycle_l5b0s_supersede_sweeper_ceiling.sql:412` |
| `get_active_charge_attempt` | **2** | 20260614120000_m3_3ds_1b_get_active_charge_attempt.sql:47<br>20260624120007_m3_3ds_r1b3_record_released_failure_observation.sql:135 | `20260624120007_m3_3ds_r1b3_record_released_failure_observation.sql:135` |
| `get_payment_anomaly_alert_summary` | **3** | 20260701120000_m3_250_anomaly_alert_summary.sql:42<br>20260701130000_m3_256_pending_double_charge_detection.sql:43<br>20260810220000_m4b_lifecycle_l5b0s_supersede_sweeper_ceiling.sql:316 | `20260810220000_m4b_lifecycle_l5b0s_supersede_sweeper_ceiling.sql:316` |
| `mark_attempt_settle_retry` | **5** | 20260615120001_m3_3ds_4a2_attempt_sweeper_rpc.sql:192<br>20260624120008_m3_3ds_r1c1_sweeper_released_policy.sql:126<br>20260702120000_m3_251_retry_reason_allowlist_released_failure_observed.sql:50<br>20260809140000_m4b_lifecycle_l2_retry_reason_record_not_found.sql:89<br>20260810220000_m4b_lifecycle_l5b0s_supersede_sweeper_ceiling.sql:261 | `20260810220000_m4b_lifecycle_l5b0s_supersede_sweeper_ceiling.sql:261` |
| `mark_charge_attempt_charged_fallback` | **2** | 20260612150000_m3_s2d_charge_attempts.sql:351<br>20260810170000_m4b_lifecycle_l5b0_reject_superseded_charge.sql:241 | `20260810170000_m4b_lifecycle_l5b0_reject_superseded_charge.sql:241` |
| `mark_charge_attempt_charged` | **3** | 20260612150000_m3_s2d_charge_attempts.sql:240<br>20260624120005_m3_3ds_r1b1c_markcharged_released_genesis.sql:64<br>20260810170000_m4b_lifecycle_l5b0_reject_superseded_charge.sql:127 | `20260810170000_m4b_lifecycle_l5b0_reject_superseded_charge.sql:127` |
| `mark_charge_attempt_failed` | **2** | 20260612150000_m3_s2d_charge_attempts.sql:302<br>20260624120006_m3_3ds_r1b2_markfailed_order_paid_guard.sql:59 | `20260624120006_m3_3ds_r1b2_markfailed_order_paid_guard.sql:59` |
| `mark_webhook_retry` | **3** | 20260615120000_m3_3ds_4a1_webhook_sweeper_rpc.sql:125<br>20260702120000_m3_251_retry_reason_allowlist_released_failure_observed.sql:98<br>20260809140000_m4b_lifecycle_l2_retry_reason_record_not_found.sql:137 | `20260809140000_m4b_lifecycle_l2_retry_reason_record_not_found.sql:137` |
| `pcm_a2b1_procurement_allocation_guard` | **2** | 20260803130000_m4b_e10_a2b1_procurement_allocation_guard.sql:102<br>20260813120000_m4b_e10_452_procurement_void_schema.sql:395 | `20260813120000_m4b_e10_452_procurement_void_schema.sql:395` |
| `pcm_a4a_recompute_order_item_summary` | **3** | 20260803140000_m4b_e10_a4a_quantity_summary_recompute.sql:140<br>20260806180000_m4b_e10_b2_s2b_shipped_recompute_wire.sql:180<br>20260813120000_m4b_e10_452_procurement_void_schema.sql:465 | `20260813120000_m4b_e10_452_procurement_void_schema.sql:465` |
| `pcm_a7c_refund_immutable_guard` | **2** | 20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:293<br>20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:301 | `20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:301` |
| `pcm_a7c_refund_insert_guard` | **2** | 20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:200<br>20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:224 | `20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:224` |
| `pcm_b2_shipping_human_error` | **2** | 20260807190000_m4b_e10_b2_w3c3_mark_shipped.sql:71<br>20260808100000_m4b_e10_b2_w7d1_ship_deadlock_retry.sql:112 | `20260808100000_m4b_e10_b2_w7d1_ship_deadlock_retry.sql:112` |
| `pcm_b2_shipping_idem_freeze_identity` | **2** | 20260807140000_m4b_e10_b2_w0b_shipping_idempotency.sql:153<br>20260807160000_m4b_e10_b2_w2_shipping_idempotency_layer.sql:463 | `20260807160000_m4b_e10_b2_w2_shipping_idempotency_layer.sql:463` |
| `pcm_b2_shipping_idem_require_complete` | **2** | 20260807160000_m4b_e10_b2_w2_shipping_idempotency_layer.sql:531<br>20260809200000_m4b_e10_b2_w2_stub_verifies_artifact.sql:51 | `20260809200000_m4b_e10_b2_w2_stub_verifies_artifact.sql:51` |
| `pcm_order_refund_status_transition` | **2** | 20260725130100_m3_rf2a2_order_refunds_ledger.sql:287<br>20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:201 | `20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:201` |
| `pcm_order_refundable_remaining` | **3** | 20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:450<br>20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:394<br>20260814190000_m4b_e10_473b1_refund_manual_corrections.sql:403 | `20260814190000_m4b_e10_473b1_refund_manual_corrections.sql:403` |
| `pcm_refund_ledger_block_truncate` | **2** | 20260725130100_m3_rf2a2_order_refunds_ledger.sql:253<br>20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:418 | `20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:418` |
| `search_catalog_by_vehicle` | **4** | 20260712193000_catalog_rpc_expose_fitments.sql:10<br>20260712213000_p4_catalog_rpc_split_generic_plan_replay.sql:8<br>20260719150000_catalog_product_image_trim.sql:73<br>20260811040000_m4b_storefront_269b_catalog_new_arrivals.sql:266 | `20260811040000_m4b_storefront_269b_catalog_new_arrivals.sql:266` |
| `sql` | **2** | 20260712183000_products_catalog_page_public.sql:37<br>20260712183000_products_catalog_page_public.sql:111 | `20260712183000_products_catalog_page_public.sql:111` |

> 只列 **>1 代**的。單代函式不會有「引用到過期世代」的風險,故省略。

## 二、會改訂單狀態的函式 × 它的允許集合(逐字)

### `confirm_order_payment`  ·  `20260611120000_m3_s2c_confirm_payment_rpc.sql`

**改什麼狀態**

`:178` SET payment_status      = 'paid'::public.payment_status,

**允許集合(逐字)**

`:150` IF v_order.payment_status = 'paid'::public.payment_status THEN<br>`:160` IF v_order.payment_status <> 'unpaid'::public.payment_status THEN<br>`:184` AND payment_status = 'unpaid'::public.payment_status;

### `admin_finalize_order_refund`  ·  `20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql`

**改什麼狀態**

`:726` UPDATE public.order_refunds<br>`:736` UPDATE public.order_refunds<br>`:742` UPDATE public.order_refunds SET status = 'deferred'<br>`:746` UPDATE public.order_refunds<br>`:754` UPDATE public.order_refunds<br>`:759` UPDATE public.order_refunds<br>`:781` UPDATE public.orders SET payment_status = v_target::public.payment_status

**允許集合(逐字)**

`:773` IF v_ps NOT IN ('paid', 'partiallyRefunded', 'refunded') THEN<br>`:781` UPDATE public.orders SET payment_status = v_target::public.payment_status

### `admin_initiate_order_refund`  ·  `20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql`

**改什麼狀態**

`:549` INSERT INTO public.order_refunds

**允許集合(逐字)**

`:530` IF v_ps NOT IN ('paid', 'partiallyRefunded') THEN

### `confirm_order_payment`  ·  `20260804150000_m4b_e10_a8c2_confirm_cancel_guard.sql`

**改什麼狀態**

`:127` SET payment_status      = 'paid'::public.payment_status,

**允許集合(逐字)**

`:93` IF v_order.cancelled_at IS NOT NULL<br>`:94` OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN<br>`:99` IF v_order.payment_status = 'paid'::public.payment_status THEN<br>`:109` IF v_order.payment_status <> 'unpaid'::public.payment_status THEN<br>`:133` AND payment_status = 'unpaid'::public.payment_status;<br>`:151` 'M-3-S2-c 付款確認(SECURITY DEFINER 零 service_role、search_path='''')。只 payment_confirmer 可呼;🔴 E10-A8c2 取消守門(master plan row 35;R8 守門先於取消):隔離閘(非 READ COMMITTED 一律 P8C01)→ PF-B FOR UPDATE(加讀 cancelled_at)→ 取消守門(cancelled_at 非空或 order_cancellations 任一列 ⇒ 通用 RAISE;真相表直讀;位置在 paid 冪等樹之前 ⇒ 已取消且已 paid 的同 rec 同額重放不得回 idempotent 成功)→ PF-D 冪等樹:unpaid + p_amount=orders.total + rec_trade_id 非空且未用於別單 → 翻 paid 寫 5 欄(零 fulfillment、PF-G);paid+同 rec+同 amount 重放冪等 no-op(不刷時間戳);refunded/partiallyPaid 即使同 rec 也拒。PF-C row_count 守 + PF-E 通用訊息(#219 harden)+ UNIQUE 並發 backstop。零經銷價/cost。';<br>`:165` IF position('IF v_order.cancelled_at IS NOT NULL' in v_def) = 0<br>`:166` OR position('OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)' in v_def) = 0 THEN<br>`:179` IF position('IF v_order.cancelled_at IS NOT NULL' in v_def)<br>`:180` >= position('IF v_order.payment_status = ''paid''::public.payment_status THEN' in v_def) THEN<br>`:226` WHERE c.oid IN ('public.orders'::regclass, 'public.order_cancellations'::regclass)

### `admin_cancel_order`  ·  `20260804180000_m4b_e10_a8a1_admin_cancel_order.sql`

**改什麼狀態**

`:227` INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)<br>`:231` INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)<br>`:242` SET cancelled_at = pg_catalog.now(),<br>`:314` IF position('INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)' in v_def) = 0 THEN<br>`:360` >= position('INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)' in v_def) THEN

**允許集合(逐字)**

`:154` FROM public.order_cancellations<br>`:169` IF v_order.cancelled_at IS NULL<br>`:171` OR v_order.payment_status <> 'unpaid'::public.payment_status<br>`:176` WHERE pa.order_id = p_order_id AND pa.status <> 'failed')<br>`:188` IF v_order.cancelled_at IS NOT NULL<br>`:189` OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN<br>`:199` IF v_order.payment_status <> 'unpaid'::public.payment_status<br>`:201` WHERE a.order_id = p_order_id AND a.status <> 'failed') THEN<br>`:227` INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)<br>`:302` IF position('OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)' in v_def) = 0 THEN<br>`:314` IF position('INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)' in v_def) = 0 THEN<br>`:352` >= position('OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)' in v_def)<br>`:353` OR position('OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)' in v_def)<br>`:360` >= position('INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)' in v_def) THEN<br>`:393` 'public.order_cancellations'::regclass, 'public.order_cancellation_items'::regclass,

### `admin_cancel_order`  ·  `20260805100000_m4b_e10_a8a2_partial_cancel.sql`

**改什麼狀態**

`:428` INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)<br>`:433` INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)<br>`:438` INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)<br>`:464` SET cancelled_at = pg_catalog.now(),<br>`:597` >= position('INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)' in v_def) THEN

**允許集合(逐字)**

`:202` FROM public.order_cancellations<br>`:223` IF (v_order.cancelled_at IS NOT NULL) <> (NOT EXISTS (<br>`:230` IF v_order.cancelled_at IS NULL THEN<br>`:255` JOIN public.order_cancellations c ON c.id = (g.after->>'cancellation_id')::uuid<br>`:290` IF v_order.payment_status <> 'unpaid'::public.payment_status<br>`:292` WHERE pa.order_id = p_order_id AND pa.status <> 'failed') THEN<br>`:331` IF v_closed AND v_order.cancelled_at IS NULL THEN<br>`:339` IF v_order.cancelled_at IS NOT NULL THEN<br>`:347` OR EXISTS (SELECT 1 FROM public.order_cancellations c<br>`:360` IF v_order.payment_status <> 'unpaid'::public.payment_status<br>`:362` WHERE a.order_id = p_order_id AND a.status <> 'failed') THEN<br>`:428` INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)<br>`:560` IF position('OR EXISTS (SELECT 1 FROM public.order_cancellations c' in v_def) = 0 THEN<br>`:589` >= position('OR EXISTS (SELECT 1 FROM public.order_cancellations c' in v_def)<br>`:590` OR position('OR EXISTS (SELECT 1 FROM public.order_cancellations c' in v_def)<br>`:597` >= position('INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)' in v_def) THEN<br>`:629` 'public.order_cancellations'::regclass, 'public.order_cancellation_items'::regclass,

### `(檔案層 DO block / 非函式內)`  ·  `20260809160000_m4b_lifecycle_l3a_expire_unpaid_orders_fn.sql`

**改什麼狀態**

`:173` SET cancelled_at     = pg_catalog.now(),

**允許集合** — 🔴 **本函式體內零命中**(字面比對)⇒ 要嘛它沒有狀態閘、要嘛閘的寫法本腳本抓不到。**開檔確認,不要當成「沒有閘」。**

### `confirm_order_payment`  ·  `20260810160000_m4b_e10_op3_confirm_card_leg.sql`

**改什麼狀態**

`:448` SET payment_status      = 'paid'::public.payment_status,

**允許集合(逐字)**

`:403` IF v_order.cancelled_at IS NOT NULL<br>`:404` OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN<br>`:411` IF v_order.payment_status = 'paid'::public.payment_status THEN<br>`:421` IF v_order.payment_status <> 'unpaid'::public.payment_status THEN<br>`:454` AND payment_status = 'unpaid'::public.payment_status;<br>`:536` 'M-3-S2-c 付款確認(SECURITY DEFINER 零 service_role、search_path='''')。只 payment_confirmer 可呼;🔴 E10-A8c2 取消守門(master plan row 35;R8 守門先於取消):隔離閘(非 READ COMMITTED 一律 P8C01)→ PF-B FOR UPDATE(加讀 cancelled_at)→ 取消守門(cancelled_at 非空或 order_cancellations 任一列 ⇒ 通用 RAISE;真相表直讀;位置在 paid 冪等樹之前 ⇒ 已取消且已 paid 的同 rec 同額重放不得回 idempotent 成功)→ PF-D 冪等樹:unpaid + p_amount=orders.total + rec_trade_id 非空且未用於別單 → 翻 paid 寫 5 欄(零 fulfillment、PF-G);paid+同 rec+同 amount 重放冪等 no-op(不刷時間戳);refunded/partiallyPaid 即使同 rec 也拒。PF-C row_count 守 + PF-E 通用訊息(#219 harden)+ UNIQUE 並發 backstop。零經銷價/cost。'<br>`:572` IF position('IF v_order.cancelled_at IS NOT NULL' in v_code) = 0<br>`:573` OR position('OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)' in v_code) = 0 THEN<br>`:585` IF position('IF v_order.cancelled_at IS NOT NULL' in v_code)<br>`:586` >= position('IF v_order.payment_status = ''paid''::public.payment_status THEN' in v_code) THEN<br>`:636` IF position('IF v_order.payment_status = ''paid''::public.payment_status THEN' in v_code)<br>`:734` WHERE c.oid IN ('public.orders'::regclass, 'public.order_cancellations'::regclass,<br>`:760` 'SECDEF 對 orders/order_cancellations/order_payments/staff 四張表 owner 對齊且 FORCE RLS 全關、'

### `confirm_order_payment`  ·  `20260810170000_m4b_lifecycle_l5b0_reject_superseded_charge.sql`

**改什麼狀態**

`:436` SET payment_status      = 'paid'::public.payment_status,

**允許集合(逐字)**

`:369` IF v_order.cancelled_at IS NOT NULL<br>`:370` OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN<br>`:399` IF v_order.payment_status = 'paid'::public.payment_status THEN<br>`:409` IF v_order.payment_status <> 'unpaid'::public.payment_status THEN<br>`:442` AND payment_status = 'unpaid'::public.payment_status;<br>`:523` 'M-3-S2-c 付款確認(SECURITY DEFINER 零 service_role、search_path='''')。只 payment_confirmer 可呼;🔴 E10-A8c2 取消守門(master plan row 35;R8 守門先於取消):隔離閘(非 READ COMMITTED 一律 P8C01)→ PF-B FOR UPDATE(加讀 cancelled_at)→ 取消守門(cancelled_at 非空或 order_cancellations 任一列 ⇒ 通用 RAISE;真相表直讀;位置在 paid 冪等樹之前 ⇒ 已取消且已 paid 的同 rec 同額重放不得回 idempotent 成功)→ PF-D 冪等樹:unpaid + p_amount=orders.total + rec_trade_id 非空且未用於別單 → 翻 paid 寫 5 欄(零 fulfillment、PF-G);paid+同 rec+同 amount 重放冪等 no-op(不刷時間戳);refunded/partiallyPaid 即使同 rec 也拒。PF-C row_count 守 + PF-E 通用訊息(#219 harden)+ UNIQUE 並發 backstop。零經銷價/cost。'<br>`:592` v_idem := pg_catalog.strpos(v_code, 'IF v_order.payment_status = ''paid''::public.payment_status THEN');

### `admin_initiate_order_refund`  ·  `20260812170000_m4b_lifecycle_l5b2_2f_initiate_advisory.sql`

**改什麼狀態**

`:653` INSERT INTO public.order_refunds<br>`:800` i_ins := pg_catalog.strpos(v_stripped, 'INSERT INTO public.order_refunds');<br>`:802` RAISE EXCEPTION '2f 後置①b2:跨帳本否決(位置 %)必須早於步 8 的 INSERT INTO public.order_refunds(位置 %)'

**允許集合(逐字)**

`:598` IF v_ps NOT IN ('paid', 'partiallyRefunded') THEN

---

## 三、自測:本表答得出「已付款的單能不能取消品項」嗎?

把上面第二段裡 `admin_cancel_order` 與 `admin_partial_cancel_order` 的「允許集合」讀一次:
若看得到 `payment_status <> 'unpaid' … RAISE`,答案就是**不能**。
再讀 `confirm_order_payment` 的允許集合:若看得到 `order_cancellations … RAISE`,
表示反向也封死(有取消紀錄的單不能再收款)⇒ **「已付款」與「有取消紀錄」經由 RPC 互斥。**

🔴 **答不出來就是本腳本白做**,請當成 bug 回報,不要靠記憶補。
