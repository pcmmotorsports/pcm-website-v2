// VehicleFinder.tsx — 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬
// (N°01 · 輸入你的車輛、brand → models → years 三層 select)
//
// design 用 window.PCM_DATA.motoBrands → S2/#220b 起改 props motoBrands(server 端
// fetchVehicleTaxonomy 從真 fitment 衍生、與 /products 解析端同一 id 空間)。
// React.useState → import { useState }
//
// S2(2026-07-03、#220b 收斂):
// - 資料源 MOCK_MOTO_BRANDS → props(真 fitment 衍生清單;mock 檔留 dev-preview/測試 fixture)。
// - push 長版 ?brand=&model=&year=(M-1-13I Q1=C)→ 短版 ?vehicle=brandId:modelId[:year]
//   (統一 ProductCard href 同格式;id 空間統一後長版的「歷史相容」任務結束、
//   ProductsPage parseVehicleFromUrl 長版分支仍在、吸收書籤舊連結)。
// - 🔴 真資料 37/94 車型全部 fitment 缺年份 → 年份下拉顯「不限年份」且可直接搜尋
//   (push 不帶 year、列表端過濾到車型層);design 無此情境(mock 車型皆有年)、
//   屬真資料迫使的 graceful degradation、非視覺重設計。

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

export function VehicleFinder({ motoBrands }: { motoBrands: MockMotoBrand[] }) {
  const router = useRouter();
  const data = { motoBrands };
  const [sel, setSel] = useState({ brand: '', model: '', year: '' });
  const brand = data.motoBrands.find(b => b.id === sel.brand);
  const model = brand?.models.find(m => m.id === sel.model);

  // 無年車型(fitment 全缺年):年份下拉顯「不限年份」、選到車型即可搜尋
  const modelHasYears = (model?.years.length ?? 0) > 0;
  const ready = sel.brand && sel.model && (modelHasYears ? sel.year : true);

  return (
    <section id="vehicle-finder" className="ed-finder">
      <div className="ed-finder-inner">
        <div className="ed-finder-head">
          <div className="ed-finder-label">
            <span className="ed-mono">01 ·</span>
            <span>輸入你的車輛</span>
          </div>
          <div className="ed-finder-hint">精準匹配車款、年份、引擎代號</div>
        </div>
        <div className="ed-finder-bar">
          <label className="ed-finder-slot">
            <span className="ed-finder-slot-label">品牌</span>
            <select value={sel.brand} onChange={(e) => setSel({ brand: e.target.value, model: '', year: '' })}>
              <option value="">—</option>
              {data.motoBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="ed-finder-slot">
            <span className="ed-finder-slot-label">車型</span>
            <select value={sel.model} disabled={!brand} onChange={(e) => setSel({ ...sel, model: e.target.value, year: '' })}>
              <option value="">—</option>
              {brand?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="ed-finder-slot">
            <span className="ed-finder-slot-label">年份</span>
            <select value={sel.year} disabled={!model} onChange={(e) => setSel({ ...sel, year: e.target.value })}>
              {modelHasYears || !model ? (
                <>
                  <option value="">—</option>
                  {model?.years.map(y => <option key={y} value={y}>{y}</option>)}
                </>
              ) : (
                <option value="">不限年份</option>
              )}
            </select>
          </label>
          <button
            className={`ed-finder-go ${ready ? 'is-ready' : ''}`}
            disabled={!ready}
            onClick={() => {
              const parts = [sel.brand, sel.model];
              if (sel.year) parts.push(sel.year);
              const params = new URLSearchParams({ vehicle: parts.join(':') });
              router.push(`/products?${params.toString()}`);
            }}>
            <span>搜尋部品</span>
            <span className="ed-finder-go-arrow" aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}
