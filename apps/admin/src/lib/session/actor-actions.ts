'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
// 相對 import(非 @/):見 session/actor.ts 註解(vitest @ alias 指 storefront)。
import { resolveStaff } from '../staff';
import { ACTOR_COOKIE } from './actor';

// M-4a M0-S2「選人」server action(PRD §6.1 最小具名身分)。
// 🔴 臨時解 / 非授權邊界(見 session/actor.ts);SSO 收端上線後退場。

/**
 * 選具名身分並寫進 session cookie。
 * 非名單內 id 一律忽略(fail-closed;UI 只給名單選項)。
 */
export async function selectActorAction(formData: FormData): Promise<void> {
  const raw = formData.get('actorId');
  const staff = typeof raw === 'string' ? resolveStaff(raw) : null;
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
