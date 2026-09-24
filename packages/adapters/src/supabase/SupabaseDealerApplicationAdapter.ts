import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './database.types';

// 經銷商申請(B2B 計畫 §9,片 D1 / D2)的後台讀取。只給 service_role client 用。
// 🔴 dealer_applications 是 migration 20260925010000 建的表, 還沒貼到正式庫 ⇒ 生成器產不出型別。
//    照 SupabaseCouponAdapter 的做法:本檔自己把那張表疊在 Database 上(不動共用的 database.types.ts)。
//    貼板後重 gen, 這個疊加型別與生成的形狀一致就可以拿掉。

export type DealerApplicationStatus = 'pending' | 'approved' | 'rejected';

export type DealerApplicationRow = {
  id: string;
  user_id: string;
  company_name: string;
  tax_id: string;
  store_name: string;
  region: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  note: string;
  status: DealerApplicationStatus;
  decided_by: string | null;
  decided_at: string | null;
  decide_note: string;
  created_at: string;
  updated_at: string;
};

/** 經銷品牌折扣(20260925030000;B2B 計畫 §10)。below_cost_reason 是成本相關, 只給管理者看。 */
export type DealerBrandDiscountRow = {
  customer_user_id: string;
  brand_id: string;
  percent: number;
  below_cost_reason: string;
  updated_at: string;
  updated_by: string;
};

type DatabaseWithDealerApplications = Database & {
  public: Database['public'] & {
    Tables: Database['public']['Tables'] & {
      dealer_applications: {
        Row: DealerApplicationRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      dealer_brand_discounts: {
        Row: DealerBrandDiscountRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Functions: Database['public']['Functions'] & {
      admin_dealer_application_decide: {
        Args: {
          p_application_id: string;
          p_decision: string;
          p_note: string;
          p_actor: string;
          p_request_id: string;
          p_expected_tier: string;
          p_expected_updated_at: string;
        };
        Returns: string;
      };
      admin_dealer_account_create: {
        Args: {
          p_user_id: string;
          p_company_name: string;
          p_tax_id: string;
          p_store_name: string;
          p_region: string;
          p_contact_name: string;
          p_contact_phone: string;
          p_contact_email: string;
          p_note: string;
          p_actor: string;
          p_request_id: string;
        };
        Returns: string;
      };
      admin_dealer_brand_discounts_save: {
        Args: { p_customer: string; p_changes: Json; p_expected: Json; p_actor: string; p_request_id: string };
        Returns: string;
      };
      admin_password_reset_claim: {
        Args: { p_customer: string; p_actor: string; p_request_id: string };
        Returns: string;
      };
    };
  };
};

/** admin_dealer_application_decide 的回傳(20260925010000)。不認得的值原樣帶出, 由呼叫端當成結果不明。 */
export type DealerApplicationDecideResult =
  | 'APPROVED' | 'REJECTED' | 'NOT_FOUND' | 'ALREADY_DECIDED' | 'STALE' | 'WOULD_DOWNGRADE';

const COLUMNS =
  'id, user_id, company_name, tax_id, store_name, region, contact_name, contact_phone, contact_email, note, status, decided_by, decided_at, decide_note, created_at, updated_at';

export class SupabaseDealerApplicationAdapter {
  private readonly db: SupabaseClient<DatabaseWithDealerApplications>;

  constructor(supabase: SupabaseClient<Database>) {
    this.db = supabase as unknown as SupabaseClient<DatabaseWithDealerApplications>;
  }

  async list(
    status: DealerApplicationStatus | 'all',
    limit: number,
  ): Promise<{ ok: true; rows: DealerApplicationRow[] } | { ok: false; error: unknown }> {
    let q = this.db.from('dealer_applications').select(COLUMNS);
    if (status !== 'all') q = q.eq('status', status);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
    if (error) return { ok: false, error };
    return { ok: true, rows: (data ?? []) as DealerApplicationRow[] };
  }

  async get(id: string): Promise<{ ok: true; row: DealerApplicationRow | null } | { ok: false; error: unknown }> {
    const { data, error } = await this.db.from('dealer_applications').select(COLUMNS).eq('id', id).maybeSingle();
    if (error) return { ok: false, error };
    return { ok: true, row: (data as DealerApplicationRow | null) ?? null };
  }

  /**
   * 核准 / 婉拒(片 D2)。改等級與標記申請在資料庫同一個交易裡做完。
   * 🔴 expectedUpdatedAt 要原樣傳資料庫給的字串(微秒), 不要轉 Date(只剩毫秒 ⇒ 每次都 STALE)。
   * 呼叫失敗直接丟出去 —— 交易沒成功就不會有任何寫入, 呼叫端當成「結果無法確認」。
   */
  async decide(p: {
    applicationId: string;
    decision: 'approve' | 'reject';
    note: string;
    actor: string;
    requestId: string;
    expectedTier: string;
    expectedUpdatedAt: string;
  }): Promise<string> {
    const { data, error } = await this.db.rpc('admin_dealer_application_decide', {
      p_application_id: p.applicationId,
      p_decision: p.decision,
      p_note: p.note,
      p_actor: p.actor,
      p_request_id: p.requestId,
      p_expected_tier: p.expectedTier,
      p_expected_updated_at: p.expectedUpdatedAt,
    });
    if (error) throw error;
    if (typeof data !== 'string') throw new Error('admin_dealer_application_decide 回傳不是文字');
    return data;
  }

  /**
   * 後台直接新增經銷帳號的第 3 步(片 D4a, 20260925020000):寫一筆已核准申請並把等級改成 store。
   * 冪等:同一個帳號做過就回 ALREADY_DONE。呼叫失敗直接丟出去(交易沒成功就沒有任何寫入)。
   */
  async createStaffDealer(p: {
    userId: string;
    companyName: string;
    taxId: string;
    storeName: string;
    region: string;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
    note: string;
    actor: string;
    requestId: string;
  }): Promise<string> {
    const { data, error } = await this.db.rpc('admin_dealer_account_create', {
      p_user_id: p.userId,
      p_company_name: p.companyName,
      p_tax_id: p.taxId,
      p_store_name: p.storeName,
      p_region: p.region,
      p_contact_name: p.contactName,
      p_contact_phone: p.contactPhone,
      p_contact_email: p.contactEmail,
      p_note: p.note,
      p_actor: p.actor,
      p_request_id: p.requestId,
    });
    if (error) throw error;
    if (typeof data !== 'string') throw new Error('admin_dealer_account_create 回傳不是文字');
    return data;
  }

  /**
   * 替客人寄重設密碼信之前先搶這一格(片 D4b, 20260925020000;與經銷帳號同一支 migration, 放在這裡)。
   * OK / TOO_SOON / NOT_FOUND。呼叫失敗直接丟出去。
   */
  async claimPasswordReset(p: { customerId: string; actor: string; requestId: string }): Promise<string> {
    const { data, error } = await this.db.rpc('admin_password_reset_claim', {
      p_customer: p.customerId,
      p_actor: p.actor,
      p_request_id: p.requestId,
    });
    if (error) throw error;
    if (typeof data !== 'string') throw new Error('admin_password_reset_claim 回傳不是文字');
    return data;
  }

  /** 某位會員的品牌折扣(片 E3)。withReason = false 時不讀低於成本的原因(非管理者)。 */
  async listBrandDiscounts(
    customerId: string,
    withReason: boolean,
  ): Promise<{ ok: true; rows: DealerBrandDiscountRow[] } | { ok: false; error: unknown }> {
    const cols = withReason
      ? 'customer_user_id, brand_id, percent, below_cost_reason, updated_at, updated_by'
      : 'customer_user_id, brand_id, percent, updated_at, updated_by';
    const { data, error } = await this.db.from('dealer_brand_discounts').select(cols).eq('customer_user_id', customerId);
    if (error) return { ok: false, error };
    const rows = ((data ?? []) as unknown as DealerBrandDiscountRow[]).map((r) => ({
      ...r,
      // numeric 從 PostgREST 回來可能是字串
      percent: Number(r.percent),
      below_cost_reason: withReason ? (r.below_cost_reason ?? '') : '',
    }));
    return { ok: true, rows };
  }

  /** 整批存(片 E3, admin_dealer_brand_discounts_save)。呼叫失敗直接丟出去。 */
  async saveBrandDiscounts(p: {
    customerId: string;
    changes: Json;
    expected: Json;
    actor: string;
    requestId: string;
  }): Promise<string> {
    const { data, error } = await this.db.rpc('admin_dealer_brand_discounts_save', {
      p_customer: p.customerId,
      p_changes: p.changes,
      p_expected: p.expected,
      p_actor: p.actor,
      p_request_id: p.requestId,
    });
    if (error) throw error;
    if (typeof data !== 'string') throw new Error('admin_dealer_brand_discounts_save 回傳不是文字');
    return data;
  }

  async countPending(): Promise<{ ok: true; count: number } | { ok: false; error: unknown }> {
    const { count, error } = await this.db
      .from('dealer_applications')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (error || typeof count !== 'number') return { ok: false, error: error ?? new Error('count 不是數字') };
    return { ok: true, count };
  }
}
