import {
  MANUAL_ORDER_IN_PANEL_FIELD,
  MANUAL_ORDER_IN_PANEL_VALUE,
  MANUAL_ORDER_INVOICE_CARRIER_FIELD,
  MANUAL_ORDER_INVOICE_DONATE_CODE_FIELD,
  MANUAL_ORDER_INVOICE_TAX_ID_FIELD,
  MANUAL_ORDER_INVOICE_TITLE_FIELD,
  MANUAL_ORDER_INVOICE_REQUESTED_FIELD,
  MANUAL_ORDER_INVOICE_TYPE_FIELD,
  MANUAL_ORDER_PAYMENT_CHANNEL_FIELD,
  MANUAL_ORDER_REQUEST_ID_FIELD,
  MANUAL_ORDER_SHIPPING_FEE_FIELD,
  MANUAL_ORDER_SHIPPING_METHOD_FIELD,
  MANUAL_ORDER_SOURCE_FIELD,
} from '@/lib/orders/manual-order-form';
import { ManualCustomerPicker } from './manual-customer-picker';
import { MANUAL_ORDER_FORM_ID, ManualOrderLeaveGuard } from './manual-order-leave-guard';
import { ManualOrderSubmit } from './manual-order-submit';
import { createManualOrderAction } from '@/lib/orders/manual-order-actions';
import { ManualOrderCatalogLookup } from './manual-order-catalog-lookup';
import { ManualOrderLines } from './manual-order-lines';
// 🔴 三個 `MANUAL_ORDER_SHIP_TO_*` 常數 2026-08-28 從本檔的 import 移除 ——
//    它們現在由 `./manual-order-ship-to` 自己 import。**欄名一個字都沒改**,只是換了誰在用。
import { ManualOrderShipTo } from './manual-order-ship-to';

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
// ⛔ ~~🔴🔴 **兩段式,而那是 codex R1 must-fix 逼出來的形狀**:選到客人之前不出建單表單。~~
// 🔴🔴 **2026-08-28:兩段式已經沒有了,而這一段在它消失之後還留在這裡三輪**(codex R6 nit)。
//    它當初的存在理由:搜尋是 GET 導頁 ⇒ 整份表單重建 ⇒ 運費無聲回到 0 ⇒ 員工少收 150。
//    ⇒ 現在搜尋**不導頁**(事件處理器 + client action)⇒ **那個時間窗本身不存在**
//      ⇒ 兩段式不是被拆掉的,是**成因被拿掉之後它沒有存在理由**。
//    📌 而這段舊描述沒有害到功能,它害的是**下一個讀這支檔的人** ——
//       檔頭說「現在是兩段式」,而下面二十行的碼說不是。**兩句都在檔案裡,而只有一句是真的。**

/** 這一頁的表單值。**沒有 actor 這一格,而那是承重的**(見 `manual-order-actions.ts`)。 */
export type ManualOrderFormBodyProps = {
  /** 這一次的冪等鍵。🔴 **由頁面決定**:失敗導回時沿用 URL 帶回來的那顆,否則鑄新的。 */
  manualRequestId: string;
  /** 啟用中的員工。**空陣列 = 整張表單停用**。 */
  activeStaff: ReadonlyArray<{ id: string; label: string }>;
  /**
   * 建客人那一步的冪等鍵(合法 uuid,server 每次 render 給一顆)。
   * 🔴 **與建單那顆 `manualRequestId` 是【兩顆不同的鍵】**,而那是刻意的:
   *    `mrid` 是「這張**訂單**」的鍵,舊形狀把它同時拿來當「這位**客人**」的唯一鍵
   *    —— 而那是因為它要跨一次導頁。導頁沒了,那顆鍵就不必跨任何東西
   *    (R3 2026-08-28 指出的根)。
   */
  customerRequestId: string;
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
  customerRequestId,
  staffLoadFailed,
  inPanel = false,
}: ManualOrderFormBodyProps) {
  const noStaff = activeStaff.length === 0;
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

      {/* 🔴🔴 **2026-08-28:客人那一塊整個換成【就地】的**(Sean 逐字「一個頁面搞定」)。
          ~~舊形狀:GET 導頁搜尋 + 兩段式(選到客人之前不出建單表單)+ 獨立一張 POST 表單建客人~~
          🔴 **兩段式不是被拆掉的,是【成因被拿掉之後它沒有存在理由】** ——
             它當初是為了擋「搜尋導頁會把已填的運費與地址清光」(codex R1 must-fix)。
             搜尋不再導頁 ⇒ 那個時間窗不存在 ⇒ 兩段式自然消失。
          ⇒ 細節與不變式在 `manual-customer-picker.tsx` 檔頭。 */}
      {/* 🔴 `id` 只給 ManualOrderLeaveGuard 找得到這張表單用(Q32 甲)。
          🛑 而那支 guard **不持有任何值** —— 它當場問 DOM「有沒有被動過」, 不留副本。
          理由:`manual-order-lines.tsx:17-20` 的不變式禁止 client state 回寫送出值,
          而 Sean 2026-09-03 看過代價後選了不拆(`等Sean拍的題-20260903.md:1841`)。 */}
      <form id={MANUAL_ORDER_FORM_ID} action={createManualOrderAction} className='space-y-4'>
        <ManualOrderLeaveGuard formId={MANUAL_ORDER_FORM_ID} />
        {/* 🔴 冪等鍵。**同一張表單重按送出要送同一顆** —— 它由頁面決定、表單只是帶著走。 */}
        <input type='hidden' name={MANUAL_ORDER_REQUEST_ID_FIELD} value={manualRequestId} />
        {inPanel && (
          <input type='hidden' name={MANUAL_ORDER_IN_PANEL_FIELD} value={MANUAL_ORDER_IN_PANEL_VALUE} />
        )}

        <fieldset disabled={noStaff} className='space-y-4'>
          {/* 🔴 客人那一格 = 一顆 radio ——**員工看到的那個 DOM 節點就是送出去的值**。
              值仍然逐字送出去(RPC 的 G3 會再驗一次這位客人存不存在)。

              🔴🔴 **它必須長在這個 `disabled` fieldset 【裡面】**(codex R4 must-fix):
              放在外面的話,「沒有員工 ⇒ 整張表單停用」這個契約只擋住了下半張 ——
              **員工名單掛掉的那一刻,這一塊仍然可以搜尋客人、而且可以【建出一個真的 auth 帳號】。**
              📌 那個停用態在畫面上看起來完全正確:整張表灰掉、一句話指路;
                 而它上面那一塊照常運作,**沒有任何訊號說「這裡不算在停用範圍內」**。 */}
          <ManualCustomerPicker customerRequestId={customerRequestId} />

          {/* 🔴 **這裡刻意【沒有】經手人下拉**(codex R1 must-fix)。
              原本擺了一個 disabled 的下拉顯示 `activeStaff[0]` —— 而真正寫進稽核的 actor
              來自授權閘的 cookie 身分。**登入的是 Bob 而排序第一位是 Alice 時,
              畫面說 Alice、帳上寫 Bob** ⇒ 一個會說謊的欄位比沒有欄位糟。
              ⇒ 要顯示經手人的話,值必須來自 `getSessionActor()` 那一個來源;那是另一片。 */}

          <div className='grid grid-cols-2 gap-3'>
            <label className='block text-sm'>
              訂單來源
              <select
                autoComplete='off'
                name={MANUAL_ORDER_SOURCE_FIELD} className='mt-1 block w-full rounded-md border px-2 py-1'>
                <option value='manual_phone'>電話</option>
                <option value='manual_line'>LINE</option>
                <option value='manual_other'>其他</option>
              </select>
            </label>
            <label className='block text-sm'>
              付款方式
              <select
                autoComplete='off'
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
                autoComplete='off'
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
                autoComplete='off'
                name={MANUAL_ORDER_SHIPPING_FEE_FIELD}
                inputMode='numeric'
                defaultValue='0'
                className='mt-1 block w-full rounded-md border px-2 py-1'
              />
            </label>
          </div>

          {/* 🔴 收件那三格 2026-08-28 搬進 `./manual-order-ship-to`(client 子元件)——
              成因是那顆「同上」要 state,而**本檔是 server component**(檔頭那段)。
              ⇒ 形狀比照 `./manual-order-lines`,**不把本檔改成 client**。
              ⚠️ 三個 `name=` 一個字都沒改(`ship_to_name` / `ship_to_phone` / `ship_to_line`)
                 ⇒ `parseManualOrderForm()` 與 RPC 那一側**零改動**。 */}
          <ManualOrderShipTo />

          <fieldset className='space-y-2 rounded-md border p-3'>
            <legend className='px-1 text-sm'>發票</legend>
            {/* 🔴🔴 **這顆勾選與下面那五格是【兩件事】**(2026-09-04 `⟦b4-INVOICE5PCT⟧` 第 2 步;
                Sean 第十八題拍甲):下面五格講「**開的話抬頭寫誰**」, 這一顆講「**開不開**」。

                🔴 **前面那個 hidden 不是多餘的** —— HTML 的 checkbox **沒勾時整個欄位不會出現**
                ⇒ 解析端讀到的空白, 與「**這個表單版本根本沒有這一格**」是同一個東西。
                ⇒ 📌 而那兩個世界的正確結果**相反**(一個是「他決定不開」, 一個是「我不知道」)。
                ⇒ ✅ 同名 hidden 讓那個欄位**永遠存在** ⇒ 三個世界真的分得開。
                ⚠️ **順序不可調**:hidden 要在 checkbox **前面** —— 解析端取的是**最後一個值**。

                🔴🔴 **`defaultChecked`(預設打勾)這件事【沒有被 Sean 拍過】**(codex R3 must-fix)。
                他的逐字只涵蓋**顧客站**:「要不要開發票在網站(顧客站)都是要預設開發票」
                —— 逐字與存證見 `supabase/migrations/20260828100000_...:210-224`,
                而**那一段同時記著:2026-08-29 曾有人把「他說現在其實都有開」宣告成拍板, 而他沒說過。**
                ⇒ 🛑 **所以這裡不編一個拍板出來。**

                ✅ **這裡選 `defaultChecked` 的理由只有一個, 而它不是業務判斷:**
                   `orders.invoice_requested` 今天的 DEFAULT 就是 `true`
                   ⇒ 打勾 = **與今天完全一致** ⇒ 這一片**不改變任何既有行為**。
                ⚠️ **而代價要寫出來, 因為它會影響錢**:「員工沒注意到這一格」與
                   「員工看了、決定要開」在資料上是**同一個 `true`** ——
                   而 +5% 那一片會讀這個欄位 ⇒ 📌 **這是一題要端給 Sean 的決策題**
                   (甲:維持預設打勾 / 乙:改成必選、不給預設), **本片不代他決定。** */}
            <label className='flex items-center gap-2 text-sm'>
              <input type='hidden' name={MANUAL_ORDER_INVOICE_REQUESTED_FIELD} value='off' />
              <input
                type='checkbox'
                autoComplete='off'
                defaultChecked
                name={MANUAL_ORDER_INVOICE_REQUESTED_FIELD}
              />
              <span>這張單要開發票</span>
            </label>
            <select
              autoComplete='off'
              name={MANUAL_ORDER_INVOICE_TYPE_FIELD}
              className='block w-full rounded-md border px-2 py-1'
            >
              <option value='personal'>個人</option>
              <option value='company'>公司</option>
              <option value='donate'>捐贈</option>
            </select>
            <input
            autoComplete='off'
            name={MANUAL_ORDER_INVOICE_CARRIER_FIELD} placeholder='載具(選填)' className='block w-full rounded-md border px-2 py-1' />
            <input
            autoComplete='off'
            name={MANUAL_ORDER_INVOICE_TITLE_FIELD} placeholder='抬頭(公司才填)' className='block w-full rounded-md border px-2 py-1' />
            <input
            autoComplete='off'
            name={MANUAL_ORDER_INVOICE_TAX_ID_FIELD} placeholder='統編(公司才填)' className='block w-full rounded-md border px-2 py-1' />
            <input
          autoComplete='off'
          name={MANUAL_ORDER_INVOICE_DONATE_CODE_FIELD} placeholder='愛心碼(捐贈才填)' className='block w-full rounded-md border px-2 py-1' />
          </fieldset>

          {/* 🔴 品項在收件與發票**之後** —— 員工的動線是「先確認是誰、寄到哪」再逐項打單。
              ⚠️ 這一格沒有稿可以對(OD 那份是訂單【明細】不是【建單】)⇒ 這是我的判斷,不是照稿。 */}
          {/* 🔴 查商品排在品項列【上面】 —— 員工的動線是「先查到資料, 再往下填」。
              🛑 而它**不會幫他填** —— 那是 Sean 2026-08-31 拍的丙:
                 查到的顯示在旁邊, 他自己抄。理由(那道用一次誤送整單取消換來的不變式)
                 寫在 `manual-order-catalog-lookup.tsx` 檔頭, 不在這裡重複。 */}
          <ManualOrderCatalogLookup />

          <ManualOrderLines />

          {/* 🔴 送出鈕是一支 client component:**沒選客人時它是灰的**。
              理由與「原生 required 只擋得住其中一半」寫在 `manual-order-submit.tsx` 檔頭。 */}
          <ManualOrderSubmit />
        </fieldset>
      </form>
    </div>
  );
}
