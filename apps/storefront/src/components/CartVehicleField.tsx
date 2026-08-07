'use client';

// CartVehicleField.tsx — 購物車「給哪台車用」車款欄(V-2a;真權威 spec §2)。
// 一個欄同時支援 §2 四帶入路徑的手動端:①愛車快選(登入會員 garage chips、共用 resolveGarageChip
// 決策腦)②打字 typeahead + ③三層 combobox(VehicleSelect、字典字面)④自由輸入 fallback(字典沒有
// 照打照存=kind:'free')。頂部欄=整車套用、單列欄=覆寫,兩處共用本元件(外殼同、onChange 去向不同)。
// 🔴 車種鐵律:picker/typeahead/garage 命中恆字典字面(kind:'dict');自由輸入明標 kind:'free'、零猜。
// §7 商品頁比對只認 kind:'dict';free 恆走「人工確認」路(不在本元件、在 V-2b)。

import { useCallback, useState } from 'react';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { CartItemVehicle } from '@/contexts/CartContext';
import type { UIFitment } from '@/data/mock-products';
import { GarageChips, type GarageChipItem } from './GarageChips';
import { VehicleSelect } from './VehicleSelect';
import { checkFitment, type FitmentCheckStatus } from '@/lib/fitment-match';
import { formatSkippedDraftNotice, type VehicleDraftField, type VehicleDraftTexts } from '@/lib/vehicle-draft-notice';
// V-2h/MF-6:formatCartVehicle 抽到無依賴 lib(供結帳商品複查免拉整個 client 元件;U2a 起消費端 =
// CheckoutStep2ReviewSections);此處 re-export 保 back-compat。
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

// Part B 改動 A:自由輸入出口(記下 / garage 零命中記下)= 整台車已改用自由文字記下,
// 三層字典欄位在這條路上都不再是「沒值」的層,故整批排除(見 `done()` 呼叫端)。
const ALL_LAYERS_MOOT = { brand: true, model: true, year: true } as const;

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
  // A10c:建議清單 state 與決策腦呼叫已搬進 GarageChips(全站單一份),本檔不再自持。
  // Part B(債⑤):三層各自「打了字但沒選中」的草稿(VehicleSelect 回報)+ 出口離開時組的提示。
  const [draftText, setDraftText] = useState<VehicleDraftTexts>({});
  const [skipNotice, setSkipNotice] = useState<string | null>(null);
  const onDraftTextChange = useCallback((field: VehicleDraftField, text: string) => {
    setDraftText((d) => ({ ...d, [field]: text }));
  }, []);

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
    setDraftText({});
    setSkipNotice(null);
    setEditing(true);
  };

  // Part B(債⑤):出口動作已經給了值的層要從草稿裡排除(見檔頭核心規則),剩下的才算
  // 「被丟棄」。`filled` = 呼叫端自己剛填了哪幾層(各出口給值的來源不同 —— 完成鈕看 `sel`、
  // 車庫套用看套用進去的那筆、自由輸入整層作廢 —— 不能通通看 `sel`:`sel` 只對完成鈕那條路
  // 成立,車庫套用/自由輸入都不動 `sel`,原本共用 `sel` 會把明明有值的層誤判成被丟棄)。
  const done = (filled: Partial<Record<VehicleDraftField, unknown>> = sel ?? {}) => {
    const remaining: VehicleDraftTexts = { ...draftText };
    for (const f of ['brand', 'model', 'year'] as const) if (filled[f]) delete remaining[f];
    setSkipNotice(formatSkippedDraftNotice(remaining));
    setEditing(false);
  };

  const submitFreetext = () => {
    const raw = freetext.trim();
    if (raw === '') return;
    onChange({ kind: 'free', raw, source: 'freetext' });
    done(ALL_LAYERS_MOOT);
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
          <button type="button" className="cvf-link" onClick={() => { setSkipNotice(null); onChange(null); }}>清除</button>
        </div>
      ) : editing ? (
        <div className="cvf-edit">
          {/* A10c:自刻的 chips + 建議清單退場,換全站唯一的 GarageChips(設計稿 C5 行內密度)。
              購物車走 `commitDict()`、沒有 cascade reducer ⇒ 用 A9 的互斥 `onApply` 出口。
              🔴 但「以自由輸入記下」那顆**留在本檔**(計畫 §2.7 紅字):它是購物車專屬的零命中出口,
                 把對不到字典的車庫車照原樣記進 CartItem(kind:'free')。GarageChips 沒有「自由輸入」
                 這個概念,所以走 `renderNoMatch` 由宿主渲染 —— 共用元件不該認得購物車的資料模型。 */}
          <GarageChips
            garage={garage}
            motoBrands={motoBrands}
            variant="inline"
            onApply={(a) => {
              commitDict(a.brand, a.model, a.year, 'garage');
              // ⚠️ a.year 可能 undefined(無年份的愛車)—— 那時年份層動作後仍無值,
              // 年份草稿應該被報出來,不無條件排除(保留 filled 只帶「真的有值」的層)。
              done({ brand: a.brand, model: a.model, year: a.year });
            }}
            renderNoMatch={(raw) => (
              <button type="button" className="cvf-link"
                onClick={() => { onChange({ kind: 'free', raw, source: 'garage' }); done(ALL_LAYERS_MOOT); }}>
                以自由輸入記下「{raw}」(下單後人工確認)
              </button>
            )}
          />
          <div className="cvf-picker">
            <VehicleSelect
              motoBrands={motoBrands}
              vehicle={sel}
              onPickBrand={(name) => setSel({ brand: name })}
              onPickModel={(p) => {
                // commit 移出 setSel updater=純函式(值班台 nit:updater 內呼 onChange 於 StrictMode 雙跑)
                setSel({ brand: p.brand, model: p.model });
                commitDict(p.brand, p.model, undefined, 'picker'); // 選到車型即帶入(年份可後補)
              }}
              onPickYear={(year) => {
                if (!sel?.model) return;
                setSel({ ...sel, year });
                commitDict(sel.brand, sel.model, year, 'picker');
              }}
              onClearBrand={() => setSel(null)}
              onClearModel={() => setSel((v) => (v ? { brand: v.brand } : v))}
              onClearYear={() => setSel((v) => (v ? { brand: v.brand, model: v.model } : v))}
              onDraftTextChange={onDraftTextChange}
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
          {/* 🔴 必須是 `() => done()`、不能直接 `onClick={done}`:done 的參數是「填了哪幾層」,
              直接當 handler 會把 click 的 SyntheticEvent 當成 filled 傳進去 —— event 沒有
              brand/model/year 屬性,`filled[f]` 恆 undefined 看似巧合沒事,但那是意外不是設計,
              未來 done() 簽章一變就炸。 */}
          <button type="button" className="cvf-link cvf-done" onClick={() => done()}>完成</button>
        </div>
      ) : (
        <button type="button" className="cvf-add" onClick={startEdit}>+ 選擇車款</button>
      )}
      {hint && !value && !editing && <div className="cvf-hint">{hint}</div>}
      {!editing && skipNotice && <div className="cvf-note" role="status">{skipNotice}</div>}
    </div>
  );
}
