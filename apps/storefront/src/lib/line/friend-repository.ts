import 'server-only';
// eslint-disable-next-line no-restricted-imports -- 受控例外(同 lib/auth/line-admin.ts 那道門的形狀;ADR-0005 §8):LINE webhook 沒有使用者 session、customers 的 line_* 三欄只有 service_role 有 UPDATE(20260914040000)⇒ 只能走 service_role;本檔 server-only、只被 api/line/webhook/route.ts 引用、不入 client bundle。
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// lib/line/friend-repository.ts — 寫 customers.line_friend_at 的唯一落點(S3)。
//
// 🔴 只 UPDATE、不 INSERT:找不到這個 LINE userId 的客人(還沒用 LINE 登入過)⇒ 忽略, 不建客人(主視窗裁)。
//    他之後登入時 S2 callback 會寫 line_user_id;那時他已經是好友, 而我們不會再收到 follow 事件 ⇒
//    📌 這是已知缺口:「先加好友、後登入」的人 line_friend_at 會是 NULL ⇒ 推不了。plan 沒排;codex R1 提的補法:
//    S2 callback 拿 access token 查 LINE Login `GET /friendship/v1/status`(profile scope 就夠, 多一次 API)。記在 commit body。
// 🔴🔴 亂序重送(codex R1 must-fix):LINE 官方明講 redelivery 可能亂序 ⇒ `follow(t1) → unfollow(t2) → 重送 follow(t1)`
//    若無條件寫, 已退的人會被寫回好友。⇒ 條件更新:只在 `line_friend_event_at IS NULL OR <= 這個事件的時刻` 才寫,
//    並把事件時刻存進 `line_friend_event_at`。條件在 DB 一發 UPDATE 裡評估(原子), 不是先讀再寫。
//    同一事件重送 ⇒ `<=` 成立 ⇒ 寫同一個值(冪等);更舊的事件 ⇒ 0 列 ⇒ `skipped`。

type LooseClient = {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(col: string, value: string): {
        or(filters: string): {
          select(cols: string): Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
};

/** `updated` = 寫了;`skipped` = 沒有客人綁這個 LINE id, 或這個事件比已套用的更舊(兩者都不算錯, 不重試)。 */
export type SetLineFriendResult = 'updated' | 'skipped';

/**
 * @param friendAt follow ⇒ 事件時刻;unfollow ⇒ null。
 * @param eventAt 事件時刻(ISO;兩種事件都有)—— 亂序判準 + 冪等鍵。
 */
export async function setLineFriendAt(lineUserId: string, friendAt: string | null, eventAt: string): Promise<SetLineFriendResult> {
  const client = createSupabaseServiceClient() as unknown as LooseClient;
  const { data, error } = await client
    .from('customers')
    .update({ line_friend_at: friendAt, line_friend_event_at: eventAt })
    .eq('line_user_id', lineUserId)
    // PostgREST 的 or 濾語法:`col.is.null,col.lte.<value>`;eventAt 是我們自己算的 ISO(不是外部字串)。
    .or(`line_friend_event_at.is.null,line_friend_event_at.lte.${eventAt}`)
    .select('user_id');
  if (error) throw error;
  return Array.isArray(data) && data.length > 0 ? 'updated' : 'skipped';
}
