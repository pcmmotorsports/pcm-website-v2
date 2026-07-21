/**
 * 結帳同意條款版本(#241)。
 *
 * 🔴 server 權威常數(非 client 送):記錄客人結帳時同意「哪一版」服務條款 / 隱私政策。
 *   charge-actions 驗 agreed===true 後,把本常數注入 PlaceOrderInput.termsVersion →
 *   create_order RPC 同 transaction 原子寫 order_legal_consents(FK → legal_terms_versions)。
 *
 * 🔴 條款文字實質改版時必同步 bump 兩處(否則紀錄對不上內容):
 *   ① 本常數 ② supabase migration `legal_terms_versions` seed(version + content_hash)。
 *   現行值 '2026-06-30' 的 content_hash 來源(歷史 provenance、僅描述已登錄那一版)=
 *   `shasum -a 256 design-reference/components/LegalPage.jsx`。
 *   🔴 該 design 檔是**草稿**(內容自述「待法務 review」、含假聯絡資訊與與 PCM 政策衝突的條文),
 *   **不得**當成未來正式條款的內容來源;正式內容與 hash 合成規則由 backlog #291 定義。
 *
 * 誠實邊界(codex 關卡1 B1):本片 = 同意訊號 + 版本 + 內容雜湊 provenance;
 *   完整法律效力另需 **backlog #291**(正式服務條款 / 隱私政策 route `/terms`、`/privacy`
 *   + 新 version + 顯示內容 hash 與 `legal_terms_versions` row 一致)。
 *   結帳的兩個條款連結目前仍是 no-op `href="#"`(CheckoutStep3.tsx)。
 *   ⚠️ 2026-07-21 更正:本段原寫「另需 #235」= 錯誤依賴 —— live #235 是
 *   「Step3 / 完成頁退換貨連結 + 客服 LINE 入口」、不產出法律頁。
 *   🔴 #291 未完成前,不得宣稱結帳具備完整法律效力,也不得開放 production 付款。
 *   設計真權威:docs/specs/2026-06-30-m3-241-checkout-consent-plan.md §7
 *   (⚠️ **erratum**:該 plan §7 內「完整效力另需 #235」為**已作廢字面**、該檔屬凍結歷史不回改;
 *    讀該段時一律以 #291 為準);
 *   法律頁硬閘:docs/specs/2026-07-20-m3-two-step-checkout-design.md §10。
 */
export const CURRENT_TERMS_VERSION = '2026-06-30';
