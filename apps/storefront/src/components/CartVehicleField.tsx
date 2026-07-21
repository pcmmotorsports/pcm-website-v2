'use client';

// CartVehicleField.tsx — 購物車「給哪台車用」車款欄(V-2a;真權威 spec §2)。
// 一個欄同時支援 §2 四帶入路徑的手動端:①愛車快選(登入會員 garage chips、共用 resolveGarageChip
// 決策腦)②打字 typeahead + ③三層 combobox(VehicleSelect、字典字面)④自由輸入 fallback(字典沒有
// 照打照存=kind:'free')。頂部欄=整車套用、單列欄=覆寫,兩處共用本元件(外殼同、onChange 去向不同)。
// 🔴 車種鐵律:picker/typeahead/garage 命中恆字典字面(kind:'dict');自由輸入明標 kind:'free'、零猜。
// §7 商品頁比對只認 kind:'dict';free 恆走「人工確認」路(不在本元件、在 V-2b)。

import { useState } from 'react';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { CartItemVehicle } from '@/contexts/CartContext';
import type { UIFitment } from '@/data/mock-products';
import type { GarageChipItem } from './GarageChips';
import { VehicleSelect } from './VehicleSelect';
import { resolveGarageChip, resolveSuggestionLabel } from '@/lib/garage-chip';
import { checkFitment, type FitmentCheckStatus } from '@/lib/fitment-match';
// V-2h/MF-6:formatCartVehicle 抽到無依賴 lib(供結帳商品複查免拉整個 client 元件;U2a 起消費端 =
// CheckoutStep2ReviewSections,原為 CheckoutStep3);此處 re-export 保 back-compat。
import { formatCartVehicle } from '@/lib/cart-vehicle-format';
export { formatCartVehicle };

/** V-2e:cart line 車款 vs 商品 fitments 判定(重用 §7 checkFitment 同一顆腦、零新比對邏輯)。
 *  只判 kind:'dict'(名稱字面 NFKC 精確比對=V-2h/MF-1 廢 slugify 橋接);free/無 fitments/無值 → null
 *  =不顯示判定(自由輸入=人工確認路、不誤嚇;§7 保守方向:僅 no-match 亮紅)。 */
export function cartVehicleFitStatus(
  fitments: UIFitment[] | undefined,
  v: CartItemVehicle | undefined,
): FitmentCheckStatus | null {
  if (!v || v.kind !== 'dict' || !fitments || fitments.length === 0) return null;
  return checkFitment(fitments, {
    kind: 'dict',
    brandName: v.brand,
    modelName: v.model,
    year: v.year,
  });
}

const SOURCE_NOTE: Record<CartItemVehicle['source'], string> = {
  search: '來自你的搜尋',
  garage: '來自你的車庫',
  picker: '',
  freetext: '自由輸入 · 我們會人工確認',
};

type LocalSel = { brand: string; model?: string; year?: number } | null;

export function CartVehicleField({
  value,
  onChange,
  motoBrands,
  garage = [],
  label,
  hint,
  fitments,
}: {
  value: CartItemVehicle | undefined;
  /** null=清除本欄 */
  onChange: (v: CartItemVehicle | null) => void;
  motoBrands: MockMotoBrand[];
  garage?: GarageChipItem[];
  /** 欄標題(頂部=「給哪台車用(套用全部)」;單列=「這件給哪台車」) */
  label: string;
  /** 提示文案(非強制;§2「建議填寫車款…」) */
  hint?: string;
  /** V-2e:該商品適用車款(單列欄傳入=不符顯紅膠囊;頂部整車欄不傳=跨商品無單一判定對象) */
  fitments?: UIFitment[];
}) {
  const [editing, setEditing] = useState(false);
  // V-2e:不符=紅膠囊+「可能不適用」(§7 保守方向:僅 no-match 亮紅;qualified/free/undetermined
  // 中性不誤嚇);display-only 不擋結帳。頂部整車欄不傳 fitments=恆 null 不判。
  const fit = cartVehicleFitStatus(fitments, value);
  // picker 本地選態(brand→model→year;model 選定即 commit kind:'dict')
  const [sel, setSel] = useState<LocalSel>(null);
  const [freetext, setFreetext] = useState('');
  const [suggest, setSuggest] = useState<{ entries: string[]; garageYear: number | undefined; raw: string } | null>(null);

  const commitDict = (
    brand: string,
    model: string,
    year: number | undefined,
    source: 'search' | 'garage' | 'picker',
  ) => {
    onChange({ kind: 'dict', brand, model, year, source });
  };

  const startEdit = () => {
    // 進編輯:dict 值回填 picker、free 值回填 freetext
    if (value?.kind === 'dict') setSel({ brand: value.brand, model: value.model, year: value.year });
    else setSel(null);
    setFreetext(value?.kind === 'free' ? value.raw : '');
    setSuggest(null);
    setEditing(true);
  };

  const done = () => {
    setEditing(false);
    setSuggest(null);
  };

  const onGarageChip = (g: GarageChipItem) => {
    const r = resolveGarageChip(motoBrands, g);
    if (r.kind === 'apply') {
      commitDict(r.brand, r.model, r.year, 'garage');
      done();
    } else {
      // 多/零命中:多=建議清單明選;零=提供「以自由輸入記下」(honor 車庫車、不猜 dict)
      setSuggest({ entries: r.entries, garageYear: r.garageYear, raw: g.name });
    }
  };

  const onPickSuggestion = (label2: string, garageYear: number | undefined) => {
    const applied = resolveSuggestionLabel(motoBrands, label2, garageYear);
    if (applied) {
      commitDict(applied.brand, applied.model, applied.year, 'garage');
      done();
    }
  };

  const submitFreetext = () => {
    const raw = freetext.trim();
    if (raw === '') return;
    onChange({ kind: 'free', raw, source: 'freetext' });
    done();
  };

  return (
    <div className="cvf">
      <div className="cvf-label">{label}</div>
      {value && !editing ? (
        <div className="cvf-current">
          <span className="cvf-chip" data-kind={value.kind} data-fit={fit ?? undefined}>
            {formatCartVehicle(value)}
          </span>
          {fit === 'no-match' && (
            <span className="cvf-mismatch" role="status">可能不適用 · 下單前我們會與你確認</span>
          )}
          {SOURCE_NOTE[value.source] && <span className="cvf-note">{SOURCE_NOTE[value.source]}</span>}
          <button type="button" className="cvf-link" onClick={startEdit}>更改</button>
          <button type="button" className="cvf-link" onClick={() => onChange(null)}>清除</button>
        </div>
      ) : editing ? (
        <div className="cvf-edit">
          {garage.length > 0 && (
            <div className="cvf-garage">
              <span className="cvf-garage-label">我的愛車</span>
              {garage.map((g) => (
                <button key={g.id} type="button" className="cat-garage-chip" onClick={() => onGarageChip(g)}>
                  {[g.year, g.name].filter(Boolean).join(' ')}
                </button>
              ))}
            </div>
          )}
          {suggest && (
            <div className="cvf-suggest" role="listbox" aria-label="車款建議清單">
              {suggest.entries.length > 0 ? (
                <>
                  <span className="cvf-note">「{suggest.raw}」可能是:</span>
                  {suggest.entries.map((s) => (
                    <button key={s} type="button" className="cat-garage-chip" role="option" aria-selected={false}
                      onClick={() => onPickSuggestion(s, suggest.garageYear)}>
                      {s}
                    </button>
                  ))}
                </>
              ) : (
                <button type="button" className="cvf-link"
                  onClick={() => { onChange({ kind: 'free', raw: suggest.raw, source: 'garage' }); done(); }}>
                  以自由輸入記下「{suggest.raw}」(下單後人工確認)
                </button>
              )}
            </div>
          )}
          <div className="cvf-picker">
            <VehicleSelect
              motoBrands={motoBrands}
              vehicle={sel}
              onPickBrand={(name) => setSel({ brand: name })}
              onPickModel={(name) => {
                // commit 移出 setSel updater=純函式(值班台 nit:updater 內呼 onChange 於 StrictMode 雙跑)
                if (!sel) return;
                setSel({ brand: sel.brand, model: name });
                commitDict(sel.brand, name, undefined, 'picker'); // 選到車型即帶入(年份可後補)
              }}
              onPickYear={(year) => {
                if (!sel?.model) return;
                setSel({ ...sel, year });
                commitDict(sel.brand, sel.model, year, 'picker');
              }}
              onClearBrand={() => setSel(null)}
              onClearModel={() => setSel((v) => (v ? { brand: v.brand } : v))}
              onClearYear={() => setSel((v) => (v ? { brand: v.brand, model: v.model } : v))}
            />
          </div>
          <div className="cvf-free">
            <input
              type="text"
              className="cvf-free-input"
              placeholder="找不到?直接輸入車款(例:2017 R6)"
              aria-label="自由輸入車款"
              value={freetext}
              onChange={(e) => setFreetext(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitFreetext(); } }}
            />
            <button type="button" className="cvf-link" onClick={submitFreetext} disabled={freetext.trim() === ''}>記下</button>
          </div>
          <button type="button" className="cvf-link cvf-done" onClick={done}>完成</button>
        </div>
      ) : (
        <button type="button" className="cvf-add" onClick={startEdit}>+ 選擇車款</button>
      )}
      {hint && !value && !editing && <div className="cvf-hint">{hint}</div>}
    </div>
  );
}
