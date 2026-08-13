import type {
  Customer,
  CustomerAddress,
  CustomerVehicle,
  OrderListItem,
  WalletLedgerEntry,
} from '@pcm/domain';
import Link from 'next/link';
import { TIER_LABEL, formatCustomerDate } from '../../lib/customers/customer-list-view';
import {
  WALLET_ENTRY_LABEL,
  formatWalletEntryAmount,
  formatWalletBalance,
} from '../../lib/customers/customer-detail-view';
import {
  CustomerOrdersSection,
  CustomerAddressesSection,
  CustomerVehiclesSection,
} from './customer-detail-sections';
import { WalletAdjustForm } from './wallet-adjust-form';
import { TierEditForm } from './tier-edit-form';

// M-4a 客戶明細-a+b+儲值金編輯+tier 編輯:基本資料(含等級變更表單)+ 儲值金(餘額 + 流水 + 調整表單)
// + 訂單歷史 + 地址 + 車庫。
// 🔴 PII 邊界:本頁顯示客人 email/電話/生日/地址/引擎號(admin-only、service_role、登入閘後);列表不帶。
// 🔴 儲值金 = Sean 2026-07-16 拍板 admin 後台可顯示+可調整(override 05-31 前台 hold、範圍僅後台);
//    調整=WalletAdjustForm → admin_adjust_wallet owner RPC(plan 關卡1 PASS;ledger+audit 同交易)。
// 🔴 tier 編輯 = TierEditForm → admin_set_customer_tier owner RPC(關卡1 PASS+Q1=A/Q2=A 07-16 拍板;
//    UPDATE 單欄+audit 同交易、同值 NO_CHANGE 冪等)。
// 🔴 零成本/經銷價欄(customers/ledger/OrderListItem 型別層皆無);tier=會員等級標籤、非價格。

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

/**
 * 🔴 **這張表裡也有一個「訂單連結」**(關聯訂單欄的「查看訂單」)——
 * codex 關卡2(2026-08-13)抓到:片 3b 第一版只接了下方「訂單歷史」那個,**漏了這一個**。
 * Sean 的逐字是「點客人變成看向訂單一樣,**然後再點訂單**或者回去變成看訂單」,
 * 而**「再點訂單」沒有限定是哪一個訂單連結** ⇒ 客人卡裡**每一個能點到訂單的地方**都要換回訂單面板,
 * 否則員工在面板點這一顆會被整頁跳走、**遺失原列表篩選與面板狀態**。
 */
function WalletLedgerTable({
  entries,
  orderHref = (orderId) => `/orders/${orderId}`,
}: {
  entries: WalletLedgerEntry[];
  orderHref?: (orderId: string) => string;
}) {
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
                  <Link href={orderHref(entry.relatedOrderId)} className='underline'>
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
  orders,
  ordersLoadFailed,
  addresses,
  addressesLoadFailed,
  vehicles,
  vehiclesLoadFailed,
  readOnly = false,
  orderHref,
}: {
  customer: Customer;
  walletEntries: WalletLedgerEntry[];
  /** 各區塊載入失敗旗標(基本資料仍可看;誠實顯示錯誤態、不顯空清單假象)。 */
  walletLoadFailed: boolean;
  orders: OrderListItem[];
  ordersLoadFailed: boolean;
  addresses: CustomerAddress[];
  addressesLoadFailed: boolean;
  vehicles: CustomerVehicle[];
  vehiclesLoadFailed: boolean;
  /**
   * OD 片 3b:**唯讀模式**(訂單面板版用;主視窗 2026-08-13 裁 A)。
   *
   * 🔴 `true` 時**不渲染 `<TierEditForm>` 與 `<WalletAdjustForm>`** —— 那兩支分別**動權限**
   *    (tier 決定經銷價可見性)與**動錢**(儲值金),而它們的 server action 把 `returnTo`
   *    限定在站內 `/customers` 路徑(`lib/customers/wallet-actions.ts:23` 逐字)、
   *    表單本身也沒有 `return_to` 欄 ⇒ 從訂單面板送出會把員工 redirect 到 `/customers`,
   *    **他手上那張訂單面板就消失了**,而他只是「看一下客人」。
   * 🔴 裁 A 的依據是 Sean 逐字全句都是「**看**」:「點客人變成**看**向訂單一樣,
   *    然後再點訂單或者回去變成**看**訂單」⇒ 面板是看的地方,要編輯請開整頁版。
   * ⚠️ 這是**縮減能力**不是擴張:面板版能力嚴格少於整頁版,整頁版行為一個字不變
   *    (預設 `false` ⇒ 既有呼叫端不必改、也不會被靜默改掉行為)。
   */
  readOnly?: boolean;
  /**
   * OD 片 3b:**這張卡裡每一個訂單連結**連到哪(不傳 = 整頁版)。
   * 🔴 消費端有**兩處**:下方「訂單歷史」的單號、以及儲值金交易紀錄的「查看訂單」。
   *    第一版只接了前者(codex 關卡2 must-fix)—— 加新的訂單連結時記得一起接。
   */
  orderHref?: (orderId: string) => string;
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
          {!readOnly && <TierEditForm customerId={customer.id} currentTier={customer.tier} />}
        </section>

        <section className={CARD}>
          <h2 className={CARD_TITLE}>儲值金</h2>
          <Field label='目前餘額' value={formatWalletBalance(customer.walletBalance)} />
          <Field label='累積儲值' value={formatWalletBalance(customer.totalDeposit)} />
          {!readOnly && <WalletAdjustForm customerId={customer.id} />}
        </section>
      </div>

      <section className={CARD}>
        <h2 className={CARD_TITLE}>儲值金交易紀錄</h2>
        {walletLoadFailed ? (
          <p className='text-destructive py-2 text-sm'>
            交易紀錄載入失敗,請稍後再試(基本資料不受影響)。
          </p>
        ) : (
          <WalletLedgerTable entries={walletEntries} orderHref={orderHref} />
        )}
      </section>

      <CustomerOrdersSection orders={orders} loadFailed={ordersLoadFailed} orderHref={orderHref} />

      <div className='grid gap-4 md:grid-cols-2'>
        <CustomerAddressesSection addresses={addresses} loadFailed={addressesLoadFailed} />
        <CustomerVehiclesSection vehicles={vehicles} loadFailed={vehiclesLoadFailed} />
      </div>
    </div>
  );
}
