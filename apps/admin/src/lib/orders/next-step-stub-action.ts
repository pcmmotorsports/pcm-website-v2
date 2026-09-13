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

import { authorizeAdminMutation } from '../session/authorize';

// 🔴 **兩支 stub 都先過 `authorizeAdminMutation()`,再 throw**(施工窗 2026-09-13 補,合進來時
//    `server-action-guard-sweep.test.ts` 當場紅:「每一支 server action 都要有 authorize*Mutation」)。
//    ⚠️ 不走白名單:那份白名單逐字「不准出現『暫時』」—— 一支 P-e-3 就要換掉的 stub 正是「暫時」。
//    ⇒ 直接守。一支「先驗身分、再說沒接線」的 stub,跟真 action 的形狀一致,P-e-3 換掉時零殘留。
//    📌 而它也擋住一個真的洞:沒有它,任何人不用登入就能打到這支 action —— 它只 throw,今天沒事;
//       但「沒事」是因為它裡面沒東西,不是因為它有門。

/** 與 `useActionState` 的 `(prev, formData) => Promise<state>` 同形;回 `never` 讓它可塞進任何 state 型別。 */
export async function nextStepStubAction(_prev: unknown, _formData: FormData): Promise<never> {
  await authorizeAdminMutation();
  throw new Error('P-e-3 未接線:列表「下一步」彈窗的送出還沒接到真的 action');
}

/** 出貨彈窗那條不是 form action,是 client 端直接呼叫 `submitShipment(input)` ⇒ 同一個 stub 再給一個同形的入口。 */
export async function nextStepStubSubmit(_input: unknown): Promise<never> {
  await authorizeAdminMutation();
  throw new Error('P-e-3 未接線:列表「下一步」彈窗的送出還沒接到真的 action');
}
