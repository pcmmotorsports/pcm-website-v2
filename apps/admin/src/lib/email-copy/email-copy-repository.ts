import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { EmailCopyVersion } from '@pcm/domain';

// 信件文字第 3 片:讀整張版本表(很小, 一季改幾次)。讀不到 ⇒ throw, 畫面顯示「載入失敗」, 不當成沒有改過。

export type EmailCopyVersionWithAuthor = EmailCopyVersion & { savedBy: string };

export async function listEmailCopyVersions(): Promise<EmailCopyVersionWithAuthor[]> {
  const { data, error } = await createSupabaseServiceClient()
    .from('email_copy_versions' as never)
    .select('id, copy_key, text, saved_at, saved_by')
    .order('saved_at' as never, { ascending: false })
    .limit(5000);
  if (error) throw new Error('email_copy_versions 讀取失敗');
  return ((data ?? []) as unknown as Array<{ id: string; copy_key: string; text: string | null; saved_at: string; saved_by: string }>).map(
    (r) => ({ id: r.id, copyKey: r.copy_key, text: r.text, savedAt: r.saved_at, savedBy: r.saved_by }),
  );
}
