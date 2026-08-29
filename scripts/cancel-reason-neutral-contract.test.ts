/**
 * 取消原因兩格遮罩 = 中性句(Sean 2026-08-30 拍「2 乙」+ 逐字「寫很官方就好」)的守門。
 *
 * 拍板逐字(抄他選的那個選項的字面):
 *   `~/pcm-mailbox/R3-題-甲後三題選項-20260829.md:36`
 *   乙=遮罩改中性句「訂單已取消,詳情請洽客服」(不說是你要求的 — 不對客人說不實的話)
 *
 * 🛑 射程(寫進每一格的測試名字裡,讓它印在輸出上):
 *    ✅ 守:那四處字面還在【最新那支定義 admin_cancel_order 的 migration】的生效碼裡。
 *    ❌ 不守:真 DB 上取消一張單真的會寫出那句話。那只有真 DB 量得到,
 *       而本 repo 依賴 PG 的測試 0 支 ⇒ 塞一支要 PG 的只能靠 skip,那正是假綠。
 *
 * 🔴 為什麼是【四處】不是兩處:那張七值映射 CASE 在函式裡有【兩份】——
 *    ①寫入端(步2 輸入驗)②冪等回放端(步4 冪等格,把 orders.cancelled_reason 拿去
 *    跟重算的映射比)。只改①⇒ 冪等重入時兩邊對不上 ⇒ 走 RAISE。
 *    ⇒ 那不是「少改一半文案」,是製造一個會爆的不一致 ⇒ 所以數的是 4,不是 2。
 *
 * 🔴 而它守【最新那支】不是 20260830020000 自己:已 apply 的 migration 沒有人會回去改,
 *    守它等於守一個不會動的東西 = 恆綠的新來源。admin_cancel_order 至今三代
 *    (A8a1 → A8a2 → A8a3)⇒ 風險在第四代把這四行抄掉一半。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url).pathname;

/** 剝掉【任何位置】的 `--` 到行尾(行尾註解也要剝;理由全文見 a8a3g-cancel-guard-contract.test.ts)。 */
/**
 * 🔴 codex R2 must-fix(4/4):只剝 `--` **不剝 `/* … *\/`** ⇒ 構造得出假綠:
 *    在壞掉的真定義**後面**放一份【區塊註解裡的正確定義】,`lastDefineIndex` 會選中註解那份,
 *    11 格全綠而真定義是壞的。(它已構造出 `blockCommentFalseGreen=true`。)
 *    ⇒ 兩種註解都要剝。**先剝區塊再剝行註解**(反過來會讓 `--` 吃掉區塊的結尾標記)。
 *    ⚠️ 過度剝除只會讓守門【更容易紅】⇒ 失敗方向安全。
 */
const stripComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

const liveText = (file: string): string => stripComments(readFileSync(join(MIGRATIONS, file), 'utf8'));

/**
 * 🔴 這條 regex 刻意比 `CREATE OR REPLACE` 寬:A8a2(20260805100000)是
 *    `DROP FUNCTION` + `CREATE FUNCTION`(它換了簽章,5 參 → 6 參)⇒ 只認
 *    `CREATE OR REPLACE` 的尺【看不到唯一改過簽章的那一代】。
 *    (-b4 2026-08-30 量到並發布;實測 `CREATE OR REPLACE` ⇒ 2 支、放寬後 ⇒ 3 支 + 本片 = 4 支。)
 *
 * 🔴 **R3(Fable)換角度抓到的第四個假綠世界**:schema 前綴與引號也不是保證的 ——
 *    第四代若寫 `CREATE OR REPLACE FUNCTION admin_cancel_order(...)`(不帶 `public.`)
 *    或 `public."admin_cancel_order"`,兩者都是**合法 SQL**,而窄的尺看不見它們
 *    ⇒ `latestDefining()` 會繼續驗 `20260830020000` 而**全綠**。與 A8a2 那個盲點同族:
 *    **掃描字集比宣稱窄**。⇒ schema 前綴與雙引號都放成選用。
 * ⚠️ **仍有一個沒關的**:定義若搬離 `supabase/migrations/`,這支尺一樣看不見它。
 *    那一格不是 regex 修得掉的(分母是目錄),寫出來當已知射程。
 */
const DEFINES =
  /\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(public\s*\.\s*)?"?admin_cancel_order"?\s*\(/gi;
/**
 * 🔴 codex 關卡2 R1 must-fix(5/7)換來的兩格:
 *   ① `i` 旗標 —— SQL 關鍵字不分大小寫,一支合法的 `create or replace function` 在
 *      大小寫敏感的尺底下是隱形的,而它會【安靜地讓這支測試繼續驗上一代】。
 *   ② 取【同檔最後一次】定義,不是第一次 —— 一支檔裡可以定義同一個函式兩次
 *      (第二次覆蓋第一次)。只看第一次 = 驗一個已經被同一支檔自己蓋掉的本體。
 */
const lastDefineIndex = (text: string): number => {
  DEFINES.lastIndex = 0;
  let at = -1;
  for (let m = DEFINES.exec(text); m; m = DEFINES.exec(text)) at = m.index;
  DEFINES.lastIndex = 0;
  return at;
};

/** 檔名開頭是時間戳 ⇒ 字典序即時間序。回最後那一支。 */
const latestDefining = (): string | undefined =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => lastDefineIndex(liveText(f)) >= 0)
    .sort()
    .pop();

/**
 * 🔴 只數【函式本體】,不數整支檔 —— 這一格是量到的,不是設計出來的:
 *    本片自己的事後閘(DO 區塊)裡就寫著這三個字面當比對參數,
 *    整檔數 ⇒ 4/2/0 變成 5/3/1,而三格【同時】紅。
 *    ⇒ 把期望值改成 5/3/1 是錯的解:下一支重新定義它的 migration 不會有我這個閘,
 *       那時 5 會變回 4 而測試紅在一個沒有缺陷的世界。
 *    ⇒ 正解是把分母縮到「這個宣稱真正講的東西」= 函式本體。
 */
const functionBody = (file: string): string => {
  const live = liveText(file);
  const at = lastDefineIndex(live);
  if (at < 0) throw new Error('找不到 admin_cancel_order 的定義:' + file);
  // dollar tag 允許數字(`$f1$`)、`AS` 不分大小寫、前後允許空白 —— codex nit:
  // 這幾種都是合法 SQL,而窄的解析在它們身上會【假紅】。失敗方向安全,但假紅一樣會被關掉。
  const tag = /\s+AS\s+(\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$)/i.exec(live.slice(at));
  const tagText = tag?.[1];
  if (!tag || !tagText) throw new Error('解析不到 dollar-quote 標籤:' + file);
  const from = at + tag.index + tag[0].length;
  // codex R2 nit:closing tag 允許縮排與 `$f1$ ;`(tag 與分號之間有空白)——都是合法 SQL
  const closing = new RegExp('\\n\\s*' + tagText.replace(/\$/g, '\\$') + '\\s*;');
  const m = closing.exec(live.slice(from));
  const end = m ? from + m.index : -1;
  if (end < 0) throw new Error('找不到函式結尾 ' + tagText + ';:' + file);
  return live.slice(at, end);
};

const NEUTRAL = '訂單已取消,詳情請洽客服';
const LEGACY = '依您要求取消';
/** 這五句本片刻意不動 —— 回歸格,不是只驗改的那兩句。 */
const UNTOUCHED = ['商品供貨中斷,已為您取消', '交期無法配合,已為您取消', '重複訂單,已為您取消'] as const;

const countOf = (hay: string, needle: string): number => hay.split(needle).length - 1;

describe('取消原因:兩格遮罩 = 中性句(Sean 2026-08-30「2 乙」)', () => {
  // ✅ 正對照最前面:這一格紅 ⇒ 是這把尺自己壞了,下面每一格作廢。
  it('正對照:掃得到定義 admin_cancel_order 的 migration（掃不到 ⇒ 下面全部作廢)', () => {
    expect(latestDefining()).toBeTypeOf('string');
  });

  it('釘簽章:最新那份定義是六參版（A8a2 之後)—— 換了簽章就是換了一支函式', () => {
    const head = functionBody(latestDefining()!).slice(0, 400);
    for (const p of ['p_order_id', 'p_idempotency_key', 'p_actor', 'p_reason_code', 'p_reason_detail', 'p_items']) {
      expect(head).toContain(p);
    }
  });

  it('正對照:剝註解真的剝掉了東西（沒剝到 ⇒ 這把尺比它宣稱的窄)', () => {
    const f = latestDefining()!;
    expect(liveText(f).length).toBeLessThan(readFileSync(join(MIGRATIONS, f), 'utf8').length);
  });

  it('正對照:切得出函式本體,而且它比整支檔短（切不出來 ⇒ 下面每一格作廢)', () => {
    const f = latestDefining()!;
    const body = functionBody(f);
    expect(body.length).toBeGreaterThan(1000);
    expect(body.length).toBeLessThan(liveText(f).length);
  });

  /**
   * 🔴 codex 關卡2 R1 must-fix(6/7):**「新句總數 = 4」是弱判準**。
   *    它構造出來的假綠世界:把 `internal_error` 改成 NULL、再把新句搬去兩個 `other` 分支
   *    ⇒ 新句仍 4 次、舊句仍 2 次、負對照仍 0 ⇒ **全部斷言照樣綠,而行為已經壞了**。
   *    ⇒ 所以下面數的是【每一個 code 各自那一行的完整形狀】,不是總量。
   *    (同一張表也寫進 migration 的事後閘 —— 兩層各自獨立跑,不是同一份東西數兩次:
   *     這裡數的是【檔案裡的字】,那裡數的是【DB 裡真的長出來的定義】。)
   */
  const SHAPES: ReadonlyArray<readonly [string, number]> = [
    ["WHEN 'customer_request' THEN '依您要求取消'", 2],
    ["WHEN 'out_of_stock'     THEN '商品供貨中斷,已為您取消'", 2],
    ["WHEN 'long_leadtime'    THEN '交期無法配合,已為您取消'", 2],
    ["WHEN 'price_change'     THEN '訂單已取消,詳情請洽客服'", 2],
    ["WHEN 'duplicate_order'  THEN '重複訂單,已為您取消'", 2],
    ["WHEN 'internal_error'   THEN '訂單已取消,詳情請洽客服'", 2],
    // 兩份 CASE 的 other 分支形狀本來就不同 ⇒ 各 1(把新句搬進 other 會讓這兩格紅)
    ["WHEN 'other'            THEN NULL", 1],
    ["WHEN 'other'            THEN c.reason_detail", 1],
    // 負向格:舊字面在這兩個 code 上必須絕跡
    ["WHEN 'price_change'     THEN '依您要求取消'", 0],
    ["WHEN 'internal_error'   THEN '依您要求取消'", 0],
    // 尺自檢:一個現造字面必須數到 0(這格與上面兩個 0 的差別是它從來沒存在過)
    ['zzq6641', 0],
  ];

  it.each(SHAPES)('逐格形狀:「%s」在最新定義裡恰 %i 次', (needle, want) => {
    expect(countOf(functionBody(latestDefining()!), needle)).toBe(want);
  });

  it.each(UNTOUCHED)('回歸:他沒拍的那幾句一個字都沒變 —— %s 仍恰 2 次', (s2) => {
    expect(countOf(functionBody(latestDefining()!), s2)).toBe(2);
  });

  // 🔴 突變:三個【看起來會過】的壞世界,逐個必須被抓到。附正常案例當自檢。
  it('突變:三個壞世界都要被抓到（附正常案例自檢)', () => {
    const 造 = (p1: string, i1: string, p2: string, i2: string, other2 = 'c.reason_detail') =>
      [
        'CREATE OR REPLACE FUNCTION public.admin_cancel_order(p uuid)',
        "    WHEN 'price_change'     THEN " + p1,
        "    WHEN 'internal_error'   THEN " + i1,
        "    WHEN 'other'            THEN NULL",
        "                    WHEN 'price_change'     THEN " + p2,
        "                    WHEN 'internal_error'   THEN " + i2,
        "                    WHEN 'other'            THEN " + other2,
      ].join('\n');

    const N = "'" + NEUTRAL + "'";
    const L = "'" + LEGACY + "'";
    /**
     * 🔴 codex R2 nit:上一版這裡**另抄了 6 格**,而註解說「同一張表」——
     *    兩份日後會各自漂移。⇒ 改成真的吃 `SHAPES`,只挑造得出來的那幾格
     *    (`SHAPES` 裡的六句與負對照有些不在這個小樣本裡 ⇒ 用 `sql.includes` 過濾 code 名)。
     */
    const RELEVANT = SHAPES.filter(
      ([n]) => n.includes("'price_change'") || n.includes("'internal_error'") || n.includes("'other'"),
    );
    const check = (sql: string): boolean => {
      const live = stripComments(sql);
      return RELEVANT.every(([n, w]) => countOf(live, n) === w);
    };

    // ✅ 自檢:這格紅 ⇒ 尺壞了,下面三發全部作廢
    expect(check(造(N, N, N, N))).toBe(true);

    // 🔴 ① 只改①寫入端,漏掉②冪等回放端 ⇒ 冪等重入會 RAISE
    expect(check(造(N, N, L, L))).toBe(false);

    // 🔴 ② codex 構造的假綠世界:internal_error 改成 NULL、新句搬去兩個 other 分支
    //    ⇒ 舊的「新句總數 = 4」判準在這裡【會過】,而行為已經壞了
    //    (兩個 other 分支都搬,才湊得回 4 —— 只搬一個是 3,那證不到 codex 那一格)
    const 假綠 = [
      'CREATE OR REPLACE FUNCTION public.admin_cancel_order(p uuid)',
      "    WHEN 'price_change'     THEN " + N,
      "    WHEN 'internal_error'   THEN NULL",
      "    WHEN 'other'            THEN " + N,
      "                    WHEN 'price_change'     THEN " + N,
      "                    WHEN 'internal_error'   THEN NULL",
      "                    WHEN 'other'            THEN " + N,
    ].join('\n');
    expect(countOf(假綠, NEUTRAL)).toBe(4); // ← 舊判準看到的:仍然 4,一片綠
    expect(check(假綠)).toBe(false); //        ← 新判準:抓到

    // 🔴 ③b codex R2 構造的那一發:壞掉的真定義【後面】放一份區塊註解裡的正確定義
    //    ⇒ 不剝 `/* */` 的尺會選中註解那一份而全綠
    expect(
      check(造(N, N, L, L) + '\n/*\n' + 造(N, N, N, N) + '\n*/'),
    ).toBe(false);

    // 🔴 ③ 行尾註解不得補上缺的那一份 —— 只剝【整行】註解的尺會在這裡放行
    expect(check(造(N, N, L, L) + "  -- " + N)).toBe(false);
  });

  it('負對照:一個不存在的字面必須數到 0（恆回真的尺在這裡會紅)', () => {
    expect(countOf(functionBody(latestDefining()!), 'zzq6641')).toBe(0);
  });
});
