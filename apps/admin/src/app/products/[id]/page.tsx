import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '../../../lib/orders/note-action-state';
import { ProductDetail } from '../../../components/products/product-detail';
import { ProductListingForm } from '../../../components/products/product-listing-form';
import { findVariantSkuCollision } from '../../../lib/products/variant-sku-collision';
import { ResultBanner } from '../../../components/orders/result-banner';
import { resolveListingState, resolvePrice } from '../../../lib/products/product-repository';
import {
  getProductForAdmin,
  getProductTaxonomyNames,
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
  return (
    <div className='mx-auto max-w-6xl space-y-4'>
      <Link
        href='/products'
        className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm'
      >
        ← 返回商品列表
      </Link>

      <ResultBanner code={resultCode} />

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

          {/* 識別列:標題 + 料號/供應商/上架狀態 + 兩顆還做不了的按鈕 */}
          <div data-od-pe='ident' className='rounded-lg border p-4'>
            <h1 className='text-base font-medium'>{product.title}</h1>
            {/* 🔴 **副標必須緊接在 h1 後面** —— `page.test.tsx:122-123` 逐字量的是
                `container.querySelector('h1')?.nextElementSibling` 的 textContent。
                我第一版把資訊列放在這裡 ⇒ 那條驗收抓到的是 `料號 RPM-001供應商 rpm…`
                📌 **⇒ 我不是漏了副標, 我是把它擠出了那把尺的觀察點。**
                ⚠️ **已知代價**:ProductDetail 內部也有一份 h1+副標(現在收在 `<details>` 裡)
                   ⇒ DOM 上有兩個 `h1`。視覺上只看得到一個, 而**無障礙面是重複的**。
                   收斂它要動 ProductDetail = 擴大本片 ⇒ 刻意不做, 寫在這裡讓下一個人接。 */}
            {/* 🔴🔴 **副標是 null 時【整個節點不渲染】, 不是印 `—`** —— 而這是刻意的,
                `page.test.tsx:376` 逐字:「h1 底下多一個空殼會像壞掉」。
                📌 我連錯兩次才走到這裡:先直接印(null ⇒ 空殼)、再 `?? '—'`(違反那個刻意)。
                ⇒ **那兩發紅各自在教我一條【別人已經想過】的決定**, 而不是在說我漏了什麼。
                ⚠️ 本頁其他欄位的慣例確實是「沒值顯 —」—— **副標是那條慣例的明文例外**, 不要統一它。 */}
            {/* 🔴 判空要含 `''` 不只 `null`(codex must-fix):
                我第一版寫 `=== null` ⇒ **空字串照樣渲染一個空 `<p>`**,
                而那正是上面那句「不留空殼」要防的東西。⇒ 判別式與宣稱一致。 */}
            {product.subtitle === null || product.subtitle === '' ? null : (
              <p className='text-muted-foreground text-sm'>{product.subtitle}</p>
            )}
            {/* 🔴🔴 **這一列刻意【不用】 `<dt>/<dd>`** —— 而理由是量到的:
                `page.test.tsx` 的 `fieldValue()` 是「找 `textContent === label` 的 `<dt>`,
                取它的 `nextElementSibling`」。我第一版用 `<dl><div><dt>料號</dt><dd>…</dd></div></dl>`
                ⇒ **那條驗收當場紅了**, 而它報的錯是 `expected '料號RPM-001供應商rpm上架狀態上架中'
                to be '亮面 3K'` —— 它抓到的是**我這一列**, 而不是它本來要量的那一格。
                📌 **⇒ 我不是弄壞了那個功能, 我是弄壞了【量它的那把尺】。**
                ⇒ 改成純 `<span>`:同樣的資訊, 而 ProductDetail 的 `<dt>/<dd>` 仍是那把尺的唯一分母。
                🛑 **不要為了讓這一列語意「更好」而改回 `<dl>`** —— 那會再紅一次, 而下一個人會以為是測試壞了。
                ⚠️ 用字必須與 `product-detail.tsx:113` 逐字相同(`上架中 / 已下架`):
                   我第一版寫「已上架」⇒ 同一頁對同一個狀態兩個說法。 */}
            <div className='text-muted-foreground mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm'>
              <span>
                料號 <span className='text-foreground'>{product.external_id}</span>
              </span>
              <span>
                供應商 <span className='text-foreground'>{product.supplier_slug}</span>
              </span>
              <span>
                上架狀態{' '}
                <span className='text-foreground'>
                  {resolveListingState(product) === 'listed' ? '上架中' : '已下架'}
                </span>
              </span>
            </div>
            {/* 🔴 兩顆 disabled 是稿指定的 —— 而它們**不是佔位**:
                它們讓員工知道「這件事存在, 只是還不能用」, 而不是以為系統沒有這個功能。 */}
            <div className='mt-3 flex flex-wrap gap-2'>
              <button
                type='button'
                disabled
                title='還不能用:批次改特價要先有特價欄位'
                className='text-muted-foreground rounded-md border px-3 py-1 text-sm disabled:opacity-50'
              >
                批次改特價
              </button>
              <button
                type='button'
                disabled
                title='還不能用:商品變更紀錄尚未建立'
                className='text-muted-foreground rounded-md border px-3 py-1 text-sm disabled:opacity-50'
              >
                查看變更紀錄
              </button>
            </div>
          </div>

          {/* ── 可以改的 ───────────────────────────────────────────── */}
          {/* 🔴 用 `<h2>` 不用 `<p>`(codex must-fix):三堆是**分組**,
              而 `<p>` 在螢幕閱讀器的 heading 導航裡**完全不存在**
              ⇒ 看得見的人有三堆, 用聽的人只有一長串卡片。稿畫的是視覺, 語意要我們自己給。 */}
          <h2 data-od-pe='grouph' className='text-muted-foreground pt-2 text-sm font-medium'>
            可以改的
          </h2>
          {/* 🔴 M-4b `#20`:上下架是這一頁**唯一**的寫入動作。
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
              productId={product.id}
              listed={resolveListingState(product) === 'listed'}
              variantSkuCollisionOwner={variantSkuCollisionOwner}
            />
          </section>

          {/* ── 還不能用(要先做後端)────────────────────────────────
              🔴 每張卡的腳註寫的是**缺什麼**, 不是「敬請期待」(稿指定)。
                 那三句的來源是稿裡逐欄查過的結果, 不是我推的。 */}
          {/* 🔴 用 `<h2>` 不用 `<p>`(codex must-fix):三堆是**分組**,
              而 `<p>` 在螢幕閱讀器的 heading 導航裡**完全不存在**
              ⇒ 看得見的人有三堆, 用聽的人只有一長串卡片。稿畫的是視覺, 語意要我們自己給。 */}
          <h2 data-od-pe='grouph' className='text-muted-foreground pt-2 text-sm font-medium'>
            還不能用(要先做後端)
          </h2>

          <section data-od-pe='card' className='rounded-lg border p-4'>
            <div className='mb-2 flex items-center gap-2'>
              <h3 className='text-sm font-medium'>特價</h3>
              <span data-od-pe='todo' className='bg-muted rounded-md px-2 py-0.5 text-xs'>
                還不能用
              </span>
            </div>
            <input
              type='text'
              disabled
              placeholder='—'
              aria-label='特價(還不能用)'
              className='w-40 rounded-md border px-2 py-1 text-sm disabled:opacity-50'
            />
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
            <p className='text-muted-foreground mt-2 text-xs'>
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
              還做不了的原因:資料庫沒有特價欄位(sale_price / special_price / discount_price
              型別定義全 0 命中;而同一份型別裡「原價」那一欄查得到 —— 那是正向對照,
              它排掉的是「這份型別根本沒被搜到」這一種可能)。
            </p>
          </section>

          <section data-od-pe='card' className='rounded-lg border p-4'>
            <div className='mb-2 flex items-center gap-2'>
              <h3 className='text-sm font-medium'>分類</h3>
              <span data-od-pe='todo' className='bg-muted rounded-md px-2 py-0.5 text-xs'>
                還不能用
              </span>
            </div>
            <select
              disabled
              aria-label='分類(還不能用)'
              className='w-56 rounded-md border px-2 py-1 text-sm disabled:opacity-50'
            >
              <option>{taxonomy.categoryName ?? '—'}</option>
            </select>
            <p className='text-muted-foreground mt-2 text-xs'>
              還做不了的原因:products.category_id 是單一 NOT NULL FK,而
              category_set_by 0 命中 ⇒ 改了會被同步覆蓋回去, 而沒有東西記得是我們改的。
            </p>
          </section>

          <section data-od-pe='card' className='rounded-lg border p-4'>
            <div className='mb-2 flex items-center gap-2'>
              <h3 className='text-sm font-medium'>各規格現貨數量</h3>
              <span data-od-pe='todo' className='bg-muted rounded-md px-2 py-0.5 text-xs'>
                還不能用
              </span>
            </div>
            {/* 🔴 這一格原本只有一個 `—`(codex must-fix):稿逐字要求三張都是「控制項 disabled」,
                而只印一個破折號 ⇒ **它看起來像「這個商品沒有現貨資料」, 不是「這個功能還不能用」**。
                📌 兩者在畫面上長得一樣, 而員工的下一步完全不同。 */}
            <input
              type='text'
              disabled
              placeholder='—'
              aria-label='各規格現貨數量(還不能用)'
              className='w-40 rounded-md border px-2 py-1 text-sm disabled:opacity-50'
            />
            <p className='text-muted-foreground mt-2 text-xs'>
              還做不了的原因:stock_quantity 0 命中。⚠️ 注意:不能拿 availability 代替 ——
              它是兩值供應狀態, 不是數量;而唯一的 instock_quantity 住在
              order_item_quantity_summary, 那是訂單側的到貨數。
            </p>
          </section>

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
          <p className='text-muted-foreground text-sm'>
            這一頁目前只能改上架狀態,其餘欄位仍不能修改。
          </p>
        </>
      )}
    </div>
  );
}
