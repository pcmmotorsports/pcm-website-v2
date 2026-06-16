// database.types.ts — Supabase 生成型別(backlog #106、勿手改)
//
// 來源:pcm-website-v2 (bmpnplmnldofgaohnaok) live prod DB schema。
// 再生:`supabase gen types typescript --project-id bmpnplmnldofgaohnaok > packages/adapters/src/supabase/database.types.ts`
//   (用 --project-id 非 --linked:.env.local 非 ASCII 內容會炸 --linked 解析)
//
// ⚠️ 反映 LIVE prod schema、非 repo 最新 migration:db push bundle(0a/0b/0c/1b/#214a/4a-*、見
//   memory 3ds-db-push-bundle-blocked)尚未套用 → 此檔不含 cart_session_id / webhook_events /
//   4a-2 attempt 欄 / 5-param create_order 等未推 schema。**db push 後須重新 gen 此檔**、
//   typecheck 才會抓到 mapper ↔ schema drift(#106 的核心價值)。
//
// 用途:client.ts 注入 SupabaseClient<Database> generic + mappers Row 型別 derive 自此檔
//   (Database['public']['Tables'|'Views'][...]['Row'])、取代手寫 Row、消雙 cast escape hatch。
//   server-only(@pcm/adapters)、型別 compile 期擦除、零 runtime/bundle 影響、無經銷價洩漏。

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
          created_at: string
          customer_user_id: string
          fallback_token_hash: string
          id: string
          order_id: string
          rec_trade_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_user_id: string
          fallback_token_hash: string
          id?: string
          order_id: string
          rec_trade_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_user_id?: string
          fallback_token_hash?: string
          id?: string
          order_id?: string
          rec_trade_id?: string | null
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
          id: string
          images: Json
          metadata: Json
          price_by_tier: Json
          price_general: number | null
          price_store: number | null
          subtitle: string | null
          supplier_slug: string
          title: string
          updated_at: string
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
          id?: string
          images?: Json
          metadata?: Json
          price_by_tier: Json
          price_general?: number | null
          price_store?: number | null
          subtitle?: string | null
          supplier_slug?: string
          title: string
          updated_at?: string
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
          id?: string
          images?: Json
          metadata?: Json
          price_by_tier?: Json
          price_general?: number | null
          price_store?: number | null
          subtitle?: string | null
          supplier_slug?: string
          title?: string
          updated_at?: string
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
          id: string | null
          images: Json | null
          price_general: number | null
          subtitle: string | null
          supplier_slug: string | null
          title: string | null
          updated_at: string | null
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
          id?: string | null
          images?: Json | null
          price_general?: number | null
          subtitle?: string | null
          supplier_slug?: string | null
          title?: string | null
          updated_at?: string | null
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
          id?: string | null
          images?: Json | null
          price_general?: number | null
          subtitle?: string | null
          supplier_slug?: string | null
          title?: string | null
          updated_at?: string | null
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
      confirm_order_payment: {
        Args: { p_amount: number; p_order_id: string; p_rec_trade_id: string }
        Returns: Json
      }
      create_order: {
        Args: {
          p_address_id: string
          p_invoice: Json
          p_lines: Json
          p_shipping_method: string
        }
        Returns: Json
      }
      m3_jsonb_values_all_string: { Args: { j: Json }; Returns: boolean }
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
