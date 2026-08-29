// is-manager-cost-contract.test.ts — ⟦b4-MGR0⟧「is_manager 不拆欄」這個拍板的機械守門。
//
// 🔴 **這一格守的是一個【決定】,不是一段行為。**
//    Sean 2026-08-29 拍板 `Q-COST` 逐字「甲　就這樣, 不用改」⇒ `public.staff.is_manager`
//    同時承載「看得到成本」與「改得了設定」兩個語意, **刻意不拆成兩欄**。
//    理由(他的話):一個看得到成本的人, 就該能管設定 —— 這兩件事在 PCM 是同一種人。
//
// 🔴 **為什麼需要守門:因為這個決定【沒有任何程式碼實體】。**
//    「不拆欄」是一個【不存在的東西】—— 它在 schema 上、在 TS 上、在測試上都沒有形狀。
//    ⇒ 下一個做成本遮蔽片的人, 看不到任何東西阻止他加第二個欄位,
//      而他加下去的那一刻, 三綠全綠、審查也看不出來(diff 上「多一個布林欄」長得完全合理)。
//    📌 **一個「不要做某件事」的拍板, 預設是沒有守門的 —— 而做了那件事的人不會收到訊號。**
//
// ⚠️⚠️ **它守不住什麼(寫在旁邊, 否則下一個人會以為都涵蓋了)**
//    —— 🔴 下列 ①②③④ 是作者自己列的;**⑤⑥⑦ 是 codex 對抗審查 2026-08-29 補的,
//       而它們比作者列的那四條【射程更大】—— 留著那個對比, 不要合併**:
//    ① 🔴 **第 2 格是一把【猜名字】的尺** —— 它認的是 cost / price / margin / 成本 / 定價 / 毛利
//       這一族的字面。有人取名 `finance_flag` / `tier_b` / `flag2` ⇒ **它一格都抓不到, 而它印綠**。
//       📌 memory `feedback_ruler-that-guesses-names-was-never-connected` 同族。
//    ② **只掃 `supabase/migrations/*.sql`** —— 在 SQL Editor 手動加的欄, 這裡看不見。
//       (本 repo 已有前例:`product_fitments_effective` 整張表不在版控裡,板 `#299`。)
//    ③ **`supabase/migrations/` 是【歷史】不是【現況】** —— 檔在不代表那個欄還活著。
//    ④ 第 1 格比對的是 **repo 裡最後一支** COMMENT, **不是正式庫現在的 COMMENT**。
//    ⑤ 🔴 **檔名字串順序 ≠ 實際套用順序**(codex MF4)。有人補一支【較早版本號】的檔並在之後才套,
//       本測試仍會選檔名較晚的那支 ⇒ **它答的是「repo 裡排最後的那支」, 不是「最後被執行的那支」。**
//    ⑥ 🔴🔴 **拆欄不一定要加欄**(codex MF10)—— 第二個語意可以搬到**另一張表 / JSON 欄 / DB 角色 /
//       設定檔 / 環境變數**。**那些世界本測試全綠。**⇒ 本格擋的是【最直覺的那一種拆法】, 不是「拆欄」。
//    ⑦ 🔴 **它不守行為, 只守字面**(codex MF11)—— 有人把 `is_manager` 改名/刪掉、或拿掉
//       `authorizeManagerMutation` 的實際授權邏輯, **歷史 COMMENT 仍在、四個錨仍在** ⇒ 前兩格照樣綠。
//       ⇒ 第 4 格補了一道**最低限度**的存在性斷言, 而它只擋「整個函式不見」, **擋不住「函式還在而內容被掏空」**。

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '../../../../../supabase/migrations');

const sqlFiles = (): string[] => readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

/**
 * 把 SQL 的 `--` 行註解拿掉(字串字面裡的 `--` 不算)。
 * 🔴 **為什麼需要它**(codex R2 新增的 must-fix):不剝註解的話,
 *    一支「先 `IS NULL` 清掉、下面再把好的 COMMENT 註解起來」的檔,
 *    尺會抓到那段【被註解掉的】好 COMMENT ⇒ **DB 裡沒有註解, 而測試全綠。**
 * ⚠️ **天花板**:它不懂 dollar-quoting(`$$ … $$`)。函式本體裡的 `--` 會被誤剝。
 *    本守門只讀 COMMENT 語句, 不讀函式本體 ⇒ 現在不影響;**有人把 COMMENT 包進 DO 區塊就會。**
 */
function stripSqlLineComments(sql: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    if (inStr) {
      out += c;
      if (c === "'") {
        if (sql[i + 1] === "'") out += sql[++i]!; // '' 是跳脫, 不是結束
        else inStr = false;
      }
      continue;
    }
    if (c === "'") { inStr = true; out += c; continue; }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * 抓 `COMMENT ON COLUMN … staff.is_manager IS '…'` **或** `… IS NULL`。
 * 🔴 **兩種都要抓**(codex MF7):只抓 `IS '…'` 的話, 一支「把註解清成 NULL」的 migration
 *    完全不命中 ⇒ 尺會回頭選到更早那支好的註解 ⇒ **DB 裡沒有註解了, 而測試全綠。**
 * 🔴 `g` flag + 取【最後一個】(codex MF8):同一支檔裡先寫好的、後寫舊的, 只取第一段會判錯。
 */
const COMMENT_RE_G =
  /COMMENT\s+ON\s+COLUMN\s+(?:"?public"?\.)?"?staff"?\."?is_manager"?\s+IS\s+(?:'([\s\S]*?)'|(NULL))\s*;/gi;

/**
 * 抓「往 staff 加一個成本相關的欄」。
 * 🔴 codex MF5 折入的四種漏抓:①`ADD` 可省略 `COLUMN` ②`ALTER TABLE ONLY` ③`"public"."staff"`
 *    ④非 ASCII 欄名(`"成本可見"`)—— JS 的 `\w` 只認 [A-Za-z0-9_], 中文欄名一律漏掉。
 * 🔴 codex nit 折入的誤抓:原本 `[\s\S]{0,200}` **會跨過分號**, 把
 *    `ALTER TABLE staff …; ALTER TABLE orders ADD COLUMN cost_total` 誤判成 staff 加欄。
 *    ⇒ 改成 `[^;]{0,200}` —— **不跨分號**。
 */
const COST_COLUMN_RE =
  /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:"?public"?\.)?(?:"staff"|staff\b)[^;]{0,200}?\bADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([^\s",;()]*(?:cost|price|margin|成本|定價|毛利)[^\s",;()]*)"?/i;

/** 掃全部 migration, 依檔名序回傳【最後一個】COMMENT 語句(含被清成 NULL 的那種)。 */
function lastComment(): { file: string; body: string | null } | null {
  let found: { file: string; body: string | null } | null = null;
  for (const f of sqlFiles()) {
    const sql = stripSqlLineComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    COMMENT_RE_G.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = COMMENT_RE_G.exec(sql)) !== null) {
      found = { file: f, body: m[2] ? null : (m[1] ?? '') };
    }
  }
  return found;
}

/**
 * 🔴 **第 1 格的判準抽成一支函式**(codex R2 MF9 —— 這一條第一輪修法沒到位)。
 * 上一版的對照格只斷言「舊字面不含 Q-COST」⇒ **那證明的是舊字面, 不是【守門會紅】。**
 * ⇒ 現在對照格把舊世界【餵回同一支函式】, 它必須回 false。
 * 📌 判別句:一個對照組要證明的是「守門在那個世界會紅」, 不是「那個世界長得不一樣」。
 */
function rulingPresent(body: string | null): boolean {
  return (
    body !== null &&
    body.includes('is_manager AND is_active') &&
    body.includes('Q-COST') &&
    body.includes('不拆') &&
    body.includes('就等於給他鑄造管理者的權限')
  );
}

describe('⟦b4-MGR0⟧ is_manager 不拆欄 —— Sean 2026-08-29 Q-COST 拍板的守門', () => {
  it('repo 裡最後一支 COMMENT 必須寫著這個拍板(而不是把它寫成待決事項, 也不是被清成 NULL)', () => {
    const last = lastComment();

    // 🔴 分母先斷言 —— 一個「零命中」的世界會讓下面每一格都恆真。
    expect(last).not.toBeNull();
    // 🔴 被清成 NULL 也算失守(codex MF7):那時 DB 裡根本沒有說明。
    expect(last!.body).not.toBeNull();
    const body = last!.body!;

    // 正對照:抓到的確實是這一欄的註解(尺接得上, 不是抓到空字串)。
    expect(body).toContain('is_manager AND is_active');

    // 本格要守的:拍板的錨與結論都在。
    expect(body).toContain('Q-COST');
    expect(body).toContain('不拆');
    // 而【代價】也要留著 —— 一個只寫結論不寫代價的註解, 會被下一個人讀成「這樣沒問題」。
    expect(body).toContain('就等於給他鑄造管理者的權限');

    // 負對照:現造一個不存在的字面, 證明 toContain 不是恆真。
    expect(body).not.toContain('Q-COST-' + Date.now().toString(36));

    // 🔴 而【同一支判準函式】也必須放行 —— 對照格餵的就是它(codex R2 MF9)。
    expect(rulingPresent(last!.body)).toBe(true);
  });

  it('沒有人往 staff 加第二個「成本可見性」欄(加了 ⇒ 紅, 要人去讀那個拍板)', () => {
    const offenders = sqlFiles().filter((f) =>
      COST_COLUMN_RE.test(stripSqlLineComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });

  it('🔴 第 1 格那把尺自己會動 —— 拿【前一版註解的原文】與【被清成 NULL】兩個世界餵它', () => {
    // 🔴 **為什麼是這個形狀**:突變真檔被 permissions 擋下(擋得對 —— 一支被突變的 migration
    //    曾經被 commit 進正式分支, `02dd510e`)。⇒ 改成把【那些世界】現造出來餵給同一把尺。

    // 世界一:20260828070000 那支的原文節錄, 逐字 —— Q-COST 拍板【之前】的世界。
    const before = `COMMENT ON COLUMN public.staff.is_manager IS
  '本欄目前【承載兩個語意】, 而它們尚未被拆開 ——
   只有 is_manager AND is_active 的 actor 才能新增 / 修改 / 停用員工與本欄
   ⚠️ 成本遮蔽片動工時必須先決定:沿用本欄, 還是拆成兩欄。';`;
    COMMENT_RE_G.lastIndex = 0;
    const m1 = COMMENT_RE_G.exec(before);
    expect(m1).not.toBeNull();
    expect(m1![1]).toContain('is_manager AND is_active'); // 正對照:尺抓得到它
    // 🔴🔴 **把舊世界餵回【第 1 格自己用的那支判準】** —— 它必須回 false。
    //    這才是「守門在那個世界會紅」;只斷言「不含 Q-COST」證明的是舊字面, 不是守門。
    expect(rulingPresent(m1![1]!)).toBe(false);
    // 而「註解被清成 NULL」那個世界也必須被判失守。
    expect(rulingPresent(null)).toBe(false);

    // 世界二:被清成 NULL(codex MF7 指的那個世界)。
    COMMENT_RE_G.lastIndex = 0;
    const m2 = COMMENT_RE_G.exec('COMMENT ON COLUMN public.staff.is_manager IS NULL;');
    expect(m2).not.toBeNull();
    expect(m2![2]).toBe('NULL'); // 抓得到, 而且分得出它是 NULL 那一種

    // 世界三:同一段文字裡先好後舊 ⇒ 必須取【最後一個】(codex MF8)。
    COMMENT_RE_G.lastIndex = 0;
    const both = `COMMENT ON COLUMN public.staff.is_manager IS 'Q-COST 不拆';
COMMENT ON COLUMN public.staff.is_manager IS '尚未被拆開';`;
    const hits: string[] = [];
    let mm: RegExpExecArray | null;
    while ((mm = COMMENT_RE_G.exec(both)) !== null) hits.push(mm[1] ?? 'NULL');
    expect(hits).toHaveLength(2);
    expect(hits[hits.length - 1]).toBe('尚未被拆開'); // 最後一個是舊的 ⇒ 該紅
  });

  it('🔴 第 2 格那把尺自己會動 —— 正負對照各數發(否則上一格的空陣列沒有意義)', () => {
    // 正對照:現造【應該被抓到】的四種合法寫法。任一抓不到 ⇒ 上一格的綠是假的。
    expect(
      COST_COLUMN_RE.test('ALTER TABLE public.staff ADD COLUMN can_view_cost boolean NOT NULL DEFAULT false;'),
    ).toBe(true);
    expect(COST_COLUMN_RE.test('alter table "staff" add column if not exists "cost_visible" boolean;')).toBe(true);
    // codex MF5 的四種漏抓, 逐一驗它們現在接得住:
    expect(COST_COLUMN_RE.test('ALTER TABLE ONLY "public"."staff" ADD "price_visible" boolean;')).toBe(true);
    expect(COST_COLUMN_RE.test('ALTER TABLE public.staff ADD COLUMN "成本可見" boolean;')).toBe(true);

    // 負對照一:長得很像但不該被抓。
    expect(COST_COLUMN_RE.test('ALTER TABLE public.staff ADD COLUMN nickname text;')).toBe(false);
    // 負對照二:別的表加成本欄, 不關本守門的事。
    expect(COST_COLUMN_RE.test('ALTER TABLE public.orders ADD COLUMN cost_total integer;')).toBe(false);
    // 🔴 負對照四(codex R2 nit H):**別的表名以 staff 開頭**, 不得誤抓。
    expect(COST_COLUMN_RE.test('ALTER TABLE public.staff_archive ADD COLUMN cost_visible boolean;')).toBe(false);
    expect(COST_COLUMN_RE.test('ALTER TABLE "public"."staff_archive" ADD COLUMN cost_visible boolean;')).toBe(false);
    // 而真正的 staff 仍要抓得到(正對照 —— 否則上面兩個 false 可能是因為尺整個死了)。
    expect(COST_COLUMN_RE.test('ALTER TABLE public.staff ADD COLUMN cost_visible boolean;')).toBe(true);

    // 🔴 負對照三(codex nit):兩句 SQL 排在一起, 不得跨過分號誤判。
    expect(
      COST_COLUMN_RE.test('ALTER TABLE public.staff ADD COLUMN nickname text; ALTER TABLE public.orders ADD COLUMN cost_total integer;'),
    ).toBe(false);
  });

  it('🔴 剝 SQL 註解那一步自己會動 —— 被註解掉的 COMMENT 不得算數(codex R2 新增 must-fix)', () => {
    // 🔴 **那個世界**:先把註解清成 NULL, 下面再把一段好的 COMMENT【註解起來】。
    //    不剝註解的話, 尺會抓到那段被註解掉的好 COMMENT ⇒ DB 裡沒有註解而測試全綠。
    const world = `COMMENT ON COLUMN public.staff.is_manager IS NULL;
-- COMMENT ON COLUMN public.staff.is_manager IS 'Q-COST 不拆 is_manager AND is_active 就等於給他鑄造管理者的權限';`;

    // 沒剝之前:尺會撈到【兩個】—— 而最後那個是被註解掉的假貨。
    COMMENT_RE_G.lastIndex = 0;
    const rawHits: string[] = [];
    let r: RegExpExecArray | null;
    while ((r = COMMENT_RE_G.exec(world)) !== null) rawHits.push(r[2] ? 'NULL' : (r[1] ?? ''));
    expect(rawHits).toHaveLength(2); // 正對照:證明那個陷阱真的存在, 不是我想像的

    // 剝之後:只剩下真正生效的那一個, 而它是 NULL ⇒ 判失守。
    COMMENT_RE_G.lastIndex = 0;
    const cleanHits: string[] = [];
    let c: RegExpExecArray | null;
    const cleaned = stripSqlLineComments(world);
    while ((c = COMMENT_RE_G.exec(cleaned)) !== null) cleanHits.push(c[2] ? 'NULL' : (c[1] ?? ''));
    expect(cleanHits).toEqual(['NULL']);

    // 而字串字面【裡面】的 `--` 不可以被剝掉(否則會剝壞真正的 COMMENT 內容)。
    expect(stripSqlLineComments("COMMENT ON COLUMN x IS 'a -- b';")).toContain('a -- b');
  });

  it('🔴 那道閘的【實體】還在 —— 註解指名的東西不得只活在註解裡(codex MF11 的最低限度)', () => {
    // 📌 前兩格全部只讀 SQL 字面。有人把授權函式整個拿掉, 那兩格【照樣綠】。
    //    ⇒ 這一格只擋「它整個不見了」;**擋不住「它還在而內容被掏空」** —— 那要行為測試, 不是本格。
    // 🔴 **這一格第一次跑就紅了, 而它抓到的是【我自己在 COMMENT 裡寫錯的一句話】**:
    //    我原本寫「閘在 authorize.ts」並斷言那支檔含 `is_manager` ⇒ **紅**。
    //    實查:`authorize.ts:99` 的 `authorizeManagerMutation` **不讀那一欄**,
    //    它呼叫 `staff.ts` 的 `isActiveManager`, 而讀欄的是 `staff.ts:208`。
    //    📌 ⇒ 一個只指到 `authorize.ts` 的註解, 會把下一個人送到一支【不出現那個欄名】的檔,
    //       而他會以為自己找錯地方。⇒ COMMENT 已改成同時指名兩層。
    const authorizePath = resolve(HERE, 'authorize.ts');
    const staffPath = resolve(HERE, '../staff.ts');
    expect(existsSync(authorizePath)).toBe(true);
    expect(existsSync(staffPath)).toBe(true);
    const authorizeSrc = readFileSync(authorizePath, 'utf8');
    const staffSrc = readFileSync(staffPath, 'utf8');
    expect(authorizeSrc).toContain('authorizeManagerMutation'); // 閘本身
    // 🔴 codex R2 G:只斷言【名字】的話, 有人把呼叫刪掉、名字留在註解裡, 這格照樣綠。
    //    ⇒ 斷言的是【那一次呼叫】與【那一次比較】, 不是名字出現過。
    expect(authorizeSrc).toMatch(/await\s+isActiveManager\s*\(/); // 真的呼叫了下一層
    expect(staffSrc).toMatch(/export\s+async\s+function\s+isActiveManager\s*\(/); // 下一層真的存在
    expect(staffSrc).toMatch(/row\.is_manager\s*===\s*true/); // 真的比較了那一欄
    // ⚠️ **仍然守不住**:呼叫在、比較在, 而有人在它們上面加一條提早 return ⇒ 這格照樣綠。
    //    那要行為測試, 不是字面守門。本格只擋「整條線不見了」。
    // 負對照:現造字面, 證明 toContain 不是恆真。
    expect(authorizeSrc).not.toContain('authorizeManagerMutation_' + Date.now().toString(36));
    expect(staffSrc).not.toContain('is_manager_' + Date.now().toString(36));
  });
});
