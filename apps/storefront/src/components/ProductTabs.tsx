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

import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
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

  // M-1-13H-6 Codex Fix 1:roving tabIndex + 鍵盤導覽(對齊 W3C WAI-ARIA Authoring Practices Tabs)。
  // 原 13f-2 只有 roving tabIndex 無 onKeyDown、鍵盤使用者 Tab 只能進 active tab、其他 3 個無法切換
  // (Codex Review must-fix、Sean 2026-05-22 Q1=B 完整版拍板)。
  // tabRefs 對應 4 個 tab button(按 TAB_DEFS 順序)、handler 切 state + 移 focus。
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    const count = TAB_DEFS.length;
    let newIdx: number | null = null;
    if (e.key === 'ArrowRight') newIdx = (idx + 1) % count;
    else if (e.key === 'ArrowLeft') newIdx = (idx - 1 + count) % count;
    else if (e.key === 'Home') newIdx = 0;
    else if (e.key === 'End') newIdx = count - 1;
    if (newIdx === null) return;
    e.preventDefault();
    const next = TAB_DEFS[newIdx];
    if (!next) return;
    setTab(next[0]);
    tabRefs.current[newIdx]?.focus();
  };

  return (
    <section className="pd-tabs-section">
      <div className="pd-tabs" role="tablist" aria-label="商品詳細資訊">
        {TAB_DEFS.map(([k, l], i) => (
          <button
            key={k}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`pd-tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`pd-panel-${k}`}
            tabIndex={tab === k ? 0 : -1}
            className={`pd-tab ${tab === k ? 'is-active' : ''}`}
            onClick={() => setTab(k)}
            onKeyDown={(e) => handleTabKeyDown(e, i)}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="pd-tab-body">
        {/* M-1-13H-5:description pane 改 design 結構(1 lead .pd-body + 5 items .pd-list、
            對應 design VariantCFull L165-173 + HANDOFF #15);移除 13f-2 既有 22px serif .pd-desc-lead +
            2 段 paragraph 結構、簡化成 single lead + features list;字面保留 brand+name+fits 動態 +
            5 items list 既有 hardcoded(對齊鐵則 9 L3 對沖、Phase 2 接 supabase product_highlights) */}
        <div
          role="tabpanel"
          id="pd-panel-description"
          aria-labelledby="pd-tab-description"
          hidden={tab !== 'description'}
          className="pd-tab-pane"
        >
          <p className="pd-body">
            {product.brand} {product.name} 為 {product.fits || '通用車款'}{' '}
            專屬開發,提供更精準的腳感回饋、更佳的路感傳遞,以及更卓越的耐用性。
          </p>
          <ul className="pd-list">
            <li>航太級 7075-T6 鋁合金 CNC 精密加工</li>
            <li>Hard Anodized 硬陽極處理,耐腐蝕耐磨</li>
            <li>對應原廠螺絲孔位,Plug &amp; Play</li>
            <li>包含安裝螺絲與扭力建議值說明書</li>
            <li>義大利原廠保固 24 個月</li>
          </ul>
        </div>

        {/* M-1-13H-5:specs pane 從 table 結構 → 2 欄 grid div(對應 design .vcf-specs L177-184 +
            HANDOFF #15);8 欄 hardcoded 保留(13f-2 既有、屬鐵則 9 L3 對沖、Phase 2 接 supabase
            product_specs 表);字面 brand/id/category 動態 + 4 hardcoded(材質/表面處理/重量/產地)
            對齊 design L178 字面、套用到其他品牌字面誤導屬 L3 對沖 */}
        <div
          role="tabpanel"
          id="pd-panel-specs"
          aria-labelledby="pd-tab-specs"
          hidden={tab !== 'specs'}
          className="pd-tab-pane"
        >
          <div className="pd-specs">
            <div className="pd-spec-row">
              <div className="pd-spec-k">品牌</div>
              <div className="pd-spec-v">{product.brand}</div>
            </div>
            <div className="pd-spec-row">
              <div className="pd-spec-k">產品型號</div>
              <div className="pd-spec-v">PCM-{String(product.id).padStart(5, '0')}</div>
            </div>
            <div className="pd-spec-row">
              <div className="pd-spec-k">商品分類</div>
              <div className="pd-spec-v">{product.category}</div>
            </div>
            <div className="pd-spec-row">
              <div className="pd-spec-k">材質</div>
              <div className="pd-spec-v">7075-T6 鋁合金 / CNC</div>
            </div>
            <div className="pd-spec-row">
              <div className="pd-spec-k">表面處理</div>
              <div className="pd-spec-v">Hard Anodized 硬陽極</div>
            </div>
            <div className="pd-spec-row">
              <div className="pd-spec-k">重量</div>
              <div className="pd-spec-v">約 320g (單件)</div>
            </div>
            <div className="pd-spec-row">
              <div className="pd-spec-k">產地</div>
              <div className="pd-spec-v">義大利</div>
            </div>
            <div className="pd-spec-row">
              <div className="pd-spec-k">適用車款</div>
              <div className="pd-spec-v">{product.fits || '通用款'}</div>
            </div>
          </div>
        </div>

        {/* M-1-13H-5:install pane 改 meta 3 欄淺灰卡 + 4 步驟卡片(對應 design L186-202 + HANDOFF #15);
            原 3 段 paragraph + 4 row grid → meta div + steps grid 4 cols;install-cta 保留 13f-2 既有
            (design 無對應字面、storefront 延伸)、CSS 改黑底白字圓角卡(HANDOFF L295) */}
        <div
          role="tabpanel"
          id="pd-panel-install"
          aria-labelledby="pd-tab-install"
          hidden={tab !== 'install'}
          className="pd-tab-pane"
        >
          <div className="pd-install-meta">
            <div>
              <span>難度</span>
              <strong>★★☆☆☆ 建議專業技師</strong>
            </div>
            <div>
              <span>工時</span>
              <strong>30 – 45 分鐘</strong>
            </div>
            <div>
              <span>工具</span>
              <strong>T25、4mm/5mm 內六角、扭力扳手</strong>
            </div>
          </div>
          <div className="pd-steps">
            <div className="pd-step">
              <div className="pd-step-n">01</div>
              <p>將車輛停放於水平地面,使用車邊架固定。</p>
            </div>
            <div className="pd-step">
              <div className="pd-step-n">02</div>
              <p>拆除原廠零件,保留原廠螺絲以備後用。</p>
            </div>
            <div className="pd-step">
              <div className="pd-step-n">03</div>
              <p>將新品對齊孔位裝上,螺絲依序分段鎖緊。</p>
            </div>
            <div className="pd-step">
              <div className="pd-step-n">04</div>
              <p>使用扭力扳手以 22 N·m 完成最終鎖付。</p>
            </div>
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

        {/* M-1-13H-5:warranty pane 改 3 段 .pd-body 結構(對應 design L203-209、HANDOFF #15);
            原 h4 + p 雙層結構 → 純 3 paragraph、em 改 strong 600 加粗(對齊 design `.vcf-body strong`);
            字面 brand 動態 + 政策內容對齊 13f-2 既有、L3 hardcoded 對沖 Phase 2 接 supabase 政策表 */}
        <div
          role="tabpanel"
          id="pd-panel-warranty"
          aria-labelledby="pd-tab-warranty"
          hidden={tab !== 'warranty'}
          className="pd-tab-pane"
        >
          <p className="pd-body">
            本商品由 {product.brand} 原廠授權代理,提供 <strong>24 個月</strong>{' '}
            保固服務,涵蓋材料與製造瑕疵;不含人為損壞、摔車、碰撞之損傷。
          </p>
          <p className="pd-body">
            收到商品後 <strong>7 日內</strong>{' '}
            保持全新狀態與包裝完整,可辦理退換貨。瑕疵品由 PCM 負擔來回運費;
            若為個人因素退貨,退貨運費由買方負擔。
          </p>
          <p className="pd-body">
            LINE 客服:<strong>@pcm-motorsports</strong> · 週一–週六 10:00–20:00
          </p>
        </div>
      </div>
    </section>
  );
}
