import type { SiblingLookupResult } from '@pcm/domain';

/**
 * ISiblingLookup:立即重刷 preflight 的兄弟單反查 port(M-3 3DS 乙路 R2b、canonical §2.3/§3/§4 R1a2)。
 *
 * 🔴 **authenticated own-only**:實作(`SupabaseSiblingLookupAdapter`)走帶使用者 cookie JWT 的 supabase
 * client 呼 `find_active_sibling_own(uuid)`(SECDEF own-only、`auth.uid()` 歸屬);回 `SiblingLookupResult`
 * discriminated union(active 去 rec/bank=資料最小化 round6 一)。
 *
 * 信任 / 安全邊界:歸屬由 DB own-only(`auth.uid()`)鎖死,**不信 client 傳的 user/order**;cart_session_id
 * 為查詢 filter(begin RPC 同款只讀 DB row key、不接受 client 重送當比對輸入,plan §4 不變量)。
 *
 * 回傳 / 例外:無 JWT / 無 cart / 查無 → `{kind:'none'}`(RPC own-only fail-safe);
 * **transport / 回應形狀不符 → throw**(use-case fail-closed hold、不建新單,§2.3)。
 */
export interface ISiblingLookup {
  lookup(cartSessionId: string): Promise<SiblingLookupResult>;
}
