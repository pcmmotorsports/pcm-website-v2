// dev-db-guard.ts — 擋住「在指向【正式庫】的工作樹上跑 next dev」。
//
// 🔴 **它擋的不是一個設定錯誤,是一個【免登入的正式站後台】**:
//    主樹 `apps/admin/.env.local` 指向正式庫且帶 `SUPABASE_SERVICE_ROLE_KEY`
//    (2026-08-22 實測:`grep -c 'bmpnplmnldofgaohnaok'` ⇒ 1、`grep -c 'SUPABASE_SERVICE_ROLE_KEY'` ⇒ 1)。
//    而 dev 若帶 `ADMIN_DEV_BYPASS=1`(`proxy.ts` 的 dev bypass)⇒ 不需要登入。兩件合起來 =
//    在主樹跑【文件教的那一行】(它帶著 ADMIN_DEV_BYPASS=1),就開了一個**不用密碼的正式站後台**。
//    ⚠️ 裸 `next dev` 不是免登入(`apps/admin/.env.local` 無 ADMIN_DEV_BYPASS,grep ⇒ 0)——
//       它是一個【拿著正式庫 service key 的 dev server】,一樣要擋;但風險陳述不寫過寬(R2 ⑥)。
//    (auth 那一半的第二道防線見 `dev-auth-bypass.ts` —— 行為屬那一顆 commit,本檔不預支其描述;
//     R2 C-1:文案與它描述的行為要住同一顆,否則單獨回退時文案變成反向的謊。)
//
// 🔴 **為什麼是機制不是規則**:`docs/design/admin-design-system.md` 檔頭教的是
//    `cd apps/admin && ADMIN_DEV_BYPASS=1 npx next dev -p 3001 -H 127.0.0.1`
//    ⇒ **它不經過 package.json 的任何 script**
//    ⚠️ 上面那行**逐字照抄** `docs/design/admin-design-system.md:6`,**不要用 `…` 省略** ——
//       我第一版把後半用刪節號帶過,而被省掉的正好是 `-H 127.0.0.1`(綁 loopback 那一半)。
//       🔴 這一句刻意**不重現**那個省略寫法 —— 第一次修的時候我把它抄進說明裡,
//          而說明本身就又造出一次同樣的東西。**警告不要複製它在警告的形狀。**
//       ⇒ 一條**為了說明危險而寫下的示範指令,自己變成那個危險**;而照抄的人不會去讀免責。
//    ⇒ `predev` 那類閘分母太窄。規則是一句話,而「照做」與「沒照做」在畫面上長得一樣。
//
// ⚠️ **射程(codex R1 nit + Fable R2 ⑥;寫成「它回答不了哪些問題」,不只寫「不保證」——
//    只寫「我不保證 X」的誠實清單,讀的人照樣會拿它去問 X)**:
//    本閘只擋 **`next dev` 這條 HTTP 後台**。它回答不了、也擋不了:
//    ① 已經在跑的 server 不在射程 —— 閘只在【啟動時】檢查(2026-08-23 活標本:3861 那支
//       起於閘 commit 前十分鐘,閘擋不到它,是人查了之後 kill 的)。
//    ② vitest / `tsx` 腳本 / 直接 import server action **不載 next.config** ⇒ 仍可能拿正式憑證讀寫。
//    ③ 程式化啟動(custom server)不經 next.config —— 該洞由 proxy.ts 的 DB 本機條件補一半(只補 auth 面)。
//    ⇒ **不得宣稱「這個 repo 不會誤連正式庫」,只能宣稱「不會誤開 dev 後台」。**

/** 正式庫的 Supabase project ref(2026-08-22 由主樹 `apps/admin/.env.local` 實測命中)。 */
export const PCM_PROD_PROJECT_REF = 'bmpnplmnldofgaohnaok';

/** 逃生門:設 `=1` ⇒ 只警告不擋。**只認 `1`**,`true`/`yes`/`0` 一律不放行。 */
export const PROD_DB_BYPASS_ENV = 'PCM_ALLOW_PROD_DB_DEV';

/**
 * 🔴 **第二條規則存在的理由(codex R1 must-fix-1)**:只比對 project ref 是 **fail-open** ——
 *    正式庫哪天換成自訂網域(不含 ref)⇒ 判定回 `ok`,而**那個綠與「真的安全」長得一模一樣**。
 *    ⇒ 改成**白名單方向**:dev 底下,DB 類變數只准指向本機。遠端一律擋、由逃生門處理例外。
 *    (白名單會在該紅的時候紅;黑名單只會靜靜漏掉下一個沒人想到的值。)
 */
// 🔴 這張 key 清單自己就是一張會漂的具名清單(R2 nit)—— 它只是第二道;第一道 ref 規則掃【所有】key。
//    新的 DB 變數命名出現時往這裡加;漏掉的那天,兜底的是 ref 規則(值含正式庫 ref 仍會被抓),
//    而「ref 換掉 + 名字又不在這裡」兩個同時發生才會漏 —— 那一格沒有機制,只有這行註解。
//    ⚠️ 刻意【不含】裸 `PRISMA`(codex R1 must-fix-3):`PRISMA_ENGINES_MIRROR` 這類工具設定
//    是遠端 https 網址、會被誤擋而誘人開逃生門;真正的連線名 `PRISMA_DATABASE_URL` 由 DATABASE 收。
//    ⚠️ 裸 host 型變數(`POSTGRES_HOST=203.0.113.7`)hostOf 撈不出 ⇒ fail-open;`PGHOST` 連
//    key pattern 都不中 —— 而 split-var 風格本 repo 真的在用(`scripts/lib/pg-connect-env.sh` 一族,
//    R2 C-2)⇒ 這一格是已知射程,不是假想。
// (export 是給測試的 scrub 共用同一張清單 —— 兩份復刻會各自漂,R2 N-3。)
export const DB_KEY_PATTERN = /SUPABASE|POSTGRES|DATABASE|DB_URL|PG_URL|PGURL|CONNECTION_STRING|CONN_STR/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'host.docker.internal']);

export type ProdDbMatch = {
  key: string;
  /** `prod-ref` = 值裡有正式庫 ref;`remote-db` = DB 類變數指向非本機主機 */
  reason: 'prod-ref' | 'remote-db';
};

export type ProdDbInDevVerdict =
  | { kind: 'ok' }
  | { kind: 'bypassed'; matches: ProdDbMatch[] }
  | { kind: 'blocked'; matches: ProdDbMatch[]; bypassRefused: boolean };

export type EnvLike = Readonly<Record<string, string | undefined>>;

export type ProdDbGuardOptions = {
  /**
   * 逃生門那個值是不是**從 `.env.local` / `.env*` 檔案來的**(codex R1 must-fix-3)。
   * 🔴 是的話**拒絕放行** —— 逃生門的用途是「我這一次知道我在做什麼」;
   *    寫進檔案 = **下一個人不知情地繼承一個永久放行**,而他只會看到一行開機警告。
   */
  bypassFromEnvFile?: boolean;
};

/**
 * 從變數值撈主機名。三種形狀:URL(scheme://)、URL 裡的方括號 IPv6、libpq DSN(`host=…`)。
 * 🔴 撈不出 host ⇒ 回 null ⇒ 上層【不擋】= fail-open(R2 nit 把它縮小:原版對方括號 IPv6 與
 *    無 scheme 的 DSN 都回 null —— LOCAL_HOSTS 裡的 '::1' 曾是 regex 永遠到不了的死項)。
 */
function hostOf(value: string): string | null {
  const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^/@]*@)?(?:\[([^\]]+)\]|([^/:?#[]+))/.exec(value);
  // 🔴 `url[1]` 在 noUncheckedIndexedAccess 底下是 `string | undefined`,不是 `string`。
  if (url) return url[1] ?? url[2] ?? null;
  // libpq 參數:`hostaddr` 優先於 `host`(兩者都給時 libpq 實際連 hostaddr —— codex R1 must-fix-2:
  // `host=localhost hostaddr=<遠端IP>` 判成本機是 fail-open);邊界含 `?`/`&`,
  // 讓 `postgresql:///db?host=…` 這種「authority 留空、host 塞 query」的合法 URI 也撈得到。
  const dsn =
    /(?:^|[\s?&])hostaddr\s*=\s*([^\s&]+)/.exec(value) ??
    /(?:^|[\s?&])host\s*=\s*([^\s&]+)/.exec(value);
  return dsn?.[1] ?? null;
}

/** 🔴 回報**所有**命中的 key,不是第一個(R1 nit:物件列舉順序可能先撞到無關的那支)。 */
export function checkProdDbInDev(env: EnvLike, options: ProdDbGuardOptions = {}): ProdDbInDevVerdict {
  const matches: ProdDbMatch[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === '') continue;
    if (key === PROD_DB_BYPASS_ENV) continue;
    if (value.includes(PCM_PROD_PROJECT_REF)) {
      matches.push({ key, reason: 'prod-ref' });
      continue;
    }
    if (!DB_KEY_PATTERN.test(key)) continue;
    const host = hostOf(value);
    // 以 '/' 開頭的 host = unix socket 路徑(拋棄式 PG 的常態)⇒ 本機,不擋。
    if (host !== null && !LOCAL_HOSTS.has(host) && !host.startsWith('/')) {
      matches.push({ key, reason: 'remote-db' });
    }
  }
  if (matches.length === 0) return { kind: 'ok' };
  if (env[PROD_DB_BYPASS_ENV] !== '1') return { kind: 'blocked', matches, bypassRefused: false };
  if (options.bypassFromEnvFile === true) return { kind: 'blocked', matches, bypassRefused: true };
  return { kind: 'bypassed', matches };
}

/** 擋下來時印給人看的字。**要能讓他知道下一步做什麼**,不只是說「不行」。 */
export function describeProdDbInDev(matches: ProdDbMatch[], bypassRefused: boolean): string {
  const lines = [
    '',
    '🔴 這個工作樹的環境變數指向【不是本機】的資料庫,next dev 已停止。',
    '   在這裡跑起來 = 一個拿著正式庫憑證的 dev server。',
    '',
    '   命中的變數(全部列出):',
    ...matches.map(
      (m) =>
        `     ${m.key} — ${m.reason === 'prod-ref' ? `值含正式庫 ref ${PCM_PROD_PROJECT_REF}` : '指向非本機主機'}`,
    ),
    '',
    '   要看畫面,換一個沒有 .env* 的工作樹跑。',
    '   ⚠️ 別照抄某個固定路徑 —— 用 `git worktree list` 看現在有哪些,再挑一個 `ls -a` 確認沒有 .env* 的。',
  ];
  if (bypassRefused) {
    lines.push(
      '',
      `   🔴 偵測到 ${PROD_DB_BYPASS_ENV}=1 寫在 .env 檔裡 ⇒ **不放行**。`,
      '      逃生門只接受「這一次」的指令列用法,不接受寫進檔案永久繼承:',
      `        ${PROD_DB_BYPASS_ENV}=1 npx next dev`,
    );
  } else {
    lines.push('', `   真的要在本機連遠端庫:${PROD_DB_BYPASS_ENV}=1 npx next dev(只警告不擋,且不得寫進 .env 檔)。`);
  }
  lines.push('');
  return lines.join('\n');
}
