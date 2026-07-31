// FilterDrawerCategoryTab.tsx — 手機抽屜「零件分類」tab(#306-b 抽出)。
//
// 🔴 抽出理由 = 鐵則 6:FilterDrawer 接上 #306 的即時件數後變成 417 行(上限 400)。
//    對齊同檔既有的 FilterDrawerVehicleTab 抽法;邏輯**原樣搬移、零行為變更**
//    (兩層視圖、Sean 2026-07-13 的「點大類即時套用」拍板註解一併帶過來)。

'use client';

import { type Dispatch } from 'react';
import {
  selectCategoryMain,
  selectCategorySub,
  clearCategory,
  type CascadeFilterState,
  type CascadeFilterAction,
} from '@pcm/ui';
import type { MockCategory } from '@/data/mock-categories';
import { facetCategoryKey, type FacetCountResolver } from '@/lib/vehicle-facet-display';

export function FilterDrawerCategoryTab({
  categories,
  cascade,
  dispatch,
  countOf,
  catMain,
  setCatMain,
}: {
  categories: MockCategory[];
  cascade: CascadeFilterState;
  dispatch: Dispatch<CascadeFilterAction>;
  /** #306:每一格的件數解析器(未選車=全站數 / 選了車=該車真實件數 / null=不顯示)。 */
  countOf: FacetCountResolver;
  /** 目前展開的大類(null=大類清單視圖);state 留在 FilterDrawer,關閉抽屜時一併重置。 */
  catMain: MockCategory | null;
  setCatMain: (c: MockCategory | null) => void;
}) {
  return (
    <div className="fd-veh">
                    {!catMain ? (
                      <>
                        <div className="fd-step-label">選擇大分類</div>
                        {categories.map((c) => {
                          // Sean 2026-07-13:點大類 = 直接篩「該大類全部」(即時套用);有子類則進入細項視圖細分,
                          //   取消原「進入後才有的『全部 {大類}』列」。切不同大類一次點擊即切換。
                          const isMainActive = cascade.category?.mainId === c.id;
                          const hasChildren = c.children.length > 0;
                          // #306 Q2=A:這台車在這個分類 0 件 → 灰掉且點不下去
                          const mainCount = countOf('categories', facetCategoryKey(c.name), c.count);
                          return (
                            <button key={c.id}
                              className={`fd-row ${isMainActive ? 'is-active' : ''} ${mainCount === 0 ? 'is-empty' : ''}`}
                              disabled={mainCount === 0}
                              onClick={() => {
                                dispatch(selectCategoryMain(c.id, c.name));
                                if (hasChildren) setCatMain(c);
                              }}>
                              <span>{c.name}</span>
                              {mainCount !== null && <span className="fd-row-count">{mainCount}</span>}
                              {hasChildren && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
                              )}
                            </button>
                          );
                        })}
                      </>
                    ) : (
                      <>
                        <button className="fd-back" onClick={() => setCatMain(null)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
                          {catMain.name}
                        </button>
                        <div className="fd-step-label">選擇細項</div>
                        {/* 「全部 {大類}」列已移除:進入本視圖前點大類時即已篩全部(Sean 2026-07-13)。 */}
                        {catMain.children.map((s) => {
                          const active = cascade.category?.subId === s.id;
                          const subCount = countOf(
                            'categories',
                            facetCategoryKey(catMain.name, s.name),
                            s.count,
                          );
                          return (
                            <button key={s.id}
                              className={`fd-row ${active ? 'is-active' : ''} ${subCount === 0 ? 'is-empty' : ''}`}
                              disabled={subCount === 0}
                              onClick={() => {
                                if (active) {
                                  dispatch(clearCategory());
                                } else {
                                  dispatch(selectCategoryMain(catMain.id, catMain.name));
                                  dispatch(selectCategorySub(s.id, s.name));
                                }
                              }}>
                              <span>{s.name}</span>
                              {subCount !== null && <span className="fd-row-count">{subCount}</span>}
                              {active && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" /></svg>}
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>
  );
}
