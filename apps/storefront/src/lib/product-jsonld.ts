// apps/storefront/src/lib/product-jsonld.ts — schema.org/Product JSON-LD builder(M-1-16c-4c SEO/AI 友善)
//
// 詳情頁 server component 注入 <script type="application/ld+json"> 給 Google 商品結果 / AI 助理讀。
//
// 🔴 經銷價防護(鐵則 12,三層第二道):
//   - builder 只收 MockProduct(UIVariant 型別只帶 price:number = general、**無 priceByTier**;
//     toUIProduct 釘 general、編譯期就擋經銷價)→ 結構上拿不到 store/premiumStore/cost。
//   - **逐欄白名單建構**:絕不 `...product` spread(防 originalPrice / tierLabel / 任何注入髒值
//     混進 JSON-LD)。新增欄位須顯式列入下方,測試以正向白名單(Object.keys ⊆ 允許集)守。
//   - lowPrice/highPrice/price 全取 product.variants[].price / product.price(皆 general)。
//
// 決策(審查 session 2026-06-01 拍):
//   - og:type=website(Q2=A、商品語意交本 JSON-LD @type:Product);本檔不管 OG(page.tsx generateMetadata 管)。
//   - ⛔ ~~offers 不放 availability(Q3=A、與 #161 不顯庫存一致、零 Merchant 誤導;可後補)~~
//     🔵 **2026-09-09 Sean 親自拍乙取代這一格**:offers 放 `availability`,而**全站一律
//     `BackOrder`(可訂購、需等候)、刻意【不讀】`products.availability` 那個欄位。**
//     ⇒ 舊拍板的**精神仍然成立**(不顯庫存、零 Merchant 誤導):全部同一個值 ⇒ Google
//       看不出誰缺貨。被取代的只有「不放這個欄位」那個做法。理由見 `buildOffers` 內註解。
//   - image 只放絕對 http(s) URL(MUST-FIX 1:目標 DB 34/933 image='/placeholder-product.png' 相對路徑、Google 拒收)。
//
// escape:序列化在 serializeProductJsonLd()(Next 官方 json-ld guide:把每個 < 換成 JS 跳脫序列
//   U+003C〔原始碼第 2 引數雙反斜線、runtime 6 bytes〕→ JSON 解析回 <、但 HTML 不誤判 </script> breakout)。

import type { MockProduct, UIFitment } from '@/data/mock-products';
import { isAbsoluteHttpUrl } from '@/lib/site-url';
import { safeJsonLd } from '@/lib/json-ld';

const SCHEMA_ORG = 'https://schema.org';
const PRICE_CURRENCY = 'TWD';

/**
 * 🔴🔴 **全站一律「可訂購、需等候」—— 而這是一個【刻意不看資料】的決定。**
 *
 * Sean 2026-09-09 拍乙,逐字:「乙 = 全部標『可訂購,需等候』。」
 * 他要的逐字是「**不要讓他知道缺貨**」(他 = Google)。
 *
 * 🛑 **所以本檔【不讀】`products.availability`** —— 那不是漏掉,是這一格的重點:
 *   讀了就會讓 Google 看得出哪 3,712 個商品缺貨,而**站上「缺貨」的東西其實買得到**
 *   (`packages/domain/src/catalog/types.ts:140` 逐字:「#214a 移閘後訂貨型仍可下單」;
 *    `packages/use-cases/src/place-order.ts:9` 逐字:「缺貨改 availability_at_checkout 快照不擋」)。
 *   ⇒ 照字面對映成 `OutOfStock`(schema.org 的意思是「這個買不到」)會是一句不真的話。
 *
 * ✅ **而 `BackOrder` 對【全部】商品都是真的**:
 *   · `in-stock` 的定義逐字含「現貨 / 廠商 **3-6 週**訂貨範圍內」⇒ 它本來就不保證現貨。
 *   · PDP 的 FAQ 逐字:「預購商品為下定後與原廠訂購,需等待 **2–12 週**」。
 *
 * 🔵 **順帶解掉一個問題**:正式庫有 **1,198 個商品的變體彼此狀態不一致**(同商品既有
 *   in-stock 又有 out-of-stock 的變體,2026-09-09 唯讀實查)。既然不讀那個欄位,
 *   「該講哪一個」這個沒有答案的問題就**不存在**了,不用另外處理。
 */
const AVAILABILITY = `${SCHEMA_ORG}/BackOrder`;

/**
 * 全新品。2026-09-09 唯讀掃正式庫 26,425 列:`title` / `subtitle` / `description` 三欄掃
 * 「二手|福利品|展示品|中古|拆機|瑕疵|整新|refurb|USED」⇒ **4 筆命中,而 4 筆全是誤命中**
 * (命中的是「快**拆機**構」這個詞,不是二手品);分類表 40 個大類逐一看過,無二手類。
 * 🟢 正對照:同一組欄位掃「碳|排氣|拉桿|螺絲|護|蓋|Carbon」⇒ 10,967 命中 ⇒ 尺是活的。
 */
const ITEM_CONDITION = `${SCHEMA_ORG}/NewCondition`;

/** 報價有效期 = 產生當下 + 一年(Sean 2026-09-09 拍甲)。 */
const PRICE_VALID_DAYS = 365;

/**
 * `priceValidUntil` 的 `YYYY-MM-DD`。
 *
 * 🔴 **刻意【不寫死日期字面】** —— 寫死的那個日期會過期,而過期之後 Google 會把整站的報價
 *   當成失效,**而不會有任何東西叫**。所以它從「產生當下」算,每次 render 都是新的一年後。
 * 🔵 用 UTC 取日期:這個欄位的粒度是「天」,而跨時區差一天對「一年後」沒有意義;
 *   用本地時區反而會讓同一份輸出在不同機器上不一樣(測試會抖)。
 */
function priceValidUntil(now: Date): string {
  const until = new Date(now.getTime() + PRICE_VALID_DAYS * 24 * 60 * 60 * 1000);
  return until.toISOString().slice(0, 10);
}

/**
 * 相容車型放進 JSON-LD 的**上限**(Sean 2026-09-09 拍甲:30 台)。
 *
 * 🔴 為什麼要有上限(唯讀量正式庫,2026-09-09):一顆商品對到幾台車 ——
 *   中位數 **3**、p90 **19**、p99 **199**、**最大 1,709**。
 *   ⇒ 不設限的話,尾巴那 1% 會讓單頁多出數十 KB,而那對讀它的 AI 沒有多幫助。
 *   ⇒ 30 蓋得住 p90(19),而**畫面上的適用車款表永遠是完整的** —— 被截的只有 JSON-LD。
 *
 * 🛑 **被截時【不宣稱這是全部】** —— `isAccessoryOrSparePartFor` 的語意是「這是它的配件」,
 *   它本來就不宣稱窮舉。所以截斷不會產生一句假話;而**加一個「共 N 台」的欄位才會**
 *   (那等於說「我列的就是全部」)⇒ 不加。
 */
export const FITMENT_JSONLD_LIMIT = 30;

export type ProductJsonLd = Record<string, unknown>;

/**
 * 相容車型 → schema.org。
 *
 * 📌 **型別合法性查過**(2026-09-09 讀 schema.org):`Motorcycle` 的階層逐字是
 *   `Thing > Product > Vehicle > Motorcycle` ⇒ `Vehicle` 是 `Product` 的子型別;
 *   而 `isAccessoryOrSparePartFor` 的 range 就是 `Product` ⇒ 餵 `Motorcycle` **型別合法**。
 * ⚠️ **而 schema.org 沒有把它寫成「車輛相容性」的專用屬性** ⇒ 只能說型別合法、語意貼近
 *   (「這個零件是那台車的配件或備品」),**不宣稱這是標準做法**。
 * 🛑 **Google 的商品複合式搜尋結果不吃這個欄位** ⇒ 它對排名沒有直接幫助。
 *   這一格的價值在**讀原始 schema.org 的 AI 爬蟲**,不是 Google SEO。
 *
 * 🔴 **排序是決定性的,不是「查詢回來的前 30 筆」** —— 那個順序由資料庫給、沒有意義而且會變
 *   ⇒ 同一顆商品今天與明天可能列出不同的 30 台,而**那種漂移查不出原因**。
 *   ⇒ 判準:**廠牌 → 車型 → 年份起**,全部用 `localeCompare` 的字典序(數字年份升冪)。
 *     那個順序客人看得懂(同廠牌的車排在一起),而且**只由資料本身決定** ⇒ 跑幾次都一樣。
 */
function buildFitmentRefs(fitments: readonly UIFitment[]): Array<Record<string, unknown>> {
  // 🔴 先去重再排序再截斷:同一台車可能同時來自 direct 與 inherited 兩條路
  //   (`product_fitments` 與 `product_fitments_effective`)⇒ 不去重的話 30 個名額會被重複的吃掉。
  const seen = new Map<string, UIFitment>();
  for (const f of fitments) {
    const key = `${f.motoBrand}\u0000${f.modelCode}\u0000${f.yearStart ?? ''}`;
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()]
    .sort(
      (a, b) =>
        a.motoBrand.localeCompare(b.motoBrand) ||
        a.modelCode.localeCompare(b.modelCode) ||
        (a.yearStart ?? 0) - (b.yearStart ?? 0),
    )
    .slice(0, FITMENT_JSONLD_LIMIT)
    .map((f) => ({
      '@type': 'Motorcycle',
      // 🔵 `name` 是客人講得出來的那個字串(「Ducati Panigale V4」)—— AI 要拿它去比對客人問的話。
      name: `${f.motoBrand} ${f.modelCode}`.trim(),
      brand: { '@type': 'Brand', name: f.motoBrand },
      // 年份只在**有值**時放,而且照 `UIFitment` 的語意:`yearEnd === null` = 開放式(2025+)。
      ...(f.yearStart !== undefined
        ? { modelDate: f.yearEnd == null ? `${f.yearStart}` : `${f.yearStart}/${f.yearEnd}` }
        : {}),
    }));
}


/** schema.org/Product JSON-LD 物件(逐欄白名單;見檔頭 🔴 經銷防護)。 */
export function buildProductJsonLd(
  product: MockProduct,
  opts?: { url?: string; now?: Date },
): ProductJsonLd {
  const jsonLd: ProductJsonLd = {
    '@context': SCHEMA_ORG,
    '@type': 'Product',
    name: product.name,
    // brand:RPM-only 期 = "RPM CARBON"(資料驅動 product.brand、非 hardcode)
    brand: { '@type': 'Brand', name: product.brand },
    // description:真 subtitle(空/空白 → fallback product.name、永遠非空字串)
    description: nonEmptySubtitle(product.subtitle) ?? product.name,
    offers: buildOffers(product, opts?.now ?? new Date()),
  };

  // image:只放絕對 http(s) URL(相對路徑 / placeholder / bare-key 過濾;全不合格 → 省略)
  const images = (product.images ?? []).filter(isAbsoluteHttpUrl);
  if (images.length > 0) {
    jsonLd.image = images;
  }

  // 相容車型(M-4b GEO):畫面上那張適用車款表**同一份資料**(`product.fitments`),不另外算一份。
  //   🔴 另外算一份的那天不會有東西叫:兩份都畫得出來、只是列的車不一樣。
  const fitmentRefs = buildFitmentRefs(product.fitments ?? []);
  if (fitmentRefs.length > 0) {
    jsonLd.isAccessoryOrSparePartFor = fitmentRefs;
  }

  // sku ← 真主碼 productCode(無 → 省略,不用 slug 冒充 sku)
  if (product.productCode) {
    jsonLd.sku = product.productCode;
  }

  // category(raw 字串如 "碳纖維部品")
  if (product.category) {
    jsonLd.category = product.category;
  }

  // url ← canonical(僅 caller 解析出 base URL 時傳入;prod 未設環境變數則省略、見 site-url.ts)
  if (opts?.url) {
    jsonLd.url = opts.url;
  }

  return jsonLd;
}

/**
 * 序列化為注入 <script> 的精確字串(production 用此、非在 page 重寫)。
 * 走共用 safeJsonLd(@/lib/json-ld):escape 每個 < 防 </script> breakout(Next 官方寫法)。
 * (2026-06-05 安全稽核 M-2:原 inline .replace 抽成共用 helper,與 ProductFAQ 同源、不分歧。)
 */
export function serializeProductJsonLd(
  product: MockProduct,
  opts?: { url?: string; now?: Date },
): string {
  return safeJsonLd(buildProductJsonLd(product, opts));
}

/** subtitle trim 後非空才回、否則 undefined(讓 caller fallback)。 */
function nonEmptySubtitle(subtitle: string | undefined): string | undefined {
  const trimmed = subtitle?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * offers:多變體且價有高低 → AggregateOffer(lowPrice/highPrice/offerCount);
 * 變體同價 / 無變體 → 單 Offer。價全取 general(型別層無經銷價)。
 *
 * 🔵 三個新欄位(availability / itemCondition / priceValidUntil)**每一種形狀都帶**,
 *   包含 `AggregateOffer` —— 它繼承 `Offer`,那三個屬性在它身上一樣合法。
 *   ⇒ 📌 只加在單 Offer 上的話,**有價差的商品會安靜地少三個欄位**,而輸出看起來完全正常。
 */
function buildOffers(product: MockProduct, now: Date): Record<string, unknown> {
  // 🔴 三個共用欄位走**同一個運算式**餵三種形狀,不是各寫一份(各寫一份就會分岔)。
  const common = {
    priceCurrency: PRICE_CURRENCY,
    availability: AVAILABILITY,
    itemCondition: ITEM_CONDITION,
    priceValidUntil: priceValidUntil(now),
  };
  const variantPrices = (product.variants ?? []).map((v) => v.price);

  if (variantPrices.length > 0) {
    const lowPrice = Math.min(...variantPrices);
    const highPrice = Math.max(...variantPrices);
    if (lowPrice !== highPrice) {
      return {
        '@type': 'AggregateOffer',
        ...common,
        lowPrice,
        highPrice,
        offerCount: variantPrices.length, // 精確變體數(CONSIDER 7)
      };
    }
    return { '@type': 'Offer', ...common, price: lowPrice };
  }

  return { '@type': 'Offer', ...common, price: product.price };
}
