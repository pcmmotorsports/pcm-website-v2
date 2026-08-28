'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
// 相對 import(非 @/):#606 前的歷史遺留,見 session/actor.ts 註解(#612 更新:#606 起可用 @/,既有不回改)。
// #365 片③:單值欄位的唯一讀法。
import { readSingleString } from '../forms/single-value';
import { resolveStaff } from '../staff';
import { ACTOR_COOKIE, ACTOR_ID_FIELD } from './actor';

// M-4a M0-S2「選人」server action(PRD §6.1 最小具名身分)。
// 🔴 使用者自行選擇 / 非授權邊界(見 session/actor.ts);真實身分驗證接上後退場。
//
// 🔴🔴 **⟦b4-MGR0-COPY⟧ 2026-08-29 線F:上面那句今天仍然為真,而它【不再是全部】。**
//    B5-a 之後身分**依票而定**(`session/actor.ts` 錨 `getSessionActorWithSource` 的三層)——
//    這支 action 本身沒變(它永遠只寫那顆自選 cookie),**變的是【有沒有人會去讀它】**。
//
// 🔴 **而這裡有一個【寫得成功而完全沒有效果】的世界,值得寫在本檔而不是只寫在讀取端**:
//    `source` 是 `none`(共用密碼 / 首次建置登入)或 `stale-ticket`(真實身分閘開著而票是舊的)時,
//    讀取端在**更上游**就回 `null` 了 ⇒ **`ACTOR_COOKIE` 一個字都不會被讀。**
//    ⇒ 而下面這支照樣 `store.set(...)` + `revalidatePath('/')` ⇒ **回傳成功、畫面照刷新**
//      ⇒ 📌 **員工按下去看起來就像成功了, 而他的身分一個字都沒變。**
//    ⚠️ **本片刻意【不在這裡擋】** —— 在 action 裡擋等於改行為(而且要它自己再算一次三層);
//      首頁那兩個世界的文案已經明說「選了不會生效」(`app/page.tsx` 錨 `ACTOR_SOURCE_COPY`)。
//      **要不要把那顆選單停用是 UI 決策 ⇒ Sean 的地盤**,已進累積表 `Q-PICKER-DEAD`。

/**
 * 選具名身分並寫進 session cookie。
 * 非名單內 id 一律忽略(fail-closed;UI 只給名單選項)。
 */
export async function selectActorAction(formData: FormData): Promise<void> {
  // 🔴 #365 片③:`getAll()` 恰一筆。送兩份時舊碼採第一筆 ⇒ **把 session 的具名身分設成
  //    其中一個**,而這顆 id 正是寫進 `admin_audit_log.actor` 的那顆(建表 COMMENT
  //    `20260726120000:26-27` 逐字)⇒ 之後所有稽核列都掛在錯的人頭上,且畫面零徵兆。
  //    讀不出恰一筆 ⇒ 走本函式既有的 fail-closed 出口(什麼都不做、不寫 cookie)。
  const raw = readSingleString(formData, ACTOR_ID_FIELD);
  const staff = raw === null ? null : await resolveStaff(raw);
  if (!staff) return;

  const store = await cookies();
  store.set(ACTOR_COOKIE, staff.id, {
    httpOnly: true,
    sameSite: 'lax',
    // 生產走 https 才加 Secure;本機 dev(http)不加、否則 cookie 設不進去。
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  revalidatePath('/');
}
