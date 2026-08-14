import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import { toProductMedia } from '../../lib/products/product-media';
import {
  resolveListingState,
  resolvePrice,
  type AdminProductDetailRow,
} from '../../lib/products/product-repository';

// M-4b #20 片1b-1 + 1b-2:商品詳情頁的顯示層(唯讀)。相對 import 理由同 products-table.tsx:11-12。
//
// 🔴 **本檔不得直接讀 `row.price_general` / `row.delisted_at`** —— 一律經 `resolvePrice` /
//    `resolveListingState`(片1a plan §3 的設計約束,由來源掃描測試釘住、不是靠這段註解)。
//
// 🔴 **1b-2 加入內容/賣點/適用車型/圖片影音四個區塊。** jsonb 元素形狀**不保證**
//    ⇒ 一律先過 `toProductMedia()` 的 runtime guard,渲染層不碰原始 jsonb
//    (理由與依據逐條在 `lib/products/product-media.ts` 檔頭)。
//    ⚠️ 上一版這裡寫著「本片刻意不顯示…那七欄是片1b-2」—— **那句已經過期**,1b-2 就是這次。

/**
 * `availability` 是 CHECK 二選一(`20260507004826:40-42`);非預期值原樣顯示,不猜、不吞。
 *
 * 🔴 **R3 n1:這個 passthrough 分支與 `formatTime` 的 NaN 分支同型** —— 都是「CHECK/NOT NULL
 * 保護下今天走不到的死防禦」。我上一輪折了後者卻沒折前者 = **同型的東西用了兩套標準**。
 * ⇒ 一起 `export` + 一起補測試。**兩個都折,不是兩個都不折** ——
 * 因為 CHECK 是**今天**的約束,而 `availability` 將來要加第三個值(預購/停產)是很可能的事,
 * 屆時這個分支就是真的活路徑。
 */
export function availabilityLabel(raw: string): string {
  if (raw === 'in-stock') return '有庫存';
  if (raw === 'out-of-stock') return '無庫存';
  return raw;
}

/**
 * 時間顯示。🔴 **改用既有的 `formatOrderDateTime`**(code-reviewer R1 MF1)。
 *
 * ⚠️ **第一版是錯的,而且錯在只有正式站看得到的方向**:`toLocaleString('zh-TW')`
 * **只釘 locale、沒釘 `timeZone`** ⇒ Vercel 的 Node `TZ=UTC`,`created_at='…T02:00:00Z'`
 * 在正式站會印成 **08-01 02:00**(台北是 10:00)⇒ **員工看到的每個時間都差 8 小時**。
 * 本機 `TZ=Asia/Taipei` ⇒ 三綠與測試**全綠、完全看不到**。
 * 原本的 docstring 寫「不吃執行環境 locale」讀起來像時間顯示已經處理完 ——
 * **它只答了 locale 那一半**,時區那一半沒答(字面 vs 事實)。
 *
 * 為什麼不自己寫一支釘 `Asia/Taipei`:house 已有三處先例
 * (`lib/customers/customer-list-view.ts:60`、`lib/orders/order-detail-view.ts:39,41`、
 * `lib/orders/payment-list-view.ts:93`)⇒ 自己寫是**第四份會漂的字面**(同 N-d 的病)。
 * `formatOrderDateTime` 名字帶 order,但本體零訂單語意、零 `server-only`、零 `@/`
 * ⇒ 直接重用;**改名/搬家不是這片的事**,不順手擴張範圍。
 */
export function formatTime(raw: string): string {
  // 🔴 **R2 nit-g:這個 NaN 分支今天走不到** —— `created_at`/`updated_at` 是
  //    `NOT NULL timestamptz`(`20260507004826:37-38`)⇒ 拿不到爛字串。
  //    留著 + 補一格直接測它(下方 export 就是為了讓那格構造得出來),因為它零成本,
  //    而 1b-2 要顯示的 `video_url` 之類欄位**沒有**同樣的 NOT NULL 保護。
  //    **但不假裝它被觸發過** —— 它是「有測試在守的防禦」,不是「已知會發生的路徑」。
  return Number.isNaN(Date.parse(raw)) ? raw : formatOrderDateTime(raw);
}

/** 數量顯示:0 回 null ⇒ `Field` 自己顯「—」,不印「0 張」(0 與沒有在這裡是同一件事)。 */
function countLabel(n: number, unit: string): string | null {
  return n === 0 ? null : `${n} ${unit}`;
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className='space-y-0.5'>
      <dt className='text-muted-foreground text-xs'>{label}</dt>
      {/* 沒值顯「—」,不留空白格 —— 空白格會被讀成「這裡本來就沒這個欄位」。 */}
      <dd className='text-sm'>{value === null || value === '' ? '—' : value}</dd>
    </div>
  );
}

export function ProductDetail({
  product,
  brandName,
  categoryName,
  taxonomyFailed,
}: {
  product: AdminProductDetailRow;
  brandName: string | null;
  categoryName: string | null;
  taxonomyFailed: boolean;
}) {
  const price = resolvePrice(product);
  const listed = resolveListingState(product) === 'listed';
  // 🔴 收斂在這裡做一次,渲染層只碰收斂後的形狀 —— jsonb 來源 shape 不保證,
  //    讓 JSX 直接 `.map` 原始 jsonb 就是把髒值一路帶到畫面上。
  const media = toProductMedia(product);

  return (
    <div className='space-y-4'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold'>{product.title}</h1>
        {product.subtitle && (
          <p className='text-muted-foreground text-sm'>{product.subtitle}</p>
        )}
      </div>

      <section className='rounded-lg border p-4'>
        <h2 className='mb-3 text-sm font-medium'>基本資料</h2>
        <dl className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
          <Field label='料號' value={product.external_id} />
          {/* 🔴 供應商必顯:唯一鍵是 (supplier_slug, external_id) ⇒ 料號不是全域唯一,
              少了這欄員工分不出同料號的兩筆(片1a nit N2)。 */}
          <Field label='供應商' value={product.supplier_slug} />
          <Field label='網址代稱' value={product.handle} />
          <Field label='上架狀態' value={listed ? '上架中' : '已下架'} />
          <Field label='庫存狀態' value={availabilityLabel(product.availability)} />
          <Field
            label='售價'
            value={price === null ? null : `NT$ ${price.toLocaleString('zh-TW')}`}
          />
        </dl>
      </section>

      <section className='rounded-lg border p-4'>
        <h2 className='mb-3 text-sm font-medium'>分類</h2>
        {/* 🔴 單區塊容錯:品牌/分類讀失敗只讓這一區塊顯錯,不炸整頁
            (同 app/customers/[id]/page.tsx:27-28 的分區容錯慣例)。 */}
        {taxonomyFailed ? (
          <p className='text-destructive text-sm'>品牌與分類載入失敗,其餘資料仍可查看。</p>
        ) : (
          <dl className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
            <Field label='品牌' value={brandName} />
            <Field label='分類' value={categoryName} />
          </dl>
        )}
      </section>

      <section className='rounded-lg border p-4'>
        <h2 className='mb-3 text-sm font-medium'>商品說明與賣點</h2>
        {media.description === null || media.description.trim() === '' ? (
          <p className='text-muted-foreground text-sm'>沒有商品說明。</p>
        ) : (
          <p className='text-sm whitespace-pre-wrap'>{media.description}</p>
        )}
        {media.highlights.length > 0 && (
          <ul className='mt-3 list-disc space-y-1 pl-5 text-sm'>
            {media.highlights.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        )}
      </section>

      <section className='rounded-lg border p-4'>
        <h2 className='mb-3 text-sm font-medium'>適用車型</h2>
        {/* 🔴 只顯示筆數,而且把「這不是完整清單」寫在畫面上 ——
            `products.fitments` 只是 direct 那一半,繼承件在 `product_fitments_effective`
            (`SupabaseProductAdapter.ts:327-328`)。印成完整清單等於對員工說謊。 */}
        <p className='text-sm'>
          這件商品自己標了 <strong>{media.fitmentCount}</strong> 筆適用車型。
        </p>
        <p className='text-muted-foreground mt-1 text-sm'>
          這個數字<strong>不含</strong>從母車款繼承來的車型,所以會比前台看到的少。完整清單還沒做。
        </p>
      </section>

      <section className='rounded-lg border p-4'>
        <h2 className='mb-3 text-sm font-medium'>圖片與影音</h2>

        {/* 🔴🔴 驗收 6:圖片同步警語。這句從 plan 寫下到現在一直不存在,本片補上。
            依據 = 承重前提 3:圖片今天**只有防洗網、沒有旗標鎖** ⇒ 供應商換圖會直接蓋掉,
            而「來源那天沒給值」才擋得住。不能讓員工以為後台看到的圖是最終定案。 */}
        <p className='border-muted-foreground/30 bg-muted/40 mb-3 rounded border p-3 text-sm'>
          這裡的圖片與影音來自供應商每日同步。<strong>在這裡改沒有用,明天會被蓋回去</strong>
          ;供應商換圖也會直接覆蓋,目前沒有「鎖住不給改」的機制。
        </p>

        <dl className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
          <Field label='圖片' value={countLabel(media.images.length, '張')} />
          <Field label='安裝手冊' value={countLabel(media.manuals.length, '份')} />
          <Field label='聲浪音檔' value={countLabel(media.soundClips.length, '段')} />
          <Field label='安裝影片' value={media.videoUrl === null ? null : '有'} />
        </dl>

        {media.manuals.length > 0 && (
          <ul className='mt-3 space-y-1 text-sm'>
            {media.manuals.map((m) => (
              <li key={m.url}>
                {m.label}
                {typeof m.sizeKB === 'number' && (
                  <span className='text-muted-foreground'> · {m.sizeKB} KB</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {media.soundClips.length > 0 && (
          <ul className='mt-3 space-y-1 text-sm'>
            {media.soundClips.map((c) => (
              // 🔴 `title` 是英文原文、可為 null(實測約 4% 無標題,`domain/catalog/types.ts:230-232`)。
              //    這裡**不烤中文標籤** —— 資料層不烤、顯示層才做,而後台不需要那層美化。
              <li key={c.url}>{c.title ?? '(無標題)'}</li>
            ))}
          </ul>
        )}
      </section>

      <section className='rounded-lg border p-4'>
        <h2 className='mb-3 text-sm font-medium'>時間</h2>
        <dl className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
          <Field label='建立時間' value={formatTime(product.created_at)} />
          <Field label='最後更新' value={formatTime(product.updated_at)} />
        </dl>
      </section>
    </div>
  );
}
