// ProductServices.tsx — 商品詳細頁服務區(4 卡:滿額免運 / 專業安裝 / 原廠保固 / LINE 諮詢)
//
// 字面從 design-reference/components/ProductPage.jsx @ 25d3a2a L353-378 直接搬:
// - jsx → tsx + SVG self-closing
// - svg 補 aria-hidden="true"(裝飾用、不傳意義給 screen reader)
// - 內容 hardcoded(對齊鐵則 1「直接搬不翻譯」、Phase 2 才會動服務系統)
//
// M-1-13f-1:從 ProductInfo.tsx L266-338 拆出(Codex M-1-13e-b review 提醒 + ProductInfo 341
// 已破鐵則 6 警戒 300 → 拆完 ~280 回綠);純 presentational server component、無 props、
// 無 hooks、無 props drift 風險(Sean via claude.ai 拍板 Q3=A 偏 A 的 (b) 點主動處理)。
//
// 偏離 design 揭示:免運門檻 design 寫 NT$ 3,000(L358)、storefront 統一 NT$ 5,000(backlog #161、
// 本刀不動);其餘字面 1:1 對齊。
//
// 鐵則 9 內容分級:此 4 卡內容(免運門檻 / 服務範圍 / 保固 / 諮詢時間)真實業務屬 L2(每季調整 1-3 次)、
// Phase 2 才動服務系統、現階段 hardcoded 接受。

export function ProductServices() {
  return (
    <div className="pd-services">
      <div className="pd-service">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M3 8h14l4 4v5h-2a2 2 0 11-4 0H9a2 2 0 11-4 0H3V8z" />
          <circle cx="7" cy="17" r="2" />
          <circle cx="15" cy="17" r="2" />
        </svg>
        <div>
          <div className="pd-service-label">滿額免運</div>
          <div className="pd-service-desc">NT$ 5,000 以上</div>
        </div>
      </div>
      <div className="pd-service">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
        </svg>
        <div>
          <div className="pd-service-label">專業安裝</div>
          <div className="pd-service-desc">全台合作店家</div>
        </div>
      </div>
      <div className="pd-service">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M9 12l2 2 4-4M12 3a9 9 0 109 9" />
        </svg>
        <div>
          <div className="pd-service-label">原廠保固</div>
          <div className="pd-service-desc">原廠授權代理</div>
        </div>
      </div>
      <div className="pd-service">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
        <div>
          <div className="pd-service-label">LINE 諮詢</div>
          <div className="pd-service-desc">30 分鐘內回覆</div>
        </div>
      </div>
    </div>
  );
}
