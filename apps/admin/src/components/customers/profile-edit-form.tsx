import { updateCustomerProfileAction } from '../../lib/customers/profile-actions';
import {
  PROFILE_CUSTOMER_ID_FIELD,
  PROFILE_NAME_FIELD,
  PROFILE_PHONE_FIELD,
  PROFILE_BIRTHDAY_FIELD,
  PROFILE_RETURN_TO_FIELD,
} from '../../lib/customers/profile-form';
import { ADMIN_INPUT_CLASS, AdminForm, AdminFormField } from '../shared/admin-form';
import { ProfileEditSubmitButton } from './profile-edit-submit';

// M-4b `#25` 片 C1:明細頁基本資料卡內的「姓名 / 電話 / 生日」編輯表單
// (server action;鏡像 tier-edit-form 的形狀與 <AdminForm> 卡片內嵌變體)。
//
// 🔴 **Email 不在這裡,而且是拍板**(Sean 2026-08-14 Q-C-1=A):`customers.email` 是登入帳號的一部分,
//    DB 端連 service_role 都沒有那一欄的 UPDATE 權(`20260717010000:175` 欄級 GRANT 只有
//    name/phone/birthday/updated_at),要改得另開一片。欄位旁的說明文字就是講這件事,不要拿掉。
// 🔴 **會員等級也不在這裡**:它有自己的 owner RPC + 同交易稽核(`TierEditForm`),兩者刻意分開。
//
// defaultValue = 現值;`birthday` 用原生 `<input type='date'>`(server 端另有 regex backstop,
// 理由逐字在 `packages/schemas/src/index.ts:172-173`)。

export function ProfileEditForm({
  customerId,
  name,
  phone,
  birthday,
}: {
  customerId: string;
  name: string;
  phone: string;
  birthday: string | null;
}) {
  return (
    <AdminForm
      action={updateCustomerProfileAction}
      variant='section'
      hidden={{
        [PROFILE_CUSTOMER_ID_FIELD]: customerId,
        [PROFILE_RETURN_TO_FIELD]: `/customers/${customerId}`,
      }}
      footerHint='Email 是登入帳號,不能在這裡改;要改請另開片處理。'
      actions={<ProfileEditSubmitButton />}
    >
      <AdminFormField label='姓名(必填)'>
        <input
          type='text'
          name={PROFILE_NAME_FIELD}
          defaultValue={name}
          required
          className={ADMIN_INPUT_CLASS}
        />
      </AdminFormField>

      <AdminFormField label='電話'>
        <input
          type='text'
          name={PROFILE_PHONE_FIELD}
          defaultValue={phone}
          placeholder='例:0912-345-678'
          className={ADMIN_INPUT_CLASS}
        />
      </AdminFormField>

      <AdminFormField label='生日'>
        <input
          type='date'
          name={PROFILE_BIRTHDAY_FIELD}
          defaultValue={birthday ?? ''}
          className={ADMIN_INPUT_CLASS}
        />
      </AdminFormField>
    </AdminForm>
  );
}
