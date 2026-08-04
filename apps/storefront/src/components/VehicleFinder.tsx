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
import { resolveGarageChip, resolveSuggestionLabel } from '@/lib/garage-chip';
import { writeVehicleContext } from '@/lib/vehicle-context';

type VehicleSel = { brand: string; model?: string; year?: number } | null;

export function VehicleFinder({
  motoBrands,
  garage = [],
}: {
  motoBrands: MockMotoBrand[];
  /** 登入會員車庫(未登入/讀取失敗=[]、整排 chips 不顯示) */
  garage?: Pick<CustomerVehicle, 'id' | 'name' | 'year' | 'dictBrandName' | 'dictModelName'>[];
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
  // A8 / Sean 08-03 拍 Q4=A:送出門檻放寬到「選廠牌即可搜」(與目錄一致)。
  // 原本 = 必須選到車型,該車型有年份時還必須選年份 —— 首頁比目錄嚴,是本次統一要收掉的其中一種亂。
  // 車型/年份改為「有選才附加進 URL 段」,見下方送出處。
  const ready = !!brandObj;

  const onGarageChip = (g: {
    name: string;
    year: string;
    dictBrandName: string | null;
    dictModelName: string | null;
  }) => {
    // 決策腦抽 lib/garage-chip(V-1e 型錄鈕共用同一顆);dict 快路徑→精確命中→建議清單、
    // year 閘門皆收在純函式內(值班台 nit-1:回傳 year 恆已通過閘門的 number|undefined)。
    const result = resolveGarageChip(motoBrands, g);
    if (result.kind === 'apply') {
      setVehicle({ brand: result.brand, model: result.model, year: result.year });
      setSuggest(null);
    } else {
      setSuggest({ query: result.query, entries: result.entries, garageYear: result.garageYear });
    }
  };

  return (
    <section id="vehicle-finder" className="ed-finder">
      <div className="ed-finder-inner">
        <div className="ed-finder-head">
          <div className="ed-finder-label">
            <span className="ed-mono">01 ·</span>
            <span>輸入你的車輛</span>
          </div>
          {/* A8:舊字面「精準匹配車款、年份、引擎代號」是超賣 —— 選車輸入裡根本沒有引擎代號那一欄
              (A 表條 5)。新字面同時把 Q4=A 的門檻講清楚。逗號沿全形 ，(Sean Q2=A)。 */}
          <div className="ed-finder-hint">選廠牌即可搜尋，選到車型、年份更精準</div>
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
                      // 明選後車庫年份同閘門帶入(四位數字+在字典年份內才帶);共用 lib 決策腦
                      const applied = resolveSuggestionLabel(motoBrands, label, suggest.garageYear);
                      if (applied) {
                        setVehicle({ brand: applied.brand, model: applied.model, year: applied.year });
                        setSuggest(null);
                      }
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
              if (!brandObj) return;
              // 🔴 A8:年份**只有在有 model 時**才能 push —— `?vehicle=brandId:year` 是不存在的格式,
              //    parseVehicleFromUrl 會把第二段當 modelId 解析(spec §4-4:brand-only 只走單段短版)。
              // ⚠️ 誠實註記:這層巢狀是**防禦性**的,今天沒有測試蓋得住它 —— 「有 brand+year 但無 model」
              //    在現行 UI 不可構造。承重的是本檔 `onPickYear`(無 model 時直接不寫 year)**那一道最硬**,
              //    年份欄的 disabled 只是第二層;另有 onPickModel/onClearModel 換層丟 year、
              //    愛車 chip 的 resolveApply 恆帶 model。拿掉巢狀全套照樣全綠(2026-08-05 實測突變)。
              //    保留的理由 = 它守的是「URL 段數語意」這條跨檔契約,而維持它的那些前提**散在別處**;
              //    哪天上面任一道被放寬,這裡就是唯一還站著的那道。
              // ⚠️ 照抄參考版時**刻意沒抄**的一行:`useVehicleUrlSync` 另有
              //    `if (vehicle.model != null && !modelObj) return;`(選了車型卻對不到 taxonomy 就整個不動)。
              //    本檔的 model 值只可能來自剛剛那份 motoBrands 的選單,對不到 taxonomy 不可達;
              //    那支 hook 的 vehicle 來自 URL/reducer(外部輸入)才需要這道。
              const parts = [brandObj.id];
              if (modelObj) {
                parts.push(modelObj.id);
                if (vehicle?.year != null) parts.push(String(vehicle.year));
              }
              // context 鏡寫(V-2 消費;URL 恆第一真相)。V-2a REQUIRED-3:additive 名稱字面欄
              // (brandName/modelName)供購物車自動帶入組 CartItem kind:'dict';此處本手握字典名稱。
              // 🔴 條件帶入的形狀**逐字照抄** products-url-state.tsx 的 useVehicleUrlSync(已寫對的那份),
              //    不自己想:brand-only 也寫鏡(鏡跟 URL、消費端名稱不齊自然零猜)。
              writeVehicleContext({
                brandId: brandObj.id,
                modelId: modelObj?.id,
                year: modelObj != null && vehicle?.year != null ? vehicle.year : undefined,
                label: [brandObj.name, modelObj?.name, modelObj != null ? vehicle?.year : undefined]
                  .filter((s) => s != null)
                  .join(' '),
                brandName: brandObj.name,
                modelName: modelObj?.name,
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
