import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

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

type DatabaseWithDealerApplications = Database & {
  public: Database['public'] & {
    Tables: Database['public']['Tables'] & {
      dealer_applications: {
        Row: DealerApplicationRow;
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

  async countPending(): Promise<{ ok: true; count: number } | { ok: false; error: unknown }> {
    const { count, error } = await this.db
      .from('dealer_applications')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (error || typeof count !== 'number') return { ok: false, error: error ?? new Error('count 不是數字') };
    return { ok: true, count };
  }
}
