// cancel-reason-reserved-literal-guard.test.ts — ⟦b4-CANCELKINDBYCONTENT⟧ 的**驗收訊號**
//
// 🔴🔴 **本檔防的是【做了而打壞】。「沒有人做」那一半【不在這裡】,在板上那一列。**
//    🛑 **兩者不能互相取代** —— 而把它們合成一句「都是在守那個洞」會讓人以為做一個就夠。
//    ⇒ 另一半:`docs/launch-todo.md` 的 `⟦b4-CANCELKINDBYCONTENT⟧`。
//
// ── 病 ────────────────────────────────────────────────
// `orders.cancelled_reason` 那一欄裝的是**中文散文**(七值映射:「依您要求取消」…),
// 而 `p_reason_code = 'other'` 那條路裝的是**員工當場打的原文**
// (現行定義 `20260830020000_m4b_e10_cancel_reason_neutral.sql:175` 逐字 `v_reason_txt := v_detail;`)。
// 🔴 而同一欄裡混著**一個機器碼** `payment_expired`(L3 自動失效寫的),
//    而 `orderCancelKindOf`(`order-cancel-reason.ts:82`)拿那個字面去判身分。
// ⇒ 🎯 **員工打 `payment_expired` ⇒ 客人的訂單頁對他陳述一個錯的取消原因。**
// 📌 **⇒ 那一欄「中文散文混一個機器碼」的形狀本身就是病灶。**
//
// ── 修法只能是【拒絕】, 不能是【改寫】────────────────────
// 🔵 軟理由:靜靜改寫會讓員工以為他填的字被存下來了。**而那是可以被權衡掉的。**
// 🔴 硬理由:`…cancel_reason_neutral.sql:31-32` 逐字 —— 冪等回放端拿 `orders.cancelled_reason`
//    跟【重算的映射】比,`IS DISTINCT FROM` 就 `RAISE`。⇒ **改寫 ⇒ 冪等重放會爆。**
// 📌 **⇒ 一個軟理由與一個硬理由指向同一個動作, 而只有硬的那個擋得住下一個人。**
//
// ── 🔴 為什麼【曾經】用 `it.fails` 而不是留一格紅(下面這段是病歷, 不是現況)──
// ⛔ **本檔今天一格 `it.fails` 都沒有** —— 修法落地那個 commit 已經把它翻成正常的 `it`。
//    留這段是因為它記著一個判斷的理由, 而理由比形狀活得久。(R2 F9)
// `.github/workflows/ci.yml:192` 跑 `pnpm test`, 而 vitest include 含 `scripts/**`
// ⇒ 留一格紅 ⇒ **CI 常態紅**。而 CI 今天本來就是 `failure`(2026-09-03 線【帳】實測)
// ⇒ 🛑 **多一條常態紅不會讓它從綠變紅, 它會讓【已經紅的 CI 更難修回綠】——
//       而一個修不回綠的 CI, 每多一條就更沒有人相信它會綠。**
//
// ── 🔴🔴 而 `it.fails` 自己有一個假綠, 本檔用「前置條件那一格」堵它 ──
// `it.fails` 的語意是「失敗才算通過」,而它**不區分失敗的原因**:
// ```
// 斷言不成立(= 洞還在)                      ⇒ ✅ 我們要的
// 🔴 檔案改名 / 錨撈不到 / 讀檔丟例外          ⇒ **也算失敗 ⇒ 也印綠**
// ```
// ⇒ 🎯 **那把尺會在【它自己壞掉】的時候印通過** —— fail-open 而畫面完全正常。
// ✅ ⇒ 所以下面第一格是**普通的 `it`**,只斷言前置條件(而且用**恰好的數**,不是 `> 0`)。
// 🎯 **⇒ 那一格紅 = 尺壞了;`it.fails` 那格變紅 = 洞補好了。兩種紅分得開。**
//
// 🧬 **而「分得開」不夠, 要有人讀得懂** —— 兩格的失敗訊息各自弄紅一次、**人眼看過**
//    (2026-09-03 實跑,結果記在本檔最下面)。理由:memory 記過
//    「我為了分辨兩種紅寫的訊息, 從來沒有被任何東西讀過 —— 修的是突變, 漏的是讀它的那一端」。

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PAYMENT_EXPIRED_CANCEL_REASON } from '@pcm/domain';

const MIGRATIONS = join(import.meta.dirname, '..', 'supabase', 'migrations');

/**
 * 🔴 **保留字集 = 那一欄裡【機器會拿去判身分】的字面。**
 *    今天恰好 1 個 —— 而那不是猜的,是量那一欄的**內容分佈**量到的:
 *    六個 reason_code ⇒ 中文文案 · `other` ⇒ 員工原文 · 這一個 ⇒ L3 寫入。
 *    ✅ 從 `@pcm/domain` 讀,不在本檔重打一份 —— 兩份會漂。
 */
const RESERVED = [PAYMENT_EXPIRED_CANCEL_REASON];

/** 員工原文直接進欄位的那一行 —— 病灶的錨。 */
const HOLE_ANCHOR = /v_reason_txt\s*:=\s*v_detail\s*;/g;

/**
 * 🔴🔴 **受詞是【兩支】不是一支** —— codex 關卡2 R1 must-fix(2/8)。
 *    本檔第一版只掃 `admin_cancel_order`, 而 `admin_mark_order_cancelled`
 *    (`20260902140000:384` 逐字 `cancelled_reason = v_reason_txt`)是**第二條寫入路**。
 *    📌 **那時我的分母是【一支檔】, 而那支檔內每一句都對** ——
 *       量錯的不是閘, 是「誰會寫這一欄」那張清單。
 *    ✅ 這張清單怎麼來的(可重跑):`grep -rn "cancelled_reason *=" supabase/migrations/*.sql`
 *       ⇒ 開檔看每一處 ⇒ 寫入型五支, 其中兩支收員工原文 = 下面這兩個。
 *    🛑 **這張清單自己會過期** —— 之後有人再開第三條寫入路, 本檔不會叫。
 *       那一半住在 `docs/launch-todo.md` 的板上, 不在這裡。
 */
const GUARDED_RPCS = ['admin_cancel_order', 'admin_mark_order_cancelled'] as const;

/** 剝掉 SQL 註解 —— 註解裡提到不算擋住(區塊 + 行,兩把尺用同一個定義)。 */
function stripSqlComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*--.*$/gm, '');
}

/** 找【最新一支】定義該 RPC 的 migration —— 修法會是一支新檔, 不可寫死檔名。 */
function latestRpcSource(name: string): { file: string; body: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 檔名前綴是版本號 ⇒ 字典序 = 時間序
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, 'i');
  let found: { file: string; body: string } | null = null;
  for (const f of files) {
    // 🔴 **先剝註解再找** —— 檔頭那段病歷會逐字提到 `CREATE OR REPLACE FUNCTION public.…`,
    //    而那不是一個定義。剝完再找, `exec` 的第一個命中才會是真的那一支。
    const text = stripSqlComments(readFileSync(join(MIGRATIONS, f), 'utf8'));
    const m = head.exec(text);
    if (m === null) continue;
    // 🔴 只取【那一支函式的本體】, 不是整支檔 ——
    //    同一支 migration 現在裝著兩支函式, 拿整檔去數錨會數到 2。
    const end = text.indexOf('\n$fn$;', m.index);
    if (end < 0) throw new Error(`${f}:找到 ${name} 的開頭卻找不到 $fn$; 結尾 ⇒ 掃描邏輯壞了`);
    found = { file: f, body: text.slice(m.index, end) };
  }
  if (found === null) throw new Error(`找不到任何定義 ${name} 的 migration`);
  return found;
}

/**
 * 那支 RPC 有沒有【真的擋住】保留字面。
 *
 * 🔴🔴 **codex 關卡2 R1 must-fix(6/8):~~`RAISE …{0,400}… 字面` + `'i'`~~ 太鬆, 兩個方向都鬆**:
 *    · `'i'` ⇒ 一個擋 `PAYMENT_EXPIRED` 的閘也算過, 而讀端是 JS `===` ⇒ 那個閘擋不到真的。
 *    · 400 字視窗 ⇒ **一個無關的 / 不可達的 `RAISE` 落在附近就算過**。
 * ✅ 改成釘**三件事的順序**, 與資料庫那道事後閘同一個判準:
 *    ① **整句** `IF v_detail = '<字面>' THEN` 在(**大小寫敏感**;R2 F3 之後不再是裸條件 ——
 *       裸條件對 `IF NOT (…)` / `… AND false` 印綠, 而那兩種語意都是【不擋】)
 *    ② 它和賦值之間有一個 `RAISE EXCEPTION`
 *    ③ 它排在 `v_reason_txt := v_detail;` **之前**(排後面 = 字已經進去了才擋 = 沒擋)
 */
function rejectsReserved(body: string): boolean {
  const asg = body.indexOf('v_reason_txt := v_detail;');
  if (asg < 0) return false;
  return RESERVED.every((lit) => {
    // 🔴🔴 **R2 F3:錨是【整句 `IF … THEN`】, 不是裸條件。** 一發突變逼出來的:
    //    `IF NOT (v_detail = 'payment_expired') THEN` ⇒ **語意整個反過來**, 而裸條件那把尺印綠。
    //    同族:`… AND false THEN` / `… AND p_actor = '__never__' THEN` —— 三發都是
    //    「看起來還在、實際不生效」, 與本片其他五發同一類, 而它們原本沒被涵蓋。
    //    ⚠️ **天花板**:把真閘包進到不了的分支(`IF FALSE THEN … END IF;`, 或 `ELSIF` 接在恆真分支之後)**這把尺仍然綠** ——
    //       「這段碼到得了嗎」不是文字尺答得出來的問題。那一格今天沒有守門, 寫在這裡不是藉口是座標。
    // 大小寫敏感:擋的形狀 = 讀的形狀(讀端是 JS `===`)。
    // 🔵 R2 N3:`lit` 來自 `@pcm/domain`, 今天安全 —— 而**它是別人維護的**,
    //    之後長出帶 `.` / `(` 的成員時, 未跳脫的版本會安靜地過寬匹配或直接丟例外。
    const esc = lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`IF\\s+v_detail\\s*=\\s*'${esc}'\\s+THEN`).exec(body);
    if (m === null || m.index > asg) return false;
    return /RAISE\s+EXCEPTION/i.test(body.slice(m.index, asg));
  });
}

describe('⟦b4-CANCELKINDBYCONTENT⟧ · 員工打的字不得撞上保留字面', () => {
  it.each(GUARDED_RPCS)('🟢 前置條件 %s —— 這一格紅代表【尺壞了】, 不代表洞補好了', (rpc) => {
    const { file, body } = latestRpcSource(rpc);
    expect(file, '撈到的不是 migration 檔名 ⇒ 掃描邏輯壞了').toMatch(/^\d{14}_.*\.sql$/);

    // 🔴 **恰好的數, 不是 `> 0`** —— `> 0` 在「錨變多了」時仍然綠, 而那代表病灶長出第二處。
    // 🔴 **數【碼】不數註解** —— 而這一格是本尺自己咬到自己抓出來的(2026-09-03):
    //    修法那支 migration 的檔頭註解裡引用了這個錨 ⇒ 含註解數會是 2 ⇒ 前置條件誤紅。
    //    📌 而那正是本 repo 記過的同一條:**註解會被 grep 數成碼**。
    const hits = body.match(HOLE_ANCHOR)?.length ?? 0;
    expect(
      hits,
      [
        `${file} 的 ${rpc}:錨 \`v_reason_txt := v_detail;\` 命中 ${hits} 次, 預期【恰好 1 次】。`,
        '🔴 這一格紅 = **這把尺壞了**(檔案改名 / 錨改寫 / 病灶多出一處), **不是**洞補好了。',
        '⇒ 洞補好的訊號是下面那格變紅, 不是這一格。',
        '✅ 出路:先確認病灶還在不在、在幾處, 再決定要改錨還是改射程。',
      ].join('\n'),
    ).toBe(1);
  });

  it('🟢 保留字集本身 —— 空的話下面那幾格恆綠', () => {
    expect(RESERVED.length, '保留字集是空的 ⇒ 下面那格恆綠').toBeGreaterThan(0);
    // 🔵 負對照:合法的中文取消原因不得混進保留字集 —— 太寬的尺產出的是假指控。
    for (const legit of ['依您要求取消', '商品供貨中斷,已為您取消', '交期無法配合,已為您取消']) {
      expect(RESERVED, `「${legit}」是七值映射的正常文案, 不該在保留字集裡`).not.toContain(legit);
    }
  });

  // 🔵🔵 **這一格【曾經是 `it.fails`】, 而它在本 commit 轉正。**
  //    當時的形狀:洞還在 ⇒ 內層斷言失敗 ⇒ `it.fails` 綠(不把 CI 弄紅);
  //    而修法一進 repo, 它就變紅 —— 而它真的叫了。
  //    ⇒ ✅ 修法落地(`20260903093000_m4b_b4cancelkind_reject_reserved_reason.sql`)之後轉成正常 `it`,
  //      所以**未來有人把那道拒絕拿掉時, 它會再叫一次**。
  //    🔴 **而 `it.fails` 那段歷史留在這裡是刻意的** —— 它記著一件只有跑過才知道的事:
  //      `it.fails` 變紅時 vitest **只印 `Error: Expect test to fail`**,
  //      寫在 `expect` 訊息裡的字**一個都不會出現** ⇒ 指示當時只能住在標題裡。
  //    ⛔ ~~「那就是【這 475 行有沒有被抄壞】的訊號」~~ —— **codex R1 must-fix(7/8):那句宣稱大於實際。**
  //       🔴 本檔**從來沒有比對過那幾百行** —— 它只看那道拒絕在不在、排在賦值之前。
  //       ✅ 「有沒有抄壞」那一格住在**別的地方**, 而它有兩層:
  //          ① 動手當下的機械比對(`diff` 抽出的函式本體 ⇒ 刪 0 增 22 / 刪 1 增 13, 記在 migration 檔頭)
  //          ② apply 當下的事後閘(讀 `pg_get_functiondef`, 驗既有驗證句還在)
  //       📌 **⇒ 一句「這就是那個訊號」把三道不同的尺講成一道, 而少掉的那兩道沒有東西會叫。**
  it.each(GUARDED_RPCS)(
    '🔴 %s:員工原文不得撞上保留字面 —— 這一格紅 = 那道拒絕被拿掉了',
    (rpc) => {
      const { file, body } = latestRpcSource(rpc);
      expect(
        rejectsReserved(body),
        [
          `${file} 的 ${rpc}:員工原文(p_reason_code='other')仍可被打成保留字面 ${RESERVED.join(', ')}。`,
          '',
          '🔴🔴 **你看到這一格紅, 代表那道拒絕被拿掉了(或被搬到賦值之後 = 等於沒擋)。**',
          '   🛑 **不要 skip 也不要刪** —— 那樣下一次拿掉就沒有東西會叫了。',
          '',
          '⚠️ 而修法只能是【拒絕】(RAISE EXCEPTION), 不能是【靜靜改寫】——',
          '   冪等回放端拿這一欄跟重算的映射比(cancel_reason_neutral.sql:31-32), 改寫會讓重放 RAISE。',
          '🔴 **而兩支都要有** —— admin_cancel_order 與 admin_mark_order_cancelled 是兩條寫入路。',
        ].join('\n'),
      ).toBe(true);
    },
  );
});

// ── 🧬 突變紀錄 ─────────────────────────────────────────────────────────
// 🔴🔴 **2026-09-03 codex 關卡2 R1 修完之後【整批重跑】** ——
//    R1 把 `rejectsReserved()` 從「RAISE 與字面 400 字內 + 大小寫不敏感」改成
//    「判斷式在 · 中間有 RAISE · 排在賦值之前」, **而改了尺, 先前那些突變證據當場作廢**
//    (本 repo 記過的同一條:那個作廢不會出聲)。下面五發都是**改完之後**跑的,
//    每發都 `cp` 還原並 `diff -q` 驗逐字相同。基準 = **5 passed (5)**。
//   ① 把 `admin_cancel_order` 那道 IF 換成 `IF false` ............ **1 紅**(只有它那格)
//   ② 把 `admin_mark_order_cancelled` 那道 IF 換成 `IF false` .... **1 紅**(只有它那格)
//      🎯 ①② 分開紅 ⇒ **兩支各自被守著**, 不是一格綠掩護兩支。
//   ③ 字面改成 `'PAYMENT_EXPIRED'`(只改大小寫) .................. **2 紅**
//      ⇒ 釘住「擋的形狀 = 讀的形狀」:讀端是 JS `===`, 大寫版擋不到真的。
//   ④ 把那道 IF 整段搬到 `v_reason_txt := v_detail;` **之後** ..... **2 紅**
//      ⇒ 這一發是 R1 must-fix(6/8) 的直接對照:**舊尺對它是綠的**
//        (訊息字面還在、RAISE 也還在 400 字內)⇒ 一個「已經進去了才擋」的世界會被判通過。
//   ⑤ 把真的那道 IF 整段藏進 `/* */`, 另留一個 `IF false` 帶原訊息 ... **1 紅**
//      ⇒ 負對照:註解裡的擋不算擋(code-reviewer 2026-09-03 抓的那條, 換尺後重驗)。
//   📌 **⑤ 之外每一發都【不是】把整段刪掉** —— 刪掉太好殺;
//      這五發留的都是「看起來還在、實際不生效」的形狀。
//
// ── 🧬🧬 **R2 加的第 6-8 發 —— 而它們是【對前五發的反例】** ────────────────
//   🔴 R2(adversarial-reviewer, opus)拿**真檔真 body 跑真 predicate**, 找到**舊尺全綠**的第六類:
//   ⑥ `IF NOT (v_detail = 'payment_expired') THEN` ....... 舊尺 **綠** ⇒ 新尺 **1 紅**
//      🎯 **語意整個反過來** —— 只有這個字放行, 其他全擋。而舊尺(找裸條件)看不見那個 `NOT`。
//   ⑦ `IF v_detail = 'payment_expired' AND false THEN` ... 舊尺 **綠** ⇒ 新尺 **1 紅**
//   ⑧ `RAISE EXCEPTION` 換成 `RAISE NOTICE`(訊息一字不動) ... 新尺 **1 紅**;
//      🔴 而**資料庫那道事後閘原本會通過** ⇒ 已補一格(驗中間那個真的是 EXCEPTION)。
//      📌 那道閘是**唯一讀「真的被貼進去的那份」**的尺 ⇒ 它漏掉就沒有第二個人會發現。
//   ✅ 修法(兩把尺各一行):錨從**裸條件**換成**整句 `IF … THEN`**。
//   ⚠️ **而天花板要寫下來, 不要當作沒有**:
//      把真閘包進一個到不了的分支(`IF FALSE THEN … END IF;`)⇒ **兩把尺都還是綠**。
//      「這段碼到得了嗎」不是文字尺答得出來的問題 ⇒ **那一格今天沒有守門。**
//   🎯 **⇒ 前五發全殺不代表這把尺夠寬** —— 五發是我自己出的題, 第六發是別人出的。
//      📌 **判別句:我的突變清單是誰列的?**
//
// ── 🧬 舊尺時代的突變紀錄(留著, 因為其中一發記著一個只有跑過才知道的事)────
//  · `it.fails` 變紅時 vitest **只印 `Error: Expect test to fail`** ——
//    寫在 `expect` 訊息裡的字**一個都不會出現** ⇒ 指示只能住在標題裡。
//    而前置條件那格相反, 它的訊息會完整印出來(實測印了全部四行)。
//    🎯 **同一支檔裡兩格的訊息, 一格讀得到一格讀不到 —— 那差別只有跑一次才看得見。**
//  ⛔ 舊尺的那四發數字(3/3 全綠 · 兩種紅分得開 · …)**不再成立**, 已由上面那批取代。
