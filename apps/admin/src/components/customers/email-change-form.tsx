import type { EmailVerification } from '../../lib/customers/email-verification';
import { emailChangeEligibility } from '../../lib/customers/email-change-state';
import { changeCustomerEmailAction } from '../../lib/customers/email-change-action';
import {
  EMAIL_CHANGE_CUSTOMER_ID_FIELD,
  EMAIL_CHANGE_EMAIL_FIELD,
  EMAIL_CHANGE_RETURN_TO_FIELD,
} from '../../lib/customers/email-change-form';
import { ADMIN_INPUT_CLASS, AdminForm, AdminFormField } from '../shared/admin-form';
import { EmailChangeSubmitButton } from './email-change-submit';

// 明細頁基本資料卡內的「改客人信箱」表單(Sean 2026-09-08 最終拍 A =【最簡單版】)。
//
// ══ 🔴 鐵則 1(design 真權威)—— 掃過了, 結論是【稿裡沒有這個元件】═══════════
//   OD daemon 2026-09-08 16:5x 連不上(`list_projects` 回 daemon 不可達)⇒ 照鐵則 1
//   「數字不合 ⇒ 以磁碟為準」改數磁碟:`.../Open Design/.../data/projects` ⇒ **12 個專案**。
//   後台客人卡的稿有兩支(`pcm-admin-order-ui/customer-card-summary.html` /
//   `customer-card-directions.html`)。
// ```
//   ⚪ 負對照  現造字面 zzqNoSuchDesign20260908  ⇒ 12 個專案全掃 ⇒ 0
//   🟢 正對照  Email                            ⇒ 兩支稿各 2 命中 ⇒ 尺是活的
//   🎯 讀數    改信箱 / 更改信箱 / change email  ⇒ 12 個專案全掃 ⇒ **0**
// ```
//   ⇒ 📌 稿上沒有它 ⇒ 照**同一張卡既有的** `<AdminForm variant='section'>` 形狀加,
//      不自創視覺語彙 —— 與 `ProfileEditForm` / `TierEditForm` 逐字同一個積木。
//      (這條 precedent 與它的邊界寫在 `customer-detail.tsx` 那一長段註解裡, 不在這裡重抄。)
//
// ══ 🔴 這支表單【只有可以改的帳號才渲染】, 而那**不是**安全線 ═══════════════
//   真正的閘在 `email-change-action.ts` 第 ③ 步(server 端重讀一次 `app_metadata.pcm_provider`)。
//   這裡不渲染的用途是**別讓員工看到一個按下去一定會被拒的欄位**;
//   ⚠️ 而 hidden 欄位的 POST 任何人都送得出來 ⇒ **少了 server 那一道, 這一道等於沒有。**

export function EmailChangeForm({
  customerId,
  currentEmail,
  verification,
  authProviders,
}: {
  customerId: string;
  currentEmail: string;
  /** 資格判讀結果(取數在 `load-customer-detail` 第六路,判讀是純函式)。 */
  verification: EmailVerification;
  /**
   * 🔴 GoTrue `app_metadata.providers` —— 資格閘的**第二個軸**。
   * 沒傳 / `null` ⇒ fail-closed(畫面顯示「現在讀不到」而不是給出一個按了會被拒的欄位)。
   * 為什麼需要它:Google 一鍵註冊的帳號 `kind` 會判成 `verified`
   * ⇒ 只看 `verification` 的話這張表單會渲染出來, 而 server 端必拒。
   */
  authProviders: readonly string[] | null;
}) {
  const eligibility = emailChangeEligibility(verification.kind, authProviders);
  if (!eligibility.allowed) {
    // 🔴 **擋下來要說得出【為什麼】與【下一步】,不是把欄位藏起來就算了。**
    //    藏起來的話員工會以為系統壞了, 然後去找別的路(而別的路是直接改 DB)。
    return <p className='text-muted-foreground mt-3 border-t pt-3 text-sm'>{eligibility.reason}</p>;
  }

  return (
    <AdminForm
      action={changeCustomerEmailAction}
      variant='section'
      hidden={{
        [EMAIL_CHANGE_CUSTOMER_ID_FIELD]: customerId,
        [EMAIL_CHANGE_RETURN_TO_FIELD]: `/customers/${customerId}`,
      }}
      footerHint='⚠️ 只有管理者能存。這會換掉他【登入用】的信箱,而且直接算成已驗證 —— 等於我們替他背書「這個信箱是他的」,之後任何人拿那個信箱都能重設密碼進到這個帳號。所以請先用【我們原本就有的聯絡方式】(訂單上的電話)打給他確認是本人,不要只照來電者念的字拼一次。舊訂單上的通知信箱不會跟著變。'
      actions={<EmailChangeSubmitButton />}
    >
      {/* 🔵 **刻意不傳 `name`** 給 `AdminFormField`:那個 prop 接的是 `useActionState` 那條
          錯誤流(`admin-form-errors`), 而本片走 PRG redirect ⇒ 那裡永遠是 null。
          傳了會讓下一個人以為這一欄有 inline 錯誤在承重, 而它沒有。錯誤走上方橫幅。 */}
      <AdminFormField label='改成新的 Email(登入帳號)'>
        <input
          type='email'
          name={EMAIL_CHANGE_EMAIL_FIELD}
          // 🔴 **`defaultValue` 刻意留空,不預填現值**:預填 ⇒ 員工按下去而一個字都沒改
          //    ⇒ 送出一發「改成原本那個」⇒ 而那一發會**把帳號標成已驗證**(`email_confirm: true`)
          //    ⇒ 一個原本沒驗證的帳號被無聲地標成驗證過了。⇒ 空欄位逼他把新信箱打出來。
          placeholder={`目前是 ${currentEmail}`}
          required
          className={ADMIN_INPUT_CLASS}
        />
      </AdminFormField>
    </AdminForm>
  );
}
