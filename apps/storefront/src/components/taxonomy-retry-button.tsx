'use client';

// taxonomy-retry-button.tsx — 車款 / 分類 / 品牌清單讀不到時, 提示旁那顆「重試」。
//
// 🔴 為什麼是獨立的 client 檔:`TaxonomyNotice` 同時被 server(`app/page.tsx`)與 client
//   (`ProductsPage.tsx`)render, 而 onClick 只能住在 client 元件 ⇒ 鈕自己一檔, 提示那檔不動邊界。
// 🔵 重試 = 整頁重載:失敗的那一發沒進 `unstable_cache`(它不快取 throw), 重載就會再打一次 DB。
//   不用 `router.refresh()` 是因為它要 App Router 掛著, 提示那支的測試沒有 router 可 mock。
// ⚠️ 稿上(OD `#pp-error`)只有一句字、沒有鈕 —— 這顆是主視窗 2026-09-14 派工加的(launch-todo:2531
//   「逾時要有失敗提示 + 重試」), 樣式沿用 `MESSAGE_STATE_STYLE` 的字, 不另畫。

export const TAXONOMY_RETRY_LABEL = '重試';

export function TaxonomyRetryButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      style={{
        color: 'var(--c-text-3)',
        font: '14px/1.6 system-ui, sans-serif',
        padding: 0,
        border: 0,
        background: 'none',
        textDecoration: 'underline',
        cursor: 'pointer',
      }}
    >
      {TAXONOMY_RETRY_LABEL}
    </button>
  );
}
