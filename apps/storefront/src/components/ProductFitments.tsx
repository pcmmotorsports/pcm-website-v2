// ProductFitments.tsx — 商品詳細頁「適用車款表」(條件渲染 product.fitments)
//
// OD-12(視覺真權威 OD 模板「Website V2」product-detail-rpm-template.html §7.5 Fitments table、鐵則 1 直接搬;
//   接 S6 真資料 product.fitments〔UIFitment[]、lib/products.ts toUIProduct ← domain product.fitments〕):
// - 結構 / 字面 / CSS 直接搬 OD §7.5:section.pd-fitments-section(flat eyebrow「FITMENTS · 適用車款」、
//   非 N° 編號區、位於 pd-services-strip 與 N°01 之間)+ pd-fit-head(eyebrow / title / hint)+
//   pd-fit-table-wrap > table.pd-fit-table + pd-fit-note。
// - 🔴 D1=A 業務 override(Sean 2026-06-02 拍):OD 模板 4 欄(車廠 / 車系 / 車型 / 年式)→ 本站 **3 欄
//   (車廠 / 車型 / 年式)**;DB 無「車系」欄(UIFitment 無 series 欄)、不擅造、砍車系欄。非誤翻譯、
//   manifest business_overrides 記。
// - 🔴 unconfirmed 標(UIFitment 文件註「來源自動展開、未經人工確認 → 顯『未確認』標」):來源自動展開
//   的車款列加小標、與人工確認列區隔(誠實揭示資料信心、非 OD 模板原有、business override);
//   pd-fit-note 已提示「下單前聊聊確認年式 / 配備」。
// - 空狀態:product.fitments 缺 / 空陣列(mock 商品、通用款、無 fitments 的真品)→ 返 null 整段不渲染
//   (沿用相關商品 N°03 條件渲染範式 ProductPage、避免空表;規格 tab 交叉引用同步條件顯)。
//
// 年式格式(忠實 UIFitment 三態、不壓平):
// - 無 yearStart → '—'(無年份資料、不杜撰)
// - yearStart + yearEnd===null → 'YYYY+'(開放式、進行中車系)
// - yearStart + yearEnd 省略 / ===yearStart → 'YYYY'(單年)
// - yearStart + yearEnd(明確迄年、≠起年）→ 'YYYY–YYYY'(en-dash「–」對齊 OD 模板「2018–2025」)
//
// 純 presentational、無 hooks、無 'use client'(由 client parent ProductPage import 進 client bundle、仍 SSR)。
//
// 標點:半形逗號「,」對齊產品頁元件家族慣例(ProductFAQ / ProductTabs 一致);頓號「、」句號「。」依 OD。

import type { MockProduct, UIFitment } from '@/data/mock-products';

export type ProductFitmentsProps = { product: MockProduct };

/** 年式單格字串(忠實 UIFitment yearEnd 三態:null=開放式 / 省略=單年 / number=明確迄年)。 */
function formatYears(f: UIFitment): string {
  if (f.yearStart == null) return '—';
  if (f.yearEnd === null) return `${f.yearStart}+`;
  if (f.yearEnd === undefined || f.yearEnd === f.yearStart) return `${f.yearStart}`;
  return `${f.yearStart}–${f.yearEnd}`;
}

export function ProductFitments({ product }: ProductFitmentsProps) {
  const fitments = product.fitments;
  // 空狀態:無 fitments(mock / 通用款 / 無資料真品)→ 整段不渲染(規格 tab 交叉引用同步條件顯)。
  if (!fitments || fitments.length === 0) return null;

  return (
    <section className="pd-fitments-section" aria-labelledby="pd-h-fit">
      <div className="pd-fit-head">
        <div>
          <div className="pd-fit-eyebrow">FITMENTS · 適用車款</div>
          <h2 className="pd-fit-title" id="pd-h-fit">這款部品適用的車型與年式</h2>
        </div>
        <div className="pd-fit-hint">下單前請先聊聊確認您的年式 / 配備</div>
      </div>
      <div className="pd-fit-table-wrap">
        <table className="pd-fit-table">
          <thead>
            <tr>
              <th scope="col">車廠</th>
              <th scope="col">車型</th>
              <th scope="col">年式</th>
            </tr>
          </thead>
          <tbody>
            {fitments.map((f, i) => (
              <tr key={`${f.motoBrand}-${f.modelCode}-${f.yearStart ?? ''}-${f.yearEnd ?? ''}-${i}`}>
                <td className="brand">{f.motoBrand}</td>
                <td>
                  {f.modelCode}
                  {f.unconfirmed && <span className="pd-fit-unconfirmed">未確認</span>}
                </td>
                <td className="years">{formatYears(f)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pd-fit-note">列表為主要適用車款;同系列其他年式 / 配備如需確認,歡迎 LINE 諮詢。</p>
    </section>
  );
}
