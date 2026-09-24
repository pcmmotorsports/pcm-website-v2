// 後台「經銷商申請」列表的顯示規則(B2B 計畫 §9.5,片 D1)。

export type DealerAppStatus = 'pending' | 'approved' | 'rejected';
export type DealerAppStatusFilter = DealerAppStatus | 'all';

export const DEALER_APP_STATUS_LABEL: Record<DealerAppStatus, string> = {
  pending: '審核中',
  approved: '已核准',
  rejected: '已婉拒',
};

export const DEALER_APP_FILTERS: ReadonlyArray<{ value: DealerAppStatusFilter; label: string }> = [
  { value: 'pending', label: '審核中' },
  { value: 'approved', label: '已核准' },
  { value: 'rejected', label: '已婉拒' },
  { value: 'all', label: '全部' },
];

/** 預設只看審核中(§9.5);不認得的值也回審核中, 不回全部。 */
export function parseDealerAppStatusFilter(v: string | string[] | undefined): DealerAppStatusFilter {
  const s = Array.isArray(v) ? v[0] : v;
  return s === 'approved' || s === 'rejected' || s === 'all' ? s : 'pending';
}

export function dealerAppListHref(f: DealerAppStatusFilter): string {
  return f === 'pending' ? '/customers/dealer-applications' : `/customers/dealer-applications?status=${f}`;
}

/** 員工看的那一列(service_role 讀表;客人那邊的函式不回 decided_by / decide_note)。型別住在 adapter。 */
export type { DealerApplicationRow } from '@pcm/adapters/server';
