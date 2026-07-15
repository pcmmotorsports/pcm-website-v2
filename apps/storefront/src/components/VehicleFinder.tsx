// VehicleFinder.tsx — 佈局字面從 design-reference/components/HomePage.jsx @ 25d3a2a 搬
// (N°01 · 輸入你的車輛、brand → models → years 三層)
//
// design 用 window.PCM_DATA.motoBrands → S2/#220b 起改 props motoBrands(server 端
// fetchVehicleTaxonomy 從真 fitment 衍生、與 /products 解析端同一 id 空間)。
//
// V-1c(2026-07-15;Sean Q4 全站統一元件+愛車快選):
// - 三層原生 select → VehicleSelect 可打字 combobox(共用核心;typeahead=design 零先例
//   Sean 口述授權=manifest business_override typeaheadVehicleSelect;.ed-finder 佈局字面不動)。
// - 登入會員多一排「我的愛車」chips(garage props 由首頁 server 傳入;RLS own 資料、僅
//   name/year 顯示字面、無 PII 面):點擊=正規化後與字典精確比對——唯一命中直接套用;
//   多/零命中展開建議清單讓客人明選(REQUIRED-2;車庫 name=自由文字、零模糊零 AI 猜=車種鐵律)。
// - 搜尋 push 前寫 vehicle-context(sessionStorage 鏡;URL 恆第一真相、V-2 消費)。
// - 🔴 真資料 37/94 車型 fitment 缺年份 → 年份欄「不限年份」且可直接搜尋(push 不帶 year);
//   design 無此情境、真資料迫使的 graceful degradation、非視覺重設計。

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { CustomerVehicle } from '@pcm/domain';
import { VehicleSelect } from './VehicleSelect';
import { filterVehicleOptions, uniqueExactMatch } from '@/lib/vehicle-match';
import { writeVehicleContext } from '@/lib/vehicle-context';

type VehicleSel = { brand: string; model?: string; year?: number } | null;

/** 攤平字典:每車型一項(brand+model 名稱與 label;chips 比對/建議清單共用字典字面)。 */
function flattenModels(motoBrands: MockMotoBrand[]) {
  return motoBrands.flatMap((b) =>
    b.models.map((m) => ({ brand: b, model: m, label: `${b.name} ${m.name}` })),
  );
}

export function VehicleFinder({
  motoBrands,
  garage = [],
}: {
  motoBrands: MockMotoBrand[];
  /** 登入會員車庫(未登入/讀取失敗=[]、整排 chips 不顯示) */
  garage?: Pick<CustomerVehicle, 'id' | 'name' | 'year'>[];
}) {
  const router = useRouter();
  const [vehicle, setVehicle] = useState<VehicleSel>(null);
  /** 愛車 chip 多/零命中時的建議清單(null=收合;元素=字典 label 字面;garageYear 供明選後同閘門帶入) */
  const [suggest, setSuggest] = useState<{
    query: string;
    entries: string[];
    garageYear?: number;
  } | null>(null);

  const brandObj = vehicle ? motoBrands.find((b) => b.name === vehicle.brand) : undefined;
  const modelObj =
    vehicle?.model != null ? brandObj?.models.find((m) => m.name === vehicle.model) : undefined;
  const modelHasYears = (modelObj?.years.length ?? 0) > 0;
  const ready = !!brandObj && !!modelObj && (modelHasYears ? vehicle?.year != null : true);

  const applyEntry = (entry: { brand: MockMotoBrand; model: { name: string; years: number[] } }, garageYear?: number) => {
    const year =
      garageYear != null && entry.model.years.includes(garageYear) ? garageYear : undefined;
    setVehicle({ brand: entry.brand.name, model: entry.model.name, year });
    setSuggest(null);
  };

  const onGarageChip = (g: { name: string; year: string }) => {
    const entries = flattenModels(motoBrands);
    // 車庫 year=自由文字(domain 註:text input)→ 僅四位數字才嘗試帶入年份、其餘不猜
    const garageYear = /^\d{4}$/.test(g.year.trim()) ? Number(g.year.trim()) : undefined;
    // 唯一精確命中(正規化=trim/大小寫/全形半形)才自動套用:先比「品牌 車型」全名、再比車型名
    const exact =
      uniqueExactMatch(entries, g.name, (e) => e.label) ??
      uniqueExactMatch(entries, g.name, (e) => e.model.name);
    if (exact) {
      applyEntry(exact, garageYear);
      return;
    }
    // 多/零命中 → 建議清單(字典字面經正規化 substring 過濾;客人明選=零猜)
    const hits = filterVehicleOptions(entries, g.name, (e) => e.label);
    setSuggest({ query: g.name, entries: hits.slice(0, 12).map((e) => e.label), garageYear });
  };

  return (
    <section id="vehicle-finder" className="ed-finder">
      <div className="ed-finder-inner">
        <div className="ed-finder-head">
          <div className="ed-finder-label">
            <span className="ed-mono">01 ·</span>
            <span>輸入你的車輛</span>
          </div>
          <div className="ed-finder-hint">精準匹配車款、年份、引擎代號</div>
        </div>
        {garage.length > 0 && (
          <div className="ed-finder-garage">
            <span className="ed-finder-garage-label">我的愛車</span>
            {garage.map((g) => (
              <button
                key={g.id}
                type="button"
                className="ed-finder-garage-chip"
                onClick={() => onGarageChip(g)}
              >
                {[g.year, g.name].filter(Boolean).join(' ')}
              </button>
            ))}
          </div>
        )}
        {suggest && (
          <div className="ed-finder-suggest" role="listbox" aria-label="車款建議清單">
            {suggest.entries.length > 0 ? (
              <>
                <span className="ed-finder-suggest-label">「{suggest.query}」可能是:</span>
                {suggest.entries.map((label) => (
                  <button
                    key={label}
                    type="button"
                    className="ed-finder-garage-chip"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      const entry = flattenModels(motoBrands).find((e) => e.label === label);
                      // 明選後車庫年份同閘門帶入(四位數字+在字典年份內才帶;code-reviewer minor)
                      if (entry) applyEntry(entry, suggest.garageYear);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </>
            ) : (
              <span className="ed-finder-suggest-label">
                無法對應「{suggest.query}」到車款字典,請從下方選單選擇
              </span>
            )}
          </div>
        )}
        <div className="ed-finder-bar">
          <VehicleSelect
            variant="finder"
            motoBrands={motoBrands}
            vehicle={vehicle}
            onPickBrand={(name) => setVehicle({ brand: name })}
            onPickModel={(name) =>
              setVehicle((v) => (v ? { brand: v.brand, model: name } : v))
            }
            onPickYear={(year) => setVehicle((v) => (v?.model != null ? { ...v, year } : v))}
            onClearBrand={() => setVehicle(null)}
            onClearModel={() => setVehicle((v) => (v ? { brand: v.brand } : v))}
            onClearYear={() => setVehicle((v) => (v ? { brand: v.brand, model: v.model } : v))}
          />
          <button
            className={`ed-finder-go ${ready ? 'is-ready' : ''}`}
            disabled={!ready}
            onClick={() => {
              if (!brandObj || !modelObj) return;
              const parts = [brandObj.id, modelObj.id];
              if (vehicle?.year != null) parts.push(String(vehicle.year));
              // context 鏡寫(V-2 消費;URL 恆第一真相)
              writeVehicleContext({
                brandId: brandObj.id,
                modelId: modelObj.id,
                year: vehicle?.year,
                label: [brandObj.name, modelObj.name, vehicle?.year].filter(Boolean).join(' '),
              });
              const params = new URLSearchParams({ vehicle: parts.join(':') });
              router.push(`/products?${params.toString()}`);
            }}>
            <span>搜尋部品</span>
            <span className="ed-finder-go-arrow" aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}
