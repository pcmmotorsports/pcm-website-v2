'use client';

// VehicleSelect.tsx — 可打字三層車款選擇(V-1b;Sean 痛點「不能打字」+ Q4 全站統一元件核心殼)。
// 行為=typeahead combobox(打字 prefix/substring 過濾、鍵盤上下+Enter、點選、blur 唯一精確命中
// 才自動套用=REQUIRED-2、清空=清該層連動);比對走 lib/vehicle-match 共用核心(車種鐵律:
// 候選恆字典字面、零猜)。視覺沿 .cft-select token(.vsc- 樣式、filter-cascade.css)。
// 🔴 typeahead=design-reference 零先例、Sean 口述授權行為偏離(視覺對齊);controlled by
// 外部 vehicle 值(reducer/context)=鏡像天然成立、無本地鏡像 effect。
// A3(2026-08-05,選車引擎統一 B′):三欄字面照 OD `vehicle-picker-design.html` A 表定版 ——
//   aria label「選擇廠牌/車型/年份」、placeholder「選擇或輸入 X」、finder slot 標「· 可不選」。
//   🔴 finder 變體原本三欄 placeholder 都是 `—`(設計稿 C2 Before/After 兩張圖皆如此畫),
//   A 表標題逐字寫「實作端逐字照抄」⇒ 以 A 表為準,`—` 退場(A 計畫 §2.1 註)。
//   本檔一改擴散到四個掛載點(首頁 finder / PDP §7 / 購物車 / 帳號表單)。
//
// A5(2026-08-06,選車引擎統一 B′續):未選廠牌時車型欄改跨層搜尋(打 r6 直達車款)、
//   選定同時回填廠牌 —— 與 `/products` 桌機選車列(CascadeFilterTop)共用同一顆
//   `lib/vehicle-options`(modelFieldOptions/resolveModelPick),不建立第二套車款比對邏輯。
//   🔴 `onPickModel` 簽章因此改傳 `{ brand, model }`(而非單純 `name`):跨層選取若只回傳
//   model 名稱,呼叫端沒有管道拿到字典回填的 brand,選車就會卡在「有車型無廠牌」的壞態。

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import { filterVehicleOptions, uniqueExactMatch } from '@/lib/vehicle-match';
import { modelFieldOptions, resolveModelPick } from '@/lib/vehicle-options';

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
  /** finder 變體的 slot 標籤字面(A3 統一後 = 廠牌 / 車型 · 可不選 / 年份 · 可不選) */
  slotLabel?: string;
  /** ADR-0007:打了字但零命中時的提示字面。
   *  🔴 為何是這裡而不是呼叫端:查詢字串是本元件的 local state(`text`),呼叫端看不到
   *  「有沒有在打字」⇒ 零命中提示只能長在這裡。不傳=不渲染(既有三個掛載點行為零變動);
   *  手機選車面板必須傳(取代 FilterDrawerVehicleTab 的「查無符合的…」出口、不得回歸)。 */
  emptyHint?: string;
  /** A2(2026-08-03):`/products?pick=vehicle` 落地開燈用 —— 掛載時把游標停在本欄。
   *  🔴 只給桌機選車列的廠牌欄用,且由呼叫端閘在「非手機」;手機的開燈是自動開選車面板。
   *  .cft-bar 是 sticky top:69px(filter-cascade.css:4-7)⇒ focus 當下就在視野內,
   *  不需要另外 scrollIntoView。 */
  autoFocus?: boolean;
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
  emptyHint,
  autoFocus,
}: ComboProps) {
  const [text, setText] = useState<string | null>(null); // null=未編輯(顯 value)
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null); // V-2d④:點選選定後主動 blur 收手機鍵盤
  const shown = text ?? value ?? '';
  const list = filterVehicleOptions(options, text ?? '', (n) => n);
  // V-2h/nit-8:完整 combobox 互動模型——listbox/option 具穩定 id,input aria-controls 指 listbox、
  //   aria-activedescendant 指鍵盤高亮項(讓螢幕報讀器於方向鍵導航時報出當前選項)。
  const listboxId = useId();
  const listOpen = open && !disabled && list.length > 0;
  // ADR-0007 零命中提示:必須「有打字」才顯示(空查詢時 list 恆為全清單、走不到這條);
  // 只有傳了 emptyHint 的掛載點才渲染。
  const showEmptyHint =
    emptyHint !== undefined && open && !disabled && list.length === 0 && (text ?? '').trim() !== '';
  const optionId = (i: number) => `${listboxId}-opt-${i}`;

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
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={label}
        aria-autocomplete="list"
        aria-controls={listOpen ? listboxId : undefined}
        aria-activedescendant={listOpen && hi >= 0 ? optionId(hi) : undefined}
        className={inputClass}
        value={shown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
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
      {showEmptyHint && (
        <div className="vsc-list vsc-empty" role="status">{emptyHint}</div>
      )}
      {listOpen && (
        <ul className="vsc-list" role="listbox" id={listboxId} aria-label={`${label}選項`}>
          {list.map((name, i) => (
            <li
              key={name}
              id={optionId(i)}
              role="option"
              aria-selected={name === value}
              className={`vsc-option${i === hi ? ' is-hi' : ''}`}
              // onMouseDown(非 onClick):先於 input blur 觸發、避免 blur commit 搶走點選
              onMouseDown={(e) => {
                e.preventDefault();
                pick(name);
                // V-2d④(Sean 07-15 真機「鍵盤一直卡在那邊」):點選(觸控/滑鼠)選定後主動
                // 釋放 focus 收鍵盤——preventDefault 保住的 focus 改為明確 blur;rAF 延到 state
                // flush 後才 blur → onBlur commit 讀到 text=null 早退、不與 pick 重複 dispatch。
                // 鍵盤 Enter 選定不走此路=桌機鍵盤流不變。
                requestAnimationFrame(() => inputRef.current?.blur());
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
  /** 車型欄選定。跨層(未選廠牌直接打車型)時 brand 由字典回填 ⇒ 一律同時給 brand+model。
   *  🔴 刻意不留 `(name: string)` 舊簽章:留著的話跨廠牌選取會在呼叫端的 `if (!sel) return` 靜默沒作用。 */
  onPickModel: (pick: { brand: string; model: string }) => void;
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
  // 未選廠牌時車型欄跨層搜尋(打 r6 直達車款),選定同時補上廠牌 —— 與 CascadeFilterTop
  // 共用同一顆 lib/vehicle-options(A5,不建立第二套車款比對邏輯)。
  // ⚠️ 申報一個順帶的行為變動(R1 nit):`brand 有值但不在字典`(字典改名/下架後,購物車
  //   `startEdit` 從既存 cart 值回填 sel 即可達)這個狀態,舊行為=車型欄空清單、使用者卡死;
  //   新行為=`modelFieldOptions` 找不到該 brand ⇒ 回跨層全清單,選取會把那個壞廠牌換掉。
  //   新行為較好(給得出路),但它不是本片的目標、是 modelFieldOptions 語意帶進來的,故明寫。
  const { crossLayer, options: modelOptions } = modelFieldOptions(
    motoBrands,
    vehicle?.brand ?? null,
  );

  return (
    <>
      <Combo
        label="選擇廠牌"
        value={vehicle?.brand ?? null}
        options={motoBrands.map((b) => b.name)}
        placeholder="選擇或輸入廠牌"
        onPick={onPickBrand}
        onClear={onClearBrand}
        variant={variant}
        slotLabel="廠牌"
      />
      <Combo
        label="選擇車型"
        value={vehicle?.model ?? null}
        options={modelOptions}
        /* Sean 2026-08-06 拍板 B(車型欄 placeholder 議題):三個掛載點(finder / PDP / 購物車)
           改與 `/products` 桌機選車列(CascadeFilterTop)一致 —— 跨層時附例字。
           OD `vehicle-picker-design.html` A 表對 finder 逐字寫的 `選擇或輸入車型`(不含例字)
           本身已是 OD 稿的債:與此拍板不符,已記入回饋包待 OD 更新,不是站上偏離。 */
        placeholder={crossLayer ? '選擇或輸入車型，例:R6' : '選擇或輸入車型'}
        emptyHint={crossLayer ? '查無符合的車款，請調整關鍵字' : undefined}
        onPick={(picked) => {
          const resolved = resolveModelPick(motoBrands, vehicle?.brand ?? null, picked);
          if (resolved) onPickModel(resolved);
        }}
        onClear={onClearModel}
        variant={variant}
        slotLabel="車型 · 可不選"
      />
      <Combo
        label="選擇年份"
        value={vehicle?.year != null ? String(vehicle.year) : null}
        options={years.map((y) => String(y))}
        disabled={!vehicle || vehicle.model == null || modelNoYears}
        placeholder={modelNoYears ? '不限年份' : '選擇或輸入年份'}
        onPick={(name) => onPickYear(Number(name))}
        onClear={onClearYear}
        variant={variant}
        slotLabel="年份 · 可不選"
      />
    </>
  );
}
