/**
 * ⟦b4-TWOTRUTHS1⟧ 第三把尺 —— **驗那句「唯一寫入端」的宣稱本身**
 *
 * 🔴 **它從哪來**:第二把尺(`payment-transition-two-truths.test.ts`)只看**一支函式**,
 *   而它憑的是 `pcm_sync_order_refund_payment_status` 自己 COMMENT 裡的一句宣稱 ——
 *   逐字「退款方向 `orders.payment_status` 的【唯一寫入端】」。
 *   🛑 **那句話沒有任何東西在驗它** ⇒ 第二把尺的射程建在一個沒被量過的前提上。本檔量它。
 *
 * 🔵 **而 repo 裡早就有人寫下同一個警告**(`20260901050000` 那段 COMMENT 逐字):
 *   「**不要相信任何一份「誰會寫這一欄」的清單, 包括這一段**…要現值自己跑 `grep -rn "SET payment_status"`」
 *   —— 那一段還記著「列舉這件事本身失敗了三次」。
 *   ⇒ 📌 **本檔就是把那句「自己跑一次 grep」變成一道【每次都會跑】的閘**, 而不是一句提醒。
 *
 * 🔴 **宣稱被機械化成**:
 *   全 repo【現行有效】的 `orders.payment_status` 直接寫入端裡, **除了同步器本人以外,
 *   沒有第二支寫得出退款方向的值**(`refunded` / `partiallyRefunded`)。
 *
 * ⚠️ **它答不出什麼**(照實列):
 *   · 比的是 **repo 裡的 migration 與 TS**, 🔴 **不是正式庫**。線上被手動改過 ⇒ 看不到。
 *   · 「現行有效」= **該函式最新一代的定義所在的那支 migration**(沿用第二把尺的判法)。
 *     🛑 而它假設 migration **全部依序貼過** —— 帳本那條線才答得出真的貼了沒。
 *   · 它認 `UPDATE … SET payment_status`。有人改用 `INSERT … ON CONFLICT DO UPDATE`
 *     的別種寫法 ⇒ 抽到 0 ⇒ 那一格**大聲丟例外**, 不靜靜印綠。
 *   · 值解不開(寫的是一個解析不到賦值的變數)⇒ **丟例外**, 不歸進「不確定所以放行」。
 *     📌 那正是 `docs/patterns/traps-inbox/db-20260906a-…` 記的那個坑:
 *        **一個誠實的未知讀起來永遠是安全的。**
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../..');
const MIG_DIR = path.join(ROOT, 'supabase/migrations');
const SYNC_FN = 'pcm_sync_order_refund_payment_status';
/** 退款方向的值 —— 宣稱說「只有同步器寫得出這兩個」。 */
const REFUND_VALUES = new Set(['refunded', 'partiallyRefunded']);

/**
 * 把「不是碼」的東西換成等長空白(行號與欄位不變):
 * `--` 註解 / `/* *\/` / `'…'`(含 `''` 跳脫)/ **不是接在 `AS` 後面的** `$tag$…$tag$`。
 * 🔴 `AS $fn$…$fn$` = 函式體 = **碼**, 要遞迴進去;`COMMENT … IS $c$…$c$` = 字串, 整塊抹掉。
 *   —— 少了這條分辨, `20260901050000` 的 COMMENT 裡那句 `grep -rn "SET payment_status"`
 *      會被當成一處寫入(實測:漏了這條 ⇒ 14 處, 加上 ⇒ 12 處)。
 */
export function maskSql(src: string, keepStrings = false): string {
  const out = src.split('');
  const blank = (a: number, b: number) => {
    for (let k = a; k < b && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '-' && src[i + 1] === '-') {
      const j = src.indexOf('\n', i);
      blank(i, j < 0 ? src.length : j);
      i = j < 0 ? src.length : j;
    } else if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      const e = j < 0 ? src.length : j + 2;
      blank(i, e);
      i = e;
    } else if (c === "'") {
      let j = i + 1;
      // keepStrings:定位用的那一份要抹掉字串(免得註解/COMMENT 冒充碼),
      // 讀值用的那一份要留著 —— `SET payment_status = 'paid'` 的值就住在字串裡。
      while (j < src.length) {
        if (src[j] === "'") {
          if (src[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j++;
      }
      const e = Math.min(j + 1, src.length);
      if (!keepStrings) blank(i, e);
      i = e;
    } else if (c === '$') {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(src.slice(i));
      if (!m) { i++; continue; }
      const tag = m[0];
      const close = src.indexOf(tag, i + tag.length);
      const bodyEnd = close < 0 ? src.length : close;
      const before = src.slice(0, i).replace(/\s+$/, '');
      const isCode = /\bAS$/i.test(before);
      if (isCode) {
        const inner = maskSql(src.slice(i + tag.length, bodyEnd), keepStrings);
        for (let k = 0; k < inner.length; k++) out[i + tag.length + k] = inner[k]!;
        i = close < 0 ? src.length : close + tag.length;
      } else {
        const e = close < 0 ? src.length : close + tag.length;
        blank(i, e);
        i = e;
      }
    } else i++;
  }
  return out.join('');
}

const FN_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi;

interface Write { file: string; line: number; fn: string; values: string[] }

/** 掃一批 migration(檔名 → 原文), 回「現行有效」的直接寫入端。 */
export function liveWrites(files: Map<string, string>): Write[] {
  const masked = new Map<string, string>();
  const codeOnly = new Map<string, string>();
  const defs = new Map<string, string[]>();
  const names = [...files.keys()].sort();
  for (const f of names) {
    const m = maskSql(files.get(f)!);
    masked.set(f, m);
    // 🔴 同長度、同行號的第二份:註解與 COMMENT 本體照抹, 而【字串留著】—— 值住在字串裡。
    codeOnly.set(f, maskSql(files.get(f)!, true));
    for (const mm of m.matchAll(FN_RE)) {
      const arr = defs.get(mm[1]!) ?? [];
      arr.push(f);
      defs.set(mm[1]!, arr);
    }
  }
  if (defs.size === 0) throw new Error('一支函式都沒抽到 —— 這把尺沒有接上');

  const out: Write[] = [];
  for (const f of names) {
    const m = masked.get(f)!;
    const heads = [...m.matchAll(FN_RE)].map((x) => ({ name: x[1]!, at: x.index! }));
    for (const hit of m.matchAll(/SET\s+payment_status/gi)) {
      const at = hit.index!;
      const line = m.slice(0, at).split('\n').length;
      let fn: string | null = null;
      let fnAt = 0;
      for (const h of heads) { if (h.at < at) { fn = h.name; fnAt = h.at; } else break; }
      if (fn === null) {
        throw new Error(
          `${f}:${line} 的 SET payment_status 不在任何函式裡 —— 那是一次性 DML,`
          + '本尺沒有涵蓋這一型。🔴 不要把它讀成「沒有」, 要有人去看那一支。',
        );
      }
      const latest = defs.get(fn)!.slice(-1)[0]!;
      if (latest !== f) continue; // 舊代:被後面的 CREATE OR REPLACE 蓋掉了
      // 這一處寫進去的值:直接字面, 或解一個變數。
      const tail = codeOnly.get(f)!.slice(at, at + 200);
      const lit = /SET\s+payment_status\s*=\s*'([A-Za-z]+)'/i.exec(tail);
      if (lit) { out.push({ file: f, line, fn, values: [lit[1]!] }); continue; }
      const varM = /SET\s+payment_status\s*=\s*([a-z_][a-z0-9_]*)/i.exec(tail);
      if (!varM) {
        throw new Error(`${f}:${line} 抽不出寫進去的值(既不是字面也不是變數)—— 尺沒接上`);
      }
      const nextHead = heads.find((h) => h.at > fnAt);
      const body = codeOnly.get(f)!.slice(fnAt, nextHead ? nextHead.at : m.length);
      // 🔴 取【整句賦值】再抽字面 —— 不是 `:=` 後面緊接著一個字面。
      //   同步器寫的是 `v_target := CASE WHEN … THEN 'refunded' ELSE 'partiallyRefunded' END;`
      //   ⇒ 只認「緊接著」的窄尺會在這裡抽到 0, 而那個 0 讀起來像「解不開」。
      const assigns = [
        ...body.matchAll(new RegExp(`${varM[1]!}\\s*:=\\s*([^;]*);`, 'gi')),
      ].flatMap((x) => [...x[1]!.matchAll(/'([A-Za-z]+)'/g)].map((y) => y[1]!));
      if (assigns.length === 0) {
        throw new Error(
          `${f}:${line} 寫的是變數 ${varM[1]} 而函式體裡解不到它的賦值。\n`
          + '🛑 **不准把它當成「不確定所以放行」** —— 一個誠實的未知讀起來永遠是安全的,'
          + '而那正是這把尺要擋的東西。去把那一支打開。',
        );
      }
      out.push({ file: f, line, fn, values: [...new Set(assigns)] });
    }
  }
  return out;
}

/** 宣稱的反例:同步器以外、寫得出退款方向值的現行寫入端。 */
export function counterexamples(ws: Write[]): string[] {
  return ws
    .filter((w) => w.fn !== SYNC_FN && w.values.some((v) => REFUND_VALUES.has(v)))
    .map((w) => `${w.file}:${w.line} ${w.fn} ⇒ ${w.values.join('/')}`);
}

function realMigrations(): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    m.set(f, readFileSync(path.join(MIG_DIR, f), 'utf8'));
  }
  return m;
}

/** TS 那一側:遞迴收 packages/*&#47;src 與 apps/*&#47;src 的 .ts/.tsx。 */
function tsFiles(): string[] {
  const roots: string[] = [];
  for (const group of ['packages', 'apps']) {
    const base = path.join(ROOT, group);
    for (const pkg of readdirSync(base)) {
      const src = path.join(base, pkg, 'src');
      try { if (statSync(src).isDirectory()) roots.push(src); } catch { /* 沒有 src 就跳過 */ }
    }
  }
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      if (e === 'node_modules' || e === 'dist' || e === '.next') continue;
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e)) out.push(p);
    }
  };
  roots.forEach(walk);
  return out;
}

/** TS 的註解與字串抹掉(理由同 SQL:註解裡的字面會冒充碼)。 */
function maskTs(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/`[\s\S]*?`/g, (s) => s.replace(/[^\n]/g, ' '))
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (s) => ' '.repeat(s.length))
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (s) => ' '.repeat(s.length));
}

describe('⟦b4-TWOTRUTHS1⟧ 「退款方向唯一寫入端」那句 COMMENT —— 驗宣稱本身', () => {
  it('🔵 尺要先撈得到東西(分母, 不是斷言)', () => {
    const ws = liveWrites(realMigrations());
    expect(ws.length, '現行寫入端抽到 0 —— 尺沒接上, 不是「沒有人寫這一欄」').toBeGreaterThanOrEqual(3);
    expect(ws.map((w) => w.fn)).toContain(SYNC_FN);
  });

  it('🔴 同步器以外, 沒有第二支寫得出退款方向的值', () => {
    const ws = liveWrites(realMigrations());
    expect(
      counterexamples(ws),
      '這幾支是那句 COMMENT 的反例 —— 「退款方向的唯一寫入端」不再成立。\n'
      + `   現行全部直接寫入端:${ws.map((w) => `${w.fn}(${w.values.join('/')})`).join(' · ')}\n`
      + '   🔴 而受影響的不只那句話:第二把尺(payment-transition-two-truths)整支的射程\n'
      + '      就建在「只有那一支在寫」上面 ⇒ 它會繼續印綠, 而它已經看不全了。\n'
      + '   ⇒ 修法:①改走同步器 ②或把那句 COMMENT 改成真的, 並回訪第二把尺的射程。\n'
      + '      🛑 **不要改本檔的期望值。**',
    ).toEqual([]);
  });

  it('🔵 正對照:塞一處退款方向的裸寫入 ⇒ 必須被撈到', () => {
    const files = realMigrations();
    files.set('29999999999999_zz_fixture.sql', `
CREATE OR REPLACE FUNCTION public.zz_fixture_writer(p_id uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE public.orders SET payment_status = 'refunded'::public.payment_status WHERE id = p_id;
END; $fn$;
`);
    const c = counterexamples(liveWrites(files));
    expect(c.join('\n')).toContain('zz_fixture_writer');
  });

  it('🔵 負對照:註解 / 單引號字串 / COMMENT 的 $c$ 本體裡的字面【不算】', () => {
    const files = new Map<string, string>([
      ['20000101000000_zz_base.sql', `
CREATE OR REPLACE FUNCTION public.zz_only_real(p_id uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  -- UPDATE public.orders SET payment_status = 'refunded' 這行是註解
  UPDATE public.orders SET payment_status = 'paid'::public.payment_status WHERE id = p_id;
  IF v_x NOT LIKE '%SET payment_status = ''refunded''%' THEN RAISE EXCEPTION 'x'; END IF;
END; $fn$;
COMMENT ON FUNCTION public.zz_only_real(uuid) IS $c$
  要現值自己跑:grep -rn "SET payment_status = 'refunded'"
$c$;
`],
    ]);
    const ws = liveWrites(files);
    expect(ws.map((w) => `${w.fn}:${w.values.join('/')}`)).toEqual(['zz_only_real:paid']);
    expect(counterexamples(ws)).toEqual([]);
  });

  it('🔵 舊代不算:同一支函式被後面的 CREATE OR REPLACE 蓋掉 ⇒ 舊的那處不入列', () => {
    const files = new Map<string, string>([
      ['20000101000000_zz_old.sql', `
CREATE OR REPLACE FUNCTION public.zz_evolving(p_id uuid) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN UPDATE public.orders SET payment_status = 'refunded'::public.payment_status WHERE id = p_id; END; $fn$;
`],
      ['20000102000000_zz_new.sql', `
CREATE OR REPLACE FUNCTION public.zz_evolving(p_id uuid) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN UPDATE public.orders SET payment_status = 'paid'::public.payment_status WHERE id = p_id; END; $fn$;
`],
    ]);
    expect(counterexamples(liveWrites(files))).toEqual([]);
    expect(liveWrites(files).map((w) => w.file)).toEqual(['20000102000000_zz_new.sql']);
  });

  it('🔴 TS/apps 那一側:零支直接寫 payment_status(而偵測器是活的)', () => {
    const hits: string[] = [];
    let updateCalls = 0;
    for (const f of tsFiles()) {
      const m = maskTs(readFileSync(f, 'utf8'));
      updateCalls += [...m.matchAll(/\.(?:update|upsert|insert)\s*\(/g)].length;
      for (const call of m.matchAll(/\.(?:update|upsert|insert)\s*\(/g)) {
        const win = m.slice(call.index!, call.index! + 400);
        if (/\bpayment_status\s*:/.test(win)) hits.push(`${path.relative(ROOT, f)}`);
      }
    }
    // 🔵 正對照先跑:偵測器抓不到任何 .update( ⇒ 那個 0 是尺的 0, 不是世界的 0。
    expect(updateCalls, 'TS 全樹連一個 .update(/.insert( 都沒抓到 —— 尺沒接上').toBeGreaterThan(0);
    expect([...new Set(hits)], 'TS 這一側出現直接寫 payment_status 的呼叫 —— 它完全繞過上面整套 SQL 的推理').toEqual([]);
  });
});
