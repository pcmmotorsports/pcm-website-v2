// audit-diff.ts — `#27` D1c-2b:把 `before` / `after` 兩坨 jsonb 變成「這次改了哪幾欄」。
//
// ── 🔴 設計判準(主視窗 2026-08-15,Sean 拍板 `Q-展開檢視 = 甲` 之後)────────────
//   > **Sean 說員工可以看,但那不表示可以隨便印。**
//   > **不需要出現的就不要出現 —— 不是因為敏感,是因為多餘的東西會讓真正要看的被淹掉。**
//
//   ⇒ 判準:**只顯示「這次操作實際改變的欄位」,每欄「舊 → 新」。沒變的欄一律不出現。**
//
// 🔴🔴 **理由選哪一個很重要,因為理由決定下一個人怎麼擴充它**(主視窗逐字):
//   · 用「**敏感所以不顯示**」當理由 ⇒ 下一個人會去爭論哪些欄算敏感,然後開始做遮罩
//     (而遮罩要能正確辨識「哪些欄是金額」—— **那是猜的**,猜錯的方向是「以為遮了其實沒遮」)
//   · 用「**沒變的不顯示**」當理由 ⇒ **下一個人加新欄位時自動就對了**
//   ⇒ **本檔採後者。** 同一個結果(少顯示東西)由兩個理由導出,而**只有一個會隨時間保持正確**。
//
// 🔴 **為什麼不是「只列欄名、不列值」**:稽核的用途是**追查**。
//   只知道「電話被改過」而不知道改成什麼,**查到一半還是要去問人 ⇒ 等於沒解決問題**;
//   而**舊值正是判斷這次改動對不對的唯一依據**(改錯人?改成別人的號碼?)。

/** 一個欄位的變動。`null` = 那一側沒有值(見 `display()` 的併記說明)。 */
export interface AuditFieldChange {
  readonly key: string;
  readonly from: string | null;
  readonly to: string | null;
}

/** 非陣列的純物件。`null` 在 JS 裡 `typeof` 也是 `'object'`,要單獨排除。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 值 → 顯示字串;**沒有值回 `null`**。
 *
 * ⚠️ **併記一個刻意的混同**:「**欄位不存在**」與「**欄位存在但值是 `null`**」**都回 `null`**。
 *   真實資料兩種都有(`20260804180000:253` 的 `cancelled_at` 就是明寫的 `NULL`;
 *   而 `staff-actions.ts:126` 新增員工時 `before` 整個不存在)。
 *   🔴 **對員工來說兩者都讀作「本來沒有」,分開顯示只會多一個他不需要的狀態** ——
 *   **這是刻意的取捨,不是沒想到。** 要分開的話得多一個顯示態,而那要有人真的需要才值得。
 *
 * 🔴 **巢狀物件走 `JSON.stringify`,不遞迴展開**:遞迴會把一個大物件攤成幾十列,
 *   **正好是「把真正要看的淹掉」**。⚠️ **代價明說**:巢狀物件裡只改一個欄位時,
 *   員工看到的是兩坨 JSON 自己對照。
 *
 * 🔴🔴 **這條限制「什麼時候會開始痛」—— 寫出來,否則沒有人會回來看**(E 窗 R1 must-fix)。
 *   **「已知限制」四個字讓它讀起來像被處置過了,而它只是被命名過。**
 *   **判別句:這條如果永遠沒人回來看,會有任何東西紅嗎?**
 *
 *   **當前狀態 = 不可達**(2026-08-15 實查,兩個獨立寫入端全部扁平純量):
 *     · `staff-repository.ts:4-9` 的 `StaffRow` = `id`/`label`/`is_manager`/`is_active` **4 個純量,零巢狀**
 *     · `20260804180000:253-254` = `jsonb_build_object('payment_status',…,'cancelled_at',…)` **純量**
 *   🔴 **巢狀有三條產生路徑,三條都要掃**(E 窗 R2 補;我原本只掃第一條):
 *     ① `jsonb_build_object` 內再包 `jsonb_build_object` ⇒ **0 命中**(正向對照 1)
 *     ② `to_jsonb(整列)` / `row_to_json` —— **一個 `jsonb_build_object` 都不用就能產生巢狀**
 *        ⇒ **稽核寫入端 0 命中**;量法見下方那條紀律
 *     ③ app 側送整個物件(`staff-actions.ts:126/191/277`)⇒ 送的是 `StaffRow`,**四個純量**
 *   ⚠️ **「`jsonb_build_object` 套 `jsonb_build_object`」只是巢狀最明顯的長相** ——
 *     **`to_jsonb(含 jsonb 欄的列)` 一樣是巢狀,而它長得完全不一樣。**
 *     🔴 **回頭重估的人請掃三條,不要照抄第一條 pattern。**
 *   ⚠️⚠️ **量法紀律(這裡差點出事)**:第二條先用**同一行** `grep` 得到 0 ——
 *     **而稽核 INSERT 是跨行的,同行比對看不到隔幾行的 `to_jsonb`。**
 *     改用**檔案層**比對(同時含稽核 INSERT 與 `to_jsonb` 的檔)⇒ 撈出 1 檔
 *     `20260812150000_m4b_e10_423_payment_audit.sql`,**開檔確認那處在註解裡**(講另一道守門的能力界線),
 *     實際 INSERT 仍是 `jsonb_build_object` 純量 ⇒ **結論不變,但先前那個 0 是量法給的,不是事實給的。**
 *   🔴 **回頭重估的觸發條件(今天就可以檢查,不是等某個人做某件事)**:
 *     **有任何寫入端開始送巢狀 payload 的那一天** —— 屆時員工會看到兩坨 JSON 自己對照,
 *     而**在那之前這條限制打不到任何真實資料、成本為零**。
 *   ⚠️ **所以現在不做遞迴不是偷懶,是它現在沒有讀者** —— 但**它會在上面那個條件成立時變成真的痛**。
 */
function display(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** 兩個值算不算「一樣」。用序列化比,物件才比得動(`{a:1} !== {a:1}`)。 */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * `before` / `after` → 變動清單。**只回真的變了的鍵。**
 *
 * 🔴 **輸入型別是 `unknown` 不是物件,而且不能爆** —— `before`/`after` 是**自由 jsonb**,
 *   每個寫入端形狀不同(實查:`20260804180000:253-254` 是窄快照、`staff-actions.ts:126`
 *   是整列 `StaffRow` 而 `before` 根本不存在)。
 *   ⚠️ **陣列 / 純量的寫入端我在 repo 內沒找到,但型別擋不住** ——
 *   **「我沒找到」不等於「不存在」** ⇒ 那條路要能走,不能爆(fail-safe,不是 over-engineering)。
 *
 * 四種形狀:兩邊都有 / 只有 `after`(新增)/ 只有 `before`(刪除)/ 兩邊都沒有。
 */
export function diffAuditPayload(before: unknown, after: unknown): AuditFieldChange[] {
  // 非物件(陣列 / 純量 / 兩邊都 null)⇒ 整筆當一個值比。鍵名用 `(整筆)`,
  // 讓員工看得出「這筆的紀錄形狀跟其他筆不一樣」,而不是靜靜顯示成沒有變動。
  if (!isPlainObject(before) && !isPlainObject(after)) {
    if (sameValue(before, after)) return [];
    // ⚠️ **`(整筆)` 這個鍵名 = 文案待定**(E 窗判它是 Sean 的題;主視窗 2026-08-15 裁定
    //    「這條線收工一起問,先照現況寫」)。**它會出現在員工的畫面上**,而員工不一定讀得懂
    //    「整筆」是什麼意思。⇒ **換字時要同步改 `audit-diff.test.ts` 的兩格斷言。**
    return [{ key: '(整筆)', from: display(before), to: display(after) }];
  }

  const beforeObj = isPlainObject(before) ? before : {};
  const afterObj = isPlainObject(after) ? after : {};
  // 一邊是物件、另一邊是純量時,純量那側視為「沒有任何欄位」——
  // 那種輸入本身就是資料異常,而**顯示成「每一欄都被改動」比整個吃掉誠實**。

  const keys = [...new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])].sort();

  return keys
    .filter((key) => !sameValue(beforeObj[key], afterObj[key]))
    .map((key) => ({ key, from: display(beforeObj[key]), to: display(afterObj[key]) }));
}
