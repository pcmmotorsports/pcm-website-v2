import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchFitmentYear } from '../packages/domain/src/catalog/year-range';

// V-036(規格 docs/specs/2026-08-17-v036-literal-binding-tests.md):
// SQL 判定式與 TS 判定式是同一事實的兩份實作,任一半被改=零機械訊號 ⇒ 本檔把兩半綁死。
// 手法=#606 的 readFileSync 文字層(不 import 型別、不需 DB)。
//
// 🔴 §0 承重牆:live 定位=grep 定義 pattern 取字典序最大,不硬編死檔名。
//    這個坑本片親踩了【兩層】,都留在紀錄裡當實錘:
//    ① 規格的錨(20260712213000)過期 —— 候選清單斷言首跑抓到(20260719150000 重定義)。
//    ② 但 20260719150000 也是死層 —— 20260811040000 用 `DROP FUNCTION` + 無 OR REPLACE 的
//       `CREATE FUNCTION` 重建(:249/:266),字串版 pattern 認不得 ⇒ 定位器自己漏了,
//       候選格【安靜地】綠著守死層(code-reviewer must-fix ① 抓的)。
//    ⇒ 定位 pattern 必須是 regex `CREATE (OR REPLACE )?…`,而「定位器要能認得所有重定義
//       形狀」本身就是要被對抗檢查的宣稱,不是寫完就對。
//
// ⚠️ 規格偏差兩處(以 repo 實物為準,記進 commit body):
//    ① 規格寫 P6 目標=`search_products_by_vehicle` —— 全 migrations 0 命中,
//       實物=`search_catalog_by_vehicle`(判定為筆誤)。
//    ② 規格寫 P6 live=20260712213000 —— 實際 live=20260811040000(見上)。

const MIG_DIR = join(__dirname, '..', 'supabase', 'migrations');

/**
 * 定位核心(V 窗 R1 must-fix 折入:六型重建/下線寫法全要認得)。
 * pattern 認【物件】不認【寫法】:大小寫不拘(/i)、token 間任意空白換行、可選
 * "引號" 與 public. 前綴、CREATE [OR REPLACE] 與 ALTER … RENAME TO 進來的層都算。
 * 🔴 第 6 型(DROP-only 死綁活)regex 硬化治不了,是另一個機制:字典序最大的
 *    DROP 之後若無重建 ⇒ 物件已不存在,直接 throw,不准綁最後那層 CREATE。
 * ⚠️ 用 raw 檔內容比對、不去註解:註解裡整句抄 DDL 會誤中,但誤中是 fail-loud
 * (污染候選清單 ⇒ 候選格紅),與「pattern 太窄」的 fail-silent 相反 ——
 * 收窄比對前先想清楚換到哪一邊。
 */
type SqlObjectKind = 'FUNCTION' | 'VIEW';

function objectPatterns(kind: SqlObjectKind, name: string): { define: RegExp; drop: RegExp } {
  // 可選 "引號" 與 public. 前綴;尾端禁字元續接(防 name 是別名前綴的誤中)。
  const qname = `(?:"?public"?\\.)?"?${name}"?(?![A-Za-z0-9_])`;
  return {
    define: new RegExp(
      `(?:CREATE\\s+(?:OR\\s+REPLACE\\s+)?${kind}\\s+${qname}|ALTER\\s+${kind}\\s+\\S+\\s+RENAME\\s+TO\\s+${qname})`,
      'i',
    ),
    drop: new RegExp(`DROP\\s+${kind}\\s+(?:IF\\s+EXISTS\\s+)?${qname}`, 'i'),
  };
}

/** 純函式核心:餵 {檔名: 內容},回 live 與候選。單測直接餵合成 migration(六型各一格)。 */
function pickLive(
  files: Record<string, string>,
  kind: SqlObjectKind,
  name: string,
): { live: string; candidates: string[] } {
  const { define, drop } = objectPatterns(kind, name);
  const names = Object.keys(files).sort();
  const candidates = names.filter((f) => define.test(files[f] ?? ''));
  const drops = names.filter((f) => drop.test(files[f] ?? ''));
  const live = candidates.at(-1);
  if (!live) throw new Error(`零候選:沒有 migration 定義 ${kind} ${name}`);
  const lastDrop = drops.at(-1);
  if (lastDrop !== undefined && lastDrop > live) {
    // 🔴 第 6 型:最後一筆是 DROP 且其後無重建 ⇒ 物件已下線,綁「最後那層 CREATE」=死綁活。
    throw new Error(
      `${kind} ${name} 已在 ${lastDrop} 被 DROP 且其後無重建 —— 本測試綁的物件已不存在,請下架或改綁接替物件(死層定位=本檔要防的病)。`,
    );
  }
  return { live, candidates };
}

function locateLive(kind: SqlObjectKind, name: string): { live: string; candidates: string[] } {
  const files: Record<string, string> = {};
  for (const f of readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql'))) {
    files[f] = readFileSync(join(MIG_DIR, f), 'utf8');
  }
  return pickLive(files, kind, name);
}

const readMig = (f: string): string => readFileSync(join(MIG_DIR, f), 'utf8');
// 去 SQL 行註解(`-- …`):P1 的字面抽取用 —— 20260816050000 的註解裡就有
// `THEN 'shipped'` 與分母字面各一份,不去掉會把註解數進判序/分母(首輪實跑紅出來的)。
// 🔴 只給 P1 用,別擴用到 P6:它會把【SQL 字串裡】的 `--` 之後也切掉
// (20260811040000:257 的字串就含 `--status`),P1 live 逐檔掃過零命中才安全。
const stripSqlComments = (sql: string): string =>
  sql
    .split('\n')
    .map((l) => {
      const i = l.indexOf('--');
      return i === -1 ? l : l.slice(0, i);
    })
    .join('\n');
const readRepo = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
describe('定位器六型判別力(V 窗 R1 must-fix;每型一格,餵合成 migration)', () => {
  // 優先序照 V 窗核可的排序:3(大小寫,最毒——隨手小寫就繞過)> 4(formatter 折行=自然發生)
  // > 2(引號)> 1(無 schema)> 6(DROP-only,regex 治不了、另一機制)> 5(RENAME TO)。
  const BASE = { '0001_create.sql': 'CREATE FUNCTION public.foo_fn(a int) RETURNS int;' };

  it('第 3 型:全小寫重建也認得(SQL 不分大小寫,regex 不能分)', () => {
    const r = pickLive({ ...BASE, '0002_lower.sql': 'create or replace function public.foo_fn(a int, b int) returns int;' }, 'FUNCTION', 'foo_fn');
    expect(r.live).toBe('0002_lower.sql');
  });

  it('第 4 型:token 間換行/多空白(formatter 折行)也認得', () => {
    const r = pickLive({ ...BASE, '0002_wrapped.sql': 'CREATE\n  OR REPLACE\n  FUNCTION\n  public.foo_fn (\n  a int)' }, 'FUNCTION', 'foo_fn');
    expect(r.live).toBe('0002_wrapped.sql');
  });

  it('第 2 型:引號識別字("public"."foo_fn")也認得', () => {
    const r = pickLive({ ...BASE, '0002_quoted.sql': 'CREATE FUNCTION "public"."foo_fn"(a int)' }, 'FUNCTION', 'foo_fn');
    expect(r.live).toBe('0002_quoted.sql');
  });

  it('第 1 型:無 schema 前綴(search_path 式)也認得', () => {
    const r = pickLive({ ...BASE, '0002_noschema.sql': 'CREATE FUNCTION foo_fn(a int)' }, 'FUNCTION', 'foo_fn');
    expect(r.live).toBe('0002_noschema.sql');
  });

  it('第 6 型:DROP-only 之後無重建 ⇒ throw(死綁活;regex 硬化治不了,是另一個機制)', () => {
    expect(() =>
      pickLive({ ...BASE, '0002_droponly.sql': 'DROP FUNCTION public.foo_fn(int);' }, 'FUNCTION', 'foo_fn'),
    ).toThrow(/已在 0002_droponly\.sql 被 DROP/);
    // 反面:同檔 DROP+重建(20260811040000 的真實形狀)不 throw、live 正確
    const r = pickLive({ ...BASE, '0002_recreate.sql': 'DROP FUNCTION public.foo_fn(int);\nCREATE FUNCTION public.foo_fn(a int, b int)' }, 'FUNCTION', 'foo_fn');
    expect(r.live).toBe('0002_recreate.sql');
  });

  it('第 5 型:ALTER … RENAME TO 改名進來也算定義層', () => {
    const r = pickLive({ ...BASE, '0002_renamein.sql': 'ALTER FUNCTION public.old_fn RENAME TO foo_fn' }, 'FUNCTION', 'foo_fn');
    expect(r.live).toBe('0002_renamein.sql');
  });

  it('誤中防護:名字是他名前綴時不命中(foo_fn 不吃 foo_fn_v2)', () => {
    const r = pickLive({ ...BASE, '0002_other.sql': 'CREATE FUNCTION public.foo_fn_v2(a int)' }, 'FUNCTION', 'foo_fn');
    expect(r.live).toBe('0001_create.sql');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P1 貨品軸判序:SQL admin_order_list_v ↔ TS goodsAxisOfLines', () => {
  const P1_NAME = 'admin_order_list_v';
  const P1_TS = 'apps/admin/src/lib/orders/order-status-axes.ts';
  const DENOM_SQL = 'GREATEST(oi.quantity - COALESCE(s.cancelled_quantity, 0), 0)';

  const P1_DEF_START = /CREATE\s+(OR\s+REPLACE\s+)?VIEW\s+(?:"?public"?\.)?"?admin_order_list_v"?/i;
  function p1ViewDef(): string {
    const sql = stripSqlComments(readMig(locateLive('VIEW', P1_NAME).live));
    return sql.slice(sql.search(P1_DEF_START));
  }
  /** SQL 側(量欄位, THEN 值)配對序列:欄位對調而 THEN 值不動=語意分歧,只比值序列抓不到
   *  (code-reviewer must-fix ②;20260816050000:172-176 的 apply 期斷言記過同一敗形)。 */
  function p1SqlPairs(): Array<[string, string]> {
    // 量欄位錨在 bool_and 的第一個 COALESCE(不能寬鬆抓「THEN 前最近的 s.*_quantity」——
    // 那會抓到分母裡的 cancelled_quantity,首跑實紅過);懶惰間隔止於該塊自己的 THEN。
    // String() 而非 non-null 斷言:group 理論上必存在,但若 regex 被改到 group 消失,
    // 'undefined' 字串會讓 toEqual 大聲紅、而不是型別層被 ! 靜默蓋掉。
    return [
      ...p1ViewDef().matchAll(/bool_and\(\s*COALESCE\(s\.(\w+)_quantity[\s\S]*?THEN '(\w+)'/g),
    ].map((m): [string, string] => [String(m[1]), String(m[2])]);
  }

  it('§0 live 定位:候選清單=已知兩支、live=20260816050000(新 migration 重定義本 view 時本格要紅=綁定要跟上)', () => {
    const { live, candidates } = locateLive('VIEW', P1_NAME);
    expect(
      candidates,
      '候選清單變了:有新 migration 重定義 admin_order_list_v。把本檔 P1 各格的期待值對著【新的 live】重新核一遍,再更新這裡的清單。對側=apps/admin/src/lib/orders/order-status-axes.ts,改了哪半就要同步哪半。',
    ).toEqual([
      '20260814140000_m4b_e10_484a_order_goods_axis_view.sql',
      '20260816050000_m4b_522_goods_axis_subtract_cancelled.sql',
    ]);
    expect(live).toBe('20260816050000_m4b_522_goods_axis_subtract_cancelled.sql');
  });

  it('SQL 側:空單早退(NOT EXISTS)在最前,且(量欄位→回傳值)配對序列正確', () => {
    const viewDef = p1ViewDef();
    expect(viewDef.indexOf('WHEN NOT EXISTS')).toBeGreaterThan(-1);
    expect(viewDef.indexOf('WHEN NOT EXISTS')).toBeLessThan(viewDef.indexOf('bool_and'));
    expect(viewDef).toContain("NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id) THEN 'none'");
    expect(
      p1SqlPairs(),
      'SQL 的(量欄位→THEN 值)配對變了(順序或欄位對調)。對側 TS=order-status-axes.ts goodsAxisOfLines 三行 every-return;改了哪半就要同步哪半,並更新本測試期待值。',
    ).toEqual([
      ['shipped', 'shipped'],
      ['instock', 'instock'],
      ['ordered', 'ordered'],
    ]);
  });

  it('SQL 側:#522 分母字面出現在【每一個】bool_and 判定(只驗一處,另兩處改了不紅 ⇒ 數量必須相等)', () => {
    const viewDef = p1ViewDef();
    const boolAnds = (viewDef.match(/bool_and\(/g) ?? []).length;
    const denoms = viewDef.split(DENOM_SQL).length - 1;
    expect(boolAnds).toBe(3);
    expect(
      denoms,
      `分母字面 ${DENOM_SQL} 的出現次數 != bool_and 數:有判定的分母被單獨改了。對側 TS=lineNeed();改了哪半就要同步哪半。`,
    ).toBe(boolAnds);
    // ⚠️ 繼承限(V 窗 R1 nit 1,承認不補格):「數量相等」擋不住「三個分母同時改成同一個
    //    錯字面」—— 那型由 live migration :150 的 apply 期真值表 probe 承接,本格不重複。
  });

  it('TS 側:空 lines 早退 none;三行 every-return 配對 shipped→instock→ordered 且分母皆呼 lineNeed(', () => {
    const ts = readRepo(P1_TS);
    expect(ts).toContain("if (lines.length === 0) return 'none';");
    const seq = [
      ...ts.matchAll(/if \(lines\.every\(\(l\) => at\(l, '(\w+)Quantity'\) >= lineNeed\(l\)\)\) return '(\w+)';/g),
    ].map((m) => [m[1], m[2]]);
    expect(
      seq,
      'TS every-return 三行變了(順序/分母/欄位)。對側 SQL=admin_order_list_v 的 CASE;改了哪半就要同步哪半,並更新本測試期待值。',
    ).toEqual([
      ['shipped', 'shipped'],
      ['instock', 'instock'],
      ['ordered', 'ordered'],
    ]);
    // lineNeed 本體含「扣已取消」語意(與 SQL 分母同義)
    expect(ts).toContain('l.quantity - (l.quantitySummary?.cancelledQuantity ?? 0)');
  });

  it('綁定:兩側(量欄位→回傳值)配對序列相等(不逐 byte 比,比配對與語意)', () => {
    const ts = readRepo(P1_TS);
    const tsPairs = [
      ...ts.matchAll(/if \(lines\.every\(\(l\) => at\(l, '(\w+)Quantity'\) >= lineNeed\(l\)\)\) return '(\w+)';/g),
    ].map((m) => [m[1], m[2]]);
    expect(p1SqlPairs()).toEqual(tsPairs);
    // 兩側分母都含「取消」語意
    expect(p1ViewDef()).toContain('cancelled_quantity');
    expect(ts).toContain('cancelledQuantity');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P6 年份公式:SQL search_catalog_by_vehicle ↔ TS matchFitmentYear', () => {
  const P6_NAME = 'search_catalog_by_vehicle';
  const YS_PRED = '(year_start IS NULL OR year_start <= p_year)';
  const YE_PRED = '(year_end IS NULL OR year_end >= p_year)';
  const P6_TS = 'packages/domain/src/catalog/year-range.ts';
  const p6Live = (): string => locateLive('FUNCTION', P6_NAME).live;

  it('§0 live 定位:候選=已知五支、live=20260811040000(新 migration 重定義本 RPC 時本格要紅)', () => {
    // 🔴 本格的期待值被打錯過兩次,歷程在檔頭 —— 20260811040000 是 DROP+CREATE(無
    //    OR REPLACE)重建的 11 參數版;之前字串 pattern 看不到它,守的是 20260719150000 死層。
    const { live, candidates } = locateLive('FUNCTION', P6_NAME);
    expect(
      candidates,
      '候選清單變了:有新 migration 重定義 search_catalog_by_vehicle。對著新 live 重核 P6 各格期待值;對側=packages/domain/src/catalog/year-range.ts。',
    ).toEqual([
      '20260712183000_products_catalog_page_public.sql',
      '20260712193000_catalog_rpc_expose_fitments.sql',
      '20260712213000_p4_catalog_rpc_split_generic_plan_replay.sql',
      '20260719150000_catalog_product_image_trim.sql',
      '20260811040000_m4b_storefront_269b_catalog_new_arrivals.sql',
    ]);
    expect(live).toBe('20260811040000_m4b_storefront_269b_catalog_new_arrivals.sql');
  });

  it('SQL 側字面:兩個年份述詞在兩個 UNION 半【各】出現一次(只驗一半,另一半改了不紅)', () => {
    const sql = readMig(p6Live());
    expect(sql.split(YS_PRED).length - 1, `${YS_PRED} 應恰出現 2 次(UNION 兩半各一;live=${p6Live()})`).toBe(2);
    expect(sql.split(YE_PRED).length - 1, `${YE_PRED} 應恰出現 2 次(UNION 兩半各一;live=${p6Live()})`).toBe(2);
    // ⚠️ 切的是整支 migration 檔不是函式本體(R2 nit):live 檔若在別處(DO 塊/第二個
    //    函式)多一個 UNION 會誤紅 —— fail-loud,紅了照訊息把切法收窄到函式本體即可。
    const halves = sql.split(/\bUNION\b/);
    expect(halves.length, `live=${p6Live()} 應恰有一個 UNION`).toBe(2);
    const withBoth = halves.filter((h) => h.includes(YS_PRED) && h.includes(YE_PRED)).length;
    expect(withBoth, `兩個 UNION 半應各含完整一組年份述詞(live=${p6Live()})`).toBe(2);
  });

  it('TS 側字面:Infinity 開放上界行與區間重疊 return 行存在', () => {
    const ts = readRepo(P6_TS);
    expect(ts, `${P6_TS} 的開放上界行不見了(對側=live migration ${p6Live()})`).toContain(
      'if (yearEnd === null) return Infinity;',
    );
    expect(ts, `${P6_TS} 的區間重疊 return 行不見了`).toContain(
      'return actual.yearStart <= specEnd && spec.yearStart <= actualEnd;',
    );
  });

  it('真值表:SQL 公式直譯 vs matchFitmentYear 全組合對打(獨立於字面,抓語意漂;含 p_year IS NULL 半)', () => {
    // SQL 直譯:live 的完整形狀是 (p_year IS NULL OR (ys 述詞 AND ye 述詞))。
    const sqlMatch = (ys: number | null, ye: number | null, y: number | null): boolean =>
      y === null || ((ys === null || ys <= y) && (ye === null || ye >= y));
    const YSYE: Array<number | null> = [null, 2018, 2020, 2022];
    const YEARS: Array<number | null> = [null, 2017, 2018, 2020, 2022, 2023];
    for (const ys of YSYE) {
      for (const ye of YSYE) {
        // 排除 (null, 非null):DB CHECK `product_fitments_year_state_valid`
        // (year_start IS NOT NULL OR year_end IS NULL,20260708130000:33)排除的非法態。
        // 🔴 放寬那條 CHECK 的人:grep 這個常數名會找到本行——放寬後這裡的排除也要跟著開。
        if (ys === null && ye !== null) continue;
        for (const y of YEARS) {
          const sqlAns = sqlMatch(ys, ye, y);
          // y=null=使用者未給年份:SQL 外層 p_year IS NULL 直接放行;TS 對應
          // spec.yearStart === undefined 的早退(matchFitmentYear 第一行)。
          const tsAns = matchFitmentYear(
            { yearStart: ys ?? undefined, yearEnd: ye },
            y === null ? {} : { yearStart: y, yearEnd: y },
          );
          expect(tsAns, `(ys=${ys}, ye=${ye}, y=${y}) SQL=${sqlAns} TS=${tsAns} 兩側語意漂了`).toBe(
            sqlAns,
          );
        }
      }
    }
  });

  it('前提 CHECK 綁定:product_fitments_year_state_valid 字面仍在(真值表的排除規則掛在它身上)', () => {
    const sql = readMig('20260708130000_create_product_fitments_index.sql');
    expect(sql).toContain(
      'CONSTRAINT product_fitments_year_state_valid CHECK (year_start IS NOT NULL OR year_end IS NULL)',
    );
  });

  // 🔴 規格 §2 明標的缺口(照抄,不擴大宣稱):`product_fitments_effective` 的同款 CHECK
  //    出生在 migrations ledger 外(docs/archive 的死字面)⇒ 本檔驗不到 production 那條
  //    constraint 還在;補法=preflight 類腳本加 information_schema.check_constraints 探針,
  //    要不要做歸排片的人。
});
