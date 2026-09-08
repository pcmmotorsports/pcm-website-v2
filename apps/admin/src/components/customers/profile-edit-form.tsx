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
// 🔴 **Email 不在【這一支表單】裡,而那仍然是拍板**(Sean 2026-08-14 Q-C-1=A):
//    `customers.email` 是登入帳號的一部分,改它要走自己的一片。
//
// ⛔ ~~「DB 端連 service_role 都沒有那一欄的 UPDATE 權(`20260717010000:175` 欄級 GRANT 只有
//    name/phone/birthday/updated_at),要改得另開一片」~~
// 🔴🔴 **那三句今天都不成立了,而【過期它們的是我】**(`-auth` 2026-09-08):
//    ① `20260908100000_m4b_customers_email_update_grant.sql` **已貼進正式庫**
//       ⇒ service_role **現在有** `customers.email` 的欄級 UPDATE 權
//       (貼後唯讀對帳實測:六欄 birthday, email, gender, name, phone, updated_at)
//    ② 那份「只有四欄」的清單在 `20260901040000`(gender)之後就已經舊了
//    ③ **「另開一片」那一片【已經存在】** —— `<EmailChangeForm>`,就渲染在這張卡的**下面**
//       (`customer-detail.tsx` 裡排在 `<TierEditForm>` 之後,那個順序是刻意的)
//
// 🛑 **而「欄位旁的說明文字…不要拿掉」那一句要特別講**:它當初是對的,而**它沒有到期日**。
//    今天那句 `footerHint` 逐字仍寫「要改請**另開片處理**」⇒ 對不知道下面有一格的人,
//    那是**句點不是指路**(2026-09-08 實錘:Sean 傳來的截圖切在那一行下面,他讀成「功能不在」)。
//    ⇒ 📮 **文案怎麼改是 Sean 的板, 已排隊問他** —— 這裡**不自行改字**,只把事實訂正在註解裡。
//    ⇒ 📌 形狀記著:**一句描述「別處現在長什麼樣」的註解, 有一個沒有人會去看的到期日**,
//       而**過期它的通常就是寫下一片的那個人**。這一次那個人是我, 而我當時沒有回頭看這裡。
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
      // 🔴 **這一句 2026-09-08 改過(Sean 拍 A「改成指路的」;`Q4` 逐字回「q4 a」)。**
      //    ⛔ ~~舊字面:「Email 是登入帳號,不能在這裡改;要改請**另開片處理**。」~~
      //       ⇒ 那句在寫的當天是對的(當時真的沒有那一片), 而**它沒有到期日**
      //       ⇒ 2026-09-08 那一片做出來之後它變成假的, 而**當天就誤導了 Sean 本人**
      //         (他的截圖切在這一行下面, 他把它讀成「功能不在」)。
      //
      // 🔴 **指的那個名字是【實際渲染出來的字面】, 不是我記得的那個**:
      //    我 grep 過 `email-change-form.tsx` —— 它**沒有標題**(`AdminForm` 沒收 `heading`),
      //    畫面上真正看得到的只有欄位 label `改成新的 Email(登入帳號)` 與鈕 `改成這個信箱`。
      //    🛑 **所以不能寫「更改 Email」** —— 那四個字**畫面上不存在**, 指過去等於叫人去找一個沒有的東西。
      //
      // 🔵 **方位詞用「下面」不用「往下捲」**:DOM 上它確實排在本表單之後(`customer-detail.tsx`
      //    裡在 `<TierEditForm>` 之後), 而**要不要捲取決於視窗高度, 那我沒有量**。
      //    (同日 front 才因為「左側」在手機上不存在而拿掉一句方位詞 ⇒ 不再賭一個沒量過的方位。)
      //
      // 🔴🔴 **而這一句【也會過期】—— 給它一個會讓人回來的條件**(形狀抄 `lib/staff.ts:96`):
      //    **這句話依賴下面那一區存在。若 `<EmailChangeForm>` 被拿掉或改名, 這一句要一起改。**
      //
      // ⚠️ **這句話沒有守門**:`grep -rln '另開片處理' apps packages --include='*.test.*'` ⇒ 零命中,
      //    而 `profile-edit-form` **沒有任何測試檔**(🟢 正對照:同一把尺找 `不要再按` ⇒ 3 支檔 ⇒ 尺是活的)。
      //    ⇒ 📌 **改錯它不會有任何東西紅。** 這裡明寫, 而**不順手加一個守門**(那是另一件事)。
      footerHint='Email 是登入帳號,不能在這裡改;要改請看下面的【改成新的 Email】那一欄。'
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
