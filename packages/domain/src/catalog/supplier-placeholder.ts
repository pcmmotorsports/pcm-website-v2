// supplier-placeholder.ts — ⟦fc-SUPPLIERPLACEHOLDER⟧ 供應商自家的「無照片」佔位圖 ⇒ 視為沒有圖。
//
// 🛑🛑 **要擴充這支檔的人:先讀這一段。**
//    **本檔禁用「全部」「所有」「唯一」「兩個」「五條」這類【完整性詞】。**
//    寫法一律是:**「本片涵蓋 X ── 已知未涵蓋 Y」**, 而 Y 那一半要附座標。
//
//    🔴 **理由是量到的, 而且是同一支檔在同一天犯了兩次**(2026-09-02):
//      R1 我寫「storefront **五條**讀取路徑**全部**經過 mapper」⇒ **假**(目錄頁走 RPC, 不經過)
//      R2 我寫「它有【**兩個**】消費者」                       ⇒ **也是假**(收藏頁與訂單頁是第三、第四條)
//    ⇒ ⇒ 📌 **兩次同一個形狀:一個完整性詞比我實查的範圍寬一格 ── 而結論讀起來完整,
//       所以沒有人會回去數。**
//    🎯 **而第二次發生在【被抓到第一次之後】** ⇒ **「知道這個病」不足以避開它**
//       ⇒ 所以這裡放的是一張**禁用詞表**, 不是一句提醒:
//          提醒要靠寫的人當下想起來, 而詞表在他打出那個字的時候就在眼前。
//    ⚠️ 而下一個擴充它的人**會做的第一件事就是寫一句「本片涵蓋所有…」** ── 那句話就是這一段在擋的。
//
// 🔴🔴 **本片涵蓋兩條路, 而【至少有四條】—— 這一句要先讀完再往下。**
//    ✅ 本片修的:
//      ① `packages/adapters/…/mappers/product.ts`(詳情 / 精選 / 相關 / 搜尋)
//      ② `apps/storefront/src/lib/catalog-page.ts`(`/products` 目錄頁與品牌頁, 走 RPC, **不經過 mapper**)
//    🔴 **本片【沒有】修的**(code-reviewer R2 2026-09-02 抓到, 我開檔驗過):
//      ③ `SupabaseFavoritesAdapter.ts:80` —— `row.products.images[0]` 直讀 base 表
//         ⇒ `FavoritesTab.tsx:61` 客人的**收藏清單**
//      ④ `mappers/order.ts:272` 與 `:1226` —— `pickFirstImage(...products?.images)`
//         ⇒ `OrdersTab.tsx:154` / `OrderDetailView.tsx` 客人的**訂單卡片與明細**
//      🛑 ④ 動到 order 面 ⇒ **鐵則 12①** ⇒ 那不是順手補, 是另一片, 已交主視窗。
//      ⚠️ 而 ③④ 只證實**路徑存在**, **沒有**查「今天有沒有 GILLES 商品被收藏 / 被下單」。
//
// 🛑🛑 **⛔ ~~我原本在這裡寫「它有【兩個】消費者」~~ —— 而那是本檔第二次犯同一個病。**
//    第一次是「storefront **五條**讀取路徑**全部**經過 mapper」(見下方刪除線)。
//    📌 **⇒ 兩次都是【一個完整性詞比我實查的範圍寬一格】, 而結論讀起來完整 ⇒ 沒有人會回去數。**
//    ⇒ ⇒ **所以本檔往後只寫「本片涵蓋 X、已知未涵蓋 Y」, 不寫「全部」「兩個」「唯一」。**
//
// 🔵 **而為什麼住在 domain**(理由改過 —— 原本那個是**假的**):
//    ⛔ ~~「② 不能 import `@pcm/adapters`, 那會把 Supabase adapter 拖進 client 圖」~~
//    🔴 **證偽**:`apps/storefront/src/lib/search.ts:84` **已經**值 import 並 `new SupabaseProductAdapter()`
//       ⇒ storefront 對 adapters **不存在**那條禁令;而 `catalog-page.ts` 的 importer 裡
//       **6 個是 `import type`**(編譯期抹除、不進 bundle), 唯一的值 importer 是 server 端 `lib/products.ts`。
//    ✅ **真正的理由是分層**:這是一條**純字串規則**, 讓 storefront 為它去吃一個 adapter 套件
//       是反向依賴;而 `@pcm/domain` 是純的、`catalog-page.ts` 本來就在值 import 它(`parseImageTrim`)。
//    📌 **⇒ 結論一樣、理由不一樣 —— 而照著假理由走的人, 會拿一個不存在的限制去做別的決定。**

/**
 * ⟦fc-SUPPLIERPLACEHOLDER⟧ 供應商自己的「無照片」佔位圖 —— **視為沒有圖**。
 *
 * 🔴 **為什麼在 mapper, 不在同步層也不在渲染層**(三個落點各量過):
 *   · 同步層:本 repo **沒有** GILLES / EXTREME 的同步腳本 ——
 *     (🔵 **撐住這個結論的是遞迴那一把**:`grep -rin 'gillestooling|extreme-components' scripts/` ⇒ **1**
 *      —— ⚠️ 而 `ls scripts/ | grep -iE "gilles|extreme|lightech|dna"` ⇒ **0**, 🔴 **但它不遞迴**
 *      (`scripts/` 底下有子目錄)⇒ **那個 0 的分母比句子窄, 不要拿它當依據**
 *      —— `s1a-verify.sh` 的供應商名種子清單, **不是同步腳本** ⇒ 結論不變。
 *      🔴 兩個數字都留著:一個沒帶 pattern 與大小寫的「零命中」, 下一個人複量會撞到而懷疑自己。)
 *     那半在報價單那邊。⛔ ~~`rpm-transform.ts` 的 `?? PLACEHOLDER_IMAGE` 只管 **RPM Carbon 一家**~~
 *     ⛔ ~~(`rpm-transform.ts:2` 逐字「RPM Carbon 同步」)⇒ 它對這一族**結構上到不了**。~~
 *     🔴🔴 **2026-09-03 訂正(線【身分】查 1,011 列缺圖時撞到, code-reviewer 抓出這一段)——
 *        上面【整段】的前提不成立, 而它是本檔選落點的三個理由之一。**
 *        🔬 `scripts/supplier-config.ts` 逐字有 `lightech:`(:177) `extreme:`(:281) `dna:`(:323) `gilles:`(:359);
 *        🔬 `.github/workflows/rpm-sync.yml:72` 的 matrix 逐字含 `lightech` / `dna` / `gilles`
 *           (註記「🔴 dna+gilles 2026-08-27 Sean 拍甲補入」)⇒ **gilles 每天都在跑這支檔。**
 *        ⇒ 🎯 **`rpm-transform.ts` 是【config 驅動的共用 transform】, 檔名只是歷史(rpm 是第一家)。**
 *        ⚠️ **只有 extreme 那半仍成立**:它刻意不進每日 matrix(靜態一次性 fixture)—— 而它**仍在 supplier-config 裡**,
 *           首灌時照樣經過本檔的上游 ⇒ **『結構上到不了』對 extreme 也只對「每日排程」那一半成立。**
 *
 *        🔴 **而【那把尺為什麼印 1】才是要記的**:它 grep 的是**網域字面**(`gillestooling|extreme-components`),
 *        而同步腳本是**泛用的、以 slug 為鍵**(`supplier-config.ts` 的 `gilles:`)⇒ 🛑 **它結構上永遠不會提到網域。**
 *        ⇒ 🎯 **那把尺問的是「`scripts/` 裡有沒有出現這個網域」, 而要答的是「這家有沒有同步路徑」。**
 *        ⇒ 📌 **換一個字面再問一次就會分岔** —— 拿 slug 去 grep ⇒ 立刻命中。
 *        ⇒ ⇒ 🔵 而那正是本檔第 88 行那一族的同一個母題:**一個誠實的讀數, 答的是另一個問題。**
 *        🛑 **落點結論(mapper)本身沒有被推翻** —— 渲染層那個理由仍然成立;
 *           但**不得再拿「同步層到不了」當理由**, 而**是否要在同步層【也】處理, 現在是一個開著的題**。
 *   · 渲染層:storefront 有**多支元件**渲染商品圖, 其中**多處是裸 `<img src={…}>`**
 *     (我數到 7 支 / 5 處, 而 code-reviewer 獨立數到 5 支 / 8 處 ⇒ **兩個數字都不複現**
 *      ⇒ 🔴 **數法未確認, 引用前自己數**;而結論不依賴那個數:只要 >1 處, 改渲染層就會漏)
 *     ⇒ 改那裡 = 動**每一支**, 而**一定會漏掉還沒被數到的那幾支**。
 *     (⛔ ~~原本這一行寫「動 7 支檔, 一定會漏掉第 8 支」~~ —— **它就在上一行宣告那兩個數字
 *      不複現的三行之內**, 而我改了上一行、漏了這一行。📌 **一段話在三行內用自己剛作廢的數字當論據。**)
 *   · ✅ mapper:storefront 的**詳情 / 精選 / 相關 / 搜尋**四條路經過它, 而**後台不經過**——
 *     🛑 ⛔ ~~我原本在這裡寫「storefront **五條**讀取路徑**全部**經過這裡」~~ —— **那句話是假的。**
 *     🔴 `/products` **商品目錄頁與品牌頁走 RPC `search_catalog_by_vehicle`**, 拿到的是
 *        `row.card_image`(= view 的 `p.images ->> 0`, **未濾的原圖**)⇒ **完全不經過 mapper**。
 *     ⇒ ⇒ 🎯 **而那是最高流量的那一頁** ⇒ 只做 mapper 這一半 = 修好了而客人看不到。
 *     ✅ 所以目錄頁那條路在 `apps/storefront/src/lib/catalog-page.ts` 用 `isSupplierPlaceholder`
 *        **共用本檔這一份清單**;舊字面留著加刪除線, 讓搜到那句話的人同一發撞到這裡。
 *     📌 **⇒ 而它是 code-reviewer 從 diff 讀出來的, 不是測試抓到的** ——
 *        **一個「全部」比我實際查證的範圍寬一格, 而結論讀起來完整, 所以沒有人會回去數。**
 *     `apps/admin/src/lib/products/product-repository.ts` 檔頭逐字「讀 base 表 `products`,
 *     不讀 `products_public` view,也不重用 storefront 的 `SupabaseProductAdapter`」
 *     ⇒ 員工仍然看得到供應商給了什麼(那是他要換圖的依據), 只有客人那一側被換掉。
 *
 * 🔬 **規則的形狀是量出來的, 不是設計出來的**(2026-09-02 唯讀正式庫):
 *   GILLES 那三族的目錄段是 **hash 化的** —— `/media/01/e4/ac/1711800467/` 這種, 共 **33 個不同目錄**
 *   ⇒ ⇒ **所以不能綁路徑前綴**(那要 33 條規則, 而供應商下次同步會生出第 34 個)
 *   ⇒ 綁的是【網域 + 檔名前綴】。
 *
 * 🔴 **而檔名也被 CDN 打散**:同一張圖有 **28 個 hash 尾巴的變體**
 *   (`spareparts-mit-tesxt**01954**.png` / `**59119dc4380460194e**.png` …, 每個只用 1-8 支)
 *   ⇒ ⇒ 所以比對是 **`startsWith` 前綴**, 不是完整檔名。用完整檔名會漏掉那 28 個。
 *
 * ⚠️ **`tesxt` 不是錯字 —— 那是供應商打錯的, 照抄。** 順手「修正」成 `text` ⇒ 這條規則
 *   **一支都撈不到**, 而單元測試若也跟著改就會照樣全綠。
 *
 * 🛑 **`bild-` 刻意拆兩條, 不合成一條**:德文 `Bild` 就是「圖片」⇒ 供應商明天放一張真商品照
 *   叫 `bild-carbon-xyz.png`, 合成版會把它濾掉 ⇒ **客人看到一張佔位圖蓋住一張真照片**
 *   ⇒ ⇒ 而**那個壞法不會有人回報**。(🟢 負對照:今天掃 `/bild-` 在那兩條之外 = **0 支**——
 *   那是【今天】的讀數, 不是保證, 所以規則仍然分兩條。)
 *
 * 🛑 **`quote.pcmmotorsports.com/no-photo.png`(591 支 —— ⚠️ **射程未標**:那是 2026-09-02 的讀數,
 *   哪個庫哪一層當時沒寫下來;2026-09-04 在**報價庫 `storefront_catalog_v`** 量到的是 **882 列**。
 *   🔴 兩個數字都留著, 而**引用前先問是哪一個庫哪一層** —— 不要拿它們相減)【不在】這張表裡** —— 那是 **PCM 自己的卡**
 *   (親眼開圖:PCM logo + 紅色分隔線 + 「暫無照片」+ 「PCM MOTORSPORTS」)。
 *   濾掉它只會把一張 PCM 卡換成另一張 PCM 卡:零收益, 而多一個會漂的字面。
 *
 * 🔴 **釘住網域的理由**:這四條規則會活很久, 而供應商換 CDN 時檔名會漂;
 *   釘網域的成本是零, 而它擋掉的是一個沒有人會回報的壞法。
 *
 * 🛑🛑 **這張表天生會漏, 而【沒有任何東西會叫】。**
 *   它是四條字面規則;供應商換一個檔名、或第五家供應商放一張新的佔位圖 ⇒ 它就漏,
 *   而客人那一側看起來完全正常。**監控那半沒有做**, 已另開一列。
 */
/**
 * 🔴 **匯出是為了讓測試【由這張表驅動】** —— 加第五條規則時, `hasNoRealImage` 那幾格會自動涵蓋它。
 *   不匯出的話, 測試只能自己重打一份樣本 ⇒ **而那份樣本不會跟著表長大**(那正是本檔警告過的分岔)。
 */
export const SUPPLIER_PLACEHOLDERS: ReadonlyArray<
  readonly [host: string, filePrefix: string]
> = [
  ['www.gillestooling.com', 'spareparts-mit-tesxt'],
  ['www.gillestooling.com', 'bild-schraube-'],
  ['www.gillestooling.com', 'bild-folgt-in-kurze-'],
  ['www.extreme-components.com', 'noimage.jpg'],
  // 🔴 2026-09-03 補三家(線【身分】量到:這三家共 39 列在用自家的 no-image 圖, 而它們不在表裡
  //    ⇒ 客人看到【別家公司的「無圖」圖】, 而且我們外連他們的伺服器)。
  //    🔬 **網址逐字**(2026-09-04 `SELECT DISTINCT` 撈回來貼上, 不是我打的 —— 三來源律):
  //       `https://www.gbracing.eu/templates/GBRacing/Images/no-image-300x300.jpg`            (8 列)
  //       `https://www.motogadget.com/cdn/shopifycloud/storefront/assets/no-image-2048-a2addb12_grande.gif` (4 列)
  //       `https://rpmcarbon.com/cdn/shopifycloud/storefront/assets/no-image-2048-a2addb12_600x600_crop_center.gif` (27 列)
  //    🔴 **`rpmcarbon.com` 沒有 `www.` —— 那不是漏打**(上面那一發撈回來就是這樣);
  //       而 `:161` 是 `host === h` **嚴格相等** ⇒ 多打一個 `www.` 那 27 列一條都接不住,
  //       🛑 而 `it.each(SUPPLIER_PLACEHOLDERS)` 是**拿表自己組 URL** ⇒ 對「字面填錯」**零判別力, 不會紅**。
  //    🔵 **誤傷檢查**(同一發):全庫含 `no-image`/`noimage`/`no-photo` 的網址只有 **5 種**,
  //       五種全是佔位圖 ⇒ 今天沒有任何真商品圖叫這個名字。⚠️ 那是**今天的讀數**, 不是保證。
  //    ⚠️ 前綴用 `no-image-`(帶尾巴的橫線)而不是 `no-image`:
  //       前者釘住「這是一個檔名前綴」, 後者會連 `no-imagery-carbon.jpg` 這種真商品圖一起濾掉
  //       —— 同檔上方 `bild-` 那段記過同一個坑(供應商明天放一張真照片叫那個名字)。
  ['www.gbracing.eu', 'no-image-'],
  ['www.motogadget.com', 'no-image-'],
  ['rpmcarbon.com', 'no-image-'],
];

/**
 * 濾掉供應商佔位圖。全部濾光 ⇒ 回 `[]` ⇒ 下游 `product.images[0] ?? null` 給 null
 * ⇒ `ProductImage` 走 `showReal === false` 那條 ⇒ 客人看到站內 `/placeholder-product.png`。
 *
 * 🔵 **解析不了的 URL 一律【留著】(fail-open)** —— 兩個方向都會錯, 而這一邊比較輕:
 *   留著 ⇒ 客人看到供應商的佔位圖(= 今天的現況, 而且他看得出來沒照片);
 *   濾掉 ⇒ 可能蓋住一張真照片, **而那個沒有人會回報**。
 */
export function isSupplierPlaceholder(url: string): boolean {
  let host: string;
  let file: string;
  try {
    const u = new URL(url);
    host = u.hostname;
    // 🔵 檔名轉小寫再比:實測大寫檔名(`SPAREPARTS-MIT-TESXT.PNG`)會繞過去。
    //    網域那半不必轉 —— `URL.hostname` 自己就已經是小寫。
    file = u.pathname.slice(u.pathname.lastIndexOf('/') + 1).toLowerCase();
  } catch {
    return false; // fail-open:解析不了 ⇒ 不當成佔位圖 ⇒ 留著
  }
  return SUPPLIER_PLACEHOLDERS.some(
    ([h, prefix]) => host === h && file.startsWith(prefix),
  );
}

/**
 * PCM 自己的「暫無照片」卡(2026-09-03 量:報價庫 `storefront_catalog_v` 有 **882 列**用它)。
 * 卡面 = PCM logo + 紅線 + 「暫無照片」+ 「PCM MOTORSPORTS」。
 *
 * 🛑 **它【刻意不在】`SUPPLIER_PLACEHOLDERS` 裡** —— 那張表的用途是「濾掉別人家的爛圖」,
 *   而濾掉我們自己的卡只會把一張 PCM 卡換成另一張 PCM 卡(零收益 + 多一個會漂的字面)。
 *   負對照測試 `apps/storefront/src/lib/catalog-page.test.ts` 釘著「PCM 自己的卡不得被濾掉」。
 * ⇒ 🎯 **所以它住在這裡, 只給 `hasNoRealImage` 用。兩個謂詞回答兩個不同的問題。**
 */
const PCM_OWN_NO_PHOTO_CARD = ['quote.pcmmotorsports.com', 'no-photo.png'] as const;

/**
 * **這一筆有沒有【真的照片】** —— 與 `isSupplierPlaceholder` 是**兩個不同的謂詞**, 不要混用:
 *
 * ```
 * isSupplierPlaceholder = 「這是【別人家】的佔位圖, 該濾掉」   119 列
 * hasNoRealImage        = 「這一筆【沒有真照片】」             1,011 列
 *                       = 前者 OR PCM 自己的卡 OR 根本沒有網址
 * ```
 * (數字為 2026-09-03 對報價庫 `storefront_catalog_v` `WHERE images IS NULL` 的量測,
 *  拆開 = 882 PCM 卡 + 80 extreme(在表內)+ 39 不在表內 + 10 無網址。)
 *
 * 🔴 **它【必須】呼叫 `isSupplierPlaceholder`, 不得自己重打一份判斷** ——
 *   本檔開頭警告過「複製成兩份清單 ⇒ 它們會分岔, 而分岔不會紅」。
 *   ✅ 而那不是靠紀律:`supplier-placeholder.test.ts` 有一組 `it.each(SUPPLIER_PLACEHOLDERS)`,
 *      **由那張表驅動** ⇒ 重打一份就會有格子紅。
 *      🔬 **實測**(2026-09-03):把本函式改成自己重打一份、刻意少一條規則 ⇒ **1 紅 / 35**
 *      —— 紅的正是被漏掉的那一條(`bild-folgt-in-kurze-`)。
 *      ⚠️ **紅幾格 = 你漏了幾條規則**, 不是固定值;⛔ ~~本註解初稿寫「4 紅」~~ —— **那是我沒量就寫的數字。**
 *
 * 🛑 **fail-open 的方向是刻意的**:網址解析不了 ⇒ 回 `false`(當成「有圖」)。
 *   理由:回 `true` 會讓畫面**拿品牌 logo 蓋掉一張真照片** ——
 *   ⇒ 🎯 **這個謂詞的誤報成本比漏報高**, 所以它往「保留原圖」那一側倒。
 *   (⚠️ 與 preflight 那一側相反 —— 那裡是「叫人去看」, 寧可多叫。**同一件事, 兩個消費端, 兩個方向。**)
 */
export function hasNoRealImage(url: string | null | undefined): boolean {
  if (url === null || url === undefined || url.trim() === '') return true;
  if (isSupplierPlaceholder(url)) return true;
  try {
    const u = new URL(url);
    const file = u.pathname.slice(u.pathname.lastIndexOf('/') + 1).toLowerCase();
    return u.hostname === PCM_OWN_NO_PHOTO_CARD[0] && file === PCM_OWN_NO_PHOTO_CARD[1];
  } catch {
    return false; // fail-open,理由見上
  }
}

/**
 * 陣列版:濾掉供應商佔位圖。全部濾光 ⇒ 回 `[]`。
 *
 * 🔴 **兩條讀取路徑必須用【同一份】`SUPPLIER_PLACEHOLDERS`**:
 *   · adapter mapper(詳情 / 精選 / 相關 / 搜尋)⇒ 用本函式
 *   · `/products` 目錄頁與品牌頁走 RPC ⇒ 那邊拿到的是**單一** `card_image` ⇒ 用 `isSupplierPlaceholder`
 *   ⇒ ⇒ 📌 **複製成兩份清單 ⇒ 它們會分岔, 而分岔不會紅** ——
 *      修好一半、另一半沒跟上, 而客人只會在其中一頁看到爛圖。
 */
export function dropSupplierPlaceholders(images: readonly string[]): string[] {
  return images.filter((url) => !isSupplierPlaceholder(url));
}
