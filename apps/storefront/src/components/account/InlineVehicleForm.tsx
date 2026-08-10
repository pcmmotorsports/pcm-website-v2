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
// - controlled state + useTransition;成功 ok → ~~router.refresh() + onClose()~~ → **onSaved()**
//   (2026-08-08:重讀指令改由父層發出,舊寫法會讓發指令的元件在同一個 transition 內被自己拆掉;
//    見 InlineAddressForm 的 onSaved 註解與 P-205-STOP ③)
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
import { VehicleCombo, VEHICLE_EMPTY_HINTS } from '@/components/VehicleSelect';
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
  /** 存檔成功後由**父層**收尾(關表單 + 重讀清單);理由見 `InlineAddressForm` 的 onSaved 註解。 */
  onSaved: () => void;
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
  onSaved,
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
  // Q8=A:接住 VehicleCombo 回報的「打了字但沒選中」草稿 —— 切到自行輸入時要帶得走。
  const [brandText, setBrandText] = useState('');
  const [modelText, setModelText] = useState('');
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

  /**
   * 一動車型欄就清該欄 inline 錯 + 頂部錯(#378;與 auth 四張同一個 2026-08-08 掃測 B 級 bug、
   * 同三條判準)。**本片是新增行為,不是搬 design** —— design 真權威
   * (`design-reference/components/AccountPages.jsx:760-798`)的 onChange 只有 `set(k, v)`,
   * 那份原型連錯誤 state 都沒有(必填靠 `if (!form.name.trim()) return;` 靜默擋)⇒ 沒有可搬的字面。
   *
   * 🔴 **為什麼只掛在車型這個面上**:`VehicleFieldErrors` 只有 `name` 一個鍵
   * (`app/account/vehicle/actions.ts:24-26`)—— 年份 / 引擎號 / 里程 / 已改裝 / 最近保養 /
   * 設為主要車輛**都沒有自己的錯** ⇒ 照 auth 片第三條判準**不接**。
   * 判準是「這欄有沒有自己的 fieldError」,不是「它是不是輸入框」;對照組 = LoginPage 的
   * 「記住我」(不是驗證欄 ⇒ 不接)vs RegisterPage 的「同意條款」(是 `RegisterField` ⇒ 接)。
   *
   * 🔴 **dict 模式那兩顆下拉也算「動車型欄」**:那條錯的字面是「請選擇廠牌與車型，或改用自行輸入」,
   * 客人挑一個廠牌就是在修它。`onClear` 一樣接 —— 與 auth 同語意(把 Email 清空也會清掉
   * 「請填寫 Email」):清空是編輯動作,不是維持現狀。
   *
   * 🔴 頂部 `formError` 一律清:它講的是**上一次送出**的結果。
   * ⚠️ 誠實標註(同 auth nit-5):`請重新登入` 這種**不會因為開始打字就過期** ——
   * 清掉是可回復的(下次送出 server 會再回一次),不會讓客人做出錯誤決策,故照清。
   */
  const clearNameErr = () => {
    // 只有 `name` 一個鍵 ⇒ 清空整個物件與逐欄清等價;`prev` bail out 避免無錯時的多餘 render。
    setFieldErrors((prev) => (prev.name === undefined ? prev : {}));
    setFormError(null);
  };

  const curBrand = brandName !== null ? vehicleBrands.find((b) => b.name === brandName) : undefined;
  const modelOptions = curBrand?.models.map((m) => m.name) ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // dict 模式組字 guard(client 端 UI 組合、非 server 規則複驗):品牌車型都選了才有名稱可組。
    if (mode === 'dict' && (brandName === null || modelName === null)) {
      setFieldErrors({ name: '請選擇廠牌與車型，或改用自行輸入' });
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
        // 成功 → 交給父層收尾。理由同 `InlineAddressForm` 的 `onSaved` 註解:
        // 舊寫法 `router.refresh(); onClose();` 兩行都在本元件自己的 transition 裡,
        // 而 onClose 會讓父層把本元件 unmount = 發出重讀指令的元件把自己拆掉。
        // P 掃測(`P-205-STOP` ③)兩處同形狀復現,對照組是同頁「刪除」(transition 在父層)正常。
        onSaved();
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
          {/* V-1c++:廠牌/車型=與首頁同一 combobox 原型(VehicleCombo variant="form"、裸 input
              吃 account.css 表單樣式);清單可捲、無截斷;換廠牌 → 車型連動清空。
              A6(2026-08-05):欄標與 aria 走 A 表「廠牌」;placeholder 由範例值(YAMAHA / YZF-R6)
              換成 A 表提示字 —— 範例值長得像已填好的值,是本次統一要收掉的其中一種亂。 */}
          <label>
            <span>廠牌</span>
            <VehicleCombo
              label="選擇廠牌"
              value={brandName}
              options={vehicleBrands.map((b) => b.name)}
              placeholder="選擇或輸入廠牌"
              /* Q6=A(審查 F2 抓到我漏了這第四個消費端):打了查無的字、blur 也不清掉 ⇒
                 沒有 emptyHint 的話重新 focus 只剩自己那串字、無清單無提示 = 死路。 */
              emptyHint={VEHICLE_EMPTY_HINTS.brand}
              variant="form"
              onPick={(n) => {
                setBrandName(n);
                setModelName(null);
                clearNameErr();
              }}
              onClear={() => {
                setBrandName(null);
                setModelName(null);
                clearNameErr();
              }}
              onDraftTextChange={setBrandText}
            />
          </label>
          <label>
            <span>車型</span>
            <VehicleCombo
              label="選擇車型"
              value={modelName}
              options={modelOptions}
              disabled={brandName === null}
              placeholder="選擇或輸入車型"
              /* 本欄非跨層(要先選廠牌才啟用)⇒ 用「車型」那句、不是跨層的「車款」。 */
              emptyHint={VEHICLE_EMPTY_HINTS.model}
              variant="form"
              onPick={(n) => {
                setModelName(n);
                clearNameErr();
              }}
              onClear={() => {
                setModelName(null);
                clearNameErr();
              }}
              onDraftTextChange={setModelText}
            />
            {fieldErrors.name && <span className="auth-field-err">{fieldErrors.name}</span>}
          </label>
          <button
            type="button"
            className="acc-veh-mode-toggle"
            onClick={() => {
              // 三段語意(R3 對抗審查覆核 2026-08-07:註解改誠實,行為不動):
              // ①已選齊(廠牌+車型都選定)→ 無條件以組合字面覆蓋 name,**包含蓋掉客人手打的自由文字**。
              //   這是 HEAD 既有行為、V-1d「客人可改顯示名」的刻意設計,本片原樣保留、不擴不縮。
              //   🔴已申報的不對稱:選齊會蓋、未選齊(③)不蓋 —— 不是漏寫守門,是刻意如此。
              // ②未選齊、且自由輸入欄目前是空的 → 帶入「看得見什麼就帶什麼」的組合字面
              //   (Q8=A 收缺口②,Sean 2026-08-07:客人打到一半的字不再無聲消失)。
              // ③未選齊、但自由輸入欄已有字 → 保留原字,不覆蓋。
              //   守門 name.trim() === '' 是 R2 對抗審查抓到回歸後補的:少了它,「打了自由文字
              //   → 切回清單只選廠牌 → 再切回自行輸入」會把客人打好的車名蓋成廠牌名。
              //   🔴R3 抓到這道守門的代價,兩種損失分開看、**都不取決於有沒有選齊**:
              //   (a) name 非空且未選齊 → 走③:草稿被丟掉、原名留著 = 缺口② 在這條路上完全沒收。
              //       而「name 非空」正是**每一條編輯既有愛車的路徑**的常態(還有任何曾在自由欄
              //       打過字的新增路徑)⇒ 缺口② 實際只收到「全新、從沒打過字」那一種情形。
              //   (b) 選齊 → 走①:反過來是客人手打的原名被字典字面蓋掉。
              //   兩者都是已知且刻意的現況(HEAD 既有行為 + ① 的設計選擇疊加而成),各有測試釘住;
              //   🔴 **Sean 2026-08-07 傍晚拍 Q10=A(維持現況)⇒ 上面 (a)(b) 就是規格**,不再是待決現況。
              //   絕不覆蓋客人已打好的車名 = 這組行為的核心;**不要當漏洞順手「修好」**。
              //   ⚠️ Q10=A 不等於同根因的債③④⑤⑥消失(那四條是「靜默丟/殘留」、與覆蓋規則正交)。
              if (brandName !== null && modelName !== null) {
                setName(vehicleLabel(brandName, modelName));
              } else {
                const composed = [brandName ?? brandText.trim(), modelName ?? modelText.trim()]
                  .filter((s) => s !== '')
                  .join(' ');
                if (composed !== '' && name.trim() === '') setName(composed);
              }
              setMode('free');
              // #378:原本只清 `setFieldErrors({})`;改走 `clearNameErr()` 讓「動車型欄 ⇒ 兩條錯都清」
              // 在四個入口(自行輸入框 / 兩顆下拉 / 兩顆模式切換)是同一條不變式,不是三種寫法。
              clearNameErr();
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
              onChange={(e) => {
                setName(e.target.value);
                clearNameErr();
              }}
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
                clearNameErr(); // #378:同上,四個入口同一條不變式。
              }}
            >
              改用清單選車(廠牌/車型)
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
