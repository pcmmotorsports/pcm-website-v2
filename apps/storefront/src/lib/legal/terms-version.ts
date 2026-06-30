/**
 * 結帳同意條款版本(#241)。
 *
 * 🔴 server 權威常數(非 client 送):記錄客人結帳時同意「哪一版」服務條款 / 隱私政策。
 *   charge-actions 驗 agreed===true 後,把本常數注入 PlaceOrderInput.termsVersion →
 *   create_order RPC 同 transaction 原子寫 order_legal_consents(FK → legal_terms_versions)。
 *
 * 🔴 條款文字實質改版時必同步 bump 兩處(否則紀錄對不上內容):
 *   ① 本常數 ② supabase migration `legal_terms_versions` seed(version + content_hash)。
 *   content_hash = `shasum -a 256 design-reference/components/LegalPage.jsx`(條款內容 provenance)。
 *
 * 誠實邊界(codex 關卡1 B1):本片 = 同意訊號 + 版本 + 內容雜湊 provenance;
 *   完整法律效力另需 #235(結帳條款連結 `href="#"` → 接可讀條款 / 隱私頁)。
 *   設計真權威:docs/specs/2026-06-30-m3-241-checkout-consent-plan.md §7。
 */
export const CURRENT_TERMS_VERSION = '2026-06-30';
