import { getStaffRowById, listStaffRows, type StaffRow } from './staff-repository';

// M-4b E8-A1:staff 名單改由資料庫提供,但操作者仍是使用者自行選擇。
// 🔴 這不是登入 / 授權邊界,也沒有驗證「目前使用者是誰」;真實身分驗證待個人帳號接上。

// ── 本檔自己的告警節流(code-reviewer nit C3/C4)────────────────────────────
//
// 🔴 **為什麼搬回本檔**:上一版把它放在 `session/session.ts`(594 行的 auth 模組),
//    而它**只有一個消費者,就在這支檔裡** ⇒ 代價是 `staff.ts` 從此 import auth 模組(跨層耦合),
//    而且 `__resetAlarmThrottleForTests` 會**一次清掉兩個互相獨立的節流器**
//    ⇒ 測試之間會靜默互相影響。**搬回來之後那兩件都不存在。**
//
// 🔴 **而搬回來順手補上了漏掉的那一則**:`listActiveStaff` 的 `console.error` 原本**沒有節流**,
//    而它的觸發條件與下面那則**一模一樣**(DB 掛掉 ⇒ 每個請求都印一則)。
//    📌 我上一輪修的是「我剛動過的那一支」,而**同一個放大面在隔壁還開著** ——
//      修好眼前那個出口, 不等於這一族被關掉了。
//
// ⚠️ 誠實界線:serverless 每個 instance 各有自己的計時器 ⇒ 這是**上界不是精確節流**;
//    它擋的是「單一 instance 的洪水」,不是「全域剛好一則」。
const LOG_MIN_INTERVAL_MS = 60_000;
const lastLogAt = new Map<string, number>();

/** 呼叫即消耗(語意同 `session.ts` 的 `consumeAlarmSlot`,而**兩者互不影響**)。 */
function consumeLogSlot(key: string, now: number = Date.now()): boolean {
  const prev = lastLogAt.get(key);
  if (prev !== undefined && now - prev < LOG_MIN_INTERVAL_MS) return false;
  lastLogAt.set(key, now);
  return true;
}

/** 測試用:清掉本檔的節流狀態。**不要在 production code 呼叫。** */
export function __resetStaffLogThrottleForTests(): void {
  lastLogAt.clear();
}

/** 具名 staff 身分。id 為穩定 slug、寫入 admin_audit_log.actor;label 供 UI 顯示。 */
export interface StaffActor {
  readonly id: string;
  readonly label: string;
}

/**
 * 依 id 取 staff。非名單內 / 空值 → 回 null(fail-closed:
 * 呼叫端不得以未知 id 當 actor 寫稽核,見 audit/context.ts buildAuditContext)。
 */
export function pickStaff(
  list: readonly StaffActor[],
  id: string | null | undefined,
): StaffActor | null {
  if (!id) return null;
  return list.find((staff) => staff.id === id) ?? null;
}

/** 讀取啟用中的 staff;DB 失敗時回空陣列並留 server log。 */
export async function listActiveStaff(): Promise<StaffActor[]> {
  try {
    const rows = await listStaffRows();
    return rows
      .filter((row) => row.is_active)
      .map(({ id, label }) => ({ id, label }));
  } catch (err) {
    // 🔴 有界去重:DB 掛掉時這一行會被【每個頁面請求】打到(它掛在 getSessionActor 上)。
    if (consumeLogSlot('staff.list-failed')) {
      console.error('[admin/staff] 員工名單載入失敗', err);
    }
    return [];
  }
}

/** 由資料庫啟用名單解析 staff;DB 失敗或未知 id 一律回 null。 */
export async function resolveStaff(
  id: string | null | undefined,
): Promise<StaffActor | null> {
  if (!id) return null;
  return pickStaff(await listActiveStaff(), id);
}

/**
 * 單筆員工查詢的逾時上界(毫秒)。
 *
 * 🔴 **為什麼一定要有**(codex 2026-08-26 must-fix):這支跑在**登入的關鍵路徑上**。
 *    DB 若不是「快速拒絕」而是**一直 pending**(網路黑洞 / 連線池耗盡),沒有逾時 ⇒
 *    ```
 *    callback 不會回 403, 它會【卡住】⇒ 一路等到 Vercel 自己 504
 *    而那一刻:①一次性的 SSO code 【已經被兌換掉了】②沒有留下任何 staff-not-active 紀錄
 *    ⇒ 使用者看到的是「登入失敗, 再試一次」, 而再試一次會拿到一樣的結果
 *    ```
 * ⇒ **有逾時 ⇒ 它變成一次乾淨的 403 + 一筆可查的紀錄**,而使用者看到的是「找管理員」。
 * ⚠️ **3 秒是選的、不是量的**:PK 單列查詢正常在數十毫秒內,3 秒已是**兩個數量級**的餘裕;
 *    而它同時要小於 Vercel 的函式上限,否則等於沒設。**若日後量到誤殺,調它、不要拿掉它。**
 */
const STAFF_LOOKUP_TIMEOUT_MS = 3_000;

/**
 * 逾時即 reject ⇒ 由呼叫端的 catch 收成 `null`(fail-closed),不是回一個「查無」。
 *
 * 🔴 **它同時【真的中止那個查詢】,不只是停止等待**(codex R2 must-fix)。
 *    上一版只做 `Promise.race` ⇒ 我們不等了,而**查詢還在跑、還會重試** ——
 *    ⇒ 那正是 DB 已經在掙扎的那一刻,**我們還在往它身上疊請求**。
 *    📌 **「不再等待」與「已經停止」是兩件事。**
 */
async function lookupWithTimeout(id: string): Promise<StaffRow | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getStaffRowById(id, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(); // ← 這一行才是「停止」;下面那個 reject 只是「不等了」
          reject(new Error(`staff 查詢逾時(${STAFF_LOOKUP_TIMEOUT_MS}ms)`));
        }, STAFF_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    // 清掉計時器,否則 serverless 下這條 timer 會把函式生命週期拖長
    // (即使查詢早就回來了)—— 那會變成「每次登入都多活幾秒」。
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 同 `resolveStaff`,而**只查那一列**(不拉整張表)。
 *
 * 🔴 **新增函式,`resolveStaff` / `listActiveStaff` 一個字都沒動**
 *    (B5-b codex 關卡2 MF-2;主視窗 2026-08-25 裁「只准新增」)。
 *    ⇒ 寫入閘 `authorizeAdminMutation` → `getSessionActor` → `resolveStaff` 那條路**零改動**。
 *
 * **回傳語意與 `resolveStaff` 逐條相同**(這是刻意的 —— 兩支語意一旦漂掉,
 * 讀取閘與寫入閘就會對「這個人算不算數」給出不同答案):
 * ```
 * 空 id / 查無此人 / is_active=false / DB 失敗   ⇒ 一律 null
 * ```
 * 🔴 **而「DB 失敗」與「查無此人」在這裡也是同一個 `null`** —— 那不是本函式引入的,
 *    它是 `#933` 登記的既有歧義,本函式**刻意複製它**而不是偷偷修好:
 *    修在這裡 ⇒ 兩支的語意就漂了,而漂掉的方向**沒有測試看得到**。
 */
export async function resolveActiveStaffById(
  id: string | null | undefined,
): Promise<StaffActor | null> {
  if (!id) return null;
  try {
    const row = await lookupWithTimeout(id);
    if (!row || !row.is_active) return null;
    return { id: row.id, label: row.label };
  } catch (err) {
    // 🔴🔴 **有界去重,不是無條件記**(codex R2 must-fix)。
    //    R1 我把 `proxy.ts` 那則 warn 節流了, **而這一則我沒有** ——
    //    codex 逐字:「**放大面只是搬家了**」。
    //    📌 值得記的形狀:**我修好了我正在看的那一個出口, 而同一次改動【新開】了另一個出口。**
    //      兩則 log 的觸發條件一模一樣(DB 掛掉 ⇒ 每個人每個請求),
    //      而我只看得到我剛剛動過的那一支檔。
    // ⚠️ 節流的代價明寫:同一個 60 秒窗口內的**後續**失敗不會留痕
    //    ⇒ 它答得出「有沒有在失敗」,答不出「失敗了幾次」。要次數請看 DB 那一側。
    if (consumeLogSlot('staff.point-lookup-failed')) {
      console.error('[admin/staff] 單筆員工查詢失敗', err);
    }
    return null;
  }
}

/**
 * 同 `resolveActiveStaffById`,而回答的是「他是不是【啟用中的管理者】」。
 * ⟦b4-MGR0⟧ 2026-08-28(Sean 當日批准開工,依主視窗摘要 —— **不是**他逐行審過本設計)。
 *
 * 🔴 重用同一支 `lookupWithTimeout`(3 秒 + 真的 abort)與同一個 `consumeLogSlot` ——
 *    兩支語意一旦漂掉,「讀取閘算數、寫入閘不算數」就會出現而沒有測試看得到。
 *
 * 回傳語意(刻意與姊妹函式逐條相同):
 * ```
 * 空 id / 查無 / is_active=false / is_manager=false / DB 失敗 ⇒ 一律 false(fail-closed)
 * ```
 * ⚠️ 而「DB 失敗」與「不是管理者」在回傳值上同為 false —— 那是刻意複製既有歧義,
 *    **而兩者在 log 上分得開**:只有前者留 error。
 *
 * 🔴 **天花板 —— 這段【不得】被讀成「這個洞已經關閉」**:
 *    這道閘住在【應用層】。持 `service_role` 的程式(= 我們自己寫的下一支腳本)
 *    仍然直接寫得動 `staff.is_manager` —— 建表 migration
 *    `20260726120000_m4b_e8a1_staff_table.sql:72` 給的是【欄級】UPDATE 權
 *    (`GRANT UPDATE (label, is_manager, is_active) ON TABLE public.staff TO service_role`)。
 *    🔴 而那不是「技術上做不到」:REVOKE 那一欄就關得掉,零身分需求。
 *       是 **Sean 2026-08-28 讀過代價後【選擇不鎖】**(Q15 = 甲)。
 *       「做不到」與「他選擇不做」在檔案上長得一樣,而只有後者有一個可以回頭問的人。
 *
 * ⚠️ 成本(登記,不是疏漏):每次 mutation 多一次 DB 往返。上游
 *    `getSessionActor → resolveStaff` 其實已經拉過整張表、而 `StaffRow` 帶 `is_manager`
 *    (`staff-repository.ts` 的 `STAFF_COLUMNS`),只是 `pickStaff` 把它丟掉了。
 *    ⇒ 這是「既有一個字不動」那條裁定的代價。要省這一趟,得先動姊妹函式。
 */
export async function isActiveManager(id: string | null | undefined): Promise<boolean> {
  if (!id) return false;
  try {
    const row = await lookupWithTimeout(id);
    return row?.is_active === true && row.is_manager === true;
  } catch (err) {
    // 🔴 不是裸 catch(codex R1 MF4):裸 catch 把【DB 故障】偽裝成【權限不足】且零紀錄
    //    ⇒ 值班端分不出「資料庫掛了」與「有人在試越權」。仍 fail-closed,而理由要留得下來。
    if (consumeLogSlot('staff.manager-check-failed')) {
      console.error('[admin/staff] 管理者查核失敗(拒絕放行)', err);
    }
    return false;
  }
}
