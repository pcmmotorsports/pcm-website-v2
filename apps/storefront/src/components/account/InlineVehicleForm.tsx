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
// #181 雙通道(沿用 InlineAddressForm pattern、但無巢狀 — VehicleInput 僅 name 必填):
// - fieldErrors.name(.auth-field-err 顯車型 input 下方);formError 帳號層級(.auth-err 表單頂部)
// - 信任邊界全在 server(addVehicleAction safeParse);client 不重驗、收 server 逐欄回傳渲染

import { useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { VehicleInput } from '@pcm/schemas';
import type { AddVehicleActionResult, VehicleFieldErrors } from '@/app/account/vehicle/actions';
import { filterVehicleOptions } from '@/lib/vehicle-match';

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
};

export type InlineVehicleFormProps = {
  veh: InlineVehicleInitial;
  onClose: () => void;
  // g-6b 傳 addVehicleAction;g-6c 編輯傳 (input) => updateVehicleAction(veh.id!, input)(id 綁定在 parent closure)。
  onSubmit: (input: VehicleInput) => Promise<AddVehicleActionResult>;
  /**
   * V-1c+(Sean 07-15 實測回饋):車型欄打字時的字典建議清單(「品牌 車型」字面、server 端
   * fetchVehicleTaxonomy 衍生)。點選=填入標準字面(→首頁愛車 chips 一鍵套用可精確命中);
   * 不選照打照存=自由輸入 fallback 不變(字典沒有的車照樣能記)。缺省 []=無建議、行為同舊版。
   */
  vehicleModelOptions?: string[];
};

export function InlineVehicleForm({
  veh,
  onClose,
  onSubmit,
  vehicleModelOptions = [],
}: InlineVehicleFormProps) {
  const router = useRouter();
  const [isPrimary, setIsPrimary] = useState(!!veh.isPrimary);
  const [name, setName] = useState(veh.name ?? '');
  const [nameFocus, setNameFocus] = useState(false);
  // 車型字典建議:聚焦+有輸入才顯、上限 8、已全等時不再跳(避免選完還掛著)
  const nameSuggestions =
    nameFocus && name.trim() !== ''
      ? filterVehicleOptions(vehicleModelOptions, name, (l) => l)
          .filter((l) => l !== name)
          .slice(0, 8)
      : [];
  const [year, setYear] = useState(veh.year ?? '');
  const [engine, setEngine] = useState(veh.engine ?? '');
  const [km, setKm] = useState(veh.km ?? '');
  const [mods, setMods] = useState(veh.mods ?? '');
  const [service, setService] = useState(veh.service ?? '');
  // #181 雙通道:fieldErrors 逐欄(僅 name)/ formError 帳號層級;互不取代。
  const [fieldErrors, setFieldErrors] = useState<VehicleFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      // 信任邊界在 server(addVehicleAction safeParse);client 不重驗、收逐欄回傳渲染。
      const result = await onSubmit({ isPrimary, name, year, engine, km, mods, service });
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

      <label>
        <span>車型</span>
        {/* V-1c+(Sean 07-15 實測回饋):打字跳字典建議(共用 vehicle-match 核心、.vsc-list 樣式);
            點選=填標準字面(→首頁愛車 chips 可精確命中)、不選照打照存=自由輸入 fallback 不變。
            onMouseDown 先於 blur=點選不被關閉搶走。 */}
        <div className="vsc">
          <input
            role="combobox"
            aria-expanded={nameSuggestions.length > 0}
            aria-autocomplete="list"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={() => setNameFocus(true)}
            onBlur={() => setNameFocus(false)}
            required
            placeholder="YAMAHA YZF-R6"
          />
          {nameSuggestions.length > 0 && (
            <ul className="vsc-list" role="listbox" aria-label="車型建議">
              {nameSuggestions.map((label) => (
                <li
                  key={label}
                  role="option"
                  aria-selected={false}
                  className="vsc-option"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setName(label);
                    setNameFocus(false);
                  }}
                  // 外層 label:取消 click activation、防 focus 轉發回 input 重開清單(同 VehicleSelect)
                  onClick={(e) => e.preventDefault()}
                >
                  {label}
                </li>
              ))}
            </ul>
          )}
        </div>
        {fieldErrors.name && <span className="auth-field-err">{fieldErrors.name}</span>}
      </label>
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
