import type { Customer, WalletLedgerEntry } from '@pcm/domain';
import Link from 'next/link';
import { TIER_LABEL, formatCustomerDate } from '../../lib/customers/customer-list-view';
import {
  WALLET_ENTRY_LABEL,
  formatWalletEntryAmount,
  formatWalletBalance,
} from '../../lib/customers/customer-detail-view';

// M-4a 客戶明細-a:基本資料 + 儲值金(餘額 + 流水)、server-render 唯讀。
// 🔴 PII 邊界:本頁顯示客人 email/電話/生日(admin-only、service_role、登入閘後);列表不帶生日。
// 🔴 儲值金 = Sean 2026-07-16 拍板 admin 後台可顯示(override 05-31 前台 hold、範圍僅後台);
//    「修改」= 後續高風險寫入片(ledger entry、plan 關卡1),本片唯讀零寫入路徑。
// 🔴 零成本/經銷價欄(customers/ledger 表本身無);tier=會員等級標籤、非價格。
// 訂單歷史/地址/車庫 = 明細-b(下一片)。

const CARD = 'rounded-lg border bg-card p-4 text-card-foreground';
const CARD_TITLE = 'text-muted-foreground mb-3 text-xs font-medium';
const ROW = 'flex justify-between gap-4 py-1 text-sm';
const ROW_LABEL = 'text-muted-foreground shrink-0';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      <span className='text-right break-all'>{value ?? '—'}</span>
    </div>
  );
}

function WalletLedgerTable({ entries }: { entries: WalletLedgerEntry[] }) {
  if (entries.length === 0) {
    return <p className='text-muted-foreground py-2 text-sm'>目前沒有儲值金交易紀錄。</p>;
  }
  const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
  const TD = 'px-3 py-2 text-sm align-top';
  return (
    <div className='overflow-x-auto rounded-lg border'>
      <table className='w-full border-collapse'>
        <thead>
          <tr>
            <th className={TH}>日期</th>
            <th className={TH}>類型</th>
            <th className={`${TH} text-right`}>金額</th>
            <th className={TH}>備註</th>
            <th className={TH}>關聯訂單</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className='border-t'>
              <td className={`${TD} whitespace-nowrap`}>{entry.entryDate}</td>
              <td className={`${TD} whitespace-nowrap`}>{WALLET_ENTRY_LABEL[entry.entryType]}</td>
              <td
                className={`${TD} text-right font-medium whitespace-nowrap ${entry.amount < 0 ? 'text-destructive' : ''}`}
              >
                {formatWalletEntryAmount(entry.amount)}
              </td>
              <td className={TD}>{entry.note || '—'}</td>
              <td className={`${TD} whitespace-nowrap`}>
                {entry.relatedOrderId ? (
                  <Link href={`/orders/${entry.relatedOrderId}`} className='underline'>
                    查看訂單
                  </Link>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CustomerDetail({
  customer,
  walletEntries,
  walletLoadFailed,
}: {
  customer: Customer;
  walletEntries: WalletLedgerEntry[];
  /** 流水載入失敗(基本資料仍可看;誠實顯示錯誤態、不顯空清單假象)。 */
  walletLoadFailed: boolean;
}) {
  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <h1 className='text-2xl font-semibold'>{customer.name}</h1>
        <span className='bg-secondary text-secondary-foreground inline-flex rounded-full px-2 py-0.5 text-xs'>
          {TIER_LABEL[customer.tier]}
        </span>
      </div>

      <div className='grid gap-4 md:grid-cols-2'>
        <section className={CARD}>
          <h2 className={CARD_TITLE}>基本資料</h2>
          <Field label='Email' value={customer.email} />
          <Field label='電話' value={customer.phone || null} />
          <Field label='生日' value={customer.birthday} />
          <Field label='會員等級' value={TIER_LABEL[customer.tier]} />
          <Field label='註冊日期' value={formatCustomerDate(customer.createdAt)} />
        </section>

        <section className={CARD}>
          <h2 className={CARD_TITLE}>儲值金</h2>
          <Field label='目前餘額' value={formatWalletBalance(customer.walletBalance)} />
          <Field label='累積儲值' value={formatWalletBalance(customer.totalDeposit)} />
        </section>
      </div>

      <section className={CARD}>
        <h2 className={CARD_TITLE}>儲值金交易紀錄</h2>
        {walletLoadFailed ? (
          <p className='text-destructive py-2 text-sm'>
            交易紀錄載入失敗,請稍後再試(基本資料不受影響)。
          </p>
        ) : (
          <WalletLedgerTable entries={walletEntries} />
        )}
      </section>
    </div>
  );
}
