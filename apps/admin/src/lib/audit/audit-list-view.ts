import type { AdminAuditLogRow } from './types';
import type { StaffActor } from '../staff';
import { formatOrderDateTime } from '../orders/order-detail-view';

// audit-list-view.ts — `#27` D1b:把 `admin_audit_log` 的原始列變成「員工看得懂的四欄」。
// 純函式、零 I/O、零 DOM;資料來源是 D1a-2 的 `AuditLogReader`。
//
// 🔴 **四欄的由來**(plan §3):員工的問題是「**誰、什麼時候、對哪張單、做了什麼**」。
// 🔴 **`before`/`after` 不在本檔的輸出裡** —— 建表 `20260712210000:26-28` 逐字說那兩欄
//    「**可合法含經銷價 / 成本 / PII**」⇒ **列表層不得顯示**(plan 驗收 6)。
//    展開檢視是 D1c 的事,而它要有**明確的使用者動作**才出現(驗收 9)。

/**
 * 動作代碼 → 中文。
 * 🔴 **這份字典一定會過期,而那是預期的**:`AdminAuditAction` 在型別層是 `string`
 *    (`types.ts:8` 逐字「不在 runtime 強制列舉,避免每加動作就改型別」)
 *    ⇒ **新動作隨時會出現,而不會有任何東西提醒我們來補這裡。**
 * ⇒ 所以 `formatAuditAction()` **必須能吃未知代碼**(見該函式),**不是「應該」。**
 *
 * 🔴 **這份清單的來源(讓下一個人知道邊界在哪)**:
 *   - **DB 層**:`supabase/migrations/**` 裡 `INSERT INTO public.admin_audit_log` 的 `action` 字面
 *     —— **18 個 migration 檔含稽核 INSERT**
 *     (量法 `grep -rl "INSERT INTO public.admin_audit_log" supabase/migrations/ | wc -l` ⇒ 18)。
 *     ⚠️ **是「檔數」不是「支數」**:前一版寫「18 支 SECURITY DEFINER RPC」是錯的 ——
 *     **單位換了、數字沒換**(我量的是檔,寫的是支)。
 *     🔴 **而「28」也不對**:那 18 個檔裡的 `CREATE FUNCTION` 共 **28** 個(E 窗量,一支檔可有多個函式),
 *     但**那是全部函式,不等於「寫稽核的函式」**。
 *     🔴 **那次量已經做了(2026-08-15)**:**23 支函式的函式體含稽核 INSERT**(2026-08-15 量,**三種量法互證**:E 窗①以 `CREATE FUNCTION` 切段計數 ②收集 `(檔, 函式名)` 配對去重;C 窗③獨立以 regex 切段 + 逐段判斷。三者皆得 **23**;前提檢查「稽核 INSERT 出現在函式外」⇒ **零命中**。⚠️ **共同限度**:三種都靠「`CREATE FUNCTION` 之間即函式邊界」,**巢狀定義會誤判**——未遇到、也未特別構造)
 *     🔴 **而「三法互證」互證到的是「實作沒寫錯」,不是「那個假設成立」** —— 三種都用**同一個切段假設**(`CREATE FUNCTION` 之間即函式邊界),**同源的方法不會互相抵消共同限度**。⇒ 若那個假設不成立,**三個會一起錯**。。
 *     ⚠️ **前一版寫「沒有可信值」是假的** ——「我沒量」是關於自己的宣稱,「沒有可信值」是關於世界的宣稱。
 *   - **app 層**:`apps/admin/src/lib/staff-actions.ts` —— `:124` `create` / `:189` `update` /
 *     `:274-275` `deactivate`+`reactivate`(**四個都在同一支檔**)。
 *   ⚠️ **只掃 `supabase/migrations/` 會漏掉 app 層那四個** —— 分母要含 `apps/admin/src`。
 *   ⚠️ **本清單抄自 plan §1,而那份是 2026-08-14 數的** ⇒ **分母是那天的樹**;
 *      `deactivate`/`reactivate` 就是這樣漏的(E 窗 R1 must-fix 補回)。
 *      🔴 **重掃時要掃兩個分母**:主樹 `dev` **與** 各窗分支的聯集 —— 新 migration 可能還沒進 dev。
 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'customer.tier.change': '調整會員等級',
  'customer.wallet.adjust': '調整儲值金',
  'order.cancel': '取消訂單',
  'order.workflow.update': '更新訂單狀態',
  'order_item.workflow.update': '更新品項狀態',
  'order_note.append': '新增訂單備註',
  'order_refund.initiate': '發起退款',
  'order_refund.finalize': '完成退款',
  'order_refund.correct_verdict': '更正退款判定',
  'payment.record': '登錄收款',
  'payment.record.replay': '收款重送(冪等)',
  'payment.reverse': '沖銷收款',
  'procurement.create': '建立採購',
  'procurement.update': '更新採購',
  'procurement.void': '作廢採購',
  'procurement_receipt.create': '登錄到貨',
  'procurement_receipt.delete': '撤銷到貨',
  'supplier.create': '新增供應商',
  'supplier.update': '更新供應商',
  'settings.staff.create': '新增員工',
  'settings.staff.update': '更新員工',
  // 🔴 這兩個是 E 窗 R1 must-fix 補的 —— 與上面兩行**同一支檔**(`staff-actions.ts:274-275`),
  //    而我抄 plan §1 的清單時漏了。⚠️ 那份清單是 **08-14 數的**,而**分母是那天的樹**。
  'settings.staff.deactivate': '停用員工',
  'settings.staff.reactivate': '啟用員工',
};

/**
 * 代碼 → 中文;**字典沒有的代碼原樣回傳代碼本身**(plan 驗收 5)。
 * 🔴 **「不會爆」與「顯示得體」是兩件事,這裡兩件都要**:
 *   回空字串 = 不會爆但畫面出現空格 ⇒ 員工看到一列「不知道發生了什麼事」的紀錄;
 *   回 `'未知動作'` = 得體但**把資訊丟掉**,查不出到底是哪個代碼。
 *   ⇒ **原樣回代碼**:醜,但**可查**。稽核紀錄的用途是追查,不是好看。
 */
export function formatAuditAction(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}

/**
 * `actor` slug → 中文姓名;名單裡沒有就**原樣回 slug**(理由同上)。
 * 🔴 稽核是歷史紀錄:`listActiveStaff()` 只回**啟用中**的人,而當時那個人可能已離職 / 已停用
 *    ⇒ **舊紀錄的 actor 查不到是預期,不是異常** ⇒ 原樣顯示,不當錯誤。
 *
 * ⚠️ **這裡刻意沒有 `import { pickStaff } from '../staff'`,雖然那支就是做這件事的**:
 *    `lib/staff.ts:1` → `staff-repository.ts:1` 有 `import 'server-only'`
 *    ⇒ **一 import 就把整條 server-only 鏈拉進這支純 view 模組**,
 *    連帶**本檔的單測整個載不起來**(實測:`Error: This module cannot be imported from a Client Component module`)。
 *    🔴 **這不只是測試問題,是分層問題**:view 層應該是 leaf,**不該依賴任何 server-only 的東西**。
 *    ⇒ 型別走 `import type`(執行期抹除),查找那三個字自己寫。
 *    **代價明說**:與 `pickStaff` 的查找邏輯重複一行;**換到的是這層保持可測、且不會被 server-only 汙染。**
 *
 * ⚠️ **「有沒有東西擋住下一個人加回來」——有,而我一度自判成「什麼都沒擋」,那句話是錯的**(E 窗 R1 實測更正):
 *    把 `import { pickStaff }` 加回去 ⇒ **整支 suite `0 test / Failed Suites 1`**,CI 直接紅。
 *    ⇒ **缺的不是機制,是那道紅的標籤** —— 它喊 `server-only`,不喊「view 層不得依賴 server-only」。
 *    ⇒ **這 7 行註解就是那個標籤**,而它寫在**下一個人會動手的那一行正上方**。
 *    🔴 **而「再加一格斷言本檔 import 清單」是零判別力格**:測試檔 top-level 已經 import 本模組,
 *       再寫一格 `await import(...)` **紅的時機一模一樣** ⇒ **那會是新增一格假守門。**
 */
export function formatAuditActor(staff: readonly StaffActor[], actor: string): string {
  return staff.find((s) => s.id === actor)?.label ?? actor;
}

/** `target` 拆出來的結果;`kind` 為 null = 這一列沒有可點的去處。 */
export interface AuditTargetLink {
  readonly label: string;
  readonly href: string | null;
}

const TARGET_HREF: Record<string, (id: string) => string> = {
  order: (id) => `/orders/${id}`,
  customer: (id) => `/customers/${id}`,
};

/**
 * 🔴 **有些前綴看得懂、但沒有可以去的頁面** —— 那和「看不懂」是兩件事,要分開。
 * `staff:${id}`(`staff-actions.ts:274` 等)就是這種:`app/settings/staff/` **只有 `page.tsx`,沒有 per-id 頁**
 * ⇒ **給得體的中文標籤、但不給連結**。
 * ⚠️ 沒有這一格的話,那一列會是「`settings.staff.deactivate` + `staff:8f3a-…`」**兩欄都是機器字串**
 *    —— 正是本檔開頭說要消滅的東西(E 窗 R1 追到第二層才看到)。
 */
const TARGET_LABEL: Record<string, string> = {
  order: '查看訂單',
  customer: '查看客人',
  staff: '員工設定',
};

/**
 * `target` → 可點連結。格式約定 `<entity>:<uuid>`(建表 `20260712210000:65-66` COMMENT)。
 *
 * 🔴 **切不開的時候有明確行為,不靜默回空字串**(主視窗 2026-08-15 提醒):
 *   - `null` / 空字串 ⇒ `{ label: '—', href: null }` —— **全域動作本來就可以沒有 target**(建表註解逐字「全域動作可省略」)
 *   - 有值但**格式不符**(沒有冒號 / 前綴不認得 / uuid 段為空)⇒ **原樣把整串顯示出來、不給連結**
 *     ⇒ 那是「**這裡有東西,但我不知道怎麼帶你去**」,而**不是「這裡什麼都沒有」**。
 *   ⚠️ 兩者**必須看得出差別** —— 靜默回空字串會讓「沒有 target」和「target 壞了」長得一模一樣。
 */
export function formatAuditTarget(target: string | null): AuditTargetLink {
  if (!target) return { label: '—', href: null };
  const idx = target.indexOf(':');
  if (idx <= 0) return { label: target, href: null };
  const kind = target.slice(0, idx);
  const id = target.slice(idx + 1);
  if (!id) return { label: target, href: null };
  const label = TARGET_LABEL[kind];
  // 認得前綴但沒有 href ⇒ 得體標籤、無連結(見 TARGET_LABEL 上方註解)。
  if (!TARGET_HREF[kind]) return { label: label ?? target, href: null };
  return { label: label ?? target, href: TARGET_HREF[kind](id) };
}

/** 一列稽核紀錄在畫面上的樣子(四欄)。 */
export interface AuditListRow {
  readonly id: string;
  readonly at: string;
  readonly actor: string;
  readonly action: string;
  readonly target: AuditTargetLink;
}

/**
 * 原始列 → 畫面列。
 * 🔴 時間走 **`formatOrderDateTime`**(`lib/orders/order-detail-view.ts:37`),**不自己寫第 N 份時區字面**
 *    —— 該函式 `:39`/`:41` 兩處都釘 `timeZone: 'Asia/Taipei'`。
 *    ⚠️ 正式站是 **UTC**(Vercel Node),本機是台北 ⇒ **不釘時區的實作在本機恆綠、上線差八小時。**
 */
export function toAuditListRow(row: AdminAuditLogRow, staff: readonly StaffActor[]): AuditListRow {
  return {
    id: row.id,
    at: formatOrderDateTime(row.created_at),
    actor: formatAuditActor(staff, row.actor),
    action: formatAuditAction(row.action),
    target: formatAuditTarget(row.target),
  };
}
