import {
  MANUAL_CUSTOMER_NEW_NAME_FIELD,
  MANUAL_CUSTOMER_NEW_PHONE_FIELD,
  MANUAL_ORDER_CUSTOMER_FIELD,
  MANUAL_ORDER_IN_PANEL_FIELD,
  MANUAL_ORDER_IN_PANEL_VALUE,
  MANUAL_ORDER_INVOICE_CARRIER_FIELD,
  MANUAL_ORDER_INVOICE_DONATE_CODE_FIELD,
  MANUAL_ORDER_INVOICE_TAX_ID_FIELD,
  MANUAL_ORDER_INVOICE_TITLE_FIELD,
  MANUAL_ORDER_INVOICE_TYPE_FIELD,
  MANUAL_ORDER_PAYMENT_CHANNEL_FIELD,
  MANUAL_ORDER_REQUEST_ID_FIELD,
  MANUAL_ORDER_SHIPPING_FEE_FIELD,
  MANUAL_ORDER_SHIPPING_METHOD_FIELD,
  MANUAL_ORDER_SHIP_TO_LINE_FIELD,
  MANUAL_ORDER_SHIP_TO_NAME_FIELD,
  MANUAL_ORDER_SHIP_TO_PHONE_FIELD,
  MANUAL_ORDER_SOURCE_FIELD,
} from '@/lib/orders/manual-order-form';
import {
  MANUAL_ORDER_PANEL_VALUE,
  manualOrderBasePath,
  manualOrderCustomerHref,
} from '@/lib/orders/manual-order-action-state';
import { ORDER_PANEL_PARAM } from '@/lib/orders/order-return-to';
import type { ManualCustomerCandidate } from '@/lib/customers/manual-customer';
import { createManualCustomerAction } from '@/lib/customers/manual-customer-actions';
import { createManualOrderAction } from '@/lib/orders/manual-order-actions';
import { ManualOrderLines } from './manual-order-lines';

// manual-order-form-body.tsx — M12-A3-b:手動建單表單本體(客人 / 經手人 / 收件 / 發票 / 運費)。
// ⛔ ~~🔴 **品項那一列不在本片**(A3-c)。本片先讓「一張沒有品項的單」在畫面上成立…~~
//    ✅ **2026-08-24 夜 A3-c 落地**:品項列已接上(`./manual-order-lines`),那張擋路的黃色告示已拿掉。
//
// ⛔ ~~🔴 **零 client state、純 server component** —— 照取消片 PRG 那條路
//    (`cancel-actions.ts:29-33` 逐字:混合形在 React 19 的 form reset 競態下四輪修不穩)。~~
// 🔴🔴 **上面那句在寫下的當天就已經是【引用了一份已被撤回的說法】**(2026-08-24 夜線4 發現):
//    `cancel-actions.ts` 的那一段**自己就寫著**逐字
//    「⚠️ 原本這行寫『全 PRG、零 client state』—— **A13b E1 之後「零 client state」為假**」。
//    ⇒ **被引用的那份更正過了,而引用它的這一份照抄了更正前的版本。**
//    📌 形狀:**引用一句話時,座標對了不代表內容還成立。**
//
// **現況(取代上面兩段)**:本檔本體仍是 server component、全 PRG;
//    而品項那一塊是一個 client 子元件(`manual-order-lines.tsx`),
//    它**只持有「有幾列」這一個 state,一個值都不碰** —— 形狀逐字比照取消線的
//    `cancel-form-body.tsx`(漸進增強層),那條路是被審過的,不是我新發明的。
//
// 🔴🔴 **兩段式,而那是 codex R1 must-fix 逼出來的形狀**:
//    原本搜尋框與建單表單同時在畫面上 ⇒ 員工填好運費 150 與地址之後按「找客人」
//    ⇒ GET 導頁 ⇒ **整份表單重建,運費無聲回到 0** ⇒ 他補完必填欄就**少收 150**。
//    ⇒ 改成:**選到客人之前不出建單表單**。搜尋不可能清掉還沒開始填的東西
//      —— 這不是「小心一點」,是把那個時間窗**拿掉**。

/** 這一頁的表單值。**沒有 actor 這一格,而那是承重的**(見 `manual-order-actions.ts`)。 */
export type ManualOrderFormBodyProps = {
  /** 這一次的冪等鍵。🔴 **由頁面決定**:失敗導回時沿用 URL 帶回來的那顆,否則鑄新的。 */
  manualRequestId: string;
  /** 啟用中的員工。**空陣列 = 整張表單停用**。 */
  activeStaff: ReadonlyArray<{ id: string; label: string }>;
  /** 依電話查到的客人候選(可空)。 */
  candidates: ReadonlyArray<ManualCustomerCandidate>;
  /** 查回來的候選被上限截斷 ⇒ 畫面必須說出來(靜默截斷讓員工以為就這幾個)。 */
  candidatesTruncated: boolean;
  /** 員工這次搜的電話原字面(回填搜尋框)。 */
  phoneQuery: string;
  /** 已經選定的客人。🔴 `null` = **不出建單表單**(兩段式,見檔頭)。 */
  selectedCustomer: ManualCustomerCandidate | null;
  /**
   * 客人查詢是不是壞掉了。
   * 🔴 **「查壞了」與「查無」不得印同一個畫面**(codex R1 must-fix):
   *    後者要他去建客人(做得到),前者要他找人 —— 他建再多客人都沒用。
   */
  lookupFailed: boolean;
  /** 員工名單讀不到。🔴 讀不到時**不出**「還沒有建立員工」那一句(頁面那層會說「讀不到」)。 */
  staffLoadFailed: boolean;
  /**
   * 這張表單此刻長在**右側面板**裡(`/orders?panel=new`)還是**整頁**裡(`/orders/new`)。
   *
   * 🔴 **它只決定「送出之後回到哪裡」,一格欄位都不動** —— 兩邊是同一張表單。
   *    少了它,在面板裡按「找客人」會**跳出面板、整頁換掉**,
   *    而那正是 Sean 2026-08-27 抱怨的「一塊一塊、跑來跑去」。
   */
  inPanel?: boolean;
};

export function ManualOrderFormBody({
  manualRequestId,
  activeStaff,
  candidates,
  candidatesTruncated,
  phoneQuery,
  selectedCustomer,
  lookupFailed,
  staffLoadFailed,
  inPanel = false,
}: ManualOrderFormBodyProps) {
  const noStaff = activeStaff.length === 0;
  // 🔴 **GET 表單的 `action` 上帶 query 是無效的** —— 瀏覽器送出時會把 `?…` 整段丟掉,
  //    所以面板版的 `panel=new` 必須走**隱藏欄位**,不能寫在 `action` 裡。
  //    (POST 那兩張沒有這個問題;它們用隱藏旗標 `in_panel`。)
  const searchAction = inPanel ? '/orders' : '/orders/new';
  const base = manualOrderBasePath(inPanel);
  const baseSep = base.includes('?') ? '&' : '?';
  // 🔴 **那句指路只在【真的沒有員工】時出** —— 名單讀不到時由頁面那層說話,
  //    兩句同時在畫面上會互相矛盾(codex R1 nit),而它們的下一步相反。
  const showNoStaffNotice = noStaff && !staffLoadFailed;

  return (
    <div className='space-y-4'>
      {/* 🔴 停用態:staff 空 ⇒ 整張表單停用 + 一句話指路(Sean 2026-08-24 裁「甲」)。
          文案寫【怎麼做】不寫內部語彙 —— 不是「staff 表為空」。 */}
      {showNoStaffNotice && (
        <div
          role='status'
          data-testid='manual-order-no-staff'
          className='rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700'
        >
          還沒有建立員工。請先到
          <a className='underline' href='/settings/staff'>
            【設定 → 員工】
          </a>
          新增,才能建單。
        </div>
      )}

      {/* 客人查詢:獨立 GET 表單,不與建單表單巢狀(HTML 不允許 form 巢狀)。
          🔴🔴 **選定客人之後就不出它**(codex R2 新發現 must-fix):
          我原本以為「兩段式」已經把清值那條路拿掉了 —— **沒有**。
          搜尋框留在畫面上 ⇒ 員工填完地址與運費再按一次「找客人」⇒ 值照樣全部消失。
          ⇒ 要換人請走表單裡那個「換一位」(它會回到還沒填東西的狀態)。 */}
      {selectedCustomer === null && (
      <form method='get' action={searchAction} className='flex gap-2'>
        {inPanel && <input type='hidden' name={ORDER_PANEL_PARAM} value={MANUAL_ORDER_PANEL_VALUE} />}
        <input type='hidden' name='mrid' value={manualRequestId} />
        <label className='sr-only' htmlFor='manual-order-phone'>
          客人電話
        </label>
        <input
          id='manual-order-phone'
          name='phone'
          defaultValue={phoneQuery}
          placeholder='用電話找客人'
          className='w-56 rounded-md border px-2 py-1 text-sm'
        />
        <button type='submit' className='rounded-md border px-3 py-1 text-sm'>
          找客人
        </button>
      </form>
      )}

      {candidatesTruncated && (
        <p role='status' className='text-sm text-amber-700'>
          符合的帳號太多,下面只列出前面幾個。請把電話打完整一點再找一次。
        </p>
      )}
      {/* 🔴🔴 **這裡原本印的是一條死路**(2026-08-28 線A 量到,原句逐字):
          「這支電話找不到客人。請先到【客人】頁建立這位客人,再回來建單。」
          —— 而**客人頁沒有新增客人的按鈕**(那一頁與 `components/customers/*` 的 `<form>` 共 5 個:
          篩選 / 關鍵字搜尋 / 改資料 / 改等級 / 儲值金,零個是建立;負對照同尺:本檔 `<form>` ⇒ 2)。
          ⇒ 那句話叫員工去一個**做不到那件事**的地方 ⇒ 找不到客人 = 這張單建不出來。
          ⇒ Sean 2026-08-27 逐字「沒有直接新增」講的就是這一格。
          ✅ 改成**就地建**:`createManualCustomer`(`manual-customer.ts:324`)早就寫好審過、零呼叫端。

          🔴 **它是獨立一張 `<form>`,不與建單表單巢狀**(HTML 不允許)——
             而且此刻建單表單**還沒出現**(兩段式),所以送出它不會清掉任何已填的值。 */}
      {phoneQuery !== '' && candidates.length === 0 && !lookupFailed && (
        <form
          action={createManualCustomerAction}
          className='space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3'
          data-testid='manual-order-new-customer'
        >
          <p role='status' className='text-sm text-amber-700'>
            這支電話找不到客人。<strong>直接在這裡建一位</strong>,建好就會自動選好他、可以往下建單。
          </p>
          {/* 冪等鍵照原樣帶著走 —— 建客人這一步不該換掉建單那顆鍵。 */}
          <input type='hidden' name={MANUAL_ORDER_REQUEST_ID_FIELD} value={manualRequestId} />
          {inPanel && (
            <input type='hidden' name={MANUAL_ORDER_IN_PANEL_FIELD} value={MANUAL_ORDER_IN_PANEL_VALUE} />
          )}
          <div className='grid grid-cols-2 gap-2'>
            <label className='block text-sm'>
              客人姓名
              <input
                name={MANUAL_CUSTOMER_NEW_NAME_FIELD}
                required
                className='mt-1 block w-full rounded-md border px-2 py-1'
              />
            </label>
            <label className='block text-sm'>
              電話
              {/* 🔴 預填他剛剛搜的那支 —— 叫他把同一支電話再打一次,正是這一片要拿掉的動作。 */}
              <input
                name={MANUAL_CUSTOMER_NEW_PHONE_FIELD}
                defaultValue={phoneQuery}
                required
                className='mt-1 block w-full rounded-md border px-2 py-1'
              />
            </label>
          </div>
          <button type='submit' className='rounded-md border px-3 py-1 text-sm'>
            建立這位客人
          </button>
          {/* ⚠️ 地址**不在這裡** —— 客人檔案沒有地址欄(`ManualCustomerInput` 只有 name/phone),
              地址住在訂單上的「收件資料」那一區。這裡多開一格會建出沒有人會讀的值。 */}
          <p className='text-muted-foreground text-xs'>
            地址等一下在下面的「收件資料」填就好,這裡不用。
          </p>
        </form>
      )}

      {selectedCustomer === null && candidates.length > 0 && (
        <ul className='space-y-1' data-testid='manual-order-candidates'>
          {candidates.map((c) => (
            <li key={c.userId}>
              <a
                className='underline'
                // 🔴 **`phone` 一定要帶**(codex R2 新發現 must-fix):
                //    頁面是靠「這次查回來的候選」去核 `customer` 的,少了 `phone`
                //    ⇒ 重載後候選是空的 ⇒ `customer` 被判無效 ⇒ **點誰都選不上**。
                //    ⚠️ 我的測試原本只斷言 href 含 `mrid` 與 `customer` ⇒ 這一格是我的盲區。
                //    ✅ 2026-08-28:改用 `manualOrderCustomerHref` —— 剛建好客人之後的導頁用的是同一支,
                //       兩邊各拼一次的話,漏掉 `phone` 的那一份會靜默失效。
                href={manualOrderCustomerHref({
                  manualRequestId,
                  phone: phoneQuery,
                  customerId: c.userId,
                  inPanel,
                })}
              >
                {c.name}({c.phone ?? '沒有電話'}){c.isManual ? ' · 後台開的帳號' : ''}
              </a>
            </li>
          ))}
        </ul>
      )}

      {selectedCustomer === null ? (
        <p className='text-muted-foreground text-sm' data-testid='manual-order-pick-first'>
          先選一位客人,才會出現建單表單。
        </p>
      ) : (
      <form action={createManualOrderAction} className='space-y-4'>
        {/* 🔴 冪等鍵。**同一張表單重按送出要送同一顆** —— 它由頁面決定、表單只是帶著走。 */}
        <input type='hidden' name={MANUAL_ORDER_REQUEST_ID_FIELD} value={manualRequestId} />
        {inPanel && (
          <input type='hidden' name={MANUAL_ORDER_IN_PANEL_FIELD} value={MANUAL_ORDER_IN_PANEL_VALUE} />
        )}

        <fieldset disabled={noStaff} className='space-y-4'>
          {/* 🔴 客人是**已經選定**的,不是表單上的一個下拉:兩段式之後這一格只剩「帶著走」。
              值仍然逐字送出去(RPC 的 G3 會再驗一次這位客人存不存在)。 */}
          <input type='hidden' name={MANUAL_ORDER_CUSTOMER_FIELD} value={selectedCustomer!.userId} />
          <p className='text-sm'>
            客人:{selectedCustomer!.name}({selectedCustomer!.phone ?? '沒有電話'})
            <a className='ml-2 underline' href={`${base}${baseSep}mrid=${manualRequestId}`}>
              換一位
            </a>
          </p>

          {/* 🔴 **這裡刻意【沒有】經手人下拉**(codex R1 must-fix)。
              原本擺了一個 disabled 的下拉顯示 `activeStaff[0]` —— 而真正寫進稽核的 actor
              來自授權閘的 cookie 身分。**登入的是 Bob 而排序第一位是 Alice 時,
              畫面說 Alice、帳上寫 Bob** ⇒ 一個會說謊的欄位比沒有欄位糟。
              ⇒ 要顯示經手人的話,值必須來自 `getSessionActor()` 那一個來源;那是另一片。 */}

          <div className='grid grid-cols-2 gap-3'>
            <label className='block text-sm'>
              訂單來源
              <select name={MANUAL_ORDER_SOURCE_FIELD} className='mt-1 block w-full rounded-md border px-2 py-1'>
                <option value='manual_phone'>電話</option>
                <option value='manual_line'>LINE</option>
                <option value='manual_other'>其他</option>
              </select>
            </label>
            <label className='block text-sm'>
              付款方式
              <select
                name={MANUAL_ORDER_PAYMENT_CHANNEL_FIELD}
                className='mt-1 block w-full rounded-md border px-2 py-1'
              >
                <option value='bank_transfer'>匯款</option>
                <option value='cash'>現金</option>
              </select>
            </label>
            <label className='block text-sm'>
              取貨方式
              <select
                name={MANUAL_ORDER_SHIPPING_METHOD_FIELD}
                className='mt-1 block w-full rounded-md border px-2 py-1'
              >
                <option value='home'>宅配</option>
                <option value='store'>門市自取</option>
              </select>
            </label>
            <label className='block text-sm'>
              運費
              <input
                name={MANUAL_ORDER_SHIPPING_FEE_FIELD}
                inputMode='numeric'
                defaultValue='0'
                className='mt-1 block w-full rounded-md border px-2 py-1'
              />
            </label>
          </div>

          <fieldset className='space-y-2 rounded-md border p-3'>
            <legend className='px-1 text-sm'>收件資料</legend>
            <input
              name={MANUAL_ORDER_SHIP_TO_NAME_FIELD}
              placeholder='收件人'
              required
              className='block w-full rounded-md border px-2 py-1'
            />
            <input
              name={MANUAL_ORDER_SHIP_TO_PHONE_FIELD}
              placeholder='電話'
              required
              className='block w-full rounded-md border px-2 py-1'
            />
            <input
              name={MANUAL_ORDER_SHIP_TO_LINE_FIELD}
              placeholder='地址'
              required
              className='block w-full rounded-md border px-2 py-1'
            />
          </fieldset>

          <fieldset className='space-y-2 rounded-md border p-3'>
            <legend className='px-1 text-sm'>發票</legend>
            <select
              name={MANUAL_ORDER_INVOICE_TYPE_FIELD}
              className='block w-full rounded-md border px-2 py-1'
            >
              <option value='personal'>個人</option>
              <option value='company'>公司</option>
              <option value='donate'>捐贈</option>
            </select>
            <input name={MANUAL_ORDER_INVOICE_CARRIER_FIELD} placeholder='載具(選填)' className='block w-full rounded-md border px-2 py-1' />
            <input name={MANUAL_ORDER_INVOICE_TITLE_FIELD} placeholder='抬頭(公司才填)' className='block w-full rounded-md border px-2 py-1' />
            <input name={MANUAL_ORDER_INVOICE_TAX_ID_FIELD} placeholder='統編(公司才填)' className='block w-full rounded-md border px-2 py-1' />
            <input name={MANUAL_ORDER_INVOICE_DONATE_CODE_FIELD} placeholder='愛心碼(捐贈才填)' className='block w-full rounded-md border px-2 py-1' />
          </fieldset>

          {/* 🔴 品項在收件與發票**之後** —— 員工的動線是「先確認是誰、寄到哪」再逐項打單。
              ⚠️ 這一格沒有稿可以對(OD 那份是訂單【明細】不是【建單】)⇒ 這是我的判斷,不是照稿。 */}
          <ManualOrderLines />

          <button type='submit' className='rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground'>
            建立訂單
          </button>
        </fieldset>
      </form>
      )}
    </div>
  );
}
