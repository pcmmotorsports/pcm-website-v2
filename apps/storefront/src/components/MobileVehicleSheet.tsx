'use client';

// MobileVehicleSheet.tsx — 手機正式選車面板(ADR-0007 手機決定 1-6;2026-07-30 Sean 拍板)。
//
// 為什麼是新元件、不是把 FilterDrawerVehicleTab 改一改:
//   拍板後的手機選車是**獨立入口**(不再是「篩選」抽屜裡的一個 tab)、且是**草稿制**
//   ——「清除」只清輸入草稿、不取消背景已套用的車輛。FilterDrawerVehicleTab 是即時套用
//   (點年份當場 dispatch),兩種語意塞進同一個元件會長出「這次點擊到底算不算套用」的分支。
//
// 重用(不建立第二套車款比對邏輯 = 交接檔硬邊界):
//   - typeahead 引擎:VehicleCombo(lib/vehicle-match 的 prefix/substring + 唯一精確命中)
//   - 跨層直搜字面空間:lib/garage-chip.flattenVehicleModels(與愛車建議清單同一顆)
//   - 愛車決策腦:GarageChips variant="sheet"(內部仍是 resolveGarageChip)
//   - 套用:cascadeFilterReducer 的 brand→model→year 三連發(既有 useVehicleUrlSync 負責下推 DB)
//   - 年份排序:lib/vehicle-options.yearsNewestFirst(與桌機同一個定義點)
//
// V-1f 兩條既有能力刻意保留(交接檔:不得因換 UI 回歸):
//   ① 跨層直搜 —— 未選廠牌時直接在「車型」欄打 `r6`/`mt-09` 直達車款,選定同時補上廠牌。
//      🔴 這是本檔唯一與預覽 mock 不同的互動:預覽的車型欄在未選廠牌時是 disabled,
//      照搬會讓 Sean 07-15 自己提的「打 r6 直達」在手機上消失。
//   ② 無年份車型出口 —— 年份欄顯示「不限年份」、可直接套用(不 dispatch year)。
//
// A5(2026-08-05,選車引擎統一 B′):本檔是 A 表的**原型**,改動最小 ——
//   aria label 由裸名詞改成「選擇廠牌/車型/年份」(A 表:aria 統一「選擇 X」),
//   廠牌欄 emptyHint 的「品牌」殘留改「廠牌」。可見欄標(廠牌 / 車型 · 可不選)與
//   placeholder、跨層直搜、無年份出口**逐字不動** —— 全站規範就是照它寫的。
//   🔴 :170 那顆「清除」= 只清草稿(spec §4-2),不得被「清除車輛」的統一文案吃掉。

import { useEffect, useState, type Dispatch, type FocusEvent } from 'react';
import {
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  type CascadeFilterAction,
  type CascadeFilterState,
  type VehicleSelection,
} from '@pcm/ui';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import { modelFieldOptions, resolveModelPick, yearsNewestFirst } from '@/lib/vehicle-options';
import { VehicleCombo, VEHICLE_EMPTY_HINTS } from './VehicleSelect';
import { GarageChips, type GarageChipItem } from './GarageChips';

/** 面板內的未套用選擇。字典字面 + 已驗年份;null=該層未定。 */
type VehicleDraft = { brand: string | null; model: string | null; year: number | null };

const EMPTY_DRAFT: VehicleDraft = { brand: null, model: null, year: null };

function draftFromVehicle(vehicle: VehicleSelection | null): VehicleDraft {
  if (!vehicle) return EMPTY_DRAFT;
  return {
    brand: vehicle.brand,
    model: vehicle.model ?? null,
    year: vehicle.year ?? null,
  };
}

/** 聚焦後把作用中的欄位捲回可視範圍(ADR-0007 手機決定 4:鍵盤不遮欄位)。
 *  延遲=等手機鍵盤把 viewport 壓縮完再捲;立刻捲會被隨後的 resize 抵銷。 */
const KEYBOARD_SETTLE_MS = 160;

export function MobileVehicleSheet({
  open,
  onClose,
  motoBrands,
  cascade,
  dispatch,
  garage = [],
}: {
  open: boolean;
  onClose: () => void;
  motoBrands: MockMotoBrand[];
  cascade: CascadeFilterState;
  dispatch: Dispatch<CascadeFilterAction>;
  /** V-1e:登入會員愛車(未登入/讀取失敗=[] → 整區不顯示) */
  garage?: GarageChipItem[];
}) {
  // 草稿以「開面板當下已套用的車」為起點(= 預覽的 openVehicleSheet 語意:更換時看到目前的車)。
  // 🔴 用 useState initializer 而非 open→prefill 的 effect:宿主是「開才 mount」,initializer
  //    自然在每次開啟時跑一次;寫成 effect 就得掛 exhaustive-deps disable 去避免「面板開著時
  //    背景車變動把客人打到一半的草稿蓋掉」。
  const [draft, setDraft] = useState<VehicleDraft>(() => draftFromVehicle(cascade.vehicle));

  // 面板開著時鎖背景捲動(對齊 FilterDrawer 既有做法;同一時間只會有一個面板開著)。
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const brandEntry = draft.brand != null
    ? motoBrands.find((brand) => brand.name === draft.brand)
    : undefined;
  const modelEntry = draft.model != null
    ? brandEntry?.models.find((model) => model.name === draft.model)
    : undefined;
  const years = yearsNewestFirst(modelEntry);
  const modelHasNoYears = modelEntry !== undefined && years.length === 0;

  // V-1f ①:未選廠牌 → 車型欄改在「品牌 車型」攤平字面空間跨層搜尋(打 mt-09 直達車款)。
  // 🔴 與桌機選車列共用 lib/vehicle-options 的同一顆(2026-07-30 抽出;不建立第二套比對邏輯)。
  const { crossLayer, options: modelOptions } = modelFieldOptions(motoBrands, draft.brand);

  const hasDraft = draft.brand !== null || draft.model !== null || draft.year !== null;
  // Sean 2026-07-30 手機實測回饋:**選了廠牌就可以送出**,不必三欄全填。
  //   廠牌 → 看該廠牌全部商品 / 廠牌+車型 → 不限年份 / 三欄全填 → 最精確。
  // 🔴 這不是新語意:`cascadeFilterReducer` 的 vehicle 本來就允許只到某一層,桌機選車列也
  //   一直是「選一層就當場套用」(實測 `?vehicle=yamaha` → 2349 件);`products/page.tsx:57-59`
  //   逐字記載「品牌-only 車輛選擇由 client 同步寫短版 ?vehicle=brandId(單段)」= 早就支援。
  //   之前手機要求三欄全填,是我照預覽 mock 的 `canApplyVehicle` 抄來的、比正式站能力更嚴。
  const canApply = draft.brand !== null;

  const pickModelOption = (picked: string) => {
    const resolved = resolveModelPick(motoBrands, draft.brand, picked);
    if (!resolved) return;
    setDraft({ brand: resolved.brand, model: resolved.model, year: null });
  };

  const applyDraft = () => {
    // 逐層送出:每一層只有真的選了才 dispatch(層數 = URL `?vehicle=` 的段數 = server 查詢範圍)。
    // 🔴 reducer 的 select-model / select-year 在上層未選時是 no-op,但這裡仍逐層守 —— 依賴
    //    「reducer 會自己 no-op」等於把正確性寄託在別人的防禦式分支上。
    if (draft.brand === null) return;
    dispatch(selectVehicleBrand(draft.brand));
    if (draft.model !== null) dispatch(selectVehicleModel(draft.model));
    // 年份留空或該車型無年份 → 不 dispatch(= 不限年份;對齊 V-1f 與桌機 modelNoYears)
    if (draft.year !== null) dispatch(selectVehicleYear(draft.year));
    onClose();
  };

  // focus 事件在 React 會冒泡 ⇒ 掛在面板本體、不必動共用的 VehicleCombo。
  const onFieldFocus = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    window.setTimeout(() => {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, KEYBOARD_SETTLE_MS);
  };

  if (!open) return null;

  return (
    <>
      <div className="mvs-overlay" onClick={onClose} />
      <section className="mvs-sheet" role="dialog" aria-modal="true" aria-label="選擇適用車輛">
        <header className="mvs-head">
          <h2>選擇適用車輛</h2>
          <button type="button" className="mvs-close" onClick={onClose} aria-label="關閉選車面板">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="mvs-body" onFocus={onFieldFocus}>
          {/* ADR-0007 手機決定 2:頂部先顯示真實愛車、一點直接套用(未登入/空車庫不顯示) */}
          <GarageChips
            garage={garage}
            motoBrands={motoBrands}
            dispatch={dispatch}
            variant="sheet"
            onApplied={onClose}
          />

          {/* ADR-0007 手機決定 5:同列最右側「清除」= 只清草稿、不動已套用車輛 */}
          <div className="mvs-lead">
            <p>可直接選擇，也可輸入搜尋</p>
            <button
              type="button"
              className="mvs-clear-draft"
              aria-label="清除車輛輸入欄位"
              disabled={!hasDraft}
              onClick={() => setDraft(EMPTY_DRAFT)}
            >
              清除
            </button>
          </div>

          <div className="mvs-field">
            <span className="mvs-field-label">廠牌</span>
            <VehicleCombo
              label="選擇廠牌"
              value={draft.brand}
              options={motoBrands.map((brand) => brand.name)}
              placeholder="選擇或輸入廠牌"
              emptyHint={VEHICLE_EMPTY_HINTS.brand}
              onPick={(name) => setDraft({ brand: name, model: null, year: null })}
              onClear={() => setDraft(EMPTY_DRAFT)}
              variant="form"
            />
          </div>

          <div className="mvs-field">
            <span className="mvs-field-label">車型<small>可不選</small></span>
            <VehicleCombo
              label="選擇車型"
              value={draft.model}
              options={modelOptions}
              placeholder={crossLayer ? '選擇或輸入車型，例:R6' : '選擇或輸入車型'}
              emptyHint={crossLayer ? VEHICLE_EMPTY_HINTS.modelCrossLayer : VEHICLE_EMPTY_HINTS.model}
              onPick={pickModelOption}
              onClear={() => setDraft((current) => ({ ...current, model: null, year: null }))}
              variant="form"
            />
          </div>

          <div className="mvs-field">
            <span className="mvs-field-label">年份<small>可不選</small></span>
            <VehicleCombo
              label="選擇年份"
              value={draft.year != null ? String(draft.year) : null}
              options={years.map(String)}
              disabled={draft.model === null || modelHasNoYears}
              placeholder={
                modelHasNoYears ? '不限年份' : draft.model === null ? '請先選擇車型' : '選擇或輸入年份'
              }
              emptyHint={VEHICLE_EMPTY_HINTS.year}
              onPick={(year) => setDraft((current) => ({ ...current, year: Number(year) }))}
              onClear={() => setDraft((current) => ({ ...current, year: null }))}
              variant="form"
            />
          </div>
        </div>

        <footer className="mvs-foot">
          {/* 🔴 刻意不寫「查看 N 件適用商品」:套用**前**唯一能拿到的 N 是「目前(尚未按車過濾)
              的商品數」—— 本機正式資料實測 19037,而按下去的真實結果是 43。真正的 N 只有
              server 依 `?vehicle=` 重查後才知道。核准預覽裡的 161 之所以看起來合理,是因為
              那頁的假資料讓兩個數字剛好一致。寧可不給數字,也不給一個一按就被推翻的數字。 */}
          <button type="button" className="mvs-apply" disabled={!canApply} onClick={applyDraft}>
            查看適用商品
          </button>
        </footer>
      </section>
    </>
  );
}
