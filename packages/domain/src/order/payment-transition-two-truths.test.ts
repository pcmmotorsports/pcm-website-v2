/**
 * ⟦b4-TWOTRUTHS1⟧ 第二個實例 —— **付款軸的合法轉移**:DB 那一側 vs TS 那一側
 *
 * 🔵 隔壁 `packages/adapters/src/payment/incident-kind-two-truths.test.ts` 做的是同一個錨的
 *   **第一個**實例(`pcm_incident.kind` 的 CHECK 封閉集 vs TS 白名單)。板列 `docs/launch-todo.md:566`
 *   逐字列了**兩個**實例, 而第二個當時沒有人被派 ⇒ 本檔補那一格。
 *
 * 🔴 **兩份真相**(各自正確、各自綠):
 *   · **TS**:`state-machine.ts` 的 `PAYMENT_TRANSITIONS` —— `refunded: []`(終態, 出不去)
 *   · **DB**:`public.pcm_sync_order_refund_payment_status` 是**退款方向 `orders.payment_status`
 *     的唯一寫入端**(那句是它自己 COMMENT 裡的逐字宣稱), 而它的來源態 allowlist 與目標值
 *     都是**寫死在 SQL 裡的字面**。
 *   ⇒ 📌 **沒有東西把它們放在一起比** —— 而 `20260905010000` 的 COMMENT 裡逐字預告了
 *      「片3 會換成…三態(含**回 paid**)」⇒ 🛑 **那一天 DB 會做 `refunded → paid`,
 *      而 TS 這一側說 `refunded` 出不去** ⇒ 兩邊都不會叫。**本檔就是那個會叫的東西。**
 *
 * 🔵 **方向是單向的**:斷言「DB 走得到的每一對, TS 都判合法」(DB ⊆ TS)。
 *   反向不斷言 —— TS 留了 `unpaid → partiallyPaid` 這種「留型別」的邊, DB 這一支根本不碰,
 *   要求雙向相等會在**沒有任何東西壞掉**的時候印紅。
 *
 * ⚠️ **它答不出什麼**(照實列):
 *   · 比的是 **repo 裡的 migration** 與 **repo 裡的 TS**, 🔴 **不是正式庫**。
 *     線上那支函式被人手動改過 ⇒ 本檔完全看不到(母題已記:
 *     `memory/feedback_guards-pin-repo-text-not-real-world-fact.md`)。
 *   · 它只看**那一支函式**。別的地方若直接 `UPDATE orders SET payment_status = …`,
 *     本檔看不到 —— 而「唯一寫入端」那句話是**那支函式的 COMMENT 自己宣稱的**, 沒有東西在驗它。
 *   · 抽取是**字面**的:它認 `v_ps NOT IN ('a','b')` 當來源集、`v_target := … 'x' … 'y'` 當目標集、
 *     `v_ps <> 'x'` 當排除、`v_ps <> v_target` 當「不做自我轉移」。
 *     🔴 換成第四種寫法 ⇒ 抽到 0 ⇒ **大聲丟例外**, 不靜靜回空集合而印綠。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canPaymentTransition } from './state-machine';
import type { PaymentStatus } from './types';

const MIG_DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const FN = 'pcm_sync_order_refund_payment_status';

/** SQL 註解先剝掉 —— 這支檔的檔頭註解裡就有一份【長得一模一樣的】allowlist 字面。 */
function stripSqlComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

/**
 * 找【最新一代】定義那支函式的 migration。
 * 🔴 不寫死檔名 —— 寫死的話, 片3 一上這支檔就恆綠, 而那正是它要擋的那一天。
 */
function latestFnFile(): string {
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${FN}\\s*\\(`, 'i');
  const hits = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => re.test(stripSqlComments(readFileSync(path.join(MIG_DIR, f), 'utf8'))))
    .sort();
  if (hits.length === 0) {
    throw new Error(`找不到任何定義 public.${FN} 的 migration —— 這把尺沒有接上`);
  }
  return path.join(MIG_DIR, hits[hits.length - 1]!);
}

/** DB 那一側走得到的 (from → to)。輸入是 SQL 原文 ⇒ 正負對照才餵得進來。 */
export function dbPairs(rawSql: string, label: string): Array<[string, string]> {
  const src = stripSqlComments(rawSql);

  const srcM = /v_ps\s+NOT\s+IN\s*\(([^)]*)\)/i.exec(src);
  if (!srcM) throw new Error(`${label}:抓不到來源態 allowlist(v_ps NOT IN (…))—— 尺沒接上`);
  const sources = [...new Set([...srcM[1]!.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]!))];

  const tgtM = /v_target\s*:=\s*([\s\S]*?);/i.exec(src);
  if (!tgtM) throw new Error(`${label}:抓不到目標值(v_target := …)—— 尺沒接上`);
  const targets = [...new Set([...tgtM[1]!.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]!))];

  if (sources.length === 0 || targets.length === 0) {
    throw new Error(
      `${label}:來源 ${sources.length} 個 / 目標 ${targets.length} 個 —— 抽到 0。`
      + '🔴 不要把這個 0 讀成「這支函式不寫 payment_status」, 那兩件事在這裡印同一個東西。',
    );
  }

  // 寫死在 SQL 裡的排除:`v_ps <> 'refunded'` 這種【字面】守門, 擋掉那個來源態。
  const excluded = new Set(
    [...src.matchAll(/v_ps\s*(?:<>|!=)\s*'([A-Za-z]+)'/gi)].map((m) => m[1]!),
  );
  // `v_ps <> v_target` = 目標與現況相同就不寫 ⇒ 自我轉移走不到。
  const noSelf = /v_ps\s*(?:<>|!=|IS\s+DISTINCT\s+FROM)\s*v_target/i.test(src);

  const out: Array<[string, string]> = [];
  for (const from of sources) {
    if (excluded.has(from)) continue;
    for (const to of targets) {
      if (noSelf && from === to) continue;
      out.push([from, to]);
    }
  }
  return out;
}

function illegal(pairs: Array<[string, string]>): Array<[string, string]> {
  return pairs.filter(([f, t]) => {
    try {
      return !canPaymentTransition(f as PaymentStatus, t as PaymentStatus);
    } catch {
      // 🔴 TS 的轉移表沒有這個出發態 ⇒ `PAYMENT_TRANSITIONS[from]` 是 undefined ⇒ 丟。
      //   那**本身就是一種兩份真相分家**(DB 寫得出一個 TS 沒聽過的狀態)⇒ 判非法, 不是當掉。
      return true;
    }
  });
}

/**
 * 正對照 —— **必須用一個 TS 【永遠】不會允許的轉移**。
 *
 * 🔴🔴 **這一格 2026-09-06 換過, 而換的理由值得留著**:
 *   舊版用的是 `refunded → paid`。片③(`20260905440000` + `57a84b1e2`)一落地,
 *   TS 那一側就把 `refunded` 從終態改成 `['paid', 'partiallyRefunded']`
 *   ⇒ 🛑 **那個「必須印紅」的正對照, 在兩份真相【真的一致】的那一天變成綠 ⇒ 整支檔紅。**
 *   ⇒ 📌 **一個釘在「今天非法」上的正對照, 會在被守的東西合法化的那一天反咬。**
 *      正對照要釘的是**不變量**, 不是**當下的值**。
 *
 * 🔵 這裡釘的不變量 = `state-machine.ts` 檔頭逐字的「任何 `→ unpaid`(不可回退未付)」。
 *   它不隨退款那條線改動;而下面第一格也順便證明了它今天仍然成立。
 */
const FIXTURE_ALWAYS_ILLEGAL = `
CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status(p_order_id uuid)
RETURNS public.payment_status LANGUAGE plpgsql AS $fn$
BEGIN
  IF v_ps NOT IN ('paid') THEN
    RAISE EXCEPTION 'nope';
  END IF;
  v_target := CASE WHEN v_moved <= 0 THEN 'unpaid' ELSE 'refunded' END;
  IF v_ps <> v_target THEN
    UPDATE public.orders SET payment_status = v_target WHERE id = p_order_id;
  END IF;
END; $fn$;
`;

/**
 * 片③(`20260905440000`)那一支的**形狀**,不是它的全文。
 * 🔬 用真檔量過(2026-09-06,從 `57a84b1e2` 取出 878 行餵本檔的抽取器):
 *   抽到 **6 對** —— paid→refunded / paid→partiallyRefunded / partiallyRefunded→refunded /
 *   partiallyRefunded→paid / refunded→partiallyRefunded / refunded→paid。
 * 🔴 這個 fixture 把那一支的**三個陷阱**留下來,因為它們各自都能讓抽取器抽錯:
 *   ① 三分支 `CASE`(只認「`:=` 後面緊接一個字面」的窄尺會抽到 0)
 *   ② `v_ps <> 'refunded'` **活在一行 `--` 註解裡**(不剝註解 ⇒ 誤判 refunded 被排除掉)
 *   ③ 一個斷言字串裡含 `v_ps <> v_target`(它不該是唯一的 noSelf 依據)
 */
const FIXTURE_P3_SHAPE = `
CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status(p_order_id uuid)
RETURNS public.payment_status LANGUAGE plpgsql AS $fn$
BEGIN
  IF v_ps NOT IN ('paid', 'partiallyRefunded', 'refunded') THEN
    RAISE EXCEPTION 'nope';
  END IF;
  v_target := CASE WHEN v_moved > 0 AND v_moved >= v_total THEN 'refunded'
                   WHEN v_moved > 0                        THEN 'partiallyRefunded'
                   ELSE                                         'paid' END;
  -- 🔴 **\`v_ps <> 'refunded'\` 那一半拿掉了** —— 它就是「只升不降」。
  IF v_ps <> v_target THEN
    UPDATE public.orders SET payment_status = v_target::public.payment_status
     WHERE id = p_order_id;
  END IF;
  IF pg_catalog.strpos(v_src, 'AND v_ps <> v_target') > 0 THEN
    RAISE EXCEPTION '斷言②b';
  END IF;
END; $fn$;
`;

/** 負對照 = 今天這個形狀的最小版:每一對 TS 都判合法。 */
const FIXTURE_OK = `
CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status(p_order_id uuid)
RETURNS public.payment_status LANGUAGE plpgsql AS $fn$
BEGIN
  IF v_ps NOT IN ('paid', 'partiallyRefunded', 'refunded') THEN
    RAISE EXCEPTION 'nope';
  END IF;
  v_target := CASE WHEN v_moved >= v_total THEN 'refunded' ELSE 'partiallyRefunded' END;
  IF v_ps <> 'refunded' AND v_ps <> v_target THEN
    UPDATE public.orders SET payment_status = v_target WHERE id = p_order_id;
  END IF;
END; $fn$;
`;

describe('⟦b4-TWOTRUTHS1⟧ 付款軸:DB 的唯一寫入端 vs TS 的 PAYMENT_TRANSITIONS', () => {
  it('🔵 兩把尺都要撈得到東西(先證明尺接上了, 再去斷言)', () => {
    const f = latestFnFile();
    const pairs = dbPairs(readFileSync(f, 'utf8'), path.basename(f));
    expect(pairs.length, `DB 側抽到 0 對 —— 讀的是 ${path.basename(f)}`).toBeGreaterThanOrEqual(2);
    // TS 那一側:證明它會回 true 也會回 false, 不是一個恆真/恆假的殼。
    expect(canPaymentTransition('unpaid', 'paid')).toBe(true);
    expect(canPaymentTransition('paid', 'unpaid')).toBe(false);
  });

  it('🔴 DB 走得到的每一對, TS 都要判合法', () => {
    const f = latestFnFile();
    const pairs = dbPairs(readFileSync(f, 'utf8'), path.basename(f));
    expect(
      illegal(pairs).map(([a, b]) => `${a} → ${b}`),
      `DB 這一側走得到、而 TS 的 PAYMENT_TRANSITIONS 判非法。\n`
      + `   讀的是 ${path.basename(f)}\n`
      + `   DB 全部走得到的對:${pairs.map(([a, b]) => `${a}→${b}`).join(', ')}\n`
      + '   🔴 兩邊都不會叫:DB 那一側照做, 而 TS 的 assertPaymentTransition 只在【有人呼叫它】時 throw\n'
      + '      ⇒ 走 RPC 的那條路根本不經過它 ⇒ 資料庫裡出現一個 domain 說不可能的狀態, 而全套測試綠。\n'
      + '   ⇒ 修法二選一:①TS 的轉移表補上這條邊(它真的合法) ②DB 那一側別走(它真的不該)。\n'
      + '      🛑 **不要改本檔的期望值** —— 那是動驗證本身。',
    ).toEqual([]);
  });

  it('🔵 正對照:一個 TS 【永遠】不允許的轉移 ⇒ 必須印紅', () => {
    // 先證那個不變量今天成立 —— 否則下一行的紅可能是別的原因。
    expect(canPaymentTransition('paid', 'unpaid'), '「任何 → unpaid」這個不變量沒了 ⇒ 本格的正對照要重挑').toBe(false);
    const pairs = dbPairs(FIXTURE_ALWAYS_ILLEGAL, 'FIXTURE_ALWAYS_ILLEGAL');
    expect(pairs).toContainEqual(['paid', 'unpaid']);
    expect(illegal(pairs).map(([a, b]) => `${a}→${b}`)).toContain('paid→unpaid');
  });

  it('🔵 抽取器對片③(20260905440000)那個形狀抽得到全部 6 對', () => {
    // 🔴 這一格不判合法性 —— 合法性會隨片③ 落地而改變, 而【抽得到幾對】不會。
    //   釘的是尺, 不是被量的東西。
    const got = dbPairs(FIXTURE_P3_SHAPE, 'FIXTURE_P3_SHAPE').map(([a, b]) => `${a}→${b}`).sort();
    expect(got).toEqual([
      'paid→partiallyRefunded', 'paid→refunded',
      'partiallyRefunded→paid', 'partiallyRefunded→refunded',
      'refunded→paid', 'refunded→partiallyRefunded',
    ].sort());
  });

  it('🔵 DB 寫得出一個 TS 沒聽過的狀態 ⇒ 判非法, 不是當掉', () => {
    expect(illegal([['zzq_never_a_status', 'paid']])).toEqual([['zzq_never_a_status', 'paid']]);
  });

  it('🔵 負對照:今天這個形狀 ⇒ 0 條非法(尺不是恆紅)', () => {
    expect(illegal(dbPairs(FIXTURE_OK, 'FIXTURE_OK'))).toEqual([]);
  });

  it('🔵 排除守門真的有作用(拿掉 `v_ps <> refunded` 那一句就會多出對)', () => {
    const withGuard = dbPairs(FIXTURE_OK, 'a');
    const withoutGuard = dbPairs(FIXTURE_OK.replace("v_ps <> 'refunded' AND ", ''), 'b');
    expect(withoutGuard.length).toBeGreaterThan(withGuard.length);
    expect(withGuard.map(([a]) => a)).not.toContain('refunded');
  });
});
