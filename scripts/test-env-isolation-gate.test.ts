// test-env-isolation-gate.test.ts — 釘住「測試行程看不到 DB 類憑證」。
//
// 🔴 **它為什麼存在**:2026-08-27 線1 量到 —— `apps/admin/next.config.ts` 那道正式庫閘
//    (`assertDevDbGate`)**只在 `next dev` 啟動時跑**,而 `vitest` 不載 `next.config`
//    ⇒ **那道閘對測試層完全不存在**。當天實測結果是乾淨的:
//      `.env*` 五支檔共 **49 個變數名(含重複)/ 30 uniq** ⇒ 測試行程看得到 **0** 支;
//      `ci.yml` 的 `secrets.` 命中 **0** 行。(reviewer 複量:兩種數法差 19,而兩個都複現得出來 ⇒ 標數法。)
//
//    ⚠️ **而那個 0 是【現況】,不是【機制】** —— 今天沒有憑證,是因為**沒有人把它放進去**,
//       不是因為有東西擋著。有人哪天在 `ci.yml` 加一行 `secrets.`,或在根目錄放一支
//       vitest setup 去 load dotenv ⇒ **那份盤查當場全假,而不會有任何訊號。**
//    ⇒ 本檔把那個 0 從「今天剛好是這樣」變成「它變了就會有人知道」。
//
// 🔴 **分母是動態的,不是一份寫死的清單**(交辦時的驗收條件,照抄):
//    寫死清單 ⇒ 明天多一個變數它照樣綠 ⇒ 又是一個「現況不是機制」。
//    本檔的分母 = 那幾支 `.env*` 檔裡**實際有的**名字,當場讀出來。
//
// 🔴 **只比對【名字】,絕不讀值、絕不寫出值、絕不 log。**
//    失敗訊息裡會出現**變數名**(那不是 secret,而且不講出是哪一支就沒人修得了),
//    **值一個字都不出現。**
//
// 🔴 **檔不存在 ⇒ fail-closed,不是靜靜通過**:
//    「一支 `.env` 都找不到」與「找到了而且全乾淨」如果都印綠,
//    那這道閘在**沒有 `.env` 的 CI 上就是一格恆綠的裝飾**,而它看起來一直在守。
//    ⇒ 分母為 0 就紅,並在訊息裡說清楚是分母壞了、不是有東西洩漏。
//    ⚠️ 代價明寫:有人合法地把所有 `.env*` 都刪掉(例如換一套設定方式)⇒ 本檔會紅。
//       那時**要改的是本檔的分母來源,不是把這一格關掉**。
//
// 🔴🔴 **本機與 CI 的分母【不一樣】,而這件事不寫下來就會被讀成同一個綠**(2026-08-27 當場量):
//    ```
//    git ls-files | grep '\.env'  ⇒ 只有 1 支:apps/storefront/.env.example
//    .gitignore:94 `.env*` 廣義擋掉, :96-97 只放行 .env.example
//    ⇒ 本機 5 支檔 / 49 個名字;CI checkout 之後 1 支檔 / 3 個名字
//    ```
//    ⇒ **第二格(名字比對)在 CI 上的射程只有那 3 個名字。**
//    ⇒ 而 CI 的威脅模型本來就不同:CI **直接注入 env**,那些名字可以完全不出現在任何 `.env*` 裡
//      ⇒ **CI 那一側扛住的是第三格**(`checkProdDbInDev`,分母是整個 `process.env`)。
//    📌 兩格不是重複,是**各自覆蓋一個對方看不到的世界**:
//       第二格看得到「本機真憑證被載進來」;第三格看得到「CI 注入了一個沒人宣告過的名字」。
//    🔴 **第四格(看值不看名字)是後來補的**,它關掉的正是 reviewer 實測撈到的那個形狀:
//       `ZZZ_MY_DB_CONN=postgres://u:p@203.0.113.7:5432/db` —— 名字不中 `DB_KEY_PATTERN` ⇒ 前三格全綠。
//    ⚠️ **仍然漏掉的形狀,明寫(修完之後重寫過,不是原句)**:
//       **CI 注入一個【值不是連線字串】的憑證**(service key 那種 JWT)**而名字又不在 `.env.example` 裡**
//       ⇒ 四格都抓不到。(名字尺分母不含它;值尺看不出 JWT 屬於誰。)
//       ⇒ 那一格**沒有機制**,只有這行字。要補的話形狀是「CI 的 env 白名單」,不在本片。
//    ⚠️ **CI 的 fail-closed 只掛在一支檔上**(reviewer 指出):被追蹤的 `.env*` 只有
//       `apps/storefront/.env.example` ⇒ **那支檔改名或刪掉,本檔在 CI 上當場恆紅**。
//       那時要修的是分母來源,不是關掉這一格。
//    ⚠️ **分母縮水不會叫**(reviewer nit,已知代價):fail-closed 只在「剛好 0」時觸發。
//       有人把 `.env.local` 搬走 ⇒ 5 支變 1 支、名字從 30 掉到 3,第二格照樣綠而射程掉了九成。
//       **不做門檻的理由**:本機與 CI 的合法分母本來就不同(30 vs 3),寫死任何期望值都會在另一邊變成假紅。

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PCM_PROD_PROJECT_REF, checkProdDbInDev } from '../apps/admin/src/lib/dev-db-guard';

// repo root 從**本檔自己的位置**推,不從 cwd 推 —— cwd 是「人從哪裡打指令」,會漂。
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
// 🔴 **目錄層也不得寫死**(code-reviewer 2026-08-27 MF-1):原版列舉 `apps/admin` + `apps/storefront`,
//    而 repo 有 4 個 app 與 6 個 package ⇒ `.env` 放進另外 7 個位置就不在分母裡。
//    **「分母是動態的」這句話如果只做到檔名那一層,目錄層就是同一個病的上一層。**
function scanDirs(): string[] {
  const dirs = [REPO];
  for (const group of ['apps', 'packages']) {
    const g = join(REPO, group);
    if (!existsSync(g)) continue;
    for (const name of readdirSync(g)) {
      const d = join(g, name);
      if (statSync(d).isDirectory()) dirs.push(d);
    }
  }
  return dirs;
}

/** 找出所有 `.env*` 檔。**含 `.env.example`** —— 它宣告的是同一批名字,分母寬一點比較安全。 */
export function findEnvFiles(dirs: string[] = scanDirs()): string[] {
  const out: string[] = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (f.startsWith('.env')) out.push(join(d, f));
  }
  return out;
}

/** 從 `.env` 檔文字抽出**變數名**。🔴 只回名字,值在本函式裡就被丟掉。 */
export function parseEnvNames(text: string): string[] {
  const out: string[] = [];
  // 🔴 **多行值的續行不是宣告**(reviewer nit):PEM / base64 的續行長得像 `MIIx=...`,
  //    照字面切會吐出一個名字 `MIIx`。今天實量它無害(與 PATH/HOME/NODE_ENV/TZ/CI 碰撞 0),
  //    **而它會在某一天吐出一個通用名(例如 PATH)⇒ 一格無辜的紅**。
  //    ⇒ 追蹤「值有沒有用未閉合的引號開頭」,在那之間的行一律跳過。
  let openQuote: '"' | "'" | null = null;
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (openQuote !== null) {
      if (l.endsWith(openQuote)) openQuote = null;
      continue;
    }
    if (l.length === 0 || l.startsWith('#')) continue;
    const body = l.replace(/^export\s+/, '');
    const eq = body.indexOf('=');
    if (eq < 0) continue;
    const name = body.slice(0, eq).trim();
    const value = body.slice(eq + 1);
    const q = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : null;
    if (q !== null && !(value.length > 1 && value.endsWith(q))) openQuote = q;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) out.push(name);
  }
  return out;
}

// 🔴 **第三把尺:不看名字,看【值長什麼樣】**(code-reviewer 2026-08-27 MF-2)。
//    起因是實測:`ZZZ_MY_DB_CONN=postgres://u:p@203.0.113.7:5432/db` ⇒ **三格全綠**。
//    一條**真的遠端 postgres 連線字串**穿過去了,因為 `DB_KEY_PATTERN` 判的是**名字**,
//    而這個名字不中。⇒ 前兩把尺的分母都掛在「名字」上,而攻擊者不需要用我們想得到的名字。
//    ⚠️ **原本我只把它寫進「已知缺口」那一段** —— 而 reviewer 的判準是對的:
//       **能修的東西寫成免責聲明,那份免責就變成不修的理由。**
const DB_VALUE_RE = /^(postgres|postgresql|mysql|mariadb|mongodb(\+srv)?|redis|rediss):\/\//i;
const SUPABASE_HOST_RE = /^https?:\/\/[^/]*\.supabase\.(co|in|net)(\/|$)/i;

/**
 * 值**看起來像 DB 連線**、而主機**不是本機**的那些變數名。
 * 🔴 主機判定**不自己寫一份** —— 借 `checkProdDbInDev` 的名字規則:塞一個 DB 類後綴進去,
 *    讓它拿自己的 `LOCAL_HOSTS` 去判這個值。**兩份本機主機清單會漂,一份不會。**
 */
export function remoteDbByValue(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== 'string' || v === '') continue;
    if (!DB_VALUE_RE.test(v) && !SUPABASE_HOST_RE.test(v)) continue;
    if (checkProdDbInDev({ [`${k}__DATABASE_URL`]: v }).kind !== 'ok') out.push(k);
  }
  return [...new Set(out)].sort();
}

/** 這些名字裡,哪幾支在這個行程裡看得到。 */
export function visibleNames(names: string[], env: NodeJS.ProcessEnv): string[] {
  return [...new Set(names)].filter((n) => env[n] !== undefined).sort();
}

describe('測試行程與正式憑證隔離(機制,不是現況)', () => {
  it('🔴 尺自己要先能分辨兩個世界(正負對照;沒有這格,底下全是恆綠嫌疑)', () => {
    // 正對照:名字看得到 ⇒ 必須被抓出來
    expect(visibleNames(['ZZZ_SELFCHECK_948'], { ZZZ_SELFCHECK_948: 'x' })).toEqual([
      'ZZZ_SELFCHECK_948',
    ]);
    // 負對照:名字看不到 ⇒ 必須是空的
    expect(visibleNames(['ZZZ_SELFCHECK_948'], {})).toEqual([]);
    // 解析器:值裡有 `=` 也只能切出名字,而註解行與空行不算
    expect(parseEnvNames('# 註解\n\nexport A_B=1\nC=x=y\n不是名字\n')).toEqual(['A_B', 'C']);
    // 第二把尺(checkProdDbInDev)也要活著:餵一個含正式庫 ref 的值 ⇒ 不得回 ok
    expect(
      checkProdDbInDev({ ANY_KEY: `https://${PCM_PROD_PROJECT_REF}.supabase.co` }).kind,
    ).not.toBe('ok');
    // 而乾淨的 env 要回 ok(否則下面那格是恆紅,一樣沒有判別力)
    expect(checkProdDbInDev({ SUPABASE_URL: 'http://localhost:54321' }).kind).toBe('ok');
    // 🔴 remote-db 那條分支也要表演一次(reviewer nit):第三格在 CI 上真正靠的就是它,
    //    而上面兩條只表演了 prod-ref 與 ok ⇒ DB_KEY_PATTERN / LOCAL_HOSTS 退步時這格會靜靜 fail-open。
    expect(checkProdDbInDev({ ZZZ_DATABASE_URL: 'postgres://u@203.0.113.7:5432/db' }).kind).not.toBe(
      'ok',
    );
    // 第三把尺(看值不看名字):正對照 = 名字完全不像 DB,而值是遠端連線字串 ⇒ 必須抓到
    expect(remoteDbByValue({ ZZZ_ANYTHING: 'postgres://u:p@203.0.113.7:5432/db' })).toEqual([
      'ZZZ_ANYTHING',
    ]);
    // 負對照一:同樣的形狀但指向本機 ⇒ 不得抓(否則它是恆紅)
    expect(remoteDbByValue({ ZZZ_ANYTHING: 'postgres://u:p@localhost:5432/db' })).toEqual([]);
    // 負對照二:遠端網址但**不是 DB 形狀**(npm registry 那種)⇒ 不得抓,否則整台機器的 env 都會紅
    expect(remoteDbByValue({ ZZZ_REGISTRY: 'https://registry.npmjs.org/' })).toEqual([]);
  });

  it('🔴 `.env*` 裡宣告過的變數名,一支都不得出現在測試行程裡', () => {
    const files = findEnvFiles();
    const names = files.flatMap((p) => parseEnvNames(readFileSync(p, 'utf8')));

    // fail-closed:分母壞掉時要紅,而且要說清楚紅的是分母不是洩漏。
    expect(
      files.length,
      '找不到任何 `.env*` 檔 ⇒ 這道閘沒有分母、會變成恆綠的裝飾。' +
        '要改的是本檔的 SCAN_DIRS / 分母來源,不是把這一格關掉。',
    ).toBeGreaterThan(0);
    expect(
      names.length,
      `掃到 ${files.length} 支 .env* 檔卻抽不出任何變數名 ⇒ 解析器壞了或檔是空的。同上:修分母,不要關這格。`,
    ).toBeGreaterThan(0);

    const leaked = visibleNames(names, process.env);
    expect(
      leaked,
      `🔴 測試行程看得到 .env* 裡宣告的變數:${leaked.join(', ')}\n` +
        '   ⇒ 有人讓測試載入了 .env(vitest setup / CI 注入 / shell export)。\n' +
        '   ⇒ 這代表 `pnpm test` 的任何一格都可能拿著真憑證去讀寫正式庫,\n' +
        '      而 next.config 那道正式庫閘【在測試層不存在】,擋不到它。\n' +
        '   (只列名字,值不在本訊息裡。)',
    ).toEqual([]);
  });

  it('🔴 就算名字不在 `.env*` 裡:任何指向正式庫 / 遠端 DB 的 env 也不得存在', () => {
    // 為什麼要第二把尺:上一格的分母是【本機檔案】,而 CI 是【直接注入 env】——
    // 那些名字可以完全不出現在任何 .env* 檔裡 ⇒ 上一格看不到它們。
    // 這一把改用 dev 正式庫閘的同一顆判定(不另寫一份會漂的規則)。
    const verdict = checkProdDbInDev(process.env);
    expect(
      verdict.kind === 'ok' ? [] : verdict.matches.map((m) => `${m.key}(${m.reason})`),
      '🔴 測試行程裡有指向正式庫或遠端 DB 的環境變數(只列名字與理由,值不在本訊息裡)。',
    ).toEqual([]);
  });

  it('🔴 名字再怎麼取,只要【值】是遠端 DB 連線字串就不得存在', () => {
    // 為什麼要第四格:前三格的分母全部掛在【名字】上(檔裡宣告過的名字 / DB_KEY_PATTERN),
    // 而**攻擊者不需要用我們想得到的名字**。實測 `ZZZ_MY_DB_CONN=postgres://u:p@203.0.113.7/db`
    // 在只有前三格時 ⇒ 三格全綠。這一格看的是值的形狀。
    const leaked = remoteDbByValue(process.env);
    expect(
      leaked,
      `🔴 測試行程裡有變數的【值】是遠端 DB 連線字串:${leaked.join(', ')}\n` +
        '   (只列名字,值不在本訊息裡。)',
    ).toEqual([]);
  });
});
