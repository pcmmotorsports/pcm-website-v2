import { D1_COHORT } from './d1-cohort';

const PRODUCTION_PROJECT_REF = 'bmpnplmnldofgaohnaok';
const DIRECT_HOST = `db.${PRODUCTION_PROJECT_REF}.supabase.co`;
const POOLER_HOST_SUFFIX = '.pooler.supabase.com';
const SAFE_CONNECTION_ERROR = 'D1:連線目標不符 production 專案;拒絕執行';

/**
 * 🔴 Fable 對抗審查 F2:這些 query param 會**覆蓋**連線字串裡的位置參數。
 *
 * `pg` 走 `pg-connection-string`,其 `parse()` 讓 query param 先進 config、
 * 位置參數只在 config 沒被設時才生效。主對話用 repo 內實裝的 2.13.0 實跑複驗:
 *   `postgres://…@db.<正式ref>.supabase.co/postgres?host=evil.example.com`
 *   → 本守門看到的 hostname 是正式站(放行),`pg` 實際連的是 evil.example.com。
 *   `…@aws-0-….pooler.supabase.com/postgres?user=postgres.<別的ref>` 同理繞過 username 檢查。
 * 只驗 WHATWG URL 的 hostname/username 擋不住這種差分 ⇒ 一律拒收這些鍵。
 *
 * 不在清單裡的 param(如 `sslmode`)照收 —— 它們不改變「連到哪、以誰的身分」。
 */
const EXPECTED_DATABASE = 'postgres';

/**
 * 🔴 **Sean 2026-07-29 拍板 A:強制 `verify-full`,不接受任何較鬆的模式。**
 *
 * 背景(codex R3):cohort 的 29 筆 UUID 與角色檢查都證明不了「就是 production」——
 * Supabase 的 clone 連角色與權限都一起複製。**身分的唯一證明在連線層**,而 TLS 模式
 * 決定了那層到底有沒有在驗身分:
 *   - `require`   = 只加密,**不驗對端是誰**(DNS / hosts 被導向即失效,守門仍宣稱是正式站)
 *   - `verify-ca` = 驗憑證由可信 CA 簽發,**但不驗主機名**
 *   - `verify-full` = 驗 CA + 驗主機名 ⇒ 唯一能證明「連對機器」的模式
 *
 * 🔴 前一版把 `require` 與 `verify-ca` 也收進白名單,等於自己把最後一道身分驗證放掉
 * (而且還寫了一條測試證明它會通過)。已收斂成單一值。
 *
 * 🔴 **未帶 sslmode 一律拒收** —— 缺省值取決於環境與 libpq 版本,不是可依賴的事實。
 *
 * ⚠️ **操作前置**:`verify-full` 需要本機備妥可驗 Supabase 憑證鏈的 CA 檔。
 * 沒備妥會直接連不上(fail-closed、不會誤放行)。⇒ 列為 D1t1/D1t2 的驗收條件:
 * 必須實跑證明「憑證正確時連得上、憑證錯誤或缺漏時連不上」兩個方向。
 */
const REQUIRED_SSL_MODE = 'verify-full';

const CONNECTION_OVERRIDE_PARAMS = new Set([
  'host',
  'hostaddr',
  'port',
  'user',
  'dbname',
  'database',
  'options',
  'service',
]);

export function assertRunbookConnection(connectionString: string): void {
  let connection: URL;

  try {
    connection = new URL(connectionString);
  } catch {
    throw new Error(SAFE_CONNECTION_ERROR);
  }

  const isPostgresProtocol =
    connection.protocol === 'postgres:' || connection.protocol === 'postgresql:';

  for (const key of connection.searchParams.keys()) {
    if (CONNECTION_OVERRIDE_PARAMS.has(key.toLowerCase())) {
      throw new Error(SAFE_CONNECTION_ERROR);
    }
  }

  // 🔴 codex R2 C3 + Sean 07-29 拍板 A:必須明寫 sslmode 且必須是 verify-full。
  //    理由與「擋不住什麼」見 REQUIRED_SSL_MODE 的說明。
  const sslmode = connection.searchParams.get('sslmode');
  if (sslmode === null || sslmode.toLowerCase() !== REQUIRED_SSL_MODE) {
    throw new Error(SAFE_CONNECTION_ERROR);
  }

  // 🔴 codex R2 C1:同一個專案底下可以有多個 database(演練用的 clone 就是這樣來的)。
  //    只驗 host 不驗 database ⇒ 連到 `/shadow_clone` 照樣放行,而那個 clone
  //    依規格 §8.4 步驟 4 會含有相同的 29 筆 UUID ⇒ 連 SQL 的 count 閘都會通過。
  //    路徑必須明確寫出且等於 postgres —— 留白會讓 pg 回頭吃 PGDATABASE 環境變數。
  if (connection.pathname !== `/${EXPECTED_DATABASE}`) {
    throw new Error(SAFE_CONNECTION_ERROR);
  }

  // 🔴 Fable F5:原本用 `hostname.includes(ref)`,`db.<ref>.supabase.co.evil.example`
  //    這種夾帶 ref 的他方 host 會被放行。改成整串相等。
  //    這比規格 §8.4 步驟 1 的字面「direct host 含 project ref」更嚴 ——
  //    更嚴的方向是安全的(誤拒 = 停下來問人,誤放 = 刪錯資料庫)。
  const isPoolerHost = connection.hostname.endsWith(POOLER_HOST_SUFFIX);
  const isDirectProductionHost = !isPoolerHost && connection.hostname === DIRECT_HOST;
  const isProductionPooler =
    isPoolerHost && connection.username.endsWith(`.${PRODUCTION_PROJECT_REF}`);

  if (!isPostgresProtocol || (!isDirectProductionHost && !isProductionPooler)) {
    throw new Error(SAFE_CONNECTION_ERROR);
  }
}

const cohortUuidSql = D1_COHORT.map(({ id }) => `    '${id}'::uuid`).join(',\n');

/**
 * 🔴 **執行合約(Fable F6):本段必須與後續 DELETE 在同一交易內執行。**
 *
 * `RAISE EXCEPTION` 只在同一交易(或同一批 simple-query)裡才會連帶中止後續語句。
 * 若被人拿去用 psql 逐句跑、又沒開 `ON_ERROR_STOP`,這裡拋錯只會殺掉這一句,
 * 後面的 DELETE 照樣執行 —— 守門等於不存在。D1t1 的單一 pg client 從 BEGIN 到
 * COMMIT 全程同一 session,滿足此合約;**此條列為 D1t1 的驗收條件**,不是這裡能自保的事。
 *
 * 🟡 合約債(Fable F3):規格 §5.1 表第 8 列字面要求「不符即 exit 1」,但本片只提供
 * 可 import 的守門函式、沒有可執行進入點(那是 R11 拆出 D1t2 CLI 之後的責任,
 * 規格該列未同步)。⇒ **D1t2 驗收必須含:①wrapper 不符時 process exit 非零
 * ②D1t1/D1t2 真的呼叫了這兩個守門**。repo 前科:`assertDisplayId` 寫好了卻生產零呼叫端。
 */
export const D1_TRANSACTION_GUARD_SQL = `DO $$
DECLARE
  v_cohort_count integer;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'D1:runbook 必須以 postgres 執行(實 %);拒繼續', current_user;
  END IF;

  -- 🔴 codex R2 C2:current_user 會被 SET ROLE 改掉。以某個「可以 SET ROLE postgres」
  --    的窄權角色登入、再靠 PGOPTIONS=-c role=postgres 切過去,上面那條就過了,
  --    但真正登入的身分(session_user)根本不是 postgres。連線字串裡看不到這件事,
  --    所以 TS 側的 query denylist 也擋不到 ⇒ 必須在庫內同時驗 session_user。
  IF session_user <> 'postgres' THEN
    RAISE EXCEPTION 'D1:登入身分必須是 postgres(實 %);拒繼續', session_user;
  END IF;

  -- 🔴 codex R3:cohort 的 29 筆 UUID **證明不了「就是 production」** —— Supabase 的
  --    clone 會把 schema、資料、角色、權限整套複製,所以任何「資料事實」都偽造得出來。
  --    system_identifier 是叢集在 initdb 當下產生的識別碼,邏輯還原出來的新叢集會是新值。
  --    正式站實查值 = 7632885393857617092(2026-07-29,以 postgres 身分查 pg_control_system())。
  --
  --    🔴 **它擋不住什麼(必須寫明,否則就是替防護取了大於能力的名字)**:
  --    ①**實體快照**(pg_basebackup / storage snapshot)會原樣保留同一個 system_identifier
  --      ⇒ 對「實體複製出來的演練庫」無效。②Supabase 的 clone 用哪一種方式**未確認**。
  --    ⇒ 本條只把「另外開一座新叢集重灌資料」這種情境擋掉,不是身分的唯一證明。
  --      唯一證明在連線層(端點 + TLS 主機名驗證),見 D1t1/D1t2 驗收條件。
  IF (SELECT system_identifier FROM pg_control_system()) <> 7632885393857617092 THEN
    RAISE EXCEPTION 'D1:叢集識別碼不符 production;拒繼續';
  END IF;

  SELECT count(*)
    INTO v_cohort_count
    FROM public.orders
   WHERE id = ANY (ARRAY[
${cohortUuidSql}
   ]);

  IF v_cohort_count <> 29 THEN
    RAISE EXCEPTION 'D1:cohort 應有 29 筆，實際 % 筆;拒繼續', v_cohort_count;
  END IF;
END $$;`;
