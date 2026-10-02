'use client';

import { useState } from 'react';
import type { OrderItemVehicleSnapshot } from '@pcm/domain';
import { VEHICLE_EDIT_FIELD } from '../../lib/orders/workflow-form';
import { ManualOrderVehicleField } from './manual-order-vehicle-field';

// order-vehicle-edit-fields.tsx — 訂單頁「編輯個資」的車款 + 年份(貼板 264;Sean 2026-10-02)。
// 形狀照收件資料那一塊(ship-to-edit-fields.tsx):勾「改車款」才送 vehicle_edit, 沒勾就不動訂單上的車。
// 勾了之後用建單畫面同一塊(字典搜尋 + 年份), 帶入現在那台車;車種清空再儲存 = 清掉這張單的車。
// 只改這張訂單的紀錄, 不動客人頁的「我的愛車」(Sean Q30 甲)。

/** 訂單上的車 ⇒ 建單那一塊的三個初始值(字典帶入的車連 hidden pick 一起帶, 存回去才會維持字典帶入)。 */
function initialOf(v: OrderItemVehicleSnapshot | null): { initialText: string; initialPick: string; initialYear: string } {
  if (v === null) return { initialText: '', initialPick: '', initialYear: '' };
  const initialYear = v.year === undefined || v.year === null ? '' : String(v.year);
  if (v.kind === 'dict') {
    return {
      initialText: v.model,
      initialPick: JSON.stringify({ brand: v.brand, model: v.model, display: v.model }),
      initialYear,
    };
  }
  return { initialText: v.raw, initialPick: '', initialYear };
}

/** `current` = 伺服器端排好的顯示字(formatOrderItemVehicle 在 server-only 模組裡, client 元件不能 import)。 */
export function OrderVehicleEditFields({ vehicle, current }: { vehicle: OrderItemVehicleSnapshot | null; current: string | null }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className='sm:col-span-2 lg:col-span-3 space-y-2' data-testid='order-edit-vehicle'>
      <label className='flex items-center gap-2 text-sm'>
        <input
          type='checkbox'
          name={VEHICLE_EDIT_FIELD}
          value='1'
          checked={editing}
          onChange={(e) => setEditing(e.target.checked)}
          data-testid='vehicle-edit-toggle'
        />
        改車款(車種 / 年份)
      </label>
      {editing ? (
        <ManualOrderVehicleField {...initialOf(vehicle)} defaultOpen />
      ) : (
        <p className='text-muted-foreground text-sm'>目前車款:{current ?? '沒有記車'}</p>
      )}
    </div>
  );
}
