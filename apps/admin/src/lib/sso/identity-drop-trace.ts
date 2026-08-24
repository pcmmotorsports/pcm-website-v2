// identity-drop-trace.ts — `#215`/B5 身分鏈:**「上游送了身分,而我們把它丟了」的可觀測形態。**
//
// ── 🔴 為什麼是這個形狀(2026-08-23,`launch-todo` 那條「兩顆 fuse 守不到上游」)──────
// 既有兩顆 fuse(~~`b5-identity-wiring-trigger`~~ **2026-08-24 已隨 B5-a 退場刪除**,
//   原文 `git show 952c0c42:apps/admin/src/lib/session/b5-identity-wiring-trigger.test.ts` / `login-event-identity-drop-fuse` **仍在**)
// 斷言的是**結構**:某個欄在不在原始碼裡。
// ⇒ 它們的觸發條件是「**我們自己做到一半**」(payload 已加欄而 actor 沒換 / insert 已加鍵而表沒欄)。
// 🔴 **而真正會發生的世界是相反的:我們【根本沒開始】,而上游已經在送。**
//    那個世界裡兩顆 fuse 的訊號 A 恆假 ⇒ **它們一聲都不會叫。**
//    📏 而那不是假設:`lib/sso/exchange.ts` 已經在解析、清洗、回傳 `sub`
//       (`sanitizeSub` → `return … { amr, auth_time, sub }`),
//       而 `api/sso/callback/route.ts` 沒有把它帶進 session 或 login event。
//       ⇒ 報價單 B3/B4 上線的那一刻,`sub` 會進來、被丟掉,而沒有任何東西會響。
//
// ── 🔴 本檔的契約(這是一個【中間契約】,主視窗 2026-08-23 裁定)────────────────
//   **不要求「立刻接好」,要求「不准安靜地丟」。**
//   · 上游沒送 `sub`                     ⇒ 無事(今天的每一次登入)
//   · 上游送了、而我們沒帶下去           ⇒ **留下一行指名 `sub` 的痕**
//   · 上游送了、而我們帶下去了(B5-a 之後)⇒ 又變回無事,**不用有人回來刪它**
//   🔴 最後那一條是刻意的:一道「做完之後會永遠紅著」的閘,與一道「今天做不完的紅」是同一個病,
//      只是發作時間不同。**本函式從實際送出去的 payload 推,所以它會自己退場。**
//
// ── 🔴🔴 「會自己退場」**靠一個前提,而那個前提在這裡,不在任何人的記憶裡** ─────────
//   **前提**:B5-a 把 `sub` 加進呼叫端**傳給本函式的那兩個物件本身**。
//   ⚠️ **它不成立的那條路是具體的**:若 B5-a 改成在 `recordSsoLogin` **內部**補身分
//      (讓 `login-event.ts` 的 insert 自己去讀),那 `admin_sso_login_events` 這個 carrier
//      **永遠不帶** ⇒ **每次登入都印、永不退場** ⇒ 它就變成它自己要防的那種噪音。
//   ⇒ **那時候的處置是把那個 carrier 換成 insert 實際送出去的物件**,不是刪掉這道守門。
//   📌 而這一段存在的理由:**「它會自己消失」這個宣稱,本身就是一個沒被驗過的到期條件** ——
//      而它比普通的到期條件更危險,因為**它讓人不必再想這件事**。
//
// ── ⚠️ 證據等級(這一格今天【構造不出來】,寫在這裡免得被讀成已驗)─────────────
//   世界③(上游送了 `sub` **而我們接好了** ⇒ 安靜)**只在單元層驗過**
//   (`identity-drop-trace.test.ts`)。**真 route 上零證據** ——
//   `lib/session/session.ts` 的 `AdminSessionPayload` 今天沒有 `sub` 這個欄、
//   `buildAdminSession` 不可能產出它 ⇒ 在 route 層構造不出那個世界。
//   🔴 **而世界③ 正是「會自己退場」的唯一支撐** ⇒ B5-a 落地那天,**要在真 route 上補那一格**。
//
// ⚠️ **它守不到的**:只看「payload 裡有沒有身分鍵」,**不驗那個值對不對**
//    (帶了一個錯的 `sub` 下去,本函式會安靜)。那是 B5-a 自己的驗收。
//
// ── 🔴 **這一行【今天沒有人在讀】(R3 2026-08-24 量,而它更正了我的敘述)** ────────
//   📏 `grep -rl "Sentry\|alertOn\|logDrain\|告警" apps/admin/src` ⇒ 3 支,**沒有一支是告警接線**;
//      `grep -rl "console\."` ⇒ **44 支在寫**。
//   ⇒ **本檔的價值不是「會被偵測到」,是「出事之後【查得到】」。**
//      ~~上線那一刻沒有任何東西會響~~ —— 加了這一行之後**仍然沒有任何東西會響**。
//      🔴 **敘述不得寫成「會被偵測到」** —— 那會讓人以為有人在看。
//      ✅ 而它仍是真進步:把「查得到」從**不可能**變成**可能**。
//
// ── ⏳ **失效條件(F6 nit;寫在這裡免得它變成下一個沒人知道還要不要留的守門)**────
//   **B5-a 落地(`sub` 真的被帶進 session 與 login event)之後,本檔連同它的測試退場。**
//   🔴 而退場的判準不是「B5-a 說做完了」,是**世界③ 在真 route 上驗得起來**
//      (今天驗不起來,因為 `AdminSessionPayload` 沒有 `sub` 欄 —— 見上面那段證據等級)。
//   ⇒ 那一天請**先補上真 route 的世界③**,綠了再刪本檔。

/** 一個「本來應該帶著身分走」的載體:名字給人看,payload 給機器看。 */
export type IdentityCarrier = {
  /** 出現在日誌裡的名字,要讓值班看得懂是哪一本帳。 */
  readonly name: string;
  /**
   * 我們**實際**送出去的那個物件(不是型別、不是原始碼)。
   * ⚠️ 型別寫 `object` 而不是 `Record<string, unknown>`:`AdminSessionPayload` 是 **interface**,
   *    沒有隱式索引簽章 ⇒ 指定成 Record 會 `TS2322`(2026-08-23 實測撞到)。
   */
  readonly payload: object;
  /**
   * 🔴 **這本帳自己的欄名。**(codex 2026-08-23 must-fix 3)
   *
   * 舊版只問「`sub` 或 `staff_id` **任一個**在不在」⇒ **兩欄放反也會被判成「都接好了」**:
   * session 拿到 `staff_id`、login event 拿到 `sub` ⇒ 兩個 carrier 都安靜,而**兩邊的欄位都是錯的**。
   * ⇒ 判準改成「**這本帳有沒有【它自己那個】欄**」,不是「有沒有身分味道的東西」。
   */
  readonly identityKey: string;
};

/** 這本帳有沒有帶著【它自己那個】身分欄。 */
function carriesIdentity(carrier: IdentityCarrier): boolean {
  // 🔴 **codex R5 must-fix 4**:舊寫法是 `!== undefined` ⇒ **`null` 會被判成「已帶到」**
  //    ⇒ 函式安靜退場,而簽出去的 session **仍然沒有可用身分**。
  //    📌 **`null` 是「帶到了一個空的」,不是「帶到了」** —— 兩態不夠,`undefined`/`null`/有值是三態。
  //    ⚠️ 空字串同理:`''` 不是一個可用的身分。
  const v = (carrier.payload as Record<string, unknown>)[carrier.identityKey];
  return v !== undefined && v !== null && v !== '';
}

/**
 * 上游送了身分而我們丟了 ⇒ 回一行要記進日誌的字;沒有丟 ⇒ 回 `null`。
 *
 * @param subFromUpstream `exchangeCode` 回傳的 `sub`。**上游沒送時是 `undefined`。**
 * @param carriers 我們實際送出去的載體。**要傳送出去的那個物件本身**,不要傳型別或原始碼 ——
 *   本函式會自己退場,靠的就是它看的是實際值。
 */
export function identityDropTrace(
  subFromUpstream: unknown,
  carriers: readonly IdentityCarrier[],
): string | null {
  // 上游沒送 ⇒ 沒有東西可以丟。**這是今天的每一次登入,它必須安靜。**
  if (subFromUpstream === undefined) return null;
  const dropped = carriers.filter((c) => !carriesIdentity(c)).map((c) => c.name);
  if (dropped.length === 0) return null; // 全部都帶到了 ⇒ 接好了 ⇒ 自己退場
  return (
    `[sso/callback] 🔴 上游送了 sub,而它沒有被帶進:${dropped.join('、')}。` +
    `⇒ 這次登入的身分被丟掉了,出事那天查不到是誰按的。修法見 B5-a(launch-todo「SSO 的 sub 被丟掉」)。`
  );
}
