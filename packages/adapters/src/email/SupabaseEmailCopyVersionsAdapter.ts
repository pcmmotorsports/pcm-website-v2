import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailCopyVersionRow, IEmailCopyVersionsReader } from '@pcm/ports';
import type { Database } from '../supabase/database.types';

// 信件文字第 2 片:讀員工改的交易信文字(表 email_copy_versions, migration 20261002200000)。
// service_role 只有 SELECT、INSERT;讀不到就 throw, 由寄信端分流(見 IEmailCopyVersions.ts)。

type Row = { id: string; copy_key: string; text: string | null; saved_at: string };

/**
 * 安全上限:一季改幾次, 這個數字遠大於實際;真的碰到就 throw, 不默默只讀一部分。
 * ⚠️ 碰到之後每一輪都會「讀不到」並告警, 而 service_role 沒有 DELETE ⇒ 要靠一支 migration 清舊版本(或調高這個數字)。
 */
const MAX_ROWS = 5000;

export class SupabaseEmailCopyVersionsAdapter implements IEmailCopyVersionsReader {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listAll(): Promise<EmailCopyVersionRow[]> {
    const { data, error } = await this.client
      .from('email_copy_versions' as never)
      .select('id, copy_key, text, saved_at')
      .order('saved_at' as never, { ascending: true })
      .limit(MAX_ROWS + 1);
    if (error !== null && error !== undefined) throw new Error('email_copy_versions 讀取失敗');
    const rows = (data ?? []) as unknown as Row[];
    if (rows.length > MAX_ROWS) throw new Error('email_copy_versions 超過讀取上限');
    return rows.map((r) => ({ id: r.id, copyKey: r.copy_key, text: r.text, savedAt: r.saved_at }));
  }
}
