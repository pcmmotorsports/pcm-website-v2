import type { Money, MemberTier } from '../shared/types';

export type ProductId = string;

/**
 * Brand: 商品所屬廠牌(value-object)。
 *
 * 對齊 ADR-0003 §4 #1:
 * - design 字面是 string('CNC RACING')
 * - Medusa wire 是 brand collection FK(brand_id)
 * - domain 用 value-object;adapter 邊界雙向 resolve FK ↔ name
 *
 * 範例:Brembo / CNC RACING / Öhlins / Akrapovič / RIZOMA / Kineo / Materya
 * (歐洲改裝零件廠商;非車輛廠牌、車輛廠牌見 FitmentSpec.motoBrand)
 */
export type Brand = {
  id: string;
  /** 對外顯示名稱、design 字面、例:'CNC RACING' */
  name: string;
  /** URL slug、例:'cnc-racing' */
  slug: string;
};

/**
 * CategoryPath: 商品分類路徑(value-object)。
 *
 * 對齊 ADR-0003 §4 #2:
 * - design 字面是 string('引擎部品 · 排氣管')
 * - Medusa wire 是 category 樹(parent_id 巢狀)
 * - domain 用 value-object;adapter 邊界 parse 字串 ↔ 樹節點
 *
 * `segments` 為 `raw` 解析結果(以「·」與全形空格分隔);
 * 解析 helper 在 M-1-02 補(本 slice 為 type-only stub)。
 *
 * @see M-1-02 補解析 helper
 */
export type CategoryPath = {
  /** 例:'引擎部品 · 排氣管' */
  raw: string;
  /** 例:['引擎部品', '排氣管'] */
  segments: string[];
};

/**
 * FitmentSpec: 商品適配車型(value-object array element)。
 *
 * 對齊 ADR-0003 §4 #3:
 * - design 字面是自由字串('CBR600RR'、`string.includes` 比對)
 * - Medusa wire 是 metadata.vehicle_ids[]
 * - domain 用結構化 value-object;adapter 邊界斷詞自由字串 → 結構化
 *
 * `motoBrand`(車輛廠牌口語名)為 string、與 catalog `Brand`(商品廠牌)語意分離;
 * M-1 storefront 寫 VehicleFinder / FilterSide 時若需結構化、可升級為 MotoBrand value-object。
 *
 * @see M-1 升級 MotoBrand value-object
 */
export type FitmentSpec = {
  /** 車輛廠牌口語名(例:'Yamaha' / 'Honda' / 'Ducati')、非商品廠牌 */
  motoBrand: string;
  /** 車型代號(例:'CBR600RR' / 'MT-09') */
  modelCode: string;
  year?: number;
};

/**
 * PriceByTier: 三級會員多 tier 價格(keyed-map struct)。
 *
 * 對齊 ADR-0003 §4 #6:
 * - design 字面只一個 price 欄位
 * - Medusa wire 是 Price List(多 tier)
 * - domain 用 keyed-map 結構
 *
 * 註:ADR §4 #6 字面是 `Map<MemberTier, Money>`、本實作為 Record(JSON 序列化友善、
 * storefront server-side render 不需 hand-roll Map serializer);兩者語意等價。
 */
export type PriceByTier = Record<MemberTier, Money>;

/**
 * Product: 商品 entity(M-0-04 type stub、最小欄位集)。
 *
 * 對齊 ADR-0003 §3.1 命名規則(camelCase + 業務語意);
 * 推延欄位(對齊 Money / Customer JSDoc 樣式):
 * - description / images / inventory / variants(M-1-02 補)
 * - createdAt / updatedAt(M-1-02 entity 補)
 * - SEO metadata(M-1-09 補)
 */
export type Product = {
  id: ProductId;
  name: string;
  brand: Brand;
  category: CategoryPath;
  fitments: FitmentSpec[];
  priceByTier: PriceByTier;
};
