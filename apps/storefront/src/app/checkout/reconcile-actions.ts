'use server';

// app/checkout/reconcile-actions.ts — 黑洞「查詢付款結果」即時反查 server action(M-3 S1b-1)
//
// 用途:S1a 讓網路黑洞卡死的客人跳出「付款狀態未知」(unknown)終態畫面,但那是死路(只能勿重複付款、
//   聯繫客服)。本 action 讓客人在該畫面主動即時對帳:client 唯一持有的穩定鍵 = cartSessionId →
//   own-only 反查 orderId → 節流閘 → settleCharge(Record API 唯一權威)→ 回 paid/failed/pending。
//
// 🔴 與 payment-status/route.ts **共用** own-only 反查 → per-order throttle → settleCharge 骨架;
//   差異:①反查鍵 by-cartSessionId(非 by-orderId)②直接映 outcome(不重讀 DB)、可回 failed/displayId
//   ③錯誤策略不同——route 拋 401/404/500,reconcile **一律吞 pending**(client 內嵌查詢、非公開 API)。回應零金額/零經銷價/零 PII。
//   真權威 plan = docs/specs/2026-07-23-m3-s1b-reconcile-cart-session-plan.md
//   (v3;plan 經 codex 關卡1 + Fable 兩輪雙模型規劃審查,codex R2 FAIL findings 已折入 v3、Fable R2 GO,v3=折入版)。
//
// 🔴 金流不變量(鐵則 12 ①錢 + ②權限 own-only;全部由重用元件保證、本 action 零新增寫入/刪除/release):
//   1. 只有 settleCharge(逐字重用)才動單,且只沿用其既有語意:record_status −1/5 → markFailed(唯一負向
//      動單);0/1 → 既有 paid 收斂寫入;其餘/查不到/pending → 一律 pending 不動。**不新增任何寫入 primitive、
//      不新增刪除/release(刻意不用 preflightReleaseSibling 的 release 寫入語意)。**
//   2. own-only:orderId 由 find_active_sibling_own(DB 內 auth.uid() 鎖死)反查,不信 client 傳的 user/order;
//      偽造他人 cartSessionId → none/自己單。未登入 → RPC own-only fail-safe 回 none;此處提前保守回 pending。
//   3. Record 節流:對 active 兄弟單 settle 前必過既有 claim_order_poll_settle(同單窗內最多放行一次);
//      client 按鈕冷卻是 UX、非安全閘(真閘 = 此 DB claim + settleCharge 冪等)。
//   4. 回應只含 { status, displayId? };displayId = 客人自己訂單號(對齊既有 { ok:true, displayId } 揭露面、非敏感);
//      settleCharge 回的金額/outcome 內部細節絕不入回應。
//   5. fail-closed:反查 / 節流 / settle / 建 client 任一 throw → 一律回 pending(不偽 paid/failed)。
//
// 🔴 caller 盤點(不編號、非窮舉):現有 settleCharge caller = callback / webhook / sweeper / payment-status poll /
//   charge-action adjudicateSettlement / preflight 注入 / reconfirm-expired-orphans 等;reconcile 新增另一個 caller。
//   不同 caller 可並發重複打 Record/重複 settle 呼叫,但 markCharged/confirm 各經 FOR UPDATE 冪等序列化 → 訂單只成立一次、零雙扣。

import { settleCharge } from '@pcm/use-cases';
import {
  getSiblingLookup,
  getPollSettleThrottle,
  getSettleChargeDeps,
} from '@/lib/payment/composition';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// cart_session_id 局部 uuid 驗(沿用 charge-actions.ts:77 / callback page 同層 UUID_RE 慣例;
//   storefront 無 zod 直接依賴,不引 z.uuid 避脆弱 transitive import)。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// per-order poll-settle throttle 窗(秒;與 payment-status route 同 last_poll_settle_at 欄、同窗共用 —
//   客人不能靠在兩端點間切換繞過 Record 節流)。
const RECONCILE_THROTTLE_SECONDS = 10;

/**
 * reconcile 回 client 的即時對帳結果(零金額/零 PII):
 * - `paid`:DB 確定成交(既有 paid 單 / settleCharge 0/1 收斂)→ 顯訂單號。
 * - `failed`:settleCharge 明確 −1/5(既有單已 markFailed)→ 請重新結帳;displayId 供客訴查(可缺)。
 * - `pending`:查不到 / 節流未放行 / settleCharge pending / 未登入 / 任一 throw → 保守不下結論。
 */
export type ReconcileResult =
  | { status: 'paid'; displayId: string }
  | { status: 'failed'; displayId?: string }
  | { status: 'pending' };

/**
 * 黑洞即時反查:cartSessionId → own-only orderId → 節流 → settleCharge → paid/failed/pending。
 * 全程 fail-closed(§金流不變量 5):任一失敗一律回 pending,絕不誤報 paid/failed。
 */
export async function reconcileCartSession(cartSessionId: unknown): Promise<ReconcileResult> {
  // 零信任:cartSessionId 須為 UUID 形狀(非法 → pending、不建 client、不查)。
  if (typeof cartSessionId !== 'string' || !UUID_RE.test(cartSessionId)) {
    return { status: 'pending' };
  }

  try {
    // 登入 gate(向 auth server 驗 JWT)。未登入 → 保守 pending(不揭示;own-only 反查於 auth.uid() NULL
    //   本就回 none = 等同 pending、零洩漏)。🔴 **未登入路徑不 log**(codex 關卡2:此為最廉價可 spam 路徑,
    //   逐次 console.warn = log 灌爆向量)——靜默 pending;維運訊號由下方 catch(真錯誤、較罕見)承擔。
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { status: 'pending' };
    }

    // own-only 反查兄弟單 orderId(find_active_sibling_own、DB 內 auth.uid() 鎖死;active 分支不含 rec/bank)。
    const sibling = await (await getSiblingLookup()).lookup(cartSessionId);
    if (sibling.kind === 'none') {
      return { status: 'pending' };
    }
    if (sibling.kind === 'paid') {
      // DB 確定成交 → 直接回 paid、不打 Record(對齊 payment-status route paid 短路)。
      return { status: 'paid', displayId: sibling.displayId };
    }

    // sibling.kind === 'active':節流閘(窗內最多放行一次 settle;false = 窗內已放行 / order 非 unpaid /
    //   pending·charged 已 manual 或 count>=8;released 態繞閘可 true)→ 過閘才 settleCharge。
    const allowed = await getPollSettleThrottle().claimPollSettle(
      sibling.existingOrderId,
      RECONCILE_THROTTLE_SECONDS,
    );
    if (!allowed) {
      return { status: 'pending' };
    }

    // settleCharge(重用、零改語意;第 N 路 caller):Record 反查後依 record_status 映射。
    const settled = await settleCharge(getSettleChargeDeps(), {
      orderId: sibling.existingOrderId,
    });
    if (settled.kind === 'paid') {
      return { status: 'paid', displayId: settled.displayId };
    }
    if (settled.kind === 'failed') {
      // 明確 −1/5、既有單已 markFailed → 請重新結帳;帶 active 分支 displayId 供客訴查(N2、與 paid 同揭露面)。
      return { status: 'failed', displayId: sibling.displayId };
    }
    // no_attempt / pending(含未來新增 kind)→ 保守 pending(fail-closed:永不誤報 paid/failed)。
    return { status: 'pending' };
  } catch {
    // fail-closed:建 client / getUser / 反查 / 節流 / settleCharge 任一 throw → pending(不偽、不外洩 raw error)。
    console.error('[reconcileCartSession] fail-closed → pending(反查/節流/settle throw)');
    return { status: 'pending' };
  }
}
