import { adjustWalletAction } from '../../lib/customers/wallet-actions';
import {
  WALLET_CUSTOMER_ID_FIELD,
  WALLET_AMOUNT_FIELD,
  WALLET_NOTE_FIELD,
  WALLET_RETURN_TO_FIELD,
  WALLET_NOTE_MAX,
} from '../../lib/customers/wallet-form';
import {
  ADMIN_INPUT_CLASS,
  AdminForm,
  AdminFormField,
} from '../shared/admin-form';
import { WalletAdjustSubmitButtons } from './wallet-adjust-submit';

// M-4a 儲值金編輯:明細頁儲值金卡內的調整表單(server action;鏡像 order-edit-form)。
// Sean 拍板 Q1=B:「加值」「扣款」兩顆 submit(name=direction 定方向)+ 金額恆收正整數(server 轉號)
// + 備註必填;允許扣成負餘額(RPC 無下界擋)。Q2=A:本片不 step-up。
// 🔴 double-submit(codex 關卡2 F1):submit 鈕=client island pending disable(防雙擊縱深)+
// PRG 吸收 back-resubmit;DB 級 UNIQUE 去重=schema 改動、D1 決策題待 Sean(A 接受/B 現狀/C schema 去重)。
// E11-2:欄位外框與版面已改用共用 <AdminForm> 卡片內嵌變體。

export function WalletAdjustForm({ customerId }: { customerId: string }) {
  return (
    <AdminForm
      action={adjustWalletAction}
      variant='section'
      hidden={{
        [WALLET_CUSTOMER_ID_FIELD]: customerId,
        [WALLET_RETURN_TO_FIELD]: `/customers/${customerId}`,
      }}
      footerHint='扣款可扣成負餘額(內部彈性)。'
      actions={<WalletAdjustSubmitButtons />}
    >
      <AdminFormField label='金額(元、正整數)'>
        <input
          type='text'
          inputMode='numeric'
          name={WALLET_AMOUNT_FIELD}
          maxLength={8}
          required
          placeholder='例:500'
          className={ADMIN_INPUT_CLASS}
        />
      </AdminFormField>

      <AdminFormField label='備註(必填)'>
        <input
          type='text'
          name={WALLET_NOTE_FIELD}
          maxLength={WALLET_NOTE_MAX}
          required
          placeholder='例:門市儲值 / 電話訂單折抵'
          className={ADMIN_INPUT_CLASS}
        />
      </AdminFormField>
    </AdminForm>
  );
}
