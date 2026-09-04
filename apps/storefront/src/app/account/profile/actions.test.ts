// @vitest-environment node
//
// updateProfileAction server action test(g-4a、Q1=B 拆後端;對應 codex k1 round1 修法)。
//
// 信任邊界 5 層覆蓋:
// 1. server session unauthorized → formError「請重新登入」
// 2. ProfileInput zod validation 失敗 → fieldErrors 逐欄
// 3. ProfileInput strip 未知欄(id/user_id/tier/wallet_balance 全不透傳 use-case;codex k1 Consider 3 多欄補強)
// 4. birthday '' → null normalize(codex k1 Critical 1:DB date 欄拒空字串、domain string|null 接受 null)
// 5. malformed input(非 object、zod issue path 為空)→ formError fallback 不無聲失敗(codex k1 Consider 3)
// 6. updateProfile DB error → formError「儲存失敗,請稍後再試」(不洩 Supabase 原始 error)
// 7. 成功 → { ok: true }(g-4b client 收 ok 後 setSaved)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateProfile = vi.fn();
const mockGetCustomerRepo = vi.fn();
const mockGetUser = vi.fn();
const mockCreateServerSupabaseClient = vi.fn();

vi.mock('@pcm/use-cases', () => ({
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));
vi.mock('@/lib/auth/composition', () => ({
  getCustomerRepo: () => mockGetCustomerRepo(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => mockCreateServerSupabaseClient(),
}));

// Import 動態,確保 mock 生效後再載入 SUT(server action)。
async function getSUT() {
  return (await import('./actions')).updateProfileAction;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateServerSupabaseClient.mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  });
  mockGetCustomerRepo.mockResolvedValue({ update: vi.fn() });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('updateProfileAction(g-4a server action)', () => {
  it('未登入 → formError「請重新登入」+ 不呼叫 updateProfile', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const action = await getSUT();
    const res = await action({ name: '王', phone: '0912345678', birthday: '1990-01-01' });
    expect(res).toEqual({ formError: '請重新登入' });
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('name 空 → fieldErrors.name「請填寫姓名」(zod min(1))', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const action = await getSUT();
    const res = await action({ name: '', phone: '', birthday: '' });
    expect(res.fieldErrors?.name).toBe('請填寫姓名');
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('malformed input(非 object)→ formError 不無聲失敗(codex k1 Consider 3)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const action = await getSUT();
    const res = await action('not-an-object' as unknown);
    // zod fail、但 issue path 可能在 root 或為空;不應回空 fieldErrors、應走 formError fallback
    if (res.fieldErrors && Object.keys(res.fieldErrors).length > 0) {
      // 若 zod 仍對 name 報 required、亦合理
      expect(res.fieldErrors.name).toBeTruthy();
    } else {
      expect(res.formError).toBe('請填寫必要欄位');
    }
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('strip 未知欄:tier/id/user_id/wallet_balance 全不透傳 use-case(codex k1 Consider 3)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const updateMock = vi.fn().mockResolvedValue({});
    mockGetCustomerRepo.mockResolvedValue({ update: updateMock });
    mockUpdateProfile.mockResolvedValue({ id: 'user-1' });
    const action = await getSUT();
    await action({
      name: '王',
      phone: '0912345678',
      birthday: '1990-01-01',
      // 攻擊面:client 偽造這些欄、ProfileInput zod 必 strip
      tier: 'premiumStore',
      id: 'attacker-id',
      user_id: 'attacker-uid',
      wallet_balance: 999999,
      // 🔴 `:573` 會員中心那一片新增的攻擊面:性別送【中文】而不是代碼。
      //    zod 的 refine 會擋它 ⇒ 這一發應該落 fieldErrors, 而不是透傳到 use-case。
      //    ⚠️ 而它與上面那幾個不同:tier/id 是【不該存在的欄】被 strip;
      //       gender 是【該存在的欄】而值不合法 ⇒ 走的是不同一條路。
      totalDeposit: 999999,
    } as unknown);
    expect(mockUpdateProfile).toHaveBeenCalledOnce();
    const [, currentUserId, patch] = mockUpdateProfile.mock.calls[0]!;
    expect(currentUserId).toBe('user-1'); // server session、非 input 的 id/user_id
    // 🔴🔴 **這一發沒送 `gender` ⇒ patch 裡【不該有】它** —— 2026-09-01 codex R1 must-fix:
    //    上一版 zod 是 `.default('')` ⇒ 欄位缺席會被補成 `''` ⇒ 再被轉成 `null`
    //    ⇒ **一個舊分頁送出一次個人資料, 就把使用者已經填好的性別清掉。**
    //    ⇒ 改成 `.optional()` 之後, 缺席 = key 不進 patch = DB 那一欄不動。
    //    📌 這一格現在多守一件事:**多出 `gender` 這個 key 就是資料遺失的訊號。**
    expect(Object.keys(patch).sort()).toEqual(['birthday', 'name', 'phone']);
    expect(patch).not.toHaveProperty('tier');
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('user_id');
    expect(patch).not.toHaveProperty('wallet_balance');
  });

  it('birthday 空字串 → null normalize(codex k1 Critical 1:DB date 欄拒 ""、domain string|null 接受 null)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockUpdateProfile.mockResolvedValue({});
    const action = await getSUT();
    await action({ name: '王', phone: '0912345678', birthday: '' });
    expect(mockUpdateProfile).toHaveBeenCalledOnce();
    const [, , patch] = mockUpdateProfile.mock.calls[0]!;
    expect(patch.birthday).toBeNull();
  });

  it('birthday 非空 → 原樣傳遞(YYYY-MM-DD 字串)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockUpdateProfile.mockResolvedValue({});
    const action = await getSUT();
    await action({ name: '王', phone: '0912345678', birthday: '1990-12-31' });
    const [, , patch] = mockUpdateProfile.mock.calls[0]!;
    expect(patch.birthday).toBe('1990-12-31');
  });

  // ⛔ ~~#197 phone 格式錯(非空、太短)→ fieldErrors.phone「手機格式不正確」~~
  // 🔴 **Sean 2026-09-04 拍甲作廢**(`⟦b4-PHONEREGEXSPLIT⟧`:同一支電話兩頁行為相反)。
  //    電話改成「跟地址頁一樣」= 只擋空、不驗格式。
  // ✅ 取代它的是這格:個資頁的電話是**選填**, 而放寬的是格式不是必填 —— 兩件事分開驗。
  it('🔴 拍甲之後:個資頁 +886 / 分機 / 短號都存得下(選填欄, 空也合法)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const action = await getSUT();
    for (const v of ['+886-912-345-678', '02-1234-5678 #12', '0911', '']) {
      mockUpdateProfile.mockClear();
      const res = await action({ name: '王', phone: v, birthday: '' });
      expect(res.fieldErrors?.phone, `擋掉了 ${JSON.stringify(v)}`).toBeUndefined();
      // 🔴 **「沒被擋」不等於「存得下」** —— R1 抓到:我原本只驗前者, 而標題說的是後者
      //    ⇒ 一個把 phone 從 patch 靜靜丟掉的實作照樣全綠。這裡驗【那個值真的送到 use-case】。
      // 🔵 use-case 簽章是 (repo, userId, patch) ⇒ patch 是第【三】個參數。
      //    我第一版把它當成第一個 ⇒ 斷言紅了 —— 而那個紅是【我的斷言形狀錯】不是碼錯, 修斷言不放寬它。
      expect(mockUpdateProfile.mock.calls.at(-1)?.[2], `${JSON.stringify(v)} 沒被送進 use-case`)
        .toEqual(expect.objectContaining({ phone: v }));
    }
  });

  it('#197 birthday 格式錯(非空、非 YYYY-MM-DD)→ fieldErrors.birthday「生日格式不正確」+ 不呼叫 updateProfile', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const action = await getSUT();
    const res = await action({ name: '王', phone: '', birthday: '1990/12/31' });
    expect(res.fieldErrors?.birthday).toBe('生日格式不正確');
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('updateProfile 拋 DB error → formError「儲存失敗,請稍後再試」+ 不洩 Supabase 原始 error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockUpdateProfile.mockRejectedValue(new Error('PostgresError: RLS policy violated'));
    const action = await getSUT();
    const res = await action({ name: '王', phone: '0912345678', birthday: '1990-01-01' });
    expect(res.formError).toBe('儲存失敗,請稍後再試');
    expect(res.formError).not.toContain('RLS');
    expect(res.formError).not.toContain('Postgres');
  });

  it('成功 → { ok: true }(g-4b client 收 ok 後 setSaved)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockUpdateProfile.mockResolvedValue({ id: 'user-1', name: '王' });
    const action = await getSUT();
    const res = await action({ name: '王', phone: '0912345678', birthday: '1990-01-01' });
    expect(res).toEqual({ ok: true });
  });

  it('phone 空 → 原樣傳遞 ""(domain string、DB text 接受、不必 normalize null)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockUpdateProfile.mockResolvedValue({});
    const action = await getSUT();
    await action({ name: '王', phone: '', birthday: '1990-01-01' });
    const [, , patch] = mockUpdateProfile.mock.calls[0]!;
    expect(patch.phone).toBe('');
  });

  // 🔴🔴 `:573` 會員中心那一片新增的攻擊面 —— 而它與上面那幾個【不同種】:
  //   `tier` / `id` 是【不該存在的欄】被 zod strip 掉;
  //   而 `gender` 是【該存在的欄】而值不合法 ⇒ 走的是 refine 那條路,落 fieldErrors。
  //   📌 兩者的失敗形狀不同:strip 是安靜地不見, refine 是逐欄紅字。
  it('🔴 性別送【中文】而不是代碼 ⇒ 落 fieldErrors, 不透傳 use-case', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGetCustomerRepo.mockResolvedValue({ update: vi.fn() });
    const action = await getSUT();
    const res = await action({
      name: '王',
      phone: '',
      birthday: '',
      gender: '男', // ← 顯示用的字, 不是值域
    } as unknown as Parameters<typeof action>[0]);
    expect(res.fieldErrors?.gender).toBe('性別選項不正確');
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  // 🟢 正對照 —— 沒有它, 上面那格在「任何 gender 都被擋」時也會綠。
  it('🟢 性別送代碼 ⇒ 過, 且 normalize 後進 patch', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGetCustomerRepo.mockResolvedValue({ update: vi.fn() });
    mockUpdateProfile.mockResolvedValue({ id: 'user-1' });
    const action = await getSUT();
    const res = await action({ name: '王', phone: '', birthday: '', gender: 'undisclosed' });
    expect(res.ok).toBe(true);
    const [, , patch] = mockUpdateProfile.mock.calls[0]!;
    expect(patch.gender).toBe('undisclosed');
  });

  // 🔵 而「不選擇」要變成 null, 不是空字串 —— DB 的 CHECK 不收 ''。
  it('🔵 性別空字串 ⇒ normalize 成 null(同 birthday 那條)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGetCustomerRepo.mockResolvedValue({ update: vi.fn() });
    mockUpdateProfile.mockResolvedValue({ id: 'user-1' });
    const action = await getSUT();
    await action({ name: '王', phone: '', birthday: '', gender: '' });
    const [, , patch] = mockUpdateProfile.mock.calls[0]!;
    expect(patch.gender).toBeNull();
  });
});
