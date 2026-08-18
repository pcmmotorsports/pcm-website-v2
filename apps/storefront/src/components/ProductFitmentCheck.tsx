'use client';

// ProductFitmentCheck.tsx — 商品頁「是否適用我的車」§7 保守適用比對(V-2b;掛 ProductFitments 段首)。
// 讀全站選車 context(vehicle-context;首頁/型錄選車寫入=§6 全站連動)→ checkFitment(product.fitments,…)
// 顯四態:match「✓ 適用」/ no-match「✗ 未列」+ 聯絡 / qualified「請確認年份」/ undetermined 不判定。
// 無 context 車款 → 現選入口(愛車快選 chips + VehicleSelect;選定寫 context=全站連動)。
//
// 🔴 §7 正確性紅線(錯誤 ✓ 比空白更糟):判定一律走 lib/fitment-match.checkFitment(domain
// matchFitmentYear/isYearUnrestricted 年份單一來源+名稱字面 NFKC 精確比對=V-2h/MF-1 廢 slugify 橋接);
// 車種鐵律零猜。display-only:不寫庫、不擋加入購物車。chosen 恆手握品牌/車型名稱字面(比對一律回字典
// 字面);slugify 僅用於 writeVehicleContext 的 URL/id slug 空間、不再進比對。

import { useEffect, useRef, useState } from 'react';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { UIFitment } from '@/data/mock-products';
import { checkFitment, type FitmentCheckStatus, type FitmentCheckVehicle } from '@/lib/fitment-match';
import { clearVehicleContext, readVehicleContext, writeVehicleContext } from '@/lib/vehicle-context';
import { slugify } from '@/lib/vehicle-taxonomy';
import { vehicleLabel } from '@/lib/vehicle-match';
import { VehicleSelect } from './VehicleSelect';
import { GarageChips, type GarageChipItem } from './GarageChips';

/** context/picker 選定的車款(顯示名 + slug + 年;供比對與顯示) */
type Chosen = { brandName: string; modelName: string; year?: number };

/** V-2c:URL `?vehicle=` 解析後的名稱字面(route 端 parseVehicleFromUrl 對照 taxonomy 解出)。 */
export type PdpUrlVehicle = { brandName: string; modelName?: string; year?: number };

/**
 * V-2h/MF-2:URL 車款三態(修「URL 車款無法解析卻退回讀舊鏡、顯過期舊車判定」)。
 * - `null`      無 `?vehicle=` 參數 → 照舊讀 context 鏡(絕大多數 PDP)。
 * - `'invalid'` 參數在、但對不到 taxonomy(壞/過期連結、目錄已無此車)→ **不讀鏡**、顯「重新選車」入口。
 * - `PdpUrlVehicle` 已解析(brand-only 亦算解析、走現選入口)。
 */
export type PdpUrlVehicleState = PdpUrlVehicle | 'invalid' | null;

function toCheckVehicle(c: Chosen): FitmentCheckVehicle {
  // V-2h/MF-1:比對吃名稱字面(NFKC 精確、廢 slugify 橋接);slug 仍用於 writeVehicleContext 的 URL/id 空間。
  return { kind: 'dict', brandName: c.brandName, modelName: c.modelName, year: c.year };
}
function chosenLabel(c: Chosen): string {
  return [c.year, vehicleLabel(c.brandName, c.modelName)].filter(Boolean).join(' ');
}

/** URL resolved 車款(名稱字面)→ 同步 sessionStorage 鏡(brandId/modelId 用 slugify=URL/id slug 空間)。 */
function writeMirrorFromResolved(r: PdpUrlVehicle): void {
  writeVehicleContext({
    brandId: slugify(r.brandName),
    modelId: r.modelName ? slugify(r.modelName) : undefined,
    year: r.year,
    label: [r.brandName, r.modelName, r.year].filter(Boolean).join(' '),
    brandName: r.brandName,
    modelName: r.modelName,
  });
}

/**
 * V-2h/MF-3:chosen(名稱字面)→ URL 短版 param `brandId:modelId[:year]`(taxonomy id 空間、含碰撞
 * 序號=正確 round-trip;非 slugify(name) 免丟序號)。名稱對不到 taxonomy(理論不達:chosen 恆源自
 * 字典選項)→ null,呼叫端不寫 URL。
 */
function vehicleUrlParamFor(c: Chosen, motoBrands: MockMotoBrand[]): string | null {
  const brand = motoBrands.find((b) => b.name === c.brandName);
  const model = brand?.models.find((m) => m.name === c.modelName);
  if (!brand || !model) return null;
  return [brand.id, model.id, c.year].filter(Boolean).join(':');
}

export function ProductFitmentCheck({
  fitments,
  motoBrands,
  garage = [],
  urlVehicle = null,
  onPersistVehicle,
}: {
  fitments: UIFitment[];
  motoBrands: MockMotoBrand[];
  garage?: GarageChipItem[];
  /** V-2c:URL `?vehicle=` 恆為第一真相 — 有值時優先於 context 鏡、掛載即回寫同步鏡。
   *  V-2h/MF-2:三態(見 PdpUrlVehicleState)—'invalid' 表參數在但對不到 taxonomy。
   *  V-2h/MF-3:ProductPage 反應式衍生(useSearchParams+taxonomy)→ 同頁 URL 變更即重判。 */
  urlVehicle?: PdpUrlVehicleState;
  /** V-2h/MF-3:選車回寫 URL(param=`brandId:modelId[:year]` 或 null 清除;由 ProductPage 做
   *  router.replace 條件式 skip);URL=第一真相 settle point。缺=不回寫(如測試直傳 prop)。 */
  onPersistVehicle?: (param: string | null) => void;
}) {
  // V-2h/MF-2:URL 車款三態拆解 — 'invalid'(參數在、對不到)與 null(無參數)行為不同。
  const urlInvalid = urlVehicle === 'invalid';
  const urlResolved: PdpUrlVehicle | null = urlVehicle && urlVehicle !== 'invalid' ? urlVehicle : null;

  // V-2c:初始 chosen 優先序=URL vehicle > context 鏡(useState initializer 讀 prop、SSR 同繪零分歧;
  // 鏡只能在 client effect 讀)。URL 車款名稱齊(brand+model)才可判定;brand-only 走現選入口。
  // MF-2:'invalid' → urlResolved=null → 初始無 chosen(不讀鏡=不顯過期舊車)。
  const [chosen, setChosen] = useState<Chosen | null>(() =>
    urlResolved?.modelName
      ? { brandName: urlResolved.brandName, modelName: urlResolved.modelName, year: urlResolved.year }
      : null,
  );
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState<{ brand: string; model?: string; year?: number } | null>(null);
  // Q27 A2:使用者一旦動過 picker(碰過任一 onPick/onClear),就以 sel 為準;沒動過且 qualified
  // 才用 chosen 回填。理由:沒有這旗標的話,qualified 態按「清除廠牌」⇒ setSel(null) ⇒ 下一輪
  // render 立刻又用 chosen 回填、欄位永遠清不掉。旗標讓「使用者碰過」與「還沒碰過」分得開。
  const [selTouched, setSelTouched] = useState(false);
  // A10b:建議清單 state 與決策腦呼叫已搬進 GarageChips(全站單一份),本檔不再自持。
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
    // MF-2:URL 車款無法解析('invalid')→ 不讀鏡、不寫鏡(避免顯過期舊車判定);chosen 留 null=現選入口。
    if (urlInvalid) return;
    if (urlResolved) {
      writeMirrorFromResolved(urlResolved);
      return;
    }
    const ctx = readVehicleContext();
    if (ctx && ctx.brandName && ctx.modelName) {
      setChosen({ brandName: ctx.brandName, modelName: ctx.modelName, year: ctx.year });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // V-2h/MF-3:同頁 URL `?vehicle=` 變更後重新同步 chosen(URL=第一真相 settle point;修 mount-only
  // 舊值不重判)。urlKey=urlVehicle 的穩定序列化;lastUrlKeyRef 守門「只在真變更才動」——mount(key
  // 未變)與 StrictMode 重跑(同 key)皆早退,避免蓋掉 mount effect 的鏡讀入 / 誤清。🔴 此處**絕不讀鏡**
  // (被清除=absent 時清判定、不回填舊鏡=尊重清除意圖);讀鏡僅限 mount effect 的 carry-in。
  const urlKey = JSON.stringify(urlVehicle ?? null);
  const lastUrlKeyRef = useRef(urlKey);
  useEffect(() => {
    if (lastUrlKeyRef.current === urlKey) return; // mount / StrictMode 同 key 重跑 → 不動
    lastUrlKeyRef.current = urlKey;
    setEditing(false);
    if (urlInvalid) {
      setChosen(null); // 變成壞連結 → 清判定、顯重新選車(MF-2 語意)
      return;
    }
    if (urlResolved?.modelName) {
      setChosen({ brandName: urlResolved.brandName, modelName: urlResolved.modelName, year: urlResolved.year });
      writeMirrorFromResolved(urlResolved);
      return;
    }
    if (urlResolved) {
      setChosen(null); // brand-only → 名稱不齊不判定、現選入口(零猜);鏡仍同步 brand
      writeMirrorFromResolved(urlResolved);
      return;
    }
    setChosen(null); // absent(被清除)→ 清判定、不讀鏡
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  // 無 fitments(通用款/無資料)→ 整段不渲染(同 ProductFitments 空狀態)
  if (!fitments || fitments.length === 0) return null;

  const commit = (c: Chosen) => {
    setChosen(c);
    setEditing(false);
    setSel(null);
    setSelTouched(false); // 回到「未碰過」,下一輪 qualified 才能再回填
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

    // V-2h/MF-3:選車回寫 URL(URL=第一真相 settle point;ProductPage router.replace 條件式 skip)。
    // param 用 taxonomy id(vehicleUrlParamFor)確保 round-trip 消歧;URL 變更後 reactive effect 由 URL
    // 收斂(setChosen 同值=冪等、chosen 與 URL 不分歧);param===現值時 ProductPage skip=chosen 已樂觀設妥。
    // 🔴 對不到 taxonomy(理論不達:chosen 恆源自字典選項)→ param=null → 不寫 URL(null 語意=清除、
    // 誤傳會清掉剛選的車;guard 對齊 vehicleUrlParamFor 檔頭契約)。
    const param = vehicleUrlParamFor(c, motoBrands);
    if (param) onPersistVehicle?.(param);
  };

  const status: FitmentCheckStatus | null = chosen ? checkFitment(fitments, toCheckVehicle(chosen)) : null;

  // Q27 A1:qualified 態要同時看到結果框與 picker(補年份),其餘三態逐字不變(二選一)。
  // 🔴 直接寫在 JSX 條件式(不抽 const)——`chosen && !editing` 讓 TS 在該分支內把 `chosen` narrow
  // 成非 null,抽成獨立 boolean 變數會丟失這個 narrowing。
  // Q27 A2:qualified 且使用者還沒碰過 picker → 用 chosen 回填廠牌/車型(不帶 year,那正是要補的格);
  // 使用者碰過(selTouched)或已有 sel → 一律以 sel 為準(見上方 selTouched 註解)。
  const pickerVehicle =
    selTouched || sel
      ? sel
      : status === 'qualified' && chosen
        ? { brand: chosen.brandName, model: chosen.modelName }
        : null;
  // Q27 A4:qualified 時 picker 在手機(≤1023px)強制展開,否則客人看不到補年份的欄位。
  const pickerEffectivelyOpen = pickerOpen || status === 'qualified';
  const pickerLabel = status === 'qualified' ? '選一下年份，就能給您確定的答案' : '確認是否適用您的車';

  return (
    <div className="pfc">
      {chosen && !editing && (
        <div className={`pfc-result pfc-${status}`} role="status">
          <span className="pfc-badge" aria-hidden="true">
            {status === 'match' ? '✓' : status === 'no-match' ? '✗' : '?'}
          </span>
          <div className="pfc-msg">
            {status === 'match' && <><b>適用您的 {chosenLabel(chosen)}</b></>}
            {status === 'no-match' && (
              <>
                <b>{chosenLabel(chosen)} 未列於適用清單</b>
                <span className="pfc-sub">不確定?<a href="/info/shipping">聯絡我們確認</a></span>
              </>
            )}
            {status === 'qualified' && (
              <>
                <b>此商品適用 {vehicleLabel(chosen.brandName, chosen.modelName)},但有年份限制</b>
                <span className="pfc-sub">請確認您的年份是否在下方適用車款表範圍內</span>
              </>
            )}
            {status === 'undetermined' && (
              <>
                <b>已記下您的車款</b>
                <span className="pfc-sub">下單後我們會人工為您確認是否適用</span>
              </>
            )}
          </div>
          {/* Q28②(D-221-A ①-2):「清除車輛」= 現行「更改車款」的展開行為 + `setChosen(null)`(清掉判定結果 ——
              **這才是與舊「更改車款」真正的行為差**,舊的只清 `sel`、判定結果留著)+ 清 `vehicle-context` 鏡
              + 🔴 **清 URL**(`onPersistVehicle?.(null)`)。
              🔴 **URL 那一下是承重的,不是順手**(D-222-A ① 裁 A):本站架構 **URL 才是真相源**
              (`products-url-state.tsx:325` 逐字「鏡恆跟隨 URL 真相」)⇒ 只清鏡不清 URL 的話,
              mount initializer 會從 URL 把車寫回來 —— **狀態根本沒被清過,只是畫面暫時看不到**,
              而 Sean 拍板這條的原話抱怨正是「舊車跟著跑」。拿掉這行 = 把拍板做成裝飾。
              (prop 契約本就寫 null=清除、父層支援;URL 變更後 reactive effect 走 absent 分支冪等、不打架。) */}
          <button
            type="button"
            className="pfc-link"
            onClick={() => {
              setSel(null);
              setSelTouched(false);
              setPickerOpen(true);
              setEditing(true);
              setChosen(null);
              clearVehicleContext();
              onPersistVehicle?.(null);
            }}
          >
            清除車輛
          </button>
        </div>
      )}
      {(!chosen || editing || status === 'qualified') && (
        <div className={`pfc-picker${pickerEffectivelyOpen ? ' pfc-picker-open' : ''}`}>
          <div className="pfc-picker-label">{pickerLabel}</div>
          {/* MF-2:URL 車款對不到 taxonomy(壞/過期連結)→ 提示重新選車、不顯任何過期舊車判定 */}
          {urlInvalid && (
            <p className="pfc-sub pfc-invalid" role="status">先前的車款連結已失效,請重新選擇您的車。</p>
          )}
          {/* A10b:自刻的 chips + 建議清單退場,換全站唯一的 GarageChips(設計稿 C4 After 行內密度)。
              PDP 沒有 cascade reducer、走 `commit()` ⇒ 用 A9 的互斥 `onApply` 出口。
              🔴 只換 chips 這一區;上面 :213-229 的四態判定文案逐字不動(§7 正確性紅線:
                 錯誤的 ✓ 比空白更糟),`先前的車款連結已失效` 三態提示也留在原地。 */}
          <GarageChips
            garage={garage}
            motoBrands={motoBrands}
            variant="inline"
            onApply={(a) => commit({ brandName: a.brand, modelName: a.model, year: a.year })}
          />
          {/* V-2d③ 手機收合入口(≤1023px 未展開才顯、桌機 CSS 藏);點開展下方三層選單 */}
          <button type="button" className="pfc-expand" onClick={() => setPickerOpen(true)}>
            選擇車款,確認是否適用
          </button>
          {/* ⚠️ `onPickModel` / `onPickYear` 兩條走 `commit()` 的路**刻意不寫** `setSel`/`setSelTouched` ——
              `commit()` 同批次就把兩者設回 `null`/`false`,寫了永遠觀察不到,只會讓後人以為那兩行承重(審查 N2)。 */}
          <div className="pfc-select">
            <VehicleSelect
              motoBrands={motoBrands}
              vehicle={pickerVehicle}
              onPickBrand={(name) => { setSel({ brand: name }); setSelTouched(true); }}
              onPickModel={(p) => {
                commit({ brandName: p.brand, modelName: p.model }); // 選到車型即比對(年份可後補)
              }}
              onPickYear={(year) => {
                // 🔴 Q27 A3:qualified 回填讓這條路第一次可達 —— 讀 `pickerVehicle`(回填值),
                // 不是 `sel`(未碰過時仍是 null,讀 sel 會早退、回填等於白做)。
                if (!pickerVehicle?.model) return;
                commit({ brandName: pickerVehicle.brand, modelName: pickerVehicle.model, year });
              }}
              onClearBrand={() => { setSel(null); setSelTouched(true); }}
              onClearModel={() => {
                setSel(pickerVehicle ? { brand: pickerVehicle.brand } : null);
                setSelTouched(true);
              }}
              onClearYear={() => {
                setSel(pickerVehicle ? { brand: pickerVehicle.brand, model: pickerVehicle.model } : null);
                setSelTouched(true);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
