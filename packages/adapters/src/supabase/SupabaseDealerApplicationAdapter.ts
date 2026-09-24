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
  };
};

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

  async countPending(): Promise<{ ok: true; count: number } | { ok: false; error: unknown }> {
    const { count, error } = await this.db
      .from('dealer_applications')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (error || typeof count !== 'number') return { ok: false, error: error ?? new Error('count 不是數字') };
    return { ok: true, count };
  }
}
