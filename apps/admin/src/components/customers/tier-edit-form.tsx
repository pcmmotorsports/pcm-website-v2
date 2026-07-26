import type { MemberTier } from '@pcm/domain';
import { setTierAction } from '../../lib/customers/tier-actions';
import {
  TIER_CUSTOMER_ID_FIELD,
  TIER_VALUE_FIELD,
  TIER_NOTE_FIELD,
  TIER_RETURN_TO_FIELD,
  TIER_NOTE_MAX,
} from '../../lib/customers/tier-form';
import { TIER_VALUES, TIER_LABEL } from '../../lib/customers/customer-list-view';
import {
  ADMIN_INPUT_CLASS,
  AdminForm,
  AdminFormField,
} from '../shared/admin-form';
import { TierEditSubmitButton } from './tier-edit-submit';

// M-4a tier 編輯:明細頁基本資料卡內的會員等級變更表單(server action;鏡像 wallet-adjust-form)。
// Sean 拍板(07-16):Q1=A 本片不 step-up;Q2=A 變更原因必填。
// select 三檔=TIER_VALUES/TIER_LABEL 復用列表片(=domain MemberTier=DB enum 全集);
// defaultValue=現值,同值送出由 RPC NO_CHANGE 冪等吸收(?r=noop 提示「沒有變更」)。
// 🔴 tier=會員等級標籤、非價格;真 pricing 生效=M-2-08(#215 defer),本表單當前只影響 admin 顯示+稽核。
// E11-2:欄位外框與版面已改用共用 <AdminForm> 卡片內嵌變體。

export function TierEditForm({ customerId, currentTier }: { customerId: string; currentTier: MemberTier }) {
  return (
    <AdminForm
      action={setTierAction}
      variant='section'
      hidden={{
        [TIER_CUSTOMER_ID_FIELD]: customerId,
        [TIER_RETURN_TO_FIELD]: `/customers/${customerId}`,
      }}
      footerHint='變更會寫入稽核紀錄;價格生效待經銷價上線。'
      actions={<TierEditSubmitButton />}
    >
      <AdminFormField label='會員等級'>
        <select name={TIER_VALUE_FIELD} defaultValue={currentTier} className={ADMIN_INPUT_CLASS}>
          {TIER_VALUES.map((tier) => (
            <option key={tier} value={tier}>
              {TIER_LABEL[tier]}
            </option>
          ))}
        </select>
      </AdminFormField>

      <AdminFormField label='變更原因(必填)'>
        <input
          type='text'
          name={TIER_NOTE_FIELD}
          maxLength={TIER_NOTE_MAX}
          required
          placeholder='例:經銷申請審核通過'
          className={ADMIN_INPUT_CLASS}
        />
      </AdminFormField>
    </AdminForm>
  );
}
