// ProductTabs.tsx — 商品詳細頁 4 分頁(商品介紹 / 規格 / 相容性 / 安裝須知 / 保固與退換)
//
// OD-8(視覺真權威 OD 模板「Website V2」product-detail-rpm-template.html §9 tabs、鐵則 1 直接搬;
//   碳纖維化、修正舊鋁合金殘留 7075-T6 / Hard Anodized / 重量 320g / 義大利保固):
// - tab 字面對齊 OD:商品介紹 / 規格 / 相容性 / 安裝須知 / 保固與退換
//   (規格 tab 由舊「規格與相容性」改 OD 字面「規格 / 相容性」)。
// - 介紹 pane(商品專屬):brand / name / fits 動態 + 碳纖維通用框架。
//   🔴 給審查 / 資料線 workstream:per-廠牌 / per-product 的真實功能描述(如 DCC01「散熱導風」)
//   屬固定內文、待後台 product_description 接線後取代此通用框架(Sean 2026-06-03 Q1 拍板、
//   同 ProductSpotlight 處置);現為碳纖維**通用 placeholder**、非真實 per-product 內容。
// - 規格 pane:品牌 / 型號 / 分類 / 適用車款 吃 product 動態;材質「真碳纖維」、紋路可選、
//   表面可選、特殊樣式 為 RPM 碳纖固定字面;產地「泰國」RPM-only 覆蓋(非 DB 欄、套非 RPM
//   商品會錯、真欄留 product_specs 接線、接線前不可當通用真值)。
//   ⚠️ OD 模板「適用車款」列含「完整見頁面上方對照表」交叉引用、但 storefront Phase A 尚無
//   適用車款表(見 ProductPage L295)、故省略該 dangling 引用、避免字面 vs 事實(OD-11 / Phase B 補表後再加)。
// - 安裝 pane(RPM 共用):OD §9 改 meta 3 欄(因品而異 / 交給專業技師 / 基本機車手工具)+ 1 段說明 +
//   3 點清單(取代舊 4 步驟卡 pd-steps、OD 模板已捨棄分步卡);預約安裝 CTA 沿用 router.push('/install')
//   行為(storefront 既有、OD 模板按鈕無 href)。
// - 保固 pane(RPM 共用):OD §9 客製訂製退換政策 3 段 + 3 點清單。
//   ⚠️ 內容須與 N°04 FAQ「保固與退換貨」一致(OD-10 接續、同一份政策字面)。
//   含《消保法》第 19 條鑑賞期條款屬 L1 法律政策、hardcode 可接受、未來 site_policies 接線。
//
// 'use client' 必要:useState + onClick handler(對齊 ADR-0006 §1「Hooks → 'use client'」)。
// ARIA tablist / tab / tabpanel + roving tabIndex + 鍵盤導覽(↑M-1-13H-6 Codex Fix 1 沿用不動)。
//
// 標點:半形逗號「,」/ 冒號「:」/ 問號「?」對齊 storefront 商品頁元件家族慣例
//   (ProductSpotlight / ProductHighlights、OD-6 / 7a 既定);頓號「、」句號「。」括號「（）」依 OD 模板。

'use client';

import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { MockProduct } from '@/data/mock-products';

type TabKey = 'description' | 'specs' | 'install' | 'warranty';

const TAB_DEFS: Array<[TabKey, string]> = [
  ['description', '商品介紹'],
  ['specs', '規格 / 相容性'],
  ['install', '安裝須知'],
  ['warranty', '保固與退換'],
];

export type ProductTabsProps = { product: MockProduct };

export function ProductTabs({ product }: ProductTabsProps) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('description');

  // M-1-13H-6 Codex Fix 1:roving tabIndex + 鍵盤導覽(W3C WAI-ARIA Authoring Practices Tabs)。
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
        {/* 商品介紹(商品專屬):brand / name / fits 動態 + 碳纖維通用框架。
            🔴 資料線 workstream:per-廠牌 / per-product 真實功能描述(如散熱導風)屬固定內文、
            待後台 product_description 接線後取代此通用框架(Sean 2026-06-03 Q1、同 ProductSpotlight)。 */}
        <div
          role="tabpanel"
          id="pd-panel-description"
          aria-labelledby="pd-tab-description"
          hidden={tab !== 'description'}
          className="pd-tab-pane"
        >
          <p className="pd-body">
            <strong>
              {product.brand} {product.name}
            </strong>{' '}
            採用真碳纖維材質,為 <strong>{product.fits || '原廠車款'}</strong>{' '}
            開發;換上碳纖維後比原廠塑件更輕、更有質感,強度也更高。
          </p>
          <p className="pd-body">
            對應原廠孔位、可直接安裝,<strong>不需要改線組</strong>。下單時請依愛車狀況選好紋路、表面與是否要加強化款 12K。
          </p>
          <ul className="pd-list">
            <li>真碳纖維材質,非塑膠仿碳貼皮</li>
            <li>對應原廠孔位,Plug &amp; Play</li>
            <li>四款紋路 × 兩款表面,蜂巢另收特殊紋費</li>
            <li>賣場數量不代表庫存,下單前建議先 LINE 聊聊確認</li>
          </ul>
        </div>

        {/* 規格 / 相容性:品牌 / 型號 / 分類 / 適用車款 動態;材質·紋路·表面·特殊樣式 RPM 碳纖固定;
            產地「泰國」RPM-only 覆蓋(非 DB 欄)。OD 模板「適用車款」列「完整見頁面上方對照表」交叉引用
            已省略(storefront Phase A 無適用車款表、ProductPage L295)。 */}
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
              {/* M-1-16c-4b:顯真主碼 productCode(如 RPM-DCC01、← DB external_id);無主碼 fallback slug */}
              <div className="pd-spec-v">{product.productCode ?? product.slug}</div>
            </div>
            <div className="pd-spec-row">
              <div className="pd-spec-k">商品分類</div>
              <div className="pd-spec-v">{product.category}</div>
            </div>
            <div className="pd-spec-row">
              <div className="pd-spec-k">材質</div>
              <div className="pd-spec-v">真碳纖維（Carbon Fiber）</div>
            </div>
            <div className="pd-spec-row">
              <div className="pd-spec-k">紋路可選</div>
              <div className="pd-spec-v">斜紋 / 平織 / 鍛造 / 蜂巢 / 12K — 五款紋路（12K 為加強紋路樣式,部分品項提供）</div>
            </div>
            <div className="pd-spec-row">
              <div className="pd-spec-k">表面可選</div>
              <div className="pd-spec-v">亮光 / 消光（蜂巢只有亮光,消光蜂巢為特別訂製）</div>
            </div>
            <div className="pd-spec-row">
              <div className="pd-spec-k">產地</div>
              {/* RPM-only 覆蓋:RPM 來自泰國(蝦皮內文證);非 DB 欄、套非 RPM 商品會錯、留 product_specs 接線 */}
              <div className="pd-spec-v">泰國</div>
            </div>
            <div className="pd-spec-row">
              <div className="pd-spec-k">適用車款</div>
              <div className="pd-spec-v">{product.fits || '通用款'}</div>
            </div>
            <div className="pd-spec-row">
              <div className="pd-spec-k">特殊樣式</div>
              <div className="pd-spec-v">彩色碳纖、消光蜂巢等 — 訂購約 1–4 個月</div>
            </div>
          </div>
        </div>

        {/* 安裝須知(RPM 共用):meta 3 欄 + 1 段說明 + 3 點清單(OD §9 捨棄 4 步驟卡 pd-steps);
            預約安裝 CTA router.push('/install') 行為沿用(storefront 既有、OD 模板按鈕無 href)。 */}
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
              <strong>因品而異</strong>
            </div>
            <div>
              <span>建議</span>
              <strong>交給專業技師</strong>
            </div>
            <div>
              <span>工具</span>
              <strong>基本機車手工具</strong>
            </div>
          </div>
          <p className="pd-body">
            每件碳纖部品的安裝方式略有不同,原則上都是 <strong>對應原廠孔位、直接鎖上</strong>,不需要改裝線組。建議由有經驗的技師安裝,鎖緊力道要適中,避免過度鎖付造成碳纖斷裂。如果不確定,可以預約 PCM 合作店家協助處理。
          </p>
          <ul className="pd-list">
            <li>裝前先把原廠零件螺絲位置記清楚或拍照</li>
            <li>鎖螺絲時對角分段鎖緊,避免單點受力</li>
            <li>第一次騎乘後再檢查一次螺絲扭力</li>
          </ul>
          <div className="pd-install-cta">
            <div>
              <div className="pd-install-cta-title">不想自己裝?</div>
              <div className="pd-install-cta-desc">全台合作店家可以幫你直接搞定</div>
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

        {/* 保固與退換(RPM 共用):客製訂製退換政策 + 鑑賞期條款。
            ⚠️ 內容須與 N°04 FAQ「保固與退換貨」一致(OD-10 接續、同一份政策字面)。
            《消保法》第 19 條鑑賞期條款屬 L1 法律政策、hardcode 可接受、未來 site_policies 接線。 */}
        <div
          role="tabpanel"
          id="pd-panel-warranty"
          aria-labelledby="pd-tab-warranty"
          hidden={tab !== 'warranty'}
          className="pd-tab-pane"
        >
          <p className="pd-body">
            多數商品是 <strong>接單後才向原廠訂製的客製商品</strong>,訂單成立後沒辦法取消或改單,麻煩下單前先確認好車款與款式。
          </p>
          <p className="pd-body">
            收到商品請先檢查,如果有 <strong>瑕疵</strong>、或是我們出錯（寄錯、出錯件）,請在 <strong>收貨 7 天內</strong> 用 LINE 告訴我們,我們會負責換貨處理。退換貨時商品需維持 <strong>全新未安裝、原始包裝完整</strong>（含外盒、發票、配件）;一旦安裝過或有使用痕跡,就沒辦法退換了。
          </p>
          <p className="pd-body">
            關於鑑賞期:本賣場屬於 <strong>客製化委任代購</strong>,依《消費者保護法》第 19 條第 1 項,這類客製、代訂商品 <strong>不適用 7 天鑑賞期</strong>。鑑賞期是讓你確認商品符不符合需求,不是商品的試用期——這點先跟你說明,下單前確認好就沒問題。
          </p>
          <ul className="pd-list">
            <li>瑕疵認定:紋路明顯錯位、表面破損、孔位偏差超過合理範圍</li>
            <li>不在範圍:人為碰撞、摔車、不當安裝、自行加工</li>
            <li>
              有問題請走 LINE:<strong>@pcm-motorsports</strong> · 週一–週六 10:00–20:00
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
