'use client';

import { useState } from 'react';
import {
  CATEGORIES,
  EMPTY_VEHICLE,
  PRODUCTS,
  type Category,
  type Vehicle,
} from './MobileCatalogUxPrimitives';
import { DesktopVehiclePicker } from './DesktopVehiclePicker';
import styles from './desktop-catalog-ux.module.css';

export function DesktopCatalogUxPreview() {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [draft, setDraft] = useState<Vehicle>(EMPTY_VEHICLE);
  const [category, setCategory] = useState<Category | null>(null);
  const [brands, setBrands] = useState<string[]>([]);
  const [price, setPrice] = useState('');
  const [sort, setSort] = useState('推薦排序');

  const count = category?.count ?? (vehicle ? 161 : PRODUCTS.length);
  const countLabel = `${count} 件${vehicle ? '適用' : ''}商品`;

  const applyVehicle = (nextVehicle: Vehicle) => {
    setVehicle(nextVehicle);
    setCategory(null);
  };

  const clearVehicle = () => {
    setVehicle(null);
    setDraft(EMPTY_VEHICLE);
    setCategory(null);
  };

  const toggleBrand = (brand: string) => {
    setBrands((current) => (
      current.includes(brand) ? current.filter((item) => item !== brand) : [...current, brand]
    ));
  };

  return (
    <section
      className={styles.page}
      data-testid="desktop-catalog-ux-preview"
      aria-label="桌機商品目錄預覽"
    >
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.logo}>PCM<span>PREMIUM MOTORCYCLE PARTS</span></div>
          <nav aria-label="桌機預覽導覽">
            <button type="button" className={styles.navActive}>全部商品</button>
            <button type="button">品牌總覽</button>
            <button type="button">最新消息</button>
            <button type="button">技術支援</button>
          </nav>
          <div className={styles.headerTools} aria-hidden="true">⌕　♙　袋</div>
        </div>
      </header>

      <main className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <span>PRODUCT CATALOG</span>
            <h1>全部商品</h1>
          </div>
          <p>首頁　›　商品目錄</p>
        </div>

        <section className={styles.vehicleWorkspace} aria-label="桌機選擇適用車輛">
          <div className={styles.vehicleHeading}>
            <div>
              <span>FITMENT FIRST</span>
              <h2>選擇適用車輛</h2>
            </div>
            <p>先選車，只顯示裝得上的零件</p>
            {vehicle && (
              <strong className={styles.vehicleStatus}>
                目前適用：{vehicle.brand} {vehicle.model}・{vehicle.year}
              </strong>
            )}
          </div>
          <DesktopVehiclePicker
            draft={draft}
            vehicle={vehicle}
            setDraft={setDraft}
            onApply={applyVehicle}
            onClearDraft={() => setDraft(EMPTY_VEHICLE)}
            onClearVehicle={clearVehicle}
          />
        </section>

        <div className={styles.catalogLayout}>
          <aside className={styles.sidebar}>
            <section>
              <div className={styles.sidebarHeading}>
                <h2>商品分類</h2>
                <span>13</span>
              </div>
              <div className={styles.categoryList}>
                {CATEGORIES.map((item) => (
                  <button
                    type="button"
                    key={item.name}
                    aria-label={`桌機分類 ${item.name} ${item.count} 件`}
                    aria-pressed={category?.name === item.name}
                    onClick={() => setCategory(category?.name === item.name ? null : item)}
                  >
                    <span>{item.name}</span>
                    <strong>{item.count}</strong>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className={styles.sidebarHeading}>
                <h2>商品品牌</h2>
                <span>{brands.length || 'ALL'}</span>
              </div>
              <div className={styles.filterList}>
                {['EVOTECH', 'LIGHTECH', 'RPM CARBON', 'CNC RACING'].map((brand) => (
                  <button
                    type="button"
                    key={brand}
                    aria-pressed={brands.includes(brand)}
                    onClick={() => toggleBrand(brand)}
                  >
                    <i aria-hidden="true" />
                    <span>{brand}</span>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className={styles.sidebarHeading}>
                <h2>價格</h2>
                <span>{price ? '1' : 'ALL'}</span>
              </div>
              <div className={styles.priceList}>
                {['NT$ 3,000 以下', 'NT$ 3,000–8,000', 'NT$ 8,000 以上'].map((range) => (
                  <button
                    type="button"
                    key={range}
                    aria-pressed={price === range}
                    onClick={() => setPrice(price === range ? '' : range)}
                  >
                    <i aria-hidden="true" />
                    <span>{range}</span>
                  </button>
                ))}
              </div>
            </section>
          </aside>

          <section className={styles.results} aria-label="桌機商品結果">
            <div className={styles.resultBar}>
              <div>
                <strong>{countLabel}</strong>
                {category && <span>{category.name}</span>}
              </div>
              <label>
                <span>排序</span>
                <select aria-label="商品排序" value={sort} onChange={(event) => setSort(event.target.value)}>
                  <option>推薦排序</option>
                  <option>最新上架</option>
                  <option>價格低到高</option>
                  <option>價格高到低</option>
                </select>
              </label>
            </div>

            <div className={styles.productGrid}>
              {PRODUCTS.map((product, index) => (
                <article className={styles.productCard} key={product.name}>
                  <div className={styles.productImage}>
                    <span aria-hidden="true">{index % 2 === 0 ? '◫' : '◇'}</span>
                    <button type="button" aria-label={`收藏 ${product.name}`}>♡</button>
                  </div>
                  <p>{product.brand}</p>
                  <h3>{product.name}</h3>
                  <strong>{product.price}</strong>
                </article>
              ))}
            </div>
          </section>
        </div>
      </main>
    </section>
  );
}
