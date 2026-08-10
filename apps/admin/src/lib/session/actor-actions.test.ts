import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// actor-actions.test.ts — #365 片③ 新增(本檔在此之前**零測試**)。
//
// 🔴 **為什麼這一支值得存在**:`actorId` 這顆值會被寫進 session cookie,而它正是
//    `admin_audit_log.actor` 的來源(建表 COMMENT `20260726120000:26-27` 逐字:
//    「id 是寫入 admin_audit_log.actor 的穩定 slug」)⇒ 讀錯一次,之後**所有**稽核列
//    都掛在錯的人頭上,而畫面上零徵兆。
//
// 🔴 **誠實邊界**:本檔測的是「哪一個 id 被寫進 cookie」與「讀不出恰一筆時什麼都不做」。
//    **不測**:cookie 的 Secure/httpOnly 屬性語意、`revalidatePath` 的實際快取效果、
//    以及 `resolveStaff` 自己的名單查詢(那支有 `actor.test.ts`)。
//    ⚠️ 本檔也**不主張** actor 是授權邊界 —— `session/actor.ts` 自陳它是使用者自選、
//    非授權邊界;這裡守的是**稽核歸屬的正確性**,不是權限。

const mocks = vi.hoisted(() => ({
  resolveStaff: vi.fn(),
  cookieSet: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../staff', () => ({ resolveStaff: mocks.resolveStaff }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.cookieSet }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { selectActorAction } from './actor-actions';
import { ACTOR_COOKIE, ACTOR_ID_FIELD } from './actor';
// #388:送出端的原始碼層守門要讀 `app/page.tsx`(理由見該格註解)。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../test-support/strip-comments';

beforeEach(() => {
  vi.clearAllMocks();
  // 名單內就回那個人;測試要構造「名單外」時再個別覆寫。
  mocks.resolveStaff.mockImplementation(async (id: string) =>
    id === 'sean' || id === 'staff_1' ? { id, label: id } : null,
  );
});
afterEach(() => {
  vi.clearAllMocks();
});

/** 寫進 cookie 的那顆 actor id(沒寫成功回 null)。 */
function writtenActor(): string | null {
  if (mocks.cookieSet.mock.calls.length === 0) return null;
  const [name, value] = mocks.cookieSet.mock.calls[0]!;
  expect(name).toBe(ACTOR_COOKIE);
  return value as string;
}

describe('selectActorAction — #365 actorId 走 getAll 恰一筆', () => {
  it('送一份名單內的 id → 寫進 cookie', async () => {
    const fd = new FormData();
    fd.set('actorId', 'sean');
    await selectActorAction(fd);
    expect(writtenActor()).toBe('sean');
  });

  it('🔴 送兩份 → 一個都不採用、cookie 完全不寫(舊行為:採第一筆)', async () => {
    const fd = new FormData();
    fd.append('actorId', 'sean');
    fd.append('actorId', 'staff_1');
    await selectActorAction(fd);
    // 突變:改回 `formData.get('actorId')` ⇒ 這格紅(會把身分設成 'sean')。
    expect(writtenActor()).toBeNull();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    // 🔴 連查名單都不該查:讀不出恰一筆就該在進 `resolveStaff` 之前結束。
    //    沒有這條,「先查再擋」的寫法也會讓上面兩格綠,而那種寫法把一顆讀壞的值
    //    送進了名單查詢(今天無害,但它是下一個人擴充時的現成入口)。
    expect(mocks.resolveStaff).not.toHaveBeenCalled();
  });

  it('🔴 送單一 File → 同樣什麼都不做(數量是 1,只數 length 的擋門會放行)', async () => {
    const fd = new FormData();
    fd.set('actorId', new File(['sean'], 'a.txt'));
    await selectActorAction(fd);
    expect(writtenActor()).toBeNull();
    expect(mocks.resolveStaff).not.toHaveBeenCalled();
  });

  it('名單外的 id → 什麼都不做(既有 fail-closed,本片沒動它)', async () => {
    const fd = new FormData();
    fd.set('actorId', 'not_a_staff');
    await selectActorAction(fd);
    expect(mocks.resolveStaff).toHaveBeenCalledWith('not_a_staff');
    expect(writtenActor()).toBeNull();
  });

  it('整個欄位沒送 → 什麼都不做', async () => {
    await selectActorAction(new FormData());
    expect(writtenActor()).toBeNull();
    expect(mocks.resolveStaff).not.toHaveBeenCalled();
  });
});

// ── #388:欄名 wire 契約(送出端與讀取端必須共用同一顆常數)──────────────────────────
//
// 🔴 **這個欄名打錯字的症狀是「什麼都沒發生」**:讀不到 ⇒ 靜默不寫 cookie ⇒ 操作者身分沒換,
//    而 typecheck / lint / 其餘測試全部看不到(兩邊各自都是合法字串)。
//    而這顆值最終是 `admin_audit_log.actor` 的來源 ⇒ 打錯字 = 稽核歸屬靜默斷線。
describe('#388 actorId 欄名 wire 契約', () => {
  it('🔴 欄名打錯 → 什麼都不做(這就是打錯字時的真實症狀,零紅燈)', async () => {
    const fd = new FormData();
    // 少一個字母的 typo:對 FormData 完全合法,對這支 action 等於「沒送」。
    fd.set('actorld', 'sean');
    await selectActorAction(fd);
    expect(writtenActor()).toBeNull();
    expect(mocks.resolveStaff).not.toHaveBeenCalled();

    // 正向對照:同樣的值用**正確欄名**送 ⇒ 寫得進去。
    // 沒有這條,「action 永遠不寫 cookie」的突變也會讓上面三條全綠。
    const ok = new FormData();
    ok.set(ACTOR_ID_FIELD, 'sean');
    await selectActorAction(ok);
    expect(writtenActor()).toBe('sean');
  });

  // 🔴 **為什麼是原始碼層而不是 render 測試**:render 出來的 `name` 屬性值,無論來自常數
  //    還是來自一個剛好同字的裸字面,**都是同一個字串** ⇒ render 測試對「有人把常數換回裸字面」
  //    完全分辨不出來。要釘住「兩端共用同一顆」只有原始碼層做得到。
  // ⚠️ 誠實邊界:本格擋的是「裸字面回流」,**擋不住**有人把常數本身改成錯的值
  //    (那會讓兩端一起改、行為一致)—— 那一面由上面那條行為測試 + 真人操作覆蓋。
  it('🔴 送出端不得出現裸字面欄名(改回裸字面 = 兩端各自漂移的入口)', () => {
    const pageSource = stripComments(
      readFileSync(fileURLToPath(new URL('../../app/page.tsx', import.meta.url)), 'utf8'),
    );
    // 正向對照:確定真的讀到那支檔、而且它就是掛 action 的那一支(否則整格恆真)。
    expect(pageSource).toContain('selectActorAction');
    expect(pageSource).toContain('ACTOR_ID_FIELD');
    expect(pageSource).not.toMatch(/['"]actorId['"]/);
  });
});
