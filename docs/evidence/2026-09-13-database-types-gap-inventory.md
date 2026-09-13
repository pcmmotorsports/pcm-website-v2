# 型別缺口清單(database.types.ts vs 正式庫)

> **本清單以 2026-09-13 20:07 CST 正式庫唯讀讀數為準,過期就不算。**
> 產法:`bash scripts/readonly-prod-sql.sh`,對 `information_schema.tables` / `information_schema.columns`(`table_schema='public'`)全表逐欄跟
> `packages/adapters/src/supabase/database.types.ts` 目前內容(commit `4aa562d4f`,`dev` 分支)做程式化 diff,非人工目視。
> 🛑 **零實作、零 commit、沒有改 `database.types.ts`。** 這份只是清單。
> 負對照:假表名 `zzz_this_table_does_not_exist_negctrl` 查 0 列 ⇒ 讀的是真庫、不是連線失敗。
> `information_schema.tables where table_type='BASE TABLE'` 計數 = **60**,與清單筆數相符。

## ⚠️ 與主視窗 2026-09-13 稍早那次比對的差異(不要照抄那份,那份已過期)

舊版寫「缺 9 欄 + 缺 12 張表」。這次重比之後:

- **缺表從 12 → 10**:`order_manual_refunds`、`payment_charge_attempts` 兩張表其實**已經在** `database.types.ts`(行 1623、2467),舊清單誤列。
- **缺欄從 9 → 9,但內容不同**:`orders.price_tax_mode` 這次確認**已補**(A 窗 `agent/shop-6`,已合進 `dev`,型別檔行 2316 區塊內可查到)。但多抓到一個舊清單沒列的 **`email_outbox.handed_to_provider_at`**,所以欄位缺口總數維持 9,但成分換了一個。
- 反向檢查(型別檔有、正式庫沒有的表或欄)= **0 筆**,兩邊都做過。

## 摘要

- **缺表:10 張**(正式庫有、`database.types.ts` 完全沒有這個 key)
- **缺欄:9 個**(表已在型別檔裡,但漏了個別欄位),分布在 5 張表
- **反向(型別檔有 / 正式庫沒有):0**
- **碰錢或碰權限的缺口(表或欄):8 個**(見下面各表/欄旁的標記)
- **檔頭「重 gen 要重貼」清單完全沒提到**下面任何一張缺表或任一個缺欄(除 `email_outbox.sent_seq`,見備註)——代表這批缺口不是「已知在排隊補」,是**目前無人追蹤**的落後。

---

## 一、缺表(正式庫有,`database.types.ts` 沒有這個 key)

出處:`information_schema.tables`(唯讀讀數,2026-09-13 20:07 CST)vs `packages/adapters/src/supabase/database.types.ts` 第 638–3559 行(public.Tables 區塊)逐 key 比對,`grep -c` 確認「重 gen 要重貼」檔頭清單(第 1–612 行)裡完全沒提到表名。

| 表名 | 碰錢/權限 | 完整欄位形狀(欄 / 型別 / nullable / default) |
|---|---|---|
| `admin_saved_order_views` | 否(後台 UI 偏好,员工存的查詢視圖) | `id bigint NOT NULL` · `staff_id text NULL` · `is_shared boolean NULL` · `label text NOT NULL` · `query text NOT NULL` · `date_preset text NULL` · `idempotency_key text NULL` · `created_at timestamptz NOT NULL DEFAULT now()` · `updated_at timestamptz NOT NULL DEFAULT now()` |
| `auth_callback_events` | **權限**(OAuth/登入 callback 事件計數) | `id bigint NOT NULL` · `provider text NOT NULL` · `outcome text NOT NULL` · `reason_code text NULL` · `event_day date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Taipei')::date` · `hits bigint NOT NULL DEFAULT 1` · `created_at timestamptz NOT NULL DEFAULT now()` · `last_seen_at timestamptz NOT NULL DEFAULT now()` |
| `coupon_redemptions` | **錢**(券折抵紀錄) | `id uuid NOT NULL DEFAULT gen_random_uuid()` · `coupon_id uuid NOT NULL` · `order_id uuid NOT NULL` · `user_id uuid NOT NULL` · `discount_applied integer NOT NULL` · `reverted_at timestamptz NULL` · `reverted_by text NULL` · `created_at timestamptz NOT NULL DEFAULT now()` |
| `coupons` | **錢**(折價券主檔:折扣類型/值/門檻) | `id uuid NOT NULL DEFAULT gen_random_uuid()` · `code text NOT NULL` · `description text NOT NULL DEFAULT ''` · `discount_type text NOT NULL` · `discount_value integer NOT NULL` · `ends_on date NULL` · `max_redemptions integer NULL` · `max_per_account integer NULL` · `min_spend integer NOT NULL DEFAULT 0` · `stacks_with_tier boolean NOT NULL` · `is_active boolean NOT NULL DEFAULT true` · `created_by text NOT NULL` · `created_at timestamptz NOT NULL DEFAULT now()` |
| `order_pending_refunds` | **錢**(退款待結清佇列,金額 + 結清狀態) | `id uuid NOT NULL DEFAULT gen_random_uuid()` · `order_id uuid NOT NULL` · `cancellation_id uuid NULL` · `rail text NOT NULL` · `amount_at_cancel bigint NOT NULL` · `opened_at timestamptz NOT NULL DEFAULT now()` · `settled_at timestamptz NULL` · `settled_manual_refund_id uuid NULL` · `voided_at timestamptz NULL` · `void_reason text NULL` |
| `orders_deleted_log` | **錢 + 權限**(訂單刪除稽核,含 `definer_user`/`session_role`/`jwt_claims`) | `id bigint NOT NULL` · `deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()` · `source_table text NOT NULL` · `order_id uuid NULL` · `row_data jsonb NOT NULL` · `definer_user text NOT NULL` · `session_role text NOT NULL` · `application_name text NULL` · `client_addr inet NULL` · `backend_pid integer NULL` · `txid bigint NULL` · `jwt_claims jsonb NULL` |
| `pcm_acl_snapshot_digest` | **權限**(ACL 快照摘要 + 審核紀錄) | `taken_at timestamptz NOT NULL DEFAULT now()` · `digest text NOT NULL` · `row_count integer NOT NULL` · `families jsonb NOT NULL` · `approved_at timestamptz NULL` · `approved_note text NULL` |
| `pcm_settle_retry_attempts` | **錢**(付款結清重試計數,`order_id` 掛勾) | `order_id uuid NOT NULL` · `attempts integer NOT NULL DEFAULT 0` · `last_attempt_at timestamptz NOT NULL DEFAULT now()` · `gave_up_at timestamptz NULL`(注意:`ordinal_position` 從 3 跳到 5,中間第 4 欄已被 `DROP COLUMN`,不是本次讀漏 —— Postgres 刪欄不會重編號) |
| `search_queries` | 否(搜尋紀錄) | `id bigint NOT NULL` · `query_raw text NOT NULL` · `path text NOT NULL` · `unmatched text NULL` · `result_count integer NULL` · `created_at timestamptz NOT NULL DEFAULT date_trunc('hour', now())` |
| `supplier_sync_runs` | 否(供應商同步跑批紀錄) | `id bigint NOT NULL` · `supplier_slug text NOT NULL` · `started_at timestamptz NOT NULL DEFAULT now()` · `completed_at timestamptz NULL` · `outcome text NULL` |

## 二、缺欄(表已在型別檔,漏個別欄位)

出處:`information_schema.columns` 唯讀讀數 vs 型別檔對應表的 `Row` 區塊逐欄比對。

| 表 | 缺欄 | 型別 / nullable / default | 型別檔行號(該表 key 起點) | 「重 gen 要重貼」檔頭有沒有提到 |
|---|---|---|---|---|
| `customer_wallet_ledger` | `request_id` | `text NULL` | 行 1000 | 沒有(0 命中) —— **碰錢**(儲值金流水帳) |
| `customers` | `gender` | `text NULL` | 行 1048 | 沒有(0 命中) |
| `email_outbox` | `sent_seq` | `bigint NULL` | 行 1087 | **有陳跡但沒補**:檔頭 163 行 2026-09-06 那次唯讀複驗自己寫著「三新欄型別 `sent_seq=bigint`…」,證實那時就已知道正式庫有這欄,但型別檔至今沒補進 `Row`/`Insert`/`Update` |
| `email_outbox` | `handed_to_provider_at` | `timestamptz NULL` | 行 1087 | 沒有(0 命中)——**舊清單(主視窗稍早那次)漏掉這一欄,這次重比才抓到** |
| `orders` | `cancel_items_untouched` | `boolean NOT NULL DEFAULT false` | 行 2316 | 沒有(0 命中) —— **碰錢**(取消品項是否被動過,影響退款判斷) |
| `orders` | `coupon_id` | `uuid NULL` | 行 2316 | 沒有(0 命中) —— **碰錢**(訂單掛的折價券) |
| `products` | `description_locked` | `boolean NOT NULL DEFAULT false` | 行 3268 | 沒有(0 命中) |
| `products` | `description_locked_at` | `timestamptz NULL` | 行 3268 | 沒有(0 命中) |
| `products` | `description_locked_by` | `text NULL` | 行 3268 | 沒有(0 命中) |

**已確認不是缺口、不要重補**:`orders.price_tax_mode` —— 已在型別檔(2026-09-13 檔頭自述,A 窗 `agent/shop-6` 補進,已合進 `dev`)。

## 三、反向(型別檔有,正式庫沒有)

**0 筆。** `comm -13` 對 60 張正式庫表 vs 50 張型別檔表跑過,以及 50 張共同表的全欄位比對,均無型別檔獨有的表或欄。這代表目前沒有「碼以為有其實庫沒有」這種更危險的落後。

## 沒比到的

- 只比了 `public` schema 的**基礎表**(`BASE TABLE`),**Views / Functions / Enums 沒比**——那塊本來就是型別檔另一個已知在追蹤的巨大落後區(檔頭自述「非註解結構 diff 新增 2952 行」),不在這次「表 + 欄」缺口盤點範圍內,背景交辦也只指名欄位清單。
- 沒比 `graphql_public` schema(型別檔裡的 `graphql` 表是那個 schema 的,不影響 `public` 缺口清單)。
- 沒查每張缺表 / 缺欄有沒有掛 RLS 或 GRANT(那是另一片,這份只管型別形狀)。
