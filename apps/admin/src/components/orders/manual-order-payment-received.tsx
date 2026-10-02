'use client';

import { useEffect, useState } from 'react';
import {
  MANUAL_ORDER_PAID_AMOUNT_FIELD,
  MANUAL_ORDER_PAID_AT_CREATE_FIELD,
  MANUAL_ORDER_PAID_BANK_REFERENCE_FIELD,
  MANUAL_ORDER_PAID_FULL_FIELD,
  MANUAL_ORDER_PAID_NOTE_FIELD,
  MANUAL_ORDER_PAYMENT_CHANNEL_FIELD,
  MANUAL_ORDER_SHOPEE_PAYOUT_FIELD,
  MANUAL_ORDER_SOURCE_FIELD,
} from '../../lib/orders/manual-order-form';
import { MANUAL_FIELD_INPUT, MANUAL_FIELD_LABEL, MANUAL_SECTION, MANUAL_SECTION_LEGEND } from './manual-order-field-classes';
import { keepIfSame, readManualOrderPreview, watchManualOrderForm } from './manual-order-total-preview';

// manual-order-payment-received.tsx — 手動建單「收款」區塊(貼板 263;Sean 2026-10-02「建單時登記收款」Q1–Q4 甲)。
//
// 一般單:勾「客人已付款，建單時一起登記收款」才展開。
//   · 預設「已收全額」(Q1 甲):金額由系統在建單時用它算的訂單總額, 這裡顯示的是同一張表單的總額預覽。
//   · 取消全額 ⇒ 出現金額欄, 填實際收到的(Q3 甲, 例如訂金)。
//   · 匯款才有銀行單號 / 末五碼(必填);刷卡不另填末四碼(Q4 甲)。收款時間一律記建單當下(Q2 甲), 實際付款日寫備註。
// 蝦皮單:不用勾, 直接展開(Sean 2026-10-02:原本那一格在付款方式下面, 他找不到)。
//   版面比照訂單頁「新增收款」的蝦皮進帳:左「金額」= 訂單總額、右「蝦皮進帳金額」、下面一行說明。
// 🛑 這一層只是畫面:解析端(parseManualOrderForm)與 DB(admin_create_manual_order)都會再檢查;金額不可大於總額由 DB 擋。

export const SHOPEE_PAYOUT_NOTE =
  '抄蝦皮頁面上的「預估訂單進帳」。金額欄是訂單金額，兩者的差額記為蝦皮扣款。還不知道可以留白，之後到收款明細登記。';

type Snapshot = { shopee: boolean; channel: string | null; total: number | null };

/** 讀同一張表單的來源、付款方式與總額預覽(跟著表單變動即時更新;同 manual-order-total-preview 讀表單的做法)。 */
function useFormSnapshot(host: HTMLElement | null): Snapshot {
  const [snap, setSnap] = useState<Snapshot>({ shopee: false, channel: null, total: null });
  useEffect(() => {
    const form = host?.closest('form') ?? null;
    if (form === null) return;
    const sync = () => {
      const source = form.querySelector(`select[name="${MANUAL_ORDER_SOURCE_FIELD}"]`);
      const channel = form.querySelector(`select[name="${MANUAL_ORDER_PAYMENT_CHANNEL_FIELD}"]`);
      const preview = readManualOrderPreview(form);
      const next: Snapshot = {
        shopee: source instanceof HTMLSelectElement && source.value === 'manual_shopee',
        channel: channel instanceof HTMLSelectElement ? channel.value : null,
        total: preview !== null && preview.kind === 'ok' ? preview.total : null,
      };
      setSnap((prev) => keepIfSame(prev, next));
    };
    sync();
    // 加一列 / 刪一列也要跟著更新總額(同預覽, 2026-10-02)
    return watchManualOrderForm(form, sync);
  }, [host]);
  return snap;
}

const GRID_2 = 'my-[6px] grid grid-cols-2 gap-x-2 gap-y-[6px]';
const HINT = 'mt-1 block text-xs text-(--fg-2)';

/** 總額預覽;算不出來(品項沒填完、含稅換算不整)就不編數字。 */
function TotalShown({ total }: { total: number | null }) {
  return (
    <span className='py-[5px] text-sm font-medium'>
      {total === null ? '—（填完品項後顯示）' : `NT$ ${total.toLocaleString('zh-TW')}`}
    </span>
  );
}

export function ManualOrderPaymentReceived() {
  const [host, setHost] = useState<HTMLFieldSetElement | null>(null);
  const { shopee, channel, total } = useFormSnapshot(host);
  const [paid, setPaid] = useState(false);
  const [full, setFull] = useState(true);

  return (
    <fieldset ref={setHost} className={MANUAL_SECTION} data-testid='manual-order-payment-received'>
      <legend className={MANUAL_SECTION_LEGEND}>收款</legend>
      {shopee ? (
        <>
          <div className={GRID_2}>
            <div className={MANUAL_FIELD_LABEL}>
              金額
              <TotalShown total={total} />
            </div>
            <label className={MANUAL_FIELD_LABEL}>
              蝦皮進帳金額（新臺幣元，選填）
              <input autoComplete='off' name={MANUAL_ORDER_SHOPEE_PAYOUT_FIELD} inputMode='numeric' defaultValue='' className={MANUAL_FIELD_INPUT} />
            </label>
          </div>
          <span className={HINT}>{SHOPEE_PAYOUT_NOTE}</span>
        </>
      ) : (
        <>
          <label className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              name={MANUAL_ORDER_PAID_AT_CREATE_FIELD}
              checked={paid}
              onChange={(e) => setPaid(e.target.checked)}
            />
            客人已付款，建單時一起登記收款
          </label>
          {paid && (
            <>
              <div className={GRID_2}>
                <div className={MANUAL_FIELD_LABEL}>
                  <label className='flex items-center gap-2'>
                    <input
                      type='checkbox'
                      name={MANUAL_ORDER_PAID_FULL_FIELD}
                      checked={full}
                      onChange={(e) => setFull(e.target.checked)}
                    />
                    已收全額
                  </label>
                  {full ? (
                    <>
                      <TotalShown total={total} />
                      <span className={HINT}>以建單時系統算出的訂單總額為準。</span>
                    </>
                  ) : (
                    <label className={MANUAL_FIELD_LABEL}>
                      收款金額（新臺幣元）
                      <input autoComplete='off' name={MANUAL_ORDER_PAID_AMOUNT_FIELD} inputMode='numeric' defaultValue='' className={MANUAL_FIELD_INPUT} />
                      <span className={HINT}>部分收款（例如訂金）填實際收到的金額，請輸入整數，不含逗號。</span>
                    </label>
                  )}
                </div>
                {channel === 'bank_transfer' && (
                  <label className={MANUAL_FIELD_LABEL}>
                    銀行單號 / 末五碼
                    <input autoComplete='off' name={MANUAL_ORDER_PAID_BANK_REFERENCE_FIELD} className={MANUAL_FIELD_INPUT} />
                    <span className={HINT}>匯款須填寫銀行單號或帳號末五碼。</span>
                  </label>
                )}
              </div>
              <label className={MANUAL_FIELD_LABEL}>
                收款備註（選填）
                <input autoComplete='off' name={MANUAL_ORDER_PAID_NOTE_FIELD} className={MANUAL_FIELD_INPUT} />
                <span className={HINT}>收款時間記為建單當下；實際付款日不是今天的話，可以寫在這裡。</span>
              </label>
            </>
          )}
        </>
      )}
    </fieldset>
  );
}
