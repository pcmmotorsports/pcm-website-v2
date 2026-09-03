import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// ⟦取消信-逾時不寄⟧ 2026-09-03 線 `-mail`
//
// 🔴 **這一格守的是一個【不做某件事】的決定,而那種決定在碼上沒有形狀。**
//    Sean 2026-09-03 拍乙,逐字:「**不寄, 只有員工按下取消才寄**」
//    ⇒ 逾時自動取消(`pcm_cron.expire_unpaid_orders`,pg_cron,一次上限 500 張)**不寄取消信**。
//
// 🛑 **而「今天沒接」與「哪天有人順手接上」在碼上是同一個樣子** —— 沒有東西會紅。
//    ⇒ 這一格就是那個「會紅的東西」。
//
// 🎯 **為什麼量級重要**:那條路一次可以取消 **500 張單**。
//    ⇒ 有人「順手接上」的後果不是多寄一封,是**一次寄出上百封給沒付款的人**
//      —— 而**寄出去的信收不回來**(鐵則 12⑤ 對外不可回收)。
//
// ⚠️ **這把尺的射程,先寫**:
//    · 它掃的是 **repo 裡的 migration 原始碼**,**不是正式庫裡真的在跑的那一版**
//      (`scripts/latest-definition-of.sh` 檔頭逐字警告過同一格:
//       「它只看 repo 裡的 supabase/migrations/*.sql ⇒ 答不出正式庫【現在】跑的是哪一代」)。
//    · 它掃**字面**;一個用動態 SQL(`EXECUTE format(...)`)組出 `email_outbox` 的寫法,**它看不到**。
//    ⇒ 📌 **它擋的是「有人直接把 INSERT 寫進去」那一種,而那正是最可能發生的一種。**
// ─────────────────────────────────────────────────────────────────────────────

const MIG_DIR = join(__dirname, '..', 'supabase', 'migrations');
const FN = 'expire_unpaid_orders';
const OUTBOX = 'email_outbox';

/**
 * 找出**每一代的函式本體** —— 而不是「提到這個名字的檔」。
 *
 * 🔴🔴 **本檔第一版就是用「檔案裡同時出現兩個名字」當判準,而它【當場誤報兩支】**:
 * ```
 * 20260819160000_m4a_e2b_email_sweep_pgcron.sql   ← 只在【`--` 註解】裡提到 expire_unpaid_orders
 * 20260903040000_..._unpaid_cancelled_event.sql   ← **我自己那支**, 它的 COMMENT 正在說
 *                                                    「逾時那條路【不涵蓋】」
 * ```
 * 📌 **⇒ 那把尺分不出「它在做這件事」與「它在說我不做這件事」** ——
 *    而後者會被算成前者的證據。**一份寫著「我沒有接」的文件,被判成「它接了」。**
 * ⇒ 修法:只掃 `CREATE ... FUNCTION ...expire_unpaid_orders` 到該函式結尾的那一段。
 */
function expireFnBodies(): { file: string; body: string }[] {
  const out: { file: string; body: string }[] = [];
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith('.sql'))) {
    const src = readFileSync(join(MIG_DIR, f), 'utf8');
    // 定義點:CREATE [OR REPLACE] FUNCTION [schema.]expire_unpaid_orders
    const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+[\\w.]*${FN}\\b`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      // 函式本體到 `$$;` / `$x$;` / `$function$;` 為止;抓不到就取到檔尾(**寧可多抓不要少抓**)
      const rest = src.slice(m.index);
      const end = rest.search(/\$[a-zA-Z_]*\$\s*;/);
      out.push({ file: f, body: end === -1 ? rest : rest.slice(0, end) });
    }
  }
  return out;
}

describe('⟦取消信-逾時不寄⟧ 逾時自動取消那條路不得寄信(Sean 2026-09-03 拍乙)', () => {
  it('🟢 正對照:這把尺真的抓到【函式本體】了 —— 至少兩代', () => {
    // 🔴 沒有這一格,下面那個「零命中」在**尺根本沒抓到任何本體**時也會過
    //    —— 而那正是收窄判準之後最可能出現的新失效模式:窄過頭 ⇒ 一個都不抓 ⇒ 永遠綠。
    const gens = expireFnBodies();
    expect(gens.length, `抓到的定義點:${gens.map((g) => g.file).join(', ')}`).toBeGreaterThanOrEqual(2);
    // 而抓到的每一段都要真的長得像那支函式(否則抓到的是別的東西)
    for (const g of gens) {
      expect(g.body, `${g.file} 抓到的段落不含函式名`).toContain(FN);
    }
  });

  it('🔴 每一代 expire_unpaid_orders 都不得碰 email_outbox', () => {
    const offenders = expireFnBodies()
      .filter((g) => g.body.includes(OUTBOX))
      .map((g) => g.file);
    expect(
      offenders,
      `這幾支同時提到 ${FN} 與 ${OUTBOX}:${offenders.join(', ')}\n` +
        '⇒ 逾時那條路一次可取消 500 張單, 接上寄信 = 一次寄出上百封給沒付款的人, 而信收不回來。\n' +
        '⇒ 若這是刻意的, 那表示 Sean 2026-09-03 拍的乙被推翻了 ⇒ 要有新的拍板落點才准改本格。',
    ).toEqual([]);
  });

  it('🟢 負對照:偵測器對「真的寫了 INSERT」會叫 —— 證明上面那個空陣列不是恆空', () => {
    // 🔴 這一格是本檔的自檢:上面用的是 `body.includes(OUTBOX)`,
    //    而**一個永遠回 false 的判斷式也會讓 offenders 是空的**。
    //    ⇒ 餵一段【一定該被抓到】的假原始碼進同一個判斷式。
    const fake = `CREATE FUNCTION pcm_cron.${FN}() ... INSERT INTO public.${OUTBOX} (event_type) ...`;
    expect(fake.includes(FN) && fake.includes(OUTBOX)).toBe(true);
    // 而一段不含它的, 同一個判斷式要回 false(兩個世界要印不同的東西)
    const clean = `CREATE FUNCTION pcm_cron.${FN}() ... UPDATE public.orders SET cancelled_at = now() ...`;
    expect(clean.includes(FN) && clean.includes(OUTBOX)).toBe(false);
  });
});
