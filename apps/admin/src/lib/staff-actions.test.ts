import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
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
  mocks.authorizeAdminMutation.mockResolvedValue({
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
    mocks.authorizeAdminMutation.mockResolvedValue(null);

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
    mocks.authorizeAdminMutation.mockResolvedValue({
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
    mocks.authorizeAdminMutation.mockResolvedValue({
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
    mocks.authorizeAdminMutation.mockResolvedValue({
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
    mocks.authorizeAdminMutation.mockResolvedValue({
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
