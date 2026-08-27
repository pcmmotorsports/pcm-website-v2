import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { D1_DELETE_COHORT, D1_RETAIN_COHORT } from './d1-cohort';
import { buildCohortSelectors } from './d1-export';
import {
  buildRehearsalSeedScript,
  buildRestoredVerifySql,
  buildRestoreScript,
} from './d1-restore';

const DIR = '/tmp/d1';
const pre = buildRestoreScript('pre-n3c', 'production', DIR);
const post = buildRestoreScript('post-n3c', 'production', DIR);
const rehearsal = buildRestoreScript('pre-n3c', 'rehearsal', DIR);

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
    const inserts = lines(script).filter((l) => l.startsWith('INSERT INTO public.'));

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
    l.forEach((line, i) => {
      if (line.startsWith('INSERT INTO public.') || line.startsWith('\\copy ')) {
        expect(i).toBeGreaterThan(begin);
        expect(i).toBeLessThan(commit);
      }
    });
    // 🔴 Fable R3-F4:驗證區塊的位置也要釘。原本只釘 INSERT 與 \copy ⇒ 把 COMMIT 搬到
    //    所有 assert 之前照樣全綠,而「assert 不成立就整批 ROLLBACK」這個核心保證會靜默蒸發。
    l.forEach((line, i) => {
      if (line.startsWith('DO $$')) expect(i).toBeLessThan(commit);
    });
    expect(l.slice(commit + 1).every((line) => line.startsWith('\\echo'))).toBe(true);
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
    expect(pre).not.toContain('legacy_display_id');
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
    const order = ['--preflight', 'shasum -a 256 -c checksums.txt', '--write-ca', 'test -s', 'psql -f'];
    const positions = order.map((needle) => sh.indexOf(needle));

    expect(positions).not.toContain(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
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
