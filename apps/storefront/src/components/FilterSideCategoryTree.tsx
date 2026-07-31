// FilterSideCategoryTree.tsx — 桌機左側欄的「零件分類」樹。
//
// 🔴 自 FilterSide.tsx 抽出(鐵則 6:元件檔 >400 行必拆)。接手前 FilterSide 已是 432 行、
//    #306-b 的件數接線再加 18 行 ⇒ 抽這棵樹(約 95 行)讓它回到 400 以內。
//    邏輯**原樣搬移、零行為變更**(Sean 2026-07-12 的兩條 UX 調整註解一併帶過來)。

'use client';

import { useRef, useState, type Dispatch } from 'react';
import {
  selectCategoryMain,
  selectCategorySub,
  clearCategory,
  type CategorySelection,
  type CascadeFilterAction,
} from '@pcm/ui';
import type { MockCategory } from '@/data/mock-categories';
import { facetCategoryKey, type FacetCountResolver } from '@/lib/vehicle-facet-display';

export function CategoryTree({
  categories,
  category,
  dispatch,
  countOf,
}: {
  categories: MockCategory[];
  category: CategorySelection | null;
  dispatch: Dispatch<CascadeFilterAction>;
  /** #306:每一格的件數解析器(未選車=全站數 / 選了車=該車真實件數 / null=不顯示)。 */
  countOf: FacetCountResolver;
}) {
  const [expanded, setExpanded] = useState<string | null>(category?.mainId ?? null);
  // Sean 2026-07-12 UX 調整②:點大類後把該分類區塊捲到側欄頂端,讓展開的子類有空間、
  //   不再被側欄底部切掉(只捲 .fs-side 內部、不動整頁視窗;rAF 等展開 render 後再量位置)。
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollCategoryToTop = (id: string) => {
    requestAnimationFrame(() => {
      const el = rowRefs.current.get(id);
      const container = el?.closest<HTMLElement>('.fs-side');
      if (!el || !container || typeof container.scrollBy !== 'function') return;
      const delta = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollBy({ top: delta, behavior: 'smooth' });
    });
  };
  return (
    <div className="fs-tree">
      {categories.map((c) => {
        // Sean 2026-07-12 UX 調整①(授權 override design/#212 的獨立「全部」列):
        //   點大類 = 直接篩「該大類全部」+ 展開子類(有的話);切到不同大類只需一次點擊。
        //   要看子類再點子類;再點「已選且展開」的同一大類 → 取消 + 收合(toggle)。
        const hasChildren = c.children.length > 0;
        const isMainActive = category?.mainId === c.id && !category?.subId;
        // #306 Sean Q2=A:這台車在這個分類 0 件 → 灰掉且點不下去(點進去只會看到空頁)。
        const mainCount = countOf('categories', facetCategoryKey(c.name), c.count);
        const mainEmpty = mainCount === 0;
        return (
          <div
            key={c.id}
            ref={(el) => {
              if (el) rowRefs.current.set(c.id, el);
              else rowRefs.current.delete(c.id);
            }}>
            <button
              className={`fs-tree-row fs-tree-l1 ${isMainActive ? 'is-active' : ''} ${mainEmpty ? 'is-empty' : ''}`}
              disabled={mainEmpty}
              onClick={() => {
                if (isMainActive) {
                  // 再點已選的同一大類(顯示全部中)→ 取消篩選 + 收合
                  dispatch(clearCategory());
                  setExpanded(null);
                } else {
                  // 點大類 → 篩該大類全部;有子類則同步展開並把區塊捲進視野(切別類自動收合舊的)
                  dispatch(selectCategoryMain(c.id, c.name));
                  if (hasChildren) {
                    setExpanded(c.id);
                    scrollCategoryToTop(c.id);
                  } else {
                    setExpanded(null);
                  }
                }
              }}>
              {/* chevron:僅 hasChildren 才有展開語意(旋轉);childless 固定右指作 affordance,視覺細節 Sean 調 */}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                style={{ transform: hasChildren && expanded === c.id ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                <path d="m9 18 6-6-6-6" />
              </svg>
              <span>{c.name}</span>
              {mainCount !== null && <span className="fs-tree-count">{mainCount}</span>}
            </button>
            {expanded === c.id && hasChildren && (
              <>
                {c.children.map((s) => {
                  const isActive = category?.subId === s.id;
                  const subCount = countOf('categories', facetCategoryKey(c.name, s.name), s.count);
                  const subEmpty = subCount === 0;
                  return (
                    <button key={s.id}
                      className={`fs-tree-row fs-tree-l2 ${isActive ? 'is-active' : ''} ${subEmpty ? 'is-empty' : ''}`}
                      disabled={subEmpty}
                      onClick={() => {
                        if (isActive) {
                          dispatch(clearCategory());
                        } else {
                          dispatch(selectCategoryMain(c.id, c.name));
                          dispatch(selectCategorySub(s.id, s.name));
                        }
                      }}>
                      <span>{s.name}</span>
                      {subCount !== null && <span className="fs-tree-count">{subCount}</span>}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
