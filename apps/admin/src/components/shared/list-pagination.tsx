import Link from 'next/link';
import {
  computePagination,
  pageWindow,
  type PaginationView,
  type PageTruncation,
} from '../../lib/shared/list-params';

// list-pagination.tsx — 後台列表通用 server 端分頁控制(訂單 / 客戶等共用)。
// prev/next 為 <Link>(href 由 caller 的 buildHref(page) 產、保留各自篩選);footer 由真實 shownCount 推導、不謊報。
//
// ── 2026-08-19 商品分頁片(plan = docs/specs/2026-08-19-admin-products-pagination-plan.md)──
// 🔴🔴 **新增的兩個 props(`jump` / `truncation`)全部是【可選】,而那是刻意的**:
//    本元件有 **6 個呼叫端**(orders / customers / customer-detail / supplier-table /
//    admin-data-table / products)。兩個 props 都不給時,**渲染輸出與改造前逐字相同**
//    ⇒ 其餘 5 個呼叫端零行為改動。這件事由 `list-pagination.test.tsx` 釘住,不靠「看起來一樣」。
// 🔴 **零 JS**:頁碼是 `<Link>`、跳頁與換筆數是 `<form method='get'>`
//    (抄同頁既有做法 `components/products/product-keyword-search.tsx` 的檔頭理由)。
//    ⇒ 不引入 client component、不用任何 `use*` hook。

const NAV = 'flex h-9 items-center rounded-md border px-4 text-sm';
const NAV_ENABLED = 'border-input hover:bg-accent hover:text-accent-foreground';
const NAV_DISABLED = 'border-input text-muted-foreground pointer-events-none opacity-50';
const NUM = 'flex h-9 min-w-9 items-center justify-center rounded-md border px-2 text-sm';

/**
 * 這個筆數(含)以上,在選單上標「(較慢)」。
 *
 * 🔴 **這個門檻是量出來的,不是猜的**(2026-08-19,本機 `next dev`、admin 接正式庫、
 * 商品 20,341 件;量法 = `curl -w '%{size_download} %{time_starttransfer}'`,每個值先暖機一發):
 *
 *     每頁 20   ⇒   142 KB / 0.54 s
 *     每頁 200  ⇒   841 KB / 1.52 s   ← 預設
 *     每頁 500  ⇒ 2,006 KB / 3.08 s   ← 從這裡開始有感
 *     每頁 1000 ⇒ 3,946 KB / 7.40 s
 *
 * ⚠️ **這是 `next dev` 的數字,不是正式站的數字。** dev 每次請求都會編譯與插樁 ⇒ 它是**上界**。
 *    正式 build 我**量不到**:`next start` 會 303 轉到 `/api/sso/start`
 *    (`ADMIN_DEV_BYPASS` 只在 dev 生效)⇒ 本機沒有真登入就打不到那一頁。
 *    ⇒ **不要把上面的秒數當成員工會等的秒數**;要真數字得在有真登入的環境量。
 *
 * 🔴 而列數放大的成本不只在 DB —— `admin-data-table.tsx` 的檔頭逐字寫著
 *    「桌機列與手機卡各渲染一次 cell(共兩份 DOM)… **單頁 20-50 列的量級可忽略**」
 *    ⇒ 每頁 1000 = **2000 份列的 DOM**,而手機那半是 CSS 隱藏、不是條件渲染 ⇒ HTML 照送。
 *    本片**刻意不動那個共用元件**(那是另一片、另一個風險面),改成把成本標在選單上讓人看得到。
 */
const SLOW_PAGE_SIZE = 500;

function PageLink({
  href,
  enabled,
  children,
  label,
}: {
  href: string;
  enabled: boolean;
  children: React.ReactNode;
  label?: string;
}) {
  if (!enabled) {
    return (
      <span className={`${NAV} ${NAV_DISABLED}`} aria-disabled='true' aria-label={label}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={`${NAV} ${NAV_ENABLED}`} aria-label={label}>
      {children}
    </Link>
  );
}

/** 頁碼一顆。目前頁不是連結(它已經在這裡了),並帶 `aria-current`。 */
function PageNumber({
  n,
  current,
  href,
}: {
  n: number;
  current: boolean;
  href: string;
}) {
  if (current) {
    return (
      <span className={`${NUM} border-primary bg-primary text-primary-foreground font-medium`} aria-current='page'>
        {n}
      </span>
    );
  }
  return (
    <Link href={href} className={`${NUM} ${NAV_ENABLED}`} aria-label={`第 ${n} 頁`}>
      {n}
    </Link>
  );
}

/** 隱藏欄位:把「這一頁其他的軸」原封帶過 GET form。`undefined` 的不送。 */
function Hidden({ fields }: { fields: Readonly<Record<string, string | undefined>> }) {
  return (
    <>
      {Object.entries(fields).map(([k, v]) =>
        v === undefined ? null : <input key={k} type='hidden' name={k} value={v} />,
      )}
    </>
  );
}

/** 「跳到第幾頁」+「每頁幾筆」兩個零 JS 表單所需的一切。**不給 = 不渲染這一整區。** */
export type ListPaginationJump = {
  /** GET form 的 action(例 `/products`) */
  readonly action: string;
  /** 篩選軸(不含 page / size);兩個表單都要帶,否則換頁或換筆數會把篩選洗掉 */
  readonly filterFields: Readonly<Record<string, string | undefined>>;
  readonly pageParam: string;
  readonly sizeParam: string;
  readonly sizeOptions: readonly number[];
  readonly currentSize: number;
  /** 預設筆數:等於它時不送進網址(與 buildHref 的省略規則對齊) */
  readonly defaultSize: number;
};

export function ListPagination({
  page,
  total,
  pageSize,
  shownCount,
  buildHref,
  unit = '筆',
  jump,
  truncation,
}: {
  page: number;
  total: number;
  pageSize: number;
  /** 本頁實際顯示的列數(推導與表格一致的「第 X–Y」;超界頁為 0) */
  shownCount: number;
  /** 給定頁碼 → 該頁連結(caller 帶入各自篩選);prev/next 用 */
  buildHref: (page: number) => string;
  /** 計數單位(「筆」訂單 / 「位」客戶) */
  unit?: string;
  /** 🔴 **可選**。給了才渲染頁碼列 + 跳頁框 + 每頁筆數選單。 */
  jump?: ListPaginationJump;
  /** 🔴 **可選**。非 `null` 時渲染紅色警示帶 —— 見 `detectPageTruncation` 的檔頭。 */
  truncation?: PageTruncation | null;
}) {
  const view: PaginationView = computePagination(total, page, pageSize, shownCount);
  const pages = jump ? pageWindow(view.currentPage, view.totalPages) : [];
  const half = Math.ceil(pages.length / 2);

  return (
    <div className='flex flex-col gap-3'>
      {/* 🔴🔴 截斷警示帶。**這個病的本體就是【安靜】** —— 少了幾列的頁,
          和正常的頁在畫面上長得一模一樣。把它變吵,才叫修好。
          ⚠️ 它印出四個數字而不是一句「發生錯誤」:下一個人要能【不看 code】就判斷是哪一種。 */}
      {truncation != null && (
        <div className='border-destructive/40 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm'>
          <p className='font-medium'>
            ⚠️ 這一頁的資料不完整:
            {truncation.missing > 0
              ? `少了 ${truncation.missing} 筆`
              : `多了 ${-truncation.missing} 筆`}
          </p>
          <p className='mt-1 text-xs'>
            這一頁應該有 {truncation.expected} 筆,實際收到 {truncation.shownCount} 筆
            (從第 {truncation.offset + 1} 筆起算,總共 {truncation.total} 筆)。
            <br />
            🔴 <strong>請把這段數字回報給工程</strong>,並先把「每頁筆數」調小再看一次 ——
            調小之後若恢復正常,就是伺服器單次回傳的上限被踩到了。
          </p>
        </div>
      )}

      <div className='flex flex-wrap items-center justify-between gap-4'>
        <p className='text-muted-foreground text-sm'>
          {view.rangeEnd === 0
            ? `共 ${total} ${unit}`
            : `第 ${view.rangeStart}–${view.rangeEnd} ${unit} / 共 ${total} ${unit}(第 ${view.currentPage}／${view.totalPages} 頁)`}
        </p>
        <div className='flex items-center gap-2'>
          <PageLink href={buildHref(page - 1)} enabled={view.hasPrev}>
            上一頁
          </PageLink>
          <PageLink href={buildHref(page + 1)} enabled={view.hasNext}>
            下一頁
          </PageLink>
        </div>
      </div>

      {jump && (
        <div className='flex flex-wrap items-center justify-between gap-3'>
          {/* 每頁筆數。🔴 **不帶 page** ⇒ 換筆數一律回第 1 頁:
              在每頁 20 筆的第 87 頁改成每頁 1000,第 87 頁早就超出範圍了。 */}
          <form method='get' action={jump.action} className='flex items-center gap-2'>
            <Hidden fields={jump.filterFields} />
            <label htmlFor='list-page-size' className='text-muted-foreground text-sm'>
              每頁
            </label>
            <select
              id='list-page-size'
              name={jump.sizeParam}
              defaultValue={String(jump.currentSize)}
              className='border-input h-9 rounded-md border px-2 text-sm'
            >
              {jump.sizeOptions.map((n) => (
                <option key={n} value={String(n)}>
                  {n} 筆{n >= SLOW_PAGE_SIZE ? '(較慢)' : ''}
                </option>
              ))}
            </select>
            <button type='submit' className={`${NAV} ${NAV_ENABLED}`}>
              套用
            </button>
          </form>

          <div className='flex flex-wrap items-center gap-1'>
            {/* 🔴 `<<` `<` 是 Sean 的草圖上【沒有】的,而保留它不是「加他沒說的」——
                改造前這裡就有「上一頁」⇒ **拿掉往回的路才是改動,保留才是維持**。 */}
            <PageLink href={buildHref(1)} enabled={view.hasPrev} label='第一頁'>
              «
            </PageLink>
            <PageLink href={buildHref(page - 1)} enabled={view.hasPrev} label='上一頁'>
              ‹
            </PageLink>

            {pages.slice(0, half).map((n) => (
              <PageNumber key={n} n={n} current={n === view.currentPage} href={buildHref(n)} />
            ))}

            {/* 自填頁碼。`page` 這一軸由這個 input 提供,所以 hidden 只帶篩選 + 筆數。 */}
            <form method='get' action={jump.action} className='flex items-center gap-1'>
              <Hidden
                fields={{
                  ...jump.filterFields,
                  [jump.sizeParam]:
                    jump.currentSize === jump.defaultSize ? undefined : String(jump.currentSize),
                }}
              />
              <input
                type='number'
                name={jump.pageParam}
                min={1}
                max={view.totalPages}
                defaultValue={String(view.currentPage)}
                aria-label={`跳到第幾頁,共 ${view.totalPages} 頁`}
                className='border-input h-9 w-16 rounded-md border px-2 text-center text-sm'
              />
              <button type='submit' className={`${NUM} ${NAV_ENABLED}`} aria-label='跳頁'>
                前往
              </button>
            </form>

            {pages.slice(half).map((n) => (
              <PageNumber key={n} n={n} current={n === view.currentPage} href={buildHref(n)} />
            ))}

            <PageLink href={buildHref(page + 1)} enabled={view.hasNext} label='下一頁'>
              ›
            </PageLink>
            <PageLink href={buildHref(view.totalPages)} enabled={view.hasNext} label='最後一頁'>
              »
            </PageLink>
          </div>
        </div>
      )}
    </div>
  );
}
