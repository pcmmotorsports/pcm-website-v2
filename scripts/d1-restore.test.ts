import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { D1_DELETE_COHORT, D1_RETAIN_COHORT } from './d1-cohort';
import { buildCohortSelectors } from './d1-export';
import {
  buildRehearsalSeedScript,
  buildRestoredVerifySql,
  buildRestoreScript,
  readCsvHeaders,
} from './d1-restore';

const DIR = '/tmp/d1';
// 🔴 D1_OPERATOR 必填(Sean 2026-08-29 拍甲)⇒ 產生器沒有它會 throw ⇒ 這裡先設,
//    而【它缺席時該 throw】另有一格單測在下面驗,不是靠這一行。
process.env.D1_OPERATOR = 'tester';
const pre = buildRestoreScript('pre-n3c', 'production', DIR);
const post = buildRestoreScript('post-n3c', 'production', DIR);
const rehearsal = buildRestoreScript('pre-n3c', 'rehearsal', DIR);
// 🔴 第四個交叉世界(codex R1 MF7):原本只建三個,而『四個版本逐字相同』那條就是這樣過的。
const rehearsalPost = buildRestoreScript('post-n3c', 'rehearsal', DIR);

const lines = (script: string) => script.split('\n');
const copyLines = (script: string) => lines(script).filter((l) => l.startsWith('\\copy '));
const at = (script: string, needle: string) => script.indexOf(needle);

describe('buildRestoreScript — 兩版共通', () => {
  it.each([
    ['pre', pre],
    ['post', post],
  ])('%s:十五張表依 FK 家長優先順序載入,與匯出同一組清單', (_mode, script) => {
    const expected = buildCohortSelectors([], (t) => t).map(([table]) => table);
    const loaded = [...script.matchAll(/^CREATE TEMP TABLE d1r_(\w+) \(LIKE public\.\1\);$/gm)].map(
      ([, table]) => table,
    );

    expect(loaded).toEqual(expected);
    expect(loaded).toHaveLength(15);
    // 父表在 orders 之前 —— orders 的 FK 指向它們。
    for (const parent of ['customers', 'customer_addresses', 'legal_terms_versions']) {
      expect(loaded.indexOf(parent)).toBeLessThan(loaded.indexOf('orders'));
    }
    expect(loaded.indexOf('products')).toBeLessThan(loaded.indexOf('product_variants'));
    // order_refund_items 依賴 order_refunds 與 order_items;anomaly_events 依賴 anomalies。
    expect(loaded.indexOf('order_refund_items')).toBeGreaterThan(loaded.indexOf('order_refunds'));
    expect(loaded.indexOf('order_refund_items')).toBeGreaterThan(loaded.indexOf('order_items'));
    expect(loaded.indexOf('payment_double_charge_anomaly_events')).toBeGreaterThan(
      loaded.indexOf('payment_double_charge_anomalies'),
    );
  });

  // 🔴 匯出時踩過:\copy 是 psql 客戶端 meta-command、不跨行,折行會噴 parse error。
  // 🔴 HEADER MATCH(PG 16+,production 17.6):沒有它的話,備份與現行 schema 欄位錯位會
  //    **靜默寫入**——還原「成功」但整排資料錯格。這是 180 天備份最可能的失效方式。
  it.each([
    ['pre', pre],
    ['post', post],
  ])('%s:每道 \\copy 自成一行、逐欄比對表頭、NULL 表示法與匯出一致', (_mode, script) => {
    const copies = copyLines(script);

    expect(copies).toHaveLength(15);
    for (const line of copies) {
      // 🔴 Fable R3-F4:方向也要釘。`FROM` 改成 `TO` 會把解壓出來的備份 CSV **覆寫成空檔** ——
      //    而原本的測試只比對「起點在不在」,索引回 -1 照樣通過。
      expect(line).toContain(' FROM ');
      expect(line).not.toContain(' TO ');
      expect(line.endsWith("WITH (FORMAT csv, HEADER MATCH, NULL '\\N')")).toBe(true);
    }
  });

  // 🔴 子查詢若指向 public.*,還原時那些列**已經被刪光** ⇒ 撈到 0 列、子表安靜地少還原,
  //    而且交易照樣 COMMIT。必須指向剛載入的暫存表。
  it.each([
    ['pre', pre],
    ['post', post],
  ])('%s:寫回用的篩選子查詢指向暫存表、不指向已被刪空的 public.*', (_mode, script) => {
    // 只看 INSERT 那幾行。驗證區段本來就要查 public.*(那是還原後的對照側)。
    const allInserts = lines(script).filter((l) => l.startsWith('INSERT INTO public.'));
    // 🔴 **留痕那一筆刻意排除,而排除要具名** —— 它不是還原的寫入,它跑在 COMMIT 之後
    //    (R3 2026-08-29 的結構改動)。⇒ 而排除【不能是靜默的】:下一行釘死它恰好 1 筆,
    //    否則「排除掉不是還原的那些」會變成一個可以塞任何東西進去的洞。
    const auditInserts = allInserts.filter((l) => l.includes('admin_audit_log'));
    expect(auditInserts).toHaveLength(1);
    const inserts = allInserts.filter((l) => !l.includes('admin_audit_log'));

    // 5 張父表 + orders + 9 張子表
    expect(inserts).toHaveLength(15);
    expect(inserts.join('\n')).toContain('refund_id IN (SELECT id FROM d1r_order_refunds');
    expect(inserts.join('\n')).toContain(
      'anomaly_id IN (SELECT id FROM d1r_payment_double_charge_anomalies',
    );
    for (const line of inserts) {
      expect(line).not.toContain('SELECT id FROM public.');
    }
  });

  it.each([
    ['pre', pre],
    ['post', post],
  ])('%s:只帶 26 個待刪 UUID,留存 3 張一個都不得出現', (_mode, script) => {
    for (const { id } of D1_DELETE_COHORT) {
      expect(script).toContain(id);
    }
    for (const { id } of D1_RETAIN_COHORT) {
      expect(script).not.toContain(id);
    }
  });

  // 🔴 orders.csv 裡有 29 張(含留存 3 張)。不修剪就會重插已存在的 3 張、撞主鍵整批失敗。
  it.each([
    ['pre', pre],
    ['post', post],
  ])('%s:orders 載入後先修剪成 26 張,才進改號/寫回', (_mode, script) => {
    const trim = at(script, 'DELETE FROM d1r_orders WHERE id NOT IN (');
    const load = at(script, "\\copy d1r_orders FROM '");

    expect(load).toBeGreaterThan(-1); // 🔴 找不到會回 -1,不釘的話「比 -1 大」恆真
    expect(trim).toBeGreaterThan(load);
    expect(trim).toBeLessThan(at(script, 'INSERT INTO public.orders'));
  });

  // 🔴 反向 assert:還原的前提是「已經刪了」。D1a0 的「29 張都在」在 D1c 之後恆假,
  //    方向必須反過來 —— 只要還有任何一張在,就是還沒刪或已還原過,兩種都不該再插。
  it.each([
    ['pre', pre],
    ['post', post],
  ])('%s:守門 = 身分兩道 + cohort「不存在」反向 assert', (_mode, script) => {
    expect(script).toContain("IF current_user <> 'postgres' THEN");
    expect(script).toContain("IF session_user <> 'postgres' THEN");
    expect(script).toContain('IF v_present <> 0 THEN');
    expect(script).not.toContain('v_present <> 26');
  });

  // 🔴 codex R1-P1:原版整條拿掉叢集守門(為了讓演練跑得動),結果是 $D1_DB_URL 若還指著
  //    演練 clone,身分與「已刪」兩道全過、clone 上 COMMIT 印成功,而 production 依然是空的。
  //    正解不是二選一 —— 兩個方向都釘死,演練照跑、也不可能誤傷 production。
  it('production 版要求必須是 production 叢集', () => {
    expect(pre).toContain(
      'IF (SELECT system_identifier FROM pg_control_system()) <> 7632885393857617092 THEN',
    );
  });

  it('演練版反向釘死:連到 production 就中止', () => {
    expect(rehearsal).toContain(
      'IF (SELECT system_identifier FROM pg_control_system()) = 7632885393857617092 THEN',
    );
    expect(rehearsal).toContain('演練版,不得對 production 執行');
    expect(rehearsal).not.toContain('<> 7632885393857617092');
  });

  it('兩個 target 只差守門那一段,其餘逐字相同', () => {
    const strip = (s: string) => s.replace(/ (<>|=) 7632885393857617092 THEN/, ' ?? THEN');

    expect(strip(rehearsal).replace(/是演練版,不得對 production 執行/, 'X')).toBe(
      strip(pre).replace(/是 production 版,但連到的不是 production 叢集/, 'X'),
    );
  });

  // 🔴 orders 有 BEFORE INSERT trigger 無條件覆寫 shipping_method_at_checkout(實查
  //    pg_get_triggerdef 確認)。不停用 = 還原出來的快照值與備份不同,而且沒有任何症狀。
  it.each([
    ['pre', pre],
    ['post', post],
  ])('%s:寫回 orders 前停用快照 trigger、寫完立刻復原,復原在驗證之前', (_mode, script) => {
    const disable = at(script, 'DISABLE TRIGGER orders_freeze_shipping_snapshot_bi');
    const insert = at(script, 'INSERT INTO public.orders SELECT * FROM d1r_orders;');
    const enable = at(script, 'ENABLE TRIGGER orders_freeze_shipping_snapshot_bi');

    expect(disable).toBeGreaterThan(-1);
    expect(disable).toBeLessThan(insert);
    expect(insert).toBeLessThan(enable);
    expect(enable).toBeLessThan(at(script, "IF v_state IS DISTINCT FROM 'O' THEN"));
  });

  // 🔴 codex R1-P2:ALTER TABLE 取的是 ACCESS EXCLUSIVE。它必須在改號段**之前** ——
  //    否則碰撞驗完到 INSERT 之間留一個窗,現網新單可以搶走剛驗過的號,
  //    插入時噴 unique_violation,而規格承諾的是「碰撞就重產」不是當場炸。
  it('post:停 trigger(取 ACCESS EXCLUSIVE)排在改號段之前,關掉碰撞驗證的競態窗', () => {
    expect(at(post, 'DISABLE TRIGGER')).toBeLessThan(at(post, 'CREATE TEMP TABLE d1r_remap'));
  });

  // 停用 trigger 是有副作用的動作:「停用後忘了復原」會安靜留在庫裡,之後每一張新單的
  // 運送快照都不再被凍結。三道 assert 分別守:trigger 已復原 / 26 張都在 / 快照值逐列相同。
  it.each([
    ['pre', pre],
    ['post', post],
  // 🔴 釘的是**條件**不是句子:只驗「那行 WHERE 在不在」的話,把 `IF v_drift <> 0` 改成
  //    `IF false` 照樣全綠 —— 查詢仍在跑、結果沒人看。突變測試實測抓到。
  ])('%s:orders 走與子表同一套全欄比對,外加 trigger 已復原', (_mode, script) => {
    expect(script).toContain("IF v_state IS DISTINCT FROM 'O' THEN");
    // 🔴 codex R2-P1:原本 orders 只驗 shipping 一欄 + 筆數,其他欄位被改寫不會發現,
    //    而且 EXPECTED_ROWS.orders 定義了沒人用。改走同一套 ⇒ 那一欄也一併被蓋住。
    expect(script).toContain('D1:orders 備份只有 % 列(應 26)');
    expect(script).toContain('D1:orders 有 % 列與備份逐欄不符');
  });

  // 🔴 codex R1-P1 抓到的最危險一條:原版只有 orders 有 assert。子表 CSV 被截斷或 selector
  //    漏撈時,\copy 與 INSERT 都成功、COMMIT 也成功 —— 36 列品項、24 筆扣款就這樣安靜沒回來,
  //    畫面印的卻是「還原完成」。
  it.each([
    ['pre', pre],
    ['post', post],
  ])('%s:九張子表每張都有筆數 + 逐列逐欄雙向比對', (_mode, script) => {
    const expected: Record<string, number> = {
      order_items: 36,
      order_legal_consents: 2,
      payment_charge_attempts: 24,
      pending_invoices: 0,
      email_outbox: 0,
      order_refunds: 0,
      order_refund_items: 0,
      payment_double_charge_anomalies: 0,
      payment_double_charge_anomaly_events: 0,
    };

    for (const [table, rows] of Object.entries(expected)) {
      expect(script).toContain(`D1:${table} 備份只有 % 列(應 ${rows})`);
      expect(script).toContain(`D1:${table} 還原後為 % 列(應 ${rows})`);
      expect(script).toContain(`D1:${table} 有 % 列與備份逐欄不符`);
    }
    // 條件本身也要釘 —— 只驗訊息在的話,把 IF 改成 IF false 照樣全綠。
    // 15 = 5 張父表 + orders + 9 張子表;逐欄比對只有後 10 張(父表比現值沒有意義)。
    expect([...script.matchAll(/IF v_backup <> \d+ THEN/g)]).toHaveLength(15);
    expect([...script.matchAll(/IF v_live <> \d+ THEN/g)]).toHaveLength(15);
    expect([...script.matchAll(/IF v_diff <> 0 THEN/g)]).toHaveLength(10);
  });

  // 🔴 Sean 07-29 拍板 Q1:cohort 指向的父列在 D1c 之後失去 FK 保護。少一列 = orders 的
  //    INSERT 違反 FK、唯一救命路徑用不了。
  // 🔴 只補缺的、不覆蓋現值:父列若還在,現網的值才是當下真相(商品改過價、地址改過門牌)。
  it.each([
    ['pre', pre],
    ['post', post],
  ])('%s:五張父表以 ON CONFLICT DO NOTHING 補齊,且排在 orders 之前', (_mode, script) => {
    const inserts = lines(script).filter((l) => l.startsWith('INSERT INTO public.'));
    const parents = ['customers', 'customer_addresses', 'products', 'product_variants', 'legal_terms_versions'];

    for (const parent of parents) {
      const line = inserts.find((l) => l.startsWith(`INSERT INTO public.${parent} `));
      expect(line).toBeDefined();
      expect(line).toContain('ON CONFLICT DO NOTHING');
      expect(at(script, `INSERT INTO public.${parent} `)).toBeLessThan(
        at(script, 'INSERT INTO public.orders SELECT'),
      );
    }
    // cohort 本身的十張表反過來 —— 用 ON CONFLICT 會把「重複還原」變成靜默 no-op。
    for (const line of inserts.filter((l) => !parents.some((p) => l.startsWith(`INSERT INTO public.${p} `)))) {
      expect(line).not.toContain('ON CONFLICT');
    }
  });

  // 🔴 Fable R3-F1(BLOCKER,codex 兩輪 + 32 條突變全漏):父表補齊時 cohort 的 orders
  //    **還沒寫回、而且早被 D1c 刪光**。驗證若沿用子表模板去查 public.orders,子查詢恆空
  //    ⇒ v_live=0 ⇒ 第一張父表就 RAISE,四種組合一次都跑不完。
  //    正確語意 = 「d1r_orders 指到的父列,public 側全都在」⇒ 外層 public、子查詢 d1r。
  it.each([
    ['pre', pre],
    ['post', post],
  ])('%s:父表驗證的 live 側查 d1r_orders,不查此刻還是空的 public.orders', (_mode, script) => {
    const parentBlocks = script
      .split('DO $$')
      .filter((block) => /FROM public\.(customers|customer_addresses|products|product_variants|legal_terms_versions) WHERE/.test(block));

    expect(parentBlocks).toHaveLength(5);
    for (const block of parentBlocks) {
      expect(block).not.toContain('FROM public.orders WHERE id IN');
      expect(block).not.toContain('FROM public.order_items WHERE order_id IN');
      expect(block).not.toContain('FROM public.order_legal_consents WHERE order_id IN');
    }
    // 父表補齊整段都排在 orders 寫回之前 —— 所以它不可能依賴 public.orders。
    expect(at(script, 'INSERT INTO public.customers ')).toBeLessThan(
      at(script, 'INSERT INTO public.orders SELECT'),
    );
  });

  // 🔴 父表 selector 查的是 d1r_orders。沒先修剪成 26 張的話,留存 3 張的父列也會被算進去,
  //    筆數 assert 當場對不上。
  it.each([
    ['pre', pre],
    ['post', post],
  ])('%s:orders 修剪排在父表補齊之前', (_mode, script) => {
    expect(at(script, 'DELETE FROM d1r_orders WHERE id NOT IN (')).toBeLessThan(
      at(script, 'INSERT INTO public.customers '),
    );
  });

  // 🔴 全部載入完才開始寫回:父表要先於 orders 寫回(FK),但父表 selector 又要查 d1r_orders
  //    ⇒ 載入與寫回交錯的話順序無解。
  it.each([
    ['pre', pre],
    ['post', post],
  ])('%s:所有 \\copy 都在第一道 INSERT 之前', (_mode, script) => {
    const l = lines(script);
    const firstInsert = l.findIndex((x) => x.startsWith('INSERT INTO public.'));

    l.forEach((line, i) => {
      if (line.startsWith('\\copy ')) expect(i).toBeLessThan(firstInsert);
    });
  });

  // 🔴 單向 EXCEPT 只證明「備份的都在」,證明不了「沒有多出不該有的列」;
  //    EXCEPT 而非 EXCEPT ALL 會把重複列摺掉 ⇒ 少還原一份重複列驗不出來。
  it.each([
    ['pre', pre],
    ['post', post],
  ])('%s:比對是雙向且用 EXCEPT ALL(多重集相等)', (_mode, script) => {
    expect([...script.matchAll(/EXCEPT ALL/g)]).toHaveLength(20);
    // \b 兩側都要 —— 少了右邊那個,`RAISE EXCEPTION` 會被誤判成裸 EXCEPT。
    expect(script).not.toMatch(/\bEXCEPT\b(?! ALL)/);
  });

  // 錯誤即停不能靠操作者記得下 -v ON_ERROR_STOP=1;忘了的話交易中途出錯後語句照跑、
  // 最後 COMMIT 才變 ROLLBACK,畫面上卻一片成功。
  it.each([
    ['pre', pre],
    ['post', post],
  ])('%s:ON_ERROR_STOP 內建,所有寫入框在單一交易內', (_mode, script) => {
    const l = lines(script);
    const begin = l.indexOf('BEGIN;');
    const commit = l.indexOf('COMMIT;');

    expect(l).toContain('\\set ON_ERROR_STOP on');
    expect(l.indexOf('\\set ON_ERROR_STOP on')).toBeLessThan(begin);
    expect(commit).toBeGreaterThan(begin);
    // 🔴 留痕那一筆刻意跑在 COMMIT 之後(R3 2026-08-29 結構改動)——
    //    前兩輪對抗審查都咬在「它在交易內」造成的 fail-open handler 上,
    //    移出去之後那些問題一起消失。⇒ 所以這裡的例外要【具名、恰好一筆】。
    //
    // 🛑🛑 **射程 —— 這一段【取代】原本那句「比原本更難繞過」。那句話是【錯的】,已刪。**
    //    (不是改軟:一個錯的句子改軟之後它還在,只是不容易被抓到。)
    //    codex R4 逐條打掉了它。這幾道**是字串比對,不是 SQL 剖析**,
    //    而下面這五種形狀它們**看不到**:
    //      ① 大小寫或縮排不同的寫入(只認固定大小寫、零縮排的 INSERT 與 copy 那兩種)
    //      ② 交易【前】的 UPDATE / DELETE / ALTER / CALL / 有副作用的 SELECT
    //      ③ 同一行塞多個語句
    //      ④ 字串常數或 dollar-quote 裡的分號(下面那個「掃到行尾分號」會誤切)
    //      ⑤ 終止行加註解 ⇒ 區段吞到下一個分號
    //      🔴 ⑥ (codex R5 補的,而它比前五種寬):**其他寫入語句根本不在字集裡** ——
    //         SQL 的 COPY / MERGE / TRUNCATE / CREATE / DROP / GRANT / REVOKE,
    //         以及 psql 的 i / ir / gexec / ! 那幾個反斜線指令
    //         ⇒ **一個都不會被上面那幾條看到**。
    //         📌 ⇒ 前五種是「同一個東西換個寫法」,而第六種是【整族沒進分母】。
    //    ⚠️ 而 psql 的 echo **不是純顯示** —— 它會展開反引號裡的 shell 命令。
    //
    // 🔴🔴 **而【威脅模型】要講清楚,那不是「太難所以不做」**:
    //    **這幾道防的是【誤改】不是【惡意改】** —— 一個惡意的人本來就改得動
    //    AUDIT_SQL 本身,**這幾道從來沒有防過他**。要防他得換一層(簽章 / review),
    //    ⚠️ 而 codex R5 補了一格限定:**「review」只有在【獨立、且不能被同一作者繞過】時
    //       才算防線** —— 一個作者自己 approve 自己的 review,與沒有 review 相同。
    //    不是把字串比對寫得更聰明。
    const AUDIT_LINE = 'INSERT INTO public.admin_audit_log';
    // 🔴🔴 **形狀是【兩個交易】**(codex R5 之後):第一個是還原,第二個【只裝那一筆留痕】。
    //    R4 我把留痕移到交易外 ⇒ R5 指出那是三個獨立 autocommit 語句,
    //    transaction pooler 下可以落到三個不同 backend ⇒ 那兩個 SET 白設。
    //    ✅ 綁進自己的交易 ⇒ pooler 在交易期間綁住同一個 backend
    //       ⇒ 把「它落在哪個 backend」從【運氣】變成【約束】。
    l.forEach((line, i) => {
      if (line.startsWith(AUDIT_LINE)) {
        expect(i).toBeGreaterThan(commit);
        return;
      }
      if (line.startsWith('INSERT INTO public.') || line.startsWith('\\copy ')) {
        expect(i).toBeGreaterThan(begin);
        expect(i).toBeLessThan(commit);
      }
    });
    expect(l.filter((x) => x.startsWith(AUDIT_LINE))).toHaveLength(1);

    // COMMIT 之後的形狀:恰好一個 BEGIN、恰好一個 COMMIT,而那筆留痕在它們【中間】。
    const after = l.slice(commit + 1);
    expect(after.filter((x) => x === 'BEGIN;')).toHaveLength(1);
    expect(after.filter((x) => x === 'COMMIT;')).toHaveLength(1);
    const aBegin = after.indexOf('BEGIN;');
    const aCommit = after.indexOf('COMMIT;');
    const aIdx = after.findIndex((x) => x.startsWith(AUDIT_LINE));
    expect(aBegin).toBeLessThan(aIdx);
    expect(aIdx).toBeLessThan(aCommit);

    // 🔴 **那兩個 SET 要【逐字釘死】,不是「允許任何 SET」**(codex R5 must-fix):
    //    上一版白名單放行任意 `SET ` ⇒ 有人在正確兩行【之後】再加
    //    `SET statement_timeout = 0;` ⇒ 測試仍然全綠,而逾時保護消失。
    const sets = after.slice(aBegin + 1, aIdx).filter((x) => x.startsWith('SET'));
    expect(sets).toEqual(["SET LOCAL statement_timeout = '60s';", "SET LOCAL lock_timeout = '5s';"]);
    // 🔴🔴 **~~上一版:除了那個交易的四行,其餘只能是 echo~~ 已作廢** ——
    //    那道閘同時【太窄】(擋掉一致性閘那幾行合法的 SELECT / if / DO)
    //    與【太寬】(它只看行首字元,而 echo 開頭的行可以是任何東西)。
    //    ✅ 改成釘【實質】:**留痕的 COMMIT 之後不得有任何寫入**。
    const tail = after.slice(aCommit + 1);
    for (const line of tail) {
      expect(line).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE|COPY)\b/i);
    }
    // 而那道一致性閘要真的在(不是「允許」而已)。
    expect(tail.some((x) => x.includes('d1_mismatch'))).toBe(true);
    expect(tail.some((x) => x.includes('RAISE EXCEPTION'))).toBe(true);
  });
});

describe('還原留痕(⟦災難還原四件⟧ 2026-08-29)', () => {
  // 🔴 本片之前這支腳本【零留痕】:跑完 26 張訂單 + 2 個客戶進正式庫,
  //    而沒有一筆紀錄說是誰、什麼時候、為什麼。而它的門檻是 postgres 超級使用者
  //    ⇒ **能做任何事的人,正是最需要留下紀錄的那個。**

  it.each([
    ['pre', pre],
    ['post', post],
    ['rehearsal', rehearsal],
    ['rehearsal-post', rehearsalPost],
  ])('%s:留痕在 COMMIT【之後】,而且是最後一段', (_v, script) => {
    const audit = script.indexOf("'ops.d1.restore'");
    const commit = script.indexOf('\nCOMMIT;');
    expect(audit).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(-1);
    // 🔴🔴 **這一格從「COMMIT 之前」翻成「COMMIT 之後」—— 那是 R3 逼出來的結構改動。**
    //    前兩輪(R1 MF1 / R2 MF1)都咬在交易【內】那個 fail-open handler 上;
    //    移出交易之後那些問題【一起消失】,而不是被修好。
    //    ⇒ 這條擋的是「有人把它搬回交易裡」—— 搬回去就會把那三個問題一起帶回來。
    expect(audit).toBeGreaterThan(commit);
  });

  it.each([
    ['pre', pre],
    ['post', post],
    ['rehearsal', rehearsal],
    ['rehearsal-post', rehearsalPost],
  ])('%s:留痕之前先講清楚「還原已經 COMMIT 完成」', (_v, script) => {
    // 🔴 為什麼非有不可:post-COMMIT 落敗 ⇒ psql `rc≠0` ⇒ 而【還原其實已經成功了】
    //    ⇒ 災難當下容易被讀成「還原失敗」⇒ 想重跑。
    //    ⇒ 這一行讓那個非零退出碼【讀得懂它在講哪一段】。
    const echo = script.indexOf('還原【已經 COMMIT 完成】');
    const audit = script.indexOf("'ops.d1.restore'");
    expect(echo).toBeGreaterThan(-1);
    expect(echo).toBeLessThan(audit);
  });

  it('🔴 actor 記的是 session_user,不是自填的人名', () => {
    // 自填的那一格記的是「有人自稱做了這件事」;session_user 是 DB 自己講的,偽造不了。
    // ⚠️ 這一格擋的是「有人為了好看把它改成一個具名字串」—— 而那在 diff 上長得像改善。
    // 🔴🔴 **釘的是【位置】不是【出現過】** —— 第一版我寫 `block.slice(0,400)` 含
    //    `session_user` 就算過,而那一發**突變全綠**:`'db_session_user', session_user`
    //    就在那 400 字裡 ⇒ actor 被改成 `'sean'` 之後,那個字還在。
    //    📌 **一個字在那一段裡出現過,與它出現在【那一格】,是兩個宣稱。**
    expect(pre).toContain("VALUES (\n  session_user,\n  'ops.d1.restore',");
    expect(pre).toContain("'db_current_user', current_user");
  });

  it('🔴 D1_OPERATOR 缺席 ⇒ 產生器 throw(在任何破壞性動作之前就停)', () => {
    const saved = process.env.D1_OPERATOR;
    try {
      delete process.env.D1_OPERATOR;
      expect(() => buildRestoreScript('pre-n3c', 'production', DIR)).toThrow(/D1_OPERATOR/);
      // 🔴 空白【也算缺】—— 否則 `export D1_OPERATOR=' '` 會過,而那一欄等於沒填。
      process.env.D1_OPERATOR = '   ';
      expect(() => buildRestoreScript('pre-n3c', 'production', DIR)).toThrow(/D1_OPERATOR/);
    } finally {
      process.env.D1_OPERATOR = saved;
    }
  });

  it.each([
    ['pre', pre],
    ['post', post],
    ['rehearsal', rehearsal],
    ['rehearsal-post', rehearsalPost],
  ])('%s:requested_mode 是【psql 佔位符】,不是內插的字面', (_v, script) => {
    // 🔴🔴 這一格擋的是「有人為了少一個變數,把 mode 直接內插進 SQL」——
    //    而那一刀會同時:①破壞「兩版逐字相同」②讓交叉核對變成恆真
    //    (值與版本來自同一個產生器 ⇒ 它們永遠一致 ⇒ 證不了任何事)。
    expect(script).toContain("'requested_mode', :'d1_mode'");
    expect(script).not.toContain("'requested_mode', 'pre-n3c'");
    expect(script).not.toContain("'requested_mode', 'post-n3c'");
  });

  it.each([
    ['pre', pre],
    ['post', post],
    ['rehearsal', rehearsal],
    ['rehearsal-post', rehearsalPost],
  ])('%s:交叉核對的【結果】也要記下來,不是留給人事後自己看', (_v, script) => {
    // 🔴 codex R7 must-fix:原本只記兩個值 ⇒ 「它們對不對得上」沒有任何訊號。
    expect(script).toContain("'mode_matches_data'");
    // 而判準要用【資料】(legacy_display_id 有沒有值),不是單號格式 —— 格式會改,關係不會。
    // 🔴🔴 **逐個模式明寫,不得寫成「兩邊相等」**(codex 確認輪 must-fix):
    //    第一版寫 (:'d1_mode' = 'post') = (改號數 = 26)
    //    ⇒ pre 模式遇到【部分改號】(例如 13/26)時,左邊 false、右邊也 false
    //    ⇒ 兩個 false 相等 ⇒ **它記成 true** —— 一個壞掉的世界被記成一致。
    //    📌 「兩個都不對」與「兩個都對」在等號底下長得一樣。
    expect(script).toContain("SELECT CASE :'d1_mode'");
    expect(script).toContain("WHEN 'post' THEN count(*) = 26");
    expect(script).toContain("WHEN 'pre'  THEN count(*) = 26");
    expect(script).toContain('ELSE false');
    // 🛑 而那個【等號寫法】不得回來 —— 而這一格【只看碼,不看註解】。
    // 🔴🔴 這是同一族第四次:我那句【解釋舊 bug 的 SQL 註解】裡就含有那個字面
    //    ⇒ 第一版直接對整份 script 做 not.toContain ⇒ 當場紅,而碼是對的。
    //    📌 一個負向斷言的乾草堆若含註解,【解釋這條規則的那句話會違反這條規則】。
    const codeOnly = script
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(codeOnly).not.toContain("(:'d1_mode' = 'post') = (");
    // ✅ 而這個濾法自己要有正對照:那個字面【在註解裡】確實存在,而濾完就沒了。
    expect(script).toContain("(:'d1_mode' = 'post') = (");
  });

  it.each([
    ['pre', pre],
    ['post', post],
    ['rehearsal', rehearsal],
    ['rehearsal-post', rehearsalPost],
  ])('%s:不一致時要【大聲失敗】,而那道閘排在留痕 COMMIT【之後】', (_v, script) => {
    // 🔴 codex 確認輪:上一版只把結果【存起來】⇒ 而「存起來」與「有人會看」是兩件事。
    //    ✅ 而它排在 audit 的 COMMIT 之後 ⇒ **那筆紀錄先保住** ——
    //       在最需要有紀錄的那一刻(狀態不對),不會因為要報警而把紀錄一起丟掉。
    //    📌 順序就是這一格的全部:先落地,再叫。
    const audit = script.indexOf("'ops.d1.restore',");
    // 🔴🔴 **fail-closed 預設要在留痕【之前】**(codex R9 must-fix):
    //    未定義變數進 \if ⇒ psql 只印一句錯誤而【rc=0 且走 else】⇒ 靜默放行(2026-08-29 實測)。
    //    ⇒ 先設成 true,任何「沒被覆蓋到」的世界都落在【會叫】那一邊。
    const preset = script.indexOf('\\set d1_mismatch true');
    expect(preset).toBeGreaterThan(-1);
    expect(preset).toBeLessThan(audit);
    // ✅ 而值由那一筆 INSERT 自己的 RETURNING 給 —— 不是事後 SELECT 撈的某一列
    //    (原本 ORDER BY created_at DESC LIMIT 1 ⇒ 同秒多筆/並行時可能撈到別次)。
    expect(script).toContain("RETURNING NOT (after->>'mode_matches_data')::boolean AS d1_mismatch");
    expect(script).not.toContain('ORDER BY created_at DESC');
    // 🔴 而那道 \if 閘要排在留痕的 COMMIT【之後】—— 紀錄先保住,再叫。
    const gate = script.indexOf('\\if :d1_mismatch');
    expect(gate).toBeGreaterThan(audit);
    expect(script.indexOf('COMMIT;', audit)).toBeLessThan(gate);
    expect(script).toContain('RAISE EXCEPTION');
    expect(script).toContain('不要重跑');
  });

  it('🔴 四個版本的差異【沒有因為 requested_mode 變多】', () => {
    // 2026-08-29 當場量的基線:守門段 4 行、改號段 86 行。
    // 而佔位符在四份裡逐字相同 ⇒ 它不進差集。
    const d = (a: string, b: string) => {
      const la = lines(a);
      const lb = lines(b);
      let head = 0;
      while (head < la.length && la[head] === lb[head]) head++;
      return head;
    };
    // 兩兩比:第一個不同的行,必須落在守門段或改號段,而不是留痕段。
    for (const [x, y] of [[pre, rehearsal], [post, rehearsalPost], [pre, post]] as const) {
      const firstDiff = d(x, y);
      expect(x.split('\n')[firstDiff]).not.toContain('requested_mode');
    }
  });

  it('🔴 操作人進 after,而【不覆蓋 actor】', () => {
    // actor 的語意已經寫死成 session_user;兩個混在一起,
    // 下一個人會以為 actor 是驗證過的。
    expect(pre).toContain("'operator_self_reported', 'tester'");
    expect(pre).toContain("VALUES (\n  session_user,\n  'ops.d1.restore',");
    expect(pre).not.toContain("VALUES (\n  'tester'");
  });

  it('🔴 諺文填充那四個字元要被擋(它們是 \\p{L},而畫出來是空白)', () => {
    // 🔴🔴 codex R6 must-fix:上一版只測「缺值」與 ASCII 空白
    //    ⇒ **把那四個字元的剔除邏輯刪掉,測試仍然全綠** ⇒ 那道剔除沒有人守。
    //    ⚠️ 而它們不是隨便挑的:codex 查證「U+115F / U+1160 / U+3164 / U+FFA0 是
    //       Unicode 17 裡【全部】同時屬於 Default_Ignorable 與 L/N 的字元」——
    //       ⇒ 沒有第五個同型的空白字母/數字。**這一格因此是【完整的】,不是抽樣。**
    const saved = process.env.D1_OPERATOR;
    try {
      for (const ch of ['\u115F', '\u1160', '\u3164', '\uFFA0']) {
        process.env.D1_OPERATOR = ch;
        expect(() => buildRestoreScript('pre-n3c', 'production', DIR)).toThrow(/D1_OPERATOR/);
        // 而它與正常的字【混在一起】時要放行 —— 否則會誤擋含這些字元的合法輸入。
        process.env.D1_OPERATOR = ch + '線D';
        expect(() => buildRestoreScript('pre-n3c', 'production', DIR)).not.toThrow();
      }
      // ✅ 正對照:一個【是字母而畫得出來】的字必須過(證明這道尺不是無條件擋)。
      process.env.D1_OPERATOR = 'ㅎ';
      expect(() => buildRestoreScript('pre-n3c', 'production', DIR)).not.toThrow();
    } finally {
      process.env.D1_OPERATOR = saved;
    }
  });

  it('🔴 操作人姓名裡的單引號要跳脫(自填欄位是注入面)', () => {
    const saved = process.env.D1_OPERATOR;
    try {
      process.env.D1_OPERATOR = "O'Brien";
      const sql = buildRestoreScript('pre-n3c', 'production', DIR);
      expect(sql).toContain("'operator_self_reported', 'O''Brien'");
      // 負對照:沒跳脫的形狀不得出現(那會提早關掉字串)。
      expect(sql).not.toContain("'operator_self_reported', 'O'Brien'");
    } finally {
      process.env.D1_OPERATOR = saved;
    }
  });

  it.each([
    ['pre', pre],
    ['post', post],
    ['rehearsal', rehearsal],
    ['rehearsal-post', rehearsalPost],
  ])('%s:legacy_display_id 存在斷言在【交易內】(post 模式的還原自己要寫那一欄)', (_v, script) => {
    const l = lines(script);
    const assertIdx = l.findIndex((x) => x.includes("attname = 'legacy_display_id'"));
    expect(assertIdx).toBeGreaterThan(-1);
    // 🔴 必須在 COMMIT 之前,而且在任何寫入之前 —— 否則會在中段拋一個
    //    「column 不存在」的錯,而訊息說不出缺的是哪一支 migration。
    expect(assertIdx).toBeLessThan(l.indexOf('COMMIT;'));
    // ⚠️ ~~原本這裡還斷言「留痕用那一欄判 mode」~~ **那個理由已作廢**
    //    (R5 之後留痕改記 sample_display_id,不再推論 mode)。
    //    ✅ 而斷言留著,因為它的真正理由更硬:post 模式的 REMAP_SQL 會
    //       `SET legacy_display_id = t.display_id` 再寫回 public.orders
    //       ⇒ 沒有那一欄,post 模式的還原【本身】跑不完。
    //    📌 一道守門的理由變了而它仍然該留 ⇒ 那時要改的是【註解與測試名】,不是【碼】。
  });

  it('🔴 post 版真的會寫 legacy_display_id(上面那道斷言不是無主的)', () => {
    // 沒有這一格的話,上面那條會變成「為一個沒有人用的東西站崗」。
    expect(post).toContain('SET legacy_display_id = t.display_id');
  });

  it('🔴 留痕【沒有】fail-open handler —— 它移出交易之後就不該再有', () => {
    // R1/R2/R3 三輪都咬在那個 handler 上。移出交易之後我們【要】失敗被看見(rc≠0),
    // 所以任何 EXCEPTION 區塊都是把那三個問題請回來。
    const i = pre.indexOf('INSERT INTO public.admin_audit_log');
    const block = pre.slice(i, i + 900);
    expect(block).not.toMatch(/exception/i);
    expect(block).not.toMatch(/query_canceled/i);
    expect(pre).not.toContain('SET LOCAL statement_timeout = 0;');
  });

  it('🔴 留痕段不得依賴 mode/target(四版本取出來必須逐字相同)', () => {
    // ⚠️ **它證的是什麼,要寫清楚**(R3 2026-08-29 nit):`buildAuditSql` 是一個
    //    只吃 operator 的函式,而四個版本傳同一個 operator ⇒ **相同是構造上必然的**。
    //    ⇒ 這一格【不是】在跑四發比對確認它們碰巧一樣;
    //      它擋的是【有人把 mode / target 內插進去】—— 那一刀會讓它們立刻不同。
    //    📌 一條測試讀起來像做了什麼,與它實際擋住什麼,是兩個宣稱。
    // 那些值改成執行期由 DB 自己講(cluster_id / sample_display_id 都是查出來的),
    // 正是為了不破壞「兩版逐字相同」那個刻意的不變式(見 :142 與 :334)。
    const grab = (s: string) => {
      const i = s.indexOf('INSERT INTO public.admin_audit_log');
      // ⚠️ 那筆 INSERT 現在以 RETURNING … \gset 收尾(不是 `);`)⇒ 抓到那一行為止。
      return s.slice(i, s.indexOf('AS d1_mismatch', i));
    };
    // 🔴 codex R1 MF7:原本只比三個,而標題寫「四個版本」⇒ rehearsal-post 這個
    //    交叉世界【一次都沒被建出來】。**一條測試的名字比它的分母寬,是最便宜的假綠。**
    expect(grab(post)).toBe(grab(pre));
    expect(grab(rehearsal)).toBe(grab(pre));
    expect(grab(rehearsalPost)).toBe(grab(pre));
    // 負對照:確定真的抓到東西,不是兩個空字串相等。
    expect(grab(pre).length).toBeGreaterThan(200);
  });
});

describe('buildRestoreScript — 兩版差異', () => {
  // 🔴 兩版若各自長出獨立分歧,「演練過 pre、災難當下用 post」就會踩到只有那天才發現的差異。
  //    逐行比對:除了首行 echo,post 只能比 pre **多出一整塊連續的改號段**,不得有其他差別。
  it('唯一差別是一整塊改號段,pre 沒有任何一行是 post 沒有的', () => {
    const a = lines(pre).slice(1);
    const b = lines(post).slice(1);

    let head = 0;
    while (head < a.length && a[head] === b[head]) head++;

    let tail = 0;
    while (tail < a.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

    expect(head + tail).toBe(a.length);
    expect(b.slice(head, b.length - tail).join('\n')).toContain('d1r_remap');
  });

  it('pre 版不改號:不出現任何新格式還原號', () => {
    for (const { restoreDisplayId } of D1_DELETE_COHORT) {
      expect(pre).not.toContain(restoreDisplayId);
    }
    // 🔴 **這一條收窄了,而我要寫清楚為什麼它仍然守得住原本那件事。**
    //    ~~原本:`expect(pre).not.toContain('legacy_display_id')`~~
    //    ⇒ 留痕現在要【讀】那一欄來判 mode(codex R4:不能用 TEMP TABLE,它綁 session),
    //      而讀不是改 ⇒ 那個粗代理現在會誤傷。
    //    ✅ 換成釘【寫入】那個動作 —— 而「pre 版不改號」逐字就是這個意思。
    //    ⚠️ 而**上面那一圈斷言(26 個 `restoreDisplayId` 一個都不得出現)完全沒動** ——
    //       那是這一條的實質守門,而它比字串代理強:改號一定會帶進新號。
    expect(pre).not.toContain('SET legacy_display_id');
    expect(pre).not.toContain('d1r_remap');
  });

  it('post 版 26 組映射逐組入 script,舊號進 legacy_display_id', () => {
    for (const { displayId, restoreDisplayId } of D1_DELETE_COHORT) {
      expect(post).toContain(`('${displayId}', '${restoreDisplayId}')`);
    }
    expect(post).toContain('SET legacy_display_id = t.display_id');
    expect(post).toContain('display_id = m.new_display_id');
    expect(post).toContain('IF v_mapped <> 26 THEN');
  });

  // 🔴 凍結的映射會過期:N3b 換產號器後現網會隨機長出 6 碼新號,可能撞上第 1 批凍結的值。
  //    碰撞必須查 display_id 與 legacy_display_id **兩欄** —— 只查一欄就會發出重複號。
  it('post 版執行當下重驗碰撞,兩欄都查,重產走既有產號器、上限 5 次', () => {
    expect(post).toContain(
      'WHERE o.display_id = r.new_display_id OR o.legacy_display_id = r.new_display_id',
    );
    expect(post).toContain(
      'WHERE o.display_id = v_candidate OR o.legacy_display_id = v_candidate',
    );
    expect(post).toContain('FOR v_try IN 1..5 LOOP');
    expect(post).toContain("EXECUTE 'SELECT public.pcm_generate_display_id()' INTO v_candidate");
    expect(post).toContain('重產 5 次仍撞');
  });

  // 🔴 §5.4a 的取樣法寫錯不會有症狀、只會讓號碼分佈有偏差 ⇒ 同一份合約不得有第二份實作。
  //    重產一律呼叫 N3a 建的函式;函式不在 = 環境不對(還沒到 post-n3c),當場中止。
  it('post 版不自寫產號器,且函式不存在時中止', () => {
    expect(post).toContain("IF to_regprocedure('public.pcm_generate_display_id()') IS NULL THEN");
    expect(post).not.toContain('gen_random_bytes');
  });
});

// 🔴 Fable R3-F4:wrapper 原本零測試 —— 刪掉 preflight 或校驗碼那步,整個 suite 仍然全綠。
//    它是「唯一救命路徑」的入口,三道只有它做得到的檢查必須被釘住。
describe('d1-restore.sh(執行器)', () => {
  const sh = readFileSync(new URL('./d1-restore.sh', import.meta.url), 'utf8');

  it('五個步驟齊全且順序正確:preflight → 校驗碼 → CA → 產 SQL → 執行', () => {
    // ⚠️ 執行那一步的 needle 從 `psql -f` 改成 `-f "$WORK/restore.sql"`
    //    (2026-08-29:psql 那行加了 `-v d1_mode=` ⇒ 原本的字面不再連續)。
    //    🔴 而它【不是弱化】:那個 needle 仍然只出現在執行那一步,而順序斷言一格沒動。
    //    ✅ 而新加的那個參數另有一格單獨釘死(下一條),不靠這裡。
    const order = ['--preflight', 'shasum -a 256 -c checksums.txt', '--write-ca', 'test -s', '-f "$WORK/restore.sql"'];
    const positions = order.map((needle) => sh.indexOf(needle));

    expect(positions).not.toContain(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('🔴 psql 要把 wrapper 選的那一版傳進去(-v d1_mode)', () => {
    // 沒有它 ⇒ 留痕那句 :'d1_mode' 展不開 ⇒ psql 語法錯 ⇒ rc=3
    //   (2026-08-29 實測:**不是**安靜變成空字串 —— 那一格是 fail-closed 的)。
    expect(sh).toContain('psql -v d1_mode="$MODE"');
    // 🔴 **釘住它傳的是【原始的 $MODE】,不是在 shell 裡再轉一次** ——
    //    轉成 pre-n3c / post-n3c 的映射只活在產生器裡(`mode === 'pre' ? …`);
    //    在 wrapper 裡也轉一份 ⇒ 那份映射就有兩份,而它們漂掉的那天沒有東西會紅。
    expect(sh).not.toContain('d1_mode="${MODE}-n3c"');
    expect(sh).not.toContain('d1_mode="$MODE-n3c"');
  });

  it('校驗碼在備份目錄裡驗(checksums.txt 記的是相對檔名)', () => {
    expect(sh).toContain('( cd "$DIR" && shasum -a 256 -c checksums.txt )');
  });

  // 🔴 一步失敗就必須整條停 —— 少了 set -e,preflight 紅了照樣往下跑到 psql。
  it('set -euo pipefail 在最前面', () => {
    expect(sh).toContain('set -euo pipefail');
  });

  // 🔴 URL 進 argv = 密碼在整段 psql 執行期間都看得到(ps);libpq 沒給 sslmode 預設不驗憑證。
  it('連線字串走 PGDATABASE 不走 argv,且強制 verify-full 帶 CA', () => {
    expect(sh).toContain('PGDATABASE="$D1_DB_URL"');
    expect(sh).toContain('PGSSLMODE=verify-full');
    expect(sh).toContain('PGSSLROOTCERT="$WORK/supabase-ca.pem"');
    expect(sh).not.toMatch(/psql "\$D1_DB_URL"/);
  });
});

// 🔴 演練庫的 auth.users 是空的,而 customers.user_id → auth.users 是 FK ⇒ 不補替身連第一張
//    父表都插不進去。這正是「auth.users 不備份」那條殘餘風險在演練場上的具體長相。
describe('buildRehearsalSeedScript(演練前置)', () => {
  const seed = buildRehearsalSeedScript(DIR);

  it('只塞 id、不塞任何個資', () => {
    expect(seed).toContain('INSERT INTO auth.users (id) SELECT user_id FROM d1s_customers');
    expect(seed).toContain('ON CONFLICT DO NOTHING');
    // auth.users 只有 id 是 NOT NULL 且無預設(2026-07-29 實查)⇒ 其餘一欄都不該碰。
    expect(seed).not.toMatch(/encrypted_password|email|phone|raw_user_meta_data/);
  });

  // 🔴 UUID 從備份當場讀,不寫死進 repo —— 少一個會跟 cohort 漂移的清單。
  it('UUID 從 customers.csv 當場讀,repo 內不寫死', () => {
    expect(seed).toContain("\\copy d1s_customers FROM '/tmp/d1/customers.csv'");
    expect(seed).toContain('HEADER MATCH');
    // 只看寫入 auth.users 那行 —— 守門段帶 cohort UUID 是應該的,帳號 UUID 才不該寫死。
    const insert = seed.split('\n').find((l) => l.startsWith('INSERT INTO auth.users'))!;

    expect(insert).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  // 🔴 它會寫 auth.users —— 誤指 production 的後果不是「白跑一趟」。守門方向必須釘死。
  it('守門釘死:連到 production 就中止', () => {
    expect(seed).toContain(
      'IF (SELECT system_identifier FROM pg_control_system()) = 7632885393857617092 THEN',
    );
    expect(seed).toContain('演練版,不得對 production 執行');
    expect(seed).not.toContain('<> 7632885393857617092');
  });

  it('補完後 assert 筆數,且框在單一交易內', () => {
    const l = seed.split('\n');

    expect(seed).toContain('IF v_seeded <> 2 THEN');
    expect(l).toContain('\\set ON_ERROR_STOP on');
    expect(l.indexOf('BEGIN;')).toBeLessThan(l.indexOf('COMMIT;'));
    expect(l.findIndex((x) => x.startsWith('INSERT INTO auth.users'))).toBeLessThan(
      l.indexOf('COMMIT;'),
    );
  });
});

// 🔴 這一段跑在交易**結束之後**的新連線裡:腳本內的驗證只證明「這筆交易看得到」,
//    對「整筆被 rollback 掉」完全沒有感覺。兩者失效方式不同,不是重複勞動。
describe('buildRestoredVerifySql(COMMIT 後重數)', () => {
  const verify = buildRestoredVerifySql();

  it('十五張表全數重數,期望值與還原時同一份', () => {
    const expected: Record<string, number> = {
      customers: 2, customer_addresses: 3, products: 9, product_variants: 9,
      legal_terms_versions: 2, orders: 26, order_items: 36, order_legal_consents: 2,
      payment_charge_attempts: 24, pending_invoices: 0, email_outbox: 0,
      order_refunds: 0, order_refund_items: 0,
      payment_double_charge_anomalies: 0, payment_double_charge_anomaly_events: 0,
    };

    for (const [table, rows] of Object.entries(expected)) {
      expect(verify).toContain(`D1:還原後重數 ${table} = % 列(應 ${rows})`);
    }
    // 條件本身也要釘 —— 只驗訊息在的話,IF 改成 IF false 照樣全綠。
    expect([...verify.matchAll(/IF v_count <> \d+ THEN/g)]).toHaveLength(15);
  });

  // 🔴 全部查 public.*:此刻資料已寫回,查暫存表反而驗不到「真的落地了」。
  it('查的是 public.*,不是暫存表', () => {
    expect(verify).not.toContain('d1r_');
    expect([...verify.matchAll(/FROM public\.\w+ WHERE/g)].length).toBeGreaterThanOrEqual(15);
  });
});

// 🔴 一鍵演練腳本本身也要釘:少一步就等於少驗一件事,而整個 suite 不會有反應。
describe('d1-rehearsal.sh(一鍵演練)', () => {
  const sh = readFileSync(new URL('./d1-rehearsal.sh', import.meta.url), 'utf8');

  it('四步齊全且順序正確:解密 → 替身 → 還原 → 重數', () => {
    const order = ['age -d', '--seed-rehearsal', 'scripts/d1-restore.sh pre rehearsal', '--verify-restored'];
    const positions = order.map((needle) => sh.indexOf(needle));

    expect(positions).not.toContain(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  // 🔴 還原一定要走正式那支 wrapper —— 自己另外拼一次 psql 就等於演練的不是要用的那支。
  it('還原走正式 wrapper,不自己另拼一次', () => {
    expect(sh).toContain('scripts/d1-restore.sh pre rehearsal "$DIR"');
  });

  it('明文備份只活在暫存資料夾,失敗也會清掉', () => {
    expect(sh).toContain("trap 'rm -rf \"$WORK\"' EXIT");
    expect(sh).toContain('chmod 700 "$WORK"');
  });

  it('set -euo pipefail + 連線字串不進 argv + verify-full', () => {
    expect(sh).toContain('set -euo pipefail');
    expect(sh).toContain('PGDATABASE="$D1_DB_URL"');
    expect(sh).toContain('PGSSLMODE=verify-full');
    expect(sh).not.toMatch(/psql "\$D1_DB_URL"/);
  });
});

// ── #958:B1 加欄之後,舊備份還原不回來 ──────────────────────────────────────
// 🔴 上面 53 格【全部只測舊路徑】(它們呼叫 buildRestoreScript 時不傳 headers)
//    ⇒ 新加的三段在它們底下是零覆蓋,而它們照樣全綠。
//    📌「既有測試沒紅」與「新東西被測到」是兩個宣稱。
describe('#958 顯式欄位清單路徑', () => {
  const HDRS = new Map([['orders', ['id', 'display_id', 'total']]]);
  const withH = buildRestoreScript('pre-n3c', 'production', DIR, HDRS);
  const orderLoad = lines(withH).filter((l) => l.includes('d1r_orders'));

  it('🔴 LIKE 要帶 INCLUDING DEFAULTS —— 少了它,NOT NULL DEFAULT 的新欄會變成「必填而沒人填」', () => {
    expect(withH).toContain('CREATE TEMP TABLE d1r_orders (LIKE public.orders INCLUDING DEFAULTS);');
  });

  it('🔴 orders 那份改用顯式欄位清單,不再用 HEADER MATCH', () => {
    const copy = orderLoad.find((l) => l.startsWith('\\copy'))!;
    expect(copy).toContain('\\copy d1r_orders ("id", "display_id", "total") FROM');
    expect(copy).not.toContain('HEADER MATCH');
    expect(copy).toContain('FORMAT csv, HEADER,');
  });

  it('🔴 欄位集合比對【兩個方向都要在】,而【多欄那邊必須是 EXCEPTION 不是 NOTICE】', () => {
    // codex 抓的:原本只找訊息字串 ⇒ 把 RAISE EXCEPTION 改成 NOTICE 這格照樣綠
    expect(withH).toMatch(/RAISE EXCEPTION '🔴 orders: 備份有而目標表沒有的欄位/);
    // 少欄那一邊必須是 NOTICE 不是 EXCEPTION:舊備份【必然】少欄,自動擋掉等於把備份判死
    expect(withH).toMatch(/RAISE NOTICE '⚠️ orders: 備份【沒有】這些欄/);
  });

  it('🔴🔴 保序檢查要在,而且是 EXCEPTION —— 表頭單獨錯位會讓值寫進錯的欄', () => {
    // 實測:同一份 CSV 只換兩個表頭欄名 ⇒ 舊 HEADER MATCH 擋、集合比對放行且印 ✅
    expect(withH).toMatch(/RAISE EXCEPTION '🔴 orders: 備份表頭的欄位【順序被打亂】/);
    expect(withH).toContain('lag(ic.ordinal_position) OVER (ORDER BY c.ord)');
    expect(withH).toContain('x.pos < x.prev');
    // 🔴 上面三條都只證明「那些字在」。把 IF shuffled 換成 IF false ⇒ 字還在,而閘死了
    //    (2026-08-29 突變實測:那一發【零紅】)⇒ 要釘住【條件本身】。
    expect(withH).toContain('IF shuffled IS NOT NULL THEN');
    expect(withH).not.toMatch(/IF\s+(false|true)\s+THEN/);
  });

  it('缺欄訊息不得宣稱「都會走 DEFAULT」—— 三種結果不同', () => {
    expect(withH).toContain('可空的整欄變 NULL');
    expect(withH).toContain('NOT NULL 的下一步會直接失敗');
  });

  it('🔴 沒給 headers 的那條路要【自己說出來】—— fail-open 的病是「退回時沒有聲音」', () => {
    const noH = buildRestoreScript('pre-n3c', 'production', DIR);
    expect(noH).toContain('走的是 HEADER MATCH 舊路徑');
    expect(noH).toContain('HEADER MATCH');
    expect(noH).not.toContain('INCLUDING DEFAULTS');
  });

  it('🔴 只有拿到 headers 的表走新路;沒拿到的表仍走舊路(混用時兩條都要說得出自己是哪條)', () => {
    expect(withH).toContain('LIKE public.orders INCLUDING DEFAULTS');
    expect(withH).toContain('走的是 HEADER MATCH 舊路徑'); // 其餘 14 張表沒給 headers
  });

  it('欄名有雙引號時要跳脫(擋 SQL 識別字注入)', () => {
    const evil = buildRestoreScript('pre-n3c', 'production', DIR, new Map([['orders', ['a"b']]]));
    expect(evil).toContain('\\copy d1r_orders ("a""b") FROM');
  });

  it("🔴 欄名有單引號時, SQL literal 那側也要跳脫(codex 抓的:原本只打雙引號)", () => {
    const evil = buildRestoreScript('pre-n3c', 'production', DIR, new Map([['orders', ["a'b"]]]));
    expect(evil).toContain("ARRAY['a''b']");
  });
});

describe('#958 readCsvHeaders 讀不到就 throw', () => {
  it('🔴 檔案不存在 ⇒ throw,不得回 undefined(回 undefined 會靜靜退回會斷的舊路徑)', () => {
    expect(() => readCsvHeaders('/tmp/d1-no-such-dir-20260829', ['orders'])).toThrow(/讀不到備份表頭/);
  });

  it('🔴 空檔 / 空欄名也要 throw(codex 抓的:原本只測「檔案不存在」)', () => {
    const dir = mkdtempSync(`${tmpdir()}/d1t-`);

    writeFileSync(`${dir}/orders.csv`, '');
    expect(() => readCsvHeaders(dir, ['orders'])).toThrow(/第一行是空的/);

    writeFileSync(`${dir}/orders.csv`, 'id,,total\n');
    expect(() => readCsvHeaders(dir, ['orders'])).toThrow(/表頭有空欄名/);
  });
});
