/**
 * @module @pcm/adapters/payment/SupabaseSiblingLookupAdapter — 立即重刷 preflight 兄弟單反查(M-3 3DS 乙路 R2b)
 *
 * **authenticated own-only**(對齊 SupabaseChargeAttemptFallbackAdapter 第二 transport 紀律):需使用者 cookie
 * JWT 的 authenticated client(`createServerSupabaseClient()`、由 composition 注入)→ `find_active_sibling_own`
 * 內 `auth.uid()` 歸屬反查同會員兄弟單;無 JWT → RPC 回 `{kind:'none'}`(own-only fail-safe)。
 *
 * 🔴 RPC 回 jsonb discriminated union(camelCase 鍵直映):`{kind:'paid'|'active'|'none', existingOrderId?,
 * attemptId?, displayId?}`;`active` 分支**不含** recTradeId/bankTransactionId(資料最小化 round6 一、§4 R1a2)。
 * 形狀不符 → fail-closed throw(不靜默轉 none、比 RPC 寬鬆 coercion 更嚴、強化付款路徑 bug 可追蹤性)。
 *
 * @see supabase/migrations/20260624120001_m3_3ds_r1a2_find_active_sibling_own.sql
 * @see docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §2.3 / §3 / §4 R1a2
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ISiblingLookup } from '@pcm/ports';
import type { SiblingLookupResult } from '@pcm/domain';

/** 本層回應解析錯誤(branded:通用訊息、零 PostgREST 原文/PII)。 */
export class SiblingLookupParseError extends Error {}

export class SupabaseSiblingLookupAdapter implements ISiblingLookup {
  constructor(private readonly supabase: SupabaseClient) {}

  async lookup(cartSessionId: string): Promise<SiblingLookupResult> {
    const { data, error } = await this.supabase.rpc('find_active_sibling_own', {
      p_cart_session_id: cartSessionId,
    });
    if (error) {
      // PostgREST error.code(SQLSTATE)供分類;訊息通用、零原文/PII。
      throw new SiblingLookupParseError(`sibling lookup 失敗(${error.code ?? 'transport'})`);
    }
    return parseSiblingLookup(data);
  }
}

/** 解析 find_active_sibling_own RPC jsonb union;形狀不符 → throw(通用、fail-closed)。 */
function parseSiblingLookup(data: unknown): SiblingLookupResult {
  const o = data as Record<string, unknown> | null;
  if (!o || typeof o.kind !== 'string') {
    throw new SiblingLookupParseError('find_active_sibling_own 回應格式異常');
  }
  if (o.kind === 'none') {
    return { kind: 'none' };
  }
  if (o.kind === 'paid') {
    if (typeof o.existingOrderId !== 'string' || typeof o.displayId !== 'string') {
      throw new SiblingLookupParseError('find_active_sibling_own 回應格式異常');
    }
    return { kind: 'paid', existingOrderId: o.existingOrderId, displayId: o.displayId };
  }
  if (o.kind === 'active') {
    // 🔴 active 不含 rec/bank(資料最小化);只取 existingOrderId/attemptId/displayId。
    if (
      typeof o.existingOrderId !== 'string' ||
      typeof o.attemptId !== 'string' ||
      typeof o.displayId !== 'string'
    ) {
      throw new SiblingLookupParseError('find_active_sibling_own 回應格式異常');
    }
    return {
      kind: 'active',
      existingOrderId: o.existingOrderId,
      attemptId: o.attemptId,
      displayId: o.displayId,
    };
  }
  throw new SiblingLookupParseError('find_active_sibling_own 回應格式異常'); // 未知 kind → fail-closed
}
