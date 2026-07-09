// database.types.ts — Supabase 生成型別(勿手改;以下命令重 gen 後此檔含中文檔頭會被沖掉、需重貼本段)。
// 🔴 重 gen 一律用 --project-id(走 Management API、不讀 .env.local):
//     supabase gen types typescript --project-id bmpnplmnldofgaohnaok > packages/adapters/src/supabase/database.types.ts
//   勿用 --linked / --db-url(會 parse .env.local、踩 2026-06-17 db push session 的 .env.local 非 ASCII 變數名 parse 失敗坑)。
// 反映 LIVE prod schema(2026-06-25 R1 migration bundle〔S2b + R1a1–R1c3〕db push 後重 gen = released 狀態/生命週期欄 + 雙扣 anomaly 兩表 + release/observation/anomaly/close RPC;M-3 3DS 乙路 R2a)。
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
      orders: {
        Row: {
          address_id: string | null
          cart_session_id: string | null
          created_at: string
          customer_user_id: string
          discount_total: number
          display_id: string
          fulfillment_status: Database["public"]["Enums"]["fulfillment_status"]
          id: string
          invoice: Json
          paid_at: string | null
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
        }
        Insert: {
          address_id?: string | null
          cart_session_id?: string | null
          created_at?: string
          customer_user_id: string
          discount_total?: number
          display_id: string
          fulfillment_status?: Database["public"]["Enums"]["fulfillment_status"]
          id?: string
          invoice: Json
          paid_at?: string | null
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
        }
        Update: {
          address_id?: string | null
          cart_session_id?: string | null
          created_at?: string
          customer_user_id?: string
          discount_total?: number
          display_id?: string
          fulfillment_status?: Database["public"]["Enums"]["fulfillment_status"]
          id?: string
          invoice?: Json
          paid_at?: string | null
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
          category_id: string | null
          fitments: Json | null
          handle: string | null
          id: string | null
          price_general: number | null
          subtitle: string | null
          supplier_slug: string | null
          title: string | null
        }
        Insert: {
          availability?: string | null
          brand_id?: string | null
          category_id?: string | null
          fitments?: Json | null
          handle?: string | null
          id?: string | null
          price_general?: number | null
          subtitle?: string | null
          supplier_slug?: string | null
          title?: string | null
        }
        Update: {
          availability?: string | null
          brand_id?: string | null
          category_id?: string | null
          fitments?: Json | null
          handle?: string | null
          id?: string | null
          price_general?: number | null
          subtitle?: string | null
          supplier_slug?: string | null
          title?: string | null
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
      begin_charge_attempt: { Args: { p_order_id: string }; Returns: Json }
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
