// ⟦f3-SHIPPROGRESS1⟧ 的【會叫的那一道】—— 釘住「今天開放給客人的欄位集合」。
//
// ══ 🔴 它在防什麼(而它防的不是今天) ═══════════════════════════════════════
// 2026-09-02 Sean 拍 🅐:客人讀得到自己那張單的 `shipments` **整列**
// (`20260902060000_m4b_c7_shipments_select_own.sql`)。
// ⇒ 而那扇門【今天是乾淨的】:全表 2 列,`hct_raw_response` 非 NULL **0** 列。
// 🛑 **而那正是它的問題** —— 那一欄裝的是第三方(新竹物流)回給我們的原始回應,
//    而新竹 API 接起來那天它會被填滿,**而那時沒有人會回來看這扇門**。
//
// 📌 **⇒ 所以這裡要的不是一句提醒,是一個【那天會紅】的東西。**
//    而「那天」實際上有兩種:
//      ① 有人在 `shipments` **加一個新欄** ⇒ 那個欄自動對客人可見 ⇒ **本檔會紅**
//      ② 有人開始【往既有的內部欄寫東西】⇒ 🔴 **本檔抓不到**(它讀 migration,不讀資料)
//    ⇒ 🛑 ② 那一格由 `COMMENT ON COLUMN public.shipments.hct_raw_response` 承擔,
//      而那是一句話不是一道閘 —— **寫在這裡,不要讓下一個人以為兩種都被守住了。**
//
// 🔵 而為什麼釘【集合】不釘【數量】:數量對得上而成員換過,在一個數字上長得一樣。
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(__dirname, '..', 'supabase', 'migrations');

/** 2026-09-02 開門那一刻 `shipments` 的欄位集合(建表 `20260805170000`,15 欄)。 */
const PINNED_SHIPMENTS_COLUMNS: readonly string[] = [
  'carrier_code',
  'carrier_note',
  'created_at',
  'customer_user_id',
  'deleted_at',
  'hct_raw_response',
  'hct_request_id',
  'hct_status',
  'id',
  'recipient_snapshot',
  'shipment_reference',
  'shipped_at',
  'tracking_number',
  // 🔴 **2026-09-04 新增(⟦5b-TRACKNUMGAP1⟧ 片 C)。而這一格【不是】順手加名單。**
  //    這道閘自己寫著:紅的時候先答「客人看得到這一欄, 可以嗎?」
  //    ✅ **答:可以。** 它是一個時點, 意思是「這一箱的貨運單號被更正過」——
  //    ① 它在**客人自己那一列**上(RLS 只讓他看自己的箱)、不牽涉任何別人;
  //    ② 我們正在**主動寄一封信告訴他這件事** ⇒ 藏起來也沒有保護到什麼;
  //    ③ 它比同一份名單上已經開放的 `hct_raw_response` / `hct_request_id` / `carrier_note`
  //       **敏感度更低**(那三欄是我們與新竹之間的內部往來)。
  //    🛑 **而替代方案要寫出來讓人推翻**:要它對客人不可見, 得把整列開放改成欄級授權,
  //      那是動 policy(鐵則 12②)、不在本片, 而 `has_*_privilege` 對欄級授權會少報
  //      (`docs/patterns/revoking-function-execute-in-supabase.md`)⇒ 那道尺本身要先修。
  //    📎 **這一格是 codex 對抗審查抓的** —— 而我自己的 `vitest related` 印 0 紅:
  //      本檔是**掃描型守門、零 import 被測檔** ⇒ related 的分母裡結構上沒有它。
  'tracking_corrected_at',
  'updated_at',
  'void_reason',
] as const;

/**
 * 🔴 `shipment_items` 也被 `GRANT SELECT … TO authenticated` ⇒ **它的每一欄一樣對客人開放**。
 *
 * 📌 **這一格是 codex 抓的(2026-09-02,must-fix)**,而它是本檔前一版最大的洞:
 *   本檔檔名、標題、每一句註解都只講 `shipments` ⇒ **有人在 `shipment_items` 上加一個
 *   `carrier_payload` 之類的內部欄, 它自動對客人可見, 而本檔【整支全綠】。**
 * 🎯 **⇒ 一把尺的分母由它掃什麼決定, 而不是由它叫什麼名字決定。**
 *
 * 🔵 名單來源(兩側):`20260805170000` 建表片,以及 2026-09-02 14:4x 對正式庫的唯讀查詢
 *   (`pg_attribute`,`attnum>0 AND NOT attisdropped`)⇒ **兩側同為這 5 欄**。
 */
const PINNED_SHIPMENT_ITEMS_COLUMNS: readonly string[] = [
  'created_at',
  'id',
  'order_item_id',
  'shipment_id',
  'shipped_quantity',
] as const;

/**
 * 這 **6** 欄是【我們與貨運商之間的】—— 客人拿得到,而那是 Sean 知情之後的決定。
 *
 * 🔴 **數字曾經是 5,而兩個審查者各自獨立抓到它**(code-reviewer + codex,2026-09-02)。
 *   `20260902060000` 那支 migration `:19` / `:118` 逐字寫「那 5 個內部欄」而同段列出 6 個。
 * ✅ **而 `-0a` 回原件量了**:`~/pcm-mailbox/給Sean-貼這兩支SQL-出貨可見-20260902.md:34`
 *   逐字「其中 **6 欄**是我們跟貨運公司之間的東西」,`:36-41` 逐欄列名。
 *   ⇒ 🎯 **所以那個 5 是【我們寫錯字】,不是【他少被告知一欄】。**
 * 🛑 而 migration 那一支**已 apply,改不了** ⇒ 那兩處錯字收在後續 migration。
 * 📌 ⇒ **一個記錄「他被告知了什麼」的數字,寫錯時沒有任何東西會紅。**
 */
const INTERNAL_COLUMNS_CUSTOMER_CAN_SEE: readonly string[] = [
  'carrier_note',
  'deleted_at',
  'hct_raw_response',
  'hct_request_id',
  'hct_status',
  'void_reason',
] as const;

/**
 * 🔴 濾掉註解 —— **註解裡的 `ADD COLUMN` 不是生效敘述,掃到會變誤報。**
 * 而這不是我想到的:`scripts/null-shortcircuit-check-guard.test.ts` 的 `stripComments()`
 * 逐字寫著同一句,而我是**用突變才撞到**的(在自己那支 migration 的註解裡加一行
 * `-- ALTER TABLE public.shipments ADD COLUMN zzq_probe_col text;` ⇒ 這一格【紅了】)。
 * 📌 ⇒ 一道會對註解叫的守門,最後會被關掉 —— 而它被關掉那天,真的那一種也不會叫了。
 */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function readMigrations(): { file: string; sql: string }[] {
  return readdirSync(MIG)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(join(MIG, f), 'utf8') }));
}

/**
 * `ADD` / `DROP` 後面接得到的【不是欄名】的字 —— 掃到會把它們當成欄。
 * 🔴 `ADD CONSTRAINT foo` / `ALTER COLUMN x DROP NOT NULL` 都會餵進來。
 */
const NOT_A_COLUMN = new Set([
  'constraint', 'primary', 'foreign', 'unique', 'check', 'exclude',
  'not', 'default', 'column', 'identity', 'generated', 'expression',
  'and', 'or',
]);

/**
 * 掃出某張表今天的欄位集合:建表那一段 + 之後每一支 `ADD` / `DROP` / `RENAME`。
 *
 * 🔴 **這一版是被審出來的**(code-reviewer nit 10/11 + codex must-fix,2026-09-02)。
 *   前一版有四個洞,而**每一個洞的形狀都一樣:真的多了一欄,而本檔印綠**:
 *     ① `ADD COLUMN a …, ADD COLUMN b …` 一句兩欄 ⇒ 只抓得到第一個
 *     ② `ALTER TABLE IF EXISTS public.shipments …` ⇒ 整句掃不到
 *     ③ `ADD "secret" text`(省略 `COLUMN`、加引號,PG 都合法)⇒ 掃不到
 *     ④ `RENAME COLUMN` ⇒ 舊名還在集合裡、新名不在 ⇒ 集合全等那一格會紅在錯的地方
 * 📌 ⇒ **一把只認一種書寫格式的尺,它的分母是【格式】不是【事實】。**
 *   (同一句話 `scripts/order-invalidation-ledgers.test.ts:37` 已經寫過一次 —— 我又踩了。)
 */
function tableColumns(table: string): Set<string> {
  const out = new Set<string>();
  const IDENT = String.raw`"?([a-z_][a-z0-9_]*)"?`;
  for (const { sql: raw } of readMigrations()) {
    const sql = stripSqlComments(raw);
    // 建表(`i` flag + 收尾允許縮排)
    const create = sql.match(
      new RegExp(String.raw`CREATE TABLE\s+(?:IF NOT EXISTS\s+)?public\.${table}\s*\(([\s\S]*?)\n\s*\)`, 'i'),
    );
    if (create?.[1]) {
      for (const line of create[1].split('\n')) {
        // 🔴 這一行【刻意】維持嚴格:恰好兩格縮排 + 不加 `i` flag。
        //    放寬成 `^\s+` + `i` 之後, CHECK 約束裡換行的 `    AND …` 會被當成一個叫 `AND` 的欄
        //    ⇒ 2026-09-02 實測:集合裡多出一個 `"AND"`, 而集合全等那一格紅在錯的地方。
        //    📌 **一個為了「掃得更廣」而做的放寬, 讓尺開始無中生有。**
        const m = line.match(/^\s{2}"?([a-z_][a-z0-9_]*)"?\s+[a-z]/);
        if (m?.[1] && !NOT_A_COLUMN.has(m[1].toLowerCase())) out.add(m[1]);
      }
    }
    // 一句 ALTER 裡可能有多個 ADD / DROP / RENAME ⇒ 先切出整句, 再在句子裡 matchAll
    for (const alter of sql.matchAll(
      new RegExp(String.raw`ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?public\.${table}\s+([\s\S]*?);`, 'gi'),
    )) {
      const body = alter[1] ?? '';
      for (const m of body.matchAll(new RegExp(String.raw`\bADD\s+(?:COLUMN\s+)?(?:IF NOT EXISTS\s+)?${IDENT}`, 'gi'))) {
        if (m[1] && !NOT_A_COLUMN.has(m[1].toLowerCase())) out.add(m[1]);
      }
      for (const m of body.matchAll(new RegExp(String.raw`\bDROP\s+(?:COLUMN\s+)?(?:IF EXISTS\s+)?${IDENT}`, 'gi'))) {
        if (m[1] && !NOT_A_COLUMN.has(m[1].toLowerCase())) out.delete(m[1]);
      }
      for (const m of body.matchAll(new RegExp(String.raw`\bRENAME\s+(?:COLUMN\s+)?${IDENT}\s+TO\s+${IDENT}`, 'gi'))) {
        if (m[1]) out.delete(m[1]);
        if (m[2] && !NOT_A_COLUMN.has(m[2].toLowerCase())) out.add(m[2]);
      }
    }
  }
  return out;
}

const shipmentsColumns = () => tableColumns('shipments');

/**
 * 依版本順序【重播】,回答「今天還在不在」—— 不是「歷史上出現過沒有」。
 *
 * 🔴🔴 **前一版是把所有 migration 的字面接成一大串再 `includes()`** ——
 *   而 forward-only 之下,移除一條 policy 的唯一方式就是後面補一支 `DROP POLICY`,
 *   **而舊檔那句 `CREATE POLICY` 永遠留在歷史裡** ⇒ 那一格**恆綠**。
 * 📌 **⇒「歷史上曾經有」與「今天還有」是兩個宣稱,而字面聯集只答得出前者。**
 */
function policyStillExists(policy: string, table: string): boolean {
  let exists = false;
  for (const { sql: raw } of readMigrations()) {
    for (const m of stripSqlComments(raw).matchAll(
      new RegExp(String.raw`(CREATE|DROP)\s+POLICY\s+(?:IF (?:NOT )?EXISTS\s+)?${policy}\s+ON\s+public\.${table}\b`, 'gi'),
    )) {
      exists = (m[1] ?? '').toUpperCase() === 'CREATE';
    }
  }
  return exists;
}

/**
 * 同理:`COMMENT ON` 是【覆寫不是追加】⇒ 只有最後一次算數。
 *
 * 🔴🔴 **前一版的 regex 是 `IS\s+([\s\S]*?);` —— 非貪婪, 停在第一個 `;`。**
 *   而 SQL 的 `;` **可以住在字串字面裡面** ⇒ 那個 `;` 一出現, 這把尺就在句子中間截斷。
 *   ⇒ 2026-09-02 真的踩到:後續 migration 把建表片原文併回來, 而那段原文裡有一個
 *     ASCII 分號(「…只保留最新一次;」)⇒ **本檔只讀到前半段, 後半段的警語看不到 ⇒ 紅。**
 *   🎯 **⇒ 而那個紅是【尺壞了】不是【碼壞了】** —— 而它印出來的東西與「警語真的不見了」一模一樣。
 *   🛑 **⇒ 而修法【不能】改那段文字**:「逐字搬回去」正是那支 migration 存在的理由。
 *
 * ✅ 本版改成**只認字串字面**:`IS` 之後收一串 `'…'`(含 `''` 跳脫), 直到字面串結束才吃 `;`
 *   ⇒ 引號裡的 `;` 對它沒有意義, 而 PG 相鄰字面自動連接的語意也被還原了。
 */
function lastColumnComment(table: string, col: string): string | null {
  let last: string | null = null;
  for (const { sql: raw } of readMigrations()) {
    for (const m of stripSqlComments(raw).matchAll(
      new RegExp(
        String.raw`COMMENT ON COLUMN\s+public\.${table}\.${col}\s+IS\s+((?:'(?:[^']|'')*'\s*)+);`,
        'gi',
      ),
    )) {
      // 🔵 相鄰字面串接回一整句(PG 的語意), 並把 `''` 還原成一個單引號。
      last = [...(m[1] ?? '').matchAll(/'((?:[^']|'')*)'/g)]
        .map((x) => (x[1] ?? '').replace(/''/g, "'"))
        .join('');
    }
  }
  return last;
}

describe('⟦f3-SHIPPROGRESS1⟧ 客人看得到的 shipments 欄位集合', () => {
  it('量具自檢:真的掃到 migration 了(空集合會讓下面每一格恆綠)', () => {
    // 🔴 下界只擋得住【變成 0】, 對「分母變小」失明(CLAUDE.md 既有母題)——
    //    真正承重的是下面兩格【集合全等】; 這裡只是「尺有沒有接上」。
    expect(readMigrations().length).toBeGreaterThan(50);
    expect(shipmentsColumns().size).toBeGreaterThan(10);
    expect(tableColumns('shipment_items').size).toBeGreaterThan(3);
  });

  it('🟢 正對照:掃得到一個【一定在】的欄', () => {
    expect(shipmentsColumns().has('shipped_at')).toBe(true);
  });

  it('🔵 負對照:一個現造的欄名【不】在掃描結果裡', () => {
    expect(shipmentsColumns().has('zzq_no_such_col_0902')).toBe(false);
  });

  it('🔴 shipments 長出新欄 ⇒ 這一格紅 —— 而那正是要有人回來看這扇門的那一刻', () => {
    const now = [...shipmentsColumns()].sort();
    // 🛑 這一格紅的時候,**不要直接把新欄名加進 PINNED**:
    //    先回答「客人看得到這一欄,可以嗎?」——
    //    可以 ⇒ 加進 PINNED;不可以 ⇒ 那就不是加名單,是要改那條 policy 或改成只回需要的欄。
    //    (而 Sean 2026-09-02 拍 🅐 的時候看到的是下面這 15 欄,不是任何新的。)
    expect(now).toEqual([...PINNED_SHIPMENTS_COLUMNS].sort());
  });

  it('🔴 shipment_items 長出新欄 ⇒ 這一格紅 —— 它跟 shipments 一樣是整列開放', () => {
    expect([...tableColumns('shipment_items')].sort()).toEqual(
      [...PINNED_SHIPMENT_ITEMS_COLUMNS].sort(),
    );
  });

  it('🔴 那 6 個內部欄【仍然存在於這張表上】—— 這一格是紀錄,不是核可', () => {
    // 🛑 **字面收窄(codex nit)**:它證得到的只有「欄還在」——
    //    哪天改成 RPC / 欄級 GRANT 把它收掉, **這六欄照樣物理存在** ⇒ 這一格不會紅。
    //    ⇒ 真正在守「還開不開放」的是上面那兩格(集合全等 + policy 重播), 不是這一格。
    // 🎯 它存在的理由:讓「客人看得到我們與貨運商之間的東西」這件事**有一個會被讀到的落點**。
    //   哪天有人把其中一欄收掉(改成 RPC / 欄級 GRANT)⇒ 這一格會紅 ⇒ 那時把它從這裡移除。
    const cols = shipmentsColumns();
    for (const c of INTERNAL_COLUMNS_CUSTOMER_CAN_SEE) {
      expect(cols.has(c), `內部欄 ${c} 不在 shipments 上了 ⇒ 回來更新這張清單`).toBe(true);
    }
  });

  it('🔴 那道 policy 今天【還在】—— 而不是「歷史上出現過」', () => {
    // 🔴🔴 這一格前一版是恆綠的, 兩個審查者各自獨立抓到(code-reviewer must-fix 3 + codex)。
    //    前一版比對的是【所有 migration 的字面聯集】⇒ 後面補一支 `DROP POLICY` 也不會紅,
    //    因為舊檔那句 `CREATE POLICY` 永遠留在歷史裡。
    expect(policyStillExists('shipments_select_own', 'shipments')).toBe(true);
    expect(policyStillExists('shipment_items_select_own', 'shipment_items')).toBe(true);
    // 🟢 正對照:同一把尺對一條【真的被 DROP 過又沒補回來】的名字要答 false
    expect(policyStillExists('zzq_never_created_0902', 'shipments')).toBe(false);
  });

  it('🔴 那句給【客人可見】的警語, 是那一欄現在生效的註解', () => {
    // 🔴🔴 同一個根:`COMMENT ON` 是**覆寫不是追加**, 而建表片 `20260805170000`
    //    在同一欄上也下過一次 COMMENT ⇒ 只問「這個字面在不在歷史裡」那一格恆綠。
    // 📌 而這個根今天真的咬了我們一次:本片那句 COMMENT **蓋掉了** 建表片記在同一欄上的
    //    Sean 2026-08-05 Q-b=A 拍板紀錄(重送覆蓋前一次 / 承接方案見 plan §5.1 備選②③),
    //    而它已經生效在正式庫上。修法是另開一支 migration 把兩段【併起來】重下一次。
    //    ⇒ 🎯 **一個被推薦為耐久的落點, 它的耐久性沒有任何機制保護 —— 而它失效時零訊號。**
    const now = lastColumnComment('shipments', 'hct_raw_response');
    expect(now, '那一欄現在沒有任何 COMMENT ⇒ 尺沒接上').not.toBeNull();
    expect(now).toContain('這一欄對【客人】可見');
    // 🟢 正對照:尺讀得到內容(不是回一個空字串就通過)
    expect((now ?? '').length).toBeGreaterThan(100);
    // 🔵 負對照:現造的欄名 ⇒ 沒有註解
    expect(lastColumnComment('shipments', 'zzq_no_such_col_0902')).toBeNull();
  });
});
