/**
 * 結帳同意條款版本(#241 建立、#291 於 2026-07-24 補齊內容綁定)。
 *
 * 🔴 server 權威常數(非 client 送):記錄客人結帳時同意「哪一版」服務條款 / 隱私政策。
 *   charge-actions 驗 agreed===true 後,把本常數注入 PlaceOrderInput.termsVersion →
 *   create_order RPC 同 transaction 原子寫 order_legal_consents(FK → legal_terms_versions)。
 *
 * ── 版本語意 ───────────────────────────────────────────────────────────────────
 * `CURRENT_TERMS_VERSION` = 版本鍵(FK 值);`CURRENT_TERMS_CONTENT_HASH` = 該版本對應的
 * **對外文字內容**雜湊。兩者一起回答稽核問題:「這筆訂單的客人,當時同意的是哪一份文字?」
 *
 * ✅ **2026-07-24(#291)起**:內容真相 = `@/data/legal-content.ts`(`/terms`、`/privacy` 實際渲染的字),
 *   hash = `sha256(canonicalLegalPayload())`。改任何對外文字而未 bump →
 *   `data/legal-content-hash.test.ts` 直接紅,不會靜默漂移。
 * ⚠️ 舊版 `'2026-06-30'` 的 hash 來源是 `design-reference/components/LegalPage.jsx`(草稿檔)。
 *   該列仍留在 `legal_terms_versions`(既有訂單的 FK 指向它、**不可刪**),
 *   但**不得**再當成內容來源 —— 那份草稿自述「待法務 review」、含假聯絡資訊。
 *
 * ── 🔴 改版時的硬性順序(顛倒 = 全站結帳斷線)────────────────────────────────────
 * `order_legal_consents.terms_version` 對 `legal_terms_versions(version)` 有 FK,
 * 只收**已登錄**版本。所以永遠是:
 *   ① 改 `data/legal-content.ts` 文字
 *   ② 跑 `pnpm vitest run src/data/legal-content-hash` 取新 hash(測試失敗訊息會印出實際值)
 *   ③ 寫 migration `INSERT INTO legal_terms_versions`(新 version + 新 hash)
 *   ④ `supabase db push` **並確認已套用**
 *   ⑤ 才 bump 本檔兩個常數 → 部署
 * 先 bump 常數而 DB 沒那一列 → 每一筆結帳都 FK 違反、直接失敗。
 *
 * ── 誠實邊界(2026-07-24 現況)─────────────────────────────────────────────────
 * ✅ 已完成(**程式碼層**):`/terms`、`/privacy` route;結帳頁與註冊頁 `href="#"` 已接真連結 + footer 入口;
 *   內容雜湊綁定機制 + 守門測試;migration `20260724120000_m3_291_legal_terms_v2` 已寫好並經
 *   交易模擬(BEGIN→驗→ROLLBACK 零留痕)+ 突變自驗(hash 不符確實 RAISE)。
 * 🔴 **尚未完成**:`20260724120000` 已於 2026-07-24 apply,但它登錄的是**修正前**的 hash;
 *   定稿 hash 由 `20260724130000` 修正,**該支尚未 apply**(`supabase db push` 需讀 `.env.local`,
 *   而 Claude 被 settings.json 硬擋不得碰 `.env*` ⇒ 這一步是 Sean 的終端動作)。
 *   ⇒ **修正檔 apply 完成前不得部署**。🔴 **風險不是「結帳全斷」(該描述已更正)**:
 *   版本列已存在 ⇒ 不會 FK 失敗;FK 只綁 version 不綁 content_hash ⇒ 會**成功建單**並把同意
 *   掛到 hash 錯誤的版本列上 = **靜默舉證錯配**,比結帳斷線更難發現。
 *   本地已 bump 是為了讓 hash 守門測試綠;未 commit 未 push 未 deploy ⇒ 正式站不受影響。
 * ⚠️ 仍非「完整法律效力」背書:
 *   ① 本次條款**未經律師簽核**(Sean 2026-07-24 判「不用」)。
 *   ② **第 10 條鑑賞期排除主張 = Sean 拍板 B、與 Claude 查證結論相反、風險已知並由 Sean 承擔**:
 *      查證(通訊交易解除權合理例外情事適用準則第 2 條 + 行政院總說明附表)顯示「代購」不在 7 款
 *      例外內,且立法說明明文排除「依現有顏色或規格中加以指定或選擇者」。Claude 建議選項 D
 *      (僅對真客製品逐項標示);Sean 三度確認選 B。完整法源與理由 =
 *      memory `project_seven-day-withdrawal-stance-decision`。
 *      ⇒ `/terms` 與 `/info/shipping`(`data/rpm-policies.ts`)口徑**現已一致**
 *        (codex 關卡2 must-fix #2 的「同站互相矛盾」已消除),但一致的是**被查證為站不住的那一側**。
 *      🔴 **不要自行把口徑「修正」回法律建議版**——那會推翻 Sean 拍板。要改先問他。
 * ⚠️ `TAPPAY_3DS_ENABLED` 是否已開 = Sean 的手動動作,**本檔不寫死**;
 *   現況一律以 `STATUS.md` Blocker 欄與 Vercel 實際設定為準。
 *
 * 相關真權威:`docs/specs/2026-06-30-m3-241-checkout-consent-plan.md` §7
 *   (⚠️ **erratum**:該 plan §7「完整效力另需 #235」為已作廢字面、該檔屬凍結歷史不回改;以 #291 為準);
 *   法律頁硬閘:`docs/specs/2026-07-20-m3-two-step-checkout-design.md` §10;
 *   結帳勾選 markup 位置:`rg -n '服務條款' apps/storefront/src`。
 */
export const CURRENT_TERMS_VERSION = '2026-07-24';

/**
 * `CURRENT_TERMS_VERSION` 對應的對外文字雜湊 = `sha256(canonicalLegalPayload())`。
 * 🔴 必須與 `legal_terms_versions` 該列的 `content_hash` **逐字相同**(migration seed 即用此值)。
 * 取得方式見上方檔頭第 ② 步;請勿手改成「看起來對」的值。
 */
export const CURRENT_TERMS_CONTENT_HASH =
  'eca6a2415d0599c16fbea7ed81316584dab6ba6c7856e4c48f9e5c89514cb6ab';
