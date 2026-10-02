'use client';

// 「查最近寄信紀錄」(2026-10-02, Sean Q1 甲 / Q2 甲;計畫 ~/pcm-mailbox/計畫-查得到驗證信有沒有寄出去-20261002.md)。
// 客人說沒收到驗證信或重設密碼信時, 員工按一下, 伺服器當場問 Resend。只送客戶編號, 收件信箱由伺服器查。
import { useState, useTransition } from 'react';
import { lookupAuthMailAction } from '../../lib/customers/auth-mail-lookup-action';
import type { AuthMailLookupResult } from '../../lib/customers/auth-mail-lookup';

type Shown = AuthMailLookupResult | { kind: 'denied' } | { kind: 'failed' };

function rangeNote(checkedSince: string | null, allChecked: boolean): string {
  if (allChecked) return 'Resend 目前保留的寄信紀錄都查過了。';
  return checkedSince === null ? '' : `已查 ${checkedSince} 之後寄出的信。`;
}

function ResultView({ r }: { r: Shown }) {
  switch (r.kind) {
    case 'found':
      return (
        <div className='w-full'>
          <ul className='space-y-1 text-sm'>
            {r.rows.map((row, i) => (
              <li key={i}>
                <span className='tabular-nums'>{row.sentAt}</span>　{row.subject}　<strong>{row.status}</strong>
                {row.status === '被退回' && <span className='text-destructive'>　請和客人確認信箱是否打錯</span>}
              </li>
            ))}
          </ul>
          <p className='text-muted-foreground mt-1 text-xs'>{rangeNote(r.checkedSince, r.allChecked)}只查目前登入信箱與申請中的新信箱。</p>
        </div>
      );
    case 'none':
      return (
        <p className='text-sm'>
          {rangeNote(r.checkedSince, r.allChecked)}沒有寄給這個信箱的驗證信或重設密碼信。只查目前登入信箱與申請中的新信箱。
        </p>
      );
    case 'empty_account':
      return <p className='text-sm'>這把金鑰所屬的 Resend 帳號查不到任何寄信紀錄，請確認金鑰開在正確的帳號。</p>;
    case 'not_applicable':
      return <p className='text-sm'>這個帳號不是用 Email 和密碼註冊的，不會收到驗證信或重設密碼信。</p>;
    case 'not_configured':
      return <p className='text-sm'>寄信紀錄查詢尚未設定，請聯絡系統管理員。</p>;
    case 'key_rejected':
      return <p className='text-destructive text-sm'>寄信紀錄查詢的金鑰無效或權限不足，請聯絡系統管理員。</p>;
    case 'busy':
      return <p className='text-sm'>剛剛有人查過，請等幾秒再按一次。</p>;
    case 'denied':
      return <p className='text-destructive text-sm'>沒有權限查寄信紀錄，請重新登入。</p>;
    case 'error':
    case 'failed':
      return <p className='text-destructive text-sm'>寄信紀錄暫時查不到，請稍後再按一次。</p>;
  }
}

export function AuthMailLookupButton({ customerId }: { customerId: string }) {
  const [result, setResult] = useState<Shown | null>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      try {
        setResult(await lookupAuthMailAction(customerId));
      } catch {
        setResult({ kind: 'failed' });
      }
    });
  return (
    <div className='mt-3 flex flex-wrap items-start gap-3 border-t pt-3'>
      <button
        type='button'
        onClick={run}
        disabled={pending}
        className='h-9 rounded-md border px-4 text-sm font-medium disabled:opacity-50'
      >
        {pending ? '查詢中…' : '查最近寄信紀錄'}
      </button>
      {result === null ? (
        <p className='text-muted-foreground text-xs'>查驗證信、重設密碼信有沒有寄到。只顯示寄出時間、主旨與狀態。</p>
      ) : (
        <ResultView r={result} />
      )}
    </div>
  );
}
