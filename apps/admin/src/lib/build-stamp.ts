import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * build 戳記的讀取端(M2;`~/pcm-mailbox/R3-plan-M2-BUILD_OK戳記-20260829.md`)。
 *
 * 🔴 **為什麼不直接看產物在不在**:2026-08-29 實測 `next build` **rc=1 而 `.next/static/chunks`
 *    仍被寫出 28 個檔**(時間戳是當次)⇒ **「產物存在」在【成功】與【失敗但寫了一半】
 *    兩個世界印同一個綠。** 戳記由 `scripts/build-with-stamp.sh` **先刪再寫、rc=0 才寫**
 *    ⇒ 失敗世界留下的是【無戳記】,而缺席不需要被解讀。
 *
 * 🔴 **三態,不是兩態** —— 而第二態【兩個 hash 都要印】:
 *    只印「不符」的話,讀的人不知道是【他舊】還是【我舊】⇒ 那是訊號自己缺分母。
 *
 * ══ 🔴🔴 這道警告【印在哪】—— 單一權威,呼叫端只留指標 ═══════════════════════
 * **2026-09-01 之前的事實:它哪裡都沒印。** `readBuildStamp()` 算出 `stale` → `requireFreshBuild()`
 * 把它包進**回傳值** → 而**四個呼叫端全部丟掉回傳值** ⇒ 📌 **警告被算出來, 然後掉在地上。**
 * 🛑 而那四處的註解**逐字寫著**「HEAD 不同(**兩個 hash 都印**)」⇒ **碼沒說謊, 說謊的是註解。**
 * 🔴 **它比「沒有這道警告」難查一格**:`git grep "戳記 HEAD"` **會命中**
 *    ⇒ **去查「有沒有這道警告」的人會查到【有】。**
 *
 * ✅ **2026-09-01 修:印移進 `requireFreshBuild()` 自己**(見該函式上方那格 —— 慣例 vs 機制)。
 * 🛑 **仍然不判紅**:`turbo.json` 的 `build.outputs` 含 `.next/**` ⇒ 戳記會被 replay,
 *    而 HEAD 不是 task hash 的輸入 ⇒ 比 HEAD 判紅是**常態假紅**。
 *
 * 🔴🔴 **而「有印」不等於【看得到】—— 隔離探針實跑**(vitest **4.1.5**、node env、非 TTY;
 *    三發都有 `Test Files` 那行 ⇒ 探針真的跑了。⚠️ 第一版探針三發全印 0 而我差點寫成結論,
 *    成因是 `--config /dev/null` 讓 vitest 沒起來 ⇒ **尺沒接上時,它印的是好消息**):
 * ```
 * marker 在 beforeAll + 測試通過 + 預設 reporter ⇒ 命中 0
 * marker 在 beforeAll + 同檔有 it 失敗 + 預設     ⇒ 命中 2   ← 紅的時候讀得到
 * marker 在 beforeAll + 測試通過 + verbose        ⇒ 命中 1
 * ```
 * ⚠️ **射程分兩種,不要合併**(R2/R3):三支 browser 測試在 `beforeAll` 呼叫 ⇒ **同檔紅就讀得到**;
 *    而 `page-measure.test.tsx` 從 `emit*` 裡呼叫(在 `it` 內)⇒ 射程是**同一個 `it` 紅**。
 * ⇒ 📌 **本片把病從③(算了然後丟掉)推進到①(通過時看不到),沒有推到「解決」。**
 *    **底座換掉要不要在 commit 的路上出聲**會動 `.husky/` ⇒ 2026-09-01 由主視窗接,不在本片。
 *
 * ⚠️ **既有慣例**:`page-measure.test.tsx` 裡那段「🔴🔴 **寫檔, 不用 `console.log`**」已經否決過
 *    console(它改寫進 `OUT_DIR`)。**本片沒照抄,理由:** 那一格是**留給人事後看的報告**、有一個
 *    人會去的地方;本片是**當下這一發的警告**,而印進函式之後四處必然一致 ⇒ 數得出跑過幾支。
 *    (用**那段話的字面**當錨,不用行號 —— 這支檔本片自己就改了 5 次。)
 *
 * ⚠️ **覆蓋範圍(與「會不會印」是兩個不同的洞)**:這道檢查只掛在 admin 的 **4 支 browser 測試**上
 *    ⇒ **沒跑那四支 = 完全沒有這道檢查**。而 `apps/storefront/.next/BUILD_OK` **檔案存在**,
 *    卻沒有任何 TS 讀它(2026-09-01 量,ref=`dac31d72` 已 commit 版:
 *    `git grep -lF "build-stamp" HEAD -- apps/storefront/**` ⇒ **0** · 🟢 正對照 `apps/admin/**` ⇒ **5**)。
 *    🔴 **而「零讀取端」講得比尺寬**:`scripts/why-is-this-red.sh` 有一行 `test -e` 那個路徑
 *    ⇒ 正確說法是**「零 TS 讀取端,而 shell 有一處在看它存不存在」**(R3 F6)。
 *
 * 🔵 **而這件事不是推論** —— 2026-09-01 清晨本片開工、跑 `pnpm build` **之前**,線【權限登入】那棵樹:
 *    戳記 `head=6c3f9bb0` / HEAD `dac31d72` ⇒ **stale 當時為真**,而該窗整夜跑三綠、commit 3 顆,
 *    **沒有任何一發說過這件事**。⛔ ~~原句寫「06:2x … 當下為真」~~ 時點是編的,
 *    而**本片自己的 build 已把戳記重寫** ⇒ 📌 **我一邊寫「這不是推論」, 一邊親手刪掉了那個證物。**
 */
export type BuildStampVerdict =
  | { ok: true; head: string; at: string; dirtyCount: number; stale: string }
  | { ok: false; reason: string };

/** `.next` 在 app 根。本檔在 `apps/admin/src/lib/` ⇒ **上溯兩層**到 `apps/admin`。
 *  (⛔ ~~原註解寫「3 層」~~ —— codex 2026-08-29 抓到:**碼是對的,錯的是那句話**。) */
function nextDir(): string {
  return join(__dirname, '..', '..', '.next');
}

function currentHead(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/**
 * 工作樹有幾項未 commit。
 *
 * 🔴 **這個數不是雜訊,而它是本機制【誠實殘餘】的那一格**(plan 22:5x 定案:固定加印,不是選配):
 *    戳記綁的是 HEAD,而 **HEAD 相同、工作樹不同 ⇒ 量到的就不是同一份碼**。
 *    ⇒ 全樹內容 hash 太貴不做 ⇒ 那個殘留【印出來】,不藏在 plan 裡。
 *    📌 **寫在 plan 裡而工具不印 = 寫下限制不等於涵蓋。**
 */
function dirtyCount(): number {
  try {
    const out = execSync('git status --porcelain', { encoding: 'utf8' });
    return out.split('\n').filter((l) => l.trim() !== '').length;
  } catch {
    return -1; // -1 = 量不到(而它與 0 不是同一件事)
  }
}

export function readBuildStamp(): BuildStampVerdict {
  const path = join(nextDir(), 'BUILD_OK');
  if (!existsSync(path)) {
    return {
      ok: false,
      reason:
        '🔴 沒有 BUILD_OK 戳記 ⇒ 這個 app 沒有【成功】build 過(或上一次 build 失敗了)。\n' +
        '   先跑 `TURBO_FORCE=1 pnpm build`。\n' +
        '   ⚠️ `.next` 底下有沒有檔【不算數】—— 失敗的 build 也會留下寫了一半的產物。',
    };
  }
  let parsed: { head?: string; at?: string; app?: string; rc?: number };
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      head?: string; at?: string; app?: string; rc?: number;
    };
  } catch {
    return { ok: false, reason: `🔴 BUILD_OK 讀得到而解析不了(內容壞了):${path}` };
  }
  // 🔴 **也要驗 `app` 與 `rc`**(codex 2026-08-29:「讀者有假綠 —— 不驗 app／rc」)。
  //    少了這兩格,一個【別的 app 的戳記】或一個【手改成 rc:1 的戳記】都會被讀成綠。
  if (parsed.app !== 'admin') {
    return { ok: false, reason: `🔴 BUILD_OK 是別的 app 的戳記(app=${String(parsed.app)})⇒ 不算數` };
  }
  if (parsed.rc !== 0) {
    return { ok: false, reason: `🔴 BUILD_OK 的 rc 不是 0(rc=${String(parsed.rc)})⇒ 那不是一次成功的 build` };
  }
  const stampHead = parsed.head ?? '';
  const now = currentHead();
  if (!now) {
    return { ok: false, reason: '🔴 讀不到當前 HEAD(git 不可用)⇒ 無法判斷戳記是不是這一份碼的' };
  }
  // 🔴🔴 **HEAD 不同【不判紅,只警告】—— 這一格是 codex 2026-08-29 對抗審查逼出來的設計更正。**
  //    ~~原設計:HEAD 不同 ⇒ 紅~~ **作廢,理由是量到的**:
  //    `turbo.json` 的 `build.outputs` 含 `.next/**` ⇒ **`BUILD_OK` 會被 turbo 快取並 replay**,
  //    而 **HEAD 不是 task hash 的輸入** ⇒ 同一份 build inputs、不同 commit(例如只改了 docs)
  //    會 replay 一個舊 HEAD 的戳記 ⇒ **那會變成【常態假紅】。**
  //    📌 而假紅的下場不是被修,是【被習慣】—— 然後真紅來的時候沒有人看。
  //    ⇒ 所以判紅的只有【沒有成功 build 過】那一件(= 本機制真正要解的那個病);
  //      新舊由 turbo 的 input hash 負責,那本來就是它的工作。
  //    ⚠️ **而那個 HEAD 仍然印出來** —— 訊號不判它,但不藏它。
  const stale = stampHead !== now ? `⚠️ 戳記 HEAD ${stampHead.slice(0, 8)} ≠ 現在 ${now.slice(0, 8)}(turbo 可能 replay 了快取;非錯誤)` : '';
  return { ok: true, head: stampHead, at: parsed.at ?? '未知', dirtyCount: dirtyCount(), stale };
}

/**
 * 給測試用:戳記不成立就 throw(fail-closed),成立則**自己印一行**並回傳同一行字串。
 *
 * 🛑 **不 skip** —— 那會把「有守門」變成「有宣稱」(既有那三支 browser 測試已是這個立場)。
 *
 * 🔴🔴 **印在【這裡】而不是呼叫端 —— 這一格是 R3 換角度審查逼出來的,而它是機制優先律**:
 *    2026-09-01 本片第一版把 `console.info` 加在**四個呼叫端**上。它會動,而
 *    **第五個呼叫端仍然可以忘記接** ⇒ **那正是本片在修的那個 bug 本身。**
 *    📌 **⇒ 「四個地方都記得做」是慣例;「函式自己做」是機制。而慣例會再壞一次。**
 *    ⇒ 回傳值保留(不改成 `void`):呼叫端若哪天要拿它做別的事仍然拿得到,
 *      **而「有沒有印」不再取決於呼叫端。**
 */
export function requireFreshBuild(): string {
  const v = readBuildStamp();
  if (!v.ok) throw new Error(v.reason);
  // 🔵 **`dirtyCount === 0` 時不接那一句** —— 無條件接 `⚠️` 會讓兩個世界印同一個形狀,
  //    而施工中它幾乎永遠 > 0 ⇒ 那個 ⚠️ 會被習慣。(R3 findings F5。)
  //    ⚠️ 而 `-1`(量不到)**仍然要印** —— 那是第三種世界,不是「乾淨」。
  const dirty =
    v.dirtyCount < 0
      ? ' · ⚠️ 工作樹未 commit 項數:量不到'
      : v.dirtyCount > 0
        ? ` · ⚠️ 工作樹有未 commit 編輯 ${v.dirtyCount} 項`
        : '';
  const line = `BUILD_OK head=${v.head.slice(0, 8)} at=${v.at}${dirty}${v.stale ? ` · ${v.stale}` : ''}`;
  console.info(`[build-stamp] ${line}`);
  return line;
}
