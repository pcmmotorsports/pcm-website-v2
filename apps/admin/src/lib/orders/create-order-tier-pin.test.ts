import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * create-order-tier-pin.test.ts —— **釘住現值的閘**(片 B2丙,2026-08-29)。
 *
 * 🔴 **它不是「防止改動」,是【讓改動叫一聲】。**
 *
 * ══ 它在守什麼 ══════════════════════════════════════════════════════════
 * 顧客站的 `create_order` 今天**寫死** `tier_at_checkout = 'general'`。
 * 而經銷價一接通,它就會開始寫 `'store'` —— **那一刻顧客站要同時開始算稅**
 * (經銷價是【未稅】的:Sean 2026-08-29 逐字「網站售價都含稅沒問題,但是經銷價都是未稅。」)
 * ⇒ 若只改了 RPC 而沒接稅 ⇒ **客人會真的少付 5%,而沒有任何東西會紅。**
 *
 * ⇒ 本格就是那個鬧鐘:**有人把那一行改掉的那一刻,它紅。**
 *
 * ══ 🔴 而【它紅的時候要說得出為什麼】═════════════════════════════════════
 * 一道紅了而說不出理由的閘,下一個人會直接把期望值更新掉。
 * ⇒ 所以下面每一個斷言都帶訊息,而訊息說的是**下一步要做什麼**,不是「值不對」。
 *
 * ══ ⚠️ 它為什麼【不能】grep 整個 migrations 目錄 ═══════════════════════════
 * `::public.member_tier` 這個字面命中多支 migration,而**只有最後一次重定義
 * `create_order` 的那一支是活的** —— 其餘是歷史,改它們沒有任何作用。
 * 🔴 **而它們在 grep 底下長得一模一樣。**
 *
 * ══ 🔴🔴 而【第一版的尺太鬆,codex 2026-08-29 兩條 must-fix 打死它】══════════
 * ```
 * ① 選檔靠 substring `FUNCTION public.create_order` ⇒ 一支只寫
 *    `COMMENT ON FUNCTION public.create_order(...)` 的 migration **會被當成活的定義**
 *    ⇒ 它找不到 tier 字面 ⇒ **該綠而紅**
 * ② 主斷言掃【整支檔的所有 member_tier 字面】⇒ 真正的 INSERT 改成 `CAST('store' AS …)`
 *    而註解裡還留著 `'general'::public.member_tier` ⇒ **該紅而綠**
 * ```
 * ⇒ 現在兩處都收緊:選檔只認**行首的 `CREATE [OR REPLACE] FUNCTION`**,
 *   主斷言只讀 **`INSERT INTO public.orders (…) VALUES (…)` 裡 `tier_at_checkout` 那一格**。
 * ⚠️ **而它仍然不是 parser** —— 見檔尾「這把尺還看不到什麼」。
 */

const MIGRATIONS_DIR = resolve(__dirname, '../../../../../supabase/migrations');

/** 🔴 只認【行首】的 `CREATE [OR REPLACE] FUNCTION public.create_order(` —— 不是 substring。 */
const DEFINES_CREATE_ORDER = /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.create_order\s*\(/m;

/** 定義 `create_order` 的 migration,依檔名(= 時間序)排序。 */
function definersOfCreateOrder(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => DEFINES_CREATE_ORDER.test(readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8')));
}

/**
 * 活的那一支 = 檔名序最後一支。
 * 🔴 **取不到就丟** —— 不用 `!` 也不用 cast:`undefined` 在這裡代表【尺沒接上】,
 *    而它與「值不對」是兩件事。
 */
function liveDefinerOfCreateOrder(): string {
  const live = definersOfCreateOrder().at(-1);
  if (live === undefined) {
    throw new Error(
      '找不到任何【行首】定義 `create_order` 的 migration ⇒ **這把尺沒有接上**' +
        '(路徑錯 / 寫法換了 / 縮排了)。先修尺,不要把這個當成「沒問題」。',
    );
  }
  return live;
}

/**
 * 從 `INSERT INTO public.orders (欄位表) VALUES (值表)` 裡,取出 `tier_at_checkout` **那一格的值**。
 * 🔴 codex must-fix:不掃全檔字面 —— 掃全檔會被註解裡的舊字面騙。
 */
function tierValueInOrdersInsert(sql: string): string | null {
  const m = /INSERT\s+INTO\s+public\.orders\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/m.exec(sql);
  if (m === null) return null;
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  const cols = stripComments(m[1] ?? '')
    .split(',')
    .map((s) => s.trim());
  const vals = stripComments(m[2] ?? '')
    .split(',')
    .map((s) => s.trim());
  const i = cols.indexOf('tier_at_checkout');
  if (i < 0 || i >= vals.length) return null;
  return vals[i] ?? null;
}

describe('片 B2丙 · 釘住 create_order 的 tier_at_checkout 現值', () => {
  // ── 尺自己的自檢①:選檔規則要真的挑得到 ────────────────────────────────
  it('前提:找得到【行首】定義 create_order 的 migration(找不到 = 尺沒接上)', () => {
    expect(
      definersOfCreateOrder().length,
      '找不到任何行首 `CREATE [OR REPLACE] FUNCTION public.create_order(` ⇒ **尺沒接上**,' +
        '而它會安靜地印綠。先修尺,不要相信下面那一格。',
    ).toBeGreaterThan(0);
  });

  // ── 尺自己的自檢②:收緊之後,它要能把「只寫 COMMENT 的檔」排除掉 ─────────
  it('🔴 負對照:一支只有 `COMMENT ON FUNCTION public.create_order(...)` 的檔,不得被當成定義', () => {
    const fake = "COMMENT ON FUNCTION public.create_order(uuid) IS '不是定義';\n";
    expect(
      DEFINES_CREATE_ORDER.test(fake),
      '選檔規則把 `COMMENT ON FUNCTION` 當成定義了 ⇒ 那正是 codex 打死第一版的那一格。',
    ).toBe(false);
    // 正對照:真的定義要認得出來(否則上面那個 false 只證明它什麼都不認)
    expect(
      DEFINES_CREATE_ORDER.test('CREATE OR REPLACE FUNCTION public.create_order(\n  p_x uuid\n)'),
      '真的定義認不出來 ⇒ 這把尺是恆偽的。',
    ).toBe(true);
  });

  // ── 尺自己的自檢③:取值那一步不得被註解裡的舊字面騙 ─────────────────────
  it('🔴 負對照:註解裡的舊字面不得蓋過 INSERT 真正寫進去的值', () => {
    const tricky = [
      "-- 舊版寫的是 'general'::public.member_tier,留著當歷史",
      'INSERT INTO public.orders (',
      '  display_id, tier_at_checkout,',
      '  subtotal',
      ') VALUES (',
      "  v_display_id, 'store'::public.member_tier,",
      '  v_subtotal',
      ')',
    ].join('\n');
    expect(
      tierValueInOrdersInsert(tricky),
      '取值那一步被註解裡的舊字面騙了 ⇒ 真正改成 store 時它會該紅而綠。',
    ).toBe("'store'::public.member_tier");
  });

  // ── 主斷言 ────────────────────────────────────────────────────────────
  it('🔴 活的 create_order 仍寫死 `general` —— 改成 `store` 的那一刻,顧客站要同時開始算稅', () => {
    const live = liveDefinerOfCreateOrder();
    const value = tierValueInOrdersInsert(readFileSync(resolve(MIGRATIONS_DIR, live), 'utf8'));

    expect(
      value,
      `在活的那支 migration(${live})裡,` +
        '找不到 `INSERT INTO public.orders (…) VALUES (…)` 中 `tier_at_checkout` 那一格 ⇒ ' +
        '**寫法換了,而本格量不到它了** ⇒ 這是尺的問題,不是碼的問題。先修尺。',
    ).not.toBeNull();

    expect(
      value,
      [
        `🔴 活的 create_order（${live}）寫進 tier_at_checkout 的值變了。`,
        '',
        '**這一格不是在說「值錯了」——它是在問「你是不是故意的」。**',
        '',
        '若你正在接經銷價（把 general 改成 store）⇒ 那一刻【顧客站必須同時開始算稅】：',
        '  · 經銷價是【未稅】的（Sean 2026-08-29 拍板：網站售價含稅、經銷價未稅）',
        '  · 只改這一行而不接稅 ⇒ **客人真的少付 5%，而不會有任何東西紅**',
        '  · ⇒ 兩件事必須在【同一顆 commit】：create_order 開始寫 store ＋ 顧客站開始算稅',
        '',
        '確認兩件都做了 ⇒ 把本格的期望值一起改掉，並在這裡寫下那顆 commit。',
        '參考：`#959` / `~/pcm-mailbox/線A-plan-片B2-稅的算式-20260829.md` §3',
      ].join('\n'),
    ).toBe("'general'::public.member_tier");
  });
});

/**
 * ══ ⚠️ 這把尺還看不到什麼(收緊之後仍然存在,codex 2026-08-29 點名)══════════
 * ```
 * · 同簽章的 DROP FUNCTION —— 若有人 DROP 掉再在別處建，本尺仍看最後一支「有定義」的檔
 * · overload：本尺不比對參數列 ⇒ 兩個不同簽章的 create_order 它分不出來
 * · 值的寫法：只認 `'x'::public.member_tier`；改成 `CAST('x' AS public.member_tier)`
 *   ⇒ 上面那格「找不到 ⇒ 該紅」會先叫（它會紅而不是靜靜綠）——**那是刻意選的方向**
 * · 一支 migration 裡有【多個】 INSERT INTO public.orders ⇒ 本尺只取第一個
 * 🔴 **codex R2 2026-08-29 補的兩條(它們是真的洞,不是措辭)**:
 * · `split(',')` **不是 SQL 層級的切分** —— 值裡含逗號的形狀會讓欄位錯位:
 *   `'a,b'` / `foo(a, b)` / `ARRAY[a, b]` / row constructor / JSON 建構式。
 *   而 `VALUES (…)` 那條 regex 也會在**第一個 `)`** 提前截止
 *   ⇒ `value::type` 安全,而 `CAST(value AS type)` 會撞到括號。
 *   ⚠️ **錯位通常會讓它紅**(取到的值不是那個字面)—— 而**存在「錯位後剛好讀到期望值」的靜靜綠**。
 * · 選檔的 regex 只認**大寫、行首無縮排**的 `CREATE … FUNCTION`
 *   ⇒ 一支**小寫或縮排**的新定義會被忽略 ⇒ 本尺繼續讀舊 migration ⇒ **該紅而綠**。
 *   (block comment / 字串裡的假 `CREATE FUNCTION` 也會讓它選錯。)
 * ```
 * 📌 **⇒ 兩條都指向同一件事:這是 regex 不是 parser。**
 *    **而【要修的話】正解是在拋棄式 PG 上跑 `pg_get_functiondef` 問活的函式本體** ——
 *    那是 plan §3 原本寫的第一選項,而本片沒有 DB ⇒ 退而求其次用檔案。
 *    ⇒ **這一格是刻意的降級,不是沒想到。**
 * 🔴 **而降級要有【還款觸發條件】,否則它是一筆沒有人會想起的債**:
 *    **① 下一個【有 DB access】的窗做這條線時** ⇒ 把本尺換成
 *       `pg_get_functiondef('public.create_order(...)'::regprocedure)` 問活的函式本體
 *       ⇒ 那一刻上面那六條射程限制**全部消失**(它不再是 regex)。
 *    **② 或本尺第一次【因為射程而誤判】時** ⇒ 那就是它到期的訊號,不要就地補 regex。
 *    ⚠️ 而②有一個前提:誤判要被發現。**該紅而綠那一種不會被發現** ——
 *       所以①才是真正的還款路徑,②只是備援。
 * 📌 **它是一個 regex,不是 parser。而上面每一條都寫出來,是因為【下一個人會照它的射程去用它】。**
 */
