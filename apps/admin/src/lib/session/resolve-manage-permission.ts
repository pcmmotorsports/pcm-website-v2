import 'server-only';
import { getStaffRowById } from '../staff-repository';
import { getSessionActorIdWithSource } from './actor';
import type { ManagePermission } from './manage-permission';

// resolve-manage-permission.ts — 「這個人是不是在職管理者」的三態, server 端判一次(給畫面決定看不看得到鈕)。
// 🔴 從 order-detail-route.tsx 抽出來(2026-09-16 第 13 件:供應商設定頁也要同一個判準)——
//    兩處各寫一份的話, 哪天一邊改成「讀不到當 no」另一邊沒跟, 同一個人在兩個畫面上的權限就不一樣。
// 🛑 這三態不是安全邊界 —— 擋得住的是 server action 的 authorizeManagerMutation() 與 DB 的管理者閘。
//
// · 票上沒有具名身分 ⇒ 'no'(確定的事實, 一次 DB 都不打;server 那道閘也會拒他 ⇒ 畫面與閘一致)
// · 查到在職且 is_manager ⇒ 'yes';查到但不是 / 查不到那一列 ⇒ 'no'
// · 查核本身炸了 ⇒ 'unknown'(我們不知道;不能當 'no' —— 真的管理者會以為自己被降權而畫面沒字告訴他)
export async function resolveManagePermission(logTag: string): Promise<ManagePermission> {
  try {
    const { id: actorId } = await getSessionActorIdWithSource();
    if (actorId === null) return 'no';
    const row = await getStaffRowById(actorId);
    return row?.is_active === true && row.is_manager === true ? 'yes' : 'no';
  } catch (error) {
    console.error(logTag, error);
    return 'unknown';
  }
}
