'use client';

// 「寄送重設密碼信」(B2B 計畫 §9.9 片 D4b)。寄的是客人自己按「忘記密碼」也會收到的同一封信,
// 員工看不到連結也看不到密碼。收件人由 server 用客人編號查, 這裡只送編號。
import { useFormStatus } from 'react-dom';
import { sendPasswordResetAction } from '../../lib/customers/password-reset-actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type='submit' disabled={pending} className='h-9 rounded-md border px-4 text-sm font-medium disabled:opacity-50'>
      {pending ? '處理中…' : '寄送重設密碼信'}
    </button>
  );
}

export function PasswordResetButton({ customerId, email }: { customerId: string; email: string }) {
  return (
    <form
      action={sendPasswordResetAction}
      onSubmit={(e) => {
        if (!window.confirm(`確定要寄重設密碼信到 ${email}？客人點信裡的連結後可以設定新密碼。`)) e.preventDefault();
      }}
      className='mt-3 flex flex-wrap items-center gap-3 border-t pt-3'
    >
      <input type='hidden' name='customer_id' value={customerId} />
      {/* 確認視窗上的地址;server 比對跟現在的一樣才寄(收件人仍由 server 查) */}
      <input type='hidden' name='shown_email' value={email} />
      <Submit />
      <p className='text-muted-foreground text-xs'>1 分鐘內只能寄一次。寄出後會寫入操作紀錄。</p>
    </form>
  );
}
