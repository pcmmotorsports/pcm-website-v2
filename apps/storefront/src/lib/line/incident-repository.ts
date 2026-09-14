import 'server-only';
// eslint-disable-next-line no-restricted-imports -- 受控例外(同 friend-repository.ts 那道門):webhook 沒有使用者 session;窄門 pcm_incident_log_line_forward_failed 只 GRANT 給 service_role(20260914100000)。本檔 server-only、只被 api/line/webhook/route.ts 經 forward-webhook 引用、不入 client bundle。
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// lib/line/incident-repository.ts — LINE 轉發失敗留痕 pcm_incident 的唯一落點。
// 🔴 kind 在 DB 端寫死(窄門), 這裡只能傳 detail;不開 pcm_incident_log(text,uuid,text) 那支給 service_role。
// 🔴 supabase-js 的 .rpc() 失敗回 { error } 不 reject ⇒ 這裡轉成 throw, 由 forward-webhook 吞掉只 log。

type LooseClient = { rpc(fn: string, args: Record<string, unknown>): Promise<{ error: unknown }> };

export async function logLineForwardFailed(detail: string): Promise<void> {
  const client = createSupabaseServiceClient() as unknown as LooseClient;
  const { error } = await client.rpc('pcm_incident_log_line_forward_failed', { p_detail: detail });
  if (error) throw error;
}
