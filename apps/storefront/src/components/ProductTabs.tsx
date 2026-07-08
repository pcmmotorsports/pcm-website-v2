// ProductTabs.tsx — 商品詳細頁 4 段資訊(商品介紹 / 規格 · 相容性 / 安裝須知 / 保固與退換)
//
// 🔴 S2 / #270 B(Sean 2026-07-08 拍 A、supersede OD §9 分頁):由「橫向 tabs + hidden pane」改
//   **長頁全展開 + sticky 跳轉列(TOC)**——四段內容全常駐可見、不再靠 hidden 切換。
//   動機:①SEO/GEO——四段內容原本就全在 DOM(hidden 非條件渲染),但分頁隱藏內容權重略低;長頁
//     全展開讓規格/相容/安裝/保固都是可見 h2 landmark、搜尋更抓得到。②快速看相容——客人不必點分頁
//     即見規格/相容摘要(完整車型表仍在頁面上方 ProductFitments)。③Baymard 實測:橫向 tabs 27% 漏看
//     內容 → 改長頁 + 錨點 TOC(漏看 7%)。全品牌一致(含 RPM;RPM 內容 byte 不變、只是不再被分頁藏)。
// - 跳轉列 = <nav> + 錨點 <a href="#pd-sec-*">;每段 = 語意 <section id="pd-sec-*"
//   aria-labelledby="pd-sec-*-title"> + 可見 <h2 id="pd-sec-*-title">(取代舊 role=tab/tabpanel;
//   移除 tab 鈕後舊 aria-labelledby="pd-tab-*" 會 dangling,故改指向真實 heading)。
//
// 內容邏輯(以下全不變、只換外層容器):
// OD-8(視覺真權威 OD 模板「Website V2」product-detail-rpm-template.html §9、鐵則 1 直接搬;碳纖維化):
// - 介紹 pane(商品專屬):brand / name / fits 動態 + 碳纖維通用框架(RPM);非 RPM 渲染真 description。
//   🔴 per-廠牌 / per-product 真實功能描述待後台 product_description 接線(Sean 2026-06-03 Q1)。
// - 規格 pane:品牌 / 型號 / 分類 / 適用車款 吃 product 動態;材質·紋路·表面·產地·特殊樣式 = RPM 碳纖列
//   isRpmCarbon 守門(byte 不變)、非 RPM 改資料驅動 buildSpecRows(P0-C-b2);產地「泰國」RPM-only 覆蓋。
//   OD-12:「適用車款」列交叉引用上方 ProductFitments 表(僅有 fitments 時顯、避 dangling)。
// - 安裝 pane(全品牌通用去碳、Sean Q2=A):meta 3 欄 + 1 段說明 + 3 點清單;預約安裝 CTA 沿用
//   router.push('/install')(storefront 既有、OD 模板按鈕無 href)。
// - 保固 pane(全品牌通用單一真相 rpm-policies、P0-C-b1):與 N°04 FAQ 共用政策字面、含《消保法》§19。
//
// 'use client' 必要:安裝 CTA onClick → router.push('/install')(對齊 ADR-0006 §1「Hooks/事件 → 'use client'」)。
//   S2 已移除 tab useState/useRef/鍵盤導覽(長頁不需),client 邊界僅為 CTA 保留。
//
// 標點:渲染文案用全形(逗號「，」/ 冒號「：」/ 問號「？」/ 分號「；」+ 頓號「、」句號「。」括號「（）」);
//   時間「10:00」/ 數字範圍「2–6」/ 英文 / 程式碼維持半形。Sean 2026-06-10 Q2=B(業務 override、鐵則 1 例外)。

'use client';

import { useRouter } from 'next/navigation';
import { RPM_CARBON_BRAND_SLUG, type MockProduct, type UIVariant } from '@/data/mock-products';
import { InstallResources } from './InstallResources';
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

type SectionKey = 'description' | 'specs' | 'install' | 'warranty';

// 四段字面對齊 OD §9(規格 tab 由舊「規格與相容性」改 OD 字面「規格 / 相容性」);跳轉列與 heading 共用。
const SECTION_DEFS: Array<[SectionKey, string]> = [
  ['description', '商品介紹'],
  ['specs', '規格 / 相容性'],
  ['install', '安裝須知'],
  ['warranty', '保固與退換'],
];

export type ProductTabsProps = { product: MockProduct };

export function ProductTabs({ product }: ProductTabsProps) {
  const router = useRouter();

  // 🔴 P0-C-b2 去碳:RPM 才顯碳纖介紹/規格列(byte 不變);非 RPM 介紹留最小事實、規格表資料驅動。
  //   守門用 brandSlug(≠ product.brand 顯示名);F1 陷阱同 P0-C-a。安裝分頁為全品牌通用去碳(不守門、Sean Q2=A)。
  const isRpmCarbon = product.brandSlug === RPM_CARBON_BRAND_SLUG;
  const specRows = isRpmCarbon ? [] : buildSpecRows(product.variants ?? []);

  return (
    <section className="pd-spec-section">
      {/* 跳轉列(長頁 TOC、sticky):取代舊分頁鈕列;錨點 href 指向下方各 section id、便於長頁間快速跳。 */}
      <nav className="pd-jump" aria-label="商品資訊快速跳轉">
        {SECTION_DEFS.map(([k, l]) => (
          <a key={k} className="pd-jump-link" href={`#pd-sec-${k}`}>
            {l}
          </a>
        ))}
      </nav>

      <div className="pd-spec-body">
        {/* 商品介紹:RPM 顯碳纖框架(byte 不變、isRpmCarbon 守門、Sean Q1 拍板硬寫死);
            非 RPM(2026-07-05 起)渲染 product.description 真內文(有值才顯示、空走通用框架)。
            🔴 RPM 的 product.description 是舊英文 HTML、刻意不渲染(syncDescription=false、維持碳纖框架)。 */}
        <section id="pd-sec-description" className="pd-sec" aria-labelledby="pd-sec-description-title">
          <h2 id="pd-sec-description-title" className="pd-sec-title">商品介紹</h2>
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
            // 非 RPM(gbracing/bonamici…):有真描述(product.description、來源繁中內文)→ 逐段渲染;
            //   無描述 → 留最小事實框架(品牌+品名+適用車款)。皆附通用 LINE 提醒。
            //   🔴 純文字渲染(React 預設 escape)、不用 dangerouslySetInnerHTML:來源為純文字內文、防 XSS。
            <>
              {product.description?.trim() // 空白-only 視為無描述(走通用框架、不留空段)
                ? product.description
                    .replace(/\r\n/g, '\n') // CRLF 正規化、確保 \n\n 斷段穩定
                    .split(/\n{2,}/)
                    .map((para) => para.trim())
                    .filter(Boolean)
                    .map((para, i) => (
                      <p key={i} className="pd-body">
                        {para}
                      </p>
                    ))
                : (
                  <p className="pd-body">
                    <strong>
                      {product.brand} {product.name}
                    </strong>
                    {product.fits && product.fits !== '通用款' ? ` · 適用 ${product.fits}` : ''}
                  </p>
                )}
              {/* A/#270 賣點條列:Sean 2026-07-08 肉眼驗改用 pd-list 圓點(對齊 RPM 分支、免破折號賣點與末條 LINE 提醒圓點混排突兀);併入同一圓點清單、空 highlights 只顯 LINE 提醒 */}
              <ul className="pd-list">
                {product.highlights?.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
                <li>賣場數量不代表庫存，下單前建議先 LINE 聊聊確認</li>
              </ul>
            </>
          )}
        </section>

        {/* 規格 / 相容性:品牌 / 型號 / 分類 / 適用車款 動態(全品牌);材質·紋路·表面·產地·特殊樣式 = RPM 碳纖列 isRpmCarbon 守門(byte 不變)、非 RPM 改資料驅動 buildSpecRows(P0-C-b2);
            產地「泰國」RPM-only 覆蓋(非 DB 欄)。OD-12:「適用車款」列恢復「完整見頁面上方對照表」
            交叉引用(條件:有 fitments 表才顯)。 */}
        <section id="pd-sec-specs" className="pd-sec" aria-labelledby="pd-sec-specs-title">
          <h2 id="pd-sec-specs-title" className="pd-sec-title">規格 / 相容性</h2>
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
        </section>

        {/* 安裝須知(全品牌通用、P0-C-b2 去碳:碳纖部品→部品 / 碳纖斷裂→部品受損、Sean Q2=A):meta 3 欄 + 1 段說明 + 3 點清單(OD §9 捨棄 4 步驟卡 pd-steps);
            預約安裝 CTA router.push('/install') 行為沿用(storefront 既有、OD 模板按鈕無 href)。 */}
        <section id="pd-sec-install" className="pd-sec" aria-labelledby="pd-sec-install-title">
          <h2 id="pd-sec-install-title" className="pd-sec-title">安裝須知</h2>
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
          {/* 安裝資源:說明書 PDF + 安裝影片(#270、Sean 2026-07-08);optional、無資料整區不顯 */}
          <InstallResources manuals={product.manuals} videoUrl={product.videoUrl} />
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
        </section>

        {/* 保固與退換(全品牌通用單一真相 rpm-policies、P0-C-b1):客製訂製退換政策 + 鑑賞期條款。
            ⚠️ 政策字面來自共用 @/data/rpm-policies(單一真相、與 N°04 FAQ ProductFAQ 共用、不分歧);
            含《消保法》第 19 條鑑賞期(L1 法律政策、Sean 仍在確認準確性、改字面只動 rpm-policies)。 */}
        <section id="pd-sec-warranty" className="pd-sec" aria-labelledby="pd-sec-warranty-title">
          <h2 id="pd-sec-warranty-title" className="pd-sec-title">保固與退換</h2>
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
        </section>
      </div>
    </section>
  );
}
