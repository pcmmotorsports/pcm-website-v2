// 申請頁開頁時顯示哪一種畫面(B2B 計畫 §9.7「開頁時先決定顯示哪一種畫面」, 依序判斷、命中就停)。
import type { MemberTier } from '@pcm/domain';
import type { DealerApplyValues } from './form';

/** dealer_application_mine() 回的那一列(不含 decided_by / decide_note —— 那兩欄只給員工看)。 */
export type MineRow = {
  id: string;
  company_name: string;
  tax_id: string;
  store_name: string;
  region: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DealerApplyView =
  | { kind: 'dealer' }
  | { kind: 'pending'; mine: MineRow }
  | { kind: 'approved_not_effective' }
  | { kind: 'rejected'; prefill: DealerApplyValues }
  | { kind: 'form' }
  | { kind: 'load_error' };

export function rowToValues(r: MineRow): DealerApplyValues {
  return {
    companyName: r.company_name,
    taxId: r.tax_id,
    storeName: r.store_name,
    region: r.region,
    contactName: r.contact_name,
    contactPhone: r.contact_phone,
    contactEmail: r.contact_email,
    note: r.note,
  };
}

export function decideDealerApplyView(input: {
  tier: MemberTier;
  mine: MineRow | null;
  readFailed: boolean;
}): DealerApplyView {
  // ① 能拿到經銷價的只有 store(premiumStore 這次不啟用, Sean 2026-09-25)
  if (input.tier === 'store') return { kind: 'dealer' };
  // 讀不到申請紀錄 ⇒ 不能退回空白表單:已經送過的人會以為沒送出而重送
  if (input.readFailed) return { kind: 'load_error' };
  const m = input.mine;
  if (m?.status === 'pending') return { kind: 'pending', mine: m };
  // 已核准而等級不是經銷 ⇒ 核准那一步與改等級之間出過錯, 或員工事後改回;不能顯示「已開通」
  if (m?.status === 'approved') return { kind: 'approved_not_effective' };
  if (m?.status === 'rejected') return { kind: 'rejected', prefill: rowToValues(m) };
  return { kind: 'form' };
}

