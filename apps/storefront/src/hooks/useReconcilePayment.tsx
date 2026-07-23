'use client';

// useReconcilePayment.tsx — 黑洞「查詢付款結果」即時反查 client hook(M-3 S1b-2)
//
// 🔴 定位:S1a 讓網路黑洞卡死的客人跳出 unknown 終態(死路);S1b-1 補了後端反查 server action
//   (reconcileCartSession);本 hook 是前端觸發層,把「查詢付款結果」按鈕接上該 action,並把結果
//   映回 useChargePayment 的 ChargeState:paid → 成交終態 / failed → 全頁「付款未完成」/ pending → 維持 unknown。
//
// 🔴 state ownership 凍結(plan §5 MF7,codex R2 + Fable R2 雙抓):**唯一 ChargeState owner 是 useChargePayment**。
//   本 hook **只能組合於 useChargePayment 內部**(由後者注入 setState/clear/regenerateCartSession/cartSessionId);
//   對外唯一契約 = charge.reconcile() + charge.reconciling + charge.reconcileDisabled。**CheckoutView 絕不自行
//   實例化本 hook** —— 否則獨立 state 碰不到 useChargePayment 的私有 setState → charge.state 永停 unknown、
//   終態畫面不觸發(按了沒反應)。
//
// 🔴 client bounded timeout(plan §5 新 finding #3,codex R2):reconcile 自身不可再成黑洞。
//   client→server action reject/hang → 若無上限則 reconciling 永久 true、按鈕死鎖 = 重現 S1a 正在修的死路。
//   故包 withReconcileTimeout(比照 useChargePayment 已審 withSubmitTimeout):逾時 reject → catch 當 pending、
//   finally 解除 reconciling。**cooldown(查完 pending 的短冷卻)與 reconciling(請求中)兩個 state 分離**,
//   各自保證重置(finally / setTimeout)→ 按鈕永不永久 disabled。
//
// 🔴 fail-closed:反查/逾時/reject 任一 → 一律當 pending(維持 unknown),絕不誤報 paid/failed(金流安全方向)。
//   真動單/誤報防線在 server(reconcileCartSession 逐字重用 settleCharge);本 hook 只映結果、不下金流判斷。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { reconcileCartSession } from '@/app/checkout/reconcile-actions';
import { clearPaymentInflight } from '@/lib/payment/inflight-marker';
import type { ChargeState } from '@/hooks/useChargePayment';

// reconcile 遠輕於整鏈 charge(own-only lookup + 一次 Record + settle,應數秒內回)→ 取 15s 上限:
//   足夠涵蓋正常延遲,又不讓客人對死鈕久等;真 >15s 收不到 → 降級 pending(安全、可再查)。
const RECONCILE_TIMEOUT_MS = 15_000;
// 查到 pending 後的短冷卻(UX、非安全閘;真閘 = server claim_order_poll_settle 10s)。對齊 10s:窗內再查
//   多半仍被節流回 pending,冷卻避免無謂連打與焦慮連按。
const RECONCILE_COOLDOWN_MS = 10_000;

// 客人可見文案(L1 hardcode:錯誤路徑罕見改動)。
// 🔴 pending 文案含「重新登入」自救出口(plan §6-3、codex 關卡2 + Fable):JWT 過期時 server 恆回 pending,
//   缺此指引客人只會重複查詢、無自助解法。
const MSG_RECONCILE_PENDING =
  '仍在確認中,請稍候再查;若持續顯示此訊息,請重新登入後再查或聯繫客服 LINE。請勿重複付款。';
const MSG_RECONCILED_FAILED = '這筆付款未成功,款項未成立。購物車已清空,請重新選購後再結帳';

export type ReconcileDeps = {
  /** useChargePayment 的 client 穩定鍵(送出前 CartContext 生成;unknown 態刻意未 regenerate,仍指原筆)。 */
  cartSessionId: string | null;
  /** 🔴 注入 useChargePayment 私有 setState:reconcile 結果必須驅動**同一份** ChargeState(MF7)。 */
  setState: Dispatch<SetStateAction<ChargeState>>;
  /** paid 生命週期用:清車。 */
  clear: () => void;
  /** paid 生命週期用:換新 cart_session_id(防下次合法重購撞已 paid sibling)。 */
  regenerateCartSession: () => void;
};

export type UseReconcilePayment = {
  /** 觸發即時反查(同步啟動、內部 async;冪等鎖防雙擊)。 */
  reconcile: () => void;
  /** 反查請求進行中(bounded timeout + finally 保證重置;label/測試用)。 */
  reconciling: boolean;
  /** 按鈕 disabled = reconciling || 冷卻中(兩者皆保證重置 → 永不永久鎖死)。 */
  reconcileDisabled: boolean;
};

// 比照 useChargePayment.withSubmitTimeout:逾時 reject(不 cancel 底層請求,server 端可能仍完成、由既有
//   引擎冪等收斂)。差別僅上限值(reconcile 較輕)。
function withReconcileTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('reconcile-timeout')), RECONCILE_TIMEOUT_MS);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function useReconcilePayment({
  cartSessionId,
  setState,
  clear,
  regenerateCartSession,
}: ReconcileDeps): UseReconcilePayment {
  const [reconciling, setReconciling] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  // 🔴 同步原子鎖:防雙擊在 reconciling re-render 生效前重入(對齊 useChargePayment inFlightRef)。
  const busyRef = useRef(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 🔴 stale 守衛依據(codex 關卡2 must-fix):
  //   - mountedRef:元件是否仍掛載(客人是否已離開終態頁)。
  //   - cartSessionIdRef:最新 cartSessionId(閉包捕捉的是發起時的舊值,靠此 ref 讀當下值比對)。
  const mountedRef = useRef(true);
  const cartSessionIdRef = useRef(cartSessionId);
  cartSessionIdRef.current = cartSessionId;

  // 掛載標記 + 卸載清理(導航離開終態頁 → 防 setState-after-unmount 與晚到回應誤動)。
  // 🔴 setup 必須設回 true(codex 關卡2 R2 must-fix):Next 預設 React StrictMode 在 dev 跑
  //   setup→cleanup→setup,若只在 cleanup 設 false、setup 不設回 true,則首次模擬 cleanup 後 mountedRef
  //   恆 false → stale 守衛丟棄所有 reconcile 結果 = dev 下按鈕全失效(StrictMode 回歸測試守門)。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    };
  }, []);

  const startCooldown = useCallback(() => {
    setCooldown(true);
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = setTimeout(() => setCooldown(false), RECONCILE_COOLDOWN_MS);
  }, []);

  const reconcile = useCallback(() => {
    if (busyRef.current) return; // 已在反查中:忽略重入
    busyRef.current = true;
    setReconciling(true);
    const originSession = cartSessionId; // 捕捉發起時的 session(晚到回應據此判 stale)
    void (async () => {
      try {
        const result = await withReconcileTimeout(reconcileCartSession(originSession));
        // 🔴 stale 守衛(codex 關卡2 must-fix):元件已卸載 或 session 已變(客人已離開此筆 unknown、可能已在
        //   別頁開新車)→ 晚到回應**不得動 cart/marker/UI** —— 否則 late-paid 的 clear()/regenerate 會清掉客人新車。
        if (!mountedRef.current || cartSessionIdRef.current !== originSession) return;
        if (result.status === 'paid') {
          // paid:既有 submit paid 生命週期的超集(plan §5 MF1) —— 多一步清 unknown 專屬 in-flight 記號。
          clearPaymentInflight();
          clear();
          regenerateCartSession();
          setState({ status: 'paid', displayId: result.displayId });
        } else if (result.status === 'failed') {
          // failed:明確未成功(server settleCharge 已 markFailed)→ 全頁 reconciled_failed(車已清、CTA 重新選購);
          //   displayId 若 active 分支有帶則透傳供客訴查(與 paid 同揭露面)。
          clearPaymentInflight();
          setState({
            status: 'reconciled_failed',
            message: MSG_RECONCILED_FAILED,
            ...(result.displayId ? { displayId: result.displayId } : {}),
          });
        } else {
          // pending:維持 unknown 終態鎖(不清車、不換 key、inFlightRef 不釋)、更新提示 + 冷卻。
          setState({ status: 'unknown', message: MSG_RECONCILE_PENDING });
          startCooldown();
        }
      } catch {
        // fail-closed:逾時/reject → 當 pending(永不誤報 paid/failed);同 stale 守衛避免晚到錯誤誤動已離開的畫面。
        if (!mountedRef.current || cartSessionIdRef.current !== originSession) return;
        setState({ status: 'unknown', message: MSG_RECONCILE_PENDING });
        startCooldown();
      } finally {
        busyRef.current = false;
        // mounted(含 stale-but-mounted:session 已變)必解鎖防按鈕死鎖;unmounted 則 setState no-op、略過。
        if (mountedRef.current) setReconciling(false);
      }
    })();
  }, [cartSessionId, setState, clear, regenerateCartSession, startCooldown]);

  return { reconcile, reconciling, reconcileDisabled: reconciling || cooldown };
}
