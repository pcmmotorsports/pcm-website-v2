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
}: {
  fitments: UIFitment[];
  motoBrands: MockMotoBrand[];
  garage?: GarageChipItem[];
}) {
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState<{ brand: string; model?: string; year?: number } | null>(null);
  const [suggest, setSuggest] = useState<{ entries: string[]; garageYear: number | undefined } | null>(null);

  // 讀全站 context(client;REQUIRED-3 防禦讀取)。名稱字面欄(V-2a additive)齊全才能判定=零猜;
  // 缺名稱欄(舊 context)→ 不自動判定、走現選入口。
  useEffect(() => {
    const ctx = readVehicleContext();
    if (ctx && ctx.brandName && ctx.modelName) {
      setChosen({ brandName: ctx.brandName, modelName: ctx.modelName, year: ctx.year });
    }
  }, []);

  // 無 fitments(通用款/無資料)→ 整段不渲染(同 ProductFitments 空狀態)
  if (!fitments || fitments.length === 0) return null;

  const commit = (c: Chosen) => {
    setChosen(c);
    setEditing(false);
    setSuggest(null);
    setSel(null);
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
          <button type="button" className="pfc-link" onClick={() => { setSel(null); setSuggest(null); setEditing(true); }}>更改車款</button>
        </div>
      ) : (
        <div className="pfc-picker">
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
