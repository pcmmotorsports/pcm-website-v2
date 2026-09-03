import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// ⟦outbox-union-vs-DB⟧ 2026-09-03 線 `-mail`
//
// 🔴 **守的是一個【今天就已經發生】的分岔,而它沒有任何東西在看。**
//    `EmailOutboxEventType` 是**手抄的 union**,而 DB 的 `CHECK` 才是值域的權威。
//    `20260902120000` 自己逐字寫過:「**『DB 先加了新 event_type、code 還沒跟上』是這個 repo
//    明文預期會發生的順序**」⇒ 🛑 **而 2026-09-03 它不是預言了,它是現況。**
//
// 🎯 **兩個方向的分岔,危害不一樣,所以分開斷言**:
//    · **TS 有而 DB 沒有** ⇒ 🔴🔴 enqueue 寫得出去、DB 當場 `23514` 擋 ⇒ **信永遠寄不出去**
//      ⇒ 這是**必須紅**的,沒有例外。
//    · **DB 有而 TS 沒有** ⇒ 值域開著而**沒有模板** ⇒ sweeper 的 `default` `throw` 接住
//      ⇒ 計 error、不寄(**失敗方向安全**)⇒ 但**客人收不到信,而畫面上沒有東西說這件事**。
//      ⇒ 這一格今天**有一個已知的**(`order_cancelled`)⇒ 用「已知清單」釘住:
//        📌 **清單一變它就紅** —— 不論是**多了一個新的沒人做**,還是**舊的被做掉了**。
//
// ⚠️ **射程**:掃的是 **repo 裡的 migration 原始碼**,不是正式庫真的在跑的那一版。
// ─────────────────────────────────────────────────────────────────────────────

const MIG_DIR = join(__dirname, '..', 'supabase', 'migrations');
const PORTS = join(__dirname, '..', 'packages', 'ports', 'src', 'IEmailOutbox.ts');

/** DB 側值域 = **版本號最大**的那一支對 `event_type` 下 `CHECK ... IN (...)` 的 migration。 */
function dbEventTypes(): { values: string[]; file: string } {
  const hits: { file: string; values: string[] }[] = [];
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    const src = readFileSync(join(MIG_DIR, f), 'utf8');
    // 只認【真的 DDL】那一句:CHECK (event_type IN ('a','b'))
    const m = src.match(/CHECK\s*\(\s*event_type\s+IN\s*\(([^)]*)\)\s*\)/i);
    if (m) {
      const vals = [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
      if (vals.length > 0) hits.push({ file: f, values: vals });
    }
  }
  // 🔴 取**最後一支**(檔名即版本號、已排序)—— 而不是第一支:白名單是被一路換掉的。
  const last = hits[hits.length - 1];
  if (last === undefined) throw new Error('掃不到任何 email_outbox event_type 的 CHECK ⇒ 尺沒接上');
  return { values: last.values, file: last.file };
}

/** TS 側 union。 */
function tsEventTypes(): string[] {
  const src = readFileSync(PORTS, 'utf8');
  const m = src.match(/export type EmailOutboxEventType\s*=([\s\S]*?);/);
  if (m === null) throw new Error('抓不到 EmailOutboxEventType ⇒ 尺沒接上');
  return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
}

describe('⟦outbox-union-vs-DB⟧ 手抄的 union 與 DB 的 CHECK', () => {
  it('🟢 正對照:兩把尺都真的抓到東西了(否則下面每個比較都是空集合比空集合)', () => {
    const db = dbEventTypes();
    const ts = tsEventTypes();
    expect(db.values.length, `DB 側掃到的檔:${db.file}`).toBeGreaterThanOrEqual(3);
    expect(ts.length).toBeGreaterThanOrEqual(2);
    // 而兩邊都要含最早那兩個 —— 抓到別的東西時這一格會叫
    for (const base of ['order_created', 'order_shipped']) {
      expect(db.values, `DB 側缺 ${base}`).toContain(base);
      expect(ts, `TS 側缺 ${base}`).toContain(base);
    }
  });

  it('🔴🔴 TS 不得有 DB 沒有的值 —— 那會讓信【永遠寄不出去】', () => {
    // 🛑🛑 **射程:本格的「DB」是【repo 裡的 migration】,不是【正式庫】。**
    //    主視窗-87 2026-09-03 03:2x 對正式庫實測 `email_outbox_event_type_check` 全文:
    //      CHECK ((event_type = ANY (ARRAY['order_created','order_shipped','order_cancelled'])))
    //    ⇒ **正式庫是三值,而它【沒有】 `order_unpaid_cancelled`**(那支 migration 還在等 Sean 貼)。
    //    ⇒ 🔴 **所以本格在 repo 上綠,而同一個問題拿去問【正式庫】今天是紅的。**
    //
    // 📌 **這不是 bug,是這把尺答得出的問題就只有一個**:「repo 自己一致嗎」。
    //    「正式庫一致嗎」是**另一個宣稱**,而它要 DB access ⇒ 見
    //    `docs/specs/2026-09-03-two-migrations-paste-order.md` §4 與 `~/pcm-mailbox/等Sean貼的SQL-20260903.md`。
    // ⚠️ **而上面那個「三值」會過期** —— Sean 貼下去的那一刻它就變四值。
    //    ⇒ 引用它的人:**看日期與來源,不要把它當現況**。
    //
    // 🔵 **為什麼不把斷言改成問正式庫**:那會讓這格測試需要 DB 連線 ⇒ 在 CI 與每個施工窗都跑不動
    //    ⇒ 它會變成一格**經常被跳過**的測試,而那比一格射程窄但一直在跑的測試糟。
    const db = dbEventTypes();
    const extra = tsEventTypes().filter((v) => !db.values.includes(v));
    expect(
      extra,
      `TS union 有而 DB CHECK 沒有:${extra.join(', ')}\n` +
        `⇒ enqueue 寫得出去, 而 DB 會用 23514 當場擋 ⇒ 那封信永遠寄不出去。\n` +
        `⇒ 修法:先讓那支 migration 進 supabase/migrations/(而且要真的被 apply), 再改 union。`,
    ).toEqual([]);
  });

  it('🔴 DB 有而 TS 沒有的值 = 【值域開著而沒有模板】—— 用已知清單釘住', () => {
    // 🛑 這一格的期望值**不是「空集合」** —— 今天就有一個。
    //    它斷言的是【現況】:清單一變就紅,不論是多了一個沒人做的,還是舊的被做掉了。
    //    ⇒ 📌 把一個「已知缺口」從一段【會過期的散文】變成一格【會叫的東西】。
    const KNOWN_GAPS = ['order_cancelled'];
    const db = dbEventTypes();
    const ts = tsEventTypes();
    const gaps = db.values.filter((v) => !ts.includes(v)).sort();
    expect(
      gaps,
      `DB 有而 TS 沒有的值變了(現在:${gaps.join(', ') || '無'})。\n` +
        `· 多了一個 ⇒ 有人開了值域而沒做模板 ⇒ 那個 event 的信【寄不出去】(sweeper default throw),\n` +
        `  而客人收不到、畫面上沒有東西說這件事 ⇒ 要嘛補模板, 要嘛把它寫進 KNOWN_GAPS 並說明誰要接。\n` +
        `· 少了一個 ⇒ 🎉 有人把它做掉了 ⇒ 把它從 KNOWN_GAPS 拿掉, 並回頭改\n` +
        `  docs/specs/2026-09-03-cancel-email-scope-spec-draft.md §10 那一段(它現在說那件事還開著)。`,
    ).toEqual(KNOWN_GAPS.sort());
  });
});
