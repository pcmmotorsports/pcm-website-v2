'use client';

import {
  MANUAL_FIELD_INPUT,
  MANUAL_FIELD_LABEL,
  MANUAL_SECTION,
  MANUAL_SECTION_LEGEND,
} from './manual-order-field-classes';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  MANUAL_ORDER_SHIP_TO_LINE_FIELD,
  MANUAL_ORDER_SHIP_TO_NAME_FIELD,
  MANUAL_ORDER_SHIP_TO_PHONE_FIELD,
} from '@/lib/orders/manual-order-form';
import { splitRecipientPaste } from '@/lib/orders/split-recipient-paste';
import { loadManualCustomerAddressesAction } from '@/lib/customers/manual-order-address-actions';
import type { AddressChoice } from '@/lib/customers/manual-order-address';

// manual-order-ship-to.tsx — 收件資料那一塊(2026-08-28 起;2026-10-01 改版, Sean Q24 甲 / Q25 甲)。
//
// 這一塊有:貼上整段(拆好填進三格)、收件人 / 電話 / 地址、電話下面的客人狀態(`customer`, 由表單本體塞進來)、
//   選了客人之後的地址簿下拉。
// 🔴 它是 client 元件, 表單本體(`manual-order-form-body.tsx`)仍是 server component、全 PRG。
// ── 不變式(與 `manual-order-submit.tsx` / `manual-customer-picker.tsx` 同一條)──────────
//   **送出值一律由原生控制項承載。** 本檔寫值只有兩條路, 都是員工明確的動作:
//   貼上整段、從地址簿選;選客人時自動帶入只在三格都是空的時候。
// ⛔ 2026-10-01 拿掉「同上」與「用這份收件人建客人」:客人改由收件電話自動找、按「確認」時建立。
//    兩顆鈕的理由與四輪審查全文在 git log(本檔 2026-08-28、09-06 那幾片)。

export function ManualOrderShipTo({
  source,
  beforePhone,
  customer,
}: {
  /** 收件資料最上面:訂單來源下拉(2026-10-01 建單簡化 S4)。由表單本體塞進來, 欄位定義留在那裡。 */
  source?: ReactNode;
  /** 收件電話正上方的位置:網站B 的「蝦皮帳號」之後放這裡(只在來源是蝦皮時出現;計畫第 7 節)。目前沒有人傳。 */
  beforePhone?: ReactNode;
  /** 收件電話下面那一小塊:自動找到的客人、換一位客人(`manual-customer-picker.tsx`)。由表單本體塞進來。 */
  customer?: ReactNode;
} = {}) {
  const rootRef = useRef<HTMLFieldSetElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 「貼上整段」拆完的結果說明(Sean 2026-10-01 Q25 甲)。與上面那個 notice 分開:這一句是確認, 不是警告。
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  // 選起來那位客人的地址簿(最近用過的在前)。空 = 沒有可選的 ⇒ 不畫下拉。
  const [book, setBook] = useState<AddressChoice[]>([]);
  // 這份地址簿是哪位客人的。🔴 新建客人(defaultChecked)與重新搜尋(整批 radio 重掛)都【不發 change】
  //    ⇒ 下拉可能還掛著上一位的地址 ⇒ 從下拉帶入前要核對「現在勾的」是不是這位。
  const [bookFor, setBookFor] = useState<string | null>(null);
  // 🔴 換客人很快時,舊的回應晚到不能蓋掉新的 ⇒ 只收最後一次的回應
  const loadSeq = useRef(0);
  // 系統從地址簿帶進三格的值,以及那是哪位客人的。員工改過任一格之後,就不再算「系統帶的」。
  // 🔴 Codex R1 必修 1:選 A 自動帶入 → 改選 B ⇒ 三格不是空的、B 不會自動帶 ⇒ 送出「客人 B + A 的地址」,
  //    而且建單後會把 A 的地址存進 B 的地址簿。⇒ 換客人時要認得出「這三格是上一位帶進來的」。
  const autofill = useRef<{ customer: string; values: readonly [string, string, string] } | null>(null);
  // 上一次處理過的勾選;換成別人(或沒有人)時才重來一次
  const lastCustomer = useRef<string | null>(null);

  // ── 地址簿帶入(Sean 2026-09-27:「再建訂單就沒有地址」;08-28 Q-建單2 甲)──────────────
  // 🔴 直接寫輸入框的 value,**不換 key、不走 state**:地址那一格沒有 key(檔頭那段),
  //    換 key 會把員工打好的字清掉。這裡只在【三格都是空的】時自動帶;
  //    從下拉選是員工明確的動作 ⇒ 那時才覆蓋。
  function shipFields(): [HTMLInputElement | null, HTMLInputElement | null, HTMLInputElement | null] {
    const form = rootRef.current?.form;
    const field = (name: string) => {
      const el = form?.querySelector(`[name="${name}"]`);
      return el instanceof HTMLInputElement ? el : null;
    };
    return [field(MANUAL_ORDER_SHIP_TO_NAME_FIELD), field(MANUAL_ORDER_SHIP_TO_PHONE_FIELD), field(MANUAL_ORDER_SHIP_TO_LINE_FIELD)];
  }

  function checkedCustomer(): string | null {
    const el = rootRef.current?.form?.querySelector('input[name="customer_user_id"]:checked');
    return el instanceof HTMLInputElement ? el.value : null;
  }

  function fillFrom(a: AddressChoice, onlyIfEmpty: boolean, customer: string) {
    const els = shipFields();
    if (onlyIfEmpty && els.some((el) => (el?.value ?? '').trim() !== '')) return;
    const values = [a.name, a.phone, a.line] as const;
    els.forEach((el, i) => {
      if (el) el.value = values[i]!;
    });
    autofill.current = { customer, values };
  }

  // 勾選的客人變了 ⇒ 收掉上一位帶進來的資料、讀這一位的地址簿。
  // 🔴 新建客人(defaultChecked)與重新搜尋(整批 radio 重掛)都【不發 change】(Codex R1 必修 2)
  //    ⇒ 除了 change,也在表單結構變動時(MutationObserver)重新核對一次目前勾的是誰。
  function onSelection() {
    const current = checkedCustomer();
    if (current === lastCustomer.current) return;
    lastCustomer.current = current;
    const seq = ++loadSeq.current;
    setBook([]);
    setBookFor(current);

    const af = autofill.current;
    if (af && af.customer !== current) {
      const els = shipFields();
      const untouched = els.every((el, i) => (el?.value ?? '') === af.values[i]);
      if (untouched) {
        els.forEach((el) => {
          if (el) el.value = '';
        });
      } else {
        // Fable R2 建議:講清楚送出後的後果(會存進目前這位客人的地址簿)
        setNotice('收件資料和上一位客人帶入的不同，已保留。送出後會存進目前這位客人的地址簿，請確認這是這位客人的收件資料。');
      }
      autofill.current = null;
    }
    if (current === null) return;

    void loadManualCustomerAddressesAction(current)
      .then((r) => {
        // 回應晚到:只收【最後一次】而且【現在勾的還是這位】的
        if (seq !== loadSeq.current || checkedCustomer() !== current) return;
        if (!r.ok) {
          setNotice(r.message);
          return;
        }
        setBook(r.addresses);
        const first = r.addresses[0];
        if (first) fillFrom(first, true, current);
      })
      // 連線中斷等丟出來的錯:不讓它變成沒人接的錯誤,講一句、不動收件資料
      .catch(() => {
        if (seq === loadSeq.current) setNotice('客人的地址簿載入失敗，請自行填寫收件資料。');
      });
  }

  useEffect(() => {
    const form = rootRef.current?.form;
    if (!form) return;
    const onChange = (e: Event) => {
      const el = e.target;
      if (el instanceof HTMLInputElement && el.name === 'customer_user_id') onSelection();
    };
    form.addEventListener('change', onChange);
    const observer = new MutationObserver(() => onSelection());
    observer.observe(form, { childList: true, subtree: true });
    return () => {
      form.removeEventListener('change', onChange);
      observer.disconnect();
    };
    // onSelection 只讀 ref 與 DOM、只呼叫 setState ⇒ 掛一次就好
  }, []);

  // ── 貼上整段 ⇒ 拆成收件人 / 電話 / 地址(Sean 2026-10-01 Q25 甲:貼上就立刻填好, 三格都可以再改)──────
  // 🔴 只覆蓋【有認出值】的那一格:沒認出地址時, 地址那格原本的字不清掉(計畫第 2 節)。
  // 🔴 寫值後補發 `input` 事件:直接改 `.value` 不會發事件, 而送出鈕與之後的「用電話找客人」都靠事件知道值變了。
  function onPasteWhole(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const r = splitRecipientPaste(e.clipboardData.getData('text/plain'));
    const [nameEl, phoneEl, lineEl] = shipFields();
    const filled: string[] = [];
    const put = (el: HTMLInputElement | null, value: string, label: string) => {
      if (!el || value === '') return;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      filled.push(label);
    };
    put(nameEl, r.name, '收件人');
    put(phoneEl, r.phone, '電話');
    put(lineEl, r.address, '地址');
    const missing = [
      ...(r.name === '' ? ['收件人'] : []),
      ...(r.phone === '' ? ['電話'] : []),
      ...(r.address === '' ? ['地址'] : []),
    ];
    setPasteNote(
      [
        filled.length > 0 ? `已填入${filled.join('、')}，請確認。` : '沒有認出收件人、電話或地址，請自己填寫下面三格。',
        filled.length > 0 && missing.length > 0 ? `沒有認出${missing.join('、')}，請自己填。` : '',
        r.extraPhones.length > 0 ? `另一支電話 ${r.extraPhones.join('、')} 沒有填入。` : '',
      ].join(''),
    );
  }

  return (
    <fieldset ref={rootRef} className={MANUAL_SECTION}>
      <legend className={MANUAL_SECTION_LEGEND}>收件資料</legend>
      {source}

      {notice && (
        <p role='status' data-testid='manual-order-ship-to-notice' className='text-xs text-amber-700'>
          {notice}
        </p>
      )}

      {/* 沒有 name ⇒ 不會被送出;貼上的那一刻拆好填進下面三格。 */}
      <label className={MANUAL_FIELD_LABEL}>
        貼上整段(姓名、電話、地址一起貼,系統幫你分好)
        <textarea
          rows={2}
          autoComplete='off'
          onPaste={onPasteWhole}
          placeholder='例:王小明 0912345678 台北市中正區忠孝東路一段1號'
          data-testid='manual-order-ship-to-paste'
          className={MANUAL_FIELD_INPUT}
        />
      </label>
      {pasteNote && (
        <p role='status' data-testid='manual-order-ship-to-paste-note' className='text-muted-foreground text-xs'>
          {pasteNote}
        </p>
      )}

      {/* 客人地址簿有地址 ⇒ 可以換成別筆。沒有 name ⇒ 不會被送出,只負責把值寫進下面三格。 */}
      {book.length > 0 && (
        <select
          aria-label='從地址簿選'
          autoComplete='off'
          value=''
          onChange={(e) => {
            const checked = rootRef.current?.form?.querySelector('input[name="customer_user_id"]:checked');
            if (!(checked instanceof HTMLInputElement) || checked.value !== bookFor) {
              setBook([]);
              setNotice('客人已經換了，地址簿已清除。請重新選一次客人，再從地址簿選。');
              return;
            }
            const a = book.find((x) => x.id === e.target.value);
            if (a) fillFrom(a, false, checked.value);
          }}
          className={MANUAL_FIELD_INPUT}
        >
          <option value=''>{`從客人地址簿選（${book.length} 筆）`}</option>
          {book.map((a) => (
            <option key={a.id} value={a.id}>{`${a.name}　${a.phone}　${a.line}`}</option>
          ))}
        </select>
      )}

      <input
        name={MANUAL_ORDER_SHIP_TO_NAME_FIELD}
        autoComplete='off'
        aria-label='收件人'
        placeholder='收件人'
        required
        className={MANUAL_FIELD_INPUT}
      />
      {beforePhone}
      <input
        name={MANUAL_ORDER_SHIP_TO_PHONE_FIELD}
        autoComplete='off'
        aria-label='收件人電話'
        placeholder='電話'
        required
        className={MANUAL_FIELD_INPUT}
      />
      {/* 收件電話下面:這支電話是哪位客人(Sean 2026-10-01 Q24 甲) */}
      {customer}
      <input
        name={MANUAL_ORDER_SHIP_TO_LINE_FIELD}
        autoComplete='off'
        aria-label='收件地址'
        placeholder='地址'
        required
        className={MANUAL_FIELD_INPUT}
      />
    </fieldset>
  );
}
