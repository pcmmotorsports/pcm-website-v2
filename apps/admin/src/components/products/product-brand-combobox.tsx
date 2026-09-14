'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

// product-brand-combobox.tsx — 商品頁工具列的品牌選擇(2026-09-14 設計窗;Sean:「上方篩選欄位太佔空間」)。
// 取代原本 4 行高的 <select multiple>:一格可打字搜的框 + 選了變成一顆可 × 的 chip(可多選)。
// 🔴 零改資料層:送出仍是 GET `?brand=<id>`(每個選到的 id 一顆 hidden;`parseProductBrandIds` 認同名多鍵)。
// props 只有純量:選項與已選都是 JSON 字串(id / name),沒有金額沒有價格。

type Opt = { id: string; name: string };

export function ProductBrandCombobox({
  optionsJson,
  selectedJson,
  name,
}: {
  /** `[{id,name}]`(只列有商品的品牌,由 page 用 buildBrandOptions 算)。 */
  optionsJson: string;
  /** 已選 id 陣列 JSON(來自網址)。 */
  selectedJson: string;
  /** hidden 欄位名(字面 `brand`)。 */
  name: string;
}) {
  const options = useMemo<Opt[]>(() => {
    try {
      const p = JSON.parse(optionsJson) as unknown;
      return Array.isArray(p) ? (p as Opt[]).filter((o) => typeof o?.id === 'string' && typeof o?.name === 'string') : [];
    } catch {
      return [];
    }
  }, [optionsJson]);
  const [selected, setSelected] = useState<string[]>(() => {
    try {
      const p = JSON.parse(selectedJson) as unknown;
      return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  // 選了 / 拿掉一顆 ⇒ 自己送出外層 GET 表單(AutoApplySubmit 只聽 <select> 的 change;hidden 欄位由 React 加上去不會觸發)。
  // 等 hidden 欄位 render 完(effect 在 commit 之後跑)再 requestSubmit;初次掛上不送。
  useEffect(() => {
    if (!touched.current) return;
    touched.current = false;
    rootRef.current?.closest('form')?.requestSubmit();
  }, [selected]);
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const hits = q.trim() === '' ? options.filter((o) => !selected.includes(o.id)).slice(0, 12) : options.filter((o) => !selected.includes(o.id) && o.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 12);
  const add = (id: string) => {
    touched.current = true;
    setSelected((s) => (s.includes(id) ? s : [...s, id]));
    setQ('');
    setOpen(false);
  };
  return (
    <div ref={rootRef} className='pcm-combo' data-testid='product-brand-combobox'>
      {selected.map((id) => (
        <span key={id} className='pcm-combo-chip'>
          <input type='hidden' name={name} value={id} />
          {byId.get(id)?.name ?? id}
          <button type='button' className='pcm-x' aria-label={`拿掉品牌 ${byId.get(id)?.name ?? id}`} onClick={() => { touched.current = true; setSelected((s) => s.filter((x) => x !== id)); }}>×</button>
        </span>
      ))}
      <input
        id='product-brand-filter'
        type='text'
        value={q}
        placeholder={selected.length === 0 ? '品牌' : '再加品牌'}
        aria-label='品牌'
        role='combobox'
        aria-expanded={open}
        aria-controls={listId}
        autoComplete='off'
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) { e.preventDefault(); add(hits[0].id); }
          if (e.key === 'Backspace' && q === '' && selected.length > 0) { touched.current = true; setSelected((s) => s.slice(0, -1)); }
          if (e.key === 'Escape') setOpen(false);
        }}
        className='pcm-combo-input'
      />
      {open && hits.length > 0 ? (
        <ul id={listId} role='listbox' className='pcm-combo-list'>
          {hits.map((o) => (
            <li key={o.id} role='option' aria-selected={false}>
              <button type='button' className='pcm-opt' onMouseDown={(e) => e.preventDefault()} onClick={() => add(o.id)}>{o.name}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
