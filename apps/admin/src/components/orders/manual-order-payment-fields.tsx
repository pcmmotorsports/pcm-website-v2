import {
  MANUAL_ORDER_LINE_TAX_BASIS_TAXED,
  MANUAL_ORDER_LINE_TAX_BASIS_UNTAXED,
  MANUAL_ORDER_SHIPPING_FEE_FIELD,
  MANUAL_ORDER_SHIPPING_FEE_TAX_BASIS_FIELD,
  MANUAL_ORDER_SHIPPING_METHOD_FIELD,
} from '@/lib/orders/manual-order-form';
import { ManualOrderPaymentMethod, ManualOrderShopeePayout } from './manual-order-payment-method';
import { ManualOrderTierSelect } from './manual-order-tier-select';
import { MANUAL_FIELD_INPUT, MANUAL_FIELD_LABEL, MANUAL_SECTION, MANUAL_SECTION_LEGEND } from './manual-order-field-classes';

// manual-order-payment-fields.tsx — 手動建單「付款與取貨」那一組(2026-10-01 從 manual-order-form-body.tsx 搬出來;
//   Sean 建單簡化 Q1 甲, 計畫 ~/pcm-mailbox/計畫-建單畫面簡化-20261001.md S3)。
//   第一排:會員等級 / 付款方式 / 取貨方式;第二排:運費 / 運費稅別。
// 🔴 只搬位置:每一格的 name 與 defaultValue 與搬家前逐字相同(付款方式 = 匯款、取貨方式 = 宅配、運費 '0'、運費稅別 = 未稅)。
// 🔵 報價單Q1(貼板 262):付款方式加「刷卡」;來源蝦皮 ⇒ 付款方式只剩「蝦皮」並出現蝦皮進帳金額(manual-order-payment-method.tsx)。
//    進帳日期不放(主視窗轉 Sean:撥款日不知道, 進帳時間記建單當下)。
//    本檔目前沒有 state, 不需要 'use client';會員等級那格自己是 client 元件。

const GRID_3 = 'my-[6px] grid grid-cols-3 gap-x-2 gap-y-[6px]';
const GRID_2 = 'my-[6px] grid grid-cols-2 gap-x-2 gap-y-[6px]';

export function ManualOrderPaymentFields() {
  return (
    <fieldset className={MANUAL_SECTION} data-testid='manual-order-payment'>
      <legend className={MANUAL_SECTION_LEGEND}>付款與取貨</legend>
      <div className={GRID_3}>
        {/* 🆕 T2(2026-09-14):會員等級, 預設客人現在的、沒選客人 disabled(island 讀客人 radio 的 data-customer-tier)。 */}
        <ManualOrderTierSelect />
        <ManualOrderPaymentMethod />
        <label className={MANUAL_FIELD_LABEL}>
          取貨方式
          <select autoComplete='off' name={MANUAL_ORDER_SHIPPING_METHOD_FIELD} className={MANUAL_FIELD_INPUT}>
            <option value='home'>宅配</option>
            <option value='store'>門市自取</option>
          </select>
        </label>
      </div>
      <ManualOrderShopeePayout />
      <div className={GRID_2}>
        <label className={MANUAL_FIELD_LABEL}>
          運費
          <input
            autoComplete='off'
            name={MANUAL_ORDER_SHIPPING_FEE_FIELD}
            inputMode='numeric'
            defaultValue='0'
            className={MANUAL_FIELD_INPUT}
          />
        </label>
        {/* ⟦b4-SHIPFEETAXBASIS⟧(2026-09-07):運費也要說是未稅還是含稅。
            🔴 **成因與品項那一格同一個**:`p_shipping_fee` 進 RPC 時沒有人宣告過稅基,
               而 RPC 一律當未稅再加 5% ⇒ 員工填一個含稅的 105, 稅就多算 5 元,
               **而每一筆都長得很正常**。
            🔵 形狀**照抄** `manual-order-lines.tsx:264-277` 那一格(`select` 兩個 option,
               預設 `untaxed`)—— 不自己發明第二種寫法。
            🔴 `autoComplete='off'` 不可省:`select` 也會被瀏覽器 autofill, 而
               `manual-order-form-body.test.tsx` 有一道**分母守門**在數同表單的控制項。
            🛑 **換算不在這裡做** —— 這一格只是宣告, 換算在 `parseManualOrderForm()` 裡
               (同品項那一格的理由:兩邊各算一次, 員工看到的與進 DB 的就有兩個來源)。 */}
        <label className={MANUAL_FIELD_LABEL}>
          運費稅別
          <select
            autoComplete='off'
            name={MANUAL_ORDER_SHIPPING_FEE_TAX_BASIS_FIELD}
            defaultValue={MANUAL_ORDER_LINE_TAX_BASIS_UNTAXED}
            className={MANUAL_FIELD_INPUT}
          >
            <option value={MANUAL_ORDER_LINE_TAX_BASIS_UNTAXED}>未稅</option>
            <option value={MANUAL_ORDER_LINE_TAX_BASIS_TAXED}>含稅</option>
          </select>
        </label>
      </div>
    </fieldset>
  );
}
