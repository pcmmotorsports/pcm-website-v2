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
          <Field label='Email' value={customerEmailDisplay(customer.email)} />
          <Field label='電話' value={customer.phone || null} />
          <Field label='生日' value={customer.birthday} />
          <Field label='會員等級' value={TIER_LABEL[customer.tier]} />
          <Field label='註冊日期' value={formatCustomerDate(customer.createdAt)} />
          {/* 🔴 **板 :437 —— 這一列是【依 precedent 的授權偏離】,不是 Sean 點名批准的。**
              鐵則 1 掃過:OD 磁碟 12 個專案,後台客人卡的稿有兩支
              (`pcm-admin-order-ui/customer-card-summary.html` 645 行 /
               `customer-card-directions.html` 373 行),兩支都畫了「基本資料」卡,
              而「驗證 / 已驗 / 未驗」在兩支裡**零命中**(正對照 `Email` 兩支各 ≥1、負對照 grep rc=1)。

              🔵 **code-reviewer must-fix 3(2026-08-30)訂正**:
              ~~原句寫「欄位與上面五列**逐欄相同**」~~ —— **那句是假的,而它正是這段紀錄
              存在的理由所在(它會被稽核),所以錯得特別貴。**逐行讀過之後的事實:
              ```
              summary:345-349      電話 / 生日 / 等級 / Email / 來源（5 列）
                                   🔴 沒有「註冊日期」列——它在 :343 的 h3 dim 裡，
                                      和「累計消費」擠在一起；標籤是「等級」不是「會員等級」
              directions:258-264   電話 / Email / 生日 / 會員等級 / 註冊日期 / 累計消費（6 列）
              本檔上面五列          Email / 電話 / 生日 / 會員等級 / 註冊日期
              ⇒ 正確說法：本檔與 directions 那一支【標籤逐字相同、順序不同、少一列「累計消費」】，
                 而與 summary 那一支【對不上】。⇒「照既有 <Field> 加一列」仍然成立，
                 而它成立的依據是 directions 那一支，不是「兩支都一樣」。
              ```
              ⇒ 主視窗 2026-08-30 裁【甲】:照既有 `<Field>` 形狀加一列、不自創視覺語彙,
                 依據是 Sean 對「稿上讀不到的局部可自畫灰底小字」的 precedent。
              📌 **寫這一段是因為「授權偏離」與「自己發明」在 code 上長得一樣** ——
                 差別只在有沒有這一筆紀錄。**而一筆寫錯的紀錄比沒有紀錄更糟。**
              🛑 **而甲的邊界只有這一列** —— 這張卡的其他欄位、間距、標題一個字都沒動。

              🟢 **而這張卡曾經自相矛盾,2026-08-30 已修 —— 留痕不刪,因為它解釋了上面那一列的用途。**
              ```
              ~~舊況：後台手動建的客人，佔位信箱 manual_<id>@manual.pcmmotorsports.local
                也是合成網域 ⇒ customerEmailDisplay 一律回「LINE 帳號登入，無 Email」
                ⇒ 上一列印「LINE 帳號登入」、下一列印「後台建立（佔位信箱）」⇒ 同一張卡打架~~
              ✅ 現況：那個字面改成不分平台的「系統產生的位址」（Sean 2026-08-30 拍甲）
                ⇒ Email 那一欄只回答「這個位址能不能寄信」，
                   而「他從哪登入」由下面這一列回答 —— 兩列各答一題，不再互相打架。
              ```
              📌 **而那個矛盾【本片之前就存在】** —— 手動建的客人本來就被標成 LINE,
                 **是這一列把它照出來的**。⇒ 「照出來」正是這一列的用途,而它第一天就做到了。
              🔵 **而我原本說「不修」的第二個理由(那個常數有三個顯示點、兩份字面必漂)
                 後來被證明【從來不成立】** —— 兩邊的觸發條件與讀者都不同,不是同一句話的兩份拷貝。
                 詳 `lib/customers/customer-list-view.ts` 那個常數的註解。
                 📌 **一個「修法有代價」的判斷,在我沒去查那個代價還在不在的時候,就只是一個藉口。** */}
          <Field
            label='Email 驗證'
            value={EMAIL_VERIFICATION_LABEL[(emailVerification ?? { kind: 'unknown' }).kind]}
          />
          {/* `#25` 片 C1:姓名/電話/生日可編。🔴 與 TierEditForm 一樣包在 `!readOnly` 裡 ——
              面板版是「看」的地方(見上方 readOnly 的 docstring),兩支表單的 returnTo 都寫死
              站內 /customers,從訂單面板送出會把員工的面板弄不見。 */}
          {!readOnly && (
            <ProfileEditForm
              customerId={customer.id}
              name={customer.name}
              phone={customer.phone}
              birthday={customer.birthday}
            />
          )}
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
