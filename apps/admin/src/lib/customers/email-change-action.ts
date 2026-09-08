'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isEmailExistsError } from '@pcm/adapters';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { getRequestId } from '../audit/context';
import { getAdminAuditLogRepository } from '../orders/order-repository';
import { authorizeAdminMutation } from '../session/authorize';
import { classifyEmailVerification } from './email-verification';
import {
  MUTATION_READ_TIMEOUT_MS,
  readEmailVerification,
} from './email-verification-read';
import {
  emailChangeBlockedCode,
  emailChangeEligibility,
  emailChangeResultCode,
  type EmailChangeResultKind,
} from './email-change-state';
import { parseEmailChangeForm } from './email-change-form';

// email-change-action.ts — 後台「改客人信箱」server action(Sean 2026-09-08 最終拍 A =【最簡單版】)。
//
// 起因(memory `project_0908-admin-can-fix-customer-email`):
//   **客人註冊時信箱打錯一個字 ⇒ 他收不到確認信 ⇒ 登入被擋 ⇒ 而「重寄」按鈕寄到同一個錯地址。**
//   ⇒ 📌 他不是「收不到信」, 他是【完全進不來】, 而他自己與客服都沒有辦法修。
//
// ══ 🔴 範圍(逐字, 不得擴張)════════════════════════════════════════════════
//   ✅ 改 `auth.users`(登入用的)+ `customers`(後台看的)+ 一行稽核
//   ⛔ 舊訂單的 `orders.notification_email` **不動** · `email_outbox.recipient_email` **不動**
//   ⛔ 不撤 session、不做修復與對帳協定、不做批次
//   🔵 codex R2 對【完整版】開了 64 條 must-fix, 而那是拿「一家很忙的店」的尺量的
//      (2026-09-08 實際:訂單 4 張 / 客人 15 位 / outbox 未寄 0 封)⇒ 一大半今天構造不出來。
//      **它們沒有錯, 只是還沒到期** —— 規模一長大就回去讀
//      `docs/plans/2026-09-08-admin-change-customer-email-plan.md` §14(逐條原文)。
//
// ══ 🔴 授權層級:**任何登入員工**(`authorizeAdminMutation`)—— Sean 2026-09-08 拍乙 ══
//   ⛔ ~~原本走 `authorizeManagerMutation`(只有管理者)~~ —— 那是我的推薦, **而 Sean 選了乙**,
//      **且他是看過代價才選的**(主視窗逐字端了)。⇒ 這裡記的是決定, 不是反對意見。
//
//   🔬 **讓那題變得好答的是一份重量**(2026-09-08 19:2x 唯讀實查, 分母 `staff` 共 6 列):
//        啟用中的管理者 = 1 ⇒ 而那一位是 **Sean 本人**
//        另外兩個啟用中的帳號 = `staff_1`(占位)與 `staff_2`(Sean 的測試帳號)
//      ⇒ 📌 **今天沒有第二個真人客服** ⇒ 那道管理者閘**一格都沒有擋到人**
//      ⇒ 放寬的當下**也沒有任何人因此拿到新權限** ⇒ 成本與收益今天都是 0。
//      ⚠️ 那個讀數綁 2026-09-08 那個時點 —— **它不會自己更新**。
//
//   🔴🔴 **而放寬的代價是【未來的】, 寫在這裡給未來想收窄的人**:
//      **收窄回來要先查清楚這段期間誰改過誰** —— 而那個查詢**只能靠稽核表**
//      (`admin_audit_log`, `action IN ('customer.email.change','customer.email.change.attempt')`)。
//      ⇒ 🛑 **所以本片的稽核不可省, 而且它必須記得下【是哪一個員工帳號】, 不是只記「有人改了」。**
//         (放寬之前, 「誰改的」有一半是靠「只有管理者能按」在保證的;放寬之後**那一半沒了**。)
//
//   ⚠️ **稽核那個「誰」可不可信, 綁在 `ADMIN_REQUIRE_REAL_IDENTITY` 上**:
//      旗標開著 ⇒ actor 來自**簽章過的票**;關掉 ⇒ **允許**退到第 3 層讀一顆
//      **使用者自選的 cookie**(`session/actor.ts` 的三層)。
//      ⚠️ **「允許退回」不等於「立刻全部變自陳」**(codex R 訂正我的措辭):
//         票是 `v:2` 時**仍然優先用簽章票**(`session/actor.ts:135` 的第 1 層)
//         ⇒ 退回只發生在**旗標關著【而且】那一發的票不是 v2** 的時候。
//      🟢 正式站 2026-08-25 起 `=1`(Sean 親口 + 登出再登入的行為驗證, 見那支檔的訃聞段)
//      ⇒ **今天那個「誰」是真的**。🛑 而有人把那顆 env 拿掉的那一天, **這一片的唯一問責來源就變成自陳**,
//         而三綠全綠。⇒ 那個依賴寫在這裡, 不在別處重抄一份天花板(兩份會漂)。
//
// ══ 🔴 順序是承重的:先 Auth、後 `customers` ═══════════════════════════════
//   兩段寫入沒有交易可以包(一段在 GoTrue、一段在 Postgres)⇒ **中間一定有一個縫**。
//   縫往哪一邊倒是可以選的,而我選了這一邊:
// ```
//   選 Auth 先(本檔)   壞在中間 ⇒ 客人【登得進來了】而後台還印舊信箱
//                        ⇒ 員工看到「沒改到」會再按一次 ⇒ 第二發把 customers 補上 ⇒ 收斂
//   選 customers 先      壞在中間 ⇒ 後台印【新信箱】而客人【還是進不來】
//                        ⇒ 員工看到成功就走了 ⇒ 🔴 沒有人會再回來, 而客人繼續打電話
// ```
//   ⇒ 📌 判準是「壞掉的那一半**看得見嗎**」——看得見的那一種才有人會去修。
//
//   🛑 **而「再按一次一定會收斂」這句話【不是無條件的】**(codex 2026-09-08 打掉的那一版):
//      A 停在半成功 ⇒ `customers` 仍占著舊位址 ⇒ B 想改用那個位址時
//      Auth 成功而 `customers` 撞 UNIQUE ⇒ **B 重按永遠撞同一顆鍵**。
//      ⇒ 所以本檔做了兩件事:①**動 Auth 之前先探一次**那個位址在 `customers` 上有沒有人占著
//        ②`customers` 那半失敗時**分兩顆碼**:能靠重按解決的 vs 永遠不會好的。
//
// ══ ⚠️ 本片【明說不做】的三件 + 一句被打掉的舊字面 ══════════════════════════
//    (⚠️ 標題原本寫「四件」而第 ④ 條**現在有做** —— 只讀標題會讀成「稽核缺口不處理」。)
//   ① **不撤既有 session** —— 今天的形狀是「他根本進不來」⇒ 沒有 session 可撤。
//   ② **不改舊訂單的通知信箱** —— Sean 明令。舊單寄到舊地址是【歷史事實】, 不是 bug。
//   ③ **不驗新信箱** —— 客服在電話上核對身分, 那是流程不是碼(所以下面 `email_confirm: true`)。
//   ④ ⛔ ~~「稽核的【回應丟失】缺口只能做同交易或對帳協定才能改善」~~ —— **那句是錯的, 已修。**
//      codex R2 2026-09-08 打掉它:**在動手之前先落一列【嘗試】稽核**就保住了舊值,
//      不需要交易、也不需要對帳協定。⇒ 現在每一次改信箱寫**兩列**(嘗試 + 結果)。
//      📌 舊字面留著加刪除線 —— **它是「我把一個便宜的修法說成做不到」的標本**,
//         而那種句子的危險在於:它讓下一個人不會再去想。

/** 結果碼 → returnTo?r=<code>(PRG;returnTo 已由 parse 限定站內 /customers 路徑)。 */
function redirectWith(returnTo: string, kind: EmailChangeResultKind): never {
  const sep = returnTo.includes('?') ? '&' : '?';
  redirect(`${returnTo}${sep}r=${emailChangeResultCode(kind)}`);
}

/** DB / Auth 錯誤摘要(只留碼與截斷訊息;**不接整個 error** —— 它可能夾帶信箱)。 */
function logFailure(label: string, requestId: string, err: unknown): void {
  const e = err as { code?: unknown; message?: unknown };
  console.error(`[admin/customers] ${label}`, {
    request_id: requestId,
    code: typeof e.code === 'string' ? e.code : undefined,
    message: String(e.message ?? '').slice(0, 200),
  });
}

/** 大小寫不敏感比對(GoTrue 會把整個位址轉小寫, 我們這一側只轉網域 ⇒ 兩邊字面可能差在 local-part)。 */
function sameEmail(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export async function changeCustomerEmailAction(formData: FormData): Promise<void> {
  // ① 形狀層 + 語意層(UUID、重複欄位、Email 格式、合成網域擋門、canonicalize)。
  //    🔴 **解析排在授權【之前】**(code-reviewer nit 6):這樣 `denied` 也回得了原本那張客人卡。
  //    解析是純函式、零 I/O、不看資料 ⇒ 對未授權的輸入跑它沒有任何代價。
  const parsed = parseEmailChangeForm(formData);

  // ② 授權閘(**任何登入員工**;Sean 2026-09-08 拍乙。理由與代價見檔頭)。
  const auth = await authorizeAdminMutation();
  if (!auth) redirectWith(parsed.ok ? parsed.returnTo : '/customers', 'denied');
  if (!parsed.ok) redirectWith('/customers', 'invalid');

  const requestId = await getRequestId();

  // attempt log:只留識別欄位。🔴 **信箱一律不進 log**(PII;同客戶線紀律 —— tier 那支不記備註、
  //    儲值金那支不記金額)。稽核真相在 `admin_audit_log`, 那張表本來就零 client 權限。
  console.info('[admin/customers] customer.email.change.attempt', {
    request_id: requestId,
    sid: auth.sid,
    actor: auth.actorId,
    customer_id: parsed.customerId,
  });

  // ③ 🔴🔴 **資格閘在 server 端【重新讀一次】** —— 不信任畫面。
  //    表單有沒有被渲染出來是 UI 的事;而帶著 hidden 欄位的 POST 任何人都送得出來。
  //    兩個軸都要過(`pcm_provider` + 合成網域 / GoTrue `app_metadata.providers`),
  //    理由全文在 `email-change-state.ts` 的 `emailChangeEligibility` docstring。
  //    ⚠️ `readEmailVerification` **永不 throw**:讀不到回 `null` ⇒ 判成 `unknown` ⇒ 擋
  //       ⇒ **fail-closed**。這是刻意的:讀不到 ≠ 可以改。
  //    🔴 **逾時用寫入路徑那一個, 不是顯示那一個**(codex R3 must-fix):
  //       1.5 秒是為「這一格顯示不出來沒關係」選的, 拿它決定「這個操作可不可以做」
  //       ⇒ GoTrue 只是慢一點的那天, **正當的客服操作會在動手前被拒**, 而客人在電話上。
  const raw = await readEmailVerification(parsed.customerId, undefined, MUTATION_READ_TIMEOUT_MS);
  const kind = classifyEmailVerification(raw).kind;
  if (!emailChangeEligibility(kind, raw?.authProviders).allowed) {
    redirectWith(parsed.returnTo, emailChangeBlockedCode(kind, raw?.authProviders));
  }

  const client = createSupabaseServiceClient();

  // ④ 讀舊信箱 —— 兩個用途:稽核的 `before`,以及**動手之前**先確認這一列真的在。
  const before = await client
    .from('customers')
    .select('email, updated_at')
    .eq('user_id', parsed.customerId)
    .maybeSingle();
  if (before.error) {
    logFailure('改信箱:讀取現值失敗', requestId, before.error);
    redirectWith(parsed.returnTo, 'error');
  }
  if (!before.data) redirectWith(parsed.returnTo, 'not_found');
  const previousEmail = before.data.email;
  // 🔴 **樂觀鎖的那把鑰匙**(codex R2 must-fix 1)。
  //    只比 `email` 的話有一條路擊穿它:兩個分頁都讀到 a ⇒ B 把 Auth 改成 b、
  //    A 把 Auth 改回 a 並把 `customers` 寫 a→a(**同址寫入, 條件仍成立**)
  //    ⇒ B 那一發的 `.eq('email', a)` **照樣命中** ⇒ 它寫 a→b
  //    ⇒ 🔴 最後 Auth=a 而 `customers`=b, **而兩發都印綠色**。
  //    ⇒ 📌 `email` 是被寫的那一欄, 拿它當版本號 ⇒ 「寫回同一個值」在它上面沒有留下痕跡。
  //    ✅ `updated_at` 由 `customers_set_updated_at` BEFORE UPDATE trigger 強制覆寫
  //       (`20260523034911`)⇒ **任何一次寫入都會動它**, 包含同址寫入。
  const previousUpdatedAt = before.data.updated_at;

  // ⑤ 🔴 **動 Auth 之前先探一次**:那個位址在 `customers` 上有沒有【別人】占著。
  //    這一探不是多餘的謹慎 —— 它把 codex 打掉的那條路(A 半途改走 ⇒ B 永遠撞 UNIQUE)
  //    從「Auth 已改而 customers 永遠寫不進去」變成「什麼都還沒動就擋下來」。
  //    ⚠️ 它**不是**互斥鎖:探完到寫入之間仍有窗。真的撞上時走下面第 ⑧ 步的 `half_done_stuck`,
  //       那一顆會明講「不要重按」。⇒ 這一探縮小窗口, 不宣稱關掉它。
  // 🔴 **`.in([原字面, 全小寫])` 而不是 `.eq(原字面)`**(codex R2 must-fix 2):
  //    `customers.email` 的比對是**大小寫敏感**的, 而 GoTrue 會把整個位址轉小寫
  //    ⇒ 別人占著 `wang@example.com` 而員工打 `Wang@example.com` ⇒ `.eq` **漏擋**
  //    ⇒ Auth 正規化之後改成功, `customers` 撞 `23505`。
  //    🛑 **那不需要任何競速, 打一個大寫字母就會發生。**
  //
  // ⚠️⚠️ **而這一探【不是】大小寫不敏感 —— 把它讀成那樣是錯的**(codex R3 must-fix 訂正我的措辭):
  //    `.in()` 是**兩個 exact 值**。DB 裡存的若是 `Wang.New@…`(混合大小寫的第三種寫法),
  //    而員工打 `WANG.NEW@…` ⇒ **原字面與全小寫都對不上** ⇒ 這一探漏掉。
  //    ⛔ ~~原註解寫「大小寫不敏感」~~ —— **那是我的過度概括, 兩個 exact 值不等於不分大小寫。**
  //    ⛔ ~~「漏掉之後不會靜默:`customers.email` 的 UNIQUE 會撞 `23505`」~~
  //       🔴 **那句是假的, 而它是我第三次在同一個軸上出錯**(R4 打掉):
  //       `customers.email` 是**純 `text` 的 UNIQUE**(`20260523034911:16`, 無 `citext`、
  //       全 repo 零 `lower(email)` 索引)⇒ **大小寫敏感** ⇒ `Wang.New@x` 與 `wang.new@x`
  //       是**兩個不同的字串, 根本不會撞**。
  //    🔵 **今天實際擋住它的是【GoTrue 自己會把整個位址轉小寫】**:別位客人的 `auth.users.email`
  //       也是小寫的 ⇒ 我們這一發送過去會撞唯一鍵。
  //       ⚠️ **而「它一定會回 `email_exists` ⇒ 走 `taken`」我不宣稱**(R5 打掉):
  //       GoTrue 也可能把交易失敗包成 500 ⇒ 那一發會落進 `error`(「再試一次」)。
  //       **正式版本的實際錯誤碼未量** —— 我沒有連過 GoTrue。⇒ 這裡只說得出「有東西會擋」,
  //       說不出「會落在哪一顆碼」。
  //    🛑 **而它涵蓋不到的那一格要寫明**:`auth` 與 `customers` 已經漂開的那一位
  //       (customers 存混大小寫、而沒有對應的小寫 auth 帳號)⇒ 兩邊都不擋
  //       ⇒ **會靜靜多出一列只差大小寫的 `customers`**, 而畫面印 `saved`。
  //    🔬 **今天構造不出來 —— 而這一句 2026-09-08 18:5x 【量到了】, 不再是推的**
  //       (走 `scripts/readonly-prod-sql.sh` 唯讀查正式庫):
  //       🟢 正對照 `customers` 共 **15** 列(尺接上了)· 🎯 小寫化後會撞的組數 **0**
  //       · 🎯 目前**不是全小寫**的信箱 **0**(= 連未來會撞的種子都沒有)· ⚪ 負對照 **0**。
  //       ⚠️ **那個讀數綁 2026-09-08 18:5x 那個時點** —— 它不會自己更新。
  //    ⇒ 📌 **真解是 DB 端一個 `lower(email)` 的唯一索引**(另一支 migration, 不在本片射程)。
  //       這已經是這個軸的**第三輪**(R2 抓 `.eq` 漏擋 · R3 抓「兩個 exact 值不等於不分大小寫」·
  //       R4 抓「UNIQUE 會兜底」是假的)⇒ **不再補第四個 patch, 端成決策題。**
  //    🛑 **為什麼不用 `.ilike` 把它做對**:信箱裡的 `_` 與 `%` 在 LIKE 裡是萬用字元
  //       ⇒ `a_b@x.com` 會誤命中 `axb@x.com` ⇒ **那是把「漏擋」換成「誤擋別人」**,
  //       而 PostgREST 沒有好用的 `ESCAPE` 出口。真正的解是 DB 端一個
  //       `lower(email)` 的唯一索引 —— 那是另一支 migration, 不在本片射程。
  //    ⇒ 📌 **取捨的方向寫下來了**:這一探涵蓋【今天最常見的兩種】, 其餘交給 UNIQUE 兜底。
  const occupied = await client
    .from('customers')
    .select('user_id')
    .in('email', [parsed.email, parsed.email.toLowerCase()])
    .neq('user_id', parsed.customerId)
    .maybeSingle();
  if (occupied.error) {
    logFailure('改信箱:重複信箱預檢失敗', requestId, occupied.error);
    redirectWith(parsed.returnTo, 'error');
  }
  if (occupied.data) redirectWith(parsed.returnTo, 'taken');

  // 🔴🔴 **動手之前先寫一列【嘗試】稽核 —— 而它不是「多留一筆」, 是【舊值的唯一副本】。**
  //    (codex R2 must-fix 7 打掉了我原本那句「只能做同交易或對帳協定才能改善」。**那句是錯的。**)
  // ```
  // 舊版的洞:customers 已經 commit 而 HTTP 回應在路上掉了
  //   ⇒ 這一發走到 half_done、【沒寫稽核】
  //   ⇒ 員工照提示重按 ⇒ 第二發讀到的 before 已經是新值 ⇒ 稽核只留得下「新→新」
  //   ⇒ 🔴 世界上再也沒有任何一份東西記得【舊信箱是什麼】。
  // ```
  //    ✅ 修法便宜得多:**在動任何東西之前**把「誰、對誰、從什麼、要改成什麼」落一列,
  //    並在 `reason` 明寫**結果未定**。⇒ 不需要交易, 也不需要對帳協定。
  //    ⚠️ 代價:每一次改信箱會有**兩列**稽核(嘗試 + 結果)。今天 15 位客人 ⇒ 可接受。
  //    🔵 這一列寫不進去**不擋**後面 —— 擋住的話, 稽核壞掉就等於功能壞掉;
  //       而它寫不進去的那個世界, 下面那一列多半也寫不進去 ⇒ 員工會看到 `saved_audit_failed`。
  try {
    await getAdminAuditLogRepository().record(
      {
        action: 'customer.email.change.attempt',
        target: `customer:${parsed.customerId}`,
        before: { email: previousEmail },
        after: { email: parsed.email },
        reason: '嘗試:結果未定(這一列在動手【之前】就寫了 —— 它保住的是舊信箱這個值)',
      },
      { actor: auth.actorId, requestId, sourceApp: 'admin' },
    );
  } catch (err) {
    logFailure('改信箱:嘗試稽核寫入失敗(仍然繼續 —— 稽核壞掉不等於功能要壞掉)', requestId, err);
  }

  // ⑥ Auth 那半(登入用的那個信箱)。順序理由見檔頭。
  //    🔴 `email_confirm: true` 是**這一片的重點**, 不是順手加的:
  //       這個帳號必須以【已驗證】的狀態離開這一發, 否則 `login/actions.ts:57` 那個
  //       `email_confirmation_required` 會照樣把客人擋在外面 ⇒ **改了等於沒改**。
  //       (⛔ ~~原註解寫「不設它就只是掛成待確認」~~ —— codex 2026-09-08 nit 9 指正:
  //        Admin API 是直接套用修改, 那句話對 API 語意的描述是錯的。**要的是結果, 不是那個機制。**)
  //    ⚠️ 代價明寫:這等於**由客服替客人背書「這個信箱是他的」** ——
  //       ⛔ ~~所以它走管理者閘~~(Sean 2026-09-08 拍乙放寬成任何登入員工 —— 見檔頭那段)
//       ⇒ ✅ **現在撐住這件事的只剩【每一發都寫稽核】**, 而核身是電話上做的、不在碼裡
  //       (表單那句 `footerHint` 逐字要求用【既有可信聯絡方式】核身, 不是念一次拼字)。
  // 🔴 **要 `try` —— auth-js 只把 `AuthError` 轉成 `{ error }`, 網路那一類是【直接 throw】**
  //    (codex R3 must-fix)。沒接住 ⇒ 故障那天整頁 500, 而 500 什麼都不告訴員工。
  //    🛑 而 throw 的世界裡我們**不知道 Auth 到底套用了沒** —— 請求可能已經到了對面。
  //    ⇒ 所以它不能講成 `error`(「再試一次」語氣暗示什麼都沒發生), 要自己一顆碼。
  let updated: Awaited<ReturnType<typeof client.auth.admin.updateUserById>>;
  try {
    updated = await client.auth.admin.updateUserById(parsed.customerId, {
      email: parsed.email,
      email_confirm: true,
    });
  } catch (err) {
    logFailure('改信箱:Auth 更新整段拋出(不知道它套用了沒)', requestId, err);
    redirectWith(parsed.returnTo, 'auth_unknown');
  }
  if (updated.error) {
    logFailure('改信箱:Auth 更新失敗', requestId, updated.error);
    // 🔴 **「這個信箱已經有人在用」要單獨一句話** —— 而
    //    「系統錯誤,請稍後再試」會讓員工一直重按一個永遠不會成功的動作。
    //    ⚠️ 天花板(codex nit 8):GoTrue 可能把唯一鍵失敗包成 `unexpected_failure`
    //       ⇒ 那一發會落進 `error`(「再試一次」)。上面第 ⑤ 步的預檢就是為了讓
    //       **今天最常見的那一種**在動 Auth 之前就被擋掉, 走 `taken` 那句話。
    redirectWith(
      parsed.returnTo,
      isEmailExistsError(updated.error as { code?: string; message?: string })
        ? 'taken'
        : 'error',
    );
  }

  // 🔴 **接下來寫進 `customers` 與稽核的, 是 Auth【回傳的那一份】, 不是我送過去的字面。**
  //    codex 2026-09-08 must-fix 4:GoTrue 會把整個位址轉小寫, 而我們這一側的
  //    `canonicalizeNotificationEmail` 只轉網域 ⇒ 送 `Wang@Example.COM` 進去,
  //    Auth 存 `wang@example.com` 而 `customers` 會存 `Wang@example.com` ⇒ **兩邊字面分岔而回成功**。
  //    ⇒ 📌 以【對方存了什麼】為準, 不以【我打算存什麼】為準。
  //    🛑 **回傳裡沒有 email ⇒ 停下, 不要猜**(codex R2 must-fix 5):
  //       ⛔ ~~退回用我送的那一份~~ —— 那正是本條要防的分岔:Auth 存小寫、`customers` 存原字面,
  //       而它**回綠色**。⇒ 讀不回對方存了什麼, 就不要寫我的猜測進去。
  //       ⚠️ 而 Auth 那半**可能已經改了**(它回的是 200)⇒ 走 `half_done`(叫他再按一次):
  //          第二發若拿得到 email 就補完後台那半, 拿不到就會一直停在這裡而**畫面看得見**。
  const finalEmail = updated.data.user?.email;
  if (!finalEmail) {
    logFailure(
      '改信箱:Auth 回了 200 而回應裡沒有 email(形狀不認得)—— 沒有寫 customers',
      requestId,
      { code: 'auth_response_without_email' },
    );
    redirectWith(parsed.returnTo, 'half_done');
  }

  // ⑦ `customers` 那半(後台看的那一欄)。
  //    🔴 **這一段需要 `20260908100000` 那支 migration** —— `customers.email` 原本不在
  //       service_role 的五欄 UPDATE ACL 內(`20260905190000:82-88` 逐字「恰 5 欄」)
  //       ⇒ 沒貼那支 ⇒ 這裡**每一次**都回 `42501`, 而上面第 ⑥ 步**已經成功了**。
  //    🔴 **`.eq('email', previousEmail)` 是【比對後寫入】, 不是多餘的條件**
  //       (codex must-fix 2:同一位客人開兩個分頁交錯送出 ⇒ 舊版兩發都回 `saved`,
  //        而最後 Auth 是乙、後台是甲)。加上它之後, 第二發會改到 0 列 ⇒ 走下面的分流。
  //    🔴 **`count: 'exact'` 也不是裝飾**(codex must-fix 6 / code-reviewer nit 9):
  //       `.update().eq()` 在**零列命中**時是 `error: null` ⇒ 舊版會回 `saved` 而什麼都沒改。
  const wrote = await client
    .from('customers')
    .update({ email: finalEmail }, { count: 'exact' })
    .eq('user_id', parsed.customerId)
    .eq('email', previousEmail)
    // 🔴 見上面 `previousUpdatedAt` 那段:**同址寫入在 `email` 上不留痕, 在這一欄上留。**
    .eq('updated_at', previousUpdatedAt);
  if (wrote.error) {
    const code = (wrote.error as { code?: unknown }).code;
    logFailure('改信箱:customers 更新失敗(登入信箱【已經改掉了】)', requestId, wrote.error);
    // 🔴 **兩顆碼, 因為員工要做的事【相反】**:
    //    `23505` = 撞到別人的 UNIQUE ⇒ **重按永遠是同一個結果**(codex must-fix 3)。
    //    `42501` / 其他 = 權限沒開 / 暫時性 ⇒ 重按會好(貼了 migration 之後)。
    redirectWith(parsed.returnTo, code === '23505' ? 'half_done_stuck' : 'half_done');
  }

  // ⑧ 零列命中的幾種世界 —— **它們的下一步不一樣, 所以要分開問**。
  // 🔴 **判準是「`count` 不是一個正數」, 不是 `=== 0`**(codex R2 nit 8):
  //    真的 supabase-js 在**沒有要 `count`** 時回 `count: null` ⇒ `null === 0` 是 `false`
  //    ⇒ 有人哪天把 `{ count: 'exact' }` 拿掉, 這一整段會**靜靜地被跳過**, 而全綠。
  //    ⇒ 所以「拿不到數字」也要走下面那條回讀路, 不能當成成功。
  if (typeof wrote.count !== 'number' || wrote.count === 0) {
    const after = await client
      .from('customers')
      .select('email')
      .eq('user_id', parsed.customerId)
      .maybeSingle();
    if (after.error) {
      // 🔴 **回讀失敗 ⇒ `half_done_stuck`(不要重按), 不是 `half_done`**(codex R2 must-fix 4):
      //    零列命中的成因**可能是別人剛把它改成了第三個值**, 而我現在讀不到那是哪一種
      //    ⇒ 叫他「再按一次」就是叫他**去蓋掉別人剛做完的變更**。
      //    ⇒ 📌 **不知道是哪一種衝突的時候, 不可以當成可以安全重試。**
      logFailure('改信箱:零列命中之後回讀失敗(不知道是哪一種衝突)', requestId, after.error);
      redirectWith(parsed.returnTo, 'half_done_stuck');
    }
    // (a) 這一列不在了 —— 中間被刪掉(而 Auth 那半已經改了)。
    if (!after.data) redirectWith(parsed.returnTo, 'not_found');
    // (b) 已經是新值 —— 別人(或我上一發)先寫成了 ⇒ 世界是對的, 只是不是我寫的。
    if (sameEmail(after.data.email, finalEmail)) redirectWith(parsed.returnTo, 'no_change');
    // (c) 還是舊值 —— 那表示擋住我的是 `updated_at`(有人動了這一列的【別的欄】, 例如姓名電話),
    //     而信箱本身沒有被別人改 ⇒ **重按是安全的**。
    if (sameEmail(after.data.email, previousEmail)) redirectWith(parsed.returnTo, 'half_done');
    // (d) 變成第三個值 —— 有人在我送出之後把信箱改成了別的 ⇒ 重按只會蓋掉他 ⇒ 叫他先看一眼。
    redirectWith(parsed.returnTo, 'half_done_stuck');
  }

  // ⑨ 稽核。**寫失敗不回滾**(前兩段已生效, 假裝沒發生比少一列紀錄更糟),
  //    但要讓員工知道 —— `saved_audit_failed` 與 `saved` 刻意不共用一句話。
  //    🔵 形狀鏡像 `staff-actions.ts:78`(逐字 `await getAdminAuditLogRepository().record(entry, {`;
  //       app 層、非交易性)。tier / 儲值金那兩條走 owner RPC **同交易**寫稽核,本片沒有 RPC ⇒ 走這條。
  //       ⚠️ 差別要講明:同交易的那兩條**寫不進稽核就整筆回滾**,本片做不到 ⇒ 下面那個 `audited` 旗標
  //       就是這個差別的價錢。(⛔ ~~`staff-actions.ts:61`~~ —— 那是 `profile-actions.ts:26` 與
  //       `audit/repository.ts` 寫下時的行號, 到 2026-09-08 已漂到 `:78`;舊字面留著給搜它的人撞。)
  let audited = true;
  try {
    await getAdminAuditLogRepository().record(
      {
        action: 'customer.email.change',
        target: `customer:${parsed.customerId}`,
        before: { email: previousEmail },
        after: { email: finalEmail },
      },
      { actor: auth.actorId, requestId, sourceApp: 'admin' },
    );
  } catch (err) {
    audited = false;
    logFailure('改信箱:稽核寫入失敗(信箱變更已生效)', requestId, err);
  }

  revalidatePath('/customers');
  revalidatePath(`/customers/${parsed.customerId}`);
  // 🔵 `no_change`:後台那一欄本來就是這個值(而 Auth 那半仍然跑了 —— 它可能把一個
  //    「未驗證」的帳號標成已驗證, 那**是**一個變更, 所以稽核照寫)。
  // 🔴 **`audited` 排在 `no_change` 前面**(codex R2 must-fix 6):
  //    舊版寫成 `sameEmail(…) ? 'no_change' : audited ? …`
  //    ⇒ 「後台那一欄本來就是這個值」而**稽核寫不進去**時, 畫面印綠色的 `no_change`
  //    ⇒ 📌 **稽核失敗被一句成功語氣蓋掉了** —— 而那一發 Auth 仍然跑了(它可能把一個
  //       未驗證的帳號標成已驗證), 那**是**一個變更, 而世界上沒有紀錄。
  redirectWith(
    parsed.returnTo,
    !audited ? 'saved_audit_failed' : sameEmail(previousEmail, finalEmail) ? 'no_change' : 'saved',
  );
}
