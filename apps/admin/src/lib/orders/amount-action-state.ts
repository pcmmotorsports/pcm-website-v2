// amount-action-state.ts — 改品項金額的**導頁結果碼**單一真相(M-4b E10 #13 片1c-2)。
//
// 🔴 **為什麼不放在 `amount-actions.ts` 裡**:那支是 `'use server'`,
//    而 `'use server'` 檔案**只能匯出 async function** —— 匯出一顆 const 會讓 build 紅。
//    ⇒ 照既有先例分檔:`procurement-action-state.ts` / `cancel-action-state.ts` / `note-action-state.ts`
//    都是同一個形狀(action 在 `*-actions.ts`、碼與型別在 `*-action-state.ts`)。
//
// 🔴🔴 **為什麼這一顆要 namespace,而 saved/noop/conflict/invalid/denied 不要**
//
// `?r=` 是**全 admin 共用的一個 query 參數**,`result-banner.tsx` 的 `MESSAGES` 是**一張共用表**
// ⚠️ **那張表的消費端有幾個,三個數字都被講過,而它們數的不是同一種東西**(R3/fable F6 打出來的):
//   `grep -rln "result-banner" … | grep -v .test`  ⇒ **19** ← 🔴 檔名出現在【註解】裡也算,不是 import
//   `grep -rn "from '.*result-banner'" …`          ⇒ **9**  ← 真的 import 邊,但含 `settings-result-banner`(另一張表)
//   只數本表(`orders/result-banner`)              ⇒ **5** ← 🔴 **本表真正的消費端**
// ⇒ **本檔採 5。** 先前寫的 18 是最寬那個口徑,**它把註解算成了 import**。
// 📌 那個 18 是主視窗先講、我照收轉述的 —— **兩個人講過而只有一次來源。**
// 取消線踩過同一個坑,解法逐字寫在 `result-banner.tsx:120-123`:
// 「失敗碼一律 namespaced …`invalid`/`denied`/`error` **已被改單線佔走** ——
//   取消線送裸 `invalid` **會讓員工看到改單的「未儲存」**」。
//
// **本線的取捨(⚠️ 這一半是【判斷】,不是先例規定的)**:
// - **只有這一顆 namespace** —— 改金額的失敗需要一句**不同的**話:
//   裸 `error` 是「儲存失敗,請稍後再試或聯絡系統維護。」,
//   而改金額最常見的失敗是**業務上不允許**(已收款 / 有折扣)⇒ **重試沒有用**,那句話會把人導錯方向。
// - `saved` / `noop` / `conflict` **維持裸碼** —— 三則既有文案對改金額**剛好也對**,為整齊多造三顆是純成本。
// - `invalid` / `denied` **也維持裸碼** —— 同上;而且它們導去 `/orders`,
//   若 namespace 了卻沒登錄進 `MESSAGES`,員工會**什麼提示都看不到** —— 那比共用文案更糟。
// 🔴 **⇒ 只有語意真的不同的那一顆才 namespace。**
//   下一個做別條線的人:**這半是判斷;先例只規定「別送裸碼去搶別人的文案」。**

/**
 * 改金額失敗的導頁碼。
 *
 * 🔴 **單一真相**:`amount-actions.ts`(送)、`result-banner.tsx`(登錄文案)、
 * 測試(比對鍵集合)三邊都 import 這一顆。
 * 兩邊各打一次字面,正是 `cancel-action-state.ts` 那段 docstring 在避的「靜默 typo」。
 */
export const ORDER_AMOUNT_ERROR_RESULT_CODE = 'order_amount_error';

/**
 * 🔴 **RPC 以 `P2C13` 拒絕**時的導頁碼(codex 關卡2 R1 must-fix 折出來的第二顆)。
 *
 * 🔴🔴 **不要把它讀成「業務拒絕」** —— 第一版就是那樣命名與寫文案的,而 **R3(fable)證明那是假的**:
 * `P2C13` 在那支 migration 出現 **15 次**(`grep -c "P2C13" <該檔>`;全 repo 只有這一支用它,分母 1),
 * 其中 **執行期到得了客戶端的是 9 條,不是 7 條**:
 * - 7 條是業務拒絕(零元原因 ×2 / 已收款 / 折扣 / 溢位 ×3);
 * - 🔴 **`:220` `pcm_e13_subtotal_matches_lines` = 跨列不變式違反 ⇒ 【資料損壞】**;
 * - 🔴 **`:276` `pcm_e13_guard_unknown_table` = trigger 掛到未登記的表 ⇒ 【設定錯誤】**。
 * (其餘 6 次在檔尾 `DO` 區塊,apply 時跑、到不了客戶端。)
 * ⚠️ 而那兩條**在本 RPC 自己的交易 commit 時就可能觸發**(constraint trigger 掛在 `:314-321`,
 * 而本 RPC 每次都改 `line_total` 與 `subtotal`)。
 *
 * ⇒ **文案不得宣稱「是業務上的問題」** —— 那正是 R1 must-fix 折掉的形狀
 * (**系統故障穿業務拒絕的衣服**)在下一層又長回來。
 *
 * **R1 打中的是**:第一版把**所有**例外都導向同一顆,而那句文案說「請確認是否已收款或已有折扣」
 * ⇒ **DB 斷線 / RPC timeout 也會讓員工看到那句話,然後往錯的方向查。**
 * 🔴 **把系統故障說成訂單狀態問題,比不說更傷。**
 *
 * ✅ **而現在分得開了,靠的是量測不是猜**:E 窗 2026-08-16 實測
 * **`P2C13` 逐字出現在 `error.code`**(`#518` Q1)。
 * 🔴 **`#518`(2026-08-16)之後條件變了**:不再是 `code === 'P2C13'`,
 * 而是 **`code === 'P2C13'` 且 `details` 落在白名單七條之內**
 * (`amount-reject-set.ts` 的 {@link isOrderAmountBusinessRejection});其餘一律走
 * {@link ORDER_AMOUNT_ERROR_RESULT_CODE}。
 * **理由**:同一個 `P2C13` 底下有兩條**不是**業務拒絕(資料損壞 / 設定錯誤,住在別的函式)——
 * 只看 `code` 會把資料損壞講成「請確認你的輸入」。
 *
 * ⚠️ **它仍然只分得出「業務拒絕」與「其他」,畫面上不分是七條裡的哪一條** ——
 * 那七條現在**技術上**分得出來了(`details` 有值),但文案要不要細分是另一個決定,本片沒做。
 */
export const ORDER_AMOUNT_REJECTED_RESULT_CODE = 'order_amount_rejected';

/**
 * 系統故障(**不是**業務拒絕)時的文案。
 * 🔴 這句要能涵蓋「我們也不知道發生什麼事」—— 不得暗示是訂單狀態的問題。
 */
export const ORDER_AMOUNT_ERROR_MESSAGE_GENERIC =
  '儲存失敗,這次沒有改到任何金額。請稍後再試一次;若持續失敗請聯絡系統維護。';

/**
 * 🔴 這句文案**刻意不說是哪一條**。
 *
 * RPC 有 16 種 `RAISE`,其中七條帶具名 `CONSTRAINT`(已收款 / 有折扣 / 溢位 …),
 * 而**它們共用同一個 `P2C13`** ⇒ 光有 code 分不出是哪一條。
 *
 * 🔴 **2026-08-16 E 窗實測(`#518`),兩題都有答案了**:
 * - ✅ `P2C13` **逐字會出現在** `error.code`。
 * - 🔴 **`constraint` 欄【永遠不會】出現** —— 兩層獨立確認:
 *   ① PostgREST 的 error body **只有四鍵**(有宣告 `CONSTRAINT` 與沒宣告的兩發**鍵集完全相同**);
 *   ② `postgrest-js` 的型別只宣告 `details` / `hint` / `code`,而它是 `JSON.parse(body)` 原樣搬、零轉換。
 * ⇒ **「拿 `constraint` 來分派」這條路是死的,不要再去試。**
 *
 * ⇒ 本句**涵蓋七條全部,因為它不宣稱是哪一條** —— 零 mapping、零猜測,而員工拿得到下一步。
 *
 * 🔴🔴 **第一版寫「請確認是否已收款或已有折扣」,而那句仍然在猜**(codex 關卡2 **R2** must-fix):
 * `P2C13` 底下那七條**不全是訂單狀態問題** —— 其中三條是**金額本身**
 * (`line_total` 溢位 / 改後 total 為負 / `subtotal`·`total` 溢位)。
 * ⇒ 員工改一個會溢位的價,畫面卻叫他去查收款與折扣 ⇒ **往錯的方向查。**
 * 🔴 **「涵蓋七條」與「列舉可能原因」是兩件事** —— 我第一版寫了後者還以為自己在做前者。
 * ⇒ 現在的版本**同時提訂單狀態與輸入金額,兩邊都不斷言**。
 * ⚠️ **不得再退回任何含具體判定的版本**(例:「因為已收款」),
 * 也**不得只提其中一邊** —— 猜錯會讓員工照著錯提示做錯事,而**錯誤文案比沒有文案更傷**。
 *
 * 🔴🔴 **R3 再加一層(fable,2026-08-16)**:上一版**只提訂單狀態與輸入金額**,
 * 而 `P2C13` 底下**還有兩條根本不是員工能處理的**(資料損壞 / 設定錯誤,見本檔上方)。
 * ⇒ 尾句補「**若都沒問題或反覆出現,請找主管或系統維護**」——
 * **那句是給那兩條的出口**,不是客套話。
 * 🔴 **判別句**:這句話要能讓「**做什麼都不會成功**」的員工**停下來找人**,而不是一直重試。
 *
 * ✅ **`#518` 已於 2026-08-16 做掉了**(下面這段留著是因為它記錄了當初的判斷依據)。
 * 🔴🔴 **升級的路**:E 窗實測 **`DETAIL` / `HINT` 逐字到得了客戶端**
 * (`RAISE … USING ERRCODE='P2C13', DETAIL='pcm_e13_no_edit_after_payment'`
 *  ⇒ body 的 `details` 就是那個字串)。
 * ⇒ **解鎖形狀 = 七條 `RAISE` 各加一行 `DETAIL='<同名字串>'`,應用層以 `error.details` 分派。**
 * ✅ **已實作**:migration `20260816040000_m4b_e10_13_518_p2c13_detail.sql` + `amount-reject-set.ts`。
 *    A 窗 2026-08-16 另用真 PostgREST 補測到一件 E 窗沒講的:
 *    **`constraint` 欄根本不在 JSON 裡**(只有 code/details/hint/message)——
 *    所以「拿到 `constraint` 欄」那條路是走不通的,只有 `DETAIL` 走得通。
 * ⚠️ **本段原本寫「那要動 migration ⇒ 是另一片,不在這裡順手做」—— 那一片就是 `#518`,已完成。**
 * ⚠️ E 窗自己標的兩條誠實邊界一併帶著:
 *   ①**正式站 Supabase 的 PostgREST 版本沒查**,四鍵 schema 是它的印象、不是量到的 ⇒ 上線前對正式站打一次同款 probe;
 *   ②**`DETAIL` 過長 / 換行 / 非 ASCII 會不會被截斷或轉義沒測** —— 只證了純 ASCII 短字串。
 */
export const ORDER_AMOUNT_REJECTED_MESSAGE =
  '無法修改金額,這次沒有改到任何資料。請確認訂單狀態與輸入金額;' +
  '若都沒問題或反覆出現,請找主管或系統維護。';
