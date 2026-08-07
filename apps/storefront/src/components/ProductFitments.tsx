// ProductFitments.tsx — 商品詳細頁「適用車款表」(條件渲染 product.fitments)
//
// OD-12(視覺真權威 OD 模板「Website V2」product-detail-rpm-template.html §7.5 Fitments table、鐵則 1 直接搬;
//   接 S6 真資料 product.fitments〔UIFitment[]、lib/products.ts toUIProduct ← domain product.fitments〕)。
//
// OD-12d(Sean 2026-06-03 真機驗重設計、/frontend-design 協助):原 OD §7.5 **扁平 row-per-fitment 表**
//   對真資料(每品 ~8 fitments、同車廠/車型重複多列、年式分散)→「資訊稀疏、欄位文字撐開、往下滑很久」。
//   Sean 拍「文字之間收窄 + 整體比例協調 + 資訊密集 + 不要滑很久」→ 改 **依車廠→車型分組 + 年式 inline chips**:
//   - 8 列扁平表 → 1 品牌標頭 + N 車型列(年式 chip 橫排),消重複、變矮、欄間緊湊。
//   - 年式 chip 升序排列(yearStart asc、無年份排末)、formatYears 三態不變。
//   - 維持 OD 美學(mono 品牌標 + 年式 chip surface-2 底 + sharp corner + 薄線),非另起風格。
//   - business override fitmentsGroupedLayout 記;supersede OD §7.5 扁平表 + OD-12c 的 .pd-fit-table width:auto。
//
// - 🔴 D1=A 業務 override(Sean 2026-06-02 拍):車廠 / 車型 / 年式 3 維、無「車系」(DB / UIFitment 無 series 欄)。
// - unconfirmed:UIFitment 仍帶此欄(S6 toUIProduct 映射、harmless 公開資料),但前台**不顯**「未確認」標
//   (Sean 2026-06-03 拍「不該」— 下單前 LINE 本就會確認車款合用、標製造多餘焦慮;OD-12b 移除)。
// - 空狀態:product.fitments 缺 / 空陣列(mock 商品、通用款、無 fitments 的真品)→ 返 null 整段不渲染
//   (沿用相關商品 N°03 條件渲染範式 ProductPage、避免空表;規格 tab 交叉引用同步條件顯)。
//
// 年式格式(忠實 UIFitment 三態、不壓平):
// - 無 yearStart → '—'(無年份資料、不杜撰)
// - yearStart + yearEnd===null → 'YYYY+'(開放式、進行中車系)
// - yearStart + yearEnd 省略 / ===yearStart → 'YYYY'(單年)
// - yearStart + yearEnd(明確迄年、≠起年）→ 'YYYY–YYYY'(en-dash「–」對齊 OD 模板「2018–2025」)
//
// 'use client'(2026-07-08 Sean:車款太多時預設收合、客人點「展開」再看全部——避免長清單占版面、滑很久)。
//   收合以量測實際高度決定(scrollHeight > 上限才顯切換鈕);SSR 先依品牌數 heuristic 收合、client 精修。
//
// a11y:分組以巢狀 ARIA list(role=list / listitem)表達「品牌 → 車型 → 年式」層級;年式清單 aria-label
//   帶車型名建立年式↔車型關係(報讀器最易丟失的關係)。div 顯式 role、零 CSS / 視覺不變(避開 Safari +
//   VoiceOver 對 ul+list-style:none 移除 list 語意的已知陷阱)。
//
// 標點:渲染文案用全形(逗號「，」/ 分號「；」+ 頓號「、」句號「。」);英文 / 程式碼維持半形。
//   Sean 2026-06-10 Q2=B:商品詳情頁散文家族全改全形、反轉原「半形家族慣例」(業務 override、鐵則 1 例外)。

'use client';

import { useEffect, useRef, useState } from 'react';
import type { MockProduct, UIFitment } from '@/data/mock-products';

export type ProductFitmentsProps = { product: MockProduct };

/** 年式單格字串(忠實 UIFitment yearEnd 三態:null=開放式 / 省略=單年 / number=明確迄年)。 */
function formatYears(f: UIFitment): string {
  if (f.yearStart == null) return '—';
  if (f.yearEnd === null) return `${f.yearStart}+`;
  if (f.yearEnd === undefined || f.yearEnd === f.yearStart) return `${f.yearStart}`;
  return `${f.yearStart}–${f.yearEnd}`;
}

/** 年式升序鍵(yearStart asc;無 yearStart 排末)。 */
function yearSortKey(f: UIFitment): number {
  return f.yearStart ?? Number.POSITIVE_INFINITY;
}

// S1(2026-07-12、Sean Q4=A):適用車款分兩層 —— 「原廠適用」(direct、products.fitments 原始值)
// / 「車系相容（推導）」(inherited、報價單母款家族樹展開、product_fitments_effective 每日同步)。
// 顯示層講清 provenance(退貨/裝不上爭議要分得出原廠明示 vs 推導);無 inherited 時單層渲染、
// 不顯層標 = 既有商品零回歸。

type BrandGroup = { brand: string; models: { model: string; fits: UIFitment[] }[] };

/** 依車廠→車型分組、保留首見順序;年式於車型內升序。 */
function groupFitments(fitments: UIFitment[]): BrandGroup[] {
  const order: string[] = [];
  const byBrand = new Map<string, Map<string, UIFitment[]>>();
  for (const f of fitments) {
    if (!byBrand.has(f.motoBrand)) {
      byBrand.set(f.motoBrand, new Map());
      order.push(f.motoBrand);
    }
    const models = byBrand.get(f.motoBrand)!;
    const list = models.get(f.modelCode);
    if (list) list.push(f);
    else models.set(f.modelCode, [f]);
  }
  return order.map((brand) => ({
    brand,
    models: Array.from(byBrand.get(brand)!.entries()).map(([model, fits]) => ({
      model,
      fits: [...fits].sort((a, b) => yearSortKey(a) - yearSortKey(b)),
    })),
  }));
}

/** 收合時車款區最大高度(px);超過才顯「展開」鈕(Sean:太多列縮起、客人點開)。 */
const FIT_COLLAPSED_MAX_PX = 360;

/** 單層(tier)車款分組區塊 —— direct / inherited 共用同一 group/row/chip 版式。 */
function FitmentTierGroups({ groups, tierKey }: { groups: BrandGroup[]; tierKey: string }) {
  return (
    <div role="list">
      {groups.map((g) => (
        <div className="pd-fit-group" role="listitem" key={`${tierKey}-${g.brand}`}>
          <div className="pd-fit-brand">{g.brand}</div>
          <div className="pd-fit-rows" role="list">
            {g.models.map((m) => (
              <div className="pd-fit-row" role="listitem" key={m.model}>
                <div className="pd-fit-model">{m.model}</div>
                {/* 年式清單以「{車型} 適用年式」具名、建立年式↔車型關係(報讀器最易丟失) */}
                <div className="pd-fit-years" role="list" aria-label={`${m.model} 適用年式`}>
                  {m.fits.map((f, i) => (
                    <span
                      className="pd-fit-year"
                      role="listitem"
                      key={`${f.yearStart ?? ''}-${f.yearEnd ?? ''}-${i}`}
                    >
                      {formatYears(f)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProductFitments({ product }: ProductFitmentsProps) {
  const fitments = product.fitments;
  // S1 兩層:direct(matchSource 省略/'direct')與 inherited 分開分組;inherited 空 → 單層零回歸。
  const directFits = (fitments ?? []).filter((f) => f.matchSource !== 'inherited');
  const inheritedFits = (fitments ?? []).filter((f) => f.matchSource === 'inherited');
  const groups = directFits.length > 0 ? groupFitments(directFits) : [];
  const inheritedGroups = inheritedFits.length > 0 ? groupFitments(inheritedFits) : [];

  // hooks 無條件先呼叫(rules-of-hooks;早退在其後)。
  const groupsRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  // SSR heuristic:品牌數 ≥4 先當作長清單收合(避免長表 flash);client mount 量實際高度精修。
  const [needsCollapse, setNeedsCollapse] = useState(groups.length + inheritedGroups.length >= 4);
  useEffect(() => {
    const el = groupsRef.current;
    if (!el) return;
    setNeedsCollapse(el.scrollHeight > FIT_COLLAPSED_MAX_PX + 48);
  }, [product]);

  // 空狀態:無 fitments(mock / 通用款 / 無資料真品)→ 整段不渲染(規格 tab 交叉引用同步條件顯)。
  if (!fitments || fitments.length === 0) return null;

  const collapsed = needsCollapse && !expanded;
  const totalModels =
    groups.reduce((n, g) => n + g.models.length, 0) +
    inheritedGroups.reduce((n, g) => n + g.models.length, 0);
  const twoTier = inheritedGroups.length > 0;

  return (
    <section className="pd-fitments-section" aria-labelledby="pd-h-fit">
      <div className="pd-fit-head">
        <div>
          <div className="pd-fit-eyebrow">FITMENTS · 適用車款</div>
          <h2 className="pd-fit-title" id="pd-h-fit">這款部品適用的車型與年式</h2>
        </div>
        <div className="pd-fit-hint">下單前請先聊聊確認您的年式 / 配備</div>
      </div>
      <div
        ref={groupsRef}
        className={collapsed ? 'pd-fit-groups is-collapsed' : 'pd-fit-groups'}
      >
        {/* 單層(無 inherited)不顯層標;與舊版 a11y/CSS 等價(role=list 移入 tier 容器、多一層
            wrapper;.pd-fit-group 樣式為 class-based、:last-child 於 tier 內仍解析到整體末組) */}
        {groups.length > 0 && (
          <>
            {twoTier && <div className="pd-fit-tier">原廠適用</div>}
            <FitmentTierGroups groups={groups} tierKey="direct" />
          </>
        )}
        {inheritedGroups.length > 0 && (
          <>
            <div className="pd-fit-tier is-inherited">車系相容（推導）</div>
            <FitmentTierGroups groups={inheritedGroups} tierKey="inherited" />
          </>
        )}
      </div>
      {needsCollapse && (
        <button
          type="button"
          className={expanded ? 'pd-fit-toggle is-expanded' : 'pd-fit-toggle'}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span>{expanded ? '收合車款' : `展開全部 ${totalModels} 款車型`}</span>
          <span className="pd-fit-toggle-caret" aria-hidden="true" />
        </button>
      )}
      <p className="pd-fit-note">
        {twoTier
          ? '「原廠適用」為供應商原廠明示；「車系相容（推導）」為同車系家族推導之相容參考。下單前如需確認年式 / 配備，歡迎 LINE 諮詢。'
          : '列表為主要適用車款；同系列其他年式 / 配備如需確認，歡迎 LINE 諮詢。'}
      </p>
    </section>
  );
}
