import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MANUAL_REFUND_ENTRY_BLOCKED_BY_787 } from './manual-refund-entry-gate';

/**
 * manual-refund-787-trigger.test.ts — `#787` 硬閘的解除觸發器(機制,不是提醒)。
 *
 * 🔴 主視窗 2026-08-20 裁定的理由,逐字:「註解不會在『條件成立了』的那一刻說話」。
 *
 * ══ 2026-08-22 片 D3-c 換靶(**這一段是本檔的變更史,不要刪**)══════════════════
 * **舊靶**:`supabase/migrations/` 的檔案系統上有沒有 `admin_void_manual_refund` 這個字面。
 * **它完成了它的工作,而且它是對的** —— 那支 migration 2026-08-20 落地,本檔如設計地紅了。
 * 🔴 **但它從那一刻起【永遠紅】,而該做的那一片(作廢入口)當時還沒排** ——
 *    ⇒ 它在 dev 上紅了整整兩天,而**每一次全套測試都會看到它紅、然後略過**。
 *    ⇒ 那個習慣比那道閘本身危險(memory `feedback_a-guard-you-cant-finish-today-becomes-noise`)。
 *
 * **新靶**:`supabase/APPLIED.tsv` 有沒有 D3-c 那支 GRANT migration(`20260822120000`)。
 * 換靶的理由 —— **舊靶量的是「檔在磁碟上」,而解除條件要的是「權限真的開了」**:
 *   #787 的解除條件③(2026-08-22 線 C 補進 `manual-refund-entry-gate.ts`)是
 *   「`service_role` 對 `admin_void_manual_refund` 有 EXECUTE」。
 *   ⇒ 那件事**只有 apply 之後才成立**,而本 repo 記錄 apply 的地方就是 `APPLIED.tsv`。
 *   ⇒ 新靶今天是**綠的**(那支還沒 apply),而它會在**該紅的那一刻**紅 —— 那正是舊靶做不到的。
 *
 * ⚠️ **新靶的誠實邊界(它量得比它聽起來的窄)**:
 *   · `APPLIED.tsv` 是**人手寫**的帳本 ⇒ 它答的是「有沒有人記了這一筆」,不是「DB 現在什麼狀態」。
 *     真要確認,跑那句唯讀 SQL(寫在 `manual-refund-entry-gate.ts` 的解除條件③裡)。
 *   · 它只掃字面 `20260822120000` ⇒ 有人改檔名/改編號就掃不到。
 *   · 🔴 **它分不出「apply 成功」與「apply 失敗但還是被記了一行」** —— 而那一格
 *     由該支 migration 自己的四道後置斷言擋(A1/A2/A3/A4;`scripts/d3c-grant-probe.sh` 驗過它們有判別力)。
 * ═══════════════════════════════════════════════════════════════════════════
 */

const REPO = resolve(__dirname, '../../../../..');
const GRANT_MIGRATION_FILE =
  'supabase/migrations/20260822120000_m4b_e10_d3c_grant_void_manual_refund.sql';
/**
 * D3-c GRANT migration 的時間戳。
 *
 * 🔴 **從檔名【推導】,不另寫一份字面**(2026-08-22 突變測試當場抓到):
 *   第一版兩個常數各寫各的,而我把 `GRANT_MIGRATION_STAMP` 突變成 `'99999999999999'` 之後
 *   —— **四格全綠**。因為 [4] 驗的是 `GRANT_MIGRATION_FILE` 存不存在,
 *   而 [1] 拿一個永遠不會在 `APPLIED.tsv` 出現的編號去 grep ⇒ 永遠回 false ⇒ 永遠綠。
 *   ⇒ 🔴 **那道自檢守的是【另一個常數】,而真正承重的那個沒有人守。**
 *   推導之後兩者不可能分岔:檔名改了、編號跟著改;檔名沒了、[4] 紅。
 */
const GRANT_MIGRATION_STAMP = /(\d{14})_/.exec(GRANT_MIGRATION_FILE)?.[1] ?? '';

/**
 * `APPLIED.tsv` 裡有沒有這一筆。讀檔失敗一律回 false 並在 [4] 那格用真實現況說話。
 *
 * 🔴 **錨在行首 + tab(Fable R2 nit F4)**:第一版用 `.includes(STAMP)`,而它的**分母是整支檔的
 *   全部字元** —— 那支 TSV 裡有大量 prose(每一列第四欄是人寫的長段落,還有以 `#`/`⚠️` 開頭的行)。
 *   ⇒ 只要有人在裡面寫一句「`20260822120000` **尚未** apply」,這個觸發器就會紅著說「已 apply」。
 *   📌 **這與我自己今天報過的那個形狀同款**(grep 的分母是整支檔,而說明文字長得跟真值一樣)
 *      —— 而它就在我自己的碼裡。
 *   ⇒ TSV 的資料列一定是 `<stamp>\t...` 開頭 ⇒ 錨 `^<stamp>\t`,prose 行進不來。
 */
function tsvHasAppliedRow(tsv: string, stamp: string): boolean {
  return tsv.split('\n').some((line) => line.startsWith(`${stamp}\t`));
}

function grantMigrationRecordedApplied(): boolean {
  try {
    return tsvHasAppliedRow(readFileSync(resolve(REPO, 'supabase/APPLIED.tsv'), 'utf8'), GRANT_MIGRATION_STAMP);
  } catch {
    return false;
  }
}

/**
 * 純邏輯:給定「GRANT 已被記為 apply」與「硬閘是否仍鎖著」,回傳這格該不該紅。
 * 拆成純函式是為了讓 [2] 能在不動任何檔案的情況下,對著一個假的「已 apply」狀態
 * 驗證斷言真的會失敗 —— 同族 caller-gate.test.ts 的自檢精神(量具要能表演給自己看)。
 */
function evaluateTrigger(
  grantApplied: boolean,
  stillBlocked: boolean,
): { ok: boolean; reason: string } {
  if (grantApplied && stillBlocked) {
    return {
      ok: false,
      reason:
        `supabase/APPLIED.tsv 出現了 ${GRANT_MIGRATION_STAMP}(D3-c GRANT migration)` +
        ',而 MANUAL_REFUND_ENTRY_BLOCKED_BY_787 還是 true。\n' +
        '⇒ #787 的解除條件③(service_role 對 admin_void_manual_refund 有 EXECUTE)可能已經成立。\n' +
        '⚠️ 本檢查讀的是【人手寫的 apply 帳本】,不是 DB ⇒ 先自己跑那句唯讀 SQL 確認:\n' +
        "     select has_function_privilege('service_role', p.oid, 'EXECUTE'), p.proacl\n" +
        '       from pg_proc p join pg_namespace n on n.oid = p.pronamespace\n' +
        "      where n.nspname = 'public' and p.proname = 'admin_void_manual_refund';\n" +
        '確認為 true 之後才動手:\n' +
        '① 把 manual-refund-entry-gate.ts 的 MANUAL_REFUND_ENTRY_BLOCKED_BY_787 改成 false' +
        '(連同它上面那段函式註解一起刪)\n' +
        '② 到 manual-refund-caller-gate.test.ts 的 CALLER_ALLOWLIST 更新 why(它現在寫著「仍為 true」)\n' +
        '③ 🔴 然後把【本檔】刪掉 —— 它是一條絆線,工作完成了就該退場,不是改成永遠會過',
    };
  }
  // 🔴🔴 **反方向(Fable R2 F2;而它引的是我自己今天寫的那條教訓:
  //    「約束有兩個方向就要兩發突變」)**:
  //    封印被解除(`stillBlocked === false`)而 GRANT **沒有** apply ——
  //    那正是 `manual-refund-entry-gate.ts` 檔頭第 45-50 行**自己警告的那個結局**:
  //    入口渲染得出來、RPC 在執行期被 42501 擋掉,而 typecheck / lint / 測試【全綠】。
  //    ⇒ 第一版只守「該解沒解」,不守「不該解卻解了」—— 而後者才是會出事的那個方向。
  if (!grantApplied && !stillBlocked) {
    return {
      ok: false,
      reason:
        `MANUAL_REFUND_ENTRY_BLOCKED_BY_787 已經是 false,而 supabase/APPLIED.tsv 裡【沒有】 ` +
        `${GRANT_MIGRATION_STAMP}(D3-c GRANT migration)。\n` +
        '⇒ 登記入口開著,而 service_role 對 admin_void_manual_refund 很可能還沒有 EXECUTE\n' +
        '⇒ 員工登記得了、而「登記錯了改不掉」—— 那正是 #787 封印的那個風險本體。\n' +
        '處置(擇一):① 把封印改回 true,直到那支 GRANT 真的 apply\n' +
        '           ② 若 GRANT 其實已經 apply 了只是沒記進 APPLIED.tsv ⇒ 補記那一行\n' +
        '⚠️ 本檢查讀的是【人手寫的 apply 帳本】,不是 DB ⇒ 先跑那句唯讀 has_function_privilege 確認',
    };
  }
  return { ok: true, reason: '' };
}

describe('#787 解除觸發器(靶 = D3-c GRANT 已被記進 APPLIED.tsv)', () => {
  it('[1] 現在:GRANT 還沒被記進 APPLIED.tsv → 綠(量到的,不是假設)', () => {
    const applied = grantMigrationRecordedApplied();
    expect(
      applied,
      `${GRANT_MIGRATION_STAMP} 已經出現在 supabase/APPLIED.tsv —— 去確認 service_role 的 EXECUTE，` +
        '然後解除 #787 的硬閘並刪掉本檔',
    ).toBe(false);
    expect(evaluateTrigger(applied, MANUAL_REFUND_ENTRY_BLOCKED_BY_787).ok).toBe(true);
  });

  it('[2] 🔴 反面驗證:餵一個假的「已 apply」狀態,確認這格真的會紅(不是死斷言)', () => {
    const faked = evaluateTrigger(true, MANUAL_REFUND_ENTRY_BLOCKED_BY_787);
    expect(faked.ok).toBe(false);
    expect(faked.reason).toContain('has_function_privilege');
    expect(faked.reason).toContain(GRANT_MIGRATION_STAMP);
  });

  it('[3] 正向對照:硬閘一旦解除(false)+ GRANT 已 apply → 不再紅', () => {
    expect(evaluateTrigger(true, false).ok).toBe(true);
  });

  // 🔴 F2 的那一發:少了這格,「不該解卻解了」在這支測試上是**全綠**的。
  it('[3b] 🔴 反方向:封印已解除而 GRANT 沒 apply → 必須紅(入口開著而 RPC 叫不動)', () => {
    const r = evaluateTrigger(false, false);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('已經是 false');
    expect(r.reason).toContain(GRANT_MIGRATION_STAMP);
  });

  it('[3c] 正向對照:兩邊都還沒動(沒 apply、封印還在)→ 綠', () => {
    expect(evaluateTrigger(false, true).ok).toBe(true);
  });

  // 🔴 沒有這一格,[1] 會在「檔名被改掉 / 檔案根本不存在」時**照樣綠** ——
  //    那是「我找不到 ⇒ 沒發生」與「真的沒發生」印同一句話的那個病。
  // ⚠️ **用 existsSync 不用 `git ls-files`**:第一版用了 `git ls-files`,而它**只看得到已追蹤的檔**
  //    ⇒ 這支 migration 還是 `??`(未 commit)時整格紅,而紅的原因與 #787 一點關係都沒有。
  //    (那正是 `docs/lessons-learned.md` §12-43 那條:未追蹤/未收割的檔在 git 的尺下是隱形的。)
  //    ⇒ 這一格要問的是「那個檔在不在磁碟上」,而那把尺就是 existsSync。
  it('[4] 🔴 量具自檢:那支 GRANT migration 的檔案要真的在(否則上面的綠沒有意義)', () => {
    // 🔴 先驗編號推導成功 —— 推導失敗會落成空字串,而 `''` 在 `.includes('')` 是**永遠 true**
    //    ⇒ [1] 會變成「永遠有 apply」而永遠紅,那是紅錯地方,一樣是壞的量具。
    expect(GRANT_MIGRATION_STAMP, '從檔名抽不出 14 位編號 ⇒ 檔名格式變了').toMatch(/^\d{14}$/);
    expect(
      existsSync(resolve(REPO, GRANT_MIGRATION_FILE)),
      `找不到 ${GRANT_MIGRATION_FILE}。它被改名或刪了 ⇒ 本檔對「有沒有 apply」的任何答案都不算數。` +
        '⚠️ 這一格紅的原因【與 #787 無關】,是量具自己壞了',
    ).toBe(true);
  });
});

describe('tsvHasAppliedRow — 分母是【資料列】不是整支檔(Fable R2 nit F4)', () => {
  const STAMP = '20260822120000';

  it('真的有那一列 → true', () => {
    expect(tsvHasAppliedRow(`${STAMP}\thash\t2026-08-22\tSean 貼的\n`, STAMP)).toBe(true);
  });

  // 🔴 這一格是本節存在的理由:`.includes(STAMP)` 在這裡會回 true,而那是【反過來的答案】。
  it('🔴 只是 prose 裡提到那個編號 → false(說「尚未 apply」不等於已 apply)', () => {
    const tsv = `# ⚠️ 20260822120000 尚未 apply,等 Sean 貼\n20260820100000\thash\t2026-08-20\t…\n`;
    expect(tsvHasAppliedRow(tsv, STAMP)).toBe(false);
    expect(tsv.includes(STAMP), '對照:舊寫法在同一份輸入上會說「已 apply」').toBe(true);
  });

  it('編號出現在別欄(不是行首)→ false', () => {
    expect(tsvHasAppliedRow(`20260820100000\thash\t2026-08-22\t取代了 ${STAMP}\n`, STAMP)).toBe(false);
  });

  it('空檔 → false(而不是丟例外)', () => {
    expect(tsvHasAppliedRow('', STAMP)).toBe(false);
  });
});
