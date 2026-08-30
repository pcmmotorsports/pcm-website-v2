// callback-event.seam.test.ts — 板 :395,補【三層 mock 鏈中間那個沒有人測的接縫】。
//
// 🔵🔵 **fable R3-F1(must-fix)。這支檔存在的理由要先讀完再看程式碼:**
// ```
// route.test.ts        ⇒ mock 掉 callback-event
// callback-event.test  ⇒ mock 掉 line-admin
// line-admin.test.ts   ⇒ 只 import authenticateLineUser
//                        （grep createAuthCallbackEventClient ⇒ 零命中）
// ⇒ ⇒ 🔴 三層都有測，而【中間那條接縫】兩側都沒碰到：
//        那支 factory 到底把什麼函式名、什麼參數,交給了 service_role client。
// ```
// 🔴 **而那個接縫壞掉的樣子,是這一片最壞的一種**:RPC 名字打錯一個字
//    ⇒ PostgREST 回 error ⇒ `callback-event.ts` 是 **fail-open** ⇒ 吞掉、只剩一句 console
//    ⇒ **DB 從此一列都沒有,而三綠全綠、登入完全正常。**
//    🔵 codex R5:那描述的是【補這支檔之前】的世界 —— 現在下面第一格會紅(實測:名字打錯一字 ⇒ 紅)。
//       留著是刻意的:它說明這支檔為什麼存在,不是在描述今天。
//    📌 那正是這張表本來要修的病(「查不到」被讀成「沒有人登入」),長在它自己的接線上。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { rpcSpy } = vi.hoisted(() => ({ rpcSpy: vi.fn() }));
// 🔴 這裡 mock 的是**最底層**的 service_role factory —— 本支檔要看的就是
//    `line-admin` 那道門【真的】往下送了什麼,所以它自己不能被 mock。
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: rpcSpy }),
}));
// line-admin 會 import 這兩支(它們與本測試無關,mock 掉避免拉進真的 supabase client)。
vi.mock('@pcm/adapters', () => ({ isEmailExistsError: () => false }));

import { createAuthCallbackEventClient } from './line-admin';

beforeEach(() => rpcSpy.mockReset().mockResolvedValue({ error: null }));
afterEach(() => vi.clearAllMocks());

describe('createAuthCallbackEventClient(板 :395 的那道窄門)', () => {
  it('🔴 RPC 名字逐字正確,而且是【門這一側】填的', async () => {
    await createAuthCallbackEventClient().record({
      p_provider: 'line',
      p_outcome: 'failure',
      p_reason_code: 'upstream_error',
    });
    // 這個字串必須與 migration 裡的函式名逐字相同。打錯一個字 = 上面檔頭講的那個安靜全滅。
    expect(rpcSpy).toHaveBeenCalledWith('record_auth_callback_event', {
      p_provider: 'line',
      p_outcome: 'failure',
      p_reason_code: 'upstream_error',
    });
  });

  it('🔴 呼叫端【換不掉】那個名字(codex R2-5:閉包要綁死名稱,不是只藏住 client)', async () => {
    const gate = createAuthCallbackEventClient() as unknown as Record<string, unknown>;
    // 門上只有 record 這一個方法 —— 沒有 rpc、沒有 from、沒有 auth。
    expect(Object.keys(gate)).toEqual(['record']);
    expect(gate.rpc).toBeUndefined();
    expect(gate.from).toBeUndefined();
    expect(gate.auth).toBeUndefined();
  });

  it('負對照:回傳值原樣往上傳(門不吃掉 error,fail-open 的判斷留給 callback-event)', async () => {
    rpcSpy.mockResolvedValue({ error: { code: '42883' } });
    const res = await createAuthCallbackEventClient().record({
      p_provider: 'line',
      p_outcome: 'success',
      p_reason_code: null,
    });
    expect(res).toEqual({ error: { code: '42883' } });
  });
});
