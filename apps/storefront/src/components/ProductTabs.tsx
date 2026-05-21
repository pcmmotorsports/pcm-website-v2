// ProductTabs.tsx — 商品詳細頁 4 分頁(商品介紹 / 規格與相容性 / 安裝須知 / 保固與退換)
//
// 字面從 design-reference/components/ProductPage.jsx @ 25d3a2a L382-453 直接搬:
// - 4 tab keys: description / specs / install / warranty(對齊 design L384、非舊 STATUS 寫錯的
//   spec/desc/faq/review)
// - useState('description') 預設選 description
// - 4 pane 內容字面 1:1(brand / name / fits / id / category 動態、其餘 hardcoded mock、
//   對齊鐵則 1「直接搬」+ Q2=A Sean 2026-05-21 拍板)
// - 安裝須知 CTA「預約安裝」走 useRouter().push('/install')、design 字面 onClick={() => onNav('install')}
//   行為對等
//
// 'use client' 必要:useState + onClick handler(對齊 ADR-0006 §1 白名單「Hooks → 'use client'」)
//
// ARIA roles 主動處理(claude.ai 提醒、Q3=A 跳 Codex 但 a11y 自己上):
// - <div role="tablist" aria-label="商品詳細資訊">
// - <button role="tab" aria-selected aria-controls={panel-id} id={tab-id}>
// - <div role="tabpanel" id={panel-id} aria-labelledby={tab-id} hidden>
// - 鍵盤導覽走瀏覽器 default(button 自帶 tab order)、左右鍵切換留 13g 或之後 a11y 補強 slice
//
// 鐵則 9 L3 警示:
// - description 文案 / specs 8 行(4 hardcoded:材質 / 表面處理 / 重量 / 產地)/ install 4 steps /
//   warranty 3 段政策 — 真實業務各 SKU 不同 + 廠商會頻繁更新、嚴格屬 L3 應後台 CRUD
// - Phase 1 既定路線:tab 結構先用 design 字面 mock 上架 → M-1-16 接 Supabase 種子 →
//   之後補後台 PRD(NORTHSTAR、不在本 slice 立即停寫 PRD)
// - 偏離真實業務的部分:specs 4 hardcoded 欄位(材質「7075-T6」/ 表面處理「Hard Anodized」/
//   重量「320g」/ 產地「義大利」)非 product 動態、各 SKU 應該不同、M-1-16 schema 補

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MockProduct } from '@/data/mock-products';

type TabKey = 'description' | 'specs' | 'install' | 'warranty';

const TAB_DEFS: Array<[TabKey, string]> = [
  ['description', '商品介紹'],
  ['specs', '規格與相容性'],
  ['install', '安裝須知'],
  ['warranty', '保固與退換'],
];

export type ProductTabsProps = { product: MockProduct };

export function ProductTabs({ product }: ProductTabsProps) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('description');

  return (
    <section className="pd-tabs-section">
      <div className="pd-tabs" role="tablist" aria-label="商品詳細資訊">
        {TAB_DEFS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`pd-tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`pd-panel-${k}`}
            tabIndex={tab === k ? 0 : -1}
            className={`pd-tab ${tab === k ? 'is-active' : ''}`}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="pd-tab-body">
        <div
          role="tabpanel"
          id="pd-panel-description"
          aria-labelledby="pd-tab-description"
          hidden={tab !== 'description'}
          className="pd-tab-pane"
        >
          <div className="pd-desc-lead">
            {product.brand} 的 <em>{product.name}</em>,為{' '}
            <strong>{product.fits || '通用車款'}</strong> 專屬開發。
          </div>
          <p>
            採用航太級鋁合金 CNC 一體成型,表面經陽極處理後手工拋光,對應原廠螺絲孔位,
            無需修改車身結構即可完成安裝。重量相較原廠減輕約 38%,在激烈操駕時提供更精準的路感回饋與更卓越的防護性能。
          </p>
          <p>
            每一件出廠前皆經過 3 道品管檢測,包含尺寸精度、表面處理附著力、以及螺紋扭力測試,
            確保長時間使用下仍能保持最佳狀態。
          </p>
          <ul className="pd-desc-features">
            <li>航太級 7075-T6 鋁合金 CNC 精密加工</li>
            <li>Hard Anodized 硬陽極處理,耐腐蝕耐磨</li>
            <li>對應原廠螺絲孔位,Plug &amp; Play</li>
            <li>包含安裝螺絲與扭力建議值說明書</li>
            <li>義大利原廠保固 24 個月</li>
          </ul>
        </div>

        <div
          role="tabpanel"
          id="pd-panel-specs"
          aria-labelledby="pd-tab-specs"
          hidden={tab !== 'specs'}
          className="pd-tab-pane"
        >
          <table className="pd-specs-table">
            <tbody>
              <tr><th>品牌</th><td>{product.brand}</td></tr>
              <tr><th>產品型號</th><td>PCM-{String(product.id).padStart(5, '0')}</td></tr>
              <tr><th>商品分類</th><td>{product.category}</td></tr>
              <tr><th>材質</th><td>航太級鋁合金 7075-T6 / CNC 加工</td></tr>
              <tr><th>表面處理</th><td>Hard Anodized 硬陽極</td></tr>
              <tr><th>重量</th><td>約 320g (單件)</td></tr>
              <tr><th>產地</th><td>義大利</td></tr>
              <tr><th>適用車款</th><td>{product.fits || '通用款'}</td></tr>
            </tbody>
          </table>
        </div>

        <div
          role="tabpanel"
          id="pd-panel-install"
          aria-labelledby="pd-tab-install"
          hidden={tab !== 'install'}
          className="pd-tab-pane"
        >
          <p><strong>安裝難度:</strong>★★☆☆☆(建議專業技師)</p>
          <p><strong>預估工時:</strong>30 – 45 分鐘</p>
          <p><strong>所需工具:</strong>T25 星型扳手、4mm/5mm 內六角扳手、扭力扳手</p>
          <div className="pd-install-steps">
            <div className="pd-install-step"><span>01</span><p>將車輛停放於水平地面,使用車邊架固定。</p></div>
            <div className="pd-install-step"><span>02</span><p>拆除原廠零件,保留原廠螺絲以備後用。</p></div>
            <div className="pd-install-step"><span>03</span><p>將新品對齊孔位裝上,螺絲依序分段鎖緊。</p></div>
            <div className="pd-install-step"><span>04</span><p>使用扭力扳手以 22 N·m 扭力完成最終鎖付。</p></div>
          </div>
          <div className="pd-install-cta">
            <div>
              <div className="pd-install-cta-title">需要專業安裝?</div>
              <div className="pd-install-cta-desc">全台 9 家合作店家,可直接預約安裝</div>
            </div>
            <button
              type="button"
              className="pd-install-btn"
              onClick={() => router.push('/install')}
            >
              預約安裝 →
            </button>
          </div>
        </div>

        <div
          role="tabpanel"
          id="pd-panel-warranty"
          aria-labelledby="pd-tab-warranty"
          hidden={tab !== 'warranty'}
          className="pd-tab-pane"
        >
          <h4>原廠保固</h4>
          <p>
            本商品由 {product.brand} 原廠授權代理,提供 <strong>24 個月</strong> 保固服務。
            保固範圍涵蓋材料與製造瑕疵,不含人為損壞、摔車、碰撞所造成之損傷。
          </p>
          <h4>退換貨政策</h4>
          <p>
            收到商品後 <strong>7 日內</strong>,商品保持全新狀態且包裝完整,可辦理退貨退款。
            若為商品瑕疵,PCM 將負擔來回運費;若為個人因素退貨,退貨運費由買方負擔。
          </p>
          <h4>聯絡我們</h4>
          <p>LINE ID:<strong>@pcm-motorsports</strong> · 客服時間:週一–週六 10:00–20:00</p>
        </div>
      </div>
    </section>
  );
}
