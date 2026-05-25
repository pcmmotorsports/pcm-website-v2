// lib/auth/line-admin.ts — LINE OAuth 的 Supabase Admin API 封裝(M-1-14e-f2-a2、service_role 受控小門)
//
// ⚠️⚠️ service_role 受控例外(Sean 2026-05-25 Q1=A 拍板 + ADR-0005 §8 記錄):
//   ADR-0005 §6/§7 與 eslint.config.js 規定 storefront 不得 import @pcm/adapters/server(service_role)。
//   LINE 自寫 OAuth 的 Admin API(createUser / generateLink)**無 anon 替代**、且 callback 須同源才寫得到 session
//   cookie(搬 apps/api 跨源不可行、見決策1 選項 B)。故本檔為 storefront 首個 service_role 受控小門:
//   - `import 'server-only'` 編譯期擋 client 引入;僅 /api/auth/line/callback route(server-only、runtime='nodejs')引用。
//   - service_role 鎖死本檔、不外擴;build 後 grep client chunk 應 0 命中 SUPABASE_SERVICE_ROLE_KEY(關卡2 驗)。
//   - 既有 composition.ts 例外註解「永不 import createSupabaseServiceClient」僅約束該檔(anon adapter 注入),
//     不涵蓋本檔;本檔是經 Sean 拍板 + ADR 記錄的新例外、範圍極窄(只 LINE OAuth)。
//
// 併帳安全(Q2=A + codex 關卡1 finding-2 + 關卡2 must-fix-1):line_user_id(OIDC sub)為唯一身分鍵、
//   合成 email 命名空間隔離;合成 email 撞 already-registered 時、**必驗既有 user 的 app_metadata** 才放行。
//   ⚠️ 身分鍵存 **app_metadata(service_role-only、公開 signUp 無法寫)**、不存 user_metadata:
//   user_metadata 可被公開 anon signUp 的 options.data 偽造(→ raw_user_meta_data)、攻擊者可先建合成 email
//   並偽造 { provider:'line', line_user_id:sub } 冒登入。改用 app_metadata 後、偽造者的 user 無 app_metadata
//   → 守衛拒(codex 關卡2 must-fix-1)。user_metadata 只放 name / line_email(顯示用、trigger 取 name)。

import 'server-only';
// eslint-disable-next-line no-restricted-imports -- 受控例外(Sean 2026-05-25 Q1=A 拍板、ADR-0005 §8):LINE OAuth Admin API 無 anon 替代、service_role 鎖死本 server-only 檔、僅 callback route 引用、不入 client bundle。
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { isValidLineUserId, lineSyntheticEmail, type LineIdentity } from './line';

// service_role client 型別由 factory 推得(storefront 不直接依賴 @supabase/supabase-js)。
type AdminClient = ReturnType<typeof createSupabaseServiceClient>;

export type LineAuthResult =
  | { ok: true; hashedToken: string }
  | { ok: false; reason: 'invalid_sub' | 'collision_not_line' };

/** createUser 失敗是否為「email 已存在」(回頭用戶或撞號)。精確比對 error code、避免誤判成「不存在」而令 generateLink 誤建無 metadata user。 */
function isEmailExistsError(error: { code?: string; message?: string }): boolean {
  return error.code === 'email_exists' || error.code === 'user_already_exists';
}

/** generateLink(magiclink)拿 hashed_token + 既有 user(email 已存在故不會誤建)。 */
async function generateMagicLink(admin: AdminClient, email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const hashedToken = data.properties?.hashed_token;
  if (!hashedToken) throw new Error('generateLink missing hashed_token');
  return { hashedToken, user: data.user };
}

/**
 * 以 LINE 身分建立或登入既有 LINE 用戶,回傳可供 verifyOtp 發 session 的 hashed_token。
 *
 * 流程(Q2=A line_user_id 唯一鍵 + codex 關卡1 finding-2 / 關卡2 must-fix 防冒登入):
 * 1. 驗 sub 格式(boundary、防污染合成 email)。
 * 2. createUser({ 合成 email, email_confirm, app_metadata: 身分鍵, user_metadata: 顯示 })。
 * 3. 成功 → 新用戶(trigger 自動建 customers row)→ generateLink 拿 token。
 * 4. 撞 email_exists → generateLink 回既有 user、**只驗 app_metadata.pcm_provider==='line' 且 pcm_line_user_id===sub**
 *    才放行;否則拒(app_metadata service_role-only、公開 signUp 偽造的 user 無此欄 → 必拒、含 generateLink 誤建的孤兒)。
 * 5. 其他 createUser 錯 → throw(交 callback 導 error;避免誤判成不存在)。
 *
 * @throws 非 email_exists 的 createUser 錯 / generateLink 錯(交 callback try/catch 處理)
 */
export async function authenticateLineUser(identity: LineIdentity): Promise<LineAuthResult> {
  if (!isValidLineUserId(identity.sub)) {
    return { ok: false, reason: 'invalid_sub' };
  }
  const admin = createSupabaseServiceClient();
  const email = lineSyntheticEmail(identity.sub);

  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    // 身分鍵存 app_metadata(service_role-only、不可被公開 signUp 偽造);trigger 不讀此欄。
    app_metadata: { pcm_provider: 'line', pcm_line_user_id: identity.sub },
    // 顯示資料存 user_metadata;trigger 取 name 寫 customers.name(line_email 僅留存、不用於對應)。
    user_metadata: { name: identity.name, line_email: identity.email },
  });

  if (created.error) {
    if (!isEmailExistsError(created.error)) {
      throw created.error; // 非撞號的真錯 → 交 callback 導 error。
    }
    // 撞號:generateLink 回既有 user、驗 app_metadata 身分鍵(偽造者 / 孤兒無此欄 → 拒)。
    const { hashedToken, user } = await generateMagicLink(admin, email);
    const appMeta = (user?.app_metadata ?? {}) as Record<string, unknown>;
    if (appMeta.pcm_provider !== 'line' || appMeta.pcm_line_user_id !== identity.sub) {
      return { ok: false, reason: 'collision_not_line' };
    }
    return { ok: true, hashedToken };
  }

  // 新用戶建立成功 → 產 token(email 已存在故 generateLink 不會誤建)。
  const { hashedToken } = await generateMagicLink(admin, email);
  return { ok: true, hashedToken };
}
