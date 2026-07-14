// database.types.ts — Supabase 生成型別(勿手改;以下命令重 gen 後此檔含中文檔頭會被沖掉、需重貼本段)。
// 🔴 重 gen 一律用 --project-id(走 Management API、不讀 .env.local):
//     supabase gen types typescript --project-id bmpnplmnldofgaohnaok > packages/adapters/src/supabase/database.types.ts
//   勿用 --linked / --db-url(會 parse .env.local、踩 2026-06-17 db push session 的 .env.local 非 ASCII 變數名 parse 失敗坑)。
// 反映 LIVE prod schema(2026-07-13 M-4a 訂單線-01 orders 6 後台管理欄〔display_position/order_source/payment_channel/cancelled_at/cancelled_reason/version〕+ admin_audit_log + 搜尋/分類線 migration 已上 prod 後重 gen)。
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
      order_items: {
        Row: {
          availability_at_checkout: string | null
          id: string
          line_total: number
          order_id: string
          product_snapshot: Json
          quantity: number
          unit_price: number
          variant_id: string | null
          variant_sku: string
        }
        Insert: {
          availability_at_checkout?: string | null
          id?: string
          line_total: number
          order_id: string
          product_snapshot: Json
          quantity: number
          unit_price: number
          variant_id?: string | null
          variant_sku: string
        }
        Update: {
          availability_at_checkout?: string | null
          id?: string
          line_total?: number
          order_id?: string
          product_snapshot?: Json
          quantity?: number
          unit_price?: number
          variant_id?: string | null
          variant_sku?: string
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
      // ⚠️ 手動先行加入(migration 20260714120000 尚未 apply;Sean db push 後重 gen 應與此一致):
      //    order_status_options 新表 + orders 4 新欄(workflow_status / invoice_number / invoice_amount / invoice_status)。
      //    盲 regen 若在 apply 前跑會把這段吃掉 → 先 apply 再 gen。
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
          order_source: string
          paid_at: string | null
          payment_channel: string
          payment_method: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          shipping_address_snapshot: Json
          shipping_fee: number
          shipping_method: string
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
          order_source?: string
          paid_at?: string | null
          payment_channel?: string
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          shipping_address_snapshot: Json
          shipping_fee: number
          shipping_method: string
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
          order_source?: string
          paid_at?: string | null
          payment_channel?: string
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          shipping_address_snapshot?: Json
          shipping_fee?: number
          shipping_method?: string
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
        Insert: {
          availability?: string | null
          brand_id?: string | null
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          external_id?: string | null
          fitments?: Json | null
          handle?: string | null
          highlights?: Json | null
          id?: string | null
          images?: Json | null
          manuals?: Json | null
          price_general?: number | null
          subtitle?: string | null
          supplier_slug?: string | null
          title?: string | null
          updated_at?: string | null
          video_url?: string | null
        }
        Update: {
          availability?: string | null
          brand_id?: string | null
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          external_id?: string | null
          fitments?: Json | null
          handle?: string | null
          highlights?: Json | null
          id?: string | null
          images?: Json | null
          manuals?: Json | null
          price_general?: number | null
          subtitle?: string | null
          supplier_slug?: string | null
          title?: string | null
          updated_at?: string | null
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
    }
    Functions: {
      // ⚠️ 手動先行加入(migration 20260714130000 尚未 apply;Sean db push 後重 gen 應與此一致)。
      admin_update_order_workflow: {
        Args: {
          p_order_id: string
          p_expected_version: number
          p_patch: Json
          p_actor: string
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
          // 🔴 手動校正(重 gen 後需重貼):create_order DDL(20260630120000)p_client_ip/p_client_ua 為
          // 無 DEFAULT 的 text、註解明寫「可 NULL」(#241 best-effort PII);PostgREST 對無 DEFAULT 參數一律
          // 型別化為非 null string〔無法表達「必填但可 null」〕→ 校正為 string | null 對齊 DDL 真相、
          // 保留 SupabaseOrderAdapter.placeOrder 傳 null 語意(否則金流建單路徑型別紅)。
          p_client_ip: string | null
          p_client_ua: string | null
          p_invoice: Json
          p_lines: Json
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
    }
    Enums: {
      fulfillment_status: "notOrdered" | "ordered" | "inStock" | "shipped"
      invoice_type: "personal" | "company" | "donate"
      member_tier: "general" | "store" | "premiumStore"
      payment_status: "unpaid" | "paid" | "partiallyPaid" | "refunded"
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
      payment_status: ["unpaid", "paid", "partiallyPaid", "refunded"],
      wallet_entry_type: ["deposit", "use", "refund"],
    },
  },
} as const
