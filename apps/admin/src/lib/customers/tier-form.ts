// tier-form.ts — 會員等級變更 server action 的純函式核心(M-4a tier 編輯片;可單測、無 'use server'/next 依賴)。
// authz(session/Origin/actor)在 action 檔;本檔只做「表單 → RPC 參數」形狀層
// (語意 fail-closed 權威在 admin_set_customer_tier RPC〔20260717010000〕,此處輕驗 + 縱深)。
//
// Sean 拍板(07-16、directive 單):Q1=A 本片不 step-up;Q2=A 變更原因備註必填。
// tier 白名單復用列表片 TIER_VALUES(customer-list-view;=domain MemberTier=DB enum member_tier 全集)。

import type { MemberTier } from '@pcm/domain';
import type { FormLike } from '../orders/workflow-form';
import { TIER_VALUES } from './customer-list-view';
import { parseCustomersReturnTo } from './wallet-form';

// ── 表單欄名(明細頁基本資料卡 tier 編輯表單用)──
export const TIER_CUSTOMER_ID_FIELD = 'customer_id';
export const TIER_VALUE_FIELD = 'tier';
export const TIER_NOTE_FIELD = 'note';
export const TIER_RETURN_TO_FIELD = 'return_to';

/** 變更原因長度上限(與 RPC 1c 一致)。 */
export const TIER_NOTE_MAX = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TierEditParseResult =
  | {
      ok: true;
      customerId: string;
      tier: MemberTier;
      note: string;
      returnTo: string;
    }
  | { ok: false };

function asString(v: FormDataEntryValue | null): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * 表單 → { customerId, tier, note }(形狀層;語意 fail-closed 在 RPC):
 * - customer_id 須 UUID,否則 ok:false;
 * - tier 須嚴格等值命中 TIER_VALUES 白名單('Store'/'store ' 等變體=ok:false;RPC 端同套再拒);
 * - note 須 trim 後非空且 ≤200 字(必填=Sean Q2=A;RPC 端另拒控制字元);
 * - return_to:只接受站內 /customers 路徑(parseCustomersReturnTo 共用守門);非法 → 退 '/customers'。
 */
export function parseTierEditForm(form: FormLike): TierEditParseResult {
  const customerId = asString(form.get(TIER_CUSTOMER_ID_FIELD));
  if (!customerId || !UUID_RE.test(customerId)) return { ok: false };

  const tierRaw = asString(form.get(TIER_VALUE_FIELD));
  const tier = TIER_VALUES.find((v) => v === tierRaw);
  if (!tier) return { ok: false };

  const note = (asString(form.get(TIER_NOTE_FIELD)) ?? '').trim();
  if (note === '' || note.length > TIER_NOTE_MAX) return { ok: false };
  // 零寬/格式字防（本片 codex 關卡2 F2 補集）：JS trim() 已吃 Unicode White_Space 全集（含 NBSP/全形/
  // U+1680/U+2000-200A/U+205F、不含 U+0085 NEL），NEL/零寬/格式字（U+0085/U+200B/200C/200D/U+2060/U+FEFF/U+180E）不算
  // whitespace → 「看似空白」原因在此擋；語意權威=RPC v_ws 全集（migration 20260717010000）。
  if (note.replace(/[\u0085\u180E\u200B\u200C\u200D\u2060\uFEFF]/g, '').trim() === '') return { ok: false };

  return {
    ok: true,
    customerId,
    tier,
    note,
    returnTo: parseCustomersReturnTo(form.get(TIER_RETURN_TO_FIELD)),
  };
}
