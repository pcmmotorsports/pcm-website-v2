import 'server-only';

/**
 * 部分取消信【寄出當下】的金額(2026-09-14;codex R1 must-fix ④)。
 *
 * 🔴 **為什麼不用 payload 裡的數字**:排信與寄出之間會過幾秒到幾小時(重試)。客人這中間付清了、
 *    或我們退了款 ⇒ 信裡那句「請補付 NT$ X」「會退你 NT$ Y」就變成假的, 而既有的 order_ineligible
 *    閘只擋【整單取消 / 全退】兩種。⇒ 這裡在寄出那一刻重讀, **信裡印的永遠是這一刻的真值**。
 * 🔵 讀的是 `pcm_partially_cancelled_email_current_v`(與掃描面同一組金額口徑)。
 */
export type PartiallyCancelledEmailCurrent = {
  /** false = 這張單已整單取消 ⇒ 本信不該寄(走取消信)。 */
  stillPartial: boolean;
  effectiveSubtotal: number;
  effectiveShippingFee: number;
  /** 含稅的取消後應收;null = 稅算不出(手動含稅單)⇒ 不寄, 不猜。 */
  remainingReceivable: number | null;
  /** 已收未退。 */
  paidTotal: number;
};

export type LoadPartiallyCancelledCurrentResult =
  | { kind: 'ok'; current: PartiallyCancelledEmailCurrent }
  /** 讀不到(查詢失敗 / 那張單不見了)⇒ 呼叫端釋放認領、下一輪再試, 不寄。 */
  | { kind: 'unavailable' };

export interface IPartiallyCancelledEmailContext {
  loadCurrent(input: { orderId: string }): Promise<LoadPartiallyCancelledCurrentResult>;
}
