// app/api/auth/line/callback/route.ts — LINE OAuth callback route(M-1-14e-f2-a2、Q4=Y 自寫)
//
// 對齊 PRD §8.5 step 1-6:驗 state → 換 token → 驗 id_token → 建/查 LINE 用戶(service_role)→ 發 session → redirect。
// - **單一 redirect 點、在 try 外**:resolveDestination 回字串、GET 末尾唯一 redirect()。避免 redirect() 的
//   NEXT_REDIRECT throw 被 try/catch 吞掉(否則成功路徑會被當失敗再導 error)。
// - state 比對用 timingSafeEqual + 長度先檢(長度不等直接 false、避免 timingSafeEqual throw;codex 關卡1 finding-7)。
// - state/nonce cookie 用後即刪、**所有路徑都清**(成功 / 失敗 / 早退;codex 關卡1 finding-7)。
// - 任一步失敗(state 不符 / LINE 錯 / 冒登入 / verifyOtp 錯)→ redirect '/login?error=line'(相對、不上洩原始 error);
//   🔴 #190 起**失敗也帶 next**(`&next=`,見 lineErrorRedirect):cookie 已被刪、不帶就永遠回不去了。
// - session 發放分工:service_role(line-admin.ts)產 hashed_token;anon cookie client(lib/supabase/server)verifyOtp
//   寫 session cookie(對齊 d-2 雙 client 紀律)。
// - runtime='nodejs':用 node:crypto + LINE fetch + service_role(line-admin)、強制 Node runtime(Q1=A 紀律)。

import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { authenticateLineUser } from '@/lib/auth/line-admin';
import {
  exchangeCodeForToken,
  LINE_NEXT_COOKIE,
  LINE_NONCE_COOKIE,
  LINE_OAUTH_COOKIE_PATH,
  LINE_STATE_COOKIE,
  verifyIdToken,
} from '@/lib/auth/line';
import { sanitizeNextParam } from '@/lib/auth/safe-redirect';
import { recordLineCallbackEvent, type LineCallbackReason } from '@/lib/auth/callback-event';

export const runtime = 'nodejs';

const LINE_ERROR_REDIRECT = '/login?error=line';

/**
 * 失敗時的導回目的地。🔴 **#190 codex 關卡2 MF-2:失敗路徑也要把 next 帶著走。**
 *
 * 為什麼這條比 Google 那條重:LINE 的 next 住在 **cookie**,而 :108-110 **所有路徑都會刪它**
 * (單次有效、CSRF 衛生,那是對的、不動它)⇒ 失敗一次之後,客人重試登入時**已經沒有東西可以帶他回去**,
 * 而那個回不去的地方可能是**已經扣款完成的 `/checkout/callback`** —— 不是「重走一次結帳」,
 * 是「他可能已經付錢了,而他回不到看結果的那一頁」。
 *
 * 🔴 修法刻意**不是**讓 cookie 活下來(那會拆掉單次有效那道防線),而是**把值搬進 URL query**:
 *   · 值的來源是我方 start route 存的、已 sanitize(`line/start/route.ts:34`),不是外部直接可控;
 *   · 這裡**再過一次** `sanitizeNextParam`(sink 端縱深,與 :89 成功路徑同一把白名單);
 *   · 產出是站內相對路徑,維持 :8 那條「不上洩、不組絕對 URL」。
 */
function lineErrorRedirect(next: string | undefined): string {
  if (!next) return LINE_ERROR_REDIRECT;
  return `${LINE_ERROR_REDIRECT}&next=${encodeURIComponent(sanitizeNextParam(next))}`;
}

/** 等長 constant-time 比對;長度不等先回 false(timingSafeEqual 要求等長 Buffer、否則 throw)。 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

type CallbackInput = {
  code: string | null;
  state: string | null;
  storedState: string | undefined;
  nonce: string | undefined;
  next: string | undefined; // #190:start 存的(已 sanitize)next cookie 值
};

/**
 * 🔴 **板 :395:回傳從「一個字串」變成「目的地 + 成敗 + 原因碼」。**
 *
 * 導頁行為**逐字不變** —— 每一條失敗路徑仍然回 `lineErrorRedirect(next)`、仍然不上洩原始 error。
 * 多出來的只有**我方封閉集的原因碼**,而它進 DB、不進 URL、不進畫面。
 *
 * 🔴 **原本那一顆 5 條件的 `if` 被拆成 5 個 `if`,而那不是風格**:
 *    合在一起時,`code` 沒帶與 `state` 對不起來在紀錄上是**同一列**,
 *    而那兩種是**不同的東西**(前者多半是授權沒完成,後者多半是 cookie 對不上)。
 *    ⇒ 而這張表存在的第一個理由就是把它們分開。
 *
 * 🔵 **codex R5:~~原本這裡寫「`code` 沒帶 = 客人自己按的取消」「state 對不起來 = 有人在打我們」~~**
 *    —— **兩句都把一種可能寫成了結論**:不帶 `code` 直接打這個 endpoint 的探測器也長這樣;
 *    而 state 對不起來最常見的其實是**客人開了兩個分頁**(後一次 `/start` 覆蓋了 cookie)。
 *    ⇒ 📌 reason code 記的是**我方在哪一步停下來**,不是**對方的意圖** ——
 *      意圖要靠 `hits` 的量級去判,而不是靠這個碼的名字。
 *    ⚠️ 拆法保留**原本的短路順序**(`safeEqual` 仍然只在兩邊都非空時才呼叫)。
 */
type CallbackOutcome = {
  destination: string;
  outcome: 'success' | 'failure';
  reasonCode: LineCallbackReason | null;
};

/** 失敗:目的地照舊(`lineErrorRedirect`),只是多帶一個我方原因碼。 */
function fail(next: string | undefined, reasonCode: LineCallbackReason): CallbackOutcome {
  return { destination: lineErrorRedirect(next), outcome: 'failure', reasonCode };
}

/** 回 redirect 目的地(相對路徑);所有失敗都回 lineErrorRedirect(next)、不上洩。redirect() 由 GET 末尾單點呼叫。 */
async function resolveDestination({ code, state, storedState, nonce, next }: CallbackInput): Promise<CallbackOutcome> {
  // CSRF:code + state + 兩 cookie 齊全且 state 比對相符(含 LINE 取消授權無 code 的情形)。
  if (!code) return fail(next, 'missing_code');
  if (!state) return fail(next, 'missing_state_param');
  if (!storedState) return fail(next, 'missing_state_cookie');
  if (!nonce) return fail(next, 'missing_nonce_cookie');
  if (!safeEqual(state, storedState)) return fail(next, 'state_mismatch');
  try {
    const { idToken } = await exchangeCodeForToken(code);
    const identity = await verifyIdToken(idToken, nonce);
    const result = await authenticateLineUser(identity);
    if (!result.ok) {
      // invalid_sub / collision_not_line(防冒登入)—— 原因碼直接沿用 line-admin 的封閉集。
      return fail(next, result.reason);
    }
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: result.hashedToken,
      type: 'email',
    });
    if (error) {
      return fail(next, 'session_verify_failed');
    }
    // #190:成功 → 導回 sanitize 過的 next(cookie 值 start 已 sanitize、此處 sink 再驗一次縱深;不安全→ '/')。
    return { destination: sanitizeNextParam(next), outcome: 'success', reasonCode: null };
  } catch {
    // LINE / Supabase 任一失敗 → 不上洩原始 error、導回登入頁(next 跟著走,見 lineErrorRedirect)。
    // ⚠️ 換 token 與驗 id_token 在這裡**分不開**,所以只有一個 `upstream_error`。
    //    要分開得拆成兩個 try —— 今天不做:那會動到「單一 redirect 點」那條紀律的形狀。
    return fail(next, 'upstream_error');
  }
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const { searchParams } = new URL(request.url);
  const input: CallbackInput = {
    code: searchParams.get('code'),
    state: searchParams.get('state'),
    storedState: cookieStore.get(LINE_STATE_COOKIE)?.value,
    nonce: cookieStore.get(LINE_NONCE_COOKIE)?.value,
    next: cookieStore.get(LINE_NEXT_COOKIE)?.value, // #190:start 存的已 sanitize next
  };

  // 用後即刪(所有路徑):state / nonce / next cookie 單次有效。
  cookieStore.delete({ name: LINE_STATE_COOKIE, path: LINE_OAUTH_COOKIE_PATH });
  cookieStore.delete({ name: LINE_NONCE_COOKIE, path: LINE_OAUTH_COOKIE_PATH });
  cookieStore.delete({ name: LINE_NEXT_COOKIE, path: LINE_OAUTH_COOKIE_PATH });

  const { destination, outcome, reasonCode } = await resolveDestination(input);

  // 🔴 **板 :395:唯一的記錄點,而它刻意排在 `redirect()` 之前。**
  //    `redirect()` 是靠 throw `NEXT_REDIRECT` 運作的 ⇒ 排在它後面的任何一行**永遠不會跑**。
  // 🔴 **`await` 它是安全的**:`recordLineCallbackEvent` 永不 throw、永不回傳失敗(fail-open,
  //    理由與代價寫在 `lib/auth/callback-event.ts` 檔頭)⇒ 記錄壞掉時登入照常完成。
  // 🔴 **`state` 完全不送**(fable R3 之後整欄拿掉,理由在 migration 檔頭):
  //    它原本要買的「重放看得見」構造不出來,而它讓攻擊者**鑄得出無限多把合法的鍵**
  //    (`api/auth/line/start` 無認證、每一發 GET 就鑄一組)⇒ 兩發換一列,照樣無界。
  //    ⇒ 現在鍵是 `(provider, outcome, reason_code, 當天)` ⇒ **每天最多 10 列,結構上有界。**
  // 🔴 **這道 try/catch 是第二道,不是重複的那道**:`recordLineCallbackEvent` 自己已經 catch 一切,
  //    而那是**它的檔**的契約 —— 一個**別人改得動**的契約。這一段讓 fail-open 在**本檔**也成立:
  //    即使有天那支檔改壞了會 throw,客人照樣登得進來。
  // 🔵 **codex R5:~~原句「觀測壞掉的代價必須【永遠】是『少一列』」~~ —— 那個「永遠」是假的。**
  //    持續故障五分鐘 ⇒ 那五分鐘**每一發都少記** ⇒ 代價是**一整批**,不是一列。
  //    ⇒ 正確的說法:**代價只會落在「記錄」這一側,不會變成「客人進不來」** ——
  //      它保證的是**代價的種類**,不是代價的大小。
  // 🔴🔴 **為什麼是 try/catch 而不是 `.catch(() => {})`(我先寫的是後者,而測試把它打紅了)**:
  //    `.catch()` 只接得住**已經變成 promise 的那個失敗**。若那支函式在回傳 promise **之前**
  //    就同步 throw(例如參數處理炸掉),`.catch()` 那一格**根本還沒接上**
  //    ⇒ 例外直接穿過去,**客人登不進來**。
  //    📌 `async` 函式確實會把同步 throw 包成 rejection —— 而那是【它現在的實作形狀】,
  //       不是我在這一行手上的保證。
  //    ⇒ 兩個世界都由 `route.test.ts` 的兩格釘住(rejected promise 一格、同步 throw 一格)。
  // 🛑 **codex R5:而這道 try/catch 接不住的那一種要寫出來 —— ~~原本我把它列進「例如」裡,那是錯的~~:**
  //    **`callback-event` 在 import 期就 throw ⇒ 本模組根本載入不起來**
  //    ⇒ `GET` 從來不會被呼叫 ⇒ 這幾行**不在執行路徑上** ⇒ 客人拿到的是 500。
  //    ⇒ 📌 所以「不管對面長什麼樣都成立」也是寫大了:**它涵蓋的是【呼叫期間】的失敗,
  //      不涵蓋【載入期】。**(載入期那一種擋不住,而它也不會安靜 —— 整條路線直接 500。)
  try {
    await recordLineCallbackEvent(outcome, reasonCode);
  } catch {
    // 🔵🔵 **codex R1-8(must-fix):這裡【必須】出聲,而我原本寫的是「刻意連 console 都不寫」。**
    //    ~~原句理由:「後備已經在 callback-event.ts 裡了」~~ —— **那句話正好在這條路上是假的**:
    //    能走到這個 catch,代表那支檔的後備**自己就沒跑到**(例如 factory 同步 throw)。
    //    ⇒ 那個世界裡 DB 沒有列、console 也沒有字 ⇒ **一段持續故障會漏掉【整批】登入**,
    //      而一小時之後(Vercel log 保留期)它與「沒有人登入」**完全相同**。
    //    ⇒ 📌 fail-open 的承諾是「代價只是少一列」—— 沒有這一行,代價會靜靜地變成「少一整段」。
    //    🔴 只印固定句、不接住 error 物件(它可能夾帶 state 與上游內容)。
    // 🔵 **codex R5:~~原句「那一段時間的登入不會有任何一列」~~ —— catch 證明不了那件事。**
    //    它只知道「有東西拋出來了」;那一發可能**已經寫進去了**、在之後才炸。
    //    ⇒ 措辭改成它真的知道的那件事。
    console.warn('[auth.callback] 登入回呼紀錄拋出例外 —— 這一發有沒有寫進 DB 未知。登入本身不受影響。');
  }

  redirect(destination); // 唯一 redirect 點、相對路徑、try 外。
}
