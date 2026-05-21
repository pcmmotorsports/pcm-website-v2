// ProductServices.tsx — 商品詳細頁服務區(4 卡:滿額免運 / 專業安裝 / 原廠保固 / LINE 諮詢)
//
// 字面從 design-reference/components/explorations/VariantCFull.jsx L96-101 直接搬:
// - 4 條 .pd-service、結構 `<div className="pd-service"><span class="pd-service-label">標題</span><span class="pd-service-desc">副文</span></div>`
// - 純 presentational server component、無 props、無 hooks
//
// M-1-13H-3:移除 13f-1 4 個 svg 圖示(對應 HANDOFF #11、Apple/Aritzia 簡潔風格);
// .pd-service 從 flex row(svg + content) → block(label + desc stacked)、移除圖示後純文字 2x2 grid。
//
// 免運門檻字面:NT$ 5,000(對應 Sean 2026-05-21 M-1-13H plan Q1 業務拍板永久化、
// 不採 design VariantCFull L97 字面「NT$ 3,000 以上」/ ProductPage.jsx L358 字面「NT$ 3,000」;
// backlog #161 已記方向反轉 — design 待 Sean 在 Claude Design 補對齊 storefront 5,000)
//
// 保固字面:13f-1 既有「原廠授權代理」與 design L99 字面「24 個月」L2 業務差異、
// 13f-1 落地時 Sean 拍板用「原廠授權代理」更貼合 PCM 業務(代理多品牌不同保固期);
// 本 slice 保留 13f-1 字面、不改回「24 個月」。
//
// 鐵則 9 內容分級:此 4 卡內容(免運門檻 / 服務範圍 / 保固政策 / 諮詢時間)真實業務屬 L2
// (每季調整 1-3 次)、Phase 2 才動服務系統、現階段 hardcoded 接受。

export function ProductServices() {
  return (
    <div className="pd-services">
      <div className="pd-service">
        <span className="pd-service-label">滿額免運</span>
        <span className="pd-service-desc">NT$ 5,000 以上</span>
      </div>
      <div className="pd-service">
        <span className="pd-service-label">專業安裝</span>
        <span className="pd-service-desc">全台合作店家</span>
      </div>
      <div className="pd-service">
        <span className="pd-service-label">原廠保固</span>
        <span className="pd-service-desc">原廠授權代理</span>
      </div>
      <div className="pd-service">
        <span className="pd-service-label">LINE 諮詢</span>
        <span className="pd-service-desc">30 分鐘內回覆</span>
      </div>
    </div>
  );
}
