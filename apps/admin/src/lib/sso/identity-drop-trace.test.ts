import { describe, expect, it } from 'vitest';

import { identityDropTrace } from './identity-drop-trace';

// identity-drop-trace.test.ts — 三個世界,而**第三個是最容易被漏掉的那個**。
//
// 🔴 驗收(主視窗 2026-08-23 裁定,第 ③ 條是他加的):
//   ① 上游沒送 sub                 ⇒ 安靜   (今天的每一次登入;該綠要真的綠)
//   ② 上游送了而我們沒接           ⇒ 出聲,而**那句話要指名 `sub`**
//   ③ 上游送了而我們【接好了】     ⇒ 又安靜  (沒有這條, 就是一道 B5-a 做完後永遠紅著的閘)

const SUB = { kind: 'user', staff_id: 's-1' };
const naked = { requestId: 'r1', amr: ['pwd'] };
// 🔴 **兩本帳的欄名不同,所以 fixture 也要是兩個** —— 用同一個「已接好」物件餵兩本帳,
//    等於預設它們同名,而 codex must-fix 3 抓到的正是那個假設。
const wiredSession = { requestId: 'r1', amr: ['pwd'], sub: SUB };
const wiredEvent = { requestId: 'r1', amr: ['pwd'], staff_id: 's-1' };

describe('identityDropTrace — 三個世界', () => {
  it('① 上游沒送 sub ⇒ null(安靜)', () => {
    expect(identityDropTrace(undefined, [{ name: 'session cookie', payload: naked, identityKey: 'sub' }])).toBeNull();
  });

  it('② 上游送了而兩本帳都沒帶 ⇒ 出聲,且指名 sub 與【每一本】漏掉的帳', () => {
    const msg = identityDropTrace(SUB, [
      { name: 'session cookie', payload: naked, identityKey: 'sub' },
      { name: 'admin_sso_login_events', payload: naked, identityKey: 'staff_id' },
    ]);
    expect(msg).not.toBeNull();
    expect(msg).toContain('sub'); // 🔴 驗收明寫「紅的那一行 log 要指名 sub」
    expect(msg).toContain('session cookie');
    expect(msg).toContain('admin_sso_login_events');
  });

  it('③ 上游送了而兩本帳都帶到了 ⇒ null(B5-a 之後它自己退場,不用有人回來刪)', () => {
    expect(
      identityDropTrace(SUB, [
        { name: 'session cookie', payload: wiredSession, identityKey: 'sub' },
        { name: 'admin_sso_login_events', payload: wiredEvent, identityKey: 'staff_id' },
      ]),
    ).toBeNull();
  });

  it('🔴 只接好一半 ⇒ 仍然出聲,而且【只點名沒接的那一本】', () => {
    const msg = identityDropTrace(SUB, [
      { name: 'session cookie', payload: wiredSession, identityKey: 'sub' },
      { name: 'admin_sso_login_events', payload: naked, identityKey: 'staff_id' },
    ]);
    expect(msg).toContain('admin_sso_login_events');
    expect(msg).not.toContain('session cookie'); // 接好的那本不該被誣賴
  });

  it('每本帳認【它自己那個】欄名(兩本帳欄名不同)', () => {
    const alt = { requestId: 'r1', staff_id: 's-1' };
    expect(identityDropTrace(SUB, [{ name: 'admin_sso_login_events', payload: alt, identityKey: 'staff_id' }])).toBeNull();
  });

  // 🔴 codex 2026-08-23 must-fix 3 的證據格:舊判準只問「sub 或 staff_id 任一個在不在」
  //    ⇒ **兩欄放反也會被判成「都接好了」**,而兩邊的欄位其實都是錯的。
  it('🔴 兩欄【放反】⇒ 兩本帳都要出聲(舊判準會安靜)', () => {
    const msg = identityDropTrace(SUB, [
      { name: 'session cookie', payload: { staff_id: 's-1' }, identityKey: 'sub' },
      { name: 'admin_sso_login_events', payload: { sub: SUB }, identityKey: 'staff_id' },
    ]);
    expect(msg).not.toBeNull();
    expect(msg).toContain('session cookie');
    expect(msg).toContain('admin_sso_login_events');
  });

  // 🔴 codex R5 must-fix 4:`null` 曾經被判成「已帶到」⇒ 函式安靜退場,
  //    而簽出去的 session 仍然沒有可用身分。**null 是「帶到了一個空的」,不是「帶到了」。**
  it('🔴 carrier 的欄位是 null / 空字串 ⇒ 仍算【沒帶到】,要出聲', () => {
    for (const empty of [null, '']) {
      const msg = identityDropTrace(SUB, [
        { name: 'session cookie', payload: { sub: empty }, identityKey: 'sub' },
      ]);
      expect(msg, `payload.sub = ${JSON.stringify(empty)} 被當成已帶到了`).not.toBeNull();
      expect(msg).toContain('session cookie');
    }
    // ✅ 正對照:真的帶到一個有值的 ⇒ 還是要安靜(否則上面用「永遠出聲」也會過)
    expect(
      identityDropTrace(SUB, [{ name: 'session cookie', payload: { sub: SUB }, identityKey: 'sub' }]),
    ).toBeNull();
  });

  it('⚠️ 天花板:空清單恆綠 —— 保護力在呼叫端,不在本函式', () => {
    // 🔴 **這一格【不是】守門,它是一個天花板的紀錄。**(原本的格名寫成「正對照:…不得…而安靜」,
    //    而斷言是 `toBeNull()` = 就是安靜 ⇒ **名字與斷言字面相反**,而掃格名的人會讀成「空清單有守」。)
    //    空清單 ⇒ 沒有人漏掉 ⇒ 回 null。邏輯上對,而它在**任何改動下都不會轉紅**。
    //    ⇒ 呼叫端忘了傳載體,本函式會永遠安靜 —— **那道防線在呼叫端,不在這裡。**
    expect(identityDropTrace(SUB, [])).toBeNull();
  });

  // 🔴 4. 這一行會進 Vercel log ⇒ **它不得帶 PII**。
  //    隔壁 `lib/sso/login-event.ts` 為同一件事寫過整段:「接住了就會有人順手把它印出來」。
  //    ⇒ 下一個人為了除錯加一個 `${JSON.stringify(subFromUpstream)}`,**全綠**。這一格擋那個。
  it('🔴 那一行【不得】把 sub 的內容印出來(只准講「哪一本帳漏了」)', () => {
    const msg = identityDropTrace({ kind: 'user', staff_id: 'sean-secret-id' }, [
      { name: 'session cookie', payload: naked, identityKey: 'sub' },
    ]);
    expect(msg).not.toBeNull();
    expect(msg).not.toContain('sean-secret-id');
    expect(msg).not.toContain('staff_id');
    // ✅ 正對照:該講的還是要講到,否則「什麼都不印」也會過這一格
    expect(msg).toContain('sub');
    expect(msg).toContain('session cookie');
  });
});
