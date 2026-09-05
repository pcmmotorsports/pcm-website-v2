/**
 * rpm-partial-report — 同步失敗時把「停在哪裡」寫下來(純觀測、零行為改動)。
 *
 * ## 為什麼有這支檔
 * `scripts/rpm-import.ts:653` 的 atomic 群迴圈失敗時,留下的是**半寫入的中間態**,
 * 不是「整批回捲」:
 * ```
 * 失敗點【之前】的批次   ⇒ 已經寫進去了(rpm-load.ts:139-152 每 500 列各自一個交易, 已 commit)
 * 失敗的那一群          ⇒ 整群沒進去
 * 失敗點【之後】的一切   ⇒ 【從來沒有被送出去】
 * ```
 * 2026-08-28 Gilles 那次,對方 repo / Sean / 主視窗**三方都讀成「整批回捲」**,
 * 而沒有人答得出「1,817 裡實際進去幾筆」——
 * 🔴 **那不是因為沒人查,是因為那個數字從來沒有被產生過。**
 *
 * ## 🔴 為什麼是【獨立一支檔】而不是寫在 rpm-import.ts 裡
 * `rpm-import.ts` 檔尾直接呼叫 `main()`(無 `import.meta` 守衛;當場量:`grep -c 'import.meta'` ⇒ 0)
 * ⇒ **它一被 import 就會把整個匯入跑起來** ⇒ **無法被單元測試**。
 * (旁證:同目錄的純模組 `rpm-load.ts` 有 `rpm-load.test.ts`,而 `rpm-import.ts` 沒有測試檔。)
 * ⇒ 主視窗 2026-08-28 拍 `Q1=乙`(單元層驗收)在 `rpm-import.ts` 裡**做不到** ⇒ 抽到本檔。
 * ⚠️ **這是對已批准 plan 的偏離**(plan 寫「只動 rpm-import.ts 一支」)——
 *   本檔是**純新增、零既有行為改動**,而偏離本身已回報主視窗。
 *
 * ## 🔴 天花板(引用前先讀)
 * **「行為沒變」這個宣稱只在【單元層】成立** —— 我們證的是
 * 「餵一個會 throw 的假 syncFn 時,流程與修前相同」,
 * **沒有證「真的連 DB 跑一次時相同」**。缺的檢查 = 起拋棄式 PG 實跑一次。
 */

import { mkdirSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 取錯誤字面。🔴 `String(e)` 對一個 `toString` 會拋的物件**自己會拋**
 * (codex 2026-08-28 must-fix 的其中一條路)⇒ 包起來。
 */
function safeMessage(e: unknown): string {
  // 🔴 `e.message` 本身可以是一個【會拋的 getter】(codex R2)⇒ 連讀它都要包。
  try {
    if (e instanceof Error) return e.message;
    return String(e);
  } catch {
    return '(這個錯誤物件連取訊息都會拋)';
  }
}

export interface AtomicPartialWrite {
  supplierSlug: string;
  /** 分母。來源 = `variantWork.atomicGroups.length`,而那是迴圈前就建好的普通陣列
   *  (`rpm-load.ts:229-232`)⇒ **量到的**,不是查詢結果、不是估計。 */
  total: number;
  /** 已成功的群,**逐個列名**。 */
  done: string[];
  /** 失敗的那一群。 */
  failed: string;
  /** 失敗的錯誤字面(原封,不改寫)。 */
  failedMessage: string;
  /**
   * 🔴 **從來沒被送出去**的那些,**逐個列名**。
   * 來源 = `atomicGroups.slice(gi + 1)` ⇒ **列舉**。
   * ⚠️ **不是** `total - done.length - 1` —— 那個是**推的**,而這個是**量到的**;
   *    而且列名字同時回答了「要去看哪幾群」,不只是「有幾群」。
   */
  notRun: string[];
}

/**
 * 落點目錄 —— **從本檔自己的位置推, 不是相對 `process.cwd()`**(⟦f3-HALFWRITELOGDIR⟧)。
 *
 * ⛔ 舊值 ~~`const LOG_DIR = 'logs'`~~ 是**相對路徑** ⇒ 對 `process.cwd()` 解析。
 * 🔴 **兩個世界實測(2026-09-02 `-f3` 量、2026-09-03 `-auth` 複現)**:
 * ```
 * 從 repo 跑     ⇒ /Users/sean_1/pcm-wt-auth/logs/rpm-import-partial-…
 * 從 /tmp 跑     ⇒ /private/tmp/logs/rpm-import-partial-…
 * ```
 * 🛑 **而它印給人看的那一行【兩種情況逐字相同】**(`⇒ 已寫入 logs/rpm-import-partial-…`)
 *    ⇒ 🎯 **讀的人會以為是 repo 的 `logs/`, 而那份紀錄可能落在他找不到的地方。**
 *
 * 🔴 **而失敗方向不只是「找不到」**:`.gitignore:48` 的 `logs/` **只涵蓋 repo 的那一個**
 *    ⇒ 從**別的 repo** 底下跑, 這份含【供應商 ID + 原始 DB 錯誤字面】的紀錄
 *    **可能變成那個 repo 的 tracked 檔**。
 *
 * ✅ 修法照 repo 既有先例(`scripts/admin-probe/up.sh:47` 的 `REPO="$(cd "$(dirname "$0")/../.." && pwd)"`
 *    與 `scripts/storefront-projection-leak-guard.test.ts:202` 的 `fileURLToPath(new URL(…, import.meta.url))`)
 *    —— **不自己發明一個形狀**。
 * 🔵 `logs/` 仍在 `.gitignore:48`(`git check-ignore -v logs/x.log` rc=0;
 *    正對照 `scripts/rpm-import.ts` rc=1 ⇒ 那把尺兩個方向都會動)。
 * 🛑 **本修法證不到什麼**:它保證**落點**固定, **不保證**有人去看那份檔;
 *    也**沒有查**今天有沒有人真的從別的目錄跑過它 —— 這是一個機制, 不是一次事故。
 */
export const LOG_DIR = fileURLToPath(new URL('../logs/', import.meta.url));

/**
 * 產生要印/要寫的那幾行。**純函式** —— 不碰檔案系統、不碰時間,好測。
 *
 * 🔴 `N + M + K === total` 這一條是**自檢**,**不是 K 的來源**。
 *    K 是 `slice` 列舉出來的;這一行只用來在「我寫錯了」的時候出聲。
 */
export function formatAtomicPartialWrite(r: AtomicPartialWrite): string[] {
  const n = r.done.length;
  const m = 1; // 失敗的那一群:就是它,一群
  const k = r.notRun.length;
  const lines = [
    `[rpm-import] 🔴 atomic 同步中止 —— 這【不是整批回捲】,是半寫入的中間態`,
    `  供應商        ${r.supplierSlug}`,
    `  atomic 群總數 ${r.total}`,
    `  成功 N        ${n}`,
    `  失敗 M        ${m}   ${r.failed}`,
    `  未執行 K      ${k}   (從來沒有被送出去)`,
    `  ⚠️ 失敗點【之前】的一般變體 upsert 已經 commit 了 —— 那些筆數不在上面三個數裡`,
    `  錯誤字面(原封):${r.failedMessage}`,
    `  已成功的群:${n === 0 ? '(無)' : r.done.join(' ')}`,
    `  未執行的群:${k === 0 ? '(無)' : r.notRun.join(' ')}`,
  ];
  if (n + m + k !== r.total) {
    // 自檢紅旗:三個數加起來對不上分母 ⇒ 是我算錯了,不是資料有問題。
    lines.push(`  🔴 自檢失敗:N+M+K = ${n + m + k} ≠ 總數 ${r.total} ⇒ 這份紀錄本身不可信`);
  }
  return lines;
}

/**
 * 逐群跑 atomic 同步。**零行為改動**:成功路徑與修前逐字相同;
 * 失敗時先留痕、再**原封 re-throw**(不包裝、不換型別)。
 *
 * 🔴 抽成函式的唯一理由 = **可測**(`rpm-import.ts` 一被 import 就會跑 `main()`)。
 * 🔴 `report` 可注入 ⇒ 測試不碰檔案系統。
 */
export async function runAtomicGroups<G extends { externalId: string }>(
  groups: readonly G[],
  supplierSlug: string,
  syncOne: (group: G) => Promise<void>,
  report: (r: AtomicPartialWrite) => void = reportAtomicPartialWrite,
): Promise<void> {
  const done: string[] = [];
  // 🔴 進度指標:給【被砍在半路】那條路讀的(見本檔末段 `installKillReporter`)。
  //    它與下面那個 `report(...)` 是**兩條不同的路**:`catch` 只看得到「有東西被丟出來」,
  //    而 `SIGTERM` 是**沒有東西被丟出來就死掉** ⇒ 那一條 `catch` 永遠看不到。
  setKillProgress({ supplierSlug, total: groups.length, done: 0, current: null });
  for (const [gi, group] of groups.entries()) {
    setKillProgress({ supplierSlug, total: groups.length, done: done.length, current: group.externalId });
    try {
      await syncOne(group);
      done.push(group.externalId);
    } catch (e) {
      // 🔴🔴 **整個留痕動作包在 try 裡**(codex 2026-08-28 must-fix):
      //   若 `report(...)` 自己拋(或 `String(e)` 對一個惡意 toString 拋),
      //   那顆新錯會**取代**原本要丟出去的 `e` ⇒ 上游看到的就不是同一件事了。
      //   📌 **一個為了觀測而加的東西,不可以變成新的失敗來源** —— 這一格是那句話的第二個落點。
      try {
        // 🔴 「未執行」用**列舉**不用減法:剩下那些本來就在陣列裡,直接切出來。
        //    `total - done.length - 1` 是**推的**;`slice` 是**量到的**,
        //    而且它同時回答「要去看哪幾群」,不只是「有幾群」。
        report({
          supplierSlug,
          total: groups.length,
          done,
          failed: group.externalId,
          failedMessage: safeMessage(e),
          notRun: groups.slice(gi + 1).map((g) => g.externalId),
        });
      } catch (reportErr) {
        // 吞掉。留痕失敗只降級成一行,**絕不改變下面那個 throw**。
        // 🔴🔴 **連這一行的「取訊息」都要包**(codex R2 must-fix):
        //   `reportErr.message` 若是一個【會拋的 getter】,這個 catch 自己就會拋
        //   ⇒ 跳過下面的 `throw e` ⇒ **原錯還是被取代了**。
        //   📌 一個為了「不改變失敗行為」而寫的 catch,自己成了改變失敗行為的那一步。
        try {
          console.error(`[rpm-import] ⚠️ 留痕本身失敗(原本的錯誤照樣往上丟):${safeMessage(reportErr)}`);
        } catch {
          /* 連印都印不出來也不能擋住下面那個 throw */
        }
      }
      throw e; // 🔴 原封丟回去 —— 上游對它的判讀必須與修前逐字相同。
    }
  }
  // 🔵 正常跑完就把指標清掉 —— 否則之後任何一發訊號都會印出一份【已經結束】的進度。
  setKillProgress(null);
}

/**
 * 印到終端機 **並** 寫一份帶時間戳的檔到 `logs/`。
 *
 * 🔴 **寫檔失敗不可以變成新的失敗來源**:整段包在 try 裡,寫不出來就退回只印終端機並說一句。
 *    📌 一個為了觀測而加的東西,不可以變成新的失敗來源。
 *
 * 🔴 **檔名帶時間戳、不覆蓋上一次** —— 📌 一份會被下一次蓋掉的紀錄,只能答「這一次」;
 *    而今天問不出 1,817 的原因,正是「上一次停在哪」查不到。
 *
 * ⚠️ 只寫 `externalId` 與錯誤字面,**不寫任何憑證/連線字串**。
 */
export function reportAtomicPartialWrite(
  r: AtomicPartialWrite,
  nowIso: string = new Date().toISOString(),
): void {
  const lines = formatAtomicPartialWrite(r);
  for (const l of lines) console.error(l);

  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const stamp = nowIso.replace(/[:.]/g, '-');
    // 🔴 **同毫秒兩個 process 會產生同一個檔名,而 `writeFileSync` 預設【截斷覆寫】**
    //   ⇒ 上一份痕跡會消失(codex 2026-08-28 must-fix)。
    //   📌 這正是本檔存在的理由的反面:**一份會被蓋掉的紀錄,只能答「這一次」。**
    //   兩道:①檔名帶 pid ②用 `wx`(檔已存在就拋)⇒ 撞到就換一個名字,不覆寫。
    const base = join(LOG_DIR, `rpm-import-partial-${r.supplierSlug}-${stamp}-${process.pid}`);
    let path = `${base}.log`;
    for (let n = 0; ; n += 1) {
      try {
        writeFileSync(path, lines.join('\n') + '\n', { encoding: 'utf8', flag: 'wx' });
        break;
      } catch (collide) {
        if ((collide as NodeJS.ErrnoException).code !== 'EEXIST' || n >= 20) throw collide;
        path = `${base}-${n + 1}.log`; // 撞到就換名字, 絕不覆寫上一份
      }
    }
    console.error(`  ⇒ 已寫入 ${path}`);
  } catch (writeErr) {
    // 退回只印終端機。**不 re-throw** —— 觀測失敗不得改變匯入的結果。
    console.error(
      `  ⚠️ 上面那份紀錄【寫檔失敗】,只留在終端機(跑完就沒了):` +
        `${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 被【砍掉】在半路時留一行 —— 而它與上面那份報告【看到的不是同一種死法】
// ══════════════════════════════════════════════════════════════════════════
//
// 🔴🔴 **為什麼要另外一條路**:上面 `runAtomicGroups` 的留痕掛在 `catch` 上,
//    ⇒ 它的前提是「有一個錯誤被丟出來」。
//    而 GitHub Actions 的 `timeout-minutes`(`rpm-sync.yml`)是**把 job 砍掉** ——
//    送 `SIGTERM`,不是丟例外 ⇒ 🛑 **那份報告對「逾時」這一種死法【結構上失明】。**
//    📌 而逾時正是板列 `⟦supply-SYNCTIMEOUTPARTIAL⟧` 講的那一種。
//
// 🔵 **量到的**(2026-09-05 線【身分】`-auth`,`gh run list --limit 25`):
//    25 班之中最長的 sync job = `samco` **8.7 分**,對 45 分的上限只用掉 19%
//    ⇒ **今天沒有人撞到它** ⇒ 這一段是**給還沒發生的那一天**寫的,不是在修一個現行症狀。
//
// ⚠️ **這一段【確實改了一點行為】,寫在這裡不藏**:
//    掛上 `SIGTERM` 監聽器會**取代 Node 的預設處置**。所以處理器印完就 `process.exit(128+n)`
//    ⇒ 行程**照樣立刻死**,而**退出碼從「被訊號終止」變成 143 / 130**。
//    🔵 對 GitHub Actions 沒有差別(逾時的 job 已經被標成 cancelled,不看退出碼);
//    🛑 而若有人在別的地方用 `$?` 去分辨「是不是被訊號殺的」,那裡會看到不同的值。
//
// 🔴 **為什麼用 `writeSync(2, …)` 不用 `console.error`**:訊號處理器裡接著就 `exit`,
//    而 `process.stderr` 在管線(CI 就是管線)上是**非同步**的 ⇒ `console.error` 那一行
//    很可能**還沒被寫出去行程就沒了**。`writeSync` 是同步的,寫完才回來。
//    📌 一行「為了留下證據」而寫的日誌,如果會在最需要它的那一刻消失,它等於不存在。

/** 被砍的那一刻,手上正在做什麼。欄位都是**量到的**,不是估的。 */
export interface KillProgress {
  supplierSlug: string;
  /** 分母 = `groups.length`(迴圈前就建好的普通陣列)。 */
  total: number;
  /** **已經寫進去**的群數(不含正在做的那一群)。 */
  done: number;
  /** 正在做的那一群;還沒進迴圈時是 `null`。 */
  current: string | null;
}

let killProgress: KillProgress | null = null;

/** 更新進度指標。`null` = 現在不在那個迴圈裡。 */
export function setKillProgress(p: KillProgress | null): void {
  killProgress = p;
}

/** 只給測試讀。 */
export function getKillProgress(): KillProgress | null {
  return killProgress;
}

/**
 * 那一行的字面。抽出來的唯一理由 = **可測**(不必真的送訊號就驗得了字面)。
 * 🔴 `current` 是 `null` 時要說得出**是哪一種 null** —— 「還沒開始」與「已經跑完」
 *    對接手的人是兩件事,而它們在資料上長得一樣 ⇒ 用 `killProgress` 在不在來分。
 */
export function formatKillLine(p: KillProgress | null, signal: string): string {
  if (!p) {
    return (
      `[rpm-import] 🔴 被 ${signal} 砍掉 —— 而**不在群迴圈裡**` +
      `(還沒開始寫、或已經寫完)⇒ 這一發沒有半套的群。\n`
    );
  }
  const at = p.current === null ? '(還沒進到第一群)' : p.current;
  return (
    `[rpm-import] 🔴 被 ${signal} 砍掉在半路:supplier=${p.supplierSlug} ` +
    `已寫完 ${p.done}/${p.total} 群 · 正在寫的那一群=${at} · ` +
    `⇒ 之後那 ${Math.max(p.total - p.done - (p.current === null ? 0 : 1), 0)} 群【從來沒有被送出去】。` +
    `下一班會重寫(upsert 冪等), 而在那之前這一家是半新半舊。\n`
  );
}

/**
 * 掛上 `SIGTERM` / `SIGINT` 的留痕。**回傳一個拆掉它的函式**(測試要拆,否則會殘留)。
 *
 * @param write 寫那一行(預設同步寫 fd 2)。
 * @param exit  印完之後怎麼結束(預設 `process.exit`)。**注入是為了測試,不是為了關掉它。**
 */
export function installKillReporter(
  write: (s: string) => void = (s) => {
    writeSync(2, s);
  },
  exit: (code: number) => void = (code) => {
    process.exit(code);
  },
): () => void {
  const nums: Record<string, number> = { SIGTERM: 15, SIGINT: 2 };
  const handlers: Array<[NodeJS.Signals, () => void]> = [];
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    const h = () => {
      // 🔴 留痕自己不准變成新的失敗來源(同本檔上半那一格的理由)。
      try {
        write(formatKillLine(killProgress, sig));
      } catch {
        /* 印不出來也不能擋住下面那個 exit */
      }
      exit(128 + (nums[sig] ?? 0));
    };
    handlers.push([sig, h]);
    process.on(sig, h);
  }
  return () => {
    for (const [sig, h] of handlers) process.off(sig, h);
  };
}
