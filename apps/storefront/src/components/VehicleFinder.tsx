// VehicleFinder.tsx — 字面從 design-reference/components/HomePage.jsx @ d5ea3aa 直接搬
// (N°01 · 輸入你的車輛、brand → models → years 三層 select)
//
// design 用 window.PCM_DATA.motoBrands → 改 import { MOCK_MOTO_BRANDS }
// React.useState → import { useState }

'use client';

import { useState, useCallback } from 'react';
import { MOCK_MOTO_BRANDS } from '@/data/mock-moto-brands';

export function VehicleFinder() {
  const data = { motoBrands: MOCK_MOTO_BRANDS };
  const [sel, setSel] = useState({ brand: '', model: '', year: '' });
  const brand = data.motoBrands.find(b => b.id === sel.brand);
  const model = brand?.models.find(m => m.id === sel.model);

  const ready = sel.brand && sel.model && sel.year;

  const onNav = useCallback((target: string, ctx?: object) => {
    // d1 階段 stub
    console.log('[onNav]', target, ctx);
  }, []);

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
              <option value="">—</option>
              {model?.years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <button
            className={`ed-finder-go ${ready ? 'is-ready' : ''}`}
            disabled={!ready}
            onClick={() => onNav('products', { vehicle: { brand: sel.brand, model: sel.model, year: sel.year } })}>
            <span>搜尋部品</span>
            <span className="ed-finder-go-arrow">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}
