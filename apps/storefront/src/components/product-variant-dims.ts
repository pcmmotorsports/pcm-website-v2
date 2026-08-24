// product-variant-dims.ts — 商品變體規格「維度」的純邏輯層(#888 由 ProductInfo.tsx 搬出)
//
// 🔴 為什麼搬出來(理由與行數無關):這 8 支函式 + 8 張標籤/排序表是**純函式**,零 React、
//   零 hook、零 props。留在 ProductInfo.tsx 裡它們**只能靠渲染整個元件來測**;搬出來可直接單元測。
// 🔴 本檔內容自 ProductInfo.tsx L55-165 **逐字搬移**(sed 抽出、未重打),只加了:
//   ①本檔頭 ②`import type { UIVariant }` ③9 個對外識別字的 `export`。
//   下方所有註解都是原檔承重註解(Sean 拍板紀錄 / 對抗審 F1 F2 / W2 泛化說明),隨碼一起搬。
//
// ⚠️ **已知缺口(#888 當場量到,不是猜的)**:`sortDimValues` / `WEAVE_ORDER` / `FINISH_ORDER`
//   在全 storefront 只有 8 處命中、**全部在原檔自己檔內、零測試引用** ⇒ 排序邏輯零守門。
//   ⇒ 誰要改排序:測試全綠對你零判別力,自己補一格再改。

import type { UIVariant } from '@/data/mock-products';

// OD-4c:把真變體 spec {weave, finish, special?} 折成 picker 2 維(Sean Q-OD4c-1/2=A、D3=A 真資料為準):
//   紋路(pattern)= weave + special 合併顯示 —— 12K/Kevlar 折進紋路(顯「12K斜紋」「Kevlar斜紋」),
//     移除原獨立「特殊」欄(Sean「特殊沒這選項」);
//   表面(finish)= 亮光/消光。**消光不寫死鎖** —— 真資料 12K 亦有消光(DB 24 變體),選項全由真變體
//     snap 決定(不照搬 OD enforceSurface/GLOSSY_ONLY 寫死;Sean Q-OD4c-1=A,避免少賣 24 變體)。
//
// W2(#265/#267、2026-07-04):選擇器泛化支援非 RPM 規格形狀(bonamici {color,material}、
//   cncracing {color}…)—— spec 含 weave/finish/special 任一 key = RPM 形狀、走現行 pattern/finish
//   合成維路徑(🔴 輸出 byte 不變硬約束、12 現有測試為行為錨);否則泛型模式:維 = spec 實際 key
//   (GENERIC_DIM_PRIORITY 排序、GENERIC_DIM_LABEL 顯中文、值原字直出、值序 = 變體首見序 =
//   匯入端 sort_order 序)。ProductSwatchPreview 為 RPM 紋路樣品卡、非 RPM 降級不渲染
//   (防 findSwatch fallback 顯錯誤碳纖樣品;通用色塊 hex_color 為後續獨立工作、見 #265)。
export type Dim = string; // RPM 模式 = 'pattern' | 'finish' 合成維;泛型模式 = spec 原始 key
const DIM_LABEL: Record<string, string> = { pattern: '紋路', finish: '表面' };
// 泛型維標籤(key 皆報價單 DB spec 實際命中:color=CNC/bonamici/eazigrip/lightech/extreme、
//   material=bonamici/materya、design/tier=eazigrip、version=lightech/extreme、
//   shift/quickshifter=extreme 腳踏後移);未列 key fallback 顯原字。
const GENERIC_DIM_LABEL: Record<string, string> = {
  color: '顏色',
  material: '材質',
  design: '款式',
  tier: '等級',
  version: '版本',
  finish: '表面', // 2026-07-12 E1:eazigrip GUARD/TANK 表面貼降級泛型後、表面軸標籤
  pack: '入數', // 2026-07-12 E3(Sean):儀表貼「PACK」→「入數」(值 1/2→一組/兩組 由報價單源頭)
  shift: '打檔', // 2026-07-24:extreme 腳踏後移打檔方向(正打 / 反打 / 正反打)
  quickshifter: '快排', // 2026-07-24:extreme 腳踏後移快排軸(快排專用 / 無快排;部分群無此軸)
};
// 泛型維順序:主軸(顏色)最前、表面次之;未列 key 排後、保持首見序(sort 穩定)。
const GENERIC_DIM_PRIORITY = ['color', 'finish', 'material', 'design', 'tier', 'version', 'shift', 'quickshifter'];
const WEAVE_LABEL: Record<string, string> = { Twill: '斜紋', Plain: '平織', Forged: '鍛造', Honeycomb: '蜂巢' };
const FINISH_LABEL: Record<string, string> = { Glossy: '亮光', Matt: '消光' };
const SPECIAL_LABEL: Record<string, string> = { '12K': '12K', Kevlar: 'Kevlar' };
const WEAVE_ORDER = ['Twill', 'Plain', 'Forged', 'Honeycomb'];
const FINISH_ORDER = ['Glossy', 'Matt'];

/** 紋路維 key:有 special 則「special|weave」合併、否則純 weave(空 weave → '') */
export function patternKey(v: UIVariant): string {
  const weave = v.spec.weave ?? '';
  const special = v.spec.special;
  return special ? `${special}|${weave}` : weave;
}
function patternLabel(key: string): string {
  const sep = key.indexOf('|');
  if (sep >= 0) {
    const special = key.slice(0, sep);
    const weave = key.slice(sep + 1);
    return `${SPECIAL_LABEL[special] ?? special}${WEAVE_LABEL[weave] ?? weave}`;
  }
  return WEAVE_LABEL[key] ?? key;
}
/** W2:RPM 形狀偵測 — 任一變體 spec 帶 weave/special(碳纖編織法/特殊材質)→ 走現行 RPM 合成維路徑。
 *  🔴 finish 不再單獨觸發(2026-07-12 Sean E1):eazigrip GUARD/TANK 表面貼只有 finish、無 weave,
 *  原以 finish 觸發會誤走 RPM 路徑(掛錯誤碳纖紋路預覽卡 ProductSwatchPreview + 排序退化)。
 *  RPM 碳纖恆有 weave(斜紋/平織/鍛造/蜂巢)→ 去掉 finish 觸發不影響 RPM 偵測;eazigrip 改走
 *  泛型模式(finish 當泛型維「表面」、值原字直出、無紋路卡)。
 *  🔴 已知假設(對抗審 F2、2026-07-04):以 key 名嗅探 = 假設非 RPM 品牌不用 weave/special 英文
 *  key。守衛在源頭:報價單 NEW_SUPPLIER_ONBOARDING 已列這些 key 為 RPM 保留字、新品牌 fetcher 禁用。 */
export function isRpmSpecShape(variants: UIVariant[]): boolean {
  return variants.some((v) => 'weave' in v.spec || 'special' in v.spec);
}
/** W2:泛型維收集 — variants spec 全部 distinct key、PRIORITY 先、未列 key 保持首見序 */
export function collectGenericDims(variants: UIVariant[]): string[] {
  const keys: string[] = [];
  for (const v of variants) {
    for (const k of Object.keys(v.spec)) {
      if (!keys.includes(k)) keys.push(k);
    }
  }
  const rank = (k: string) => {
    const i = GENERIC_DIM_PRIORITY.indexOf(k);
    return i < 0 ? 99 : i;
  };
  return keys.sort((a, b) => rank(a) - rank(b));
}
/** 變體在某維的值(RPM:pattern=合成 key、finish;泛型:spec 原始 key 直讀) */
export function variantDimValue(v: UIVariant, dim: Dim, rpm: boolean): string {
  if (!rpm) return v.spec[dim] ?? '';
  return dim === 'pattern' ? patternKey(v) : (v.spec.finish ?? '');
}
export function dimValueLabel(dim: Dim, value: string, rpm: boolean): string {
  if (!rpm) return value; // 泛型值原字直出(來源已繁中;未譯值後續內容輪處理)
  return dim === 'pattern' ? patternLabel(value) : (FINISH_LABEL[value] ?? value);
}
export function dimLabel(dim: Dim, rpm: boolean): string {
  return rpm ? (DIM_LABEL[dim] ?? dim) : (GENERIC_DIM_LABEL[dim] ?? dim);
}
/** 排序:紋路標準 weave(WEAVE_ORDER)在前、special 合併款(12K→Kevlar)在後;表面亮光在前;
 *  泛型維不重排(維持變體首見序 = 匯入端 sort_order 序) */
export function sortDimValues(dim: Dim, values: string[], rpm: boolean): string[] {
  if (!rpm) return values;
  if (dim === 'finish') {
    const rank = (k: string) => { const i = FINISH_ORDER.indexOf(k); return i < 0 ? 99 : i; };
    return [...values].sort((a, b) => rank(a) - rank(b));
  }
  const rank = (key: string): number => {
    const sep = key.indexOf('|');
    if (sep < 0) {
      const i = WEAVE_ORDER.indexOf(key);
      return i < 0 ? 50 : i; // 純 weave 0-3
    }
    const special = key.slice(0, sep);
    const weave = key.slice(sep + 1);
    const wi = WEAVE_ORDER.indexOf(weave);
    const si = special === '12K' ? 0 : special === 'Kevlar' ? 1 : 2;
    return 100 + si * 10 + (wi < 0 ? 9 : wi); // special 合併款排後
  };
  return [...values].sort((a, b) => rank(a) - rank(b));
}

export type SpecGroup = { dim: Dim; values: string[] };
