/**
 * D1 runbook 環境守門(D1a0)。D1c 會永久刪除 26 張 production 訂單,這是唯一擋著
 * 「跑錯資料庫 / 錯身分 / 刪錯資料」的東西 —— 它失效不會有症狀,會安靜放行。
 *
 * 兩半:
 * 1. `buildD1PgConfig` — 連線層。**沿用 repo 既有已實戰的做法**
 *    (`packages/adapters/src/payment/PaymentConfirmerAdapter.ts:66-78`),不自創。
 * 2. `D1_TRANSACTION_GUARD_SQL` — 資料庫層。身分 → 叢集 → cohort 三道,必須與 DELETE 同交易。
 */
import { SUPABASE_ROOT_CA_2021 } from '../packages/adapters/src/payment/supabase-ca';
import { D1_COHORT } from './d1-cohort';

export const PRODUCTION_PROJECT_REF = 'bmpnplmnldofgaohnaok';

/**
 * production 叢集的 `pg_control_system().system_identifier`(2026-07-29 實查)。
 *
 * 🔴 **單一來源**(Fable R3-F7):原本 d1-guard 與 d1-restore 各寫死一份,兩處會漂移。
 * 🔴 **它不是永久不變的**:Supabase 平台側遷移、大版本升級、或**他們自己做災難還原**
 * 都會換掉這個值 —— 而最後那種情境正好與「你需要用這包備份」高度重疊。
 * 合法變更時的處置寫在 `docs/runbooks/2026-07-29-d1a2-cohort-export.md`,
 * **不要為了讓守門過而順手改這個常數**。
 */
export const PRODUCTION_CLUSTER_ID = '7632885393857617092';
const EXPECTED_DATABASE = 'postgres';
const EXPECTED_USER = `postgres.${PRODUCTION_PROJECT_REF}`;

/**
 * 🔴 只收 Supabase session pooler,**不收直連 `db.<ref>.supabase.co`** ——
 * 該 host 是 IPv6-only,本機與 Vercel 實測皆 ENOTFOUND(PaymentConfirmerAdapter:9-13)。
 * 放行一條連不上的路只會讓人以為還有別的選擇。這比規格 §8.4 步驟 1 的「direct 或 pooler
 * 擇一」更嚴,更嚴的方向是安全的(誤拒 = 停下來問人,誤放 = 動到錯的資料庫)。
 *
 * 釘死 DNS 網域也是 verify-full 成立的前提:pg 只對 DNS host 設 TLS servername,
 * IP host 的 hostname 驗證不成立 —— 而 IP 位址本來就過不了這條 regex。
 */
const POOLER_HOST_RE = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/;

/** 🔴 錯誤訊息永遠是這個常數:連線字串含密碼,不得進 log。 */
const SAFE_CONNECTION_ERROR = 'D1:連線目標不符 production;拒絕執行';

/**
 * 解析連線字串成**離散欄位**並強制 CA 驗證。
 *
 * 🔴 **不可把 connectionString 直接丟給 pg**。兩個 repo 實測過的理由:
 * ①`pg-connection-string` 讓 query param 覆蓋位置參數(2.13.0 實跑:`?host=evil`
 *   會讓 pg 連別處,而只看 `URL.hostname` 的檢查完全沒感覺)
 * ②pg 8.21 會讓連線字串的 `sslmode` **覆蓋掉**程式指定的 ssl 物件 —— 假 CA 配
 *   `sslmode=no-verify` 竟然連得上(PaymentConfirmerAdapter:66-69)。
 *
 * 回傳離散欄位就從根上中和這兩件事:連線字串的 query param 一個都不會抵達 pg,
 * 所以**不需要**另外寫「剝除 SSL 參數」的程式碼 —— 那在這個設計下是不做事的儀式。
 */
export function buildD1PgConfig(connectionString: string) {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(SAFE_CONNECTION_ERROR);
  }

  const host = url.hostname;
  const user = decodeURIComponent(url.username);
  const database = url.pathname.replace(/^\//, '');

  if (
    !POOLER_HOST_RE.test(host) ||
    user !== EXPECTED_USER ||
    database !== EXPECTED_DATABASE
  ) {
    throw new Error(SAFE_CONNECTION_ERROR);
  }

  return {
    host,
    port: url.port ? Number(url.port) : 5432,
    database,
    user,
    password: decodeURIComponent(url.password),
    // 顯式 servername:pg 對 IP host 不設 servername,釘死 DNS + 顯式指定才讓 hostname 驗證真成立。
    ssl: { ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true, servername: host },
  };
}

const cohortPairsSql = D1_COHORT.map(
  ({ id, displayId }) => `      ('${id}'::uuid, '${displayId}')`,
).join(',\n');

/**
 * 🔴 **執行合約:本段必須與後續 DELETE 在同一交易內。** `RAISE EXCEPTION` 只在同一交易
 * (或同一批 simple-query)才會連帶中止後續語句;被拿去用 psql 逐句跑又沒開 `ON_ERROR_STOP`
 * 的話,這裡拋錯只殺這一句、DELETE 照跑 = 守門等於不存在。列為 D1t1 驗收條件。
 *
 * 🟡 合約債:規格 §5.1 第 8 列要求「不符即 exit 1」,但本片只提供函式、無可執行進入點
 * (D1t2 CLI 的責任、規格該列未同步)。⇒ D1t2 驗收須含:①不符時 process exit 非零
 * ②D1t1/D1t2 真的呼叫了這兩個守門(前科:`assertDisplayId` 生產零呼叫端)
 * ③CA 正確時連得上 / 錯誤或缺漏時連不上,兩個方向實跑。
 */
export const D1_TRANSACTION_GUARD_SQL = `DO $$
DECLARE
  v_cohort_count integer;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'D1:runbook 必須以 postgres 執行(實 %);拒繼續', current_user;
  END IF;

  -- current_user 會被 SET ROLE 改掉(可 SET ROLE postgres 的窄權角色 + PGOPTIONS 即可偽裝),
  -- 連線字串裡看不到這件事 ⇒ 必須同時驗真正登入的身分。
  IF session_user <> 'postgres' THEN
    RAISE EXCEPTION 'D1:登入身分必須是 postgres(實 %);拒繼續', session_user;
  END IF;

  -- cohort 資料證明不了「就是 production」—— Supabase clone 連角色與權限都複製。
  -- system_identifier 是叢集 initdb 當下產生的,邏輯還原出的新叢集會是新值。
  -- 🔴 擋不掉實體快照(pg_basebackup / storage snapshot 原樣保留同一個值);
  --    Supabase clone 用哪一種方式未確認。⇒ 不是身分的唯一證明,唯一證明在連線層。
  IF (SELECT system_identifier FROM pg_control_system()) <> ${PRODUCTION_CLUSTER_ID} THEN
    RAISE EXCEPTION 'D1:叢集識別碼不符 production;拒繼續';
  END IF;

  -- 逐組比對 (id, display_id):打錯一碼 / 貼錯一筆 / 少一筆,配對就對不上、數量到不了 29。
  -- 由 production 當裁判,本 repo 不自算雜湊。
  SELECT count(*)
    INTO v_cohort_count
    FROM public.orders o
    JOIN (VALUES
${cohortPairsSql}
    ) AS c(id, display_id) ON c.id = o.id AND c.display_id = o.display_id;

  IF v_cohort_count <> 29 THEN
    RAISE EXCEPTION 'D1:cohort 配對應有 29 筆,實際 % 筆;拒繼續', v_cohort_count;
  END IF;
END $$;`;
