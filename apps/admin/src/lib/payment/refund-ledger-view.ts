// 🔴 **`import type` 不是風格, 是必要的**:`refund-correction-read.ts` 檔頭第一行是
//    `import 'server-only'` ⇒ 用值匯入會把它拖進來, 而本檔被 client component 吃得到。
//    `import type` 在編譯期被抹掉 ⇒ 零 runtime 相依, 而型別仍然綁在同一個來源上
//    (不自己重打一份 `'money_moved' | 'no_money_moved'` —— 那就是第二份、會漂)。
import type { CorrectedTo } from './refund-correction-read';

// refund-ledger-view.ts — M-3 A7c RW3:退款帳本「顯示層」純函式(零 IO;供訂單頁帳本區塊
// 與異常清單頁共用字面 —— 兩處各養一份 label 就是下一個漂移點)。
//
// 🔴🔴 措辭鐵律(關卡1 codex F25 + remaining 函式 COMMENT 逐字):
//    `pcm_order_refundable_remaining` 只反映**本系統帳本**(processing+confirmed 佔額),
//    Sean 直接在 TapPay Portal 退的錢完全不在其中 ⇒ 真實剩餘可退額 ≤ 此值。
//    UI 措辭必須是「**帳本未登記額**」,**不得**寫「還能退」「剩餘可退」——
//    值班照著錯的名字按下去 = 同一筆錢退兩次。測試對這條掛負向格。

/** 帳本列狀態 → 員工字面(語意=值班該做什麼,不是技術狀態名)。 */
export const REFUND_STATUS_LABEL: Record<string, string> = {
  processing: '處理中(勿重複發起)',
  // 🏁 **2026-08-14 換口徑(Sean 在正式站退了兩筆真錢之後回報)**:舊字面是
  //    「已受理(不等於已入帳,入帳以對帳為準)」。理由不是措辭偏好,是**我們手上已經有憑證**——
  //    `supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:337-339` 的 UPDATE 守門
  //    **本體**(`IF NEW.status = 'confirmed' AND NEW.tappay_refund_id IS NULL THEN RAISE`,
  //    `ERRCODE = 'P7C09'`、constraint `a7c_confirm_requires_tappay_refund_id`)
  //    ⇒ **能走到 `confirmed` 的列必然帶著 TapPay 退款憑證**
  //    (**結構保證**,不是「那兩筆剛好有」的歸納)。把已知的事寫成未知 = 員工以為還要再追一次。
  //    ⚠️ 括號那句**不准寫死鐘點**:入帳依各家銀行而定,寫死一個時間就是對員工說謊。
  //    ⚠️ **只換這一態** —— 下一行 `processing` 的「已受理」是準確的,一個字都不要動。
  confirmed: '退款完成(客人入帳時間依照各家銀行而定)',
  deferred: '尚未請款、本筆已作廢(請款完成後可重新發起)',
  failed: '失敗(錢沒有動)',
};

/** failed_reason 機器碼 → 員工字面(值域=RPC G6 allowlist;未知碼原樣顯示、不猜)。 */
export const REFUND_FAILED_REASON_LABEL: Record<string, string> = {
  rejected_out_of_range: 'TapPay 拒絕:金額超出可退範圍(先對帳再重新發起)',
  not_sent: '請求未送出(參數未通過檢查)',
  // 🔴 措辭刻意寫成「**人工判定為**」而不是「錢沒有動」(#473b-2 兩關同抓):
  //    另兩碼是結構保證(`not_sent`=根本沒送出、`rejected_out_of_range`=TapPay 當場拒絕),
  //    **本碼是人看 Record 數字下的判斷、可能判錯** —— 而 `#473` 的整個存在前提就是它會錯。
  //    把待查的判定寫成金流事實,員工就不會再去追 TapPay。
  manual_failed: '人工判定為沒有動到錢(RW4 對帳結案;這是人工判定,不是系統確認)',
};

/** 狀態字面(未知狀態=S6 allowlist 之外的未來值,原樣顯示——顯示層不猜語意)。
 *  Object.hasOwn:值域雖受 DB CHECK 限制,`obj[key]` 吃原型鏈是本 repo 記過的同型事故
 *  (result-banner 曾六頁中招、2026-08-06 #332-2 已全數硬化,
 *  memory reference_js-index-lookup-hits-prototype-chain 有時間軸)。 */
export function refundStatusLabel(status: string): string {
  return Object.hasOwn(REFUND_STATUS_LABEL, status) ? REFUND_STATUS_LABEL[status]! : status;
}

/**
 * 狀態欄字面 **跟著人工判定的更正走**(板 `:638` ⟦b9-VERDICT2LINE⟧;Sean 2026-08-30 拍【甲】,
 * 逐字「退款異常那頁:狀態欄跟著更正走」)。
 *
 * 🔴🔴 **它修的是一個【只有開畫面才看得到】的矛盾**:那一頁的「狀態」欄讀的是**原始那一列**
 *    (`refundStatusLabel('failed')` ⇒ 「失敗(錢沒有動)」), 而它**正下方**的更正區塊讀的是
 *    **有效判定**(`refund-verdict-correction.tsx:61-63` ⇒ 「現行判定是『錢有動』」)
 *    ⇒ **員工同時看到兩行相反的話。**
 *    📌 而那個矛盾在 diff 上看不出來、單元測試也不會紅 —— 兩邊各自都是對的,
 *       **錯的是它們並排在一起**, 而沒有任何一支檔同時看得到兩邊。
 *
 * 🔴 **為什麼收成一支函式**:這樣「狀態欄要說什麼」與「更正區塊要說什麼」**吃同一個輸入**
 *    ⇒ 它們**沒有各自的版本可以漂走**。兩邊寫得一樣不算, 要的是沒有第二份。
 *
 * 🛑 **`失敗` 那兩個字不動, 只換括號裡那句。** 帳本上那一列的 `status` **仍然是 `failed`**
 *    —— 那是金流事實(這筆退款請求沒有成功), 而更正改的是**「錢有沒有動」這個人工判定**。
 *    ⇒ 把 `失敗` 改成別的字 = 用一個顯示層的更正去覆寫帳本狀態, 那是另一件事、要另一個板。
 *
 * 🔴🔴 **三態, 不是兩態**(codex 對抗審查 2026-08-30 must-fix):
 *    ⛔ ~~我第一版把「沒有更正紀錄」與「讀不到更正」都收成 `null`, 兩者都退回原始字面,
 *       並宣稱「讀不到那一種由畫面上的另一段負責講」。~~
 *    🔴 **codex 的反駁成立, 逐字**:「更正查詢失敗、實際已有 `money_moved` 更正 ⇒ 狀態仍斷言
 *       『錢沒有動』;**下方『讀不到』不能抵銷這個錯誤金流結論**。」
 *    ⇒ 📌 **那句 fallback 在【表格下面】, 而狀態欄在【表格裡】** —— 掃欄位的人不會往下看,
 *       而他掃到的是一句**我們此刻無法確認的金流斷言**。
 *    ⇒ ⇒ **「我們不知道」與「錢沒有動」是兩件事, 而只有前者是真的。**
 *    ✅ ⇒ `'unreadable'` 獨立一態:**不講錢, 只講我們讀不到。**
 *
 * ⚠️ 而 `null`(= 真的沒有更正紀錄)仍然退回原始字面 —— 那時「錢沒有動」是**帳本上最後一筆
 *    人工判定**, 它是有依據的。**兩者的差別不是保守程度, 是有沒有依據。**
 */
export function refundStatusLabelWithCorrection(
  status: string,
  corrected: CorrectedTo | null | 'unreadable',
): string {
  const base = refundStatusLabel(status);
  // 🔴 讀不到 ⇒ **不對錢下任何斷言**。只對 `failed` 換字面(其餘態的括號裡沒有金流宣稱)。
  if (corrected === 'unreadable') return status === 'failed' ? '失敗(更正紀錄讀不到)' : base;
  if (corrected === null) return base;
  // 🔴 只對 `failed` 生效。更正紀錄今天只存在於卡住的列(`isStuckManualVerdict` = status `failed`
  //    且 `failedReason === 'manual_failed'`), 而**萬一將來別的態也帶著更正進來, 這裡不發明字面**
  //    ⇒ 退回原始標籤, 讓它看起來「沒被處理」而不是「被我猜了一個」。
  if (status !== 'failed') return base;
  return corrected === 'money_moved' ? '失敗(已更正:錢有動)' : '失敗(已更正:錢沒有動)';
}

export function refundFailedReasonLabel(reason: string | null): string | null {
  if (reason === null) return null;
  return Object.hasOwn(REFUND_FAILED_REASON_LABEL, reason)
    ? REFUND_FAILED_REASON_LABEL[reason]!
    : reason;
}

/**
 * 異常滯留閾值(plan §4-1 逐字:30 分 = 保守異常閾;同步流程正常 = 秒級)。
 * 🔴 異常清單頁的 DB 查詢(**可處理那支**)與訂單頁的列級警示都吃本常數 —— 兩處各寫一個 30 就會漂。
 * ⚠️ 「卡住」那半(`isStuckManualVerdict`)**不吃本常數**:它與滯留時間無關,改本值不影響它。
 */
export const REFUND_EXCEPTION_STALL_MS = 30 * 60 * 1000;

/**
 * 「卡住的人工判定列」的機器碼(backlog `#473`)。
 * 🔴 DB 側權威 = `20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:760` 的
 *    `SET status='failed', failed_reason='manual_failed'`(RW4 出口);
 *    `failed_reason` 的值域 = 同檔 `:181`(該欄 COMMENT 逐字列出三碼:
 *    `rejected_out_of_range` / `not_sent` / `manual_failed`)。
 *    ⚠️ 兩關都提了「值域權威應該是 `:656`/`:809` 的 allowlist」—— **開檔核過:那是 `outcome`
 *       參數的 6 碼 allowlist,不是 `failed_reason` 的值域**,兩者是不同的東西(`outcome` 還含
 *       `accepted` / `deferred_not_captured` / `recovered_confirmed`)。⇒ 此條**不採納**,維持 `:181`。
 * 🔴 **字面只寫一次**:異常清單的查詢述詞與顯示判定共用本常數 ——
 *    上面 `REFUND_FAILED_REASON_LABEL` 的 key 是**顯示字典**、不是述詞來源,兩者不得互相當真相。
 */
export const STUCK_MANUAL_VERDICT_FAILED_REASON = 'manual_failed';

/**
 * 這列是否為「已結案、但判定本身沒有更正入口」的卡住列(backlog `#473`)。
 *
 * 🔴 **與 `isRefundException` 是兩個判準,刻意不合併**:
 *  - `isRefundException` 鏡射的是 **RW4 動作閘**(`refund-recovery-actions.ts:87` 只吃 `processing`)——
 *    它回 true 代表「這列可以按對帳判定」。
 *  - 本函式回 true 代表「這列**沒有任何動作可按**,但員工仍必須看得見它」。
 *  把兩者併成一個 boolean 會讓畫面對這兩種列長得一樣 —— 而它們該做的事完全相反。
 * ⚠️ 本函式**不代表出口存在** —— **更正入口到今天仍然不存在**。
 *    已做的只有「看得見」兩片(`#473b-2` 清單 + `#483` 訂單頁徽章);
 *    真正的出口是 `473b-1`(新 RPC),**尚未實作、plan 等 Sean 批**。
 *    (命名易混:`#473b-2` 已 commit ≠ 出口做好了。)
 */
export function isStuckManualVerdict(row: {
  status: string;
  failedReason: string | null;
}): boolean {
  return row.status === 'failed' && row.failedReason === STUCK_MANUAL_VERDICT_FAILED_REASON;
}

/**
 * 這一列的「卡住判定」**今天還擋不擋得住退款入口**(`#890` 片4,Sean 2026-08-30 拍板做 (b))。
 *
 * ── 為什麼可以放行,而放行的只有一種世界 ────────────────────────────
 * 🔴 **這一段被 codex R1 訂正過兩次,兩次的錯法不同,兩個舊版都留著。**
 *
 * ⛔ ~~第一版:寫成「`money_moved` 時視同不 stuck」~~ —— **方向反了**,
 *    而它反在**會放行超額退款的那一側**。留著,因為下一個人會在同一個位置犯它。
 *
 * ⛔ ~~第二版:「`failed` 列不扣額 ⇒ `money_moved` 那種餘額被高估 ⇒ 擋」~~ ——
 *    **字面是假的**:`pcm_order_refundable_remaining`(`20260820100000:231-248`)
 *    **第二段就是**「join 更正 view、扣掉 `corrected_to='money_moved'` 的 failed 列」
 *    ⇒ 那一種 **DB 本來就扣了**,沒有被高估。我當時只讀到 `:240` 就停了。
 *    📌 **一個只讀了一半的算式,推出來的結論會【剛好合理】—— 那正是沒有人回頭查的那一種。**
 *
 * ✅ **現行理由(逐格可查)**:
 * ```
 * no_money_moved ⇒ 錢沒動 ⇒ DB 不扣它是對的、額度是實的        ⇒ 放行
 * money_moved    ⇒ 錢已經退出去了 ⇒ 再退一次就是【第二次付款】 ⇒ 擋
 *                   (DB 有扣它,所以這一格不是「怕算錯」,是「不該再退」)
 * 未更正         ⇒ 那個判定沒有人擔保 ⇒ 維持現況                ⇒ 擋
 * 讀不到         ⇒ 我們瞎了                                    ⇒ 擋
 * ```
 * 🔴 **擋與放行的判準不是「算得準不準」,是【那筆錢到底動了沒有】**,
 *    而那件事今天唯一的來源就是人工判定 —— 這支函式只負責問「有沒有人擔保過它」。
 *
 * ── 三態預設關 ─────────────────────────────────────────────
 * ```
 * no_money_moved  ⇒ 放行(唯一放行的世界)
 * money_moved     ⇒ 擋  —— **那筆錢已經退出去了,再退一次是第二次付款**
 * (⚠️ 不是「怕算錯」:DB 那支算式的第二段**有扣**它,見上面訂正段)
 * 未更正(不在 Map)⇒ 擋  —— 維持現況,不改變任何既有行為
 * 讀不到(`null`) ⇒ 擋  —— fail-closed;而它與「未更正」**必須分得出來**
 * ```
 * ⚠️⚠️ **殘餘風險,明寫不掩蓋(codex R1 逼出來的,兩格)**:
 *  ① `no_money_moved` 仍然是**人工判定**(本檔檔頭逐字「這是人工判定,不是系統確認」)。
 *     ⇒ 本片把「一個沒有依據的判定」換成「一個有人具名、有理由、有時間戳的判定」,
 *       **不是換成事實**。
 *  ② 🔴 **本地沒有金額上限這道閘** —— `refund-repository.ts:18-22` 逐字
 *     「`REFUND_EXCEEDS_REMAINING` 由 **445b** 建立,**今天庫裡那支 RPC 還不會吐它**」。
 *     ⇒ 今天的金額上界是 **TapPay 自己的帳**(`refund-baseline.ts:32` 的 Record `amount`)。
 *     🔴 **而它只蓋卡片那一渠道**(R3 consider-1):同一張單若也登記過非卡退款,
 *        TapPay 看不到那一筆 ⇒ 卡退 + 匯退**加起來可以超過訂單總額**,而沒有東西會響。
 *        那是既有的 `445b` 缺口、與本片無關 —— 但**不得**把它講成「已經有上界了」。
 *  ⇒ 🛑 **這兩格都【不是我自己接受的】** —— 已列給 Sean,他說了才算(R6)。
 */
export function isBlockingStuckVerdict(
  row: { id: string; status: string; failedReason: string | null },
  verdicts: ReadonlyMap<string, { correctedTo: string }> | null,
): boolean {
  if (!isStuckManualVerdict(row)) return false;
  // 🔴 `null` = 讀不到 ⇒ 擋。**不得**寫成 `verdicts?.get(...)` 然後讓 undefined 兩種世界合流:
  //    「讀不到」與「這一列沒被更正過」在那之後就分不出來了,而它們該不該擋的理由不同
  //    (前者是我們瞎了,後者是現況維持)—— 今天答案剛好都是「擋」,而理由不同的兩件事
  //    合成一個判斷,下一次其中一邊要改的時候會把另一邊一起改掉。
  if (verdicts === null) return true;
  const effective = verdicts.get(row.id);
  if (effective === undefined) return true;
  return effective.correctedTo !== 'no_money_moved';
}

/**
 * 「已經有人判定過」的筆數 —— 側欄/首頁那顆數字與清單頁灰字那一行的**唯一述詞**
 * (Sean 2026-08-30 拍【甲】,逐字:「應該變成尚未處理(尚未判定)才在上面」;
 *  晚於 2026-08-22 那板、推翻它)。
 *
 * 🔴 **①類(`processing` 那半)即使出現在 Map 裡也不算** —— 它們沒有「判定」這回事,
 *    更正表只服務②類(`20260814190000:2` 逐字:更正的對象是 `order_refunds` 的 `manual_failed`)。
 *    ⇒ 所以「待處理 = 總數 − 本函式」既不是「只數①」也不是「只數②」。
 *
 * 🔴 **為什麼住在本檔、不住在 `refund-read.ts`**(2026-08-30,踩到才搬):
 *    它第一版寫在那支,而那支第一行是 `import 'server-only'` ⇒
 *    `refund-exceptions/page.test.tsx` 用 `importOriginal` 拿它時**整支測試檔載入失敗**,
 *    而症狀是**檔紅、0 格紅**(`Tests 142 passed / 0 failed`,而測項總數從 157 少了 15)——
 *    只有「連跑兩發比檔數與測項數」那一格看得出來。
 *    ⇒ 📌 **純函式不要住在有 IO 的模組裡** —— 那會讓「想用它」等於「要連 IO 一起扛」。
 */
export function countDecidedExceptions(
  rows: readonly { id: string; status: string; failedReason: string | null }[],
  verdicts: ReadonlyMap<string, unknown>,
): number {
  return rows.filter((row) => isStuckManualVerdict(row) && verdicts.has(row.id)).length;
}

/**
 * 這列是否屬於異常清單的**可處理**那半(plan §4-1):processing 且(滯留逾閾 或 已有受理證據)。
 * 🔴 evidence 非空 = G7-hold(TapPay 已受理但金額不符)= **當下已知異常、不等 30 分**(fable N4)。
 * ⚠️ 清單的**成員資格**已不等於本函式 —— `isStuckManualVerdict` 那半也會進清單(`#473`)。
 *    本函式維持 processing-only 是刻意的:它鏡射動作閘,不是清單述詞。
 */
export function isRefundException(
  row: { status: string; createdAt: string; providerEvidence: string | null },
  nowMs: number,
): boolean {
  if (row.status !== 'processing') return false;
  if (row.providerEvidence !== null) return true;
  const created = Date.parse(row.createdAt);
  // 時間戳解析不出來 = 資料異常;fail-closed 進清單讓人看,不靜默藏起來。
  if (Number.isNaN(created)) return true;
  return nowMs - created > REFUND_EXCEPTION_STALL_MS;
}
