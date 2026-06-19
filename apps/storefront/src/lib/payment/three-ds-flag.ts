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
 * @see docs/specs/2026-06-19-m3-3ds-5ab-charge-initiate-plan.md §3.4
 */
export function isThreeDSEnabled(): boolean {
  return process.env.TAPPAY_3DS_ENABLED === 'true';
}
