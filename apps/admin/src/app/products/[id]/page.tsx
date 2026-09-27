import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '../../../lib/orders/note-action-state';
import { ProductDetail } from '../../../components/products/product-detail';
import { ProductSummaryBand } from '../../../components/products/product-summary-band';
import { ProductListingForm } from '../../../components/products/product-listing-form';
import { ProductOverridesEditor } from '../../../components/products/product-overrides-editor';
import { ProductHistory } from '../../../components/products/product-history';
import { ProductCategoryEditor } from '../../../components/products/product-category-editor';
import { loadProductHistory } from '../../../lib/products/product-history-loader';
import { ProductGalleryPanel } from '../../../components/products/product-gallery-panel';
import { loadProductGallery } from '../../../lib/products/gallery-loader';
import { readProductOverrides } from '../../../lib/products/product-overrides-view';
import { toProductMedia } from '../../../lib/products/product-media';
import { findVariantSkuCollision } from '../../../lib/products/variant-sku-collision';
import { ResultBanner } from '../../../components/orders/result-banner';
import { resolveListingState, resolvePrice } from '../../../lib/products/product-repository';
import { FROM_PARAM, parseProductListReturn, productDetailHref } from '../../../lib/products/product-list-view';
import { resolveProductListQuery } from '../../../lib/products/product-taxonomy-options';
import {
  findProductNeighbors,
  listProductFilterOptions,
  getProductForAdmin,
  getProductTaxonomyNames,
  listCategoryChoices,
  type AdminProductDetailRow,
  type ProductTaxonomyNames,
} from '../../../lib/products/product-repository';

// M-4b #20 片1b-1:後台商品詳情頁(唯讀)。plan = docs/specs/2026-08-15-products-admin-slice1b-plan.md。
// 相對 import(非 `@/`)理由見 app/products/page.tsx:1-3。
export const dynamic = 'force-dynamic';

// 🔴 **UUID 守門直接 import 既有的 `isUuid`,不再手抄第四份字面**(code-reviewer R1 N-d)。
//    第一版自己寫了一條 `UUID_RE` + 註解「兩處要一致才不會一邊嚴一邊鬆」——
//    **註解不是機制**,沒有任何東西會在兩份漂開時叫。
//    而 `note-action-state.ts:62-64` 的 docstring 逐字記著同一個教訓:
//    「關卡2 抓到我在 `note-form.ts` 另養了一份字面相同的,那是純粹的漂移面」。
//    該檔零 `server-only`、零 `@/`、零 IO(檔頭 `:3-4` 逐字保證)⇒ 這裡 import 是安全的。

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // PRG 結果碼(上下架 action 導回時帶 `?r=`;鏡像 customers/[id])。
  const rawSearch = await searchParams;
  const resultCode = typeof rawSearch.r === 'string' ? rawSearch.r : undefined;

  // 🔴 形狀不對 → 直接 404,**不打 DB**(路由參數不透傳進查詢;鏡像 app/customers/[id]/page.tsx:22-25)。
  if (!isUuid(id)) {
    notFound();
  }

  // 🔴 三條路要分得開,不能混成一條:
  //    查無 → 404 / 讀取失敗 → 錯誤態 200(不 500、DB error 不外洩)/ 讀到 → 正常顯示。
  let product: AdminProductDetailRow | null = null;
  let loadFailed = false;
  try {
    product = await getProductForAdmin(id);
  } catch (error) {
    console.error('[admin/products/[id]] 商品讀取失敗', error);
    loadFailed = true;
  }

  /**
   * 🔵 **第一層:上架前的確認**(板 `⟦b4-NOVARIANT1⟧`, Sean 2026-08-31 拍 `Q2=甲`)。
   * 這支商品的料號是不是【別支商品的一個規格】—— 有值就在上架鈕旁邊講出來。
   *
   * 🛑 **只在【現在是下架】時才算** —— 已上架的商品問它沒有意義(它已經在架上了),
   *    而那也省掉每次開商品頁的兩發查詢。
   * 🔴 **它失敗時回 `null`(= 不打擾)** —— 而代價明寫:
   *    **DB 出問題時這道提示會安靜地消失**, 畫面上與「這支商品沒問題」長得一樣。
   *    ⇒ 真正擋住的是 server action 那一層(它會再算一次)。
   */
  let variantSkuCollisionOwner: string | null = null;
  if (product && resolveListingState(product) !== 'listed') {
    try {
      variantSkuCollisionOwner = (await findVariantSkuCollision(product.id))?.belongsToExternalId ?? null;
    } catch (error) {
      console.error('[admin/products/[id]] 規格重複偵測失敗(不擋畫面)', error);
    }
  }

  if (!loadFailed && product === null) {
    notFound();
  }

  // 🔴 品牌/分類是**獨立區塊**:它壞掉只讓那一區塊顯錯,其餘欄位照看
  //    (同 customers/[id] 的分區容錯;整頁一起炸會讓員工連料號都查不到)。
  let taxonomy: ProductTaxonomyNames = { brandName: null, categoryName: null };
  let taxonomyFailed = false;
  if (product !== null) {
    try {
      taxonomy = await getProductTaxonomyNames(product.brand_id, product.category_id);
    } catch (error) {
      console.error('[admin/products/[id]] 品牌與分類讀取失敗', error);
      taxonomyFailed = true;
    }
  }

  // 🔴 `max-w-6xl` **刻意留著**:本頁是商品**詳情表單**、沒有表格。
  //    規則:沒有表格 ⇒ 留 `max-w-`(長文字行過寬更難讀);有表格的列表頁一律吃滿寬
  //    (`#640` 守門在 `app/design-tokens.test.ts`)。
  // 商品編輯計畫片 9:「最近的變更」(Sean 09-27 C4 甲:全員可改、留變更紀錄)。讀不到只影響那一塊。
  // 共用圖庫 G5(Sean 09-27 C3):讀報價單 G2 API。env 沒設 ⇒ 'disabled',讀不到只影響「照片」那一塊。
  // 兩個一起讀;報價單那一讀最多等 5 秒(gallery-api LIST_TIMEOUT_MS),卡住時整頁最多慢 5 秒,其餘照常(Fable R1 建議 2)。
  const overrides = readProductOverrides(product?.staff_overrides);
  // 商品頁乙 C4:分類選項讀不到 ⇒ 分類區改成一句說明,其他照常
  const categoryChoicesPromise = listCategoryChoices().catch((error: unknown) => {
    console.error('[admin/products/[id]] 分類選項讀取失敗', error);
    return null;
  });
  const [history, gallery] =
    product === null
      ? [null, null]
      : await Promise.all([loadProductHistory(product.id, await categoryChoicesPromise), loadProductGallery(product)]);
  const categoryChoices = await categoryChoicesPromise;

  // 商品頁乙 A11:從列表點進來時帶著 ?from=(原列表網址)⇒ 返回原列表、上一件 / 下一件照那份清單的順序。
  //   讀不到就只少了上一件 / 下一件,返回連結照樣回原列表。
  const back = parseProductListReturn(rawSearch[FROM_PARAM]);
  let neighbors: { prevId: string | null; nextId: string | null } | null = null;
  if (back && product) {
    try {
      const options = await listProductFilterOptions().catch(() => null);
      const { query } = resolveProductListQuery(back.filter, options);
      neighbors = await findProductNeighbors(product.id, query, back.view.page, back.view.size);
    } catch (error) {
      console.error('[admin/products/[id]] 上一件 / 下一件讀取失敗(不擋畫面)', error);
    }
  }
  const selfHref = back ? productDetailHref(id, back.href) : `/products/${id}`;

  return (
    <div className='mx-auto max-w-6xl space-y-4'>
      <div className='flex flex-wrap items-center gap-3 text-sm' data-product-nav>
        <Link href={back?.href ?? '/products'} className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1'>
          {back ? '← 返回原本的商品列表' : '← 返回商品列表'}
        </Link>
        {neighbors && (
          <span className='ml-auto flex items-center gap-3'>
            {neighbors.prevId ? (
              <Link href={productDetailHref(neighbors.prevId, back?.href)} className='hover:underline' data-product-prev>
                ‹ 上一件
              </Link>
            ) : (
              <span className='text-muted-foreground'>這是第一件</span>
            )}
            {neighbors.nextId ? (
              <Link href={productDetailHref(neighbors.nextId, back?.href)} className='hover:underline' data-product-next>
                下一件 ›
              </Link>
            ) : (
              <span className='text-muted-foreground'>這是最後一件</span>
            )}
          </span>
        )}
      </div>

      <ResultBanner code={resultCode} />
      {/* 商品頁乙 P6:剛建立的手動商品 */}
      {rawSearch.created === '1' && product && resolveListingState(product) !== 'listed' && (
        <p role='status' className='bg-muted rounded-md px-4 py-3 text-sm' data-product-created>
          商品已建立，目前是「已下架」，客人看不到。請檢查照片和文字，確認沒問題再按「上架這件商品」。
        </p>
      )}

      {product === null ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          商品資料載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <>
          {/* ══════════════════════════════════════════════════════════════
              FIX-47 · 商品編輯畫面(OD 稿 `pcm-524f/HANDOFF-orders-ui.md:3666`)
              ══════════════════════════════════════════════════════════════
              🔴 **稿寫的症狀逐字**:「`/products/<uuid>` 現在是六張唯讀卡 + 最底下一張上架/下架。
                 **唯一能改的那張被埋在最下面, 跟六張看不能改的長得一模一樣 —— 看不出哪張能按。**」
              ⇒ 所以這一片改的**不是**「讓它能編輯」, 是**讓人看得出哪一張按得動**。
              ⇒ 三堆:`可以改的` / `還不能用(要先做後端)` / `只能看的`。

              🛑 **上架/下架那個 form 一個字都沒改** —— 稿逐字要求, 理由是它已經上線、
                 已經在寫稽核紀錄。這裡只是把 `<h2>上架 / 下架</h2>` 抽掉、改由卡片抬頭顯示。

              🔴🔴 **一個會過期的耦合, 寫在這裡讓下一個人撞到**:
                 下面三張標「資料庫還沒有這個欄位」——**而那正是選項丙(影子欄)要加的那幾欄**
                 (`~/pcm-mailbox/60-線2-20-商品編輯-選項丙-plan-20260825.md`,Sean 拍 `Q1=丙`
                  而 plan 本身 2026-09-01 仍未批)。
                 ⇒ **丙 落地的那一天, 這三個標籤就變成假的, 而不會有任何東西紅。**
                 ⇒ 做丙的人:請連這三張一起改, 不要只加欄位。
              ══════════════════════════════════════════════════════════════ */}

          {/* 商品頁改版乙 B1:頂端摘要帶(取代原識別列)。封面、客人看到的標題、重點欄位、上下架按鈕放在第一屏。
              原識別列的註解重點(副標沒值不渲染節點、資訊列不用 <dt>/<dd>、用字「上架中 / 已下架」)搬進 product-summary-band.tsx。 */}
          <ProductSummaryBand
            product={product}
            overrides={overrides}
            brandName={taxonomy.brandName}
            categoryName={taxonomy.categoryName}
            taxonomyFailed={taxonomyFailed}
            actions={
              <>
                <button
                  type='button'
                  disabled
                  title='批次改特價尚未開放，目前無法儲存商品特價。'
                  className='text-muted-foreground rounded-md border px-3 py-1 text-sm disabled:opacity-50'
                >
                  批次改特價
                </button>
                {/* 商品編輯片 9 之後變更紀錄已經有了 ⇒ 從 disabled 改成跳到下面「最近的變更」 */}
                <a
                  href='#product-history'
                  data-history-jump
                  className='rounded-md border px-3 py-1 text-sm'
                >
                  查看變更紀錄
                </a>
              </>
            }
            listing={
              <>
                {/* 🔴 M-4b `#20`:上下架原本是這一頁唯一的寫入動作(丙方案片 2 之後多了上面那三張)。
                    位置=詳情頁(plan §3 裁定);理由與「不放列表」的取捨寫在
                    `components/products/product-listing-form.tsx` 檔頭。 */}
                <section data-od-pe='card' className='rounded-lg border p-4'>
                  <div className='mb-3 flex items-center gap-2'>
                    <h3 className='text-sm font-medium'>上架 / 下架</h3>
                    <span data-od-pe='live' className='bg-muted rounded-md px-2 py-0.5 text-xs'>
                      已經可以用
                    </span>
                  </div>
                  <ProductListingForm
                    returnTo={selfHref}
                    productId={product.id}
                    listed={resolveListingState(product) === 'listed'}
                    variantSkuCollisionOwner={variantSkuCollisionOwner}
                  />
                </section>
              </>
            }
          />

          {/* ── 可以改的 ───────────────────────────────────────────── */}
          {/* 🔴 用 `<h2>` 不用 `<p>`(codex must-fix):三堆是**分組**,
              而 `<p>` 在螢幕閱讀器的 heading 導航裡**完全不存在**
              ⇒ 看得見的人有三堆, 用聽的人只有一長串卡片。稿畫的是視覺, 語意要我們自己給。 */}
          <h2 data-od-pe='grouph' className='text-muted-foreground pt-2 text-sm font-medium'>
            可以改的
          </h2>
          {/* 商品頁改版乙 B2:兩欄, 照片在左、文字在右(計畫第五節)。
              右欄文字下面預留給「分類」區(C4, 進度 86)與「價格」區(P9)。 */}
          <div className='grid gap-4 lg:grid-cols-2'>
            <div data-col='photos' className='min-w-0 space-y-4'>
              {gallery?.state === 'ok' ? (
                <ProductGalleryPanel productId={product.id} initialPhotos={gallery.photos} initialCurated={gallery.curated} />
              ) : gallery ? (
                <section data-od-pe='card' data-gallery-unavailable className='rounded-lg border p-4'>
                  <h3 className='mb-2 text-sm font-medium'>照片</h3>
                  <p className={gallery.state === 'failed' ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'}>
                    {gallery.state === 'failed' ? gallery.message : '圖庫尚未啟用。'}
                  </p>
                </section>
              ) : null}
            </div>
            <div data-col='text' className='min-w-0 space-y-4'>
              {/* 商品編輯丙方案片 2(Sean 2026-09-27 C4 甲:所有員工都能改,留變更紀錄):
                  標題 / 副標 / 賣點的「我們的版本」。寫入走 admin_set_product_override RPC(20260927060000)。
                  說明不在這裡:說明走說明鎖(Sean 09-02 ⟦b4-QUOTEDESCLOCK⟧),後台入口是另一片。 */}
              <ProductOverridesEditor
                productId={product.id}
                supplier={{
                  title: product.title,
                  subtitle: product.subtitle,
                  highlights: toProductMedia(product).highlights,
                }}
                overrides={overrides}
              />
              {/* 商品頁乙 C4:分類區(文字下面、價格上面)。 */}
              {categoryChoices ? (
                <ProductCategoryEditor
                  productId={product.id}
                  currentCategoryId={product.category_id}
                  locked={product.category_locked === true}
                  categories={categoryChoices}
                />
              ) : (
                <section data-od-pe='card' className='rounded-lg border p-4'>
                  <h3 className='mb-2 text-sm font-medium'>分類</h3>
                  <p className='text-destructive text-sm'>分類選項載入失敗，暫時不能修改分類，請重新整理頁面。</p>
                </section>
              )}
            </div>
          </div>
          {history && <ProductHistory rows={history.rows} loadFailed={history.loadFailed} />}

          {/* ── 還不能用(要先做後端)────────────────────────────────
              商品頁改版乙 B2:原本三張停用的灰卡(特價 / 分類 / 各規格現貨數量)收成一行字(計畫第五節;審視 E1)。
              每一項缺什麼的說明收在展開裡, 字不改。分類開通後(C4)從這一行拿掉「分類」。 */}
          <details data-not-yet className='text-muted-foreground rounded-lg border px-4 py-2 text-sm'>
            <summary className='cursor-pointer'>還不能用(要先做後端):特價、各規格現貨數量</summary>
            <div className='mt-2 space-y-2'>
              {/* 🔴 這一段是 **Sean 指定的字**(稿裡標「Sean 指定」)——
                  而稿同時**刻意不寫**「之後可以再調整這筆訂單的特價」:
                  訂單金額四欄只在建單時寫一次, `總額 = 小計 + 運費 − 折扣` 是 DB 層 CHECK 綁死的,
                  事後補等於改一筆**已經發生的收款紀錄**。⇒ 那句話不得出現在這一頁。 */}
              <p className='text-muted-foreground mt-2 text-sm'>
                {/* 🔴🔴 **原價走 `resolvePrice`, 不直讀欄位**(全 repo 守門 `product-repository.test.ts`
                    驗收 5:期望 false 實得 true)。那道守門擔保的是**價格只從一個地方來**。
                    📌 我當時寫 `product.price_general` 是因為**它在型別上就在那裡, 而 TS 不會紅** ——
                       繞過取值落點與正確取值**在 diff 上長得一樣**, 三綠也不會紅。
                    ⇒ 只有那道全 repo 掃描守得到, 而它**不 import 這支檔**
                       ⇒ ⇒ `vitest related` 的分母裡結構上沒有它。 */}
                原價維持 {resolvePrice(product) ?? '—'};差額會以「折扣」出現在訂單與單據上。
                折扣在【建單當下】就記進那張訂單。訂單金額只在成立時寫一次,
                之後不會再被商品這邊的特價動到 —— 已經成立的訂單不會因為今天改特價而變動。
              </p>
              {/* 🔴 **三段腳註改了什麼 —— 逐段列, 不寫概括句**(codex R1 must-fix)。
                  ⛔ ~~我第一版的標題句寫「只拿掉 markdown, 欄位名一個都沒刪」~~ **那句是假的**,
                     而它自己下面三行就在講那個例外 ⇒ **一句宣稱與它的但書並排, 說相反的話。**
                  📌 而那正是本檔上一片(FIX-47)在修的病, 也是退款異常那頁的病 ——
                     **同一夜第三次, 而這一次的載體是【我自己的宣稱句】。**
                  🔵 **⇒ 而會受害的是【grep 到那句話就停】的人:概括句先出現, 但書在四行之下。**

                  ✅ **量法** —— 🔴🔴 **那個數字被審了三輪, 每一輪都指出它少帶一段量法。**
                     ```
                     R2(gpt-5.6-sol):用 AST 數同一個對象 ⇒ 三張卡 11/11、整頁 25/25
                     R3(gpt-5.5)   :照我自己寫的 `jsxTextNodes()` 數 ⇒ **原始節點是 24/24, 不是 22**
                     ```
                     🔴 **兩輪都對, 而錯的是我**:22 不是「節點數」, 是**正規化 + 去重成集合之後**的大小
                     —— 而我的註解只寫了「比集合」, **沒寫去重, 也沒寫正規化剝掉了什麼**。
                     📌 **⇒ 一個數字要能被核出來, 它得帶著【每一步】量法, 不是帶著最後一步。**

                     ✅ **完整的四個數字(2026-08-31 自己重量, script 在 scratchpad `recount.py`)**:
                     ```
                     ① 原始文字節點(list)                       改前 24 / 改後 24  ← codex R3 量到的
                     ② 逐字不同的節點(對 list 做 ndiff)          3(三段腳註各一段)
                     ③ 正規化(剝空白與 markdown 符號)+ 去重成 set  改前 22 / 改後 22  ← 我原本寫的那個
                     ④ set 的差異                                 兩側各 2
                     ```
                     🔵 **⇒ 而②與④差的那 1 段, 正是「分類」那一段** —— 它只有符號與換行變了,
                        **正規化之後逐字相同** ⇒ ⇒ **那個差本身就是「純符號改動」最乾淨的證據。**
                     🛑 **而承重的是③④那一對, 不是任何單一數字**:
                       · 分類那段  ⇒ 剝符號後【逐字相同】= 純符號改動, 零字變動
                       · 現貨那段  ⇒ **加了「注意:」兩個字**(替代被拿掉的粗體), 零刪除
                       · 特價那段  ⇒ **`price_general` 那個子句被改寫**, 原句逐字在下面
                  🛑 **⇒ 所以精確的說法是:兩段零刪除、一段加兩個字、一段改寫一個子句。**

                  🔴 **那個被改寫的子句, 原句逐字**:「正向對照 `price_general` 有」——
                     它踩的是**另一道守門**(讀取層驗收 5:`price_general` 出現在非註解的碼裡就算直讀)。

                     🔴🔴 ⛔ ~~我原本在這裡寫:「那道守門守的是**字面**, 因為【有沒有真的在讀】
                        它看不出來 ⇒ 連在文案裡提到這個欄位名都會踩到, **而它這樣是對的**。」~~
                     **那句話是假的, 而 codex R3(換模型換角度)用一支 TS AST 探針當場打穿它** ——
                     它分得出舊版的 `product.price_general`(property access = 真的在讀)
                     與這一段文案裡的同一串字(純文字 = 沒有在讀)。
                     📌 **⇒ 所以不是「看不出來」, 是【這把尺沒有去看】。**
                     🔴 **⇒ 而我那句話的形狀是最該警惕的一種:把【量具的限制】寫成【設計原則】** ——
                        它讓一個可以修的東西, 讀起來像一個不必修的東西。
                        ⇒ ⇒ 而寫下它的動機也很清楚:**那句話讓我的繞法看起來正當。**
                     ✅ **現行事實**:那把尺**今天**是字面掃描 ⇒ 今天我照它的字面做(識別字不進可見文案);
                        而**「該不該改成 AST 掃描」是那道守門自己的一片**, 已交回主視窗開列。 */}
              {/* 🔴 **不寫「證明」**(codex R1 nit):正向對照排掉的是**一種**可能, 不等於證明。
                  🔴 **而「我查錯地方」也太寬**(codex R2 nit):正向對照只排掉
                     「**這份型別根本沒被搜到 / 尺完全不會命中**」;
                     它**排不掉**「搜的是過期的、不完整的、或錯的那一份來源」。
                  ⇒ ⇒ 📌 **寫出它排掉了【哪一扇門】, 不寫它證明了什麼, 也不寫得比它做到的寬。** */}
              <p className='text-xs'>目前尚未支援儲存商品特價，因此無法在此設定。</p>
              <p className='text-xs'>
                目前尚未支援管理各規格的現貨數量。供應狀態及訂單到貨數量都不能作為商品庫存數量。
              </p>
            </div>
          </details>

          {/* ── 只能看的 ───────────────────────────────────────────
              🔴 原本那六張 section **原封收進來**, 一張都沒少(稿指定)。
                 收成 `<details>` 的理由:它們是「看的」而不是「按的」,
                 而它們平鋪展開正是「看不出哪張能按」的成因。 */}
          {/* 🔴 用 `<h2>` 不用 `<p>`(codex must-fix):三堆是**分組**,
              而 `<p>` 在螢幕閱讀器的 heading 導航裡**完全不存在**
              ⇒ 看得見的人有三堆, 用聽的人只有一長串卡片。稿畫的是視覺, 語意要我們自己給。 */}
          <h2 data-od-pe='grouph' className='text-muted-foreground pt-2 text-sm font-medium'>
            只能看的
          </h2>
          <details data-od-pe='other' className='rounded-lg border p-4'>
            <summary className='cursor-pointer text-sm font-medium'>商品資料(唯讀)</summary>
            <div className='mt-3'>
              <ProductDetail
                product={product}
                brandName={taxonomy.brandName}
                categoryName={taxonomy.categoryName}
                taxonomyFailed={taxonomyFailed}
              />
            </div>
          </details>

          {/* 🔴 這一句原本是「這一頁只能查看,不能修改」—— **本片之後那是假的**。
              (同 `app/products/page.tsx:60-64` 的教訓:不要留一句已經不成立的自述。)
              🛑 而稿明寫**這一句要留著** —— 它是這一頁自己的誠實話。 */}
          {/* 丙方案片 2 之後:能改的多了標題、副標、賣點 ⇒ 這句跟著改(改的是事實,不是期望值)。 */}
          {/* 共用圖庫 G5:圖庫真的讀得到時才把「照片」算進能改的(沒啟用 / 讀不到時那句不成立)。 */}
          <p className='text-muted-foreground text-sm'>
            {gallery?.state === 'ok'
              ? '這一頁目前能改標題、副標、賣點、照片與上架狀態,其餘欄位仍不能修改。'
              : '這一頁目前能改標題、副標、賣點與上架狀態,其餘欄位仍不能修改。'}
          </p>
        </>
      )}
    </div>
  );
}
