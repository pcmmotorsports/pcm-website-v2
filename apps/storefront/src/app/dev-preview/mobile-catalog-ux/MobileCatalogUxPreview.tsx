'use client';

import { useMemo, useState, type FocusEvent } from 'react';
import styles from './mobile-catalog-ux.module.css';
import {
  CATEGORIES,
  EMPTY_VEHICLE,
  FilterIcon,
  PRODUCTS,
  SheetHeader,
  type Category,
  type Sheet,
  type Vehicle,
} from './MobileCatalogUxPrimitives';
import { DesktopCatalogUxPreview } from './DesktopCatalogUxPreview';
import { VehiclePickerFields } from './VehiclePickerFields';

export function MobileCatalogUxPreview() {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [draft, setDraft] = useState<Vehicle>(EMPTY_VEHICLE);
  const [category, setCategory] = useState<Category | null>(null);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [price, setPrice] = useState('');
  const [sort, setSort] = useState('推薦排序');

  const productFilterCount = selectedBrands.length + (price ? 1 : 0);
  const resultCount = category?.count ?? (vehicle ? 161 : PRODUCTS.length);
  const canApplyVehicle = Boolean(draft.brand.trim() && draft.model.trim() && draft.year.trim());

  const visibleProducts = useMemo(() => {
    if (!category) return PRODUCTS;
    return PRODUCTS.map((product, index) => ({
      ...product,
      name: index < 4 ? product.name : `${category.name}・${product.name}`,
    }));
  }, [category]);

  const openVehicleSheet = () => {
    setDraft(vehicle ?? EMPTY_VEHICLE);
    setSheet('vehicle');
  };

  const applyVehicle = () => {
    if (!canApplyVehicle) return;
    setVehicle({
      brand: draft.brand.trim().toUpperCase(),
      model: draft.model.trim().toUpperCase(),
      year: draft.year.trim(),
    });
    setCategory(null);
    setSheet(null);
  };

  const applyGarageVehicle = (nextVehicle: Vehicle) => {
    setDraft(nextVehicle);
    setVehicle(nextVehicle);
    setCategory(null);
    setSheet(null);
  };

  const browseAllProducts = () => {
    document.getElementById('mobile-catalog-product-results')?.scrollIntoView({
      block: 'start',
      behavior: 'smooth',
    });
  };

  const clearVehicle = () => {
    setVehicle(null);
    setDraft(EMPTY_VEHICLE);
    setCategory(null);
    setSheet(null);
  };

  const onInputFocus = (event: FocusEvent<HTMLInputElement>) => {
    const target = event.currentTarget;
    window.setTimeout(() => {
      target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }, 160);
  };

  const toggleBrand = (brand: string) => {
    setSelectedBrands((current) => (
      current.includes(brand) ? current.filter((item) => item !== brand) : [...current, brand]
    ));
  };

  const clearProductFilters = () => {
    setSelectedBrands([]);
    setPrice('');
  };

  return (
    <main className={styles.preview} data-testid="mobile-catalog-ux-preview">
      <div className={styles.desktopCatalogSlot}>
        <DesktopCatalogUxPreview />
      </div>

      <section className={styles.phone} aria-label="手機商品目錄預覽">
        <h1 className={styles.srOnly}>PCM 手機商品目錄</h1>
        <header className={styles.appHeader}>
          <button type="button" aria-label="開啟選單" className={styles.iconButton}>☰</button>
          <strong>機車零件</strong>
          <div className={styles.headerActions}>
            <button type="button" aria-label="搜尋" className={styles.iconButton}>⌕</button>
            <button type="button" aria-label="購物車" className={styles.iconButton}>袋</button>
          </div>
        </header>

        <div className={styles.scrollArea}>
          {!vehicle ? (
            <section className={styles.emptyVehicle}>
              <span className={styles.eyebrow}>適用車輛</span>
              <h2>先選車，只看裝得上的零件</h2>
              <button type="button" className={styles.primaryButton} onClick={openVehicleSheet}>選擇車輛</button>
              <button type="button" className={styles.textButton} onClick={browseAllProducts}>
                暫不選車，瀏覽全部商品
              </button>
            </section>
          ) : (
            <>
              <section className={styles.vehicleCard}>
                <div>
                  <span className={styles.eyebrow}>目前適用車輛</span>
                  <h2>{vehicle.brand} {vehicle.model}</h2>
                  <p className={styles.vehicleYear}>{vehicle.year}</p>
                  <p><strong>161</strong> 件適用商品</p>
                </div>
                <div className={styles.vehicleActions}>
                  <button type="button" className={styles.changeButton} onClick={openVehicleSheet}>更換</button>
                  <button
                    type="button"
                    className={styles.clearVehicleButton}
                    aria-label="清除目前車輛"
                    onClick={clearVehicle}
                  >
                    清除車輛
                  </button>
                </div>
              </section>

              <section className={styles.quickCategories}>
                <div className={styles.sectionHeading}>
                  <h2>快速分類</h2>
                  <button type="button" onClick={() => setSheet('category')} aria-label="查看全部分類 13 類">
                    全部 13 類
                  </button>
                </div>
                <div className={styles.categoryGrid}>
                  {CATEGORIES.slice(0, 3).map((item) => (
                    <button
                      type="button"
                      key={item.name}
                      className={category?.name === item.name ? styles.categoryActive : ''}
                      aria-label={`${item.name} ${item.count} 件`}
                      onClick={() => setCategory(item)}
                    >
                      <span>{item.name}</span>
                      <strong>{item.count}</strong>
                    </button>
                  ))}
                  <button type="button" className={styles.allCategoryTile} onClick={() => setSheet('category')}>
                    <span>查看全部分類</span>
                    <strong>13</strong>
                  </button>
                </div>
              </section>
            </>
          )}

          <div className={styles.stickyControls}>
            {vehicle && (
              <div className={styles.compactVehicle}>
                <span>{vehicle.model}・{vehicle.year}</span>
                <div className={styles.compactActions}>
                  <button type="button" onClick={openVehicleSheet}>更換</button>
                  <button type="button" aria-label="快速清除目前車輛" onClick={clearVehicle}>清除</button>
                </div>
              </div>
            )}
            <div className={styles.toolRow}>
              <button type="button" aria-label="分類" onClick={() => setSheet('category')}>
                <span aria-hidden="true">▦</span>分類
              </button>
              <button type="button" aria-label="篩選" onClick={() => setSheet('filter')}>
                <FilterIcon />篩選
                {productFilterCount > 0 && <b>{productFilterCount}</b>}
              </button>
              <button type="button" aria-label={`排序，目前${sort}`} onClick={() => setSheet('sort')}>
                <span aria-hidden="true">⇅</span>{sort}
              </button>
            </div>
          </div>

          <section
            id="mobile-catalog-product-results"
            className={styles.products}
            aria-label="商品結果"
          >
            <div className={styles.resultHeading}>
              <div>
                <span>{vehicle ? `${resultCount} 件適用商品` : '精選商品'}</span>
                {category && <small>{category.name}</small>}
              </div>
              {(category || productFilterCount > 0) && (
                <button type="button" onClick={() => { setCategory(null); clearProductFilters(); }}>清除條件</button>
              )}
            </div>
            <div className={styles.productGrid}>
              {visibleProducts.map((product, index) => (
                <article className={styles.productCard} key={`${product.name}-${index}`}>
                  <div className={styles.productImage}>
                    <span aria-hidden="true">{index % 2 === 0 ? '◫' : '◇'}</span>
                    <button type="button" aria-label={`收藏 ${product.name}`}>♡</button>
                  </div>
                  <p className={styles.productBrand}>{product.brand}</p>
                  <h3>{product.name}</h3>
                  <strong>{product.price}</strong>
                </article>
              ))}
            </div>
          </section>
        </div>

        {sheet && (
          <div className={styles.overlay}>
            <button
              type="button"
              className={styles.backdrop}
              aria-label="關閉目前面板"
              onClick={() => setSheet(null)}
            />

            {sheet === 'vehicle' && (
              <section className={styles.sheet} role="dialog" aria-modal="true" aria-label="選擇適用車輛">
                <SheetHeader title="選擇適用車輛" closeLabel="關閉選車面板" onClose={() => setSheet(null)} />
                <div className={styles.sheetBody}>
                  <VehiclePickerFields
                    draft={draft}
                    setDraft={setDraft}
                    onApplyGarage={applyGarageVehicle}
                    onInputFocus={onInputFocus}
                  />
                </div>
                <footer className={styles.sheetFooter}>
                  <button type="button" className={styles.primaryButton} disabled={!canApplyVehicle} onClick={applyVehicle}>
                    查看 161 件適用商品
                  </button>
                </footer>
              </section>
            )}

            {sheet === 'category' && (
              <section className={styles.sheet} role="dialog" aria-modal="true" aria-label="選擇商品分類">
                <SheetHeader title="選擇商品分類" closeLabel="關閉分類面板" onClose={() => setSheet(null)} />
                <div className={styles.sheetBody}>
                  <button
                    type="button"
                    className={styles.sheetContextButton}
                    aria-label={vehicle ? '更換適用車輛' : '尚未指定車輛，前往選擇'}
                    onClick={openVehicleSheet}
                  >
                    <span>{vehicle ? `適用：${vehicle.model}・${vehicle.year}` : '尚未指定車輛'}</span>
                    <strong>{vehicle ? '更換' : '先選車'} →</strong>
                  </button>
                  <div className={styles.categoryList}>
                    {CATEGORIES.map((item) => (
                      <button
                        type="button"
                        key={item.name}
                        className={category?.name === item.name ? styles.listActive : ''}
                        onClick={() => { setCategory(item); setSheet(null); }}
                      >
                        <span>{item.name}</span>
                        <strong>{item.count}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {sheet === 'filter' && (
              <section className={styles.sheet} role="dialog" aria-modal="true" aria-label="篩選商品">
                <SheetHeader title="篩選商品" closeLabel="關閉篩選面板" onClose={() => setSheet(null)} />
                <div className={styles.sheetBody}>
                  {vehicle && <p className={styles.sheetContext}>適用：{vehicle.model}・{vehicle.year}</p>}
                  <fieldset className={styles.filterGroup}>
                    <legend>商品品牌</legend>
                    <div className={styles.filterChips}>
                      {['EVOTECH', 'LIGHTECH', 'RPM CARBON'].map((brand) => (
                        <button
                          type="button"
                          key={brand}
                          className={selectedBrands.includes(brand) ? styles.filterActive : ''}
                          onClick={() => toggleBrand(brand)}
                        >
                          {brand}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className={styles.filterGroup}>
                    <legend>價格</legend>
                    <div className={styles.filterChips}>
                      {['NT$ 3,000 以下', 'NT$ 3,000–8,000', 'NT$ 8,000 以上'].map((range) => (
                        <button
                          type="button"
                          key={range}
                          className={price === range ? styles.filterActive : ''}
                          onClick={() => setPrice(price === range ? '' : range)}
                        >
                          {range}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>
                <footer className={styles.sheetFooter}>
                  <button type="button" className={styles.primaryButton} onClick={() => setSheet(null)}>
                    查看 {resultCount} 件商品
                  </button>
                  <button type="button" className={styles.textButton} onClick={clearProductFilters}>清除商品篩選</button>
                </footer>
              </section>
            )}

            {sheet === 'sort' && (
              <section className={styles.shortSheet} role="dialog" aria-modal="true" aria-label="商品排序">
                <SheetHeader title="商品排序" closeLabel="關閉排序面板" onClose={() => setSheet(null)} />
                <div className={styles.sortList}>
                  {['推薦排序', '最新上架', '價格低到高', '價格高到低'].map((option) => (
                    <button
                      type="button"
                      key={option}
                      className={sort === option ? styles.listActive : ''}
                      onClick={() => { setSort(option); setSheet(null); }}
                    >
                      <span>{option}{sort === option && <i aria-hidden="true">✓</i>}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
