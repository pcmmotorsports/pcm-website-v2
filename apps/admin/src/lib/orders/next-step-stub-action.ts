'use server';

// next-step-stub-action.ts — P-e-2(2026-09-13):列表「下一步」彈窗在【接線之前】用的假 action。
//
// 🔴🔴 **`?next=<單號>&do=<動作>` 打開的是【表單】,不是動作。** 貼一個網址不會寫進任何東西;
//    寫入只發生在他按下「確認」那一刻 —— 而在 P-e-3 接線之前,**連那一刻也不寫**。
//    (`docs/plans/2026-09-13-next-step-button-write-plan.md` §0)
//
// 🔴 為什麼是 throw 而不是回一個 `ok:false` 的 state:
//    回 state 的話,畫面會印一句看起來像「系統擋了你」的話,員工會回報成 bug;
//    throw 讓它在開發期**當場炸給做的人看**,而正式站永遠不該走到這裡(接線 = 把這支從 body 拿掉)。
// 🔴 守門在 `next-step-bodies.test.ts`:三支 body **只准** import 本支,**不准** import 真的 action;
//    突變:把 body 裡的 stub 換成真 action ⇒ 那支測試要紅。

/** 與 `useActionState` 的 `(prev, formData) => Promise<state>` 同形;回 `never` 讓它可塞進任何 state 型別。 */
export async function nextStepStubAction(_prev: unknown, _formData: FormData): Promise<never> {
  throw new Error('P-e-3 未接線:列表「下一步」彈窗的送出還沒接到真的 action');
}
