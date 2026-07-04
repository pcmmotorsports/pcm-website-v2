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
//   OD-12:適用車款表(ProductFitments)上線 → 恢復 OD 模板「完整見頁面上方對照表」交叉引用,
//   僅在 product.fitments 有資料(表會渲染)時顯、避免指向不存在區塊(dangling)。
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
// 標點:渲染文案用全形(逗號「，」/ 冒號「：」/ 問號「？」/ 分號「；」+ 頓號「、」句號「。」括號「（）」);
//   時間「10:00」/ 數字範圍「2–6」/ 英文 / 程式碼維持半形。Sean 2026-06-10 Q2=B 拍板:商品詳情頁散文家族
//   全改全形、反轉原 OD-6 / 7a「半形逗號家族慣例」(業務 override、鐵則 1 例外)。

'use client';

import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { RPM_CARBON_BRAND_SLUG, type MockProduct, type UIVariant } from '@/data/mock-products';
import {
  RPM_WARRANTY_PARAGRAPHS,
  RPM_WARRANTY_NOTES,
  type PolicyRun,
} from '@/data/rpm-policies';

// 🔴 P0-C-b2 去碳:非 RPM 品牌規格表改「資料驅動」—— 讀 variant spec 實際 key、配 label map 渲染、
//   空值/純空白值該列不計入(bonamici {color,material} 顯真值、無值不渲染)。🔴 前提:v.spec 必為物件
//   (型別 UIVariant.spec=Record<string,string>、adapter mapVariantRow 保證;#264 已治本 2026-07-04:
//   來源 spec=NULL 由 adapter `?? {}` 降級為空物件、不再 throw 500,本函式收到的恆為物件)。
//   RPM 維持原碳纖規格列(isRpmCarbon 守門、byte 不變);此路徑僅非 RPM 走。未知 key fallback 原 key 字面(不亂猜中文)。
const SPEC_LABEL: Record<string, string> = {
  color: '顏色',
  material: '材質',
  weave: '紋路',
  finish: '表面',
  special: '特殊樣式',
  size: '尺寸',
};

/** 由變體 spec 建規格列:每個 distinct key 一列、值去重以 ' / ' 併;空值不計入(key 全空 → 不出列=無值不渲染)。 */
function buildSpecRows(
  variants: UIVariant[],
): Array<{ key: string; label: string; values: string }> {
  const byKey = new Map<string, string[]>();
  const order: string[] = [];
  for (const v of variants) {
    for (const [k, val] of Object.entries(v.spec)) {
      if (typeof val !== 'string' || !val.trim()) continue; // 非字串/空/純空白值不成列(防髒 jsonb、無值不渲染)
      if (!byKey.has(k)) {
        byKey.set(k, []);
        order.push(k);
      }
      const arr = byKey.get(k)!;
      if (!arr.includes(val)) arr.push(val);
    }
  }
  return order.map((k) => ({ key: k, label: SPEC_LABEL[k] ?? k, values: byKey.get(k)!.join(' / ') }));
}

// 政策 runs → JSX(string→文字、{ b }→<strong>);保固 pane 與 ProductFAQ 共用渲染模式。
function renderPolicyRuns(runs: PolicyRun[]) {
  return runs.map((run, i) =>
    typeof run === 'string' ? <span key={i}>{run}</span> : <strong key={i}>{run.b}</strong>,
  );
}

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

  // 🔴 P0-C-b2 去碳:RPM 才顯碳纖介紹/規格列(byte 不變);非 RPM 介紹留最小事實、規格表資料驅動。
  //   守門用 brandSlug(≠ product.brand 顯示名);F1 陷阱同 P0-C-a。安裝分頁為全品牌通用去碳(不守門、Sean Q2=A)。
  const isRpmCarbon = product.brandSlug === RPM_CARBON_BRAND_SLUG;
  const specRows = isRpmCarbon ? [] : buildSpecRows(product.variants ?? []);

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
        {/* 商品介紹:RPM 顯碳纖框架(byte 不變)、非 RPM 去碳留最小事實(P0-C-b2、isRpmCarbon 守門);真描述待 Phase 1 接 product.description。
            🔴 資料線 workstream:per-廠牌 / per-product 真實功能描述(如散熱導風)屬固定內文、
            待後台 product_description 接線後取代此通用框架(Sean 2026-06-03 Q1、同 ProductSpotlight)。 */}
        <div
          role="tabpanel"
          id="pd-panel-description"
          aria-labelledby="pd-tab-description"
          hidden={tab !== 'description'}
          className="pd-tab-pane"
        >
          {isRpmCarbon ? (
            <>
              <p className="pd-body">
                <strong>
                  {product.brand} {product.name}
                </strong>
                採用真碳纖維材質，為 <strong>{product.fits || '原廠車款'}</strong>{' '}
                開發；換上碳纖維後比原廠塑件更輕、更有質感，強度也更高。
              </p>
              <p className="pd-body">
                對應原廠孔位、可直接安裝，<strong>不需要改線組</strong>。下單時請依愛車狀況選好紋路、表面與是否要加強化款 12K。
              </p>
              <ul className="pd-list">
                <li>真碳纖維材質，非塑膠仿碳貼皮</li>
                <li>對應原廠孔位，Plug &amp; Play</li>
                <li>四款紋路 × 兩款表面，蜂巢另收特殊紋費</li>
                <li>賣場數量不代表庫存，下單前建議先 LINE 聊聊確認</li>
              </ul>
            </>
          ) : (
            // 非 RPM 去碳:留最小事實(品牌+品名+適用車款)+ 通用 LINE 提醒;真實描述待 Phase 1 接 product.description(§2.9)。
            <>
              <p className="pd-body">
                <strong>
                  {product.brand} {product.name}
                </strong>
                {product.fits && product.fits !== '通用款' ? ` · 適用 ${product.fits}` : ''}
              </p>
              <ul className="pd-list">
                <li>賣場數量不代表庫存，下單前建議先 LINE 聊聊確認</li>
              </ul>
            </>
          )}
        </div>

        {/* 規格 / 相容性:品牌 / 型號 / 分類 / 適用車款 動態(全品牌);材質·紋路·表面·產地·特殊樣式 = RPM 碳纖列 isRpmCarbon 守門(byte 不變)、非 RPM 改資料驅動 buildSpecRows(P0-C-b2);
            產地「泰國」RPM-only 覆蓋(非 DB 欄)。OD-12:「適用車款」列恢復「完整見頁面上方對照表」
            交叉引用(條件:有 fitments 表才顯)。 */}
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
            {isRpmCarbon && (
              <>
                <div className="pd-spec-row">
                  <div className="pd-spec-k">材質</div>
                  <div className="pd-spec-v">真碳纖維（Carbon Fiber）</div>
                </div>
                <div className="pd-spec-row">
                  <div className="pd-spec-k">紋路可選</div>
                  <div className="pd-spec-v">斜紋 / 平織 / 鍛造 / 蜂巢 / 12K — 五款紋路（12K 為加強紋路樣式，部分品項提供）</div>
                </div>
                <div className="pd-spec-row">
                  <div className="pd-spec-k">表面可選</div>
                  <div className="pd-spec-v">亮光 / 消光（蜂巢只有亮光，消光蜂巢為特別訂製）</div>
                </div>
                <div className="pd-spec-row">
                  <div className="pd-spec-k">產地</div>
                  {/* RPM-only 覆蓋:RPM 來自泰國(蝦皮內文證);非 DB 欄、套非 RPM 商品會錯、留 product_specs 接線 */}
                  <div className="pd-spec-v">泰國</div>
                </div>
              </>
            )}
            {/* 🔴 P0-C-b2 去碳:非 RPM 品牌規格列資料驅動(讀 variant spec 實際 key + label map、無值不渲染) */}
            {!isRpmCarbon &&
              specRows.map((row) => (
                <div className="pd-spec-row" key={row.key}>
                  <div className="pd-spec-k">{row.label}</div>
                  <div className="pd-spec-v">{row.values}</div>
                </div>
              ))}
            <div className="pd-spec-row">
              <div className="pd-spec-k">適用車款</div>
              {/* OD-12:適用車款表上線 → 恢復 OD 模板交叉引用(僅有表時顯、避免指向不存在區塊 dangling)。
                  摘要列字串走 product.fits(第一筆衍生);完整表為 ProductFitments(product.fitments 條件渲染)。 */}
              <div className="pd-spec-v">
                {product.fits || '通用款'}
                {product.fitments && product.fitments.length > 0 && (
                  <>
                    <br />
                    <span className="pd-spec-xref">完整適用車款請見頁面上方「適用車款」對照表</span>
                  </>
                )}
              </div>
            </div>
            {isRpmCarbon && (
              <div className="pd-spec-row">
                <div className="pd-spec-k">特殊樣式</div>
                <div className="pd-spec-v">彩色碳纖、消光蜂巢等 — 訂購約 1–4 個月</div>
              </div>
            )}
          </div>
        </div>

        {/* 安裝須知(全品牌通用、P0-C-b2 去碳:碳纖部品→部品 / 碳纖斷裂→部品受損、Sean Q2=A):meta 3 欄 + 1 段說明 + 3 點清單(OD §9 捨棄 4 步驟卡 pd-steps);
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
            每件部品的安裝方式略有不同，原則上都是<strong>對應原廠孔位、直接鎖上</strong>，不需要改裝線組。建議由有經驗的技師安裝，鎖緊力道要適中，避免過度鎖付造成部品受損。如果不確定，可以預約 PCM 合作店家協助處理。
          </p>
          <ul className="pd-list">
            <li>裝前先把原廠零件螺絲位置記清楚或拍照</li>
            <li>鎖螺絲時對角分段鎖緊，避免單點受力</li>
            <li>第一次騎乘後再檢查一次螺絲扭力</li>
          </ul>
          <div className="pd-install-cta">
            <div>
              <div className="pd-install-cta-title">不想自己裝？</div>
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

        {/* 保固與退換(全品牌通用單一真相 rpm-policies、P0-C-b1):客製訂製退換政策 + 鑑賞期條款。
            ⚠️ 政策字面來自共用 @/data/rpm-policies(單一真相、與 N°04 FAQ ProductFAQ 共用、不分歧);
            含《消保法》第 19 條鑑賞期(L1 法律政策、Sean 仍在確認準確性、改字面只動 rpm-policies)。 */}
        <div
          role="tabpanel"
          id="pd-panel-warranty"
          aria-labelledby="pd-tab-warranty"
          hidden={tab !== 'warranty'}
          className="pd-tab-pane"
        >
          {RPM_WARRANTY_PARAGRAPHS.map((para, i) => (
            <p className="pd-body" key={i}>
              {renderPolicyRuns(para)}
            </p>
          ))}
          <ul className="pd-list">
            {RPM_WARRANTY_NOTES.map((note, i) => (
              <li key={i}>{renderPolicyRuns(note)}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
