// ProductsSortBar.tsx — 目錄頁工具列(商品數 + grid 欄數切換 + 排序下拉)。
//
// 🔵 **為什麼獨立成檔(與行數無關的理由)**:它的 props 全部是**顯示值與 setter**,
//    與篩選狀態機零耦合;而它同時是 `.pp-count` 這個字面的**唯一產生點** ——
//    量測與測試都靠那個字面(⟦search-SHORTNAMEZEROFLASH⟧ 的讀數就是讀它)
//    ⇒ **讓它有一個自己的門牌, 下一個要改那句字面的人才找得到。**
// 🛑 **本檔是純位移**:函式本體與註解一個字沒改(原 `ProductsPage.tsx:177-223`)。
import { SORT_OPTIONS } from '@/lib/sort-options';

// SortBar — 商品數 + grid 欄數切換 + 排序下拉(cascade 版面無 drawer 篩選鈕)
export function ProductsSortBar({
  count,
  isPending = false,
  gridCols,
  setGridCols,
  sort,
  setSort,
}: {
  count: number | null;   // null = 撈不到，不是 0 件（見 displayCount 的註解）
  /** 🔴 ⟦search-CATSWITCHSLOW⟧ ①:切分類的那一發導覽還在飛(3.4-6.3 秒)。
   *   預設 `false` ⇒ **沒傳的呼叫端行為與本片之前逐字相同**(件數照印)。 */
  isPending?: boolean;
  gridCols: number;
  setGridCols: (n: number) => void;
  sort: string;
  setSort: (value: string) => void;
}) {
  return (
    <div className="pp-sortbar">
      <div className="pp-sortbar-left">
        {/* 🔴 三態不是兩態:`isPending` 排在最前面, 因為切分類的那幾秒裡 `count` 還是**舊的**
            ⇒ 印舊件數比印「更新中…」糟(它看起來像「已經算完了而數字沒變」)。
            🔵 形狀抄 design-reference `StorePickerModal.jsx:151` 的「定位中…」——
               **原地換字**, 不新造元件、不加轉圈圈(稿裡沒有那個東西)。 */}
        <span className={`pp-count${isPending ? ' is-loading' : ''}`}>
          {isPending ? '更新中…' : count === null ? '件數未能載入' : `${count} 件商品`}
        </span>
      </div>
      <div className="pp-sortbar-right">
        <div className="pp-grid-toggle">
          {[3, 4, 5].map((n) => (
            <button key={n}
              className={gridCols === n ? 'is-active' : ''}
              onClick={() => setGridCols(gridCols === n ? 0 : n)}
              aria-label={`每排 ${n} 欄`}
              data-tip={`每排 ${n} 欄`}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                {[...Array(n).keys()].map((i) => (
                  <rect key={i} x={i * (16 / n) + 1} y="1" width={16 / n - 2} height="14" />
                ))}
              </svg>
            </button>
          ))}
        </div>
        <div className="ft-divider" />
        {/* 選項來自 lib/sort-options 單一定義點(手機的排序面板吃同一份;value 同時是 ?sort= 契約)。
            手機不顯示本下拉(products-mobile.css 隱藏)= 排序改走上方工具列的獨立入口。 */}
        <select className="ft-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
