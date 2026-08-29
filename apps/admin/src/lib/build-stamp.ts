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
 * 給測試用:戳記不成立就 throw(fail-closed),成立則回傳一行【自帶分母】的字串。
 *
 * 🛑 **不 skip** —— 那會把「有守門」變成「有宣稱」(既有那三支 browser 測試已是這個立場)。
 */
export function requireFreshBuild(): string {
  const v = readBuildStamp();
  if (!v.ok) throw new Error(v.reason);
  const dirty =
    v.dirtyCount < 0
      ? '⚠️ 工作樹未 commit 項數:量不到'
      : `⚠️ 工作樹有未 commit 編輯 ${v.dirtyCount} 項`;
  return `BUILD_OK head=${v.head.slice(0, 8)} at=${v.at} · ${dirty}${v.stale ? ` · ${v.stale}` : ''}`;
}
