import type { ProductManual, ProductSoundClip } from '@pcm/domain';

// M-4b #20 片1b-2:詳情頁「內容與媒體」**三個區塊**的 wire → 顯示形狀收斂
// (R1 N1:原本寫「四個區塊」,實際 `<section>` 只有三個)。
// plan = docs/specs/2026-08-15-products-admin-slice1b-plan.md(§4 R4)。
//
// 🔴 **R4 的答案不是「撈一筆看形狀」,是「這個 repo 的立場就是不保證形狀」。**
//    plan §4-R4 原本寫「落地第一動 = 先撈一筆真實列印出形狀,再寫渲染」。**那一步我做不到**
//    (本機無正式庫連線),但我沒有因此用猜的 —— 我讀了讀取端契約:
//    `packages/adapters/src/supabase/mappers/product.ts` 把 **jsonb 那幾欄**(`:57` highlights /
//    `:59` manuals / `:68` sound_clips)標成 `unknown[] | null`,理由寫著
//    「**jsonb 來源 shape 不保證(元素可能缺 label/url)**→ mapper runtime guard 收斂」。
//    ⚠️ **同段的 `description`(`:55`)與 `video_url`(`:60`)不是 `unknown[]`、是 `string | null`**
//    —— 我第一版寫成「`:56-68` 全標 `unknown[] | null`」,那句把範圍講大了(R1 N4)。
//    ⇒ **撈一筆也證明不了通則**(一筆乾淨不代表全部乾淨);正確做法是**照同一套 guard 收斂**。
//
// 🔴 **本檔的 guard 鏡像 `mappers/product.ts:234-263`,但有兩處刻意不同 —— 寫出來不含糊**(R1 MF6):
//    ① **`images` 比 mapper 嚴**:mapper 對 images 是 `:265` **零 guard 直透**、不在 234-263 內;
//       本檔套了 `toStringList`。方向安全(髒值不上畫面),但**後台數字可能與前台不一致**。
//    ② `fitments` 鏡像的是**前台** `apps/storefront/src/lib/products.ts:127-130` 的雙空 drop,
//       不是 mapper(mapper 對 fitments 也是直透)。
//    ⚠️ **這段是 R2 N-e 才補進來的**:我在折 MF6 時「改了」這句話,但那次 str-replace
//       **靜默沒套用**(我對著 ` * ` 開頭比對,而這裡是 `//` 開頭),而我在 commit body 宣告 MF6 已折。
//       ⇒ **改完沒回頭讀檔 = 宣稱與事實脫鉤**;下次折字面類 finding,收尾一定 grep 舊字面確認它真的不在了。
//
// 🔴🔴 **「我讀了契約」這句話,我講大了兩次**(R1 病根 + R2 復發):
//    · 第一次:資料有**兩端**(誰寫進去、誰讀出來),我只讀了讀取端 `mappers/` 就寫「讀了契約」。
//    · 第二次(**在折第一次的同一輪內**):我去讀了寫入端 `scripts/supplier-config.ts` 的旗標,
//      **但沒讀「哪幾家真的每天跑」**(那在 `.github/workflows/rpm-sync.yml:72` 的 matrix)、
//      **也沒讀「哪一筆根本不是供應商」**(同檔 `:311-316` 的 `__gated_canary__`,而且標著 🔴)。
//
// 🔴 **正確的分母(R2 MF-b;我上一輪報的數字分母是錯的)**:
//    · `supplier-config.ts` 共 **16 個條目**,但其中 `__gated_canary__` 逐字標著
//      「**永久 guard 測試靶(非真供應商)**…永不開寫、不入 rpm-sync.yml matrix」(`:311-316`)
//      ⇒ **真供應商 15 家**。
//    · 再扣掉 `extreme`(`rpm-sync.yml:72` 逐字「**extreme 刻意不列**…不接每日排程」、
//      `supplier-config.ts:275` 同字面、712 列)⇒ **每日同步 14 家**。
//    · 在那 14 家裡:`syncDescription:false` 與 `syncInstallResources:false` **都只有 `rpm` 一家**。
//    ⇒ 我上一輪寫「install true=13/false=3、desc true=14/false=2」是**16 條目的原始計數**,
//      把測試靶當成一家供應商。**UI 文案的「多數/少數」結論不受影響,但字面錯。**
//    數法:`grep -n "supplier:" .github/workflows/rpm-sync.yml` 取 matrix,
//         再逐條目比對 `scripts/supplier-config.ts` 的 `syncXxx` 旗標。
//    ⇒ **通則升級:「讀寫入端」不是讀一支檔,是讀那條路徑上的每一段。**
//      **設定檔說「這家可以同步」,排程說「這家有沒有被排」—— 我讀了前者、拿它推後者。**
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
  /** 🔴 **消毒後**的 direct 條目數(鏡像前台雙空 drop)——不是 `fitments.length`。 */
  readonly fitmentCount: number;
  /**
   * 代表圖(`images[0]`);無圖或只有 placeholder → `null`(R1 MF1)。
   *
   * 🔴 **這裡刻意不再暴露整個 `images` 陣列**(R2 N-d):MF1 之後畫面只用得到代表圖,
   * `images` 已**零 production 消費者** ⇒ 留著它等於**三格測試守著沒人用的欄 = 假的覆蓋率**。
   *
   * 🔴 **數法更正(R3 F5)**:我第一版記的數法是
   * `grep -rn "\.images" apps/admin/src | grep -v '.test.'` **並寫「⇒ 零命中」** ——
   * **那條實跑不是 0**(本檔自己的 `row.images` 就命中)。
   * ⚠️ **連「3」也已經不可重跑**(R4 n2):我寫下 3 之後,**本輪自己新加的註解行又自我命中**
   *   ⇒ 現在重跑是 **4**。**一個會隨自己註解變動的數字,不該被寫成證據** ——
   *   同「落筆當下重量」那條:**引用時只認當下重跑的值**。
   * 結論(外部零消費者)為真,但**記錄的量法重跑不出記錄的結果** = 又一個「宣稱的作用域 ≠ 量過的作用域」。
   * 可重跑的數法(排除本檔這個生產者):
   * `grep -rn "\.images" apps/admin/src --include='*.ts' --include='*.tsx' \
   *    | grep -v '.test.' | grep -v 'lib/products/product-media.ts'`  ⇒ **實跑 0**
   * 需要完整圖庫時它在變體層(`product_variants.images`),不是這裡。
   */
  readonly representativeImage: string | null;
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
 * 🔴 **`fitments` 只回「消毒後的條目數」**(本片刻意的範圍界線 + R1 MF3 的修正)。
 *
 * 範圍界線:適用車型的正確渲染牽涉 `product_fitments` / `product_fitments_effective` 兩張表的
 * direct ∪ inherited 語意(`SupabaseProductAdapter.ts:327-328`、`:353-354`),
 * 而 `products.fitments` jsonb 只是 **direct 那一半** ⇒ 印成完整清單會**少算繼承件**。
 *
 * ⚠️ **R1 MF3:第一版直接數 `raw.length`,那是錯的,而且錯的方向讓畫面上的話說反。**
 * 前台在資料進入點做**雙空 drop**(`apps/storefront/src/lib/products.ts:127-130`,
 * 註解逐字「**prod 實證 55 商品 / 82 條目 `motoBrand`/`modelCode` 為 null**」、
 * 「PDP SSR `.trim()` 炸頁 31 次」)⇒ 髒條目**前台根本不算**。
 * 我不消毒就數 ⇒ **後台的數字可能比前台多**,而我畫面上寫著「會比前台看到的少」——**同時說反**。
 * ⇒ 這裡鏡像前台的雙空 drop 再數;文案改成「**不會多於前台**」。
 */
function toFitmentCount(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return raw.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    const { motoBrand, modelCode } = item as Record<string, unknown>;
    // 鏡像 `products.ts:127-130`:非 string 視為空;兩個都空 → drop。
    const brand = typeof motoBrand === 'string' ? motoBrand : '';
    const model = typeof modelCode === 'string' ? modelCode : '';
    return brand !== '' || model !== '';
  }).length;
}

/**
 * 🔴 **同步管線寫進 `images` 的永遠是「一張代表圖」,而且沒圖時塞 placeholder**
 * (R1 MF1;`scripts/rpm-transform.ts:286-289` 取圖、`:347` `images: [repImage]`、
 * `:36` `PLACEHOLDER_IMAGE = '/placeholder-product.png'`)。
 *
 * ⇒ **「圖片 N 張」對每一件同步商品恆等於 1**(資訊量為零),
 *   而且**一張圖都沒有的商品也會顯示「1 張」** —— 員工問「這件有沒有圖」,畫面給相反答案。
 * ⇒ 本片改成回報「**有沒有真正的代表圖**」,並在畫面寫明完整圖庫在變體層。
 */
/**
 * 🔴 **這是 `scripts/rpm-transform.ts:36` 那個字面的第二份**(R3 F4)。
 * transform 改了路徑而這裡沒跟 ⇒ `isPlaceholderImage` **靜默失效**、無圖商品又顯示「有」
 * = MF1 修掉的那個謊**回歸**,而且不會有任何東西叫。
 * ⚠️ **檔頭自己在講「不抄會漂的字面」,這裡卻抄了一個** —— 不能 import(`scripts/` 沒打包給 app)
 * ⇒ 退而求其次:**`sync-facts.test.ts` 裡標題含 `F4:placeholder 字面兩份必須一致` 的那一格**
 *   讀 `rpm-transform.ts` 比對這兩份字面,漂開就紅。**機制在測試端,不是靠這段註解。**
 *   定位法(不釘行號,行號會漂):
 *   `grep -n "F4:placeholder" apps/admin/src/lib/products/sync-facts.test.ts`
 *
 * 🔴 **上一版這裡指的是 `product-media.test.ts` —— 那支檔不存在**(R4 M1;`ls` ENOENT)。
 *   失敗情境比表面嚴重:下一個人照它開檔、找不到 ⇒ 判定「機制不存在」⇒ **把 F4 的字面刪掉**,
 *   而**這句註解正是「機制在測試端」的唯一憑據**。刪了就真的沒人守了。
 *   ⇒ 病根同「折 finding 時新寫的理由自己沒驗」——**我寫下那個檔名時,它還沒被我建出來**
 *   (我最後把守門寫進了 `sync-facts.test.ts`,註解沒跟著改)。
 *
 * 🔴 **而我修 M1 時,把「不存在的檔名」換成了「假行號」**(R5 MF-1):寫成 `:109-120`,實際是 `:118-129`。
 *   ⚠️ **當時我真的量過,`sed -n '109p;120p'` 也真的印出那個 `it`** —— 但**接著我自己折 n3(+4)、
 *   n4(+5)把它往下推了 9 行,而我沒有重量**。⇒ 那句「落筆當下已核過」在寫下的瞬間為真、
 *   在我按下一個編輯之後為假,**而它讀起來永遠像真的**。同「`wc -l` 104 vs 108」那個形狀。
 * 🔴 **真正的修法不是重量一次,是不要釘行號** —— 我在 backlog `#504` 裡給別人的建議逐字是
 *   「**釘錨點不釘行號 —— 歷史檔的行號本來就會漂**」,**然後在自己的檔案裡釘了行號**。
 *   ⇒ 上面改成用 `it` 標題當錨,並附定位命令。
 */
const PLACEHOLDER_IMAGE = '/placeholder-product.png';

export function isPlaceholderImage(url: string): boolean {
  return url === PLACEHOLDER_IMAGE;
}

export function toProductMedia(row: ProductMediaRow): ProductMedia {
  const images = toStringList(row.images);
  return {
    description: row.description ?? null,
    highlights: toStringList(row.highlights),
    fitmentCount: toFitmentCount(row.fitments),
    // 🔴 placeholder 視同「沒有圖」—— 它是同步管線的 fallback,不是商品真的有圖。
    representativeImage:
      images[0] !== undefined && !isPlaceholderImage(images[0]) ? images[0] : null,
    // 空字串 / 空白 → null(鏡像 `mappers/product.ts:248`;`:247` 是註解行,程式在下一行 —— R1 N2)。
    videoUrl:
      typeof row.video_url === 'string' && row.video_url.trim() !== '' ? row.video_url : null,
    manuals: toManuals(row.manuals),
    soundClips: toSoundClips(row.sound_clips),
  };
}
