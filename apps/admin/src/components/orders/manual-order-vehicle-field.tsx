'use client';

import { useEffect, useRef, useState } from 'react';
import { searchVehicleDictionaryAction } from '../../lib/orders/vehicle-dictionary-action';
import {
  MANUAL_ORDER_VEHICLE_PICK_FIELD,
  MANUAL_ORDER_VEHICLE_TEXT_FIELD,
} from '../../lib/orders/manual-order-form';
import { splitVehicleText, vehicleHitDisplay, type VehicleDictionaryHit } from '../../lib/orders/vehicle-dictionary';
import { MANUAL_FIELD_INPUT, MANUAL_FIELD_LABEL } from './manual-order-field-classes';

// manual-order-vehicle-field.tsx — 手動建單那格「車種」(#956 乙, Sean 2026-09-14 拍;圖 ~/pcm-mailbox/0914-品味題/956-B-一格.png)。
//
// 🔴 一格照 Excel 寫法打(例 `2021 CBR`):打 ≥2 字 ⇒ 下面帶字典(最多 20 列)+ 最後一列恆「照打」。
//    選字典列 ⇒ 文字換成「<年份> <model_code>」+ hidden `vehicle_pick` 記 {brand, model, display};
//    選「照打」或直接不選 ⇒ 沒 pick, server 端當 free 照存(RPC 標 source=manual_text, 後台看得出這台不在字典)。
// 🔴 送出去的只有兩個原生欄位(text + hidden);server `resolveManualOrderVehicle` 只在「看到的字 = 選那列時的字」才採 pick
//    ⇒ 選完又改字不會存到錯的車(畫面上看到什麼就存什麼)。
// 🔴 字典查詢走 server action(員工閘);失敗 / 沒票 ⇒ 空清單, 這一格照樣能照打。

const DEBOUNCE_MS = 250;

export function ManualOrderVehicleField() {
  const [text, setText] = useState('');
  const [pick, setPick] = useState('');
  const [hits, setHits] = useState<VehicleDictionaryHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const { q } = splitVehicleText(text);
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      void searchVehicleDictionaryAction({ q }).then(
        (r) => {
          if (seq.current === mine) setHits(r);
        },
        () => {
          if (seq.current === mine) setHits([]);
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const { year } = splitVehicleText(text);
  const rows: Array<{ key: string; label: string; meta: string; hit: VehicleDictionaryHit | null }> = [
    ...hits.map((h) => ({ key: `${h.brand}|${h.model}`, label: vehicleHitDisplay(h, year), meta: `${h.brand} · 字典有`, hit: h })),
    ...(text.trim() !== '' ? [{ key: '__free__', label: `照打:「${text.trim()}」`, meta: '字典沒有也存', hit: null }] : []),
  ];

  const choose = (row: (typeof rows)[number]) => {
    if (row.hit === null) {
      setPick('');
    } else {
      setText(row.label);
      setPick(JSON.stringify({ brand: row.hit.brand, model: row.hit.model, display: row.label }));
    }
    setOpen(false);
  };

  return (
    <fieldset className='border-border rounded-lg border p-3'>
      <legend className='text-muted-foreground px-1 text-xs'>
        車輛(這張單一台車;照你平常的寫法打, 有對到字典就帶入, 沒有就照存)
      </legend>
      <label className={`${MANUAL_FIELD_LABEL} relative`}>
        車種
        <input
          autoComplete='off'
          name={MANUAL_ORDER_VEHICLE_TEXT_FIELD}
          value={text}
          placeholder='例 2021 CBR'
          className={MANUAL_FIELD_INPUT}
          onChange={(e) => {
            setText(e.target.value);
            setPick('');
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!open || rows.length === 0) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, rows.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              // 🔴 攔下 Enter:這一格的 Enter 是「選這列」, 不是「送出整張單」。
              e.preventDefault();
              const row = rows[active];
              if (row) choose(row);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        <input type='hidden' name={MANUAL_ORDER_VEHICLE_PICK_FIELD} value={pick} readOnly />
        {open && rows.length > 0 && (
          <ul
            role='listbox'
            data-testid='vehicle-dictionary-list'
            className='bg-popover text-popover-foreground border-border absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border shadow-md'
          >
            {rows.map((row, i) => (
              <li
                key={row.key}
                role='option'
                aria-selected={i === active}
                className={`flex cursor-pointer items-baseline gap-3 px-3 py-2 text-sm ${i === active ? 'bg-muted' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(row);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className='font-medium'>{row.label}</span>
                <span className='text-muted-foreground text-xs'>{row.meta}</span>
              </li>
            ))}
          </ul>
        )}
      </label>
    </fieldset>
  );
}
