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
//
// A9(2026-08-05,選車引擎統一 B′):升為**全站唯一** chips 元件(A 表條 6:4 份 JSX → 1 份)。
//   ① 加互斥的 `onApply` 出口 —— 首頁/PDP/購物車沒有 cascade reducer,不是 drop-in(spec §4-1)。
//   ② 副註「點一下直接套用」推廣到四個掛載點(原本只有手機面板有)。
//   ③ 零命中句三版收一版、不再寫「上方/下方」。
//   🔴 `resolveGarageChip` / `resolveSuggestionLabel` 的決策腦與年份閘門**完全不動**
//      (spec §1c:不得複製第二份)。

import { useState } from 'react';
import type { Dispatch, ReactNode } from 'react';
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

/** chips 所需的車庫最小面(序列化收窄、與首頁 page.tsx 同一投影;無 engine/km/mods/PII)。
 *  V-2h/MF-5:加 isPrimary(spec §2 自動預填選唯一/主車;純 boolean 旗標、無 PII)。 */
export type GarageChipItem = Pick<
  CustomerVehicle,
  'id' | 'name' | 'year' | 'dictBrandName' | 'dictModelName' | 'isPrimary'
>;

type GarageChipsBase = {
  garage: GarageChipItem[];
  motoBrands: MockMotoBrand[];
  /** top=桌機 CascadeFilterTop 旁;drawer=手機 FilterDrawer 車輛 tab 內;
   *  sheet=ADR-0007 手機選車面板頂部(無 toggle、卡片直接展開、一點即套用);
   *  inline=A10 設計稿 §B 行內密度(首頁 finder / PDP §7 / 購物車)。
   *  🔴 inline 與 sheet 同樣**恆展開、無 toggle** —— 三個掛載點原本的自刻 chips 就是恆顯示,
   *     若讓它走 toggle,等於把本來看得到的愛車藏起來 = 使用者可見退化。 */
  variant: 'top' | 'drawer' | 'sheet' | 'inline';
  /** 套用成功後通知宿主(ADR-0007 手機決定 2:點愛車 = 直接套用並關閉選車面板)。 */
  onApplied?: () => void;
  /** A10c:零命中時改由宿主渲染出口(收到的是車庫車名原字面 = `resolveGarageChip` 的 query)。
   *  🔴 為什麼要這個口:購物車的零命中**不是一句話、是一個動作** ——
   *     「以自由輸入記下『X』(下單後人工確認)」把對不到字典的車庫車照原樣記進 CartItem。
   *     那是購物車語境專屬的能力(計畫 §2.7 紅字:這顆留在 CartVehicleField),
   *     GarageChips 沒有「自由輸入」這個概念,硬塞進來就是把購物車的資料模型漏進共用元件。
   *  不傳 = 出 A 表定版的那句話(首頁 / PDP / 目錄三處)。 */
  renderNoMatch?: (query: string) => ReactNode;
};

/** A9(spec §4-1 點名的最大一顆地雷):目錄兩處吃 cascade `dispatch`,首頁/PDP/購物車不是 ——
 *  首頁是 local `useState`、PDP 走 `commit()`、購物車走 `commitDict()`。所以出口做成**互斥**的
 *  兩種:給 `dispatch`(維持現行三連發,目錄兩處零改動)或給 `onApply`(自己決定怎麼套用)。
 *  🔴 互斥寫在型別上、不是寫在註解裡 —— `onApply?: never` 讓「兩個都傳」當場編譯錯,
 *     否則這條約束只是一句沒有守門的話。 */
type GarageChipsProps = GarageChipsBase &
  (
    | { dispatch: Dispatch<CascadeFilterAction>; onApply?: never }
    | { dispatch?: never; onApply: (apply: GarageChipApply) => void }
  );

export function GarageChips({
  garage,
  motoBrands,
  dispatch,
  variant,
  onApplied,
  onApply,
  renderNoMatch,
}: GarageChipsProps) {
  const [open, setOpen] = useState(false);
  // sheet 變體(ADR-0007):Sean 拍板「面板頂部**先顯示**我的愛車卡片」⇒ 恆展開、無 toggle。
  // inline 變體(A10):首頁/PDP/購物車三處原本的自刻 chips 本來就恆顯示,同樣不套 toggle。
  const alwaysOpen = variant === 'sheet' || variant === 'inline';
  const [suggest, setSuggest] = useState<{
    query: string;
    entries: string[];
    garageYear: number | undefined;
  } | null>(null);

  // 未登入/讀取失敗 → 整個鈕不顯示(閘與首頁 VehicleFinder 一致)。
  if (garage.length === 0) return null;

  const applyResolved = (a: GarageChipApply) => {
    if (onApply) {
      // 宿主自己的套用出口(首頁 setVehicle / PDP commit / 購物車 commitDict)。
      // 🔴 走這條就**完全不 dispatch** —— 那些宿主根本沒有 cascade reducer。
      onApply(a);
    } else {
      // brand→model→year 三連發(reducer 順序處理、前一 dispatch 已立 state;與 CascadeFilterTop/
      // FilterDrawerVehicleTab 既有三連發同款)。year 缺(閘門未過)不 dispatch=不限年份。
      // 型別上 dispatch 與 onApply 互斥 ⇒ 走到這裡 dispatch 必存在。
      dispatch!(selectVehicleBrand(a.brand));
      dispatch!(selectVehicleModel(a.model));
      if (a.year !== undefined) dispatch!(selectVehicleYear(a.year));
    }
    setOpen(false);
    setSuggest(null);
    onApplied?.();
  };

  const onChip = (g: GarageChipItem) => {
    const result = resolveGarageChip(motoBrands, g);
    if (result.kind === 'apply') {
      applyResolved(result);
    } else {
      setSuggest({ query: result.query, entries: result.entries, garageYear: result.garageYear });
    }
  };

  const onPickSuggestion = (label: string, garageYear: number | undefined) => {
    const applied = resolveSuggestionLabel(motoBrands, label, garageYear);
    if (applied) applyResolved(applied);
  };

  return (
    <div className={`cat-garage cat-garage--${variant}`}>
      {alwaysOpen ? (
        <div className="cat-garage-heading">
          <span>我的愛車</span>
          <small>點一下直接套用</small>
        </div>
      ) : (
        <button
          type="button"
          className="cat-garage-toggle"
          aria-expanded={open}
          onClick={() => {
            setOpen((o) => !o);
            setSuggest(null);
          }}
        >
          {/* 原為汽車 path,2026-08-07 Sean 拍板 Q2=A:機車零件站的選車/愛車圖示統一用重機;
              path 複用 MobileTabBar「找車」那支。strokeWidth="1.8" 是本區既有慣例、不動,
              只用 <g> 承接讓四個子圖形共用同一組線條屬性。 */}
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <g strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
              <circle cx="6" cy="17" r="3" />
              <circle cx="18" cy="17" r="3" />
              <path d="M6 17h8l-2-6h-3L6 17Z" />
              <path d="m14 11 1-3h3" />
            </g>
          </svg>
          <span>我的愛車</span>
        </button>
      )}
      {(open || alwaysOpen) && (
        <div className="cat-garage-panel">
          {/* A9(A 表條 6):副註「點一下直接套用」原本只有手機面板有,推廣到四個掛載點。
              toggle 變體的鈕本身是收合入口(字面不動),副註掛在展開後的面板頂 ——
              設計稿 §B 的「行內密度(首頁 / PDP §7 / 購物車 / 桌機面板)」就是這個位置。 */}
          {!alwaysOpen && (
            <div className="cat-garage-heading">
              <span>我的愛車</span>
              <small>點一下直接套用</small>
            </div>
          )}
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
            /* 🔴 零命中時容器內一個 `option` 都沒有 ⇒ 不掛 listbox role
                (掛了就是對報讀器宣稱「這裡有選項清單」然後給空的;
                 購物車的零命中出口是一顆按鈕,放進空 listbox 更糟)。 */
            <div
              className="cat-garage-suggest"
              {...(suggest.entries.length > 0
                ? { role: 'listbox' as const, 'aria-label': '車款建議清單' }
                : {})}
            >
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
                renderNoMatch ? (
                  renderNoMatch(suggest.query)
                ) : (
                  <span className="cat-garage-suggest-label">
                    {/* A9(A 表條 7):零命中句原本三版並存 —— 目錄「請用上方車款選單選擇」、
                        首頁「請從下方選單選擇」、PDP「請用下方選單選擇」。三版收一版,
                        且不再寫「上方/下方」(同一句話要掛在四個位置不同的掛載點上)。 */}
                    無法對應「{suggest.query}」到車款字典，請改用車款選單選擇
                  </span>
                )
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
