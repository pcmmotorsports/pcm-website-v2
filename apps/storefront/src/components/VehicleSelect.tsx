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

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import { filterVehicleOptions, uniqueExactMatch } from '@/lib/vehicle-match';
import { modelFieldOptions, resolveModelPick } from '@/lib/vehicle-options';

/** 🔴 零命中提示四句 —— **全站選車欄位的單一真相**。
 *  Sean 2026-08-07 拍板 Q6=A:Q4=B 之後「打了查無的字、blur 也不清掉」,但重新 focus 時
 *  `listOpen` 需要 `list.length > 0`、提示則需要掛載點有傳 `emptyHint` ⇒ 沒傳的格子是
 *  「留了字卻沒留出路」:畫面只剩自己打的那串字,無清單、無提示。拍板字面是**復用既有句、不寫新句**。
 *  ⚠️ 查證後才發現:`CascadeFilterTop`(桌機選車列,註解逐字「A 表要求三欄同式」)與
 *  `MobileVehicleSheet`(手機面板)**三欄本來就都傳了**,沒跟上的是 `VehicleSelect`(finder / PDP /
 *  購物車)與 `InlineVehicleForm`(車庫表單)⇒ Q6=A 等於「把漏的兩個補齊」,一個新字都不用寫。
 *  🔴 合併前這四句是**逐檔硬編**的,分佈我連錯兩次(第一次說「三句三檔」、第二次說「兩檔」)——
 *  正解是 `車款` 那句 **4 檔**、`廠牌/車型/年份` 三句 **3 檔**,第四檔是 `FilterDrawerVehicleTab`
 *  (它不走 VehicleCombo、自己畫 `.fd-veh-empty`,兩次 grep 都被我漏掉)。
 *  ⇒ 現在**四個檔全部吃這個常數**,敘述不必再靠人數對:改文案只有這一處。 */
export const VEHICLE_EMPTY_HINTS = {
  brand: '查無符合的廠牌，請調整關鍵字',
  /** 跨層(還沒選廠牌、可直接打車型名)時搜的是「車款」而非某廠牌底下的「車型」 */
  modelCrossLayer: '查無符合的車款，請調整關鍵字',
  model: '查無符合的車型，請調整關鍵字',
  year: '查無符合的年份，請調整關鍵字',
} as const;

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
  /** Q8=A(Sean 2026-08-07):把「客人打了什麼但還沒選中」回報給外層。
   *  🔴 為何需要:`text` 是本元件內部 state,父層看不到 ⇒ 「清除」鈕算不出畫面上還有沒有字、
   *  切換輸入模式時也接不住那串字。不傳=行為零變動(既有掛載點不需改)。
   *  ⚠️ 契約:**元件卸載時不會回報** —— 卸載後父層手上仍是最後一次回報的字。條件渲染本元件
   *  的掛載點要自己在卸載那條路上清掉自己的 state(手機面板是顯式 `setDraftText(EMPTY_TEXT)`,
   *  車庫表單是 remount 後由 mount effect 補報 `''`)。 */
  onDraftTextChange?: (text: string) => void;
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
  onDraftTextChange,
}: ComboProps) {
  const [text, setText] = useState<string | null>(null); // null=未編輯(顯 value)
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  // Q8=A:回報 callback 收進 ref —— `changeText` 的 identity 因此恆定,下面那道
  // `useEffect([value, changeText])` 才能把它正常列進 deps,不必掛 exhaustive-deps 抑制。
  // 🔴 為何不直接 `useEffect([text, onDraftTextChange])` 自動回報:掛載點傳的是 inline arrow
  //    (每 render 新 identity),而 `setDraftText(c => ({ ...c, brand: t }))` 恆產生新物件、
  //    React 不會 bail out ⇒ 無限 render 迴圈。這條路封死,別當成「更乾淨的寫法」改回去。
  const reportRef = useRef(onDraftTextChange);
  useEffect(() => {
    reportRef.current = onDraftTextChange;
  }, [onDraftTextChange]);
  const changeText = useCallback((next: string | null) => {
    setText(next);
    reportRef.current?.(next ?? '');
  }, []);
  // 🔴 Q7=A 的守門畫在**不變量的面**,不是只畫在 `commit()`。
  //    不變量(⚠️ 只在**穩定態**成立,審查 N1):blur 之後、或 `value` 變動之後,
  //    `text` 與 `value` 不得同時非空且相異。**正在打字的當下不算** —— 已選 Yamaha 又輸入 `kawa`
  //    尚未 blur 時本來就相異,那是編輯態、不是矛盾。照「任何時刻都不得相異」補守門會擋掉正常編輯。
  //    只在 blur 當下比對 `value` 不夠 —— `value` 會從**外部**變動,而那些路徑不經過 `commit()`:
  //    ① 跨層在車型欄選一台別廠牌的車 ⇒ `resolveModelPick` 回填廠牌(`lib/vehicle-options.ts`),
  //       廠牌欄的 `value` 就這樣被改掉、草稿卻還留著(**實測可達**:打 `kawa` → blur →
  //       跨層選 `Kawasaki Z900` ⇒ 欄位顯示 `kawa`、已選卻是 `Kawasaki`。
  //       ⚠️ 跨層的選項字面是「品牌 車型」label、**不是裸車型名** —— 我第一次寫探針打了裸 `Z900`,
  //       沒命中、`onPickModel` 根本沒被呼叫,那次的「紅」是前提沒成立而不是抓到 bug。)
  //    ② `GarageChips` 一鍵套用愛車、③ URL 同步 —— 都直接 dispatch 進 cascade。
  //    ⇒ `value` 一變就丟掉過期草稿。
  //    ⚠️ 這**不會**吃掉 Q4=B 的留字:打字只動 `text`、不動 `value`;跨層草稿留在車型欄時去選廠牌,
  //       動到的是**廠牌欄**的 `value`、車型欄的 `value` 仍是 null ⇒ 車型草稿照樣留著(有守門盯)。
  useEffect(() => {
    changeText(null);
    // 審查 N3:`value` 從外部變動時欄位可能仍聚焦且清單開著 —— 草稿清掉後查詢字串變空、
    //   清單會瞬間攤成全清單,而 `hi` 還停在舊的篩選結果索引上
    //   ⇒ `aria-activedescendant` 可能指向不存在的 option id。一併收掉。
    setOpen(false);
    setHi(0);
  }, [value, changeText]);
  // 🔴 債③(2026-08-07):`disabled` 轉 true = 這欄現在無效 ⇒ 丟掉草稿。與上面那道
  //    「`value` 外部變動就丟」是同一類事件、不變量的另一個面 —— 而上面那道**蓋不到**這格:
  //    車型欄停用時它自己的 `value` 是 `null → null`、deps 沒變(這就是債③ 的機制本身)。
  //    不用顯示層 `shown = disabled ? …` 遮字:內部 `text` 與父層 `draftText` 仍握著幽靈字,
  //    下游「改用自行輸入」照樣把它組進車名。要真的丟掉。
  //    ⚠️ 不吃 Q4=B 留字:欄位停用 ⟺ 它的選項空間整份換掉(車型停用=廠牌被清、年份停用=車型沒選)。
  //    ⚠️ `if (disabled)` 的判別力**靠回報次數**那條負測 —— 無條件版在每次「停用→啟用」會多噴一次
  //       `''`(值一樣、只有次數分得開)。完整論證與突變表在 manifest 的 VehicleFinder 條目。
  useEffect(() => {
    if (disabled) changeText(null);
  }, [disabled, changeText]);
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
    // ⚠️ `changeText(null)` **刻意排在 `onPick` 之前**(R4 跨模型輪指出這個順序是承重的、原本沒人寫):
    //    先回報草稿清空,父層才收到新 `value`。倒過來的話中間會有一拍「父層 draftText 還是舊字、
    //    value 已經是新的」—— 那一拍若被拿去組字面(如 InlineVehicleForm 的 composed),會組出
    //    「Yamaha kawa」這種半新半舊的字。目前沒有呼叫端在那一拍讀值 ⇒ 不是現行 bug;但收同族債
    //    ③④⑤⑥ 那片若讓 draftText 承擔更多職責,要先補一格突變把這個順序釘住。
    changeText(null);
    setOpen(false);
    // 重選同值=只關列表不 dispatch(code-reviewer R1:select-brand/model 同值會 cascade reset
    // 清下層;舊原生 select 選同項不觸發 change、此為行為等價守門)
    if (name !== value) onPick(name);
  };

  const commit = () => {
    setOpen(false);
    if (text === null) return;
    if (text.trim() === '') {
      changeText(null);
      if (value !== null) onClear();
      return;
    }
    const exact = uniqueExactMatch(options, text, (n) => n);
    if (exact !== null) {
      // 唯一精確命中 → 套用,並把草稿清掉讓顯示值回到 `value`(所見=已選)。
      changeText(null);
      if (exact !== value) onPick(exact);
      return;
    }
    // 🔴 **非唯一命中**(Sean 2026-08-07 Q4=B「不丟字」+ Q7=A「已選定的照舊還原」合成的兩段)。
    //    零猜鐵律在兩段裡都沒有鬆動:自始至終不 `onPick`、不半套,`value` 一個字沒動。

    // 【Q7=A】這欄**已經選定**了東西 → 還原成已選那個(畫面=事實)。
    //    為什麼不是一律留字:留字會讓欄位顯示草稿、而年份欄與 PDP 適用判定仍走舊的 `value`
    //    ⇒ 畫面說一套、系統算另一套。Sean 拍 Q4=B 的動機是「打了字滑開就無聲消失」,
    //    而「已經選好一台車、滑開後回到那台車」不是消失、是回到你選的東西 ⇒ 不在 Q4=B 要修的範圍。
    if (value !== null) {
      changeText(null);
      return;
    }

    // 【Q4=B】這欄**還沒選到任何東西** → 留字。客人看得到自己打了什麼,
    //    重新 focus 時:有命中就開清單明選;零命中則由 `emptyHint` 給出路(Q6=A 起三格全傳)。
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
      changeText(null);
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
          changeText(e.target.value);
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
        emptyHint={VEHICLE_EMPTY_HINTS.brand}
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
        emptyHint={crossLayer ? VEHICLE_EMPTY_HINTS.modelCrossLayer : VEHICLE_EMPTY_HINTS.model}
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
        emptyHint={VEHICLE_EMPTY_HINTS.year}
      />
    </>
  );
}
