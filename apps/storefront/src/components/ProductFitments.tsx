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
// - yearStart + yearEnd===null → 'YYYY 年起'(開放式;供應商只寫起始年 —— Sean 2026-09-17 拍乙,
//   單一判準與文案在 lib/open-ended-year.ts,段末 .pd-fit-note 同時補一句責任邊界)
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

import { findFitmentExclusion } from '@pcm/domain';
import { useEffect, useRef, useState } from 'react';
import type { MockProduct, UIFitment } from '@/data/mock-products';
import { isOpenEndedYear, openEndedYearLabel, OPEN_ENDED_YEAR_NOTE } from '@/lib/open-ended-year';

export type ProductFitmentsProps = {
  product: MockProduct;
  /**
   * 🔴 「這些情況裝不上」(2026-09-18 Sean 拍乙)。
   * 🔵 **選填** —— 不傳的話本元件自己用 `(brandSlug, productCode)` 查(那是正常路徑);
   *   傳進來只給測試用,讓負對照餵得進動過手腳的輸入。
   *
   * 🛑 **`undefined` / `[]` 都 ⇒ 那一塊【整個不存在】** —— 不是空框、也不是印一句「無」。
   *   理由:這一塊會出現在**每一件有排除條款的商品**上;若沒有條款的商品也長出一個空框,
   *   那是 1,106 件 rpm 商品**一起長**, 而那是沒有人會主動去看的頁面。
   *   ⇒ 做法沿用本檔既有的空狀態慣例(`fitments` 空 ⇒ `return null`)。
   */
  exclusions?: readonly string[];
};

/** 年式單格字串(忠實 UIFitment yearEnd 三態:null=開放式 / 省略=單年 / number=明確迄年)。 */
function formatYears(f: UIFitment): string {
  if (f.yearStart == null) return '—';
  if (f.yearEnd === null) return openEndedYearLabel(f.yearStart);
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

export function ProductFitments({ product, exclusions: exclusionsProp }: ProductFitmentsProps) {
  // 🔴 **鍵 = 品牌 slug + 商品主碼**(2026-09-18 Sean 提、實查佐證):
  //   · 只用料號 ⇒ 跨供應商撞號 **97 組** ⇒ 會把「A 家的條款」掛到 B 家的同號商品上
  //     —— 🎯 **那是我們正在治的病的加強版:不是漏講, 是【講錯一件商品】。**
  //   · 用品牌而不用供應商 ⇒ **商品頁本來就有品牌**, 不必多一發查詢, 也不必動
  //     `PRODUCT_SELECT_DETAIL`(讀寫共用常數)。🔵 同【品牌+料號】撞號實查 **0 組**。
  //   🛑 而 0 會變 ⇒ 由**匯入那側對 target 庫的那一發查詢**接住(`rpm-import.ts` 的 duplicate-key 段);
  //      🔴 **不是** `@pcm/domain` 那個純函式 —— 它在正式路徑上看不到別家供應商(2026-09-18 R1 抓到)。
  //   📌 **看到這裡不要改成「只用 productCode 就好」** —— 改完測試不會紅,
  //      因為那 97 組撞號的商品不在任何樣本裡。
  // 🛑 `brandSlug` / `productCode` 在 UI 型別上是 optional ⇒ **缺任一個就不查, 那一塊不顯示**。
  //   🔵 而「缺欄位」與「這件商品沒有條款」在畫面上相同 —— 它們的差別在這一行讀得出來, 不要壓成一個布林。
  const exclusions =
    exclusionsProp ??
    (product.brandSlug && product.productCode
      ? findFitmentExclusion(product.brandSlug, product.productCode)?.excludes
      : undefined);
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
  // 開放年(供應商只寫起始年)⇒ 段末補一句責任邊界;沒有開放年的商品不補,
  // 否則每一件都在說「請以實車確認」,那句話就沒有意義了。
  const hasOpenEnded = fitments.some(isOpenEndedYear);

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
      {/* 🔴 「這些情況裝不上」—— 接在車款表之後、責任邊界那句之前。
          客人已經在這裡讀相容性, 不必再往下找。
          🔵 **視覺沿用既有的 `.pd-added-notice` 家族**(surface 底 + 3px 左槓 + 13px),
             不新增色票、不新增字級 —— 稿上沒有畫過這一塊(`design-reference/components/ProductPage.jsx`
             的適用車款區 :284/:417 沒有任何警語形狀), 而站上已經有這個形狀, 用既有的。
          🛑 空 ⇒ 整塊不渲染(見 props 註解)。 */}
      {exclusions && exclusions.length > 0 ? (
        <div className="pd-fit-excl" role="note">
          <div className="pd-fit-excl-title">這些情況裝不上</div>
          <ul className="pd-fit-excl-list">
            {/* 🔵 key 用 index 不用內容:同一筆若寫了兩句一樣的, 用內容當 key 會噴 duplicate key。
                今天 13 筆無重複, 而那是資料剛好、不是碼保證。 */}
            {exclusions.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="pd-fit-note">
        {twoTier
          ? '「原廠適用」為供應商原廠明示；「車系相容（推導）」為同車系家族推導之相容參考。下單前如需確認年式 / 配備，歡迎 LINE 諮詢。'
          : '列表為主要適用車款；同系列其他年式 / 配備如需確認，歡迎 LINE 諮詢。'}
        {hasOpenEnded && ` ${OPEN_ENDED_YEAR_NOTE}`}
      </p>
    </section>
  );
}
