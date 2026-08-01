// database.types.ts — Supabase 生成型別(勿手改;以下命令重 gen 後此檔含中文檔頭會被沖掉、需重貼本段)。
// 🔴🔴 重 gen 後要重貼的**不只中文檔頭** —— 本體 `create_order.Args` 內另有三處手動校正
//   (p_client_ip / p_client_ua / p_notification_email 的 `| null`)。PostgREST 產生器表達不了
//   「必填但可為 null」⇒ 漏貼會讓**金流建單路徑**型別紅。2026-08-01 已被沖掉兩次(A7c、S1b)。
// 🔴 重 gen 一律用 --project-id(走 Management API、不讀 .env.local):
//     supabase gen types typescript --project-id bmpnplmnldofgaohnaok > packages/adapters/src/supabase/database.types.ts
//   勿用 --linked / --db-url(會 parse .env.local、踩 2026-06-17 db push session 的 .env.local 非 ASCII 變數名 parse 失敗坑)。
//   ✅ 實測 2026-08-01(兩次):`gen types --project-id` **不受 .env.local 影響**(在 .env.local 原位的
//     情況下退出碼 0)。需要暫時移開 .env.local 的是 `db push` / `migration list`,不是 gen types。
//     (本檔一度誤記成「即使 --project-id 也會被擋」—— 那是因為當時預先移開才跑、根本沒測過,已更正。)
// 反映 LIVE prod schema(2026-08-01 傍晚重 gen:M-4b E10 **S1a + S1b 已 apply** ——
//   **新增** public.suppliers 供應商主檔(26 家 seed、可新增可改名**不可刪除**、停用走 is_active);
//   order_item_procurement **移除** supplier_name / supplier_canonical_key 兩個文字欄、
//   **新增** supplier_id uuid FK -> suppliers(id) ON DELETE/UPDATE RESTRICT,
//   business key 換軸為 (order_item_id, supplier_id)、約束名不變。
//   前次基準 = 2026-08-01 早 A7c 退款帳本改記金額)。
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
          failed_reason: string | null
          id: string
          order_id: string
          reason: string
          rec_trade_id: string
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
          failed_reason?: string | null
          id?: string
          order_id: string
          reason: string
          rec_trade_id: string
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
          failed_reason?: string | null
          id?: string
          order_id?: string
          reason?: string
          rec_trade_id?: string
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
          p_address_id: string
          p_cart_session_id: string
          // 🔴 手動校正(重 gen 後需重貼)—— 2026-07-29 production 實查函式簽章逐字:
          //   create_order(p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb,
          //                p_cart_session_id uuid, p_terms_version text, p_client_ip text,
          //                p_client_ua text, p_notification_email text DEFAULT NULL::text)
          // 三個 text 參數在 DDL 都吃得下 NULL,但 PostgREST 的型別產生器**表達不了
          // 「必填但可為 null」**,一律型別化為非 null string ⇒ 不校正的話金流建單路徑會型別紅。
          // p_client_ip / p_client_ua = #241 best-effort PII(RPC 端 left 截斷、註解明寫可 NULL)。
          // ⚠️ 2026-08-01 被沖掉兩次(早上 A7c、傍晚 S1b)、都已重貼。**檔頭的「重貼」提醒只提到
          //    中文檔頭,本體裡的這三處手動校正同樣要重貼** —— 忘了就是金流建單路徑型別紅。
          p_client_ip: string | null
          p_client_ua: string | null
          p_invoice: Json
          p_lines: Json
          // 🔴 手動校正(同上):B-2 第 9 參,DDL `DEFAULT NULL::text`。呼叫端(mappers/order.ts
          //   CreateOrderRpcArgs)在 B-3 flag-on 時只傳 `null` 當形狀 marker,canonical 真值等 B-4
          //   才擴型 ⇒ 這裡必須收得下 null,否則 mapper 對不上。
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
