'use client';

import { useState } from 'react';
import { invoiceCheatSheet, type AdminOrderDetail } from '@pcm/domain';
import { updateOrderWorkflowAction } from '../../lib/orders/order-actions';
import {
  INVOICE_AMOUNT_FIELD,
  INVOICE_NUMBER_FIELD,
  INVOICE_STATUS_FIELD,
  ORDER_ID_FIELD,
  VERSION_FIELD,
} from '../../lib/orders/workflow-form';
import {
  MANUAL_ORDER_INVOICE_TAX_ID_FIELD,
  MANUAL_ORDER_INVOICE_TITLE_FIELD,
} from '../../lib/orders/manual-order-form';
import { INVOICE_STATUS_LABEL } from '../../lib/orders/order-list-view';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import { InvoiceTitleLookupButton } from './invoice-title-lookup-button';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';
import { formatOrderAmount } from '../../lib/orders/order-list-view';

// invoice-cheatsheet-panel.tsx — 發票小抄的**彈窗本體**(稿 `orders-admin-v20-A-發票小抄.html`)。
//
// 🎯 **Sean 2026-09-13 逐字判準**:「**單純方便我開發票時候抄寫用**」
// ⇒ 📌 **這不是資料輸入表單, 是抄寫小抄。** 他手上拿著一張**紙本發票**要用手寫。
// ⇒ 🔴 **主角是「要被抄下來的東西」**(抬頭 / 統編 / 三個數);
//    輸入框(號碼 / 金額)是**事後登記、次要** ⇒ **版面比重照這個分, 字級差一階就是主次。**
//
// ── 🛑 這一片【只有彈窗本體, 沒有入口】(主視窗 2026-09-13 裁)──────────────
//   訂單容器改版(右側面板退場、功能進彈窗)還沒定案 ⇒ **「怎麼走到這裡」可能整個變**,
//   而**這個彈窗的內容與版面是資產**。⇒ 入口與列表那顆 tag 可點, 都不在本片。
//   ⇒ 呼叫端自己決定把它放進什麼容器(`<dialog>` / 面板 / 分頁), 本檔不假設。
//
// ── 🔴 字級為什麼每一格都帶 `leading-[1.4]`(2026-09-13 真瀏覽器量出來的)────────
//   `globals.css` 稿 FIX-27(`:2006-2010`)把 `text-xs` / `text-[13px]` 拉到 14px、`text-sm` / `text-[15px]`
//   拉到 16px —— **除非元素帶 `leading-*`**。v20 稿的 13 / 12.5 / 15 要照抄就得帶 leading(稿 body 1.4)。
//   ⚠️ 少一個 leading, 那一格就靜靜變大一號, 而 typecheck / 測試都不會叫;量出來才知道。
//
// ── 🔴 三個數:讀純函式, 畫面上一行算式都沒有 ─────────────────────────────
//   `packages/domain/src/order/invoice-cheatsheet.ts`。**不在這裡再算一份** ——
//   小抄印的數與系統存的數不一樣 ⇒ 他抄在紙上的就跟帳不符, **而那是實物、收不回來**。
//   🔵 `null` = 算不出來 ⇒ **整塊不印**(讀不到稅口徑 / 這張單不開發票 / 資料矛盾)。
//      那支函式的檔頭寫了每一種 null 的成因與**為什麼不挑預設值**。
//
// ── 🎯 兩本帳:標題逐字是「發票上要寫的」, 不是「小計 / 稅 / 總計」──────────
//   Sean 逐字:「並不應該要去連動到我們系統紀錄的訂單金額, 因為我在算營業額的時候
//   我不會把含稅發票的稅金算進去」⇒ **訂單金額(營業額)與發票金額本來就不相等。**
//   ⇒ 📌 標籤若寫「小計」, 員工會把它讀成訂單金額 —— 而那兩個數**本來就該不一樣**。
//
// ── 🔴 二聯 / 三聯 = 「我這次要開哪一種」, 不是「這張單含不含稅」──────────
//   Sean 2026-09-13 答 Q1 甲:標籤寫「二聯(含稅一個數)」/「三聯(未稅 + 稅 + 總計)」,
//   **不寫「含稅 / 未稅」** —— 後者與 `orders.price_tax_mode` **同名不同事**,
//   而那個同名今天已經害我們走錯一整輪。
//   🔵 **預設三聯**(Sean 答 Q2 甲:三個數都看得到、二聯要的總計也在裡面 ⇒ 不會漏抄)。
//   🛑 **切了不記住** —— 那是抄寫當下的偏好, 不是這張單的屬性。存起來就往「影響訂單」
//      那個方向走了一步, 而那是他明文否決的。⇒ 用 `useState`, **零寫入、零 localStorage**。
//
// ── 🔴 抬頭 / 統編【可改】+ 查抬頭鈕(接線片, RPC 第 3 代 `20260913060000`)───────────
//   Q3 甲(主視窗裁, 設計窗出實體):**整個上塊包進 `<form>`**, 三個數仍是 `<dl>` 不會被送。
//   ⇒ 抬頭 / 統編兩格與登記三格**同一張 form、同一個 version、同一列 audit**。
//   🔴 兩格的 `name` = `MANUAL_ORDER_INVOICE_*_FIELD` 那組:查抬頭鈕靠
//      `host.closest('form').elements.namedItem(那兩個 name)` 找輸入框, 換名字它就找不到。
//   🔴 半填 / 8 碼 / 全形空白 / donate / type 推導 —— **全部在 RPC**, 畫面不再驗一次(第二份實作)。
//   🔵 查抬頭是 **fail-open**:查不到「請自己打」, 而他自己打的照樣存得進去 ——
//      那一格的驗收是「把來源指到一定失敗的網址, 他照樣登記得出去」, 在測試裡先紅過。
//
// ⚠️ **「登記」那三格走既有的 `updateOrderWorkflowAction`, 而它接受【部分表單】** ——
//    `workflow-form.ts:181` 逐字:「patch 欄**未提供(表單無此欄)**= 不放進 patch(RPC 不動該欄)」
//    ⇒ 這裡沒有 `shipping_method`, 那一欄不會被碰。**不是漏掉, 是刻意。**

/** 二聯 / 三聯 —— 只影響**呈現**, 不影響那三個數本身。 */
type Lianshi = 2 | 3;

export function InvoiceCheatSheetPanel({
  detail,
  returnTo,
}: {
  detail: AdminOrderDetail;
  /** 動作做完回哪裡。值不可信任(client 送得回來)⇒ action 端一律再過 `parseOrderReturnTo`。 */
  returnTo: string;
}) {
  // 🔵 每次掛載都回到三聯 —— 「切了不記住」在結構上成立, 不需要另外清。
  const [lianshi, setLianshi] = useState<Lianshi>(3);

  // 🔴 這張單不開發票 ⇒ 整個彈窗換成既有那一句, 三個數與登記欄**都不出現**。
  //    字面照 `order-edit-form.tsx:153` 原樣, 不寫第二種說法。
  if (!detail.invoiceRequested) {
    return (
      <p className='text-muted-foreground text-sm'>
        此單不開發票(建單時的決定)。要開請作廢重開。
      </p>
    );
  }

  const sheet = invoiceCheatSheet({
    priceTaxMode: detail.priceTaxMode,
    total: detail.total.amount,
    taxTotal: detail.taxTotal.amount,
    invoiceRequested: detail.invoiceRequested,
  });

  const invoice = detail.invoiceRequest;

  return (
    /* 🔴🔴 **`key={detail.version}`(codex 2026-09-13 must-fix)—— 草稿與版本必須是同一份快照。**
       沒有它:同一個元件收到新版 `detail`(別人先改了)⇒ hidden `version` 跟著更新,
       **而各格 `defaultValue` 不會**(React 只在掛載時讀它)⇒ 送出的是**新版本號 + 舊草稿**
       ⇒ 解析器接受、RPC 的樂觀鎖比對通過 ⇒ **別人剛存的被靜默蓋掉**。
       codex 用 rerender + FormData 實測:version 7 打草稿 → 收到 version 8 → 送出 = 8 + 舊草稿。
       ⇒ 綁 version 當 key:版本一變整張表單重建。代價是員工打到一半的字會不見 ——
          而那**比「靜默蓋掉別人剛存的」便宜**:前者他看得到, 後者沒有人看得到。
       🔵 Q3 甲:整張 form 包住上塊 + 下塊 —— 抬頭 / 統編要能改就要在 form 裡, 而三個數是 <dl> 不會被送。 */
    <form key={detail.version} action={updateOrderWorkflowAction} className='grid gap-0'>
      {/* ══ 上塊:要抄的(大字;抬頭 / 統編可改, 三個數唯讀)═══════════════ */}
      {/* 🔬 v20 稿真值(`scripts/tool-final-css.py` 抽 `orders-admin-v20-A-發票小抄.html`, 2026-09-13):
          .cheat   border 1px var(--line) · bg card · padding 12px 14px 14px
          .cheatHd flex space-between gap 12px · mb 10px · .cheatT 13px/600
          🔵 稿的 `--line #e7ecf2` 本站是 `--border #e3e9f0`(比對表 `:81` 記過:接近但不同, 全站一致的差, 不在這片改)。 */}
      <section className='border-border bg-card border px-[14px] pt-3 pb-[14px]' aria-labelledby='cheatsheet-heading'>
        <div className='mb-[10px] flex flex-wrap items-center justify-between gap-3'>
          {/* 🔴 逐字「發票上要寫的」—— 見檔頭「兩本帳」那段, 不可以改成「小計 / 稅 / 總計」。 */}
          <h3 id='cheatsheet-heading' className='text-foreground text-[13px] leading-[1.4] font-semibold'>
            發票上要寫的
          </h3>
          {/* 🔵 `role='group'` 而不是 radio:它切的是**看什麼**, 不是送出什麼(零寫入)。 */}
          {/* 🔬 .lianx flex gap 0 · .lian border · padding 4px 10px · 12.5px · lh 1.15 · .on bg var(--fg) 白字
              · small 10.5px。稿是兩顆貼在一起的分段鈕(gap 0), 不是兩顆分開的鈕。 */}
          <div role='group' aria-label='聯式' className='flex gap-0'>
            {([2, 3] as const).map((n) => (
              <button
                key={n}
                type='button'
                aria-pressed={lianshi === n}
                onClick={() => setLianshi(n)}
                className={`border-border flex items-start gap-px border px-[10px] py-1 text-[12.5px] leading-[1.15] ${
                  n === 2 ? 'rounded-l-md' : 'rounded-r-md border-l-0'
                } ${lianshi === n ? 'bg-foreground text-white' : 'bg-card text-(--fg-2)'}`}
              >
                {n === 2 ? '二聯' : '三聯'}
                {/* 🔵 括號那段說明字**印在畫面上**(Sean 拍板)—— 員工不必記哪一種要寫幾個數。 */}
                <small className={`ml-1 text-[10.5px] font-normal ${lianshi === n ? 'text-white/80' : 'text-muted-foreground'}`}>
                  {n === 2 ? '含稅一個數' : '未稅 + 稅 + 總計'}
                </small>
              </button>
            ))}
          </div>
        </div>

        {/* 🔴 抬頭 / 統編可改(接線片)。name 照規格 §2 用既有那組 —— 見檔頭。 */}
        {/* 🔬 .cheatTi grid `1fr auto` gap 8px 14px · label 11.5px muted flex-col gap 3px · input 15px padding 4px 7px。
            🔴 統編那一格是 `auto` 寬 + 鈕 `shrink-0 whitespace-nowrap`:Sean 在 3025 看到「查抬頭」被擠成一字一行,
               成因是兩欄各佔一半、統編格又塞了鈕 ⇒ 容器窄到鈕折行。稿的解法就是 `1fr auto`。 */}
        <div className='mb-[10px] grid gap-x-[14px] gap-y-2 sm:grid-cols-[1fr_auto]'>
          <AdminFormField label='抬頭'>
            <input
              type='text'
              name={MANUAL_ORDER_INVOICE_TITLE_FIELD}
              defaultValue={invoice.title ?? ''}
              maxLength={100}
              placeholder={invoice.type === 'company' ? '' : '個人 — 抬頭免填'}
              className={`${ADMIN_INPUT_CLASS} text-[15px] leading-[1.4]`}
            />
          </AdminFormField>
          <AdminFormField label='統編'>
            <span className='flex items-center gap-2'>
              <input
                type='text'
                inputMode='numeric'
                name={MANUAL_ORDER_INVOICE_TAX_ID_FIELD}
                defaultValue={invoice.taxId ?? ''}
                maxLength={8}
                placeholder='公司才填'
                className={`${ADMIN_INPUT_CLASS} w-[108px] font-mono text-[15px] leading-[1.4]`}
              />
              {/* 🔵 搬既有元件, 一個字沒改(規格逐字「不新做」)。它在 form 內才找得到輸入框。 */}
              <InvoiceTitleLookupButton />
            </span>
          </AdminFormField>
        </div>

        {sheet === null ? (
          /* 🔴🔴 **算不出來就不印, 而且要說得出是哪一種** —— 一個看起來正常的錯數字
             會被抄到紙上;一句「算不出來」他會停下來問。 */
          <p role='alert' className='text-destructive text-sm'>
            ⚠️ 算不出這張單的發票金額。請先重新整理一次;還是一樣就通知系統維護,並告訴他單號{' '}
            {detail.displayId}。在那之前不要照這個畫面開發票。
          </p>
        ) : (
          /* 🔬 .nums border-top · .nrow flex baseline space-between gap 20px padding 3px 0
             · dt 13px fg2 · dd 18px fg · .big border-top mt 5px · big dt 600 · big dd 26px/700 tracking -.01em
             📌 字級 13 → 18 → 26:「三階」就是這裡。總計最重, 二聯時它是唯一要抄的數。 */
          <dl className='border-border m-0 grid border-t'>
            {/* 🔴 二聯只印一個含稅總額 —— 台灣紙本實務, 不是版面偏好。 */}
            {lianshi === 3 && (
              <>
                <div className='flex items-baseline justify-between gap-5 py-[3px]'>
                  <dt className='text-[13px] leading-[1.4] text-(--fg-2)'>銷售額(未稅)</dt>
                  <dd className='text-foreground m-0 font-mono text-[18px] tabular-nums'>
                    {formatOrderAmount(sheet.untaxed)}
                  </dd>
                </div>
                <div className='flex items-baseline justify-between gap-5 py-[3px]'>
                  <dt className='text-[13px] leading-[1.4] text-(--fg-2)'>營業稅</dt>
                  <dd className='text-foreground m-0 font-mono text-[18px] tabular-nums'>{formatOrderAmount(sheet.tax)}</dd>
                </div>
              </>
            )}
            {/* 🔴 總計**恆在**(兩種聯式都要寫), 而且是**最重的那一個**:
                二聯時它是唯一要抄的數。字級比上面兩行大一階 = 稿上的 `.nrow.big`。 */}
            <div className='border-border mt-[5px] flex items-baseline justify-between gap-5 border-t py-[3px]'>
              <dt className='text-foreground text-[13px] leading-[1.4] font-semibold'>總計</dt>
              <dd className='text-foreground m-0 font-mono text-[26px] font-bold tracking-[-0.01em] tabular-nums'>
                {formatOrderAmount(sheet.total)}
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* ══ 下塊:登記(次要、一般字級)—— 與上塊同一張 form(key / action 在最外層)══ */}
      {/* 🔬 .reg mt 14px · .regT 12.5px fg2 mb 7px · .f grid 1fr 1fr gap 6px 8px · label 12px fg2 · input/select min-h 28px radius 6px。
          稿的下塊沒有邊框(它是同一個 dialog body 裡的第二段), 不是第二張卡。 */}
      <div className='mt-[14px]'>
        {/* 🔴 逐字七個字。🛑 不准補「發票在系統外開立」那類 ——
            Sean 退過一版, 而原句出錯的方式正是**多講一件不必要講的事**。
            🛑 也不准把它講成「在某個機關 / 某個系統 / 某個平台上開」:發票是**紙本手寫**的。
            (那三個詞由 `invoice-cheatsheet-panel.test.tsx` 掃原始碼擋, 連註解一起 ——
             所以這裡刻意不把它們寫出來。) */}
        <h3 className='mb-[7px] text-[12.5px] leading-[1.4] font-normal text-(--fg-2)'>登記發票號碼與金額</h3>

        <input type='hidden' name={ORDER_ID_FIELD} value={detail.id} />
        {/* 🔴 樂觀鎖:別人先改過 ⇒ RPC 擋下, 不會靜默覆寫。 */}
        <input type='hidden' name={VERSION_FIELD} value={detail.version} />
        <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />

        <div className='grid gap-x-2 gap-y-[6px] sm:grid-cols-3'>
          <AdminFormField label='開立狀態'>
            {/* 🔵 選項由 `INVOICE_STATUS_LABEL` 產, 不在這裡再寫一次三態中文
                (同 `order-edit-form.tsx` 那一格的理由:硬寫的字面會自由漂開而不紅)。 */}
            <select
              name={INVOICE_STATUS_FIELD}
              defaultValue={detail.invoiceStatus}
              className={ADMIN_INPUT_CLASS}
            >
              {Object.entries(INVOICE_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </AdminFormField>

          <AdminFormField label='發票號碼'>
            <input
              type='text'
              name={INVOICE_NUMBER_FIELD}
              defaultValue={detail.invoiceNumber ?? ''}
              maxLength={64}
              placeholder='不填就會清空'
              className={`${ADMIN_INPUT_CLASS} font-mono`}
            />
          </AdminFormField>

          <AdminFormField label='發票金額(元)'>
            {/* 🛑 **不預填小抄算出來的數** —— 那三個數是「該寫多少」, 這一格是「實際開了多少」。
                預填會讓「他照抄」與「系統替他填」在事後分不出來, 而這一欄是對帳用的。
                ⇒ 預設值照既有那一格:已登記過的原值, 沒有就空著。 */}
            <input
              type='text'
              inputMode='numeric'
              name={INVOICE_AMOUNT_FIELD}
              defaultValue={detail.invoiceAmount ? String(detail.invoiceAmount.amount) : ''}
              placeholder='不填就會清空'
              className={`${ADMIN_INPUT_CLASS} font-mono`}
            />
          </AdminFormField>
        </div>

        {/* 🔬 .ft flex gap 8px justify-end · .btn min-h 30px padding 0 12px radius 8px · .btn-p bg primary 白字。
            稿的「取消」也在這一排(左邊), 而那顆屬於殼(NextStepDialog);殼的樣式施工窗正在對稿, 這裡不重做。 */}
        <div className='mt-[14px] flex justify-end gap-2'>
          <button
            type='submit'
            className='bg-primary text-primary-foreground inline-flex min-h-[30px] items-center rounded-lg px-3 text-sm leading-[1.4]'
          >
            確認
          </button>
        </div>
      </div>
    </form>
  );
}
