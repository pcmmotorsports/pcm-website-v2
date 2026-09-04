/**
 * A8a3-G 那條約定的守門(2026-08-30 線D)。
 *
 * 約定(住在 20260820020000 的 COMMENT 裡):
 *   `begin_charge_attempt` / `find_active_sibling_own` 的 sibling dedup 要保留
 *   `o.cancelled_at IS NULL` —— **已取消的單不得被判成「重複單」**。
 *   違反 ⇒ 客人取消一張單、再下一張一樣的 ⇒ 新單被判成重複 ⇒ 結帳被擋、那筆錢收不到。
 *
 * 🔴 為什麼需要這支:那條約定的作者自己寫了放棄理由 ——
 *    「⚠️ 本 repo 測試層碰不到 DB ⇒ 這條沒有常設守門」(20260820020000 的 COMMENT)。
 *    **那句話是 2026-08-20 寫的,而它今天不成立了**:本機有 homebrew postgres、
 *    repo 裡有 10 支拋棄式 PG 的 probe。⇒ 碰得到,只是沒有人在碰。
 *    📌 而一個「因為做不到所以沒做」的理由,會在做得到之後安靜地留在檔案裡 ——
 *       沒有東西會在那一天回頭掃「誰當初是因為這個理由放棄的」。
 *
 * 🛑 而【這支守的是什麼、不守什麼】要先講(主視窗 2026-08-30 指派的射程紀律):
 *    ✅ 守:那段字還在最新那支定義它的 migration 裡。
 *    ❌ 不守:那個行為在真 DB 上還對。後者只有真 DB 量得到,而本 repo 466 支測試
 *       裡依賴 PG 的 0 支、用 skip 躲開缺 DB 的 0 支 —— 塞一支要 PG 的會違反這個
 *       規範,而唯一替代是 skip,那正是假綠。要不要蓋 DB 測試跑者是另一題,
 *       主視窗端 Sean(成本落在八個窗身上,不是落在提案的人身上)。
 *    ⇒ 射程寫進每一格的測試名字裡,讓它印在輸出上,而不是只住在這段註解裡。
 *
 * 🔴 而它守【最新那支】不是 20260820020000 自己:
 *    已 apply 的 migration 沒有人會去改 ⇒ 守它等於守一個不會動的東西。
 *    `begin_charge_attempt` 至今被重新定義過 6 次 ⇒ 風險在第 7 次。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url).pathname;

/**
 * 🔴 剝掉註解 —— 這一步是必要的,不是潔癖:
 *    `grep` 不會渲染刪除線,`-- ~~已作廢~~` 與生效的碼在輸出裡長得一模一樣。
 *    (實錘:我 2026-08-30 量 2f 的 `strpos` 報 10,剝掉註解之後是 7 —— 灌水 30%。)
 *
 * 🔴 而【剝到哪】是這支檔改過一次的地方,理由留著:
 *    我第一版寫的是「丟掉整行註解」(`^\s*--`)⇒ 而那漏掉【行尾註解】:
 *      WHERE o.customer_user_id = x  -- o.cancelled_at IS NULL
 *    那一行在我第一版底下是【生效行】,而它含那個字串 ⇒ 守門會綠。
 *    ✅ 答案早就在 repo 裡:`20260812170000:747` 十八天前就寫了
 *       `regexp_replace(v_src, '--[^\n]*', '', 'g')` —— 剝【任何位置】的 -- 到行尾。
 *    📌 而我是為了寫這支守門去讀那支檔,才撞到它的 —— 不是查到的。
 *    ⚠️ 過度剝除(例如字串常值裡的 --)只會讓守門【更容易紅】⇒ 失敗方向是安全的。
 */
const liveText = (file: string): string =>
  readFileSync(join(MIGRATIONS, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .split('\n')
    .join('\n');

/** 檔名開頭是時間戳 ⇒ 字典序即時間序。回最後那一支。 */
const latestDefining = (fn: string): string | undefined =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => liveText(f).includes('CREATE OR REPLACE FUNCTION public.' + fn))
    .sort()
    .pop();

const CLAUSE = 'o.cancelled_at IS NULL';
const GUARDED = ['begin_charge_attempt', 'find_active_sibling_own'] as const;

describe('A8a3-G:已取消的單不得被判成「重複單」', () => {
  // ✅ 正對照擺在最前面(-b4 2026-08-30):這一格紅 ⇒ 是這把尺自己壞了
  //    (migrations 目錄搬家 / 命名規則改了),**下面每一格作廢**,不是「守門抓到東西」。
  it.each(GUARDED)('正對照:掃得到定義 %s 的 migration（掃不到 ⇒ 下面全部作廢)', (fn) => {
    expect(latestDefining(fn)).toBeTypeOf('string');
  });

  it('正對照:剝註解真的剝掉了東西（沒剝到 ⇒ 這把尺比它宣稱的窄)', () => {
    const f = latestDefining('begin_charge_attempt')!;
    const whole = readFileSync(join(MIGRATIONS, f), 'utf8');
    expect(liveText(f).length).toBeLessThan(whole.length);
  });

  it.each(GUARDED)(
    '守【字面】不守【行為】:最新定義 %s 的 migration,其生效碼必須含 o.cancelled_at IS NULL',
    (fn) => {
      const f = latestDefining(fn)!;
      expect(liveText(f)).toContain(CLAUSE);
    },
  );

  // 🔴 突變:一支「未來的 migration」重新定義了函式而漏掉那個條件 ⇒ 必須被抓到。
  //    自檢照 -b4 那條:同一發要附一個已知該過的正常案例,它也紅 ⇒ 本發作廢。
  it('突變:未來的 migration 漏掉那個條件 ⇒ 檢查必須紅（附同形狀的正常案例當自檢)', () => {
    const check = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').includes(CLAUSE);

    const 漏掉的 = ['CREATE OR REPLACE FUNCTION public.begin_charge_attempt(p uuid)', 'WHERE o.customer_user_id = x'].join('\n');
    const 正常的 = ['CREATE OR REPLACE FUNCTION public.begin_charge_attempt(p uuid)', 'WHERE o.customer_user_id = x AND ' + CLAUSE].join('\n');

    expect(check(正常的)).toBe(true); // ✅ 自檢:這格紅 ⇒ 尺壞了,本發作廢
    expect(check(漏掉的)).toBe(false); // 🔴 突變:必須抓到

    // 🔴 而【只把那個條件搬進註解】也要抓到 —— 那正是今天灌水 30% 的那個形狀。
    const 藏進註解的 = ['CREATE OR REPLACE FUNCTION public.begin_charge_attempt(p uuid)', '-- 舊版有 ' + CLAUSE, 'WHERE o.customer_user_id = x'].join('\n');
    expect(check(藏進註解的)).toBe(false);

    // 🔴 而【行尾註解】是我第一版漏掉的那個形狀 —— 這一格就是那次修補的證據。
    //    第一版用「丟掉整行註解」⇒ 下面這一行是【生效行】而它含那個字串 ⇒ 會綠。
    const 行尾註解的 = [
      'CREATE OR REPLACE FUNCTION public.begin_charge_attempt(p uuid)',
      'WHERE o.customer_user_id = x  -- ' + CLAUSE,
    ].join('\n');
    expect(check(行尾註解的)).toBe(false);
  });
});
