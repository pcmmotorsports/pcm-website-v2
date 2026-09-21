'use client';

import { useState } from 'react';
import { OrderCopyButton } from './order-copy-button';
import { SHIP_TO_EDIT_FIELD, SHIP_TO_LINE_FIELD, SHIP_TO_NAME_FIELD, SHIP_TO_PHONE_FIELD } from '../../lib/orders/workflow-form';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';

// ship-to-edit-fields.tsx — 編輯個資彈窗的 收件人 / 電話 / 地址 三格(第 5 代 20260915070000)。
// 🔴 codex must-fix ②:三格【勾了「改收件資料」才送】—— 沒勾時 <input disabled> 不進 FormData ⇒ RPC 一鍵都收不到 ⇒ 快照不動。
//    不然「只改發票」會被舊資料的空電話 / 超長地址擋住(舊寫入路允許那些值)。
// 🔴 勾了 ⇒ 三格必填、三格一起送(parser 與 RPC 都擋半套);已建的箱不跟著改 —— 下面那一句就是講這件。

export function ShipToEditFields({ name, phone, line }: { name: string; phone: string; line: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name, phone, line });
  const recipient = editing ? draft : { name, phone, line };
  return (
    <>
      <div className='sm:col-span-2 lg:col-span-3 order-recipient-copy'>
        <OrderCopyButton label='複製收件資料' value={[recipient.name, recipient.phone, recipient.line].join(',')} />
        {editing ? <span className='text-muted-foreground text-xs'>複製目前輸入的資料（尚未儲存）</span> : null}
      </div>
      <div className='sm:col-span-2 lg:col-span-3'>
        <label className='flex items-center gap-2 text-sm'>
          <input type='checkbox' name={SHIP_TO_EDIT_FIELD} value='1' checked={editing} onChange={(e) => setEditing(e.target.checked)} data-testid='ship-to-edit-toggle' />
          改收件資料(收件人 / 電話 / 地址)
        </label>
      </div>
      <AdminFormField label='收件人'>
        {!editing ? <span className='order-recipient-readonly'><OrderCopyButton text label='複製姓名' value={name} /></span> : null}
        <input name={SHIP_TO_NAME_FIELD} className={ADMIN_INPUT_CLASS} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} hidden={!editing} required maxLength={60} autoComplete='off' disabled={!editing} />
      </AdminFormField>
      <AdminFormField label='電話'>
        {!editing ? <span className='order-recipient-readonly'><OrderCopyButton text label='複製電話' value={phone} /></span> : null}
        <input name={SHIP_TO_PHONE_FIELD} className={ADMIN_INPUT_CLASS} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} hidden={!editing} required maxLength={30} inputMode='tel' autoComplete='off' disabled={!editing} />
      </AdminFormField>
      {/* 地址整列(探針 1200 寬看到三欄格線把地址擠成 140px)。 */}
      <div className='sm:col-span-2 lg:col-span-3'>
        <AdminFormField label='地址'>
          {!editing ? <span className='order-recipient-readonly'><OrderCopyButton text label='複製地址' value={line} /></span> : null}
          <input name={SHIP_TO_LINE_FIELD} className={ADMIN_INPUT_CLASS} value={draft.line} onChange={(e) => setDraft({ ...draft, line: e.target.value })} hidden={!editing} required maxLength={200} autoComplete='off' disabled={!editing} />
        </AdminFormField>
      </div>
      {editing && (
        <div className='sm:col-span-2 lg:col-span-3'>
          <p className='text-muted-foreground text-xs leading-[1.4]' data-testid='ship-to-boxes-note'>
            改了收件資料, 已建的箱不會跟著改(箱上記的是出貨當時的收件人)。還沒跟新竹要過託運單號的箱 ⇒ 作廢那箱、重建一箱;已經要過號碼的 ⇒ 打電話請新竹改。
          </p>
        </div>
      )}
    </>
  );
}
