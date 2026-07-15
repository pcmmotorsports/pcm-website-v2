'use client';

// InlineVehicleForm.tsx — 我的愛車新增/編輯表單(M-1-14e-g-6b 建、g-6c 編輯重用)
//
// 字面從 design-reference/components/AccountPages.jsx InlineVehicleForm(L760-798)直接搬(鐵則 1):
// - .acc-inline-form-inner form + .acc-inline-head〔h4「新增車輛/編輯車輛」依 veh.id + .acc-inline-x 關閉鈕〕
// - 6 欄:車型 name(required)/ 年份 year / 引擎號 engine / 里程 km / 已改裝 mods / 最近保養 service(type="date")
// - .acc-inline-check 勾「設為主要車輛」(isPrimary);.acc-inline-actions 取消/儲存
// - **無發票三 tab**(愛車表單比收件地址簡單、純文字欄 + date + checkbox;對齊 design 字面)
//
// storefront 技術實作 adaptation(鐵則 1 例外類別 2、非視覺偏離):
// - design L776 onSave(form) localStorage mock → onSubmit prop(g-6b 傳 addVehicleAction、g-6c 傳 updateVehicleAction);
//   form 保持 generic、不 hardcode action → 可重用(veh.id 僅決定 heading 字面,id 綁定由 parent closure 處理)
// - controlled state + useTransition;成功 ok → router.refresh()〔g-4c pattern、重讀 page server component 即時刷新清單〕+ onClose()
//
// V-1c++(Sean 07-16 實測回饋二輪):車型欄改「字典雙下拉(品牌/車型 VehicleCombo)為主、
// 自行輸入為 fallback」——與首頁選車同一 combobox 原型(打字過濾/可捲全清單、無 8 筆截斷),
// 點選出的名稱=字典標準字面「品牌 車型」→ 首頁愛車 chips 一鍵套用 100% 精確命中。
// 年份維持自由填寫:車主的實車年份不一定在 fitment 字典年份裡(例如字典只收 2018-2020、
// 車是 2016),強制字典年份會把人卡死;chips 套用時年份合法才帶入(VehicleFinder 既有閘)。
// 字典沒有的車 → 「改用自行輸入」照打照存,自由度不變(車種鐵律:字典零猜、自由文字不硬配)。
//
// #181 雙通道(沿用 InlineAddressForm pattern、但無巢狀 — VehicleInput 僅 name 必填):
// - fieldErrors.name(.auth-field-err 顯車型 input 下方);formError 帳號層級(.auth-err 表單頂部)
// - 信任邊界全在 server(addVehicleAction safeParse);client 不重驗、收 server 逐欄回傳渲染
//   (dict 模式的「品牌車型都要選」是 client 端組字guard、非 server 規則複驗)

import { useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { VehicleInput } from '@pcm/schemas';
import type { AddVehicleActionResult, VehicleFieldErrors } from '@/app/account/vehicle/actions';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import { VehicleCombo } from '@/components/VehicleSelect';
import { vehicleLabel } from '@/lib/vehicle-match';

// 表單初值(新增:id 缺/null + isPrimary 由 parent 依清單空否帶入;編輯〔g-6c〕:帶完整 CustomerVehicle 值)。
export type InlineVehicleInitial = {
  id?: string | null;
  isPrimary?: boolean;
  name?: string;
  year?: string;
  engine?: string;
  km?: string;
  mods?: string;
  service?: string | null;
  /** V-1d:字典鍵名稱字面對(編輯回填雙下拉的第一優先來源;缺/null=走 name 字面解析 fallback) */
  dictBrandName?: string | null;
  dictModelName?: string | null;
};

export type InlineVehicleFormProps = {
  veh: InlineVehicleInitial;
  onClose: () => void;
  // g-6b 傳 addVehicleAction;g-6c 編輯傳 (input) => updateVehicleAction(veh.id!, input)(id 綁定在 parent closure)。
  onSubmit: (input: VehicleInput) => Promise<AddVehicleActionResult>;
  /**
   * V-1c++:車型字典(結構化 taxonomy、server 端 fetchVehicleTaxonomy 直傳)。有值=品牌/車型
   * 雙下拉為主 + 自行輸入 fallback;缺省 []=退回純自由輸入(行為同 V-1c 前舊版、不擋)。
   */
  vehicleBrands?: MockMotoBrand[];
};

/** 編輯模式:既有 name 若正好是字典標準字面「品牌 車型」→ 回填雙下拉;否則走自行輸入。 */
function parseDictName(
  brands: MockMotoBrand[],
  name: string,
): { brand: string; model: string } | null {
  for (const b of brands) {
    for (const m of b.models) {
      if (vehicleLabel(b.name, m.name) === name) return { brand: b.name, model: m.name };
    }
  }
  return null;
}

export function InlineVehicleForm({
  veh,
  onClose,
  onSubmit,
  vehicleBrands = [],
}: InlineVehicleFormProps) {
  const router = useRouter();
  const [isPrimary, setIsPrimary] = useState(!!veh.isPrimary);
  // 車型欄雙模式:dict=字典雙下拉(預設、可精確命中愛車 chips);free=自行輸入(字典沒有的車)。
  // 初始:無字典 → free;dict 欄有值(V-1d 落庫、寫入時已 server 驗)→ dict 直接回填;
  // name 空(新增)→ dict;name=字典標準字面 → dict 回填(舊資料 fallback);其餘(自由文字)→ free。
  const initialDict =
    veh.dictBrandName != null && veh.dictModelName != null
      ? { brand: veh.dictBrandName, model: veh.dictModelName }
      : veh.name
        ? parseDictName(vehicleBrands, veh.name)
        : null;
  const [mode, setMode] = useState<'dict' | 'free'>(
    vehicleBrands.length === 0 ? 'free' : !veh.name || initialDict ? 'dict' : 'free',
  );
  const [brandName, setBrandName] = useState<string | null>(initialDict?.brand ?? null);
  const [modelName, setModelName] = useState<string | null>(initialDict?.model ?? null);
  const [name, setName] = useState(veh.name ?? '');
  const [year, setYear] = useState(veh.year ?? '');
  const [engine, setEngine] = useState(veh.engine ?? '');
  const [km, setKm] = useState(veh.km ?? '');
  const [mods, setMods] = useState(veh.mods ?? '');
  const [service, setService] = useState(veh.service ?? '');
  // #181 雙通道:fieldErrors 逐欄(僅 name)/ formError 帳號層級;互不取代。
  const [fieldErrors, setFieldErrors] = useState<VehicleFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const curBrand = brandName !== null ? vehicleBrands.find((b) => b.name === brandName) : undefined;
  const modelOptions = curBrand?.models.map((m) => m.name) ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // dict 模式組字 guard(client 端 UI 組合、非 server 規則複驗):品牌車型都選了才有名稱可組。
    if (mode === 'dict' && (brandName === null || modelName === null)) {
      setFieldErrors({ name: '請選擇品牌與車型,或改用自行輸入' });
      setFormError(null);
      return;
    }
    const submitName = mode === 'dict' ? vehicleLabel(brandName!, modelName!) : name;
    // V-1d:dict 對恆送(dict=名稱字面對、free=雙 null=REQUIRED-1 覆蓋殘留);server 端 fail-closed 再驗。
    const dictPair =
      mode === 'dict'
        ? { dictBrandName: brandName, dictModelName: modelName }
        : { dictBrandName: null, dictModelName: null };
    startTransition(async () => {
      // 信任邊界在 server(addVehicleAction safeParse);client 不重驗、收逐欄回傳渲染。
      const result = await onSubmit({
        isPrimary,
        name: submitName,
        year,
        engine,
        km,
        mods,
        service,
        ...dictPair,
      });
      if (result.fieldErrors) {
        setFieldErrors(result.fieldErrors);
        setFormError(null);
      } else if (result.formError) {
        setFormError(result.formError);
        setFieldErrors({});
      } else if (result.ok) {
        // g-4c pattern:重跑 page.tsx server component 重讀 vehicles → 清單即時更新;再收合表單。
        router.refresh();
        onClose();
      }
    });
  };

  return (
    <form className="acc-inline-form-inner" onSubmit={submit}>
      <div className="acc-inline-head">
        <h4>{veh.id ? '編輯車輛' : '新增車輛'}</h4>
        <button type="button" onClick={onClose} className="acc-inline-x" aria-label="關閉">
          ×
        </button>
      </div>

      {/* 頂部:帳號層級錯(請重新登入 / 儲存失敗 = formError);逐欄錯顯各欄下方(#181 雙通道) */}
      {formError && <div className="auth-err">{formError}</div>}

      {mode === 'dict' ? (
        <>
          {/* V-1c++:品牌/車型=與首頁同一 combobox 原型(VehicleCombo variant="form"、裸 input
              吃 account.css 表單樣式);清單可捲、無截斷;換品牌 → 車型連動清空。 */}
          <label>
            <span>品牌</span>
            <VehicleCombo
              label="選擇品牌"
              value={brandName}
              options={vehicleBrands.map((b) => b.name)}
              placeholder="YAMAHA"
              variant="form"
              onPick={(n) => {
                setBrandName(n);
                setModelName(null);
              }}
              onClear={() => {
                setBrandName(null);
                setModelName(null);
              }}
            />
          </label>
          <label>
            <span>車型</span>
            <VehicleCombo
              label="選擇車型"
              value={modelName}
              options={modelOptions}
              disabled={brandName === null}
              placeholder="YZF-R6"
              variant="form"
              onPick={(n) => setModelName(n)}
              onClear={() => setModelName(null)}
            />
            {fieldErrors.name && <span className="auth-field-err">{fieldErrors.name}</span>}
          </label>
          <button
            type="button"
            className="acc-veh-mode-toggle"
            onClick={() => {
              // 已選齊 → 帶入組合字面當自由輸入初值(V-1d 指示「客人可改顯示名」);未選齊保留原值。
              if (brandName !== null && modelName !== null) setName(vehicleLabel(brandName, modelName));
              setMode('free');
              setFieldErrors({});
            }}
          >
            清單裡找不到你的車?改用自行輸入
          </button>
        </>
      ) : (
        <>
          <label>
            <span>車型</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="YAMAHA YZF-R6"
            />
            {fieldErrors.name && <span className="auth-field-err">{fieldErrors.name}</span>}
          </label>
          {vehicleBrands.length > 0 && (
            <button
              type="button"
              className="acc-veh-mode-toggle"
              onClick={() => {
                // NIT-1(值班台):切回 dict 時重解析 name,字典字面命中就回填雙下拉
                // (鏡像編輯模式回填語意;所見=所送、避免剛打的字面「消失」突兀)。
                const hit = parseDictName(vehicleBrands, name);
                if (hit) {
                  setBrandName(hit.brand);
                  setModelName(hit.model);
                }
                setMode('dict');
                setFieldErrors({});
              }}
            >
              改用清單選車(品牌/車型)
            </button>
          )}
        </>
      )}
      <label>
        <span>年份</span>
        <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="2022" />
      </label>
      <label>
        <span>引擎號</span>
        <input value={engine} onChange={(e) => setEngine(e.target.value)} placeholder="RJ27-xxxxx" />
      </label>
      <label>
        <span>里程</span>
        <input value={km} onChange={(e) => setKm(e.target.value)} placeholder="12,340 km" />
      </label>
      <label>
        <span>已改裝</span>
        <input value={mods} onChange={(e) => setMods(e.target.value)} placeholder="7 件" />
      </label>
      <label>
        <span>最近保養</span>
        <input type="date" value={service} onChange={(e) => setService(e.target.value)} />
      </label>
      <label className="acc-inline-check">
        <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
        <span>設為主要車輛</span>
      </label>

      <div className="acc-inline-actions">
        <button type="button" className="acc-btn-ghost" onClick={onClose}>
          取消
        </button>
        <button type="submit" className="auth-submit" disabled={isPending}>
          儲存
        </button>
      </div>
    </form>
  );
}
