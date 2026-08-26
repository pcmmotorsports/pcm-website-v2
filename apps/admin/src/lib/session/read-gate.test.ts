import { describe, expect, it } from 'vitest';
import { planStaffGate, type StaffGatePlan } from './read-gate';
import type { AdminSessionSub } from './session';

// B5-b 讀取閘分流的驗收格。
//
// 🔴 **每一格都要能回答「它在【不成立】的世界會不會印不同的東西」** ——
//    這一族最容易寫成恆綠:`planStaffGate` 幾乎不可能 throw,所以「沒紅」不等於「分對了」。
//    ⇒ 本檔一律斷言**整個回傳物件**(不是只斷言 `kind`),
//      因為「走到 fallback 那一支」與「走到 bootstrap 那一支」的 `kind` 是**同一個字**。
//      只比 `kind` ⇒ 兩個分支互換也全綠。`why` 那一欄就是為了讓它們分得開才存在的。

describe('B5-b′ · planStaffGate 的分流(簽票那一刻)', () => {
  it('[1] v:2 + kind=user ⇒ 要查名單,而 staffId 逐字帶出來', () => {
    expect(planStaffGate({ kind: 'user', staff_id: 'sean' })).toEqual<StaffGatePlan>({
      kind: 'require-active-staff',
      staffId: 'sean',
    });
  });

  it('[2] 🔴 v:2 + kind=fallback ⇒ 放行,而【不得】要求查名單', () => {
    // 規格 §7.1 逐字點名的壞世界①:一律呼叫 resolveStaff ⇒ fallback 連唯讀都進不去。
    expect(planStaffGate({ kind: 'fallback' })).toEqual<StaffGatePlan>({
      kind: 'allow',
      why: 'fallback',
    });
  });

  it('[3] 🔴 v:2 + kind=bootstrap ⇒ 放行,而它【不得】靜默走到 user 那一支', () => {
    expect(planStaffGate({ kind: 'bootstrap' })).toEqual<StaffGatePlan>({
      kind: 'allow',
      why: 'bootstrap',
    });
  });

  it('[R1] 回歸格:上游沒送身分(undefined)⇒ 放行 —— 它紅 = 本片弄壞了旗標關著時的現況', () => {
    expect(planStaffGate(undefined)).toEqual<StaffGatePlan>({
      kind: 'allow',
      why: 'no-identity',
    });
  });

  it('[4] 🔴 user 的 staff_id 是空字串 ⇒ 仍然走「要查名單」,不得放行', () => {
    // 空字串下游會被 resolveStaff 擋掉(`if (!id) return null`)⇒ 最終是擋。
    // 🔴 而**這裡不能自己判空**:判了就會有兩個地方決定同一件事,而它們會漂。
    expect(planStaffGate({ kind: 'user', staff_id: '' })).toEqual<StaffGatePlan>({
      kind: 'require-active-staff',
      staffId: '',
    });
  });

  it('[5] ✅ 正對照:不認得的 kind ⇒ fail-closed 走「要查名單」,不是放行', () => {
    // 型別上構造不出來(union 窮舉),所以手捏 —— 這一格守的是「日後加第四種變體」那一刻。
    const alien = { kind: 'martian' } as unknown as AdminSessionSub;
    const plan = planStaffGate(alien);
    expect(plan.kind).toBe('require-active-staff');
    // 🔴 而它給的是空 staffId ⇒ resolveStaff 一定回 null ⇒ 一定擋。
    expect(plan).toEqual<StaffGatePlan>({ kind: 'require-active-staff', staffId: '' });
  });

  // ⛔ ~~[6] 量具自檢:四種輸入沒有全部回同一個東西~~
  // 🔴 **2026-08-25 刪掉,codex 關卡2 nit —— 而它的理由值得留在這裡當墓碑。**
  //    我寫那一格的動機是「證明上面每一格不是恆綠」,而它做的只是**數四個回傳值互不相同**。
  //    ⇒ 把 `fallback` 與 `bootstrap` 兩支**對調**,四個結果**仍然互不相同** ⇒ 它照綠。
  //    ⇒ 📌 **一個為了防恆綠而寫的格,自己是恆綠的。**
  //    ⇒ 而真正在防恆綠的是 [1]-[5]:它們**逐格斷言整個回傳物件**(含 `why` 那一欄),
  //      兩支對調 ⇒ [2] 與 [3] 當場紅。**cardinality 檢查是那件事的影子,不是那件事。**
});
