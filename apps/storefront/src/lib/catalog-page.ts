import { hasNoRealImage, parseImageTrim } from '@pcm/domain';

import { formatCardFits } from '@/lib/product-card-fits';
import type { MockProduct, UIFitment } from '@/data/mock-products';

export type CatalogListRow = {
  id: string;
  title: string | null;
  subtitle: string | null;
  handle: string | null;
  availability: string | null;
  price_general: number | null;
  card_image: string | null;
  fits: string | null;
  brand_name: string | null;
  brand_slug: string | null;
  category_raw: string | null;
  /** S4:RPC 投影的原始 fitments jsonb(公開車輛相容資料);shape 不保證 → 由 toCardFitments 白名單收。 */
  fitments?: unknown;
  /** trim 線 S4a:卡片首圖去白邊 bbox jsonb(RPC 第 13 鍵、migration 20260719150000);shape 不保證 → domain parseImageTrim 收斂;apply 前無此鍵=undefined。 */
  card_image_trim?: unknown;
};

/**
 * S4:RPC fitments jsonb → 卡片用 UIFitment[](白名單四欄:motoBrand/modelCode/yearStart/yearEnd)。
 * yearEnd 三態忠實保留(null=開放式 / 省略=單年 / number=明確迄年);車款名皆空的元素丟棄;非陣列/空 → undefined。
 */
export function toCardFitments(raw: unknown): UIFitment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: UIFitment[] = [];
  for (const el of raw) {
    if (!el || typeof el !== 'object') continue;
    const r = el as Record<string, unknown>;
    const motoBrand = typeof r.motoBrand === 'string' ? r.motoBrand : '';
    const modelCode = typeof r.modelCode === 'string' ? r.modelCode : '';
    if (!motoBrand && !modelCode) continue;
    const f: UIFitment = { motoBrand, modelCode };
    if (typeof r.yearStart === 'number') f.yearStart = r.yearStart;
    if (r.yearEnd === null) f.yearEnd = null;
    else if (typeof r.yearEnd === 'number') f.yearEnd = r.yearEnd;
    out.push(f);
  }
  return out.length > 0 ? out : undefined;
}

function hashIdToNumber(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/**
 * 卡片路徑專用的 UI shape —— **與 `MockProduct` 只差 `price` 一個欄位,而那個差別是承重的。**
 *
 * 🔴 **同一個型別被兩條保護程度不同的路共用 ⇒ 型別在說謊,而 typecheck 不會叫。**
 *   `MockProduct.price: number` 這個宣告:
 *     · 對走 domain 那條路是**真的** —— `packages/adapters/src/supabase/mappers/product.ts:206`
 *       對 `price_general === null` 直接 `throw`,保證了它。
 *     · 對走 RPC 這條路是**靠 `?? 0` 撐出來的** —— 也就是把「查不到價格」偽造成「0 元」。
 *   ⇒ 本型別存在的唯一理由:**把那個謊拆成兩個型別。**
 *
 * ⚠️ 為什麼不直接把 `MockProduct.price` 放寬(甲案):量過了,24 處 error / 9 支檔,
 *   而它會把「價格桶」(`products-filter-logic.ts:22`)與購物車一起綁進同一顆 commit
 *   ⇒ 兩塊驗證強度不同的東西綁一顆,弱的那塊會繼承強的背書。**那兩塊各自要開片。**
 */
export type CatalogCardProduct = Omit<MockProduct, 'price'> & { price: number | null };

/** List view → ProductCard 的最小公開 UI shape；不接觸 detail 或 tier price。 */
export function catalogRowToUIProduct(row: CatalogListRow): CatalogCardProduct {
  return {
    id: hashIdToNumber(row.id),
    slug: row.handle ?? row.id,
    brand: row.brand_name ?? '',
    brandSlug: row.brand_slug ?? undefined,
    name: row.title ?? '',
    subtitle: row.subtitle ?? undefined,
    // 🔴🔴 **卡片這條路【不帶 fitments 陣列】—— 只帶算好的那句字串。**(2026-09-06 線 `front`)
    //   量到的:preview 上 `/products?per=100&vehicle=ducati:scrambler-1100-club-italia`
    //   回應 **4,477,365 bytes**、其中 `motoBrand` 出現 **40,278** 次;不帶車的同一頁 693,655 / 239
    //   ⇒ 每筆 fitment ≈ 95 bytes(兩個獨立車款各算一次:96.5 與 94.5, 對得起來)。
    //   而那整包在清單頁的**唯一**用途, 是 `ProductCard.tsx` 那一行 `formatCardFits(p.fitments, p.fits)`
    //   ⇒ 它把陣列收成「N 款車型」或「單一車款 + 年份」**一個字串**。
    //   ⇒ 📌 **送 40,278 筆進瀏覽器, 產出是四個字。** 而它同時把那頁的 `unstable_cache`
    //   條目推過 2 MB 上限 ⇒ 正式站逐字 `items over 2MB can not be cached (2679379 bytes)`
    //   ⇒ **那個 key 永遠寫不進去**(板列 `⟦search-CATALOGPAGE2MB⟧`)。
    //
    // 🟢 **為什麼畫面逐字不變**:`formatCardFits(undefined, x)` 第一句就是
    //   `if (!fitments || fitments.length === 0) return fallback;` ⇒ 回的是這裡算好的同一個字串。
    //   ⇒ 🛑 **`ProductCard` 一個字都沒改** ⇒ 它其他呼叫端(走 domain 那條路、`fitments` 是真的)行為零改動。
    //
    // 🛑 **`fitments` 這個鍵【整個不給】, 不是給 `undefined`** —— RSC/JSON 對兩者不保證同一個 bytes,
    //   而本片存在的理由就是 bytes。⇒ 型別上它是選填, 不給是合法的。
    // ⚠️ **代價寫明**:`CatalogCardProduct.fits` 的語意從「DB 原始字串」變成「**顯示標籤**」。
    //   卡片那條路上沒有別人讀它的原始值(`git grep -n 'CatalogCardProduct' -- apps/ packages/` ⇒
    //   消費端 `ProductCard` / `ProductRail` / `ProductsPage` / `BrandPage*` / `brand-products.ts`,
    //   逐支 grep `fitments` ⇒ **只有 `ProductCard.tsx:287` 是執行碼, 其餘命中全是註解**)。
    //   🔴 而 PDP / 購物車那條路**不經過本函式**(它們走 domain mapper)⇒ 那邊的 `fits` 仍是原始值。
    fits: formatCardFits(toCardFitments(row.fitments), row.fits ?? '通用款'),
    // 🔴 **這裡刻意【不】補預設值。**原本是 `row.price_general ?? 0`,而那一行把
    //   「查不到價格」偽造成「0 元」。Sean 2026-08-25 拍板之後,那兩件事的處置**相反**:
    //     · `null`(查不到)⇒ 卡片留著、價格印「—」(他當天稍晚拍的乙案)
    //     · `0`(贈品 / 買一送一的那個「送」/ 試用品)⇒ 印「NT$ 0」(他早先拍的乙案)
    //   ⇒ **兩個拍板各要一半,而一行 `?? 0` 把兩半黏在一起。**
    //   ✅ **兩半都落地了**:片A(`e31f22ae`)在這裡把 `null` 與 `0` 分開;
    //      片B 在 `Price.tsx` 把判準拆成 `isRenderablePrice`(`>= 0`, 顯示價)與
    //      `isRenderableOriginalPrice`(`> 0`, 劃掉的原價)。
    //      ~~片A 當下這裡曾寫「**應該**印 NT$ 0」(那時 `Price.tsx` 還是 `> 0`, 0 仍印槓)~~ ⇒ 已成立。
    //   ⚠️ 而**顯示層做完不等於贈品可以上線** —— 上架 `sync_product_variant_group` 與
    //      結帳 `create_order` 仍然拒絕 `<= 0`(皆活庫實比)。那是另一片。
    //   ⚠️ 加回任何 `?? 0` / `|| 0` / `price!` 都會把它們重新黏起來,而**畫面上看不出來**。
    //   ⚠️ `?? null` 是**把 `undefined` 收成 `null`**, 與被拿掉的 `?? 0` 是相反的東西:
    //      前者不編造價格, 後者編造。RPC 回的是 `row.item as CatalogListRow`(無 runtime 驗證)
    //      ⇒ 缺鍵時 `row.price_general` 是 `undefined`, 會穿過宣告的 `number | null`
    //      (codex R1 nit)。`Price.tsx` 的 `typeof v === 'number'` 擋得住它, 而**型別契約不該說謊**。
    //   🔴 **而 `?? null` 有一個代價,寫出來(codex R2 nit)**:它把兩件事合併成同一個值 ——
    //      「RPC 契約破了(缺鍵)」與「這個商品真的沒有價格」。畫面上兩者都印「—」是對的,
    //      **而故障來源從此看不出來。** 要分開,得在 RPC 邊界做 runtime 驗證(本片不做、另一片)。
    price: row.price_general ?? null,
    origPrice: null,
    isNew: false,
    isSale: false,
    inStock: row.availability === 'in-stock',
    category: row.category_raw ?? '',
    color: 'silver',
    imgTone: 'neutral',
    // 🔴🔴 ⟦fc-SUPPLIERPLACEHOLDER⟧ **這條路【不經過】adapter mapper。**
    //    `/products` 商品目錄與品牌頁走 RPC `search_catalog_by_vehicle` ⇒ 直接吃 `row.card_image`,
    //    而那是 view 的 `p.images ->> 0`(**未濾的原圖**)。
    //    ⇒ ⇒ 🎯 **只修 mapper 那一半 ⇒ 客人最常去的那一頁照樣看到供應商的德文佔位圖**,
    //      而那個狀態**沒有人會回報** —— 客人只會覺得這家店的照片很爛。
    //    ✅ 兩處共用 `@pcm/domain` 的**同一份** `SUPPLIER_PLACEHOLDERS`(不複製清單:兩份會分岔, 而分岔不會紅)。
    image: row.card_image && !hasNoRealImage(row.card_image) ? row.card_image : null,
    // trim 線 S4a:與 adapter mapper 同一顆 domain parseImageTrim 收斂(單一來源、髒數據=undefined → cover fallback)。
    // 🔴 ⟦fc-SUPPLIERPLACEHOLDER⟧ **首圖被判成佔位圖 ⇒ 這個 bbox 必須一起丟掉**(與 mapper 那一處同一個理由):
    //    `card_image_trim` 是 `LEFT JOIN product_image_trim t ON t.url = p.images ->> 0`
    //    ⇒ 它釘在【那張被丟掉的圖】⇒ 留著它會讓後面換上來的圖被套上別張的裁切框。
    // 🔵 條件刻意寫成「**它是佔位圖**」而不是「它不是真圖」——
    //    `card_image` 本來就是 `null`(商品沒有任何圖)時, 既有行為是照樣解析 trim,
    //    而那與本片無關 ⇒ **不改它**(第一版我寫寬了, 當場弄紅一格既有測試)。
    imageTrim:
      row.card_image && hasNoRealImage(row.card_image)
        ? undefined
        : parseImageTrim(row.card_image_trim) ?? undefined,
    originalPrice: null,
    tierLabel: null,
  };
}
