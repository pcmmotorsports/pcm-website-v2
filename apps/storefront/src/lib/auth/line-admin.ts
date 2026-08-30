// lib/auth/line-admin.ts — LINE OAuth 的 Supabase Admin API 封裝(M-1-14e-f2-a2、service_role 受控小門)
//
// ⚠️⚠️ service_role 受控例外(Sean 2026-05-25 Q1=A 拍板 + ADR-0005 §8 記錄):
//   ADR-0005 §6/§7 與 eslint.config.js 規定 storefront 不得 import @pcm/adapters/server(service_role)。
//   LINE 自寫 OAuth 的 Admin API(createUser / generateLink)**無 anon 替代**、且 callback 須同源才寫得到 session
//   cookie(搬 apps/api 跨源不可行、見決策1 選項 B)。故本檔為 storefront 的 service_role 受控小門之一:
//   - `import 'server-only'` 編譯期擋 client 引入;僅 /api/auth/line/callback route(server-only、runtime='nodejs')引用。
//   - service_role 只在本檔這道門之內使用;build 後 grep client chunk 應 0 命中 SUPABASE_SERVICE_ROLE_KEY(關卡2 驗)。
//   🔴 **本檔【不】宣稱 storefront 共有幾道這種門。要數量,跑這一行**(不要問任何一段註解):
//        git grep -nE "^// eslint-disable-next-line no-restricted-imports" -- 'apps/storefront/src/**'
//      2026-08-16 實跑回 **4** 處,分佈在 `lib/auth/composition.ts` / 本檔 /
//      `lib/email/composition.ts` / `lib/payment/composition.ts`。**行號故意不寫在這裡**——
//      行號會漂(這段註解自己就把本檔那道往下推過一次),讓命令去給行號才不會過期。
//      🔴 **`^` 錨定不可省**:不錨定的話,**這段註解裡引用 pattern 的那一行會自己命中**,
//      實跑變 5 行而不是 4;而且每多一份文件提到它,分子就再 +1(偵測字串自命中)。
//      ⚠️ **不要改去問 `eslint.config.js:138-149`** —— 那是對 `apps/storefront/**` 的**整片禁令**,
//      它擋得住新門(開新門會 lint 紅)、但它**列不出也推不出現在有幾道**。門的登記處是那些 disable 行。
//      📎 為什麼寫這段:原文「首個」「鎖死本檔、不外擴」是 2026-05-25 的事實,到 2026-08-16 已不成立
//      (實物:`email/composition.ts:22,48` 也呼叫 `createSupabaseServiceClient()`),
//      **而讀到它的人沒有任何理由去複查。把數字寫進註解 = 製造下一個過期字面。**
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
// eslint-disable-next-line no-restricted-imports -- 受控例外(Sean 2026-05-25 Q1=A 拍板、ADR-0005 §8):LINE OAuth Admin API 無 anon 替代、service_role 只在本 server-only 檔之內使用(不宣稱它是 storefront 唯一一道,數量見檔頭那條命令)、僅 callback route 引用、不入 client bundle。
import { createSupabaseServiceClient } from '@pcm/adapters/server';
// 🔴 「email 已存在」的判別**走共用那一支**(2026-08-28 R3 F5):本檔原本自己有一份,
//    而後台建客人那片又寫了第二份、且**出生就比這份寬**。兩邊「認太寬」的後果方向相同(誤指一個帳號)
//    ⇒ 共用版取窄的,理由與射程在 `packages/adapters/src/supabase/auth-errors.ts`。
import { isEmailExistsError } from '@pcm/adapters';
import { isValidLineUserId, lineSyntheticEmail, type LineIdentity } from './line';
import type { AuthCallbackEventClient } from './callback-event';

// service_role client 型別由 factory 推得(storefront 不直接依賴 @supabase/supabase-js)。
type AdminClient = ReturnType<typeof createSupabaseServiceClient>;

export type LineAuthResult =
  | { ok: true; hashedToken: string }
  | { ok: false; reason: 'invalid_sub' | 'collision_not_line' };


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

// ── 板 :395:同一道門再發一個【窄能力】,而不是再開一道門 ──────────────────
/**
 * 給 `callback-event.ts` 用的 service_role 能力,**只做得到 `record_auth_callback_event` 這一支 RPC**。
 *
 * 🔴 **為什麼放在本檔而不是放在它自己那支檔**:`eslint.config.js` 對 `apps/storefront/**` 的禁令
 *    是**整片**的,而例外一道一道登記在 `// eslint-disable-next-line no-restricted-imports` 行上
 *    (數法見本檔檔頭那條 git grep 命令)。在 `callback-event.ts` 加一行 disable
 *    = **多開第五道門**,而那是要 Sean 拍板 + ADR 記錄的事,不是實作窗自己批得了的。
 *    ⇒ 這裡發出去的**不是** service_role client 本身,是一個**單方法**的型別
 *    ⇒ 門的數量不變(仍是本檔這一道)、登記表不說謊。
 *    🔵 **codex R5:~~原本這裡還寫了「爆炸半徑不變」~~ —— 那句是假的。**
 *       **能力面確實變大了**:這道門現在多發了一個「寫稽核」的能力出去。
 *       不變的是**兩件比較窄的事**:import 的門數、以及它仍在 `server-only` 邊界之內。
 *       ⇒ 📌 「我把新東西塞進舊的門」不等於「沒有新東西」。
 *
 * ⚠️ **而這道門的用途因此比檔頭那句「LINE OAuth Admin API」寬了一格** —— 寫在這裡,不藏:
 *    現在它也發**登入回呼稽核**的能力。兩者共同點是「同一條 LINE OAuth callback 路徑、同一個 server-only 邊界」。
 *    下一個想從這裡再借一樣東西的人:**先問它是不是還在那條路徑上。**
 *
 * 🔵🔵 **codex R1-7(must-fix):回傳的必須是【閉包】,不是一個被窄型別註解過的完整 client。**
 *    ~~原本是 `return createSupabaseServiceClient() as unknown as AuthCallbackEventClient;`~~
 *    ⇒ 那個物件**實際上仍是完整的 service_role client**,拿到它的人一句 `as any` 就取回
 *      `.from()` / `.auth.admin` ⇒ **窄型別是一個提醒,不是一道邊界。**
 *    ⇒ 現在回傳一個**自己新造的物件**,身上只有 `record` 這一個方法(🔵 codex R5:~~原本這句寫「只有
 *      `rpc`」~~ —— 那是改名之前的殘句,`rpc` 現在留在閉包裡、外面看不到),而且函式名被綁死。
 *      cast 它回去**拿不到任何東西** —— 完整 client 只活在這個閉包裡,沒有引用逃得出去。
 *    📌 **「型別上做不到」與「執行期拿不到」是兩個宣稱,而只有後者擋得住人。**
 */
export function createAuthCallbackEventClient(): AuthCallbackEventClient {
  const admin = createSupabaseServiceClient() as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  };
  // 🔵🔵 **codex R2-5(must-fix):RPC 的名字寫死在【這一側】。**
  //    ~~上一版是 `rpc: (fn, args) => admin.rpc(fn, args)`~~ —— 閉包確實藏住了 client,
  //    **而它照樣把呼叫端給的函式名原樣轉送出去** ⇒ 一句 `as any` 就能用 service_role
  //    叫任何一支 RPC。⇒ 📌 **藏住工具與拆掉工具是兩回事。**
  return {
    record: (args) => admin.rpc('record_auth_callback_event', args),
  };
}
