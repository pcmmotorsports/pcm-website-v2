// ⟦b4-SEQACL1⟧ 的【會叫的那一道】—— 新表長出 IDENTITY 序列而沒有人收它的權限 ⇒ 這裡紅。
//
// ══ 🔴 它在防什麼(而它防的不是今天)═══════════════════════════════════════════
// 2026-09-02 實查正式庫:`public` 底下有 4 支序列讓 `anon` **與** `authenticated`
// 拿到 `SELECT+UPDATE+USAGE` ⇒ 沒登入的陌生人推得動下一筆資料的編號。
// 而四支**全部是 `IDENTITY` 自動建的** ——
//   🎯 `GRANT`/`REVOKE` 我們寫在【表】上, 而 `IDENTITY` 在旁邊【另外生了一個物件】,
//      **而那個物件不在任何人的視線裡。**
//
// 🔵 而分母說明了修法該長什麼樣:`public` 的 IDENTITY 序列 6 支 ⇒ 漏 4、乾淨 2,
//    而乾淨的那 2 支**每一支都有人明寫過 REVOKE**
//    ⇒ 📌 **不是「IDENTITY 一定會漏」, 是【有人明寫過那一支就乾淨】**
//    ⇒ ⇒ **所以要的是一道會叫的, 不是一條規則**(規則寫過而復發 —— 板上有紀錄)。
//
// ══ 🛑 分母:**本檔掃到 6 支, 而正式庫實有 6 支** ═══════════════════════════
//   ✅ **2026-09-02 起兩側相等** —— `646bbeab` 收了 `⟦b4-PFEDDL2⟧` ⇒
//      `product_fitments_effective_staging` / `..._sync_log` 的建表 DDL 進版控
//      ⇒ 本檔掃到的從 4 變 **6**;正式庫那個 6 是唯讀查 `pg_class`+`pg_depend`(2026-09-02)。
//   ⚠️ **而「相等」是一張快照, 這道閘維持不了它**(code-reviewer nit):
//      本檔掃的是 `CREATE TABLE` 的**字面** ⇒ **只增不減** ——
//      `DROP TABLE` 不會讓它少一支 ⇒ **正式庫掉到 5 的那一天, 這裡照樣綠。**
//
//   🔴🔴 **而這一節【前一版是假的】, 而它假掉的方式值得記**:
//      前一版寫「掃到 4 支 · 真正還看不到的只有 2 支(`_staging`/`_sync_log`),
//      它們的建表 DDL 確實不在 `supabase/migrations/` 裡」——
//      而 `20260902210000:98,128` 就是那兩張表。
//      🛑 **⇒ 我在檔尾改對了(釘住全集), 而檔頭那一節【沒跟著改】** ——
//      而它**排在前面** ⇒ 📌 **同一支檔兩個命中, 而只有第二個是現況**
//      ⇒ ⇒ 那與 `print-a4.css` 那個病同族(grep 到第一個命中就停)。
//   🔵 舊字面不留全文, 只留這段說明 —— 因為它是一段【描述現況】的話, 而不是一個決定。
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(__dirname, '..', 'supabase', 'migrations');

/** 🔴 剝 SQL 註解 —— 註解裡的 `CREATE TABLE` 不是生效敘述, 掃到會變誤報。 */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function migrations(): { file: string; sql: string }[] {
  return readdirSync(MIG)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(join(MIG, f), 'utf8') }));
}

/**
 * 從 migration 字面推導出【IDENTITY 會自動建的序列名】。
 * PG 的命名【通常】是 `<表>_<欄>_seq`。
 *
 * 🛑🛑 **而「決定性」那個字是錯的 —— 而本檔自己就引著反例**(codex must-fix):
 *   `20260828080000:172-178` 逐字寫著:schema 裡若已有【同名的孤兒 sequence】,
 *   PG 會給 identity 那支一個**帶尾碼的新名字**(`…_seq1`)。
 *   ⇒ 🔴 **那時本檔推導出來的名字指到【那個舊的】** ——
 *     而舊的本來就沒權限 ⇒ `revokedSomewhere()` 對它印綠,
 *     **而真正掛在欄上的那支保留預設 ACL、對 anon 開著。**
 * 📌 **⇒ 一把靜態尺不能把【推導出來的名字】當成事實。**
 *   而要真的分辨, 得問 `pg_get_serial_sequence()` —— 那要連資料庫, 不是這一支做得到的。
 * ✅ **⇒ 所以這個洞由【另一半】接**:`20260902180000` 的驗證④ 在 apply 當下
 *   掃 catalog 底下 `public` 的**每一支序列**、不看名字 ⇒ 帶尾碼的那支也在它的分母裡。
 * 🎯 **⇒ 兩半各補對方的盲區:本檔看得到「新表進來了」而看不到真名;
 *   那一支看得到真名而只在 apply 當下燒一次。**
 */
function identitySequencesFromMigrations(): Map<string, { file: string; table: string; col: string }> {
  const out = new Map<string, { file: string; table: string; col: string }>();
  for (const { file, sql: raw } of migrations()) {
    const sql = stripSqlComments(raw);
    for (const m of sql.matchAll(
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?\"?(\w+)\"?\s*\(([\s\S]*?)\n\s*\)/gi,
    )) {
      const table = m[1];
      for (const line of (m[2] ?? '').split('\n')) {
        const col = line.match(
          /^\s+"?([a-z_][a-z0-9_]*)"?\s+.*GENERATED\s+(?:ALWAYS|BY DEFAULT)\s+AS IDENTITY/i,
        );
        if (table && col?.[1]) out.set(`${table}_${col[1]}_seq`, { file, table, col: col[1] });
      }
    }
    // 🔵 `ALTER TABLE … ADD COLUMN … GENERATED … AS IDENTITY` 也會生一支序列(今日 repo 內 0 支, 潛伏)
    for (const m of sql.matchAll(
      /ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?(\w+)"?[\s\S]{0,200}?ADD\s+(?:COLUMN\s+)?(?:IF NOT EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?[^;]{0,200}?GENERATED\s+(?:ALWAYS|BY DEFAULT)\s+AS IDENTITY/gi,
    )) {
      if (m[1] && m[2]) out.set(`${m[1]}_${m[2]}_seq`, { file, table: m[1], col: m[2] });
    }
  }
  return out;
}

/**
 * 有沒有人明寫過「收掉這一支對 anon 的權限」——**三種寫法都要認**。
 *
 * 🔴🔴 **第三種是被這支測試自己的第一發紅逼出來的**(2026-09-02):
 *   第一版只認【具名】⇒ 它把 `admin_saved_order_views_id_seq` 與 `auth_callback_events_id_seq`
 *   報成「沒有人收過」—— **而正式庫實查那兩支是乾淨的** ⇒ 那是**假指控**不是漏報。
 *   成因:那兩支刻意**不寫死名字**,走
 *     `v_seq := pg_get_serial_sequence('public.<表>','<欄>')`
 *     `EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, …', v_seq)`
 *   而它們**不寫死是有理由的**(`20260828080000:172-178` 逐字):schema 裡若已有同名孤兒 sequence,
 *   PG 會給 identity 那支一個【帶尾碼的新名字】⇒ 寫死的 REVOKE 會去撤那個舊的、而舊的本來就沒權限
 *   ⇒ **全綠, 而真正掛在 `id` 上的那支保留預設 ACL。**
 * 📌 **⇒ 所以這裡的教訓有兩層:①按名字判的尺對動態組出來的名字恆印 0
 *    ②而那個動態不是隨便寫的 —— 它本身就是在防另一個同族的坑。**
 * 🎯 **⇒ 一把太窄的尺產出的是【假指控】, 而假指控會讓人去「修」一個沒壞的東西。**
 */
/** 「收乾淨」的兩個條件 —— **模組層只有這一份**, 具名與動態兩條路共用。 */
const REVOKE_ALL = String.raw`REVOKE\s+ALL(\s+PRIVILEGES)?`;
const ROLES = String.raw`(?=[^;]*\bPUBLIC\b)(?=[^;]*\banon\b)(?=[^;]*\bauthenticated\b)`;
/**
 * 🔴 具名與動態兩條路的【中段界線】—— **只有這一份**(`-fc` 2026-09-02 量到)。
 *   兩條路的字元類必須不同(動態那段住在 `EXECUTE format('…')` 的引號裡 ⇒ 要多排除 `'`),
 *   **而那兩個數字沒有理由不同** ⇒ 前一版把它們各打一份
 *   ⇒ 🔴 **改一邊、另一邊不跟 ⇒ 兩條路的鬆緊會分岔, 而分岔【不會紅】。**
 */
const GAP_A = 40;
const GAP_B = 80;

/**
 * 🔴🔴 **「收乾淨了沒」那把尺的【唯一一份】判準 —— 自檢與生產碼共用它。**
 *
 * 為什麼要抽出來(code-reviewer 2026-09-02 must-fix):
 *   前一版 `probeRevokeRegex()` 是把這段判準**重打一份**, 不呼叫這裡。
 *   ⇒ 🔴 **那讓那格「量具自檢」驗不到生產碼** —— 而它本來就是為了防那個 `/i/` 事故而加的
 *     ⇒ ⇒ **同一個事故今天再發生一次, 自檢那格照樣綠, 而 naked 那格全變 true。**
 * 🎯 **⇒ 一格叫「自檢」的測試, 若把判準重打一份, 它自檢的是那一份重打的 —— 不是那把尺。**
 */
function namedRevokeRegex(seq: string): RegExp {
  // 🔴 三種權限【全部】要被收掉才算數:序列的完整權限是 SELECT / UPDATE / USAGE
  //    ⇒ 一發 `REVOKE SELECT … FROM anon` 不該算「收過了」⇒ 只認 `REVOKE ALL`。
  // 🔴 而角色也要三個都在:`PUBLIC` / `anon` / `authenticated` —— 少一個就不算。
  // 🔵 中段用 `[^;]` 而不是 `[\s\S]` —— 前者不會跨過分號
  //    (跨得過去 ⇒ 一發收 service_role 的 REVOKE 後面接一發收 anon 的【別的】REVOKE 會被判成綠)。
  return new RegExp(
    REVOKE_ALL + `[^;]{0,${GAP_A}}?ON\\s+SEQUENCE\\s+public\\.` + seq + `\\b[^;]{0,${GAP_B}}?FROM` + ROLES,
    'i',
  );
}

function revokedSomewhere(seq: string, table: string, col: string): boolean {
  // ⛔ **刻意【不】認 `REVOKE … ON ALL SEQUENCES IN SCHEMA public`**:那個語法只作用於
  //    【當下已存在】的物件 ⇒ 把它當成「這一支被收過了」對它之後才建的序列是**假綠**。
  //
  // 🔴 三種權限【全部】要被收掉才算數(codex must-fix):序列的完整權限是
  //    `SELECT` / `UPDATE` / `USAGE` ⇒ 一發 `REVOKE SELECT … FROM anon` 不該算「收過了」。
  //    ⇒ 這裡只認 `REVOKE ALL`(含 `ALL PRIVILEGES`), 不認挑單項的寫法。
  // 🔴 而角色也要三個都在:`PUBLIC` / `anon` / `authenticated` —— 少一個就不算。
  const named = namedRevokeRegex(seq);
  // 動態那條路 ⇒ 走 `dynRevokedIn()`(下面那支), **而不是在這裡重打一份**。
  // 動態:同一支檔裡既有 `pg_get_serial_sequence('public.<表>','<欄>')`, 又有一發 `REVOKE ALL … %s … FROM` 三個角色。
  // 🛑 **射程(codex must-fix, 誠實寫)**:本檔【不追變數的來龍去脈】——
  //    同一支檔裡查了兩支序列而只撤其中一支時, 兩支都會被判成綠。
  //    ⇒ 要真的分辨得出來, 需要一個能解析 plpgsql 變數流向的東西, 而那不是這一支。
  for (const { sql: raw } of migrations()) {
    const sql = stripSqlComments(raw);
    if (named.test(sql)) return true;
    if (dynRevokedIn(sql, table, col)) return true;
  }
  return false;
}

/**
 * 動態那條路的判準 —— **抽成一支可以【直接餵字串】的函式**(`-fc` 2026-09-02 的建議)。
 * 🎯 抽它的理由不是整潔:前一版它埋在 `revokedSomewhere()` 裡 ⇒
 *    **只餵得到真檔案** ⇒ 而「餵它一個我知道答案的世界」做不到
 *    ⇒ ⇒ 那正是本檔自己那條規矩(餵它東西看它答什麼)在動態這條路上**做不到的原因**。
 */
function dynRevokedIn(sql: string, table: string, col: string): boolean {
  const dynLookup = new RegExp(
    String.raw`pg_get_serial_sequence\s*\(\s*'public\.` + table + String.raw`'\s*,\s*'` + col + String.raw`'\s*\)`,
    'i',
  );
  const dynRevoke = new RegExp(
    REVOKE_ALL + `[^;']{0,${GAP_A}}?ON\\s+SEQUENCE\\s+%s\\b[^;']{0,${GAP_B}}?FROM` + ROLES,
    'i',
  );
  return dynLookup.test(sql) && dynRevoke.test(sql);
}

/**
 * 🔴🔴 **量具自檢:`revokedSomewhere()` 這把尺【自己】要有紅綠兩面。**
 *
 * 為什麼要多這一格(2026-09-02, codex 抓到的那一發):
 *   我修「regex 可以跨分號」時, 把註解與 `String.raw` **寫進了同一行**
 *   ⇒ `//` 把 `String.raw` 那一段整個註解掉 ⇒ `new RegExp(` 的第一個參數變成 `'i'`
 *   ⇒ ⇒ 🔴 **`named` 變成 `/i/` —— 任何含字母 i 的檔都命中 ⇒ 每一支序列都被判「已收」。**
 * 🎯 **⇒ 那把尺死透了, 而它印【5/5 綠】。**
 * 📌 **⇒ 而我沒有在改完之後重跑那四發突變 —— 我只看了那個綠。**
 * ✅ ⇒ 所以這一格不吃外部檔案, 直接餵字串給那把尺, 讓它自己表演兩個世界。
 */
function probeRevokeRegex(text: string): boolean {
  // ✅ **呼叫共用的那一支** —— 而那正是這一格的重點:它驗的是【生產碼在用的那把尺】。
  return namedRevokeRegex('zzq_probe_id_seq').test(text);
}

/**
 * 🔵 **本檔【掃得到】的 IDENTITY 序列全集 —— 而它現在與正式庫【一樣多】。**
 *
 * ⛔ ~~原本這裡是 `NOT_YET_IN_VERSION_CONTROL`:正式庫有而本檔掃不到的那幾支~~
 * ✅ **2026-09-02 那個缺口關掉了**:`646bbeab` 收了 `⟦b4-PFEDDL2⟧`
 *    ⇒ `product_fitments_effective_staging` / `..._sync_log` 的建表 DDL 進版控
 *    ⇒ 本檔掃到的從 **4** 變 **6**,而正式庫實有 **6**(2026-09-02 唯讀 `pg_class`+`pg_depend`)
 *    ⇒ 🎯 **repo 這一側的分母,今天第一次等於正式庫那一側。**
 *
 * 🔴🔴 **而【把那份清單清空】會讓那一格變成恆綠** —— 一個 `filter(…)` 在空陣列上永遠回 `[]`。
 *   ⇒ 📌 **一個「缺口關掉了」的好消息, 如果只是把清單清空, 它會同時關掉那道守門。**
 *   ✅ **所以改成【釘住全集】**:多一支(新表)或少一支(某支變成掃不到)**兩個方向都會紅**。
 */
const PINNED_IDENTITY_SEQUENCES: readonly string[] = [
  'admin_saved_order_views_id_seq',
  'auth_callback_events_id_seq',
  'product_fitments_effective_id_seq',
  'product_fitments_effective_staging_id_seq',
  'product_fitments_effective_sync_log_id_seq',
  'product_fitments_id_seq',
] as const;

describe('⟦b4-SEQACL1⟧ public 的 IDENTITY 序列不得對 anon 開著', () => {
  const found = identitySequencesFromMigrations();

  it('量具自檢:真的掃到 migration 與 IDENTITY 宣告了(空集合會讓下面恆綠)', () => {
    expect(migrations().length).toBeGreaterThan(50);
    expect(found.size).toBeGreaterThan(0);
  });

  it('🟢 正對照:掃得到一支【一定在】的(它的建表 migration 就在版控裡)', () => {
    expect([...found.keys()]).toContain('admin_saved_order_views_id_seq');
  });

  it('🔴 量具自檢:那把 REVOKE 尺【自己】要有紅有綠(它死掉的時候會印全綠)', () => {
    const OK = 'REVOKE ALL PRIVILEGES ON SEQUENCE public.zzq_probe_id_seq FROM PUBLIC, anon, authenticated;';
    expect(probeRevokeRegex(OK), '🟢 正對照:一發完整的 REVOKE 必須命中').toBe(true);
    // 🔵 以下每一發都【該不命中】—— 少一個角色 / 只收單項權限 / 跨過分號 / 收到別支序列
    expect(probeRevokeRegex('REVOKE ALL ON SEQUENCE public.zzq_probe_id_seq FROM PUBLIC, anon;')).toBe(false);
    expect(probeRevokeRegex('REVOKE SELECT ON SEQUENCE public.zzq_probe_id_seq FROM PUBLIC, anon, authenticated;')).toBe(false);
    expect(
      probeRevokeRegex(
        'REVOKE ALL ON SEQUENCE public.zzq_probe_id_seq FROM service_role;\n' +
          'REVOKE ALL ON TABLE public.bar FROM PUBLIC, anon, authenticated;',
      ),
      '🔴 跨分號那一格 —— 前一版就是在這裡假綠的',
    ).toBe(false);
    expect(probeRevokeRegex('REVOKE ALL ON SEQUENCE public.other_id_seq FROM PUBLIC, anon, authenticated;')).toBe(false);
    expect(probeRevokeRegex('這一段裡有字母 i, 而它不是一發 REVOKE'), '🔴 尺死成 /i/ 的那一格').toBe(false);
  });

  it('🔴 動態那條路的【負對照】—— 查了序列而【沒有收乾淨】必須判 false', () => {
    // 🔴🔴 **這一格是 `-fc` 2026-09-02 量出來的缺口**(它兩個方向各一發突變):
    //   · `dynRevoke` 改成【永不命中】⇒ **1 紅** ⇒ 正對照【有】——
    //     而那個正對照是**意外得來的**:`admin_saved_order_views_id_seq` 與
    //     `auth_callback_events_id_seq` 這兩支**真實序列靠它才判得成綠** ⇒ 它死掉它們就紅。
    //     ⇒ 🛑 **所以「尺會動」今天是被【真實資料】守著的, 不是被測試守著的**
    //       ⇒ 而那是會過期的保護:那兩支改成具名寫法(或表被刪)⇒ 正對照跟著消失。
    //   · `dynRevoke` 改成【永遠命中】⇒ **6 全綠, 零訊號** ⇒ 負對照【沒有】。
    // 🎯 **⇒ 判別句(`-fc` 給):一把尺的兩個失效方向, 只有一個會有人來吵 ——**
    //    **而沒有人吵的那個, 就是它沒有守門的那個。**
    //    (永不命中 = 假紅, 有人會吵;**永遠命中 = 假綠**, 把沒收的序列判成收了。)
    // ✅ 而這一格**走 `revokedSomewhere()` 那支**, 不重打判準 —— 照本檔自己那條規矩。
    const seq = 'zzq_dynneg_id_seq';
    // 🔵 這一格不吃外部檔案, 而是把兩個世界都造出來餵同一支函式。
    const oneRole = `DO $s$ BEGIN
      v := pg_get_serial_sequence('public.zzq_dynneg', 'id');
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon', v);
    END $s$;`;
    const allRoles = `DO $s$ BEGIN
      v := pg_get_serial_sequence('public.zzq_dynneg', 'id');
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', v);
    END $s$;`;
    expect(dynRevokedIn(oneRole, 'zzq_dynneg', 'id'), '🔴 只收 anon(少兩個角色)⇒ 必須 false').toBe(false);
    expect(dynRevokedIn(allRoles, 'zzq_dynneg', 'id'), '🟢 三個角色都收 ⇒ 必須 true').toBe(true);
    expect(
      dynRevokedIn(`SELECT 1; -- 沒有查序列也沒有 REVOKE，只是含字母 i`, 'zzq_dynneg', 'id'),
      '🔵 什麼都沒有 ⇒ 必須 false(尺死成恆真時這一格會紅)',
    ).toBe(false);
    expect(seq).toBe('zzq_dynneg_id_seq'); // 佔位:讓上面那個常數有用途, 避免 lint
  });

  it('🔵 負對照:一個現造的序列名【不】在掃描結果裡', () => {
    expect(found.has('zzq_no_such_table_id_seq')).toBe(false);
  });

  it('🔴 每一支從 migration 進來的 IDENTITY 序列, 都要有人明寫過 REVOKE', () => {
    const naked = [...found.entries()]
      .filter(([seq, v]) => !revokedSomewhere(seq, v.table, v.col))
      .map(([seq, v]) => `${seq}(建於 ${v.file})`)
      .sort();
    // 🛑 這一格紅的時候, **不要直接加白名單** —— 去那支 migration 裡補一行:
    //    REVOKE ALL PRIVILEGES ON SEQUENCE public.<seq> FROM anon, authenticated;
    //    🔵 而它已 apply ⇒ 另開一支新的收(已 apply 的 migration 連註解都不能再動)。
    expect(
      naked,
      `這些 IDENTITY 序列沒有人收過它對 anon 的權限 —— 表只給讀, 而序列會給「改」:${naked.join(', ')}`,
    ).toEqual([]);
  });

  it('🔴 掃得到的 IDENTITY 序列全集要與釘住的那份【全等】—— 兩個方向都會紅', () => {
    // 🎯 這一格取代了原本的 `NOT_YET_IN_VERSION_CONTROL`(那份清單 2026-09-02 已經空了,
    //    而**空清單會讓那一格恆綠**)。
    // 🛑 紅的時候先分方向:
    //    · **多一支** ⇒ 有人加了新的 IDENTITY 表 ⇒ 先回答「它的序列有沒有人收過權限」
    //      (上面那一格會一起紅);確認過再把名字加進來。
    //    · **少一支** ⇒ 🔴 有一支【本來掃得到而現在掃不到】⇒ 那多半是**掃描壞了**,
    //      不是那張表消失了 ⇒ 先去看 `identitySequencesFromMigrations()` 而不是改這份清單。
    // 🔵 用 describe 內已經算好的 `found`(nit 6)—— 讓這一格與上面幾格量的是**同一次**掃描。
    expect(
      [...found.keys()].sort(),
      '掃得到的 IDENTITY 序列與釘住的那份不一致。' +
        '**多一支** ⇒ 有人加了新的 IDENTITY 表, 先看上面那格(它的序列有沒有人收過權限), ' +
        '確認過再把名字加進 PINNED_IDENTITY_SEQUENCES;' +
        '**少一支** ⇒ 多半是掃描壞了或有人改了既有 migration 的 CREATE TABLE 寫法, ' +
        '先去看 identitySequencesFromMigrations() 而不是改這份清單。' +
        '⚠️ 而本檔掃的是【工作樹目錄】不是 git 追蹤集 ⇒ ' +
        '先確認那支 migration 是不是你自己還沒 commit 的。',
    ).toEqual([...PINNED_IDENTITY_SEQUENCES].sort());
  });
});
