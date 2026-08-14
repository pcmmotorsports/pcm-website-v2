import type { ProductManual, ProductSoundClip } from '@pcm/domain';

// M-4b #20 片1b-2:詳情頁「內容與媒體」四個區塊的 wire → 顯示形狀收斂。
// plan = docs/specs/2026-08-15-products-admin-slice1b-plan.md(§4 R4)。
//
// 🔴 **R4 的答案不是「撈一筆看形狀」,是「這個 repo 的立場就是不保證形狀」。**
//    plan §4-R4 原本寫「落地第一動 = 先撈一筆真實列印出形狀,再寫渲染」。**那一步我做不到**
//    (本機無正式庫連線),但我沒有因此用猜的 —— 我去讀了**寫入端與既有讀取端的契約**:
//    `packages/adapters/src/supabase/mappers/product.ts:56-68` 逐字把這些欄的 wire 型別標成
//    `unknown[] | null`,理由寫著「**jsonb 來源 shape 不保證(元素可能缺 label/url)**
//    → mapper runtime guard 收斂」。
//    ⇒ **撈一筆也證明不了通則**(一筆乾淨不代表全部乾淨);正確做法是**照同一套 guard 收斂**。
//    ⇒ 本檔的 guard 逐條鏡像 `mappers/product.ts:234-263`,不自創寬鬆版。
//
// 🔴 **型別直接用 `@pcm/domain` 的 `ProductManual` / `ProductSoundClip`,不在 admin 另抄一份**
//    ——「手抄第四份會漂的字面」那條(片1a nit N-d)。admin 匯入 `@pcm/domain` 有先例
//    (`lib/orders/order-detail-view.ts:6` 匯 `InvoiceStatus`)。

/**
 * 詳情頁媒體區塊的 wire shape(逐欄對應 repository 的 select;**型別刻意寬鬆,因為來源不保證**)。
 *
 * 🔴 **每個欄都是 optional**,不是只有 `null`:上游 `SupabaseProductRow` 自己就把
 * `sound_clips` 標成 `sound_clips?: unknown[] | null`(`mappers/product.ts:68`)——
 * 那欄是後加的,舊 select 沒撈時就是 `undefined`。
 * ⚠️ **這件事是測試踩出來的,不是我想到的**:第一版把型別寫成 `string | null`,
 * 測試 fixture 少給欄位 ⇒ `undefined.trim()` 直接炸。**`null` 與 `undefined` 是兩件事。**
 *
 * 🔴 **jsonb 欄一律 `unknown`,不是 `unknown[]`** —— 這是 **typecheck 逼出來的更正**:
 * 產生的 DB 型別把 jsonb 標成 `Json`(可以是物件、字串、數字,**不保證是陣列**),
 * 我第一版寫 `unknown[] | null` ⇒ `error TS2322`。
 * **那個型別本身就是一個沒被驗過的假設** —— 我一邊寫「來源 shape 不保證」,
 * 一邊在型別上假設它是陣列。`Array.isArray` 的 guard 本來就在處理這件事,型別不該搶答。
 */
export interface ProductMediaRow {
  readonly description?: string | null;
  readonly highlights?: unknown;
  readonly fitments?: unknown;
  readonly images?: unknown;
  readonly video_url?: string | null;
  readonly manuals?: unknown;
  readonly sound_clips?: unknown;
}

/** 收斂後的顯示形狀。**每個陣列欄恆非 null**(空陣列 = 沒有;同 domain 慣例)。 */
export interface ProductMedia {
  readonly description: string | null;
  readonly highlights: readonly string[];
  readonly fitmentCount: number;
  readonly images: readonly string[];
  readonly videoUrl: string | null;
  readonly manuals: readonly ProductManual[];
  readonly soundClips: readonly ProductSoundClip[];
}

/** 只收字串元素;非陣列 → `[]`(鏡像 `mappers/product.ts:234`)。 */
function toStringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * 安裝手冊:只收「`label` 與 `url` 都是字串」的項(鏡像 `mappers/product.ts:236-246`)。
 * `sizeKB` 來源常缺 ⇒ 有才帶。
 */
function toManuals(raw: unknown): ProductManual[] {
  if (!Array.isArray(raw)) return [];
  return raw.reduce<ProductManual[]>((acc, item) => {
    if (item && typeof item === 'object') {
      const { label, url, sizeKB } = item as Record<string, unknown>;
      if (typeof label === 'string' && typeof url === 'string') {
        acc.push(typeof sizeKB === 'number' ? { label, url, sizeKB } : { label, url });
      }
    }
    return acc;
  }, []);
}

/**
 * 聲浪音檔:只收「`url` 是非空字串」的項;`title` **保留原值**(英文原文、可為 null),
 * 非字串的 title 收斂成 `null` —— **不讓 `123` 這種髒值被當標題印出來**
 * (鏡像 `mappers/product.ts:254-263`,含那段「資料層不烤標籤」的拍板)。
 */
function toSoundClips(raw: unknown): ProductSoundClip[] {
  if (!Array.isArray(raw)) return [];
  return raw.reduce<ProductSoundClip[]>((acc, item) => {
    if (item && typeof item === 'object') {
      const { title, url } = item as Record<string, unknown>;
      if (typeof url === 'string' && url.trim() !== '') {
        acc.push({ title: typeof title === 'string' ? title : null, url });
      }
    }
    return acc;
  }, []);
}

/**
 * 🔴 **`fitments` 只回「筆數」不回內容**(本片刻意的範圍界線)。
 *
 * 理由:適用車型的正確渲染牽涉 `product_fitments` / `product_fitments_effective` 兩張表的
 * direct ∪ inherited 語意(`SupabaseProductAdapter.ts:327-328`、`:353-354`),
 * 而 `products.fitments` jsonb 只是 **direct 那一半**。
 * ⇒ 在詳情頁直接把它印成「適用車型」會**少算繼承件、對員工說謊**。
 * ⇒ 本片只顯示「direct 筆數」並在畫面上寫明它不是完整清單;完整清單另開片。
 * **這是刻意縮範圍並寫出來,不是忘了做。**
 */
function toFitmentCount(raw: unknown): number {
  return Array.isArray(raw) ? raw.length : 0;
}

export function toProductMedia(row: ProductMediaRow): ProductMedia {
  return {
    description: row.description ?? null,
    highlights: toStringList(row.highlights),
    fitmentCount: toFitmentCount(row.fitments),
    images: toStringList(row.images),
    // 空字串 / 空白 → null(鏡像 `mappers/product.ts:247`,那裡收斂成 undefined)。
    videoUrl:
      typeof row.video_url === 'string' && row.video_url.trim() !== '' ? row.video_url : null,
    manuals: toManuals(row.manuals),
    soundClips: toSoundClips(row.sound_clips),
  };
}
