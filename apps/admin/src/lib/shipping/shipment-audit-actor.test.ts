// shipment-audit-actor.test.ts —— 出貨線五支 RPC 的稽核列(板 20260916190000)字面層守門。
//
// 🔴🔴 **這一格存在的理由:主視窗 2026-09-16 的硬要求 ——「把 INSERT 拿掉, 對應那格必須紅」。**
//    只斷言「有寫一列」不算數:那種測試在 `action` 打錯、`target` 指到別的東西、
//    或有人把收件人姓名塞進 `after` 的時候**照樣綠**。
//    ⇒ 本檔逐支斷言【動作名 / 對象 / 非 PII 內容 / reason 只給作廢】。
//
// 🔵 為什麼是字面層(讀 migration 檔)而不是真的跑 SQL:
//    這五支的正確性由 DB 的閘與那支 migration 自己的後置閘⑥ 顧(它也會在貼板當下紅);
//    本檔顧的是**「有人日後改碼時把它改壞而沒人發現」**那一種 —— 而那種靠讀檔就攔得住,
//    不需要為它架一座 PG。**兩層各守各的,不是重複。**

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(
  new URL('../../../../../supabase/migrations/20260916190000_m4b_shipment_audit_actor.sql', import.meta.url),
  'utf8',
);
const ACTIONS_SRC = readFileSync(new URL('./shipment-actions.ts', import.meta.url), 'utf8');
const DISPATCH_SRC = readFileSync(new URL('./shipment-dispatch-hct-action.ts', import.meta.url), 'utf8');
const REPO_SRC = readFileSync(new URL('./shipment-repository.ts', import.meta.url), 'utf8');

/** 把 migration 切成「每一支函式的本體」—— 斷言才能落在正確的那一支身上。 */
function bodyOf(funcName: string): string {
  const start = MIGRATION.indexOf(`CREATE FUNCTION public.${funcName}(`);
  expect(start, `migration 裡找不到 CREATE FUNCTION public.${funcName}`).toBeGreaterThan(-1);
  const end = MIGRATION.indexOf('$function$;', start);
  expect(end, `${funcName} 的本體沒有結尾`).toBeGreaterThan(start);
  return MIGRATION.slice(start, end);
}

/** 五支 ⇒ 它們各自該寫的動作名。 */
const CASES = [
  { func: 'admin_create_shipment', action: 'shipment.create' },
  { func: 'admin_add_shipment_items', action: 'shipment.items.add' },
  { func: 'admin_mark_shipment_shipped', action: 'shipment.shipped.mark' },
  { func: 'admin_void_shipment', action: 'shipment.void' },
  { func: 'admin_unvoid_shipment', action: 'shipment.unvoid' },
] as const;

describe('出貨線五支 RPC 都要寫 admin_audit_log(負對照:拿掉 INSERT 這格就紅)', () => {
  for (const { func, action } of CASES) {
    it(`${func} 寫了一列 ${action}`, () => {
      const body = bodyOf(func);
      expect(body, `${func} 沒有 INSERT INTO public.admin_audit_log ⇒ 這支板的全部意義就是這一行`).toContain(
        'INSERT INTO public.admin_audit_log',
      );
      // 🔴 動作名要**逐字**對 —— 打錯字的稽核列查不出來, 而且不會有任何東西紅。
      expect(body, `${func} 的 action 不是 '${action}'`).toContain(`'${action}'`);
      // 🔴 對象格式跟既有那支 (`shipment.tracking.update`) 一致:`shipment:<uuid>`
      expect(body, `${func} 的 target 不是 'shipment:' || …`).toMatch(/'shipment:' \|\| .*::text/);
      // 🔴 actor / request_id 要用參數, 不得寫死(寫死 'system' 就答不出誰做的 —— plan 裡明文否掉的那條路)
      expect(body, `${func} 沒把 p_actor 寫進稽核列`).toMatch(/p_actor,/);
      expect(body, `${func} 沒把 p_request_id 寫進稽核列`).toMatch(/p_request_id,/);
      expect(body, `${func} 把 actor 寫死了`).not.toMatch(/'system'|'unknown'|'admin-bot'/);
    });
  }

  it('🔴 稽核列不得夾帶個資(收件人姓名 / 電話 / 地址)', () => {
    for (const { func } of CASES) {
      const body = bodyOf(func);
      const insertAt = body.indexOf('INSERT INTO public.admin_audit_log');
      const insertBlock = body.slice(insertAt, insertAt + 900);
      expect(insertBlock, `${func} 的稽核列帶了 recipient_snapshot(那是姓名/電話/地址)`).not.toContain(
        'recipient_snapshot',
      );
      for (const pii of ["'name'", "'phone'", "'line'"]) {
        expect(insertBlock, `${func} 的稽核列帶了 ${pii}`).not.toContain(pii);
      }
    }
  });

  it("🔴 標出貨存的是 has_tracking_number(布林), **不是單號本身**", () => {
    const body = bodyOf('admin_mark_shipment_shipped');
    const insertAt = body.indexOf('INSERT INTO public.admin_audit_log');
    const insertBlock = body.slice(insertAt, insertAt + 900);
    expect(insertBlock, '標出貨的稽核列沒有 has_tracking_number').toContain("'has_tracking_number'");
    // 🔵 這一條是刻意與既有 `shipment.tracking.update` 不一致(那支存號碼)——
    //    方向由主視窗 2026-09-16 定:稽核表不該變成第二個個資落點。
    expect(insertBlock, '標出貨的稽核列把貨運單號本身存進去了').not.toMatch(/'tracking_number',\s*p_tracking_number/);
  });

  it('🔴 只有作廢那一支帶 reason(其餘四支不得帶)', () => {
    const voidBody = bodyOf('admin_void_shipment');
    expect(voidBody, '作廢沒把原因寫進 reason 欄').toMatch(/reason, request_id, source_app/);
    expect(voidBody, '作廢的 reason 不是 p_void_reason').toContain('p_void_reason,');
    for (const { func } of CASES.filter((c) => c.func !== 'admin_void_shipment')) {
      const body = bodyOf(func);
      const insertAt = body.indexOf('INSERT INTO public.admin_audit_log');
      expect(
        body.slice(insertAt, insertAt + 200),
        `${func} 不該帶 reason(現況只有「人給理由」那一類才填)`,
      ).not.toMatch(/reason, request_id/);
    }
  });

  it('🔴 重放不得重複寫稽核(按兩次只留一列)', () => {
    // 四支靠「重放提早 RETURN」⇒ INSERT 一定在那個 RETURN 之後
    for (const func of [
      'admin_create_shipment',
      'admin_mark_shipment_shipped',
      'admin_void_shipment',
      'admin_unvoid_shipment',
    ]) {
      const body = bodyOf(func);
      const replayReturn = body.indexOf('IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;');
      const insertAt = body.indexOf('INSERT INTO public.admin_audit_log');
      expect(replayReturn, `${func} 少了重放提早 RETURN`).toBeGreaterThan(-1);
      expect(insertAt, `${func} 的稽核列排在重放 RETURN 之前 ⇒ 重放也會寫一列`).toBeGreaterThan(replayReturn);
    }
    // 掛品項那支的冪等在 impl 裡 ⇒ 只能靠信封的 idempotent 旗標
    const items = bodyOf('admin_add_shipment_items');
    expect(items, '掛品項沒有用 idempotent 旗標擋重放 ⇒ 按兩次會寫兩列').toContain("v_res ->> 'idempotent'");
  });
});

describe('TS 那一端:actor 只能來自 session, 不得來自 client', () => {
  it('🔴 五個呼叫端都傳 auth.actorId(不是 args 裡 client 送來的字串)', () => {
    // 建箱那支一次餵三個 writer ⇒ 至少 3 次;作廢 / 還原 / 標出貨各 1 次
    const hits = ACTIONS_SRC.match(/actor: auth\.actorId/g) ?? [];
    expect(hits.length, 'shipment-actions.ts 裡 actor: auth.actorId 的次數少於 6').toBeGreaterThanOrEqual(6);
    // 新竹叫車那條路也會標出貨 —— 漏接的話那些箱在稽核表裡是空白(typecheck 抓到過一次)
    expect(DISPATCH_SRC, '新竹叫車那條路沒把 actor 接上').toContain('actor: auth.actorId');
  });

  it('🔴 actor 不得從 client 送的 input / args 取', () => {
    expect(ACTIONS_SRC, 'actor 取自 client 送的物件 ⇒ 任何人都能冒名').not.toMatch(
      /actor: (input|args)\.[A-Za-z]*[Aa]ctor/,
    );
  });

  it('🔴 repository 五支都把 p_actor / p_request_id 送進 RPC', () => {
    expect((REPO_SRC.match(/p_actor: args\.actor/g) ?? []).length, 'p_actor 少於 5 支').toBeGreaterThanOrEqual(5);
    expect(
      (REPO_SRC.match(/p_request_id: args\.requestId/g) ?? []).length,
      'p_request_id 少於 5 支',
    ).toBeGreaterThanOrEqual(5);
  });

  it('🔴 `../audit/context` 必須走動態 import(頂層 import 會讓 client 元件整支炸)', () => {
    expect(ACTIONS_SRC, 'shipment-actions.ts 用了頂層 import ../audit/context').not.toMatch(
      /^import .*['"]\.\.\/audit\/context['"]/m,
    );
    expect(ACTIONS_SRC).toContain("await import('../audit/context')");
  });
});
