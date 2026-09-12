import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  authorizeManagerMutation: vi.fn(),
  getRequestId: vi.fn(),
  listStaffRows: vi.fn(),
  createStaffViaRpc: vi.fn(),
  updateStaffProfileViaRpc: vi.fn(),
  setStaffActiveViaRpc: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('./session/authorize', () => ({
  authorizeAdminMutation: mocks.authorizeAdminMutation,
  authorizeManagerMutation: mocks.authorizeManagerMutation,
}));
vi.mock('./audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('./staff-repository', () => ({
  listStaffRows: mocks.listStaffRows,
  createStaffViaRpc: mocks.createStaffViaRpc,
  updateStaffProfileViaRpc: mocks.updateStaffProfileViaRpc,
  setStaffActiveViaRpc: mocks.setStaffActiveViaRpc,
}));
// ⛔ ~~vi.mock('./orders/order-repository')~~ **已刪** —— ⟦b4-MGR0-RPC⟧ 之後本檔那三支
//    action 不再自己寫稽核(它跟著寫入進了 RPC 的同一筆交易)⇒ 留著這個 mock 會讓
//    `expect(auditRecord).not.toHaveBeenCalled()` 變成**恆綠的空斷言**。
//    📌 稽核真的有寫、而且與名單同生共死, 是在拋棄式 PG 上驗的
//      (migration `20260912050000` 的 13 格情境 + 突變甲), 不是在這裡。
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import {
  createStaffAction,
  setStaffActiveAction,
  updateStaffProfileAction,
} from './staff-actions';

type StaffRow = {
  id: string;
  label: string;
  is_manager: boolean;
  is_active: boolean;
};

const SEAN: StaffRow = {
  id: 'sean',
  label: 'Sean(老闆)',
  is_manager: true,
  is_active: true,
};
const STAFF_1: StaffRow = {
  id: 'staff_1',
  label: '員工 1',
  is_manager: false,
  is_active: true,
};
const STAFF_2: StaffRow = {
  id: 'staff_2',
  label: '員工 2',
  is_manager: false,
  is_active: true,
};

function createForm(overrides: Record<string, string | null> = {}): FormData {
  const values: Record<string, string | null> = {
    id: 'staff_3',
    label: '員工 3',
    is_manager: 'on',
    ...overrides,
  };
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    if (value !== null) data.set(name, value);
  }
  return data;
}

function profileForm(overrides: Record<string, string | null> = {}): FormData {
  return createForm({ id: 'staff_1', label: '員工 1', ...overrides });
}

function activeForm(
  id = 'staff_1',
  isActive: 'true' | 'false' | string = 'false',
): FormData {
  const data = new FormData();
  data.set('id', id);
  data.set('is_active', isActive);
  return data;
}

async function expectRedirect(
  action: Promise<void>,
  code:
    | 'saved'
    | 'audit_failed'
    | 'notfound'
    | 'invalid'
    | 'denied'
    | 'error',
): Promise<void> {
  await expect(action).rejects.toThrow(
    `NEXT_REDIRECT:/settings/staff?r=${code}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  mocks.authorizeManagerMutation.mockResolvedValue({
    sid: 'sid-1',
    actorId: 'sean',
  });
  mocks.getRequestId.mockResolvedValue('req-1');
  mocks.listStaffRows.mockResolvedValue([SEAN, STAFF_1]);
  // 🔴 三支 RPC 的回值是 **outcome 信封**(`{ kind: 'ok', row }`), 不是裸列 ——
  //    `ok` 以外的三種(`duplicate` / `not_found` / `denied`)逐格在下面各自的測試裡餵。
  mocks.createStaffViaRpc.mockResolvedValue({
    kind: 'ok',
    row: { id: 'staff_3', label: '員工 3', is_manager: true, is_active: true },
  });
  mocks.updateStaffProfileViaRpc.mockImplementation(
    async (
      _actor: string,
      id: string,
      update: { label: string; is_manager: boolean },
    ) => ({ kind: 'ok', row: { ...(id === 'sean' ? SEAN : STAFF_1), ...update } }),
  );
  mocks.setStaffActiveViaRpc.mockImplementation(
    async (_actor: string, id: string, isActive: boolean) => ({
      kind: 'ok',
      row: { ...(id === 'sean' ? SEAN : STAFF_1), is_active: isActive },
    }),
  );
});

describe('staff actions — authorization and parser gates', () => {
  it('should redirect denied before any write when authorization fails', async () => {
    mocks.authorizeManagerMutation.mockResolvedValue(null);

    await expectRedirect(createStaffAction(createForm()), 'denied');
    expect(mocks.createStaffViaRpc).not.toHaveBeenCalled();
  });

  it('should reject an id that does not match the database check', async () => {
    await expectRedirect(
      createStaffAction(createForm({ id: 'STAFF-3' })),
      'invalid',
    );
    expect(mocks.createStaffViaRpc).not.toHaveBeenCalled();
  });

  it('should reject a profile label that is blank after trimming', async () => {
    await expectRedirect(
      updateStaffProfileAction(profileForm({ label: '   ' })),
      'invalid',
    );
    expect(mocks.updateStaffProfileViaRpc).not.toHaveBeenCalled();
  });

  it('should reject a non-canonical active direction', async () => {
    await expectRedirect(
      setStaffActiveAction(activeForm('staff_1', 'on')),
      'invalid',
    );
    expect(mocks.setStaffActiveViaRpc).not.toHaveBeenCalled();
  });
});

describe('staff actions — E8-A2 lockout gates', () => {
  it('should reject deactivating sean before reading rows even when many staff are active', async () => {
    mocks.authorizeManagerMutation.mockResolvedValue({
      sid: 'sid-1',
      actorId: 'staff_1',
    });
    mocks.listStaffRows.mockResolvedValue([SEAN, STAFF_1, STAFF_2]);

    await expectRedirect(
      setStaffActiveAction(activeForm('sean', 'false')),
      'invalid',
    );
    expect(mocks.listStaffRows).not.toHaveBeenCalled();
    expect(mocks.setStaffActiveViaRpc).not.toHaveBeenCalled();
  });

  it('should reject deactivating the last active staff in a reachable degraded row set', async () => {
    mocks.authorizeManagerMutation.mockResolvedValue({
      sid: 'sid-1',
      actorId: 'staff_1',
    });
    mocks.listStaffRows.mockResolvedValue([
      { ...SEAN, is_active: false },
      STAFF_1,
    ]);

    await expectRedirect(
      setStaffActiveAction(activeForm('staff_1', 'false')),
      'invalid',
    );
    expect(mocks.listStaffRows).toHaveBeenCalledOnce();
    expect(mocks.setStaffActiveViaRpc).not.toHaveBeenCalled();
  });

  it('should reject an actor deactivating themself', async () => {
    mocks.authorizeManagerMutation.mockResolvedValue({
      sid: 'sid-1',
      actorId: 'staff_1',
    });
    mocks.listStaffRows.mockResolvedValue([SEAN, STAFF_1]);

    await expectRedirect(
      setStaffActiveAction(activeForm('staff_1', 'false')),
      'invalid',
    );
    expect(mocks.setStaffActiveViaRpc).not.toHaveBeenCalled();
  });

  it('should map a duplicate staff id to invalid', async () => {
    mocks.createStaffViaRpc.mockResolvedValue({ kind: 'duplicate' });

    await expectRedirect(createStaffAction(createForm()), 'invalid');
  });

  it('should map a profile update that affects no row to notfound', async () => {
    mocks.updateStaffProfileViaRpc.mockResolvedValue({ kind: 'not_found' });

    await expectRedirect(
      updateStaffProfileAction(profileForm()),
      'notfound',
    );
  });
});

describe('⟦b4-MGR0-RPC⟧ 三支 action 走 RPC —— 參數與「誰決定稽核動作名」', () => {
  // 🔴 **本組守的是【接線】**:action 有沒有把對的東西交給對的那一支 RPC。
  //    ⚠️ **稽核那一列長什麼樣, 本檔【證不到】** —— 它在 DB 裡寫。
  //      那一半是在拋棄式 PG 上驗的(migration `20260912050000`:13 格情境逐格看稽核列,
  //      加上突變甲「稽核被擋 ⇒ 名單那一列一起回捲」)。
  //    📌 ⇒ 別在這裡加「稽核有沒有寫」的斷言:這一層看不到, 寫了也只是恆綠。

  it('🔴 create:actor 來自簽章票、request_id 一起帶下去', async () => {
    await expectRedirect(createStaffAction(createForm()), 'saved');

    expect(mocks.createStaffViaRpc).toHaveBeenCalledWith(
      'sean',
      { id: 'staff_3', label: '員工 3', is_manager: true },
      'req-1',
    );
  });

  it('🔴 profile:只交 label / is_manager —— **沒有 is_active**', async () => {
    await expectRedirect(
      updateStaffProfileAction(
        profileForm({ label: '王小明', is_manager: 'on' }),
      ),
      'saved',
    );

    expect(mocks.updateStaffProfileViaRpc).toHaveBeenCalledWith(
      'sean',
      'staff_1',
      { label: '王小明', is_manager: true },
      'req-1',
    );
    // 🔴 承重:第三個參數多一個 is_active ⇒ 舊表單值就能讓停用的人自行復活。
    const update = mocks.updateStaffProfileViaRpc.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(Object.keys(update).sort()).toEqual(['is_manager', 'label']);
  });

  it('🔴 set_active:只交那個布林 —— **reactivate / deactivate 的名字不是本檔決定的**', async () => {
    await expectRedirect(
      setStaffActiveAction(activeForm('staff_1', 'false')),
      'saved',
    );
    expect(mocks.setStaffActiveViaRpc).toHaveBeenLastCalledWith(
      'sean',
      'staff_1',
      false,
      'req-1',
    );

    vi.clearAllMocks();
    mocks.redirect.mockImplementation((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    });
    mocks.authorizeManagerMutation.mockResolvedValue({ sid: 'sid-2', actorId: 'sean' });
    mocks.getRequestId.mockResolvedValue('req-2');
    const inactive = { ...STAFF_1, is_active: false };
    mocks.listStaffRows.mockResolvedValue([SEAN, inactive]);
    mocks.setStaffActiveViaRpc.mockResolvedValue({ kind: 'ok', row: STAFF_1 });

    await expectRedirect(
      setStaffActiveAction(activeForm('staff_1', 'true')),
      'saved',
    );
    expect(mocks.setStaffActiveViaRpc).toHaveBeenLastCalledWith(
      'sean',
      'staff_1',
      true,
      'req-2',
    );
    // 🔵 稽核名由 RPC 依 p_is_active 自己選(`CASE WHEN p_is_active THEN reactivate ELSE deactivate`)
    //    ⇒ 名單改成什麼、紀錄就寫什麼, 兩者不可能對不上。本檔只證「那個布林有傳對」。
  });

  // ── 🔴 取代舊的 `audit_failed` 那一組 ───────────────────────────────────────
  //    ⛔ ~~「寫入成功之後稽核 throw ⇒ audit_failed」~~ **那個世界不存在了**:
  //    稽核與寫入同一筆交易 ⇒ 稽核掛掉的時候, 名單那一列也沒有被改。
  //    ⇒ 本檔改成證【RPC 說不行的三種說法各自對到哪個結果碼】。
  it.each([
    ['denied', { kind: 'denied' }, 'denied'],
    ['duplicate', { kind: 'duplicate' }, 'invalid'],
    ['not_found', { kind: 'not_found' }, 'notfound'],
  ])('🔴 create 的 RPC 回 %s ⇒ 結果碼 %s, 而且【不得 revalidate】', async (_k, outcome, code) => {
    mocks.createStaffViaRpc.mockResolvedValue(outcome);

    await expectRedirect(
      createStaffAction(createForm()),
      code as 'denied' | 'invalid' | 'notfound',
    );
    // 🔴 沒改到東西就不要叫頁面重新整理 —— 那會讓「沒成功」看起來像「成功了」。
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('🔴 RPC 自己 throw(形狀不對 / 連不上)⇒ error, 而且有記一行 log', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.createStaffViaRpc.mockRejectedValue(
      Object.assign(new Error('boom'), { code: '42883' }),
    );

    await expectRedirect(createStaffAction(createForm()), 'error');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('員工新增失敗'),
      expect.objectContaining({ request_id: 'req-1' }),
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('🔴 RPC 回 denied ⇒ 留一行 warn(app 閘放行而 DB 閘拒 = 值班要知道的訊號)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.createStaffViaRpc.mockResolvedValue({ kind: 'denied' });

    await expectRedirect(createStaffAction(createForm()), 'denied');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('app 閘已放行而 DB 閘拒'),
      expect.objectContaining({
        request_id: 'req-1',
        actor: 'sean',
        target_id: 'staff_3',
      }),
    );
    warnSpy.mockRestore();
  });

  it('🔴 負對照:成功那一條【不得】留那行 warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expectRedirect(createStaffAction(createForm()), 'saved');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('🔴 成功那一條才 revalidate(正對照 —— 否則上面那兩格恆綠)', async () => {
    await expectRedirect(createStaffAction(createForm()), 'saved');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings/staff');
  });
});

// ── ⟦b4-MGR0⟧ 管理者閘的接線(2026-08-28)────────────────────────────────────
//
// ⚠️ **本組斷言的是【接線】,不是閘的邏輯** —— 本檔 mock 掉了 `./session/authorize`,
//    所以這裡看不到 `isActiveManager` 對不對。閘自己的邏輯在
//    `session/authorize.test.ts`(針對【真的】 authorizeManagerMutation)與 `staff.test.ts`。
//    📌 少了那兩處, 本組會在「閘完全失效」之下【全綠】。
describe('⟦b4-MGR0⟧ 三支 staff mutation 都走管理者閘', () => {
  // 🔴 逐支各一發, 不可以只寫 create 那一支(R3)——
  //    下面 ⑦ 的接線斷言在兩種實作錯誤下【恆綠】:
  //      (a) 呼叫了閘而不看回傳值 ⇒ toHaveBeenCalled 照綠
  //      (b) 呼叫發生在【寫入之後】 ⇒ 照綠
  //    只有本組(拒絕 + 斷言 DB 零寫入)抓得到這兩種, 而它必須逐支都有。
  it('🔴 非管理者 ⇒ createStaffAction 回 denied,且【DB 零寫入】', async () => {
    mocks.authorizeManagerMutation.mockResolvedValue(null);
    await expectRedirect(createStaffAction(createForm()), 'denied');
    expect(mocks.createStaffViaRpc, '被拒了卻還是寫了 ⇒ 閘在寫入之後才問').not.toHaveBeenCalled();
  });

  it('🔴 非管理者 ⇒ updateStaffProfileAction 回 denied,且【DB 零寫入】', async () => {
    mocks.authorizeManagerMutation.mockResolvedValue(null);
    await expectRedirect(updateStaffProfileAction(profileForm()), 'denied');
    expect(mocks.updateStaffProfileViaRpc, '被拒了卻還是寫了 ⇒ 閘在寫入之後才問').not.toHaveBeenCalled();
  });

  it('🔴 非管理者 ⇒ setStaffActiveAction 回 denied,且【DB 零寫入】(Q5 = 乙)', async () => {
    // Sean 2026-08-28 拍乙才有這一格。甲之下這支不換閘 ⇒
    // 任何登入者都停用得了人, 也叫得醒一顆休眠的管理者。
    mocks.authorizeManagerMutation.mockResolvedValue(null);
    await expectRedirect(setStaffActiveAction(activeForm()), 'denied');
    expect(mocks.setStaffActiveViaRpc, '被拒了卻還是寫了 ⇒ 閘在寫入之後才問').not.toHaveBeenCalled();
  });

  // ⑦ 接線斷言 —— 有人把三支任一支改回舊閘 ⇒ 這三格【自動變紅】,
  //    不需要任何人記得去跑突變。
  //    ⚠️ **射程**:只涵蓋【今天這三支 action】。日後新增第四支 staff action 而用回舊閘
  //       ⇒ 零測試變紅。不要把它讀成「接線永久有守門」。
  it.each([
    ['createStaffAction', () => createStaffAction(createForm())],
    ['updateStaffProfileAction', () => updateStaffProfileAction(profileForm())],
    ['setStaffActiveAction', () => setStaffActiveAction(activeForm())],
  ])('⑦ %s 呼叫的是管理者閘,而【舊閘沒有被單獨呼叫】', async (_name, run) => {
    await run().catch(() => {});
    expect(mocks.authorizeManagerMutation, '沒走管理者閘 ⇒ 是不是被改回舊閘了?').toHaveBeenCalled();
    expect(
      mocks.authorizeAdminMutation,
      '直接呼叫了舊閘 ⇒ 這支 action 繞過了管理者查核',
    ).not.toHaveBeenCalled();
  });

  it('🔴 break-glass:不得把 sean 的管理者權限拿掉(拿掉 = 沒有人能再設定管理者)', async () => {
    await expectRedirect(
      updateStaffProfileAction(profileForm({ id: 'sean', label: 'Sean(老闆)', is_manager: null })),
      'invalid',
    );
    expect(mocks.updateStaffProfileViaRpc, 'sean 的管理者身分被拿掉了 ⇒ 這道閘會把自己鎖死')
      .not.toHaveBeenCalled();
  });
});
