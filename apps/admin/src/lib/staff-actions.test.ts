import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  authorizeManagerMutation: vi.fn(),
  getRequestId: vi.fn(),
  listStaffRows: vi.fn(),
  insertStaffRow: vi.fn(),
  updateStaffProfileRow: vi.fn(),
  setStaffActiveRow: vi.fn(),
  auditRecord: vi.fn(),
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
  insertStaffRow: mocks.insertStaffRow,
  updateStaffProfileRow: mocks.updateStaffProfileRow,
  setStaffActiveRow: mocks.setStaffActiveRow,
}));
vi.mock('./orders/order-repository', () => ({
  getAdminAuditLogRepository: () => ({ record: mocks.auditRecord }),
}));
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
  mocks.insertStaffRow.mockResolvedValue({
    id: 'staff_3',
    label: '員工 3',
    is_manager: true,
    is_active: true,
  });
  mocks.updateStaffProfileRow.mockImplementation(
    async (
      id: string,
      update: { label: string; is_manager: boolean },
    ) => ({
      ...(id === 'sean' ? SEAN : STAFF_1),
      ...update,
    }),
  );
  mocks.setStaffActiveRow.mockImplementation(
    async (id: string, isActive: boolean) => ({
      ...(id === 'sean' ? SEAN : STAFF_1),
      is_active: isActive,
    }),
  );
});

describe('staff actions — authorization and parser gates', () => {
  it('should redirect denied before any write when authorization fails', async () => {
    mocks.authorizeManagerMutation.mockResolvedValue(null);

    await expectRedirect(createStaffAction(createForm()), 'denied');
    expect(mocks.insertStaffRow).not.toHaveBeenCalled();
  });

  it('should reject an id that does not match the database check', async () => {
    await expectRedirect(
      createStaffAction(createForm({ id: 'STAFF-3' })),
      'invalid',
    );
    expect(mocks.insertStaffRow).not.toHaveBeenCalled();
  });

  it('should reject a profile label that is blank after trimming', async () => {
    await expectRedirect(
      updateStaffProfileAction(profileForm({ label: '   ' })),
      'invalid',
    );
    expect(mocks.updateStaffProfileRow).not.toHaveBeenCalled();
  });

  it('should reject a non-canonical active direction', async () => {
    await expectRedirect(
      setStaffActiveAction(activeForm('staff_1', 'on')),
      'invalid',
    );
    expect(mocks.setStaffActiveRow).not.toHaveBeenCalled();
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
    expect(mocks.setStaffActiveRow).not.toHaveBeenCalled();
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
    expect(mocks.setStaffActiveRow).not.toHaveBeenCalled();
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
    expect(mocks.setStaffActiveRow).not.toHaveBeenCalled();
  });

  it('should map a duplicate staff id to invalid', async () => {
    mocks.insertStaffRow.mockResolvedValue('DUPLICATE');

    await expectRedirect(createStaffAction(createForm()), 'invalid');
    expect(mocks.auditRecord).not.toHaveBeenCalled();
  });

  it('should map a profile update that affects no row to notfound', async () => {
    mocks.updateStaffProfileRow.mockResolvedValue(null);

    await expectRedirect(
      updateStaffProfileAction(profileForm()),
      'notfound',
    );
    expect(mocks.auditRecord).not.toHaveBeenCalled();
  });
});

describe('staff actions — separate writes and audit trail', () => {
  it('should audit a create with the module action constant and after snapshot', async () => {
    await expectRedirect(createStaffAction(createForm()), 'saved');

    expect(mocks.auditRecord).toHaveBeenCalledWith(
      {
        action: 'settings.staff.create',
        target: 'staff:staff_3',
        after: {
          id: 'staff_3',
          label: '員工 3',
          is_manager: true,
          is_active: true,
        },
      },
      { actor: 'sean', requestId: 'req-1', sourceApp: 'admin' },
    );
  });

  it('should update only profile fields and use settings.staff.update', async () => {
    mocks.updateStaffProfileRow.mockResolvedValue({
      ...STAFF_1,
      label: '王小明',
      is_manager: true,
    });

    await expectRedirect(
      updateStaffProfileAction(
        profileForm({ label: '王小明', is_manager: 'on' }),
      ),
      'saved',
    );

    expect(mocks.updateStaffProfileRow).toHaveBeenCalledWith('staff_1', {
      label: '王小明',
      is_manager: true,
    });
    expect(mocks.auditRecord).toHaveBeenCalledWith(
      {
        action: 'settings.staff.update',
        target: 'staff:staff_1',
        before: STAFF_1,
        after: {
          ...STAFF_1,
          label: '王小明',
          is_manager: true,
        },
      },
      { actor: 'sean', requestId: 'req-1', sourceApp: 'admin' },
    );
  });

  it('should use deactivate and reactivate audit actions for active writes', async () => {
    mocks.setStaffActiveRow.mockResolvedValue({
      ...STAFF_1,
      is_active: false,
    });

    await expectRedirect(
      setStaffActiveAction(activeForm('staff_1', 'false')),
      'saved',
    );
    expect(mocks.setStaffActiveRow).toHaveBeenLastCalledWith(
      'staff_1',
      false,
    );
    expect(mocks.auditRecord).toHaveBeenLastCalledWith(
      {
        action: 'settings.staff.deactivate',
        target: 'staff:staff_1',
        before: STAFF_1,
        after: { ...STAFF_1, is_active: false },
      },
      { actor: 'sean', requestId: 'req-1', sourceApp: 'admin' },
    );

    vi.clearAllMocks();
    mocks.authorizeManagerMutation.mockResolvedValue({
      sid: 'sid-2',
      actorId: 'sean',
    });
    mocks.getRequestId.mockResolvedValue('req-2');
    const inactive = { ...STAFF_1, is_active: false };
    mocks.listStaffRows.mockResolvedValue([SEAN, inactive]);
    mocks.setStaffActiveRow.mockResolvedValue(STAFF_1);

    await expectRedirect(
      setStaffActiveAction(activeForm('staff_1', 'true')),
      'saved',
    );
    expect(mocks.setStaffActiveRow).toHaveBeenLastCalledWith(
      'staff_1',
      true,
    );
    expect(mocks.auditRecord).toHaveBeenLastCalledWith(
      {
        action: 'settings.staff.reactivate',
        target: 'staff:staff_1',
        before: inactive,
        after: STAFF_1,
      },
      { actor: 'sean', requestId: 'req-2', sourceApp: 'admin' },
    );
  });

  it.each([
    [
      'create',
      () => createStaffAction(createForm()),
      () => mocks.insertStaffRow,
    ],
    [
      'profile',
      () => updateStaffProfileAction(profileForm()),
      () => mocks.updateStaffProfileRow,
    ],
    [
      'active',
      () => setStaffActiveAction(activeForm('staff_1', 'false')),
      () => mocks.setStaffActiveRow,
    ],
  ])(
    'should return audit_failed after a successful %s write when audit throws',
    async (_kind, invoke, getWriteMock) => {
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      mocks.auditRecord.mockRejectedValue(new Error('audit unavailable'));

      await expectRedirect(invoke(), 'audit_failed');

      expect(getWriteMock()).toHaveBeenCalledOnce();
      expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings/staff');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('稽核寫入失敗'),
        expect.objectContaining({ request_id: 'req-1' }),
      );
      errorSpy.mockRestore();
    },
  );
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
    expect(mocks.insertStaffRow, '被拒了卻還是寫了 ⇒ 閘在寫入之後才問').not.toHaveBeenCalled();
    expect(mocks.auditRecord).not.toHaveBeenCalled();
  });

  it('🔴 非管理者 ⇒ updateStaffProfileAction 回 denied,且【DB 零寫入】', async () => {
    mocks.authorizeManagerMutation.mockResolvedValue(null);
    await expectRedirect(updateStaffProfileAction(profileForm()), 'denied');
    expect(mocks.updateStaffProfileRow, '被拒了卻還是寫了 ⇒ 閘在寫入之後才問').not.toHaveBeenCalled();
    expect(mocks.auditRecord).not.toHaveBeenCalled();
  });

  it('🔴 非管理者 ⇒ setStaffActiveAction 回 denied,且【DB 零寫入】(Q5 = 乙)', async () => {
    // Sean 2026-08-28 拍乙才有這一格。甲之下這支不換閘 ⇒
    // 任何登入者都停用得了人, 也叫得醒一顆休眠的管理者。
    mocks.authorizeManagerMutation.mockResolvedValue(null);
    await expectRedirect(setStaffActiveAction(activeForm()), 'denied');
    expect(mocks.setStaffActiveRow, '被拒了卻還是寫了 ⇒ 閘在寫入之後才問').not.toHaveBeenCalled();
    expect(mocks.auditRecord).not.toHaveBeenCalled();
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
    expect(mocks.updateStaffProfileRow, 'sean 的管理者身分被拿掉了 ⇒ 這道閘會把自己鎖死')
      .not.toHaveBeenCalled();
  });
});
