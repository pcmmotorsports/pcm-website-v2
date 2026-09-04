import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴🔴 **凡是寫 `orders.cancelled_at` 的函式, 同一支函式裡必須先對該列 `FOR UPDATE`。**
 *
 * 🔬 **它為什麼存在(2026-09-05, ⟦b4-NCPCRONRACE⟧)**:
 *   `20260905070000` 檔頭有一段結論 ——「取消與付款【同時在飛】那個競態, 在正式取消形狀下
 *   塌成【取消已提交】」。**而那個結論靠一個前提**:四支寫 `cancelled_at` 的函式全部先拿 row lock。
 *   ⇒ 🛑 **前提破 ⇒ 洞回來, 而洞回來的時候沒有任何東西會叫** ——
 *     那筆錢會落在一張已取消的單上, 帳本零痕跡。
 *   ⇒ 📌 **所以這一格不是整潔, 它是那個結論的【承重牆】。**
 *   🔬 兩把獨立的尺量過那個結論(本線 fixture 同形化 · 線【資料】`-db` 用真 `admin_cancel_order`),
 *     兩把同向 ⇒ 結論成立;而**結論成立不等於它會一直成立**。
 *
 * 🛑🛑 **這把尺【證不到】什麼 —— 先讀這段, 不然它會被當成比實際強**:
 *   ① 它看的是**同一支函式裡有沒有那個字面**, **答不出【順序】**
 *      (`FOR UPDATE` 要在 `UPDATE … SET cancelled_at` 之前)。
 *   ② 它**答不出鎖的是不是同一列** —— 有人對別的表 `FOR UPDATE` 也會讓它綠。
 *   ③ 它只掃 `supabase/migrations/*.sql` 的【最新一代】;正式庫跑的是哪一代它不知道。
 *   ⇒ ✅ 而它擋得住的那一種**正是最可能發生的**:有人新增 / 改寫一支取消函式而**忘了拿鎖**。
 */

const MIG_DIR = join(__dirname, '..', 'supabase', 'migrations');

/** 剝掉 `--` 行註解 —— 註解裡提到 `FOR UPDATE` 不算數(今晚在別處被這個病咬過兩次)。 */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
}

/** 抽出一支 .sql 裡的每一個「函式名 → 函式體」(以 `$fn$`/`$function$` 等收尾)。 */
export function extractFunctions(sql: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z_][\w.]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const rest = sql.slice(m.index);
    const end = rest.search(/\n\$[a-z_]*\$;/);
    out.push({ name: m[1]!, body: end === -1 ? rest : rest.slice(0, end) });
  }
  return out;
}

/** 🔴 判別式抽成具名函式 —— 守門格與正對照格【呼叫同一支】, 不各打一份。 */
export function writesCancelledAtWithoutLock(body: string): boolean {
  const code = stripComments(body);
  const writes = /SET\s+cancelled_at\s*=/.test(code);
  if (!writes) return false;
  return !/FOR\s+UPDATE/.test(code);
}

describe('凡寫 orders.cancelled_at 的函式, 同一支裡要先 FOR UPDATE', () => {
  it('🔴 每一支【最新一代】的取消寫入端都拿了鎖', () => {
    const files = readdirSync(MIG_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    // 最新一代:同名函式取【檔名排序最後】的那一份
    const latest = new Map<string, { body: string; file: string }>();
    for (const f of files) {
      const sql = readFileSync(join(MIG_DIR, f), 'utf8');
      for (const fn of extractFunctions(sql)) {
        if (/SET\s+cancelled_at\s*=/.test(stripComments(fn.body))) {
          latest.set(fn.name, { body: fn.body, file: f });
        }
      }
    }
    // 🟢 正對照:這把尺真的撈得到東西 —— 撈到 0 支時它會恆綠, 而那是最危險的通過。
    expect(latest.size, '一支取消寫入端都沒撈到 ⇒ 這把尺沒有接上').toBeGreaterThanOrEqual(4);

    const bad = [...latest.entries()]
      .filter(([, v]) => writesCancelledAtWithoutLock(v.body))
      .map(([k, v]) => `${k}(${v.file})`);
    expect(
      bad,
      '這幾支寫 orders.cancelled_at 而同一支函式裡沒有 FOR UPDATE ⇒\n' +
        '🔴 20260905070000 檔頭那段「同時在飛塌成序列」的【前提】被打破了 ——\n' +
        '   而前提破掉時, 錢會落在已取消的單上而帳本零痕跡, 沒有任何東西會叫。\n' +
        '⇒ 修法:在 UPDATE 之前對該列 SELECT … FOR UPDATE(照既有四支的形狀)。',
    ).toEqual([]);
  });

  it('🟢 正對照:餵一支【裸 UPDATE】的函式體 ⇒ 判別式要說它違規', () => {
    const naked = `CREATE FUNCTION public.zz_fake() RETURNS void AS $fn$
BEGIN
  UPDATE public.orders SET cancelled_at = now() WHERE id = p_id;
END $fn$;`;
    expect(writesCancelledAtWithoutLock(naked), '裸 UPDATE 沒被判成違規 ⇒ 這把尺是壞的').toBe(true);
  });

  it('🟢 正對照二:有 FOR UPDATE 的 ⇒ 不違規(證明它不是對什麼都說違規)', () => {
    const locked = `CREATE FUNCTION public.zz_ok() RETURNS void AS $fn$
BEGIN
  PERFORM 1 FROM public.orders WHERE id = p_id FOR UPDATE;
  UPDATE public.orders SET cancelled_at = now() WHERE id = p_id;
END $fn$;`;
    expect(writesCancelledAtWithoutLock(locked)).toBe(false);
  });

  it('⚪ 負對照:不寫 cancelled_at 的函式 ⇒ 本尺不管它', () => {
    const other = `CREATE FUNCTION public.zz_other() RETURNS void AS $fn$
BEGIN
  UPDATE public.orders SET payment_status = 'paid' WHERE id = p_id;
END $fn$;`;
    expect(writesCancelledAtWithoutLock(other)).toBe(false);
  });

  it('🔴 註解裡的 FOR UPDATE 不算數(它剝註解)', () => {
    const commented = `CREATE FUNCTION public.zz_cmt() RETURNS void AS $fn$
BEGIN
  -- 這裡本來要 FOR UPDATE
  UPDATE public.orders SET cancelled_at = now() WHERE id = p_id;
END $fn$;`;
    expect(writesCancelledAtWithoutLock(commented), '註解裡的字面餵綠了這把尺').toBe(true);
  });
});
