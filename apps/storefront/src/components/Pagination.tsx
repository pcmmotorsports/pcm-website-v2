// Pagination.tsx — 商品列表分頁(對齊 design ProductsPage.jsx L392-462)
//
// M-1-12 Codex review 修正:自 ProductsPage.tsx 拆出(AGENTS.md 鐵則 6:元件檔
// >400 行必拆);並修 0 筆結果時顯示「1-0」的錯誤(Codex finding 2)——
// total === 0 時起始筆數顯示 0(宿主另在 resultCount === 0 時直接不渲染本元件)。

import { useMemo, type MouseEvent } from 'react';
import Link from 'next/link';

export function Pagination({
  page,
  totalPages,
  perPage,
  total,
  onChangePage,
  onChangePerPage,
  getPageHref,
}: {
  page: number;
  totalPages: number;
  perPage: number;
  total: number;
  onChangePage: (n: number) => void;
  onChangePerPage: (n: number) => void;
  /** 產生 server 可直接開啟的分頁網址；Google 不必執行 click handler 也能往下爬。 */
  getPageHref: (n: number) => string;
}) {
  const handlePageLinkClick = (event: MouseEvent<HTMLAnchorElement>, targetPage: number) => {
    // 保留 Command／Ctrl／Shift／Alt 點擊與中鍵的瀏覽器行為；原分頁不應跟著改動。
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) return;
    // 普通點擊沿用既有單一導覽路徑，避免 Link push 與 state/router replace 重複送出。
    event.preventDefault();
    onChangePage(targetPage);
  };

  // 可見頁碼:1 … [page-2..page+2] … totalPages,跳號處插入 '…'
  const pages = useMemo<(number | '…')[]>(() => {
    const out = new Set<number>([1, totalPages]);
    for (let i = page - 2; i <= page + 2; i++) {
      if (i >= 1 && i <= totalPages) out.add(i);
    }
    const arr = [...out].sort((a, b) => a - b);
    const withGaps: (number | '…')[] = [];
    arr.forEach((n, i) => {
      if (i > 0 && n - arr[i - 1]! > 1) withGaps.push('…');
      withGaps.push(n);
    });
    return withGaps;
  }, [page, totalPages]);

  // total === 0 時起始筆數顯示 0(避免「1-0」);end 本就為 0
  const start = total === 0 ? 0 : (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);

  return (
    <div className="pp-pagination">
      <div className="pp-pagination-info">
        顯示 <strong>{start}-{end}</strong> / 共 {total} 件
      </div>

      <nav className="pp-pagination-pages" aria-label="分頁">
        {page === 1 ? (
          <button className="pp-page-arrow" disabled aria-label="上一頁">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        ) : (
          <Link
            className="pp-page-arrow"
            href={getPageHref(page - 1)}
            onClick={(event) => handlePageLinkClick(event, page - 1)}
            scroll={false}
            aria-label="上一頁">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
        )}
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="pp-page-gap">···</span>
          ) : (
            <Link
              key={p}
              className={`pp-page-num ${p === page ? 'is-active' : ''}`}
              href={getPageHref(p)}
              onClick={(event) => handlePageLinkClick(event, p)}
              scroll={false}
              aria-current={p === page ? 'page' : undefined}>
              {p}
            </Link>
          ),
        )}
        {page === totalPages ? (
          <button className="pp-page-arrow" disabled aria-label="下一頁">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        ) : (
          <Link
            className="pp-page-arrow"
            href={getPageHref(page + 1)}
            onClick={(event) => handlePageLinkClick(event, page + 1)}
            scroll={false}
            aria-label="下一頁">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>
        )}
      </nav>

      <div className="pp-pagination-perpage">
        <label htmlFor="pp-perpage">每頁</label>
        <select id="pp-perpage" value={perPage} onChange={(e) => onChangePerPage(Number(e.target.value))}>
          <option value={100}>100</option>
          <option value={200}>200</option>
          <option value={500}>500</option>
          <option value={1000}>1000</option>
        </select>
      </div>
    </div>
  );
}
