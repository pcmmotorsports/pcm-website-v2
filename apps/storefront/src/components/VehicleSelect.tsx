'use client';

// VehicleSelect.tsx — 可打字三層車款選擇(V-1b;Sean 痛點「不能打字」+ Q4 全站統一元件核心殼)。
// 行為=typeahead combobox(打字 prefix/substring 過濾、鍵盤上下+Enter、點選、blur 唯一精確命中
// 才自動套用=REQUIRED-2、清空=清該層連動);比對走 lib/vehicle-match 共用核心(車種鐵律:
// 候選恆字典字面、零猜)。視覺沿 .cft-select token(.vsc- 樣式、filter-cascade.css)。
// 🔴 typeahead=design-reference 零先例、Sean 口述授權行為偏離(視覺對齊);controlled by
// 外部 vehicle 值(reducer/context)=鏡像天然成立、無本地鏡像 effect。

import { useState, type KeyboardEvent } from 'react';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import { filterVehicleOptions, uniqueExactMatch } from '@/lib/vehicle-match';

type ComboProps = {
  label: string;
  /** 已選定值(字典字面);null=未選 */
  value: string | null;
  options: readonly string[];
  disabled?: boolean;
  placeholder: string;
  /** 選定字典字面(點選/Enter/blur 唯一精確命中) */
  onPick: (name: string) => void;
  /** 清空本層(input 清空後 commit) */
  onClear: () => void;
  /** 掛載點外殼(V-1c 視覺回歸修):'catalog'=cft token 小框;'finder'=design ed-finder-slot
   *  (標籤+無框線);'form'=裸 input、樣式交掛載表單的 CSS(V-1c++ 車庫表單字典雙下拉) */
  variant: 'catalog' | 'finder' | 'form';
  /** finder 變體的 slot 標籤字面(design:品牌/車型/年份) */
  slotLabel?: string;
};

// V-1c++:車庫「新增車輛」表單重用同一 combobox 原型(打字過濾/鍵盤/唯一精確命中),
// 具名匯出、不複製第二份行為(全站選車行為單一來源)。
export function VehicleCombo(props: ComboProps) {
  return <Combo {...props} />;
}

function Combo({
  label,
  value,
  options,
  disabled,
  placeholder,
  onPick,
  onClear,
  variant,
  slotLabel,
}: ComboProps) {
  const [text, setText] = useState<string | null>(null); // null=未編輯(顯 value)
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const shown = text ?? value ?? '';
  const list = filterVehicleOptions(options, text ?? '', (n) => n);

  const pick = (name: string) => {
    setText(null);
    setOpen(false);
    // 重選同值=只關列表不 dispatch(code-reviewer R1:select-brand/model 同值會 cascade reset
    // 清下層;舊原生 select 選同項不觸發 change、此為行為等價守門)
    if (name !== value) onPick(name);
  };

  const commit = () => {
    setOpen(false);
    if (text === null) return;
    if (text.trim() === '') {
      setText(null);
      if (value !== null) onClear();
      return;
    }
    const exact = uniqueExactMatch(options, text, (n) => n);
    setText(null);
    if (exact !== null && exact !== value) onPick(exact);
    // 非唯一命中 → 還原顯示已選值(不猜、不半套);重新 focus/打字即再開清單明選
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(h + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setHi((h) => (h <= 0 ? 0 : h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // hi=-1(focus 開列表、未導航)→ 走 commit,不誤選 list[0]
      const target = hi >= 0 ? list[hi] : undefined;
      if (open && target !== undefined) pick(target);
      else commit();
    } else if (e.key === 'Escape') {
      setText(null);
      setOpen(false);
    }
  };

  // finder 變體=design ed-finder-slot 結構(小標籤在上、無框線輸入;.ed-finder-slot 已 relative
  // 供 .vsc-list 定位);catalog 變體=型錄 cft token 小框;form 變體=裸 input(外觀由掛載表單
  // 的 CSS 決定,如 account.css .acc-inline-form-inner input 選擇器)。
  const Wrapper = variant === 'finder' ? 'label' : 'div';
  const wrapperClass = variant === 'finder' ? 'ed-finder-slot vsc' : 'vsc';
  const inputClass =
    variant === 'finder'
      ? 'vsc-input vsc-input--finder'
      : variant === 'form'
        ? 'vsc-input'
        : 'cft-select vsc-input';

  return (
    <Wrapper className={wrapperClass}>
      {variant === 'finder' && slotLabel && (
        <span className="ed-finder-slot-label">{slotLabel}</span>
      )}
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={label}
        aria-autocomplete="list"
        className={inputClass}
        value={shown}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => {
          setOpen(true);
          setHi(-1); // 未導航態:Enter 走 commit、不誤選首項(R1 minor)
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {open && !disabled && list.length > 0 && (
        <ul className="vsc-list" role="listbox" aria-label={`${label}選項`}>
          {list.map((name, i) => (
            <li
              key={name}
              role="option"
              aria-selected={name === value}
              className={`vsc-option${i === hi ? ' is-hi' : ''}`}
              // onMouseDown(非 onClick):先於 input blur 觸發、避免 blur commit 搶走點選
              onMouseDown={(e) => {
                e.preventDefault();
                pick(name);
              }}
              // finder 變體 Wrapper=label:取消 click 的 label activation(否則點選後 focus 轉發
              // 回 input → onFocus 重開整份清單掛著;code-reviewer R1)
              onClick={(e) => e.preventDefault()}
              // 滑鼠懸停=同一 highlight 來源(hi),避免 hover/is-hi 雙高亮歧義(R1 minor)
              onMouseEnter={() => setHi(i)}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </Wrapper>
  );
}

export function VehicleSelect({
  motoBrands,
  vehicle,
  onPickBrand,
  onPickModel,
  onPickYear,
  onClearBrand,
  onClearModel,
  onClearYear,
  variant = 'catalog',
}: {
  motoBrands: MockMotoBrand[];
  vehicle: { brand: string; model?: string; year?: number } | null;
  onPickBrand: (name: string) => void;
  onPickModel: (name: string) => void;
  onPickYear: (year: number) => void;
  /** 清 brand=全清 */
  onClearBrand: () => void;
  /** 清 model(保留 brand) */
  onClearModel: () => void;
  /** 清 year(保留 brand+model) */
  onClearYear: () => void;
  /** 掛載點外殼:'catalog'(預設、cft 小框)/'finder'(首頁 design slot 版型) */
  variant?: 'catalog' | 'finder';
}) {
  const curBrand = vehicle ? motoBrands.find((b) => b.name === vehicle.brand) : undefined;
  const models = curBrand?.models ?? [];
  const curModel =
    vehicle?.model != null ? models.find((m) => m.name === vehicle.model) : undefined;
  const years = curModel?.years ?? [];
  const modelNoYears = curModel !== undefined && years.length === 0;

  return (
    <>
      <Combo
        label="選擇品牌"
        value={vehicle?.brand ?? null}
        options={motoBrands.map((b) => b.name)}
        placeholder={variant === 'finder' ? '—' : '品牌'}
        onPick={onPickBrand}
        onClear={onClearBrand}
        variant={variant}
        slotLabel="品牌"
      />
      <Combo
        label="選擇車型"
        value={vehicle?.model ?? null}
        options={models.map((m) => m.name)}
        disabled={!vehicle}
        placeholder={variant === 'finder' ? '—' : '車型'}
        onPick={onPickModel}
        onClear={onClearModel}
        variant={variant}
        slotLabel="車型"
      />
      <Combo
        label="選擇年份"
        value={vehicle?.year != null ? String(vehicle.year) : null}
        options={years.map((y) => String(y))}
        disabled={!vehicle || vehicle.model == null || modelNoYears}
        placeholder={modelNoYears ? '不限年份' : variant === 'finder' ? '—' : '年份'}
        onPick={(name) => onPickYear(Number(name))}
        onClear={onClearYear}
        variant={variant}
        slotLabel="年份"
      />
    </>
  );
}
