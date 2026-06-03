// ProductServices.tsx — 商品詳細頁服務保障橫條(4 卡:滿額免運 / 專業安裝 / 泰國原廠 / LINE 諮詢)
//
// OD-5(服務橫條外移 + 內容/結構對齊 OD 真權威):
// - 視覺真權威由 design-reference 遷至 OD product-detail-rpm-template.html(manifest od_redesign 決定一=A);
// - 結構:元件改吐**完整 section.pd-services-strip**(全寬上下細線橫條、aria-label「服務保障」)、
//   原僅 .pd-services div、外層 strip 由本元件擁有;由 ProductPage 當 pd-main 之後的獨立 section 渲染
//   (從 ProductInfo 內 pd-info 移出 — OD 模板 §12 服務橫條是 hero 下方全寬區、非右欄內);
// - 字面**直接搬 OD 模板 HTML**(鐵則 1):
//     滿額免運 / NT$ 5,000 以上免運費(5,000 門檻仍對齊 Sean 2026-05-21 永久拍板、OD 字面同 5,000)
//     專業安裝 / 全台合作店家
//     泰國原廠 / RPM Carbon 授權代理(取代舊「原廠保固 / 原廠授權代理」— OD 模板 RPM 制式頁字面;
//       產地泰國對齊 16c-4b、Phase 1 catalog RPM-only)
//     LINE 諮詢 / 下單前先聊聊確認貨況(取代舊「30 分鐘內回覆」)
//
// 純 presentational、無 props、無 hooks。
//
// 鐵則 9 內容分級:此 4 卡內容(免運門檻 / 服務範圍 / 代理品牌 / 諮詢說明)真實業務屬 L2
// (每季調整 1-3 次)、Phase 2 才動服務系統、現階段 hardcoded 接受。

export function ProductServices() {
  return (
    <section className="pd-services-strip" aria-label="服務保障">
      <div className="pd-services">
        <div className="pd-service">
          <span className="pd-service-label">滿額免運</span>
          <span className="pd-service-desc">NT$ 5,000 以上免運費</span>
        </div>
        <div className="pd-service">
          <span className="pd-service-label">專業安裝</span>
          <span className="pd-service-desc">全台合作店家</span>
        </div>
        <div className="pd-service">
          <span className="pd-service-label">泰國原廠</span>
          <span className="pd-service-desc">RPM Carbon 授權代理</span>
        </div>
        <div className="pd-service">
          <span className="pd-service-label">LINE 諮詢</span>
          <span className="pd-service-desc">下單前先聊聊確認貨況</span>
        </div>
      </div>
    </section>
  );
}
