'use client';

// GarageChips.tsx — 型錄「我的愛車」鈕(V-1e;Sean 07-15 V-1d 驗收時直接提)。
// Sean 逐字:「商品目錄的車款篩選旁邊有一個按鈕『我的愛車』,點一下會多自己設定的車款膠囊
// 選擇,功能一樣同首頁可以自動帶入。」= Q4 全站五掛載點同元件同 context 連動的型錄掛載點補齊。
//
// 決策腦=lib/garage-chip.resolveGarageChip(與首頁 VehicleFinder 共用單一來源、不複製第二份):
//   dict 精確 lookup 快路徑 → REQUIRED-2 唯一精確命中 → 多/零命中建議清單;年份閘門收在純函式。
// apply → dispatch 進 cascade reducer(brand→model→year 三連發;year 缺不 dispatch),既有
//   useVehicleUrlSync 負責下推 DB 重查——與桌機 VehicleSelect 選車同一路徑、零新過濾邏輯。
// 桌機掛 CascadeFilterTop(.cft-right)、手機掛 FilterDrawerVehicleTab;同一元件、外殼依 variant
//   變形(值班台 plan verdict:統一=共用核心、外殼依掛載點變形)。
// 🔴 未登入/讀取失敗 → garage=[] → 整個鈕不顯示(garage.length>0 閘,兩掛載點皆守)。

import { useState } from 'react';
import type { Dispatch } from 'react';
import {
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  type CascadeFilterAction,
} from '@pcm/ui';
import type { CustomerVehicle } from '@pcm/domain';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import {
  resolveGarageChip,
  resolveSuggestionLabel,
  type GarageChipApply,
} from '@/lib/garage-chip';

/** chips 所需的車庫最小面(序列化收窄、與首頁 page.tsx 同一投影;無 engine/km/mods/PII)。 */
export type GarageChipItem = Pick<
  CustomerVehicle,
  'id' | 'name' | 'year' | 'dictBrandName' | 'dictModelName'
>;

export function GarageChips({
  garage,
  motoBrands,
  dispatch,
  variant,
}: {
  garage: GarageChipItem[];
  motoBrands: MockMotoBrand[];
  dispatch: Dispatch<CascadeFilterAction>;
  /** top=桌機 CascadeFilterTop 旁;drawer=手機 FilterDrawer 車輛 tab 內 */
  variant: 'top' | 'drawer';
}) {
  const [open, setOpen] = useState(false);
  const [suggest, setSuggest] = useState<{
    query: string;
    entries: string[];
    garageYear: number | undefined;
  } | null>(null);

  // 未登入/讀取失敗 → 整個鈕不顯示(閘與首頁 VehicleFinder 一致)。
  if (garage.length === 0) return null;

  const applyToCascade = (a: GarageChipApply) => {
    // brand→model→year 三連發(reducer 順序處理、前一 dispatch 已立 state;與 CascadeFilterTop/
    // FilterDrawerVehicleTab 既有三連發同款)。year 缺(閘門未過)不 dispatch=不限年份。
    dispatch(selectVehicleBrand(a.brand));
    dispatch(selectVehicleModel(a.model));
    if (a.year !== undefined) dispatch(selectVehicleYear(a.year));
    setOpen(false);
    setSuggest(null);
  };

  const onChip = (g: GarageChipItem) => {
    const result = resolveGarageChip(motoBrands, g);
    if (result.kind === 'apply') {
      applyToCascade(result);
    } else {
      setSuggest({ query: result.query, entries: result.entries, garageYear: result.garageYear });
    }
  };

  const onPickSuggestion = (label: string, garageYear: number | undefined) => {
    const applied = resolveSuggestionLabel(motoBrands, label, garageYear);
    if (applied) applyToCascade(applied);
  };

  return (
    <div className={`cat-garage cat-garage--${variant}`}>
      <button
        type="button"
        className="cat-garage-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setSuggest(null);
        }}
      >
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 13l2-7h14l2 7M5 13h14M5 13v5a1 1 0 001 1h2a1 1 0 001-1v-1h6v1a1 1 0 001 1h2a1 1 0 001-1v-5" />
        </svg>
        <span>我的愛車</span>
      </button>
      {open && (
        <div className="cat-garage-panel">
          <div className="cat-garage-chips">
            {garage.map((g) => (
              <button
                key={g.id}
                type="button"
                className="cat-garage-chip"
                onClick={() => onChip(g)}
              >
                {[g.year, g.name].filter(Boolean).join(' ')}
              </button>
            ))}
          </div>
          {suggest && (
            <div className="cat-garage-suggest" role="listbox" aria-label="車款建議清單">
              {suggest.entries.length > 0 ? (
                <>
                  <span className="cat-garage-suggest-label">「{suggest.query}」可能是:</span>
                  {suggest.entries.map((label) => (
                    <button
                      key={label}
                      type="button"
                      className="cat-garage-chip"
                      role="option"
                      aria-selected={false}
                      onClick={() => onPickSuggestion(label, suggest.garageYear)}
                    >
                      {label}
                    </button>
                  ))}
                </>
              ) : (
                <span className="cat-garage-suggest-label">
                  無法對應「{suggest.query}」到車款字典,請用上方車款選單選擇
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
