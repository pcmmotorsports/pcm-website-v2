import 'server-only';
import { createSupabaseAnonClient } from '@pcm/adapters';

/**
 * 顧客站【目錄讀路】專用的 anon client —— 與 `createSupabaseAnonClient()` 唯一的差別是
 * 每一發 HTTP 帶 15 秒上限(`fetchTimeoutMs`, 見 `packages/adapters/src/supabase/client.ts`)。
 *
 * 🔴 只給讀路用(products / search / recommendations / facet-counts;主視窗 2026-09-14 批):
 *   wallet / auth / search-log 那些寫路**不要**換成這一支 —— 寫路逾時的語意不同(送出去了但沒收到回應)。
 * 🔵 15 秒怎麼來的:anon statement_timeout 3 秒 + 57014 重試一次 = 6 秒是 SQL 那一層的最壞;
 *   剩下的餘裕給連線排隊(正式站見過 rpcMs=21747 那種, 那一發本來就該當失敗處理, 不該撐到 300 秒)。
 */
export const CATALOG_FETCH_TIMEOUT_MS = 15_000;

export function createCatalogAnonClient() {
  return createSupabaseAnonClient({ fetchTimeoutMs: CATALOG_FETCH_TIMEOUT_MS });
}
