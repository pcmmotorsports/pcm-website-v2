// ProductTabs.tsx — 商品詳細頁 4 段資訊(商品介紹 / 規格 · 相容性 / 安裝須知 / 保固與退換)
//
// 🔴 #270 中段 B 收合改良(Sean 2026-07-09 肉眼驗 demo 拍板「B 收合」+ 「文字往右延伸填滿、整個面板重排、
//    重點紅色點綴、影片大 PDF 小」):由「長頁全展開 + sticky 跳轉列」改 **收合手風琴 <details>**。
//    - 每段 = <details class="pd-sec">(商品介紹預設 open;其餘收合、點標題展開)。收合時標題右側 hint chip
//      提示裡面有什麼(「重點 4 項」「9 項規格」「影片 · 說明書 · 步驟」…)。
//    - 展開後版面依內容型態分排(Sean 2026-07-10 看四版比較拍 V1「整合式左條」,取代改法 A 右側面板 —
//      因文字型段內容稀疏時「主文左 / 面板右」兩塊對望突兀、加框沒加分):
//    - 文字型段(商品介紹/保固)= 單欄流 pd-sec-flow + 左條 callout;商品介紹重點 → 紅色左條(pd-callout-hl、
//      方形紅點),保固退換要點 → 中性金色左條;規格 → 桌機兩欄(pd-specs-2col);安裝 → 主文左 + 資源側欄右
//      (sec-split-media、影片大 PDF 小 chip);手機一律單欄堆疊。
//    動機:①減少滑動(Sean 反映「不要滑這麼長」)②填滿右側留白 ③重點視覺層次(紅)④全品牌一致。
//    SEO/GEO 保留:內容全在 DOM(<details> 收合僅視覺、爬蟲仍讀得到)、h2 標題常駐可見 landmark、
//    商品介紹預設展開。取代原 S2 長頁 + 跳轉列(Baymard tabs 漏看已由「收合但標題+hint 常駐」緩解)。
//
// 內容邏輯(全不變、只換外層容器與分欄;RPM 內容 byte 不變):
// - 介紹(商品專屬):碳纖通用框架(RPM、byte 不變)/ 非 RPM 渲染真 description;重點清單移入紅色左條 callout。
//   🔴 per-廠牌 / per-product 真實功能描述待後台 product_description 接線(Sean 2026-06-03 Q1)。
// - 規格:品牌 / 型號 / 分類 / 適用車款 動態;材質·紋路·表面·產地·特殊樣式 = RPM 碳纖列 isRpmCarbon 守門
//   (byte 不變)、非 RPM 資料驅動 buildSpecRows(P0-C-b2);產地「泰國」RPM-only 覆蓋。桌機兩欄填滿。
//   OD-12:「適用車款」列交叉引用上方 ProductFitments 表(僅有 fitments 時顯、避 dangling)。
// - 安裝(全品牌通用去碳、Sean Q2=A):meta 3 欄 + 1 段說明 + 3 點清單;安裝資源(影片大/PDF 小)入右側欄
//   (有資源才排側欄、無則主文全寬);預約安裝 CTA router.push('/install') 全寬置段尾。
// - 保固(全品牌通用單一真相 rpm-policies、P0-C-b1):政策段落主文 + 退換要點左條 callout;含《消保法》§19。
//
// 'use client' 必要:安裝 CTA onClick → router.push('/install')(對齊 ADR-0006 §1「Hooks/事件 → 'use client'」)。
//   <details> 收合為原生行為(免 JS、漸進增強);client 邊界僅為 CTA 保留。
//
// 標點:渲染文案用全形(逗號「，」/ 冒號「：」/ 問號「？」/ 分號「；」+ 頓號「、」句號「。」括號「（）」);
//   時間「10:00」/ 數字範圍「2–6」/ 英文 / 程式碼維持半形。Sean 2026-06-10 Q2=B(業務 override、鐵則 1 例外)。

'use client';

import { useRouter } from 'next/navigation';
import { RPM_CARBON_BRAND_SLUG, type MockProduct, type UIVariant } from '@/data/mock-products';
import { InstallResources, hasInstallResources } from './InstallResources';
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

// 通用 LINE 提醒(全品牌重點清單末條);RPM 重點第 4 項亦為此句。文案 Sean 2026-07-10 改(交期諮詢導向、全形標點)。
const LINE_REMINDER = '現貨庫存流動快，建議下單前先以 LINE 諮詢交期，確保零件準時送達。';
// RPM 碳纖重點 4 點:前 3 點碳纖框架 byte 不變;第 4 點為通用 LINE_REMINDER(Sean 2026-07-10 改文案)。渲染於重點 callout。
const RPM_HIGHLIGHTS = [
  '真碳纖維材質，非塑膠仿碳貼皮',
  '對應原廠孔位，Plug & Play',
  '四款紋路 × 兩款表面，蜂巢另收特殊紋費',
  LINE_REMINDER,
];

export type ProductTabsProps = { product: MockProduct };

export function ProductTabs({ product }: ProductTabsProps) {
  const router = useRouter();

  // 🔴 P0-C-b2 去碳:RPM 才顯碳纖介紹/規格列(byte 不變);非 RPM 介紹留最小事實、規格表資料驅動。
  //   守門用 brandSlug(≠ product.brand 顯示名);F1 陷阱同 P0-C-a。安裝分頁為全品牌通用去碳(不守門、Sean Q2=A)。
  const isRpmCarbon = product.brandSlug === RPM_CARBON_BRAND_SLUG;
  const specRows = isRpmCarbon ? [] : buildSpecRows(product.variants ?? []);

  // 重點清單(移入紅色左條 callout):RPM=碳纖 4 點(byte 不變);非 RPM=賣點 highlights + LINE 提醒(空 highlights 只剩 LINE)。
  const highlightItems = isRpmCarbon ? RPM_HIGHLIGHTS : [...(product.highlights ?? []), LINE_REMINDER];

  // 收合 hint(標題右、展開後 CSS 隱藏):告訴客人裡面有什麼。
  const specRowCount = isRpmCarbon ? 9 : 4 + specRows.length; // 品牌/型號/分類 + 資料驅動列 + 適用車款(RPM 另含碳纖列共 9)
  const installHintParts: string[] = [];
  if (product.videoUrl) installHintParts.push('影片');
  if ((product.manuals?.length ?? 0) > 0) installHintParts.push('說明書');
  installHintParts.push('步驟');
  const showResources = hasInstallResources(product.manuals, product.videoUrl);

  const hasDescription = Boolean(product.description?.trim());

  return (
    <section className="pd-spec-section">
      <div className="pd-acc">
        {/* ── 商品介紹(預設展開)── 單欄流 + 重點紅色左條 callout ── */}
        <details className="pd-sec" id="pd-sec-description" open>
          <summary className="pd-sec-sum">
            <span className="pd-sec-head">
              <span className="pd-sec-eyebrow">Overview</span>
              <h2 id="pd-sec-description-title" className="pd-sec-title">商品介紹</h2>
            </span>
            <span className="pd-sec-hint">重點 {highlightItems.length} 項</span>
            <span className="pd-sec-chev" aria-hidden="true" />
          </summary>
          <div className="pd-sec-inner">
            <div className="pd-sec-flow">
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
                </>
              ) : hasDescription ? (
                // 非 RPM 有真描述(來源繁中內文)→ 逐段渲染。
                //   🔴 純文字渲染(React 預設 escape)、不用 dangerouslySetInnerHTML:來源為純文字內文、防 XSS。
                product.description!
                  .replace(/\r\n/g, '\n') // CRLF 正規化、確保 \n\n 斷段穩定
                  .split(/\n{2,}/)
                  .map((para) => para.trim())
                  .filter(Boolean)
                  .map((para, i) => (
                    <p key={i} className="pd-body">
                      {para}
                    </p>
                  ))
              ) : (
                // 無描述 → 留最小事實框架(品牌+品名+適用車款)。
                <p className="pd-body">
                  <strong>
                    {product.brand} {product.name}
                  </strong>
                  {product.fits && product.fits !== '通用款' ? ` · 適用 ${product.fits}` : ''}
                </p>
              )}
              {/* 重點 → 紅色左條 callout(Sean 2026-07-10 V1、取代改法 A 右側紅面板;去框、紅左條 + 方形紅點點綴)。
                  RPM=碳纖 4 點;非 RPM=賣點 + LINE 提醒(同一清單、桌機兩欄緊排)。 */}
              <div className="pd-callout pd-callout-hl">
                <div className="pd-panel-label">重點</div>
                <ul className="pd-hl-list">
                  {highlightItems.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </details>

        {/* ── 規格 / 相容性 ── 桌機兩欄填滿 ── */}
        <details className="pd-sec" id="pd-sec-specs">
          <summary className="pd-sec-sum">
            <span className="pd-sec-head">
              <span className="pd-sec-eyebrow">Specs</span>
              <h2 id="pd-sec-specs-title" className="pd-sec-title">規格 / 相容性</h2>
            </span>
            <span className="pd-sec-hint">{specRowCount} 項規格</span>
            <span className="pd-sec-chev" aria-hidden="true" />
          </summary>
          <div className="pd-sec-inner">
            <div className="pd-specs pd-specs-2col">
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
        </details>

        {/* ── 安裝須知 ── 主文左 + 安裝資源側欄右(有資源才排側欄)+ 全寬 CTA ── */}
        <details className="pd-sec" id="pd-sec-install">
          <summary className="pd-sec-sum">
            <span className="pd-sec-head">
              <span className="pd-sec-eyebrow">Install</span>
              <h2 id="pd-sec-install-title" className="pd-sec-title">安裝須知</h2>
            </span>
            <span className="pd-sec-hint">{installHintParts.join(' · ')}</span>
            <span className="pd-sec-chev" aria-hidden="true" />
          </summary>
          <div className="pd-sec-inner">
            <div className={showResources ? 'pd-sec-split pd-sec-split-media' : undefined}>
              <div className="pd-sec-main">
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
              </div>
              {/* 安裝資源:影片大 + PDF 小(見 InstallResources);有資源才渲染側欄(hasInstallResources 同判) */}
              {showResources && (
                <div className="pd-sec-side">
                  <InstallResources manuals={product.manuals} videoUrl={product.videoUrl} />
                </div>
              )}
            </div>
            {/* 預約安裝 CTA:全寬置段尾(深色滿版條、沿用 router.push('/install')) */}
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
        </details>

        {/* ── 保固與退換 ── 單欄流 + 退換要點左條 callout ── */}
        {/* ⚠️ 政策字面來自共用 @/data/rpm-policies(單一真相、與 N°04 FAQ ProductFAQ 共用、不分歧);
            含《消保法》第 19 條鑑賞期(L1 法律政策、Sean 仍在確認準確性、改字面只動 rpm-policies)。 */}
        <details className="pd-sec" id="pd-sec-warranty">
          <summary className="pd-sec-sum">
            <span className="pd-sec-head">
              <span className="pd-sec-eyebrow">Warranty</span>
              <h2 id="pd-sec-warranty-title" className="pd-sec-title">保固與退換</h2>
            </span>
            <span className="pd-sec-hint">客製訂製 · 鑑賞期</span>
            <span className="pd-sec-chev" aria-hidden="true" />
          </summary>
          <div className="pd-sec-inner">
            <div className="pd-sec-flow">
              {RPM_WARRANTY_PARAGRAPHS.map((para, i) => (
                <p className="pd-body" key={i}>
                  {renderPolicyRuns(para)}
                </p>
              ))}
              {/* 退換要點 → 中性金色左條 callout(V1、去框;對齊商品介紹紅色重點,退換為中性金色不搶眼)。 */}
              <div className="pd-callout">
                <div className="pd-panel-label">退換要點</div>
                <ul className="pd-list">
                  {RPM_WARRANTY_NOTES.map((note, i) => (
                    <li key={i}>{renderPolicyRuns(note)}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}
