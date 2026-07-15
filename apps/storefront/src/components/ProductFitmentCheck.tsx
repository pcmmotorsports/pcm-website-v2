'use client';

// ProductFitmentCheck.tsx — 商品頁「是否適用我的車」§7 保守適用比對(V-2b;掛 ProductFitments 段首)。
// 讀全站選車 context(vehicle-context;首頁/型錄選車寫入=§6 全站連動)→ checkFitment(product.fitments,…)
// 顯四態:match「✓ 適用」/ no-match「✗ 未列」+ 聯絡 / qualified「請確認年份」/ undetermined 不判定。
// 無 context 車款 → 現選入口(愛車快選 chips + VehicleSelect;選定寫 context=全站連動)。
//
// 🔴 §7 正確性紅線(錯誤 ✓ 比空白更糟):判定一律走 lib/fitment-match.checkFitment(domain
// matchFitmentYear/isYearUnrestricted 年份單一來源+slugify 同源橋接);車種鐵律零猜。display-only:
// 不寫庫、不擋加入購物車。context.brandId/modelId=taxonomy slug(與 slugify(fitment) 同空間、by
// construction 一致);picker 選定用 slugify(name) 組 context slug(等於 taxonomy id)。

import { useEffect, useState } from 'react';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { UIFitment } from '@/data/mock-products';
import { checkFitment, type FitmentCheckStatus, type FitmentCheckVehicle } from '@/lib/fitment-match';
import { readVehicleContext, writeVehicleContext } from '@/lib/vehicle-context';
import { slugify } from '@/lib/vehicle-taxonomy';
import { resolveGarageChip, resolveSuggestionLabel } from '@/lib/garage-chip';
import { vehicleLabel } from '@/lib/vehicle-match';
import { VehicleSelect } from './VehicleSelect';
import type { GarageChipItem } from './GarageChips';

/** context/picker 選定的車款(顯示名 + slug + 年;供比對與顯示) */
type Chosen = { brandName: string; modelName: string; year?: number };

/** V-2c:URL `?vehicle=` 解析後的名稱字面(route 端 parseVehicleFromUrl 對照 taxonomy 解出)。 */
export type PdpUrlVehicle = { brandName: string; modelName?: string; year?: number };

function toCheckVehicle(c: Chosen): FitmentCheckVehicle {
  return { kind: 'dict', brandId: slugify(c.brandName), modelId: slugify(c.modelName), year: c.year };
}
function chosenLabel(c: Chosen): string {
  return [c.year, vehicleLabel(c.brandName, c.modelName)].filter(Boolean).join(' ');
}

export function ProductFitmentCheck({
  fitments,
  motoBrands,
  garage = [],
  urlVehicle = null,
}: {
  fitments: UIFitment[];
  motoBrands: MockMotoBrand[];
  garage?: GarageChipItem[];
  /** V-2c:URL `?vehicle=` 恆為第一真相 — 有值時優先於 context 鏡、掛載即回寫同步鏡。 */
  urlVehicle?: PdpUrlVehicle | null;
}) {
  // V-2c:初始 chosen 優先序=URL vehicle > context 鏡(useState initializer 讀 prop、SSR 同繪零分歧;
  // 鏡只能在 client effect 讀)。URL 車款名稱齊(brand+model)才可判定;brand-only 走現選入口。
  const [chosen, setChosen] = useState<Chosen | null>(() =>
    urlVehicle?.modelName
      ? { brandName: urlVehicle.brandName, modelName: urlVehicle.modelName, year: urlVehicle.year }
      : null,
  );
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState<{ brand: string; model?: string; year?: number } | null>(null);
  const [suggest, setSuggest] = useState<{ entries: string[]; garageYear: number | undefined } | null>(null);
  // V-2d③(Sean 07-15 真機:「手機放直的很不好看」):手機預設收合=單顆入口鈕+愛車 chips 在前,
  // 點開才展三層選單(CSS ≤1023px 生效;桌機恆展開、.pfc-expand 不顯)。§7 判定/文案四態零動、只動殼。
  const [pickerOpen, setPickerOpen] = useState(false);

  // V-2c mount:URL `?vehicle=` 恆第一真相 —
  // - 有 URL vehicle → 不讀鏡(過期鏡=Sean 07-15 實測「顯上一台車」bug 本體)、掛載即
  //   writeVehicleContext 回寫同步(brand-only 也寫=鏡恆跟隨;banner/addToCart 讀到同源、不再分家。
  //   名稱不齊時兩消費端本就零猜不動作)。冪等:重進同 URL 重寫同值無害。
  // - 無 URL vehicle → 照舊讀鏡(REQUIRED-3 防禦讀取;名稱字面欄齊全才判定=零猜)→ 再無 → 現選入口。
  // mount-only:urlVehicle 為 server 每繪新物件,若列 deps、重繪會把使用者「更改車款」後的選擇/鏡
  // 蓋回 URL 車款(鏡與 banner 分家)→ 依 react-nextjs-rules.md mount-only 合法寫法 disable。
  useEffect(() => {
    if (urlVehicle) {
      writeVehicleContext({
        brandId: slugify(urlVehicle.brandName),
        modelId: urlVehicle.modelName ? slugify(urlVehicle.modelName) : undefined,
        year: urlVehicle.year,
        label: [urlVehicle.brandName, urlVehicle.modelName, urlVehicle.year].filter(Boolean).join(' '),
        brandName: urlVehicle.brandName,
        modelName: urlVehicle.modelName,
      });
      return;
    }
    const ctx = readVehicleContext();
    if (ctx && ctx.brandName && ctx.modelName) {
      setChosen({ brandName: ctx.brandName, modelName: ctx.modelName, year: ctx.year });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 無 fitments(通用款/無資料)→ 整段不渲染(同 ProductFitments 空狀態)
  if (!fitments || fitments.length === 0) return null;

  const commit = (c: Chosen) => {
    setChosen(c);
    setEditing(false);
    setSuggest(null);
    setSel(null);
    setPickerOpen(false); // 下次進 picker(更改以外路徑)回收合預設

    // 寫 context=全站連動(brandId/modelId 用 slugify(name)=taxonomy slug 空間;附名稱字面欄)
    writeVehicleContext({
      brandId: slugify(c.brandName),
      modelId: slugify(c.modelName),
      year: c.year,
      label: chosenLabel(c),
      brandName: c.brandName,
      modelName: c.modelName,
    });
  };

  const onGarageChip = (g: GarageChipItem) => {
    const r = resolveGarageChip(motoBrands, g);
    if (r.kind === 'apply') commit({ brandName: r.brand, modelName: r.model, year: r.year });
    else setSuggest({ entries: r.entries, garageYear: r.garageYear });
  };

  const status: FitmentCheckStatus | null = chosen ? checkFitment(fitments, toCheckVehicle(chosen)) : null;

  return (
    <div className="pfc">
      {chosen && !editing ? (
        <div className={`pfc-result pfc-${status}`} role="status">
          <span className="pfc-badge" aria-hidden="true">
            {status === 'match' ? '✓' : status === 'no-match' ? '✗' : '?'}
          </span>
          <div className="pfc-msg">
            {status === 'match' && <><b>適用你的 {chosenLabel(chosen)}</b></>}
            {status === 'no-match' && (
              <>
                <b>{chosenLabel(chosen)} 未列於適用清單</b>
                <span className="pfc-sub">不確定?<a href="/info/shipping">聯絡我們確認</a></span>
              </>
            )}
            {status === 'qualified' && (
              <>
                <b>此商品適用 {vehicleLabel(chosen.brandName, chosen.modelName)},但有年份限制</b>
                <span className="pfc-sub">請確認你的年份是否在下方適用車款表範圍內</span>
              </>
            )}
            {status === 'undetermined' && (
              <>
                <b>已記下你的車款</b>
                <span className="pfc-sub">下單後我們會人工為你確認是否適用</span>
              </>
            )}
          </div>
          {/* 更改車款=明確要改 → 直接展開選單(V-2d③ 收合入口只擋首見的高牆) */}
          <button type="button" className="pfc-link" onClick={() => { setSel(null); setSuggest(null); setPickerOpen(true); setEditing(true); }}>更改車款</button>
        </div>
      ) : (
        <div className={`pfc-picker${pickerOpen ? ' pfc-picker-open' : ''}`}>
          <div className="pfc-picker-label">確認是否適用你的車</div>
          {garage.length > 0 && (
            <div className="pfc-garage">
              <span className="pfc-garage-label">我的愛車</span>
              {garage.map((g) => (
                <button key={g.id} type="button" className="cat-garage-chip" onClick={() => onGarageChip(g)}>
                  {[g.year, g.name].filter(Boolean).join(' ')}
                </button>
              ))}
            </div>
          )}
          {suggest && (
            <div className="pfc-garage" role="listbox" aria-label="車款建議清單">
              {suggest.entries.length > 0 ? (
                suggest.entries.map((label) => (
                  <button key={label} type="button" className="cat-garage-chip" role="option" aria-selected={false}
                    onClick={() => {
                      const a = resolveSuggestionLabel(motoBrands, label, suggest.garageYear);
                      if (a) commit({ brandName: a.brand, modelName: a.model, year: a.year });
                    }}>
                    {label}
                  </button>
                ))
              ) : (
                <span className="pfc-sub">無法對應此車款,請用下方選單選擇</span>
              )}
            </div>
          )}
          {/* V-2d③ 手機收合入口(≤1023px 未展開才顯、桌機 CSS 藏);點開展下方三層選單 */}
          <button type="button" className="pfc-expand" onClick={() => setPickerOpen(true)}>
            選擇車款,確認是否適用
          </button>
          <div className="pfc-select">
            <VehicleSelect
              motoBrands={motoBrands}
              vehicle={sel}
              onPickBrand={(name) => setSel({ brand: name })}
              onPickModel={(name) => {
                if (!sel) return;
                setSel({ brand: sel.brand, model: name });
                commit({ brandName: sel.brand, modelName: name }); // 選到車型即比對(年份可後補)
              }}
              onPickYear={(year) => {
                if (!sel?.model) return;
                setSel({ ...sel, year });
                commit({ brandName: sel.brand, modelName: sel.model, year });
              }}
              onClearBrand={() => setSel(null)}
              onClearModel={() => setSel((v) => (v ? { brand: v.brand } : v))}
              onClearYear={() => setSel((v) => (v ? { brand: v.brand, model: v.model } : v))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
