import type { ReactNode } from 'react';

// E11 後台 UI 積木第一片:共用列表表格(桌機 table / 手機卡片)。
// 背景:規格 §3.3「先做積木,再做頁面」+ Sean 07-25 拍板 N4=A;現況 0 個共用列表抽象
// (orders-table 210 行 vs customers-table 60 行各寫各的),要新增商品/供應商等多個域,
// 沒有積木就是把手刻重複 N 次。
// 通用 UI 規範 §4-1:**手機版列表一律轉卡片,不做橫向捲動表格**——主要欄位加粗置頂、
// 次要副行、金額/狀態靠右(Sean 常用手機遠端操作)。
//
// 本片刻意只做「表格本體 + 手機卡片 + 空狀態」:
//   - 分頁 = 既有 <ListPagination>(頁面層組裝,不吃進來)
//   - 篩選 pill / 批次選取 = 後續片,先不投機抽象
//
// ponytail: 桌機列與手機卡各渲染一次 cell(共兩份 DOM),換來零 JS、零視窗偵測、
//   server component 直出。單頁 20-50 列的量級可忽略。
//   ⚠️ **本段原本的理由已過期**(A11a-1,2026-08-06):`orders-table` 曾內含 `ItemWorkflowStatusCell`
//   (包 `<form action>` 的 Server Component、巢狀 client 下拉),雙渲染會產出重複表單與重複 client 狀態。
//   **那個 cell 已下架,orders-table 現在零互動、零 client 邊界** ⇒ 這個特定阻礙不再成立。
//   但雙渲染對「任何帶互動的欄位」的顧慮仍在:A11a-3 的操作欄(取消鈕)一落地就會重現同一個問題
//   ⇒ 屆時改成單一 markup + CSS reflow,或讓帶互動的欄位只在 title/trailing 槽出現一次。

export type AdminColumn<T> = {
  /** React key 與除錯用;不顯示。 */
  key: string;
  /** 桌機表頭文字。 */
  header: string;
  /** 儲存格內容;回 null/undefined/空字串 = 沒值(桌機顯「—」、手機該欄整格不出現)。 */
  cell: (row: T) => ReactNode;
  /** 追加到桌機 <td> 的 class(對齊既有各表的逐欄樣式)。 */
  className?: string;
  /** 表頭與儲存格靠右(金額/數量)。 */
  alignRight?: boolean;
  /**
   * 手機卡片的位置。省略 = 手機不顯示此欄。
   *   title    第一行粗體主標(通常是名稱/單號)
   *   trailing 第一行靠右(金額、狀態 badge)
   *   sub      第二行次要資訊,多欄以 · 串接
   *   meta     第三行最小字,多欄以 · 串接
   */
  mobile?: 'title' | 'trailing' | 'sub' | 'meta';
};

const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
const TD = 'px-3 py-2 text-sm whitespace-nowrap';

/** cell 回傳是否視為「沒值」;認 null/undefined/空字串(`?? ''` 慣用寫法不落空),0、false 是有效值。 */
function isBlank(node: ReactNode): boolean {
  return node === null || node === undefined || node === '';
}

/** 以 · 串接非空節點;全空回 null(該行整行不渲染)。 */
function joinNodes(nodes: ReactNode[]): ReactNode {
  const kept = nodes.filter((n) => !isBlank(n));
  if (kept.length === 0) return null;
  return kept.map((node, i) => (
    <span key={i}>
      {i > 0 && <span className='px-1.5'>·</span>}
      {node}
    </span>
  ));
}

export function AdminDataTable<T>({
  rows,
  columns,
  getRowKey,
  emptyText,
  renderMobileActions,
}: {
  rows: readonly T[];
  columns: ReadonlyArray<AdminColumn<T>>;
  getRowKey: (row: T) => string;
  /** 查無資料時的整塊文案(各域自訂,如「目前沒有符合條件的客戶。」)。 */
  emptyText: string;
  /** 給「手機上也必須能操作」的列表使用;內容固定放在每張手機卡片最下方。 */
  renderMobileActions?: (row: T) => ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <div className='text-muted-foreground rounded-lg border bg-card p-10 text-center text-sm'>
        {emptyText}
      </div>
    );
  }

  const titleCol = columns.find((c) => c.mobile === 'title');
  if (process.env.NODE_ENV !== 'production') {
    const titleCount = columns.filter((c) => c.mobile === 'title').length;
    if (titleCount !== 1)
      console.warn(
        `AdminDataTable: mobile 'title' 欄位應恰好 1 個,目前 ${titleCount} 個(0=卡片無主標、>1=只取第一個)`,
      );
  }
  const trailingCols = columns.filter((c) => c.mobile === 'trailing');
  const subCols = columns.filter((c) => c.mobile === 'sub');
  const metaCols = columns.filter((c) => c.mobile === 'meta');

  return (
    <>
      {/* 桌機:表格(md 以上)。維持既有 overflow-x-auto 外框,寬表仍可橫捲。 */}
      <div className='hidden overflow-x-auto rounded-lg border bg-card md:block'>
        <table className='w-full border-collapse'>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={col.alignRight ? `${TH} text-right` : TH}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={getRowKey(row)} className='border-t'>
                {columns.map((col) => {
                  const node = col.cell(row);
                  return (
                    <td
                      key={col.key}
                      className={[TD, col.alignRight && 'text-right tabular-nums', col.className]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {isBlank(node) ? '—' : node}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 手機:卡片(md 以下)。§4-1 主要欄位加粗置頂、次要副行、狀態/金額靠右。 */}
      <ul className='divide-y rounded-lg border bg-card md:hidden'>
        {rows.map((row) => {
          const sub = joinNodes(subCols.map((c) => c.cell(row)));
          const meta = joinNodes(metaCols.map((c) => c.cell(row)));
          return (
            <li key={getRowKey(row)} className='p-3'>
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0 font-medium'>{titleCol ? titleCol.cell(row) : null}</div>
                <div className='flex shrink-0 items-center gap-2 text-right text-sm'>
                  {trailingCols.map((c) => {
                    const node = c.cell(row);
                    return isBlank(node) ? null : <span key={c.key}>{node}</span>;
                  })}
                </div>
              </div>
              {sub && <div className='text-muted-foreground mt-1 text-sm break-all'>{sub}</div>}
              {meta && <div className='text-muted-foreground mt-1 text-xs'>{meta}</div>}
              {renderMobileActions && (
                <div className='mt-3 border-t pt-3'>
                  {renderMobileActions(row)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
