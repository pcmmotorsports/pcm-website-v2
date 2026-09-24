import type {
  Customer,
  CustomerAddress,
  CustomerVehicle,
  OrderListItem,
  WalletLedgerEntry,
} from '@pcm/domain';
import Link from 'next/link';
import { TIER_LABEL, formatCustomerDate, customerEmailDisplay } from '../../lib/customers/customer-list-view';
// 板 :437:Email 驗證狀態。判讀是純函式,本檔只負責把那一態畫出來。
import {
  EMAIL_VERIFICATION_LABEL,
  type EmailVerification,
} from '../../lib/customers/email-verification';
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
import { ListPagination } from '../shared/list-pagination';
import { WALLET_LEDGER_PAGE_SIZE } from '../../lib/customers/load-customer-detail';
import { TierEditForm } from './tier-edit-form';
import { ProfileEditForm } from './profile-edit-form';
// ⟦b4-AUTHMAIL1⟧ 後續片:改客人信箱(Sean 2026-09-08 最終拍 A = 最簡單版)。
import { EmailChangeForm } from './email-change-form';
import { PasswordResetButton } from './password-reset-button';
import { emailChangeEligibility } from '../../lib/customers/email-change-state';
import { lineStatusLabel, type LineStatus } from '../../lib/customers/line-status-view';

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
  emptyHint,
}: {
  entries: WalletLedgerEntry[];
  orderHref?: (orderId: string) => string;
  /** 空清單時的替代文案（總數 > 0 卻本頁無列時用，避免與「共 N 筆」互相矛盾）。 */
  emptyHint?: string;
}) {
  if (entries.length === 0) {
    // 🔴 `emptyHint`:總數 > 0 卻這一頁空的（例如 URL 竄改成 ?wpage=999）
    //    ⇒ 不能說「目前沒有交易紀錄」，那與旁邊的「共 N 筆」互相矛盾。
    if (emptyHint) {
      return <p className='text-muted-foreground py-2 text-sm'>{emptyHint}</p>;
    }
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
  walletTotal,
  walletPage,
  walletPageHref,
  orders,
  ordersLoadFailed,
  addresses,
  addressesLoadFailed,
  vehicles,
  vehiclesLoadFailed,
  readOnly = false,
  orderHref,
  emailVerification,
  emailAuthProviders,
  line,
}: {
  customer: Customer;
  walletEntries: WalletLedgerEntry[];
  /** 儲值金流水總筆數（伺服器 count，不是本頁筆數）。 */
  walletTotal: number;
  /** 目前頁（1-indexed）。 */
  walletPage: number;
  /** 給定頁碼 → 連結；面板版沒有自己的 URL ⇒ 傳 undefined 代表「不顯示翻頁」。 */
  walletPageHref?: (page: number) => string;
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
  /**
   * 板 :437 —— Email 驗證狀態。
   * 🔴 **可選,而預設是 `unknown` 不是 `verified`** —— 沒傳進來時要顯示「讀不到」,
   *    **不能**顯示成「已驗證」。(面板版與明細版共用本元件,而面板版可能不帶它。)
   */
  emailVerification?: EmailVerification;
  /**
   * 🔴 改信箱資格閘的**第二個軸**(GoTrue `app_metadata.providers`)。
   * 沒傳 ⇒ `null` ⇒ 那張表單 fail-closed 顯示「現在讀不到」,**不是**給出一個按了會被拒的欄位。
   */
  emailAuthProviders?: readonly string[] | null;
  /**
   * 🆕 2026-09-14(Sean Q11 乙):LINE 綁定狀態,唯讀一行印在「個人資料」卡。
   * 🔴 收**算好的狀態**,不收原始列 —— `line_user_id` 不進元件 props(`20260914040000` 檔頭:那顆 id 不該到瀏覽器)。
   * 🔴 不傳 / `unknown` = **讀不到**(欄位還沒貼或讀失敗)⇒ 印「讀不到…不代表他沒綁」,不得顯示成「沒用 LINE」。
   */
  line?: LineStatus;
}) {
  const lineStatus: LineStatus = line ?? { kind: 'unknown' };
  const eligibility = emailChangeEligibility(
    (emailVerification ?? { kind: 'unknown' }).kind,
    emailAuthProviders ?? null,
  );
  return (
    <div className='pcm-plist pcm-cust space-y-3'>
      {/* 🆕 C5(2026-09-14 設計窗)對稿 v22 `data-sec="cust1"`:頂列 ← 回客戶列表 · 姓名 · 等級 · 註冊/張單;
          四張卡 = 儲值金(餘額大字 + 加值/扣款)· 會員等級(現況大字 + 三選一 + 確認 + 那句)· 個人資料 · Email。
          🔴 表單一支都沒換:`WalletAdjustForm` / `TierEditForm` / `ProfileEditForm` / `EmailChangeForm` 原封搬進卡裡,
             action / 稽核 / 管理者判斷都在它們自己那半;這裡只換版面與字級(`.pcm-cards` 那層在 globals)。
          🔵 「基本資料」那張唯讀清單收掉了 —— 姓名 / 電話 / 生日在個人資料卡的欄位裡就看得到,Email 與驗證狀態在 Email 卡;
             註冊日期搬到頂列。`Email 驗證` 這個字面與〔…〕徽章照留(`customer-detail-email*.test` 釘著它們)。
          🔵 稿沒畫的(儲值金交易紀錄 / 訂單歷史 / 地址 / 車輛)照留在下面 —— 那些是 Sean 拍過的,稿上沒畫 ⇒ 留。 */}
      <div className='pcm-head'>
        {/* 「← 回客戶列表」由 `[id]/page.tsx` 在本元件上方畫(既有),這裡不再畫第二顆。 */}
        <h1>{customer.name}</h1>
        <span className={customer.tier === 'premiumStore' ? 'pcm-tier pcm-tier--dealer' : 'pcm-tier'}>{TIER_LABEL[customer.tier]}</span>
        <span className='pcm-sp' />
        <span className='pcm-count'>
          註冊 {formatCustomerDate(customer.createdAt)}
          {!ordersLoadFailed ? ` · ${orders.length} 張單` : ''}
        </span>
      </div>
      <div className='pcm-cards'>
        <section className='pcm-card'>
          <h4 className='pcm-card-h'>儲值金 目前餘額</h4>
          <div className='pcm-big'>{formatWalletBalance(customer.walletBalance)}</div>
          <div className='pcm-sub2'>累積儲值 {formatWalletBalance(customer.totalDeposit)}</div>
          {!readOnly && <WalletAdjustForm customerId={customer.id} />}
        </section>
        <section className='pcm-card'>
          <h4 className='pcm-card-h'>會員等級</h4>
          <div className='pcm-big'>{TIER_LABEL[customer.tier]}</div>
          <div className='pcm-sub2'>改這裡只影響以後的新單</div>
          {!readOnly && <TierEditForm customerId={customer.id} currentTier={customer.tier} />}
          <p className='pcm-note2'>
            <b>已經成立的舊單不會跟著變</b> —— 單上的等級是下單當下記下來的。
          </p>
        </section>
      </div>
      <div className='pcm-cards'>
        <section className='pcm-card pcm-card--wide'>
          <h4 className='pcm-card-h'>個人資料</h4>
          {/* LINE 綁定狀態(唯讀;零寫入)。日期走同一支 `formatCustomerDate`(台北)。 */}
          <Field
            label='LINE'
            value={lineStatusLabel(
              lineStatus,
              lineStatus.kind === 'friend' ? formatCustomerDate(lineStatus.friendAt) : undefined,
            )}
          />
          {readOnly ? (
            <>
              <Field label='電話' value={customer.phone || null} />
              <Field label='生日' value={customer.birthday} />
            </>
          ) : (
            <ProfileEditForm
              customerId={customer.id}
              name={customer.name}
              phone={customer.phone}
              birthday={customer.birthday}
            />
          )}
        </section>
        <section className='pcm-card pcm-card--wide'>
          <h4 className='pcm-card-h'>Email</h4>
          <Field
            label='現在的 Email'
            value={
              <>
                {customerEmailDisplay(customer.email)}
                <span className='text-muted-foreground ml-2 whitespace-nowrap'>〔{eligibility.badge}〕</span>
              </>
            }
          />
          <Field
            label='Email 驗證'
            value={EMAIL_VERIFICATION_LABEL[(emailVerification ?? { kind: 'unknown' }).kind]}
          />
          {!readOnly && (
            <EmailChangeForm
              customerId={customer.id}
              currentEmail={customer.email}
              verification={emailVerification ?? { kind: 'unknown' }}
              authProviders={emailAuthProviders ?? null}
            />
          )}
          {/* 片 D4b:只給「Email + 密碼」登入的帳號(與改信箱同一個判準);server 送出時會再查一次 */}
          {!readOnly && eligibility.allowed && <PasswordResetButton customerId={customer.id} email={customer.email} />}
          <p className='pcm-note2'>修改的是客戶的登入 Email。訂單通知會優先寄到該筆訂單設定的通知信箱，修改登入 Email 不會同步變更訂單的通知信箱。</p>
        </section>
      </div>
      <section className={CARD}>
        <h2 className={CARD_TITLE}>儲值金交易紀錄</h2>
        {walletLoadFailed ? (
          <p className='text-destructive py-2 text-sm'>
            交易紀錄載入失敗,請稍後再試(基本資料不受影響)。
          </p>
        ) : (
          <>
            <WalletLedgerTable
              entries={walletEntries}
              orderHref={orderHref}
              emptyHint={
                walletTotal > 0
                  ? '這一頁沒有資料 —— 可能是頁碼超出範圍，請回到第 1 頁。'
                  : undefined
              }
            />
            {/* 🔴 翻頁只在【有自己的 URL】的整頁版顯示；面板是抽屜、沒有 URL。 */}
            {walletPageHref ? (
              <ListPagination
                page={walletPage}
                total={walletTotal}
                pageSize={WALLET_LEDGER_PAGE_SIZE}
                shownCount={walletEntries.length}
                buildHref={walletPageHref}
              />
            ) : (
              // 🔴 面板【也要說出這只是一部分】(codex 2026-08-17 抓到):
              //    不說的話，員工會把抽屜裡的最近 20 筆當成完整帳本
              //    ⇒ 那正是本片要修的那個病，只是被搬進了抽屜。
              walletTotal > walletEntries.length && (
                <p className='text-muted-foreground pt-2 text-xs'>
                  顯示最近 {walletEntries.length} 筆，共 {walletTotal} 筆 —— 完整紀錄請開整頁。
                </p>
              )
            )}
          </>
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
