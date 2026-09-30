import Link from 'next/link';
import { ADMIN_INPUT_CLASS } from '../shared/admin-form';
import { formatOrderAmount } from '../../lib/orders/order-list-view';
import { TRANSFER_MATCH_AMOUNT_PARAM, TRANSFER_MATCH_REF_PARAM } from '../../lib/orders/transfer-match';

// transfer-match-panel.tsx — 匯款對帳小工具(2026-09-30 Sean 批研究 Q2 乙), 畫在「待收款（匯款）」「待尾款」兩格的待辦清單上方。
// 🔴 零寫入、零 client JS:GET 表單送回同一條待辦網址;「新增收款」開列表既有的收款彈窗, 金額與末五碼已填好,
//    員工仍要自己勾「我已核對」再送出。
// 🎨 鈕的長相抄待辦清單那顆(`order-todo-list.tsx` 的 ACT), 同一個動作長一樣。

export const TRANSFER_NO_MATCH_TEXT = '沒有金額剛好相符的單，可能少匯或多匯，請用客戶名稱搜尋。';

export type TransferMatchRow = { id: string; displayId: string; customerName: string | null; payHref: string };

export type TransferMatchResult =
  /** 還沒按「找相符的單」。 */
  | { kind: 'idle' }
  /** 金額那格讀不懂。 */
  | { kind: 'invalid' }
  | { kind: 'unreadable' }
  | { kind: 'ok'; amount: number; rows: readonly TransferMatchRow[]; truncated: boolean };

const ACT =
  'relative z-10 inline-flex min-h-6 items-center rounded-lg border px-2 py-[3px] text-[12px] leading-[1.4] whitespace-nowrap border-border bg-card text-(--fg-2) hover:border-foreground/30';
const TD = 'px-3 py-2 align-middle text-[13px] leading-[1.4]';
const NOTE = 'm-0 text-[13px] leading-[1.4]';

export function TransferMatchPanel({
  formHref,
  searchHref,
  amountInput,
  refInput,
  result,
}: {
  /** 表單送回哪裡 = 這一格待辦清單的網址(它的參數變成 hidden input, 送出後還在同一格)。 */
  formHref: string;
  /** 找不到時叫員工去搜尋的那一頁(訂單列表)。 */
  searchHref: string;
  amountInput: string;
  refInput: string;
  result: TransferMatchResult;
}) {
  const url = new URL(formHref, 'http://localhost');
  const hidden = [...url.searchParams].filter(
    ([k]) => k !== TRANSFER_MATCH_AMOUNT_PARAM && k !== TRANSFER_MATCH_REF_PARAM,
  );
  return (
    <section aria-label='匯款對帳' data-testid='transfer-match' className='border-border bg-card space-y-3 rounded-lg border p-4'>
      <form method='get' action={url.pathname} className='flex flex-wrap items-end gap-3'>
        {hidden.map(([k, v], i) => (
          <input key={`${k}-${i}`} type='hidden' name={k} value={v} />
        ))}
        <div className='w-full'>
          <h2 className='m-0 text-[15px] leading-[1.4] font-semibold'>匯款對帳</h2>
          <p className={`${NOTE} text-(--fg-2)`}>輸入銀行入帳金額，找出還差金額剛好相符的訂單。</p>
        </div>
        <label className='flex flex-col gap-1 text-[13px]'>
          入帳金額（新臺幣元）
          <input
            className={`${ADMIN_INPUT_CLASS} w-40`}
            name={TRANSFER_MATCH_AMOUNT_PARAM}
            inputMode='numeric'
            required
            defaultValue={amountInput}
          />
        </label>
        <label className='flex flex-col gap-1 text-[13px]'>
          帳號末五碼（選填）
          <input
            className={`${ADMIN_INPUT_CLASS} w-32`}
            name={TRANSFER_MATCH_REF_PARAM}
            defaultValue={refInput}
          />
        </label>
        <button type='submit' className='bg-primary text-primary-foreground h-9 rounded-md px-3 text-sm font-medium'>
          找相符的單
        </button>
      </form>

      {result.kind === 'invalid' && <p className={`${NOTE} text-destructive`}>請輸入入帳金額（整數，不含小數點）。</p>}
      {result.kind === 'unreadable' && (
        <p className={`${NOTE} text-destructive`}>待收款的訂單載入失敗，請重新整理。若仍無法載入，請聯絡系統管理員。</p>
      )}
      {result.kind === 'ok' && result.truncated && (
        <p className={`${NOTE} text-amber-800`}>待收款的訂單太多，這次只比對了其中一部分。找不到時，請用客戶名稱搜尋確認。</p>
      )}
      {result.kind === 'ok' && result.rows.length === 0 && (
        <p className={NOTE}>
          {TRANSFER_NO_MATCH_TEXT}
          <Link href={searchHref} className='ml-2 underline underline-offset-2'>
            到訂單列表搜尋
          </Link>
          <br />
          <span className='text-(--fg-2)'>取消過或退過款的單不會列在這裡，列表上顯示「需確認」。</span>
        </p>
      )}
      {result.kind === 'ok' && result.rows.length > 0 && (
        <>
          <p className={NOTE}>
            找到 {result.rows.length} 張還差 {formatOrderAmount(result.amount)} 元的訂單。按「新增收款」會帶入金額和末五碼，請核對後勾選「我已核對」再送出。
          </p>
          <table className='w-full border-collapse'>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.id} className='border-border border-t' data-order-id={r.id}>
                  <td className={`${TD} font-mono whitespace-nowrap`}>
                    <Link href={`/orders/${r.id}`} className='underline-offset-2 hover:underline'>
                      {r.displayId}
                    </Link>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{r.customerName ?? '—'}</td>
                  {/* 📱 390 寬放不下四欄 ⇒ 窄螢幕藏這一欄(上面那句已經寫了還差多少), 不用橫捲。 */}
                  <td className={`${TD} hidden text-right whitespace-nowrap tabular-nums sm:table-cell`}>
                    還差 {formatOrderAmount(result.amount)}
                  </td>
                  <td className={`${TD} text-right`}>
                    <Link href={r.payHref} className={ACT}>
                      新增收款
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
