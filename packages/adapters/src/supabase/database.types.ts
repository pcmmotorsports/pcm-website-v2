// database.types.ts — Supabase 生成型別(勿手改;以下命令重 gen 後此檔含中文檔頭會被沖掉、需重貼本段)。
// 🔴🔴 重 gen 後要重貼的**不只中文檔頭** —— 本體另有**六個函式、共二十處**手動校正:
//   ① `create_order.Args` 三處(p_client_ip / p_client_ua / p_notification_email 的 `| null`)
//   ② `admin_upsert_supplier.Args` 四處(p_supplier_id / p_label / p_is_active / p_note 的 `| null`)
//   ③ `admin_append_order_note.Args` **三處**(p_channel / p_occurred_at / p_corrects_note_id 的 `| null`;2026-08-02 A6 起)
//   ④ `admin_initiate_order_refund.Args` **兩處**(p_amount / p_record_amount 的 `| null`;2026-08-04 RW2c 起)
//   ⑤ `admin_finalize_order_refund.Args` **三處**(p_tappay_refund_id / p_refund_amount_wire / p_failed_detail 的 `| null`;同 RW2c)
//   ⑥ `admin_upsert_item_procurement.Args` **五處**(p_contact_channel / p_submitted_at / p_supplier_order_no /
//      p_exception_reason / p_expected_arrival_date 的 `| null`;2026-08-04 A10b 起 —— A5a 落地時刻意不補,
//      補了也沒有呼叫端會被 typecheck 守住;A10b 是第一個呼叫端,補在這一刻才有保護力)
//   共同根因:PostgREST 的型別產生器表達不了「必填但可為 null」,一律型別化為非 null。
//   漏貼 ① = 金流建單路徑型別紅;漏貼 ② = 供應商設定頁型別紅;漏貼 ③ = 備註線 A9d2-1 寫 internal note 時型別紅
//   (internal 這個型別**必須**三個都傳 NULL —— 那是 order_notes 的配對規則 CHECK);
//   漏貼 ④⑤ = 退款線 RW2c repository 型別紅(kind/outcome 互斥矩陣的「必須傳 NULL」全紅);
//   漏貼 ⑥ = A10b 採購表單只要有任一選填欄留空就型別紅(全量 payload、空欄就是送 NULL)。
//   2026-08-01 ① 已被沖掉三次(A7c、S1b、S2)、② 自 S2 起存在;2026-08-02 A6 起共十處;
//   2026-08-04 RW2c(④⑤)+ A10b(⑥)同夜各補五處、合流後共二十處(主視窗併回時對帳)。
// 🔴 重 gen 一律用 --project-id(走 Management API、不讀 .env.local):
//     supabase gen types typescript --project-id bmpnplmnldofgaohnaok > packages/adapters/src/supabase/database.types.ts
//   勿用 --linked / --db-url(會 parse .env.local、踩 2026-06-17 db push session 的 .env.local 非 ASCII 變數名 parse 失敗坑)。
//   ✅ 實測 2026-08-01(三次)+ 2026-08-02(第四次):`gen types --project-id` **不受 .env.local 影響**。
//     需要暫時移開 .env.local 的是 `db push` / `migration list`,不是 gen types。
// 反映 LIVE prod schema(2026-08-03 深夜第二次重 gen〔RW2b 開工前〕:**A4a(20260803140000)+
//   RW1a(20260803150000)+ A5a(20260803160000)三支皆已 apply** ——
//   **新增** public.admin_upsert_item_procurement(11 參數) → text(A5a 採購 upsert owner RPC)。
//   ✅ 其 Args 五處**已於 2026-08-04 A10b 開工時補上** `| null`(p_contact_channel / p_submitted_at /
//   p_supplier_order_no / p_exception_reason / p_expected_arrival_date —— migration `:228-289` 逐欄可為 NULL、
//   正規化後肉眼全空亦收斂成 NULL;其餘六參數函式內 fail-closed 拒 NULL、型別非 null 是對的)。
//   當初刻意延後的理由 = 呼叫端不存在時補了也沒有 typecheck 會守住;A10b 就是第一個呼叫端。檔頭計數見上(共二十處)。
//   承前 RW1a ——
//   **新增** public.admin_initiate_order_refund(8 參數) → jsonb / public.admin_finalize_order_refund(7 參數) → jsonb
//   = order_refunds 的唯二 service_role 寫入路徑(SECDEF owner RPC)。initiate 回 8 固定碼、finalize 回
//   3 固定碼 + outcome 6 碼(碼全集與重播/hold 契約詳兩函式 DB COMMENT;呼叫端必斷言 ∈ 全集)。
//   order_refunds 增四欄(kind / record_refunded_before / provider_refund_id_evidence / failed_detail)
//   + status 第四值 deferred + request_id 全域 UNIQUE + single-flight partial unique;
//   pcm_order_refundable_remaining 改 allowlist(processing+confirmed 佔額)。A4a = 數量摘要重算線(trigger 網)。
//   ✅ RW2c(2026-08-04)已補兩支退款 RPC 的 Args `| null` 五處(= 上方 ④⑤;檔頭計數見上,共二十處)。
//   (承前基準 2026-08-02 A6,其契約債註記保留如下 ——
//   **新增** public.admin_append_order_note(uuid, text, text, text, timestamptz, uuid, text, text) → text
//   = 訂單備註的**唯一寫入路徑**(SECURITY DEFINER owner RPC;order_notes 對 service_role 只開 SELECT、
//   RLS on 零 policy)。唯一動作 = 單列 INSERT + 同交易 admin_audit_log(action=order_note.append)。
//   回 14 固定碼:APPENDED / ORDER_NOT_FOUND / INVALID_INPUT / INVALID_TYPE / INVALID_CHANNEL /
//   CONTACT_FIELDS_REQUIRED / INTERNAL_FIELDS_FORBIDDEN / OCCURRED_AT_OUT_OF_RANGE /
//   OCCURRED_AT_IN_FUTURE / INVALID_BODY / BODY_TOO_LONG / DUPLICATE_REQUEST /
//   CORRECTS_NOT_FOUND / ALREADY_CORRECTED。
//   🔴 呼叫端契約債(A9d2-1):必須斷言回傳碼 ∈ 14 碼全集,未知碼 = 呼叫端 bug;
//   **DUPLICATE_REQUEST 要按成功處理**(它意謂該 request 已寫入過且經查驗),顯示成錯誤會誘發員工
//   換 request_id 重送 = 製造重複備註(plan v4 F3)。
//   前次基準鏈 = 2026-08-02 A6 ← 2026-08-01 晚 S2)。
// ⚠️ 2026-07-29 那次重 gen 移除了 products_public / products_list_public / product_variants_public 三個 view 的
//   Insert / Update 型別(CLI 依 view 可更新性判定)。已實查:三者的消費端全是 .select() 讀路徑,
//   寫入一律走 base products 表(SupabaseProductAdapter 註解逐字「save 走 base products 表」)⇒ 移除無影響,
//   由 typecheck 把關。若日後真要寫 view,先確認 view 可更新性再處理,勿手動補型別。
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor: string
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          reason: string | null
          request_id: string
          source_app: string
          target: string | null
        }
        Insert: {
          action: string
          actor: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          reason?: string | null
          request_id: string
          source_app?: string
          target?: string | null
        }
        Update: {
          action?: string
          actor?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          reason?: string | null
          request_id?: string
          source_app?: string
          target?: string | null
        }
        Relationships: []
      }
      brands: {
        Row: {
          created_at: string
          description: string | null
          id: string
          logo_url: string | null
          name: string
          premium_extra_pct: number
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name: string
          premium_extra_pct?: number
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          premium_extra_pct?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_category_id: string | null
          raw_path: string
          segments: Json
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_category_id?: string | null
          raw_path: string
          segments: Json
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_category_id?: string | null
          raw_path?: string
          segments?: Json
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_category_id_fkey"
            columns: ["parent_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_addresses: {
        Row: {
          created_at: string
          customer_user_id: string
          id: string
          invoice_carrier: string | null
          invoice_donate_code: string
          invoice_tax_id: string
          invoice_title: string
          invoice_type: Database["public"]["Enums"]["invoice_type"]
          is_default: boolean
          line: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_user_id: string
          id?: string
          invoice_carrier?: string | null
          invoice_donate_code?: string
          invoice_tax_id?: string
          invoice_title?: string
          invoice_type?: Database["public"]["Enums"]["invoice_type"]
          is_default?: boolean
          line: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_user_id?: string
          id?: string
          invoice_carrier?: string | null
          invoice_donate_code?: string
          invoice_tax_id?: string
          invoice_title?: string
          invoice_type?: Database["public"]["Enums"]["invoice_type"]
          is_default?: boolean
          line?: string
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["user_id"]
          },
        ]
      }
      customer_vehicles: {
        Row: {
          created_at: string
          customer_user_id: string
          dict_brand_name: string | null
          dict_model_name: string | null
          engine: string | null
          id: string
          is_primary: boolean
          km: string | null
          mods: string | null
          name: string
          service: string | null
          updated_at: string
          year: string | null
        }
        Insert: {
          created_at?: string
          customer_user_id: string
          dict_brand_name?: string | null
          dict_model_name?: string | null
          engine?: string | null
          id?: string
          is_primary?: boolean
          km?: string | null
          mods?: string | null
          name: string
          service?: string | null
          updated_at?: string
          year?: string | null
        }
        Update: {
          created_at?: string
          customer_user_id?: string
          dict_brand_name?: string | null
          dict_model_name?: string | null
          engine?: string | null
          id?: string
          is_primary?: boolean
          km?: string | null
          mods?: string | null
          name?: string
          service?: string | null
          updated_at?: string
          year?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_vehicles_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["user_id"]
          },
        ]
      }
      customer_wallet_ledger: {
        Row: {
          amount: number
          created_at: string
          customer_user_id: string
          entry_date: string
          entry_type: Database["public"]["Enums"]["wallet_entry_type"]
          id: string
          note: string
          related_order_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          customer_user_id: string
          entry_date?: string
          entry_type: Database["public"]["Enums"]["wallet_entry_type"]
          id?: string
          note?: string
          related_order_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          customer_user_id?: string
          entry_date?: string
          entry_type?: Database["public"]["Enums"]["wallet_entry_type"]
          id?: string
          note?: string
          related_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_wallet_ledger_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["user_id"]
          },
        ]
      }
      customers: {
        Row: {
          birthday: string | null
          created_at: string
          email: string
          name: string
          phone: string | null
          tier: Database["public"]["Enums"]["member_tier"]
          total_deposit: number
          updated_at: string
          user_id: string
          wallet_balance: number
        }
        Insert: {
          birthday?: string | null
          created_at?: string
          email: string
          name?: string
          phone?: string | null
          tier?: Database["public"]["Enums"]["member_tier"]
          total_deposit?: number
          updated_at?: string
          user_id: string
          wallet_balance?: number
        }
        Update: {
          birthday?: string | null
          created_at?: string
          email?: string
          name?: string
          phone?: string | null
          tier?: Database["public"]["Enums"]["member_tier"]
          total_deposit?: number
          updated_at?: string
          user_id?: string
          wallet_balance?: number
        }
        Relationships: []
      }
      email_outbox: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          dedup_key: string
          event_type: string
          id: string
          last_error_code: string | null
          max_attempts: number
          next_retry_at: string
          order_id: string
          payload: Json
          recipient_email: string
          request_id: string | null
          sent_at: string | null
          status: string
          subject: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          dedup_key: string
          event_type: string
          id?: string
          last_error_code?: string | null
          max_attempts?: number
          next_retry_at?: string
          order_id: string
          payload: Json
          recipient_email: string
          request_id?: string | null
          sent_at?: string | null
          status?: string
          subject: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          dedup_key?: string
          event_type?: string
          id?: string
          last_error_code?: string | null
          max_attempts?: number
          next_retry_at?: string
          order_id?: string
          payload?: Json
          recipient_email?: string
          request_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_terms_versions: {
        Row: {
          content_hash: string
          created_at: string
          effective_at: string
          version: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          effective_at: string
          version: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          effective_at?: string
          version?: string
        }
        Relationships: []
      }
      order_cancellation_items: {
        Row: {
          cancellation_id: string
          cancelled_quantity: number
          created_at: string
          id: string
          order_id: string
          order_item_id: string
        }
        Insert: {
          cancellation_id: string
          cancelled_quantity: number
          created_at?: string
          id?: string
          order_id: string
          order_item_id: string
        }
        Update: {
          cancellation_id?: string
          cancelled_quantity?: number
          created_at?: string
          id?: string
          order_id?: string
          order_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_cancellation_items_cancellation_fk"
            columns: ["cancellation_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_cancellations"
            referencedColumns: ["id", "order_id"]
          },
          {
            foreignKeyName: "order_cancellation_items_order_item_fk"
            columns: ["order_id", "order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["order_id", "id"]
          },
        ]
      }
      order_cancellations: {
        Row: {
          actor: string
          created_at: string
          id: string
          idempotency_key: string
          order_id: string
          payload_hash: string
          reason_code: string
          reason_detail: string | null
        }
        Insert: {
          actor: string
          created_at?: string
          id?: string
          idempotency_key: string
          order_id: string
          payload_hash: string
          reason_code: string
          reason_detail?: string | null
        }
        Update: {
          actor?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          order_id?: string
          payload_hash?: string
          reason_code?: string
          reason_detail?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_cancellations_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_cancellations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_procurement: {
        Row: {
          allocated_quantity: number
          contact_channel: string | null
          created_at: string
          exception_reason: string | null
          expected_arrival_date: string | null
          first_ordered_at: string | null
          id: string
          order_item_id: string
          received_quantity: number
          reply_status: string
          status_changed_at: string | null
          submitted_at: string | null
          supplier_id: string
          supplier_order_no: string | null
        }
        Insert: {
          allocated_quantity: number
          contact_channel?: string | null
          created_at?: string
          exception_reason?: string | null
          expected_arrival_date?: string | null
          first_ordered_at?: string | null
          id?: string
          order_item_id: string
          received_quantity?: number
          reply_status?: string
          status_changed_at?: string | null
          submitted_at?: string | null
          supplier_id: string
          supplier_order_no?: string | null
        }
        Update: {
          allocated_quantity?: number
          contact_channel?: string | null
          created_at?: string
          exception_reason?: string | null
          expected_arrival_date?: string | null
          first_ordered_at?: string | null
          id?: string
          order_item_id?: string
          received_quantity?: number
          reply_status?: string
          status_changed_at?: string | null
          submitted_at?: string | null
          supplier_id?: string
          supplier_order_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_item_procurement_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_procurement_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_procurement_receipts: {
        Row: {
          created_at: string
          id: string
          note: string | null
          procurement_id: string
          quantity: number
          received_at: string
          received_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          procurement_id: string
          quantity: number
          received_at: string
          received_by: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          procurement_id?: string
          quantity?: number
          received_at?: string
          received_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_item_procurement_receipts_procurement_id_fkey"
            columns: ["procurement_id"]
            isOneToOne: false
            referencedRelation: "order_item_procurement"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_quantity_summary: {
        Row: {
          cancelled_quantity: number
          instock_quantity: number
          order_item_id: string
          ordered_quantity: number
          quantity: number
        }
        Insert: {
          cancelled_quantity?: number
          instock_quantity?: number
          order_item_id: string
          ordered_quantity?: number
          quantity: number
        }
        Update: {
          cancelled_quantity?: number
          instock_quantity?: number
          order_item_id?: string
          ordered_quantity?: number
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_item_quantity_summary_item_fk"
            columns: ["order_item_id", "quantity"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id", "quantity"]
          },
        ]
      }
      order_items: {
        Row: {
          availability_at_checkout: string | null
          id: string
          line_total: number
          order_id: string
          product_snapshot: Json
          quantity: number
          unit_price: number
          updated_at: string
          variant_id: string | null
          variant_sku: string
          vehicle_snapshot: Json | null
          version: number
          workflow_status: string | null
        }
        Insert: {
          availability_at_checkout?: string | null
          id?: string
          line_total: number
          order_id: string
          product_snapshot: Json
          quantity: number
          unit_price: number
          updated_at?: string
          variant_id?: string | null
          variant_sku: string
          vehicle_snapshot?: Json | null
          version?: number
          workflow_status?: string | null
        }
        Update: {
          availability_at_checkout?: string | null
          id?: string
          line_total?: number
          order_id?: string
          product_snapshot?: Json
          quantity?: number
          unit_price?: number
          updated_at?: string
          variant_id?: string | null
          variant_sku?: string
          vehicle_snapshot?: Json | null
          version?: number
          workflow_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      order_legal_consents: {
        Row: {
          client_ip: string | null
          client_user_agent: string | null
          consented_at: string
          created_at: string
          order_id: string
          terms_version: string
        }
        Insert: {
          client_ip?: string | null
          client_user_agent?: string | null
          consented_at?: string
          created_at?: string
          order_id: string
          terms_version: string
        }
        Update: {
          client_ip?: string | null
          client_user_agent?: string | null
          consented_at?: string
          created_at?: string
          order_id?: string
          terms_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_legal_consents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_legal_consents_terms_version_fkey"
            columns: ["terms_version"]
            isOneToOne: false
            referencedRelation: "legal_terms_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      order_notes: {
        Row: {
          author: string
          body: string
          channel: string | null
          corrects_note_id: string | null
          created_at: string
          id: string
          note_type: string
          occurred_at: string | null
          order_id: string
        }
        Insert: {
          author: string
          body: string
          channel?: string | null
          corrects_note_id?: string | null
          created_at?: string
          id?: string
          note_type: string
          occurred_at?: string | null
          order_id: string
        }
        Update: {
          author?: string
          body?: string
          channel?: string | null
          corrects_note_id?: string | null
          created_at?: string
          id?: string
          note_type?: string
          occurred_at?: string | null
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_notes_corrects_same_order_fk"
            columns: ["corrects_note_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_notes"
            referencedColumns: ["id", "order_id"]
          },
          {
            foreignKeyName: "order_notes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_refund_items: {
        Row: {
          id: string
          line_amount: number
          order_id: string
          order_item_id: string
          quantity: number
          refund_id: string
          unit_price: number
        }
        Insert: {
          id?: string
          line_amount: number
          order_id: string
          order_item_id: string
          quantity: number
          refund_id: string
          unit_price: number
        }
        Update: {
          id?: string
          line_amount?: number
          order_id?: string
          order_item_id?: string
          quantity?: number
          refund_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_refund_items_order_item_fk"
            columns: ["order_id", "order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["order_id", "id"]
          },
          {
            foreignKeyName: "order_refund_items_refund_fk"
            columns: ["refund_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_refunds"
            referencedColumns: ["id", "order_id"]
          },
        ]
      }
      order_refund_job_items: {
        Row: {
          id: string
          job_id: string
          line_amount: number
          order_id: string
          order_item_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          id?: string
          job_id: string
          line_amount: number
          order_id: string
          order_item_id: string
          quantity: number
          unit_price: number
        }
        Update: {
          id?: string
          job_id?: string
          line_amount?: number
          order_id?: string
          order_item_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "orji_item_fk"
            columns: ["order_id", "order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["order_id", "id"]
          },
          {
            foreignKeyName: "orji_job_fk"
            columns: ["job_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_refund_jobs"
            referencedColumns: ["id", "order_id"]
          },
        ]
      }
      order_refund_jobs: {
        Row: {
          actor: string
          bank_refund_id: string
          cancellation_id: string
          check_fail_count: number
          claim_expires_at: string | null
          claim_token: string | null
          claimed_at: string | null
          corrected_at: string | null
          corrected_by: string | null
          correction_reason: string | null
          created_at: string
          dead_reason: string | null
          failed_reason: string | null
          generation: number
          id: string
          items_amount: number
          last_refund_call_at: string | null
          manual_review_required: boolean
          next_check_at: string | null
          next_retry_at: string | null
          order_id: string
          payload_hash: string
          reason: string
          rec_trade_id: string
          refund_amount: number
          refund_call_attempted_at: string | null
          refund_id: string | null
          refunded_before: number | null
          refunded_target: number | null
          request_id: string
          resolution: string | null
          retry_auth_checked_at: string | null
          retry_auth_recorded_refunded: number | null
          retry_count: number
          reviewed_at: string | null
          reviewed_by: string | null
          shipping_delta: number
          shipping_fee_after: number
          shipping_fee_before: number
          status: string
          tappay_refund_id: string | null
          updated_at: string
        }
        Insert: {
          actor: string
          bank_refund_id: string
          cancellation_id: string
          check_fail_count?: number
          claim_expires_at?: string | null
          claim_token?: string | null
          claimed_at?: string | null
          corrected_at?: string | null
          corrected_by?: string | null
          correction_reason?: string | null
          created_at?: string
          dead_reason?: string | null
          failed_reason?: string | null
          generation?: number
          id?: string
          items_amount: number
          last_refund_call_at?: string | null
          manual_review_required?: boolean
          next_check_at?: string | null
          next_retry_at?: string | null
          order_id: string
          payload_hash: string
          reason: string
          rec_trade_id: string
          refund_amount: number
          refund_call_attempted_at?: string | null
          refund_id?: string | null
          refunded_before?: number | null
          refunded_target?: number | null
          request_id: string
          resolution?: string | null
          retry_auth_checked_at?: string | null
          retry_auth_recorded_refunded?: number | null
          retry_count?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          shipping_delta: number
          shipping_fee_after: number
          shipping_fee_before: number
          status?: string
          tappay_refund_id?: string | null
          updated_at?: string
        }
        Update: {
          actor?: string
          bank_refund_id?: string
          cancellation_id?: string
          check_fail_count?: number
          claim_expires_at?: string | null
          claim_token?: string | null
          claimed_at?: string | null
          corrected_at?: string | null
          corrected_by?: string | null
          correction_reason?: string | null
          created_at?: string
          dead_reason?: string | null
          failed_reason?: string | null
          generation?: number
          id?: string
          items_amount?: number
          last_refund_call_at?: string | null
          manual_review_required?: boolean
          next_check_at?: string | null
          next_retry_at?: string | null
          order_id?: string
          payload_hash?: string
          reason?: string
          rec_trade_id?: string
          refund_amount?: number
          refund_call_attempted_at?: string | null
          refund_id?: string | null
          refunded_before?: number | null
          refunded_target?: number | null
          request_id?: string
          resolution?: string | null
          retry_auth_checked_at?: string | null
          retry_auth_recorded_refunded?: number | null
          retry_count?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          shipping_delta?: number
          shipping_fee_after?: number
          shipping_fee_before?: number
          status?: string
          tappay_refund_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orj_actor_fk"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orj_cancellation_fk"
            columns: ["cancellation_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_cancellations"
            referencedColumns: ["id", "order_id"]
          },
          {
            foreignKeyName: "orj_corrected_by_fk"
            columns: ["corrected_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orj_refund_fk"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "order_refunds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orj_reviewed_by_fk"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      order_refunds: {
        Row: {
          actor: string
          bank_refund_id: string
          confirmed_at: string | null
          created_at: string
          failed_detail: string | null
          failed_reason: string | null
          id: string
          kind: string
          order_id: string
          provider_refund_id_evidence: string | null
          reason: string
          rec_trade_id: string
          record_refunded_before: number
          refund_amount: number
          request_id: string
          status: string
          tappay_refund_id: string | null
        }
        Insert: {
          actor: string
          bank_refund_id: string
          confirmed_at?: string | null
          created_at?: string
          failed_detail?: string | null
          failed_reason?: string | null
          id?: string
          kind: string
          order_id: string
          provider_refund_id_evidence?: string | null
          reason: string
          rec_trade_id: string
          record_refunded_before: number
          refund_amount: number
          request_id: string
          status: string
          tappay_refund_id?: string | null
        }
        Update: {
          actor?: string
          bank_refund_id?: string
          confirmed_at?: string | null
          created_at?: string
          failed_detail?: string | null
          failed_reason?: string | null
          id?: string
          kind?: string
          order_id?: string
          provider_refund_id_evidence?: string | null
          reason?: string
          rec_trade_id?: string
          record_refunded_before?: number
          refund_amount?: number
          request_id?: string
          status?: string
          tappay_refund_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_options: {
        Row: {
          code: string
          color: string
          created_at: string
          is_active: boolean
          label: string
          sort_order: number
          text_color: string
        }
        Insert: {
          code: string
          color: string
          created_at?: string
          is_active?: boolean
          label: string
          sort_order: number
          text_color?: string
        }
        Update: {
          code?: string
          color?: string
          created_at?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          text_color?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          address_id: string | null
          cancelled_at: string | null
          cancelled_reason: string | null
          cart_session_id: string | null
          created_at: string
          customer_user_id: string
          discount_total: number
          display_id: string
          display_position: number | null
          fulfillment_status: Database["public"]["Enums"]["fulfillment_status"]
          id: string
          invoice: Json
          invoice_amount: number | null
          invoice_number: string | null
          invoice_status: string
          legacy_display_id: string | null
          notification_email: string | null
          order_source: string
          paid_at: string | null
          payment_channel: string
          payment_method: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          shipping_address_snapshot: Json
          shipping_fee: number
          shipping_free_threshold: number
          shipping_home_fee: number
          shipping_method: string
          shipping_method_at_checkout: string
          subtotal: number
          tappay_rec_trade_id: string | null
          tier_at_checkout: Database["public"]["Enums"]["member_tier"]
          total: number
          updated_at: string
          version: number
          workflow_status: string | null
        }
        Insert: {
          address_id?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          cart_session_id?: string | null
          created_at?: string
          customer_user_id: string
          discount_total?: number
          display_id: string
          display_position?: number | null
          fulfillment_status?: Database["public"]["Enums"]["fulfillment_status"]
          id?: string
          invoice: Json
          invoice_amount?: number | null
          invoice_number?: string | null
          invoice_status?: string
          legacy_display_id?: string | null
          notification_email?: string | null
          order_source?: string
          paid_at?: string | null
          payment_channel?: string
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          shipping_address_snapshot: Json
          shipping_fee: number
          shipping_free_threshold?: number
          shipping_home_fee?: number
          shipping_method: string
          shipping_method_at_checkout: string
          subtotal: number
          tappay_rec_trade_id?: string | null
          tier_at_checkout: Database["public"]["Enums"]["member_tier"]
          total: number
          updated_at?: string
          version?: number
          workflow_status?: string | null
        }
        Update: {
          address_id?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          cart_session_id?: string | null
          created_at?: string
          customer_user_id?: string
          discount_total?: number
          display_id?: string
          display_position?: number | null
          fulfillment_status?: Database["public"]["Enums"]["fulfillment_status"]
          id?: string
          invoice?: Json
          invoice_amount?: number | null
          invoice_number?: string | null
          invoice_status?: string
          legacy_display_id?: string | null
          notification_email?: string | null
          order_source?: string
          paid_at?: string | null
          payment_channel?: string
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          shipping_address_snapshot?: Json
          shipping_fee?: number
          shipping_free_threshold?: number
          shipping_home_fee?: number
          shipping_method?: string
          shipping_method_at_checkout?: string
          subtotal?: number
          tappay_rec_trade_id?: string | null
          tier_at_checkout?: Database["public"]["Enums"]["member_tier"]
          total?: number
          updated_at?: string
          version?: number
          workflow_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "customer_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["user_id"]
          },
        ]
      }
      payment_charge_attempts: {
        Row: {
          bank_transaction_id: string | null
          created_at: string
          customer_user_id: string
          failure_observed_at: string | null
          failure_observed_status: number | null
          fallback_token_hash: string
          id: string
          last_expired_settle_at: string | null
          last_poll_settle_at: string | null
          last_settle_error: string | null
          needs_manual_review: boolean
          next_settle_at: string | null
          order_id: string
          rec_trade_id: string | null
          released_at: string | null
          released_close_resolution: string | null
          released_closed_at: string | null
          released_closed_by: string | null
          released_manual_review_at: string | null
          settle_attempt_count: number
          status: string
          updated_at: string
        }
        Insert: {
          bank_transaction_id?: string | null
          created_at?: string
          customer_user_id: string
          failure_observed_at?: string | null
          failure_observed_status?: number | null
          fallback_token_hash: string
          id?: string
          last_expired_settle_at?: string | null
          last_poll_settle_at?: string | null
          last_settle_error?: string | null
          needs_manual_review?: boolean
          next_settle_at?: string | null
          order_id: string
          rec_trade_id?: string | null
          released_at?: string | null
          released_close_resolution?: string | null
          released_closed_at?: string | null
          released_closed_by?: string | null
          released_manual_review_at?: string | null
          settle_attempt_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          bank_transaction_id?: string | null
          created_at?: string
          customer_user_id?: string
          failure_observed_at?: string | null
          failure_observed_status?: number | null
          fallback_token_hash?: string
          id?: string
          last_expired_settle_at?: string | null
          last_poll_settle_at?: string | null
          last_settle_error?: string | null
          needs_manual_review?: boolean
          next_settle_at?: string | null
          order_id?: string
          rec_trade_id?: string | null
          released_at?: string | null
          released_close_resolution?: string | null
          released_closed_at?: string | null
          released_closed_by?: string | null
          released_manual_review_at?: string | null
          settle_attempt_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_charge_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_double_charge_anomalies: {
        Row: {
          amount: number
          cart_session_id: string
          charged_at: string
          created_at: string
          id: string
          old_attempt_id: string
          old_order_id: string
          rec_trade_id: string
          refund_claimed_at: string | null
          refund_claimed_by: string | null
          refund_provider_reference: string | null
          refund_target_rec_trade_id: string
          released_at: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          cart_session_id: string
          charged_at: string
          created_at?: string
          id?: string
          old_attempt_id: string
          old_order_id: string
          rec_trade_id: string
          refund_claimed_at?: string | null
          refund_claimed_by?: string | null
          refund_provider_reference?: string | null
          refund_target_rec_trade_id: string
          released_at: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          cart_session_id?: string
          charged_at?: string
          created_at?: string
          id?: string
          old_attempt_id?: string
          old_order_id?: string
          rec_trade_id?: string
          refund_claimed_at?: string | null
          refund_claimed_by?: string | null
          refund_provider_reference?: string | null
          refund_target_rec_trade_id?: string
          released_at?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_double_charge_anomalies_old_attempt_id_fkey"
            columns: ["old_attempt_id"]
            isOneToOne: true
            referencedRelation: "payment_charge_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_double_charge_anomalies_old_order_id_fkey"
            columns: ["old_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_double_charge_anomaly_events: {
        Row: {
          actor_session_role: string
          anomaly_id: string
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          note: string
          provider_reference: string | null
          to_status: string | null
        }
        Insert: {
          actor_session_role: string
          anomaly_id: string
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          note: string
          provider_reference?: string | null
          to_status?: string | null
        }
        Update: {
          actor_session_role?: string
          anomaly_id?: string
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          note?: string
          provider_reference?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_double_charge_anomaly_events_anomaly_id_fkey"
            columns: ["anomaly_id"]
            isOneToOne: false
            referencedRelation: "payment_double_charge_anomalies"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_webhook_events: {
        Row: {
          amount: number | null
          attempt_count: number
          bank_transaction_id: string | null
          last_error: string | null
          needs_manual_review: boolean
          next_retry_at: string | null
          order_number: string
          processed: boolean
          processed_at: string | null
          raw_hash: string
          rec_trade_id: string
          received_at: string
          reported_status: number | null
          transaction_time_millis: number | null
        }
        Insert: {
          amount?: number | null
          attempt_count?: number
          bank_transaction_id?: string | null
          last_error?: string | null
          needs_manual_review?: boolean
          next_retry_at?: string | null
          order_number: string
          processed?: boolean
          processed_at?: string | null
          raw_hash: string
          rec_trade_id: string
          received_at?: string
          reported_status?: number | null
          transaction_time_millis?: number | null
        }
        Update: {
          amount?: number | null
          attempt_count?: number
          bank_transaction_id?: string | null
          last_error?: string | null
          needs_manual_review?: boolean
          next_retry_at?: string | null
          order_number?: string
          processed?: boolean
          processed_at?: string | null
          raw_hash?: string
          rec_trade_id?: string
          received_at?: string
          reported_status?: number | null
          transaction_time_millis?: number | null
        }
        Relationships: []
      }
      pending_invoices: {
        Row: {
          created_at: string
          id: string
          order_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      product_fitments: {
        Row: {
          id: number
          model_code: string
          moto_brand: string
          product_id: string
          year_end: number | null
          year_start: number | null
        }
        Insert: {
          id?: never
          model_code: string
          moto_brand: string
          product_id: string
          year_end?: number | null
          year_start?: number | null
        }
        Update: {
          id?: never
          model_code?: string
          moto_brand?: string
          product_id?: string
          year_end?: number | null
          year_start?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_fitments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fitments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_list_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fitments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      product_fitments_effective: {
        Row: {
          id: number
          match_source: string
          model_code: string
          moto_brand: string
          product_id: string
          source_model_code: string
          year_end: number | null
          year_start: number | null
        }
        Insert: {
          id?: never
          match_source: string
          model_code: string
          moto_brand: string
          product_id: string
          source_model_code: string
          year_end?: number | null
          year_start?: number | null
        }
        Update: {
          id?: never
          match_source?: string
          model_code?: string
          moto_brand?: string
          product_id?: string
          source_model_code?: string
          year_end?: number | null
          year_start?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_fitments_effective_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fitments_effective_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_list_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fitments_effective_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      product_fitments_effective_staging: {
        Row: {
          id: number
          match_source: string
          model_code: string
          moto_brand: string
          product_id: string
          run_id: string
          source_model_code: string
          year_end: number | null
          year_start: number | null
        }
        Insert: {
          id?: never
          match_source: string
          model_code: string
          moto_brand: string
          product_id: string
          run_id: string
          source_model_code: string
          year_end?: number | null
          year_start?: number | null
        }
        Update: {
          id?: never
          match_source?: string
          model_code?: string
          moto_brand?: string
          product_id?: string
          run_id?: string
          source_model_code?: string
          year_end?: number | null
          year_start?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_fitments_effective_staging_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fitments_effective_staging_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_list_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_fitments_effective_staging_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      product_fitments_effective_sync_log: {
        Row: {
          id: number
          new_count: number | null
          note: string | null
          old_count: number | null
          orphan_rows: number | null
          ran_at: string
          run_id: string | null
          source_rows: number | null
          staged_rows: number | null
          status: string
        }
        Insert: {
          id?: never
          new_count?: number | null
          note?: string | null
          old_count?: number | null
          orphan_rows?: number | null
          ran_at?: string
          run_id?: string | null
          source_rows?: number | null
          staged_rows?: number | null
          status: string
        }
        Update: {
          id?: never
          new_count?: number | null
          note?: string | null
          old_count?: number | null
          orphan_rows?: number | null
          ran_at?: string
          run_id?: string | null
          source_rows?: number | null
          staged_rows?: number | null
          status?: string
        }
        Relationships: []
      }
      product_image_trim: {
        Row: {
          analyzed_at: string
          bbox_height: number | null
          bbox_left: number | null
          bbox_top: number | null
          bbox_width: number | null
          natural_height: number | null
          natural_width: number | null
          status: string
          url: string
        }
        Insert: {
          analyzed_at?: string
          bbox_height?: number | null
          bbox_left?: number | null
          bbox_top?: number | null
          bbox_width?: number | null
          natural_height?: number | null
          natural_width?: number | null
          status: string
          url: string
        }
        Update: {
          analyzed_at?: string
          bbox_height?: number | null
          bbox_left?: number | null
          bbox_top?: number | null
          bbox_width?: number | null
          natural_height?: number | null
          natural_width?: number | null
          status?: string
          url?: string
        }
        Relationships: []
      }
      product_variants: {
        Row: {
          availability: string
          created_at: string
          id: string
          images: Json
          metadata: Json
          price_general: number | null
          price_store: number | null
          product_id: string
          sku: string
          sort_order: number
          spec: Json
          supplier_slug: string
          updated_at: string
        }
        Insert: {
          availability?: string
          created_at?: string
          id?: string
          images?: Json
          metadata?: Json
          price_general?: number | null
          price_store?: number | null
          product_id: string
          sku: string
          sort_order?: number
          spec?: Json
          supplier_slug?: string
          updated_at?: string
        }
        Update: {
          availability?: string
          created_at?: string
          id?: string
          images?: Json
          metadata?: Json
          price_general?: number | null
          price_store?: number | null
          product_id?: string
          sku?: string
          sort_order?: number
          spec?: Json
          supplier_slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_list_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          availability: string
          brand_id: string
          category_id: string
          created_at: string
          delisted_at: string | null
          description: string | null
          external_id: string
          fitments: Json
          handle: string
          highlights: Json
          id: string
          images: Json
          manuals: Json
          metadata: Json
          price_by_tier: Json
          price_general: number | null
          price_store: number | null
          subtitle: string | null
          supplier_slug: string
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          availability?: string
          brand_id: string
          category_id: string
          created_at?: string
          delisted_at?: string | null
          description?: string | null
          external_id: string
          fitments?: Json
          handle: string
          highlights?: Json
          id?: string
          images?: Json
          manuals?: Json
          metadata?: Json
          price_by_tier: Json
          price_general?: number | null
          price_store?: number | null
          subtitle?: string | null
          supplier_slug?: string
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          availability?: string
          brand_id?: string
          category_id?: string
          created_at?: string
          delisted_at?: string | null
          description?: string | null
          external_id?: string
          fitments?: Json
          handle?: string
          highlights?: Json
          id?: string
          images?: Json
          manuals?: Json
          metadata?: Json
          price_by_tier?: Json
          price_general?: number | null
          price_store?: number | null
          subtitle?: string | null
          supplier_slug?: string
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_manager: boolean
          label: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          is_active?: boolean
          is_manager?: boolean
          label: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_manager?: boolean
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      customer_wallet_balance_check: {
        Row: {
          computed_balance: number | null
          computed_total_deposit: number | null
          customer_user_id: string | null
          last_entry_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_wallet_ledger_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["user_id"]
          },
        ]
      }
      product_variants_public: {
        Row: {
          availability: string | null
          created_at: string | null
          id: string | null
          images: Json | null
          price_general: number | null
          product_id: string | null
          sku: string | null
          sort_order: number | null
          spec: Json | null
          supplier_slug: string | null
          updated_at: string | null
        }
        Insert: {
          availability?: string | null
          created_at?: string | null
          id?: string | null
          images?: Json | null
          price_general?: number | null
          product_id?: string | null
          sku?: string | null
          sort_order?: number | null
          spec?: Json | null
          supplier_slug?: string | null
          updated_at?: string | null
        }
        Update: {
          availability?: string | null
          created_at?: string | null
          id?: string | null
          images?: Json | null
          price_general?: number | null
          product_id?: string | null
          sku?: string | null
          sort_order?: number | null
          spec?: Json | null
          supplier_slug?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_list_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      products_list_public: {
        Row: {
          availability: string | null
          brand_id: string | null
          brand_name: string | null
          brand_slug: string | null
          card_image: string | null
          category_id: string | null
          category_raw: string | null
          fitments: Json | null
          fits: string | null
          handle: string | null
          id: string | null
          price_general: number | null
          subtitle: string | null
          supplier_slug: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      products_public: {
        Row: {
          availability: string | null
          brand_id: string | null
          card_image_trim: Json | null
          category_id: string | null
          created_at: string | null
          description: string | null
          external_id: string | null
          fitments: Json | null
          handle: string | null
          highlights: Json | null
          id: string | null
          images: Json | null
          manuals: Json | null
          price_general: number | null
          subtitle: string | null
          supplier_slug: string | null
          title: string | null
          updated_at: string | null
          video_url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_adjust_wallet: {
        Args: {
          p_actor: string
          p_amount: number
          p_customer_user_id: string
          p_entry_type: string
          p_note: string
          p_request_id: string
        }
        Returns: string
      }
      admin_append_order_note: {
        Args: {
          // 🔴 手動校正(重 gen 後需重貼)—— internal 這個 note_type **必須**三個都傳 NULL
          //   (order_notes 的 internal_fields_absent CHECK 強制),而 PostgREST 的型別產生器
          //   表達不了「必填但可為 null」⇒ 全被型別化為非 null string,呼叫端第一次寫 internal
          //   備註就型別紅。p_actor / p_request_id **不補** —— 函式裡 fail-closed 拒收 NULL。
          //   p_order_id / p_note_type / p_body 也不補 —— 傳 NULL 只會拿到固定錯誤碼,不是合法用法。
          p_actor: string
          p_body: string
          p_channel: string | null
          p_corrects_note_id: string | null
          p_note_type: string
          p_occurred_at: string | null
          p_order_id: string
          p_request_id: string
        }
        Returns: string
      }
      admin_finalize_order_refund: {
        // 🔴 手動校正三處(重 gen 後需重貼;RW2c)—— outcome 參數矩陣**強制**互斥:
        //   accepted 必帶 tappay_refund_id + refund_amount_wire、其餘必 NULL;
        //   manual_failed 必帶 failed_detail(migration 20260803150000 步 2 逐條)⇒
        //   非 null 型別會讓合法的「必須傳 NULL」呼叫直接型別紅。
        Args: {
          p_actor: string
          p_failed_detail: string | null
          p_outcome: string
          p_refund_amount_wire: number | null
          p_refund_id: string
          p_request_id: string
          p_tappay_refund_id: string | null
        }
        Returns: Json
      }
      admin_initiate_order_refund: {
        // 🔴 手動校正兩處(重 gen 後需重貼;RW2c)—— kind/金額**強制**互斥(RPC 步 2):
        //   partial 必帶 amount、record_amount 必 NULL;full 相反。p_record_refunded_before
        //   不補 —— RPC fail-closed 拒 NULL(G0 baseline 缺值時 action 已 abort、不得傳 0 充數)。
        Args: {
          p_actor: string
          p_amount: number | null
          p_kind: string
          p_order_id: string
          p_reason: string
          p_record_amount: number | null
          p_record_refunded_before: number
          p_request_id: string
        }
        Returns: Json
      }
      admin_set_customer_tier: {
        Args: {
          p_actor: string
          p_customer_user_id: string
          p_note: string
          p_request_id: string
          p_tier: string
        }
        Returns: string
      }
      admin_update_order_item_workflow: {
        Args: {
          p_actor: string
          p_expected_version: number
          p_item_id: string
          p_patch: Json
          p_request_id: string
        }
        Returns: string
      }
      admin_update_order_workflow: {
        Args: {
          p_actor: string
          p_expected_version: number
          p_order_id: string
          p_patch: Json
          p_request_id: string
        }
        Returns: string
      }
      admin_upsert_item_procurement: {
        Args: {
          // 🔴 手動校正(重 gen 後需重貼;2026-08-04 A10b 開工補上 —— 呼叫端到此才存在)。
          //   本函式是**全量 payload、非 patch**(migration `20260803160000:19-24`):選填欄送 NULL
          //   = 該欄寫成 NULL。這五個參數在函式裡逐一 `IS NOT NULL` 才驗(`:228-289`),NULL 合法。
          //   PostgREST 的型別產生器表達不了「必填但可為 null」⇒ 全被型別化為非 null,
          //   呼叫端第一次傳 null 就型別紅。校正 = 五個真的可為 NULL 的參數補 `| null`。
          //   其餘六個**不補** —— p_actor / p_request_id / p_order_item_id / p_supplier_id /
          //   p_allocated_quantity / p_reply_status 在函式裡 fail-closed 拒收 NULL,型別非 null 是對的。
          p_actor: string
          p_allocated_quantity: number
          p_contact_channel: string | null
          p_exception_reason: string | null
          p_expected_arrival_date: string | null
          p_order_item_id: string
          p_reply_status: string
          p_request_id: string
          p_submitted_at: string | null
          p_supplier_id: string
          p_supplier_order_no: string | null
        }
        Returns: string
      }
      admin_upsert_supplier: {
        Args: {
          // 🔴 手動校正(重 gen 後需重貼)—— 這支函式的**整個分流機制**就是「NULL = 該欄不動」:
          //   p_supplier_id 為 NULL = 新增;有值時 p_label / p_is_active 各自 NULL = 該欄不動。
          //   PostgREST 的型別產生器表達不了「必填但可為 null」⇒ 六個參數全被型別化為非 null,
          //   而呼叫端第一次傳 null 就會型別紅。校正 = 四個真的可為 NULL 的參數補 `| null`。
          //   p_actor / p_request_id **不補** —— 它們在函式裡 fail-closed 拒收 NULL,型別非 null 是對的。
          p_actor: string
          p_is_active: boolean | null
          p_label: string | null
          p_note: string | null
          p_request_id: string
          p_supplier_id: string | null
        }
        Returns: string
      }
      begin_charge_attempt: { Args: { p_order_id: string }; Returns: Json }
      catalog_brand_counts: {
        Args: never
        Returns: {
          name: string
          product_count: number
          slug: string
        }[]
      }
      charge_attempt_token_hash: { Args: { p_token: string }; Returns: string }
      claim_double_charge_anomaly_for_refund: {
        Args: { p_anomaly_id: string }
        Returns: Json
      }
      claim_due_webhook_events: {
        Args: { p_limit: number }
        Returns: {
          attempt_count: number
          order_number: string
          rec_trade_id: string
        }[]
      }
      claim_expired_pending_attempts: {
        Args: { p_limit: number }
        Returns: {
          attempt_id: string
          needs_manual_review: boolean
          order_id: string
        }[]
      }
      claim_order_poll_settle: {
        Args: { p_order_id: string; p_throttle_seconds: number }
        Returns: boolean
      }
      claim_stuck_unsettled_attempts: {
        Args: { p_age_seconds: number; p_limit: number }
        Returns: {
          attempt_id: string
          order_id: string
          settle_attempt_count: number
        }[]
      }
      close_released_attempt: {
        Args: { p_attempt_id: string; p_resolution: string }
        Returns: Json
      }
      confirm_order_payment: {
        Args: { p_amount: number; p_order_id: string; p_rec_trade_id: string }
        Returns: Json
      }
      create_order: {
        Args: {
          // 🔴 手動校正(重 gen 後需重貼)—— 2026-07-29 production 實查函式簽章逐字:
          //   create_order(p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb,
          //                p_cart_session_id uuid, p_terms_version text, p_client_ip text,
          //                p_client_ua text, p_notification_email text DEFAULT NULL::text)
          // 三個 text 參數在 DDL 都吃得下 NULL,但 PostgREST 的型別產生器**表達不了
          // 「必填但可為 null」**,一律型別化為非 null string ⇒ 不校正的話金流建單路徑會型別紅。
          // p_client_ip / p_client_ua = #241 best-effort PII(RPC 端 left 截斷、註解明寫可 NULL)。
          // ⚠️ 2026-08-01 被沖掉三次(A7c、S1b、S2)、2026-08-02 A6 第四次,都已重貼。
          p_address_id: string
          p_cart_session_id: string
          p_client_ip: string | null
          p_client_ua: string | null
          p_invoice: Json
          p_lines: Json
          p_notification_email?: string | null
          p_shipping_method: string
          p_terms_version: string
        }
        Returns: Json
      }
      expire_stuck_attempts_at_ceiling: { Args: never; Returns: number }
      expire_webhook_events_at_ceiling: { Args: never; Returns: number }
      find_active_sibling_own: {
        Args: { p_cart_session_id: string }
        Returns: Json
      }
      flag_non_unpaid_active_attempts: {
        Args: { p_limit: number }
        Returns: number
      }
      get_active_charge_attempt: { Args: { p_order_id: string }; Returns: Json }
      get_payment_anomaly_alert_summary: {
        Args: {
          p_pending_dc_stuck_seconds: number
          p_pending_dc_window_seconds: number
          p_refunding_stuck_seconds: number
        }
        Returns: Json
      }
      m3_jsonb_values_all_string: { Args: { j: Json }; Returns: boolean }
      mark_attempt_settle_retry: {
        Args: {
          p_attempt_id: string
          p_claimed_count: number
          p_reason_code: string
        }
        Returns: number
      }
      mark_charge_attempt_charged: {
        Args: {
          p_attempt_id: string
          p_order_id: string
          p_rec_trade_id: string
        }
        Returns: undefined
      }
      mark_charge_attempt_charged_fallback: {
        Args: {
          p_attempt_id: string
          p_fallback_token: string
          p_order_id: string
          p_rec_trade_id: string
        }
        Returns: undefined
      }
      mark_charge_attempt_failed: {
        Args: { p_attempt_id: string; p_order_id: string }
        Returns: undefined
      }
      mark_charge_attempt_released_for_user: {
        Args: {
          p_attempt_id: string
          p_cart_session_id: string
          p_user_id: string
        }
        Returns: Json
      }
      mark_webhook_processed: {
        Args: { p_claimed_count: number; p_rec_trade_id: string }
        Returns: number
      }
      mark_webhook_retry: {
        Args: {
          p_claimed_count: number
          p_reason_code: string
          p_rec_trade_id: string
        }
        Returns: number
      }
      pcm_a4a_recompute_order_item_summary: {
        Args: { p_order_item_id: string }
        Returns: undefined
      }
      pcm_generate_display_id: { Args: never; Returns: string }
      pcm_order_refundable_remaining: {
        Args: { p_order_id: string }
        Returns: number
      }
      pfe_staging_reset: { Args: never; Returns: number }
      pfe_sync_commit: {
        Args: {
          p_allow_anomaly?: boolean
          p_note?: string
          p_orphan_rows: number
          p_run_id: string
          p_source_rows: number
        }
        Returns: Json
      }
      record_charge_bank_txn: {
        Args: {
          p_attempt_id: string
          p_bank_transaction_id: string
          p_order_id: string
        }
        Returns: boolean
      }
      record_charge_pending_rec: {
        Args: {
          p_attempt_id: string
          p_order_id: string
          p_rec_trade_id: string
        }
        Returns: boolean
      }
      record_pending_invoice: { Args: { p_order_id: string }; Returns: boolean }
      record_released_failure_observation: {
        Args: {
          p_attempt_id: string
          p_observed_status: number
          p_order_id: string
        }
        Returns: undefined
      }
      record_webhook_event: {
        Args: {
          p_amount?: number
          p_bank_transaction_id?: string
          p_order_number: string
          p_raw_hash: string
          p_rec_trade_id: string
          p_reported_status?: number
          p_transaction_time_millis?: number
        }
        Returns: boolean
      }
      resolve_double_charge_anomaly: {
        Args: {
          p_anomaly_id: string
          p_note: string
          p_provider_reference?: string
          p_resolution: string
        }
        Returns: Json
      }
      search_catalog_by_vehicle: {
        Args: {
          p_brand?: string
          p_brand_slugs?: string[]
          p_category?: string
          p_limit?: number
          p_model?: string
          p_offset?: number
          p_price_max?: number
          p_price_min?: number
          p_sort?: string
          p_year?: number
        }
        Returns: {
          item: Json
          total: number
        }[]
      }
      search_products_by_vehicle: {
        Args: { p_brand: string; p_model?: string; p_year?: number }
        Returns: Json[]
      }
      sync_product_variant_group: {
        Args: {
          p_external_id: string
          p_orphan_skus?: string[]
          p_supplier_slug: string
          p_variants: Json
        }
        Returns: number
      }
    }
    Enums: {
      fulfillment_status: "notOrdered" | "ordered" | "inStock" | "shipped"
      invoice_type: "personal" | "company" | "donate"
      member_tier: "general" | "store" | "premiumStore"
      payment_status:
        | "unpaid"
        | "paid"
        | "partiallyPaid"
        | "refunded"
        | "partiallyRefunded"
      wallet_entry_type: "deposit" | "use" | "refund"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      fulfillment_status: ["notOrdered", "ordered", "inStock", "shipped"],
      invoice_type: ["personal", "company", "donate"],
      member_tier: ["general", "store", "premiumStore"],
      payment_status: [
        "unpaid",
        "paid",
        "partiallyPaid",
        "refunded",
        "partiallyRefunded",
      ],
      wallet_entry_type: ["deposit", "use", "refund"],
    },
  },
} as const
