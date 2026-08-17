import 'server-only';

/**
 * isThreeDSEnabled:3DS live 路徑開關(M-3 3DS-5b;🔴 本片**僅引入**、charge-actions 分岔在 3DS-6 才消費)。
 *
 * 嚴格 opt-in:**只認字面 'true'**;未設 / 空 / 其餘 → false(對齊 CRON_SWEEPER_ENABLED gate 紀律、
 * api/cron/settle-sweep route)。
 *
 * 🔴 server-only:flag 讀只在 server action / route(charge-actions);靜態 `process.env.TAPPAY_3DS_ENABLED`
 * (非 computed member access → 不觸 #182 動態 env 規則、無 client bundle inlining 風險)。
 *
 * 🔴 flag off ≠ prod 可刷卡(plan §5、codex 關卡1 #7):prod 4 merchant 全強制 3D、同步 charge 被 status 75 拒、
 * flag off 在 prod 非可營運態;flag 僅供 sandbox/staging 滾動控制,prod checkout 仍一律不可開(直到 5a/5b+6+
 * sandbox 3DS E2E + Sean 驗收)。
 *
 * ⛔ **2026-08-17:上一段最後那句「prod checkout 仍一律不可開」的狀態【有爭議、未解】。**
 *    · 主視窗轉述 Sean:`TAPPAY_3DS_ENABLED=true`、`CRON_SWEEPER_ENABLED=true` 已開。
 *    · 而 `STATUS.md` 逐字仍寫「M-3 prod checkout 仍不可開(**3DS flag 全 false**)」。
 *    🔴 **兩邊我都沒有第一手證據**(不碰 Vercel dashboard、不碰 `.env`)⇒ **不挑一個消滅,兩個都留著**。
 *      需要的那一道檢查很小:當場讀一次 Vercel Production env 的那兩個變數。誰讀誰就把這段關掉。
 *    正本(含硬前置 backlog `#231` 與 Vercel WAF BLOCKER)在
 *    `docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md` 檔頭那一段。
 *    📎 上面 :6 那句提到 `CRON_SWEEPER_ENABLED` 的**不是**過期載體 —— 它講的是「只認字面 'true'」的
 *       解析紀律,不是 prod 狀態宣稱。而我第一輪**只看了 :6 就結案**、漏掉本段(code-reviewer R2 抓):
 *       **判定「不是載體」是對的,但那個判定只覆蓋我讀過的那一行。**
 *
 * @see docs/specs/2026-06-19-m3-3ds-5ab-charge-initiate-plan.md §3.4
 */
export function isThreeDSEnabled(): boolean {
  return process.env.TAPPAY_3DS_ENABLED === 'true';
}
