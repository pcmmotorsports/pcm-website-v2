import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MANUAL_REFUND_ENTRY_BLOCKED_BY_787 } from './manual-refund-entry-gate';

/**
 * manual-refund-787-trigger.test.ts — `#787` 硬閘的解除觸發器(機制,不是提醒)。
 *
 * 🔴 主視窗 2026-08-20 裁定的理由,逐字:「註解不會在『條件成立了』的那一刻說話」。
 *
 * ══ 換靶紀錄(**這一段是本檔的變更史,不要刪** —— 它已經換過兩次)══════════════
 *
 * ── 靶① 2026-08-20:`supabase/migrations/` 上有沒有 `admin_void_manual_refund` 這個字面 ──
 * ~~**它完成了它的工作,而且它是對的**~~ —— 那支 migration 2026-08-20 落地,本檔如設計地紅了。
 * 🔴 **但它從那一刻起【永遠紅】,而該做的那一片當時還沒排** ⇒ 它在 dev 上紅了整整兩天,
 *    而**每一次全套測試都會看到它紅、然後略過**。**那個習慣比那道閘本身危險**
 *    (memory `feedback_a-guard-you-cant-finish-today-becomes-noise`)。
 *
 * ── 靶② 2026-08-22(片 D3-c):`supabase/APPLIED.tsv` 有沒有 `20260822120000` ──
 * ~~「舊靶量的是『檔在磁碟上』,而解除條件要的是『權限真的開了』」~~
 * **它也完成了它的工作**:那支 GRANT 2026-08-22 apply 並記帳 ⇒ 本檔如設計地紅了。
 * 🔴 **而它又落進靶① 同一個坑**:紅了之後要做的那件事(`#866`)當天不存在
 *    ⇒ 它會一路紅到 `#866` 落地。**同一個病,第二次。**
 *
 * ── 靶③ 2026-08-24(`#806` 之後,主視窗裁):`#866` 那道不變式的【具名標記】在 migrations 目錄 ──
 * 🔴 **2026-08-24 當天就響了,而且是【對的】那種響**:`#866` 兩支 migration 一落進工作樹,
 *    本格如設計地紅。**沒有為了讓它變綠而改期望值** —— 照失敗訊息那三件逐條重評:
 * ```
 * ① 真的 apply 了嗎  ⇒ grep -c "^20260824010000\t" supabase/APPLIED.tsv ⇒ 0
 *                      負對照(同尺量一支確定 apply 過的) 20260823020000 ⇒ 1  ⇒ 尺是活的
 * ② 唯讀查權限        ⇒ **查不了**:施工窗沒有正式庫 access。而 ① 已經 false ⇒ 不必查也不能查
 * ③ 「它現在還擋著什麼」⇒ 真實讀取點兩處(其餘命中都是註解與測試):
 *      manual-refund-entry-gate.ts:76  UI 入口
 *      manual-refund-actions.ts:70     server action
 *    拿掉旗標之後那兩處還剩什麼閘?**server 端只剩 authorizeAdminMutation + RPC 的 o.total 上限**
 *    ⇒ 🔴 而 `#866` 那道 trigger **住在 DB 裡、而它沒 apply** ⇒ **現在解除 = DB 側零保護**
 * ```
 * ⇒ **重評結論:封印留著。** 靶③ 完成了它的工作 ⇒ 退場、換靶④。
 * 📌 **它比前兩個靶好在哪**:靶①② 響完之後**一路長紅**;靶③ 響完當天就換掉了,**沒有變成噪音**。
 *
 * ── 🔴 靶④ 2026-08-24(現行):`supabase/APPLIED.tsv` 裡有沒有 `#866` 的版本號 ──
 * ```
 * 靶 = APPLIED.tsv 的【非註解行】第一欄 == 20260824010000 或 20260824011000
 * 今天 ⇒ 0 ⇒ **今天綠**    負對照 20260823020000 ⇒ 1 ⇒ **尺讀得到東西**
 * ```
 * 🔴 **為什麼從「檔在磁碟」改成「已記帳」**:靶③ 響的那天證明了這兩件事會分岔 ——
 *    檔在工作樹裡躺著,而 DB 一無所知。**解除封印要的是後者。**
 * ⚠️ **第三次同款的風險,寫在這裡讓下一個人檢查**:靶④ 響的那天(#866 apply),
 *    要做的那件事(解除兩道閘)**當天就做得完** ⇒ 不會重演靶①② 的長紅。
 *    🔴 **若那天發現又做不完 ⇒ 那不是再換一個靶,是把「做不完的原因」變成一個條目。**
 *
 * ── ~~靶③ 的原文(留著當紀錄)~~ ──
 * ```
 * 靶 = supabase/migrations/ 底下任何一支 .sql 的【非註解行】含   pcm_manual_refund_rail_cap
 * 今天 grep -rl "pcm_manual_refund_rail_cap" supabase/migrations/ | wc -l ⇒ 0  ⇒ **今天綠**
 * 負對照 同尺量 admin_void_manual_refund ⇒ 3  ⇒ **尺讀得到東西**
 * ```
 * 🔴 **這是一個【合約】,不是猜測**:「`#866` 的 migration 必須含 `pcm_manual_refund_rail_cap`
 *    這個具名物件」寫進 `#866` 的**驗收條件**(主視窗 2026-08-24 落檔)。
 *    ⇒ 做 `#866` 的人不照做 ⇒ **這顆觸發器不會響** ⇒ 所以那條驗收是硬的,不是建議。
 * 🔴 **換靶的判別法(讓下一個人能檢查這個決定)**:換完之後它必須**今天綠、而在該紅的那天紅**。
 *    換完就紅 ⇒ 那不是換靶,是換一個新的長紅。(2026-08-24 實跑:換完 [1] 綠 ✅)
 *
 * ══ 🔴🔴 為什麼今天【不能】解除 —— 而理由與當初封它時【不是同一個】══════════════
 * ```
 * #787 原本的三條解除條件 2026-08-24 已【全部成立】(#806 量的,第③條對 DB 量到):
 *   ① 沖銷 RPC migration 已 apply                                   ✅
 *   ② CALLER_ALLOWLIST 已登記                                        ✅
 *   ③ has_function_privilege('service_role', admin_void_manual_refund, 'EXECUTE') = true ✅
 *      (同發正對照【登記那支 RPC】=true、負對照 mark_charge_attempt_failed=false
 *       🔴 **正對照那支的完整識別字刻意省略,這不是遺漏** —— `manual-refund-caller-gate.test.ts`
 *       是一道**字面掃描**,它分不出【呼叫它】與【在註解裡提到它】。2026-08-24 本檔寫了全名,
 *       那道閘當場把**本檔**報成新呼叫端(實際零呼叫)。⇒ 處置是改措辭,**不是**把本檔加進
 *       那邊的 CALLER_ALLOWLIST(本檔不是呼叫端)。⚠️ **下一個人請不要「順手補上完整名字」。**
 *       ⇒ 三個值不全一樣 ⇒ 尺是活的)
 * ```
 * ⇒ **當初封它的理由是「登記錯了改不掉」(沖銷入口沒開)—— 那件事 2026-08-22 已經消失。**
 * ⇒ 🔴 **而 2026-08-24 照三條件解除之後,codex 對抗審查當場構造出一條路**:
 *    持有效後台 session ⇒ 不經畫面直接送 `recordManualRefundAction` ⇒ 一張純刷卡未付款的單
 *    ⇒ 金額 ≤ 訂單總額 ⇒ 寫進假的人工退款 ⇒ **永久扣低可退餘額**。
 *    成因兩層:UI 的 rail 條件 server 端**沒有重驗**;RPC 上限用 `o.total`(訂單總額,
 *    `20260820100000:230-231`)而**不是該軌淨實收**。
 * ⇒ ⇒ **現在封著它的是 `#866`** —— 一個當初三條解除條件裡**一個字都沒提到**的東西。
 *
 * 📌 **這一片留下來最該被帶走的一句**:
 * > **解除一道封印之前,問的不是「條件到齊了嗎」,是「它現在還擋著什麼」。**
 * 而那兩個問題的**答案來源不同**:前者查得到(條件是寫下來的);後者**沒有任何檔案列得出來**,
 * 只能**從消費端反推** —— grep 那顆旗標的每一個讀取點,逐個問「拿掉它之後這裡還剩什麼閘」。
 * 🔴 2026-08-24 有**四個地方**都沒問那一句:backlog 條目 / 盤點清單 / 派工單 / 施工窗的 plan。
 *
 * ══ ⚠️ 新靶的誠實邊界(它量得比它聽起來的窄)══════════════════════════════
 * · 它量的是「**repo 的 migrations 目錄裡有沒有這個字面**」,**不是**「那道不變式真的生效了」。
 *   檔在磁碟上 ≠ 已 apply ≠ 權限開了 —— **這三件事分岔過兩次,而本檔的前兩個靶各栽在一次上。**
 *   ⇒ 這一格**不重蹈**:它的紅訊息只說「回來重評」,**不說「可以解除了」**。
 * · 🔴 **非註解行**才算數(見 `migrationsWithRailCap` 的 docstring)—— 有人寫一句
 *   `-- TODO: pcm_manual_refund_rail_cap 還沒做` 就讓它紅,那是**反過來的答案**。
 * · 它只掃 `supabase/migrations/*.sql`;`#866` 若改用別的載體(view / 應用層)⇒ **這格不會響**。
 */

const REPO = resolve(__dirname, '../../../../..');
const MIGRATIONS_DIR = 'supabase/migrations';
const APPLIED_TSV = 'supabase/APPLIED.tsv';

/** `#866` 那道不變式的具名標記(合約字面;改它 = 改合約,要同步改 `#866` 驗收條件)。 */
export const RAIL_CAP_MARKER = 'pcm_manual_refund_rail_cap';

/**
 * 掃 `supabase/migrations/` 底下含 `RAIL_CAP_MARKER` 的檔 —— **只認【非註解行】**。
 *
 * 🔴 **這一條是靶② 留給靶③ 的教訓,原封搬過來**(那時它掃的是 `APPLIED.tsv`):
 *   第一版用 `.includes(MARKER)`,而它的**分母是整支檔的全部字元** ——
 *   而 SQL 檔裡有大量 `--` 註解、檔頭 prose。只要有人寫一句
 *   `-- TODO: pcm_manual_refund_rail_cap 還沒做`,這顆觸發器就會紅著說「它已經落地了」。
 *   ⇒ **那是反過來的答案**,而它讀起來完全正常。
 * ⇒ 所以要逐行看,並跳過 `--` 開頭的行。
 * ⚠️ **它擋不住的**:區塊註解 `/* … *​/` 裡的提及、字串常值裡的提及。**照實寫,不假裝覆蓋。**
 */
export function migrationsWithRailCap(files: Array<{ name: string; body: string }>): string[] {
  return files
    .filter(({ body }) =>
      body
        .split('\n')
        .some((line) => line.includes(RAIL_CAP_MARKER) && !line.trimStart().startsWith('--')),
    )
    .map(({ name }) => name);
}

/** `#866` 兩支 migration 的版本號(= APPLIED.tsv 第一欄的字面)。 */
export const RAIL_CAP_VERSIONS = ['20260824010000', '20260824011000'] as const;

/**
 * 靶④ 的尺:`APPLIED.tsv` 的**非註解行**第一欄(TAB 前)有沒有這幾個版本號。
 *
 * 🔴 **靶③ 留給靶④ 的教訓,原封搬過來**:分母是【第一欄】,不是整支檔的字元。
 *   那支檔第三/第四欄是人寫的中文備註,裡面**完全可能**出現一句
 *   「等 20260824010000 上了再說」⇒ `.includes()` 會回 true,而那是**反過來的答案**。
 * ⚠️ **它擋不住的**:記帳本身寫錯(記了但沒真的 apply)。
 *   **照實寫,不假裝覆蓋** —— 所以本格的紅訊息仍然只說「回來重評」,不說「可以解除了」。
 */
export function appliedVersionsIn(tsv: string, versions: readonly string[]): string[] {
  const first = new Set(
    tsv
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .map((line) => line.split('\t')[0]?.trim())
      .filter((v): v is string => !!v),
  );
  return versions.filter((v) => first.has(v));
}

/**
 * 讀真實 migrations 目錄。**靶③ 退場後它不再是主靶**,
 * 但 [4] 仍用它當「#866 的檔在不在工作樹裡」的分母 —— 那是重評第①件事的前提。
 */
function railCapMigrations(): string[] {
  try {
    const dir = resolve(REPO, MIGRATIONS_DIR);
    return migrationsWithRailCap(
      readdirSync(dir)
        .filter((n) => n.endsWith('.sql'))
        .map((name) => ({ name, body: readFileSync(resolve(dir, name), 'utf8') })),
    );
  } catch {
    return [];
  }
}

/**
 * ── 🔴 靶⑤ 2026-08-24(現行):`#885` 在 backlog 裡結案了沒 ──────────────────
 * ```
 * 靶 = docs/phase-1-backlog.md 的 `### #885.` 標題行【沒有】 ✅
 * 今天 grep -cE "^### #885\. .*✅" ⇒ 0 ⇒ **今天綠**
 * 負對照 同尺量 #1(已結案)⇒ 1 ⇒ **尺讀得到東西**
 * ```
 *
 * ══ 🔴🔴 三件事寫在這裡,不是寫在 commit body —— 那裡沒有人會回頭讀 ══════════
 *
 * **① 這是靶④ 換到靶⑤,而【換靶不是解除】。**
 *    `MANUAL_REFUND_ENTRY_BLOCKED_BY_787` 今天仍然是 `true`,一個字都沒動。
 *    靶④ 響了(`#866` 已 apply)⇒ 有人做了重評 ⇒ 重評的結論是**不解除**
 *    ⇒ 所以換一個指著「現在真正擋著它的那個東西」的靶。
 *    正本:`~/pcm-mailbox/線2-787封印重評-20260824.md`(四步逐步開檔驗過)。
 *
 * **② 三次換押的理由【互不相同】—— 寫出來,免得下一個人以為它一直在守同一件事。**
 * ```
 * 靶③ 押 #866 的檔在不在磁碟上   → 退場理由:檔在磁碟 ≠ 已 apply(兩者分岔過)
 * 靶④ 押 #866 的版本號在不在帳本 → 響了(2026-08-24 Sean 貼了那兩支)
 * 靶⑤ 押 #885 結案了沒          ← 現行
 * ```
 *    而**當初封它的理由早就消失了**:`#787` 原本封它是因為「登記錯了改不掉」,
 *    那件事 2026-08-22 就沒了。它現在擋的是完全不同的東西。
 *
 * **③ 🔴 靶⑤ 為什麼是 `#885` —— 而它【不是】一件「補個上限就好」的工。**
 * ```
 * #866 落地之後, 那條原本的路(RPC 上限用 o.total)真的關了:
 *   pcm_manual_refund_rail_cap = 現金+匯款淨實收 − 未作廢人工退款(不再是訂單總額)
 *   trg_pcm_manual_refund_rail_cap BEFORE INSERT OR UPDATE OR DELETE ON order_manual_refunds
 *   純刷卡未付款單 ⇒ cap = 0 ⇒ 任何退款 > 0 ⇒ PCM01 拒絕
 * 而【等價的一條路】在它上游一步 = #885:
 *   admin_record_manual_payment 零上界(只擋 p_amount <= 0)且 allowlist 明文含 'unpaid'
 *   ⇒ 先灌一筆假的現金收款 ⇒ rail_cap 算得出額度 ⇒ 再退 ⇒ 結果與封印前一樣
 * ```
 *    🔴🔴 **而「補上限」這條路已經被拍板排除** —— `docs/phase-1-backlog.md` 逐字:
 *    「Sean 2026-08-23 拍板**不在收款端加上界**(溢收是合法生意)」;
 *    `#885` 條目另逐字:「不要把本條寫成『再補一道上限』—— 補上限只會多一次誤擋:
 *    客人付現金 1000 而我們匯款退他 1000 —— 那在小店是常態」。
 *    ⇒ **這不是「還沒做」,是「已經決定不那樣做」。**
 *    ⇒ `#885` 自己寫的根因是**歸屬**(共用密碼之下查不出是誰寫的那筆假收款),
 *      前置是**真登入線 `E8-B`**,它逐字寫著「在那之前本條補不乾淨」。
 *
 * ⚠️ **靶⑤ 的誠實邊界**:有人可以「把 `#885` 標成結案而沒真的解決」⇒ 這格會紅。
 *    **而那正是我們要的** —— 它的紅訊息只說「回來重評」,不說「可以解除了」。
 */
const BLOCKER_ID = '#885';

/** `### #885.` 那一行有沒有 ✅(= backlog 的結案慣例)。讀不到一律當「沒結案」= 綠,並由 [4] 自檢說話。 */
function blockerClosed(): boolean {
  try {
    const md = readFileSync(resolve(REPO, 'docs/phase-1-backlog.md'), 'utf8');
    const head = md.split('\n').find((l) => l.startsWith(`### ${BLOCKER_ID}.`));
    return head !== undefined && head.includes('✅');
  } catch {
    return false;
  }
}

/** 讀真實 APPLIED.tsv。讀不到一律回空陣列,並由 [4] 那格用真實現況說話。 */
function railCapApplied(): string[] {
  try {
    return appliedVersionsIn(readFileSync(resolve(REPO, APPLIED_TSV), 'utf8'), RAIL_CAP_VERSIONS);
  } catch {
    return [];
  }
}

/**
 * 純邏輯:給定「`#866` 的不變式是否已落地」與「硬閘是否仍鎖著」,回傳這格該不該紅。
 * 拆成純函式是為了讓 [2][3b] 能在**不動任何檔案**的情況下,對著假狀態驗證斷言真的會失敗。
 */
function evaluateTrigger(
  /**
   * 🔴 **靶⑤ 起,這個參數的意思換了** —— 從「`#866` 落地了沒」變成
   * 「**現在真正擋著封印的那個東西(`#885`)清掉了沒**」。
   * 換意思而不換名字會讓下一個人讀錯,所以名字也換了。舊名 `railCapLanded` 已退場。
   */
  blockerCleared: boolean,
  stillBlocked: boolean,
): { ok: boolean; reason: string } {
  if (blockerCleared && stillBlocked) {
    return {
      ok: false,
      reason:
        `docs/phase-1-backlog.md 的 ${BLOCKER_ID} 已標結案,` +
        '而 MANUAL_REFUND_ENTRY_BLOCKED_BY_787 還是 true。\n' +
        `⇒ ${BLOCKER_ID} 是【現在】押著這道封印的東西(靶⑤;靶③④ 的理由都已退場,見檔頭)。\n` +
        '⚠️ 而它可能只是【被標成結案】而沒真的解決 —— 先去讀那個條目現在寫什麼。\n' +
        '⇒ 🔴 **這不代表可以解除了** —— 它只代表「回來重評 #787 封印」。\n' +
        '   本格量的是【記帳說 apply 了】,不是【權限開了】,更不是【那道 trigger 真的擋得住】。\n' +
        '   本檔前三個靶各栽在這條分岔上,不要栽第四次。\n' +
        '重評要做完這三件才動手:\n' +
        '① 記帳與現況對得上(APPLIED.tsv 那列的 sha256 == 現在磁碟上那支檔的 sha256)\n' +
        "② 唯讀查一發:select has_function_privilege('service_role', p.oid, 'EXECUTE'), p.proacl\n" +
        '     …而且【同一發帶正負對照】,三個值全一樣 ⇒ 尺壞了、該發作廢\n' +
        '③ 🔴 問那句:**「它現在還擋著什麼?」** —— grep MANUAL_REFUND_ENTRY_BLOCKED_BY_787 的\n' +
        '   每一個讀取點,逐個問「拿掉它之後這裡還剩什麼閘」。2026-08-24 就是漏了這一步。\n' +
        '確認完才動:①解除兩道閘(UI + server action,**同一顆 commit**)\n' +
        '②更新 manual-refund-caller-gate.test.ts 的 CALLER_ALLOWLIST why 與失敗訊息\n' +
        '③把 refund-wiring.test.tsx 那格翻成「健康輸入 ⇒ 入口【出現】」(見 #866 條目)\n' +
        '④🔴 然後把【本檔】刪掉 —— 它是一條絆線,工作完成了就該退場,不是改成永遠會過',
    };
  }
  // 🔴🔴 反方向:封印被解除而 `#866` 的不變式**沒有**落地 ——
  //    **那正是 2026-08-24 真的發生過的事**(codex 對抗審查抓到,見檔頭)。
  //    第一版只守「該解沒解」,不守「不該解卻解了」—— 而後者才是會出錢的那個方向。
  if (!blockerCleared && !stillBlocked) {
    return {
      ok: false,
      reason:
        'MANUAL_REFUND_ENTRY_BLOCKED_BY_787 已經是 false,' +
        `而 ${BLOCKER_ID} 在 backlog 裡【還沒結案】。\n` +
        '⇒ 🔴 2026-08-24 那個洞的【等價版本】現在還開著:\n' +
        "   admin_record_manual_payment 零上界(只擋 p_amount <= 0)且 allowlist 明文含 'unpaid'\n" +
        '   ⇒ 先灌一筆假的現金收款 ⇒ #866 的 rail_cap 算得出額度 ⇒ 再退\n' +
        '   ⇒ 結果與封印前一樣(寫進假退款、永久扣低可退餘額),只是從一次呼叫變成兩次。\n' +
        '   📌 歷史:原本那條路是「RPC 上限用 o.total 而不是該軌淨實收」,#866 已經把它關了。\n' +
        '處置(擇一):① 把兩道閘改回 true,直到 ' + BLOCKER_ID + ' 有結論\n' +
        `           ② 若 ${BLOCKER_ID} 其實已經解決了只是沒標 ⇒ 去把那個條目標起來,並附量測`,
    };
  }
  return { ok: true, reason: '' };
}

describe('#787 解除觸發器(靶⑤ = #885 在 backlog 結案了沒;靶③④ 已響過並退場,理由各不相同、見檔頭)', () => {
  it('[1] 現在:#885 還沒結案 → 綠(量到的,不是假設)', () => {
    const cleared = blockerClosed();
    expect(
      cleared,
      `${BLOCKER_ID} 已在 docs/phase-1-backlog.md 標成結案` +
        ' —— 回來重評 #787 封印,而【重評不等於解除】,照失敗訊息先讀那個條目現在寫什麼',
    ).toBe(false);
    expect(evaluateTrigger(cleared, MANUAL_REFUND_ENTRY_BLOCKED_BY_787).ok).toBe(true);
  });

  it('[2] 🔴 反面驗證:餵一個假的「已落地」狀態,確認這格真的會紅(不是死斷言)', () => {
    const faked = evaluateTrigger(true, MANUAL_REFUND_ENTRY_BLOCKED_BY_787);
    expect(faked.ok).toBe(false);
    expect(faked.reason).toContain('它現在還擋著什麼');
    // 🔴 釘【現在承重的那個字面】—— 靶⑤ 起是 #885,不再是 #866 的版本號。
    //    (靶④ 時這裡釘的是 RAIL_CAP_VERSIONS[0];換靶就要換釘子,否則它釘的是一個已退場的東西。)
    expect(faked.reason).toContain(BLOCKER_ID);
    // 🔴 釘住「重評 ≠ 解除」那句 —— 拿掉它,這格就會把人直接帶去解封印。
    expect(faked.reason).toContain('這不代表可以解除了');
  });

  it('[3] 正向對照:不變式已落地 + 硬閘已解除 → 不再紅', () => {
    expect(evaluateTrigger(true, false).ok).toBe(true);
  });

  it('[3b] 🔴 反方向:封印已解除而 #885 還沒結案 → 必須紅(08-24 那個洞的等價版本)', () => {
    const r = evaluateTrigger(false, false);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('已經是 false');
    // 現行機制的承重字面(灌水那條路);`o.total` 只留在同一段的「歷史」註記裡。
    expect(r.reason).toContain('admin_record_manual_payment');
    expect(r.reason).toContain('o.total');
  });

  it('[3c] 正向對照:兩邊都還沒動(沒落地、封印還在)→ 綠', () => {
    expect(evaluateTrigger(false, true).ok).toBe(true);
  });

  // 🔴 沒有這一格,[1] 會在「目錄不存在 / 讀不到」時**照樣綠** ——
  //    那是「我找不到 ⇒ 沒發生」與「真的沒發生」印同一句話的那個病。
  it('[4] 🔴 量具自檢:APPLIED.tsv 要真的讀得到,而且尺讀得到東西', () => {
    expect(
      existsSync(resolve(REPO, APPLIED_TSV)),
      `找不到 ${APPLIED_TSV} ⇒ 本檔對「有沒有 apply」的任何答案都不算數`,
    ).toBe(true);
    const tsv = readFileSync(resolve(REPO, APPLIED_TSV), 'utf8');
    // 🔴 負對照的反面:同一把尺去量一個**確定已 apply** 的版本號,必須撈得到 ——
    //    撈不到 = 讀檔或切欄壞了,而 [1] 會安靜地永遠綠。
    expect(
      appliedVersionsIn(tsv, ['20260823020000']),
      '同一把尺量一支確定已記帳的版本卻撈不到 ⇒ 切欄邏輯壞了,[1] 的綠不算數',
    ).toEqual(['20260823020000']);
    // 🔴 而反方向也要試一發:一個**確定不在**的版本號必須回空 ——
    //    只驗「撈得到」的話,一把「什麼都回 true」的壞尺會照樣過這一格。
    expect(
      appliedVersionsIn(tsv, ['19990101000000']),
      '一個不存在的版本號卻被撈到 ⇒ 尺什麼都說有,[1] 的綠不算數',
    ).toEqual([]);
    // 🔴🔴 靶⑤ 的量具自檢:那把尺【兩個方向】都要證明它讀得到東西。
    //    少了這一格,`blockerClosed()` 在「檔讀不到 / 標題格式換了」時**回 false ⇒ [1] 照樣綠**
    //    —— 那正是「我找不到 ⇒ 沒發生」與「真的沒發生」印同一句話的病,本檔前三個靶栽過。
    const backlog = readFileSync(resolve(REPO, 'docs/phase-1-backlog.md'), 'utf8');
    const heads = backlog.split('\n').filter((l) => l.startsWith('### #'));
    expect(heads.length, '🔴 backlog 一個 `### #` 標題都找不到 ⇒ 切行壞了,[1] 的綠不算數')
      .toBeGreaterThan(0);
    // 正向:本條目要在(它不在 ⇒ 靶指著一個不存在的東西 ⇒ [1] 會永遠綠)
    expect(
      heads.some((l) => l.startsWith(`### ${BLOCKER_ID}.`)),
      `🔴 backlog 裡找不到 ${BLOCKER_ID} 的條目 ⇒ 靶⑤ 指著空氣,[1] 的綠不算數`,
    ).toBe(true);
    // 反向:同一把尺去量一個【確定已結案】的條目,必須看得到 ✅ ——
    //       看不到 = 「有沒有 ✅」這個判準壞了,而 [1] 會安靜地永遠綠。
    expect(
      heads.some((l) => l.startsWith('### #1.') && l.includes('✅')),
      '🔴 同一把尺量一個確定已結案的條目卻讀不到 ✅ ⇒ 結案判準壞了,[1] 的綠不算數',
    ).toBe(true);

    // 🔴 靶③ 的遺產:migrations 目錄仍要在(#866 的檔在不在磁碟上,是重評第①件事的分母)
    expect(existsSync(resolve(REPO, MIGRATIONS_DIR)), `找不到 ${MIGRATIONS_DIR}`).toBe(true);
    expect(
      railCapMigrations().length,
      '🔴 #866 的檔【不在】工作樹裡,而本檔在等它被 apply ⇒ 這個組合說不通,回來看發生什麼事',
    ).toBeGreaterThan(0);
  });
});

describe('migrationsWithRailCap — 分母是【非註解行】不是整支檔', () => {
  const M = RAIL_CAP_MARKER;

  it('真的建了那個物件 → 命中', () => {
    expect(migrationsWithRailCap([{ name: 'a.sql', body: `CREATE FUNCTION ${M}() ...` }])).toEqual(['a.sql']);
  });

  // 🔴 這一格是本節存在的理由:`.includes(M)` 在這裡會回 true,而那是【反過來的答案】。
  it('🔴 只是 `--` 註解裡提到 → 不命中(說「還沒做」不等於做了)', () => {
    const body = `-- TODO: ${M} 還沒做,等 #866\nCREATE TABLE x ();\n`;
    expect(migrationsWithRailCap([{ name: 'a.sql', body }])).toEqual([]);
    expect(body.includes(M), '對照:舊寫法在同一份輸入上會說「已落地」').toBe(true);
  });

  it('縮排的註解也不算(前面有空白的 --)', () => {
    expect(migrationsWithRailCap([{ name: 'a.sql', body: `    -- ${M}\n` }])).toEqual([]);
  });

  it('同一支檔註解與真程式都有 → 命中(真程式那行說了算)', () => {
    expect(migrationsWithRailCap([{ name: 'a.sql', body: `-- ${M}\nGRANT EXECUTE ON FUNCTION ${M} TO x;\n` }])).toEqual(['a.sql']);
  });

  it('沒有那個字面 → 不命中(不是丟例外)', () => {
    expect(migrationsWithRailCap([{ name: 'a.sql', body: 'CREATE TABLE y ();' }])).toEqual([]);
  });
});
