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
