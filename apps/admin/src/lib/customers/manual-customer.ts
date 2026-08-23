import 'server-only';
import { SYNTHETIC_EMAIL_BASE_DOMAIN } from '@pcm/schemas';

// manual-customer.ts — `#858` 片0-b:替「打電話來訂貨的散客」開一個後台用的客人檔案。
//
// 🔴 **為什麼需要這支**:`orders.customer_user_id` 是 NOT NULL 且 FK 到 `customers(user_id)`
//    (`supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql:95`),
//    而 `customers.user_id` 又 FK 到 `auth.users`(`20260523034911:15`)
//    ⇒ **沒有帳號的人,系統裡建不出他的訂單。** 散客正是沒有帳號的人。
//
// ── 🔴🔴 本檔的形狀換過一次,而換掉的理由值得寫在最上面 ─────────────────────────
//
// **舊形狀**:`createOrGetManualCustomer` —— 用電話查、查到就自動回既有帳號、查不到就建。
// codex 第二輪對它開了 **5 條 must-fix**(競態 / 電話正規化 fail-open / 身分鍵沒綁電話 /
// 隨機值沒契約 / 不是 fail-closed),而五條同一個根:
// **它把「找到唯一一個人」建立在一個沒有唯一性保證的欄位上**(`customers.phone` 無 UNIQUE)。
//
// 🔴 **而再往上一層問**:「同一個人第二次來要回到同一個帳號」**是誰要求的?**
//    **不是 Sean。** 他 2026-08-24 `Q1=甲` 要的是「散客也要有帳號、列表看得到真名」。
//    自動認回頭客是**寫規格的人自己加的**。⇒ **那五條 must-fix 全部來自一個沒有人要的功能。**
//    📌 判別句:**收到一堆 must-fix 的時候,先問一次「這東西是誰要的」,再問「怎麼修」。**
//
// **而「失去的只有客戶列表整潔」那句是錯的 —— 我把它收回**(codex R3 F1;2026-08-24 量過才改)。
//
// 🔴 **我當時查的是【員工】那一側**:訂單搜尋確實查得到
//    (`20260809180000:220-221` 比對 `customers.name/phone`;`:226-228` 比對收件快照三鍵)。
//    **而我沒有問「這條路是給誰用的」。**
//    **客人自己登入時,看到的是他【那一個帳號】的東西** ⇒ 帳號被切成兩個 ⇒ 他看不到另一半。
//
// **量到的分母(可重跑)**:
//    `grep -rh "CREATE POLICY.*_own" supabase/migrations/*.sql | sort -u | wc -l` ⇒ **16 道**
//    分佈的表(**表數也要有自己的量法,不要只給一個數字**;codex R4 F 項點名了我這一條):
//    `grep -rh "CREATE POLICY.*_own" supabase/migrations/*.sql | sed 's/.*ON //' | awk '{print $1}' | sort -u | wc -l`
//    ⇒ 2026-08-24 當下 **7** 張;下面這張清單是那一發的展開:
//      `orders` / `order_items`      訂單與明細(他看不到另一半的購買歷史)
//      `customer_addresses`          地址簿
//      `customer_vehicles`           我的愛車
//      `customer_favorites`          收藏
//      `customers`                   自己的資料、**會員等級 tier**、**錢包餘額**
//      `customer_wallet_ledger`      儲值金明細
//    🔴 **tier 與錢包那兩格是錢**:散客日後升級成經銷會員,升的是**其中一個**帳號;
//      另一個帳號上的單不吃那個等級。
//
// ⚠️ **這不代表丙是錯的**(丙讓髒**看得見**,舊設計是靜默的)——
//    但**代價要寫對,Sean 才有辦法判**。
//    ✅ **他已經在【這個 16 道版本】上重判過**(2026-08-24,`Q1=甲` 維持:列出候選讓員工挑)
//       ⇒ 封條解除,這段可以被引用成「他知道且接受的代價」。
//    ⚠️ 而**舊的錯句與新句都留著**(不是把舊句擦掉):他第一次答的是舊版本,那件事本身要看得見。
//
// **新形狀(丙;主視窗 2026-08-24 批)**:本模組**不再認人**。
//    ① `findCustomerCandidatesByPhone` —— 唯讀,回一個**清單**(0/1/多筆,後台開的與客人自己註冊的都回)
//    ② **員工在畫面上選**「掛到這一個」或「開一個新的」 ← 正是 Sean `Q1=甲` 批的那個畫面
//    ③ `createManualCustomer` —— **永遠建新的,永不自動重用**
//
// 🔴 **本檔【不】建 `customers` 那一列 —— 那是 trigger 的工作**:
//    `20260523034911:278-294` 的 `handle_new_auth_user()` 在 `auth.users` INSERT 之後自動 INSERT。
//    ✅ **跑出來過**(2026-08-23,拋棄式 PG 17.10;DDL 逐字切自 migration):
//       插一列 ⇒ `customers` 長出來;**負對照** `DROP TRIGGER` 後再插 ⇒ 不長。
//    ⚠️ **而它只證明「repo 這份定義會跑」,兩件事都還沒問**:
//       ① 正式庫上那條**今天還在不在** ② 與 repo **是不是同一版**(SQL Editor 熱修可以不同字)
//       ⇒ 兩者都要**正式庫權限**;**再跑一次拋棄式 PG 不算數**(同一把尺量兩次)。
//    ⇒ 所以 `createManualCustomer` **不信任 trigger,建完自己回頭確認那一列在**(見 E5 那段)。
//
// ── 威脅模型(Fable R2 2026-08-23)────────────────────────────────────────────
// 註冊最終走 `supabase.auth.signUp` = **GoTrue 公開端點**,anon key 就能直呼;Confirm email 是 **OFF**
// (`packages/adapters/src/supabase/SupabaseAuthAdapter.ts:37` 逐字)⇒ 直呼就拿得到**立即可用**的帳號。
// ⇒ 我方表單那兩道 denylist(client + server action)**不在攻擊者的路徑上**。
// ⇒ 真正缺的那道在 GoTrue(captcha / rate limit / allowed domains)= 平台面板設定、**沒有人量過** ⇒ 標未確認。
//    ⚠️ **不得為了確認它去實打正式站 signup**(會在正式庫建出真帳號)。
// ⇒ 本檔的兩道緩解:① 佔位信箱 local-part **不可枚舉**(見 `newPlaceholderEmail`)
//                    ② `app_metadata` 身分鍵 —— **只用來誠實標示,不用來自動認領**

/** 散客佔位信箱的網域。🔴 由 `@pcm/schemas` 的基底 derive,本檔不宣告字面(片0-a 的紀律)。 */
export const MANUAL_SYNTHETIC_EMAIL_DOMAIN = `manual.${SYNTHETIC_EMAIL_BASE_DOMAIN}`;

/** 身分鍵:蓋在 `app_metadata`(**只有 service_role 寫得到**、公開 signup 偽造不出來)。 */
export const MANUAL_PROVIDER = 'manual';

export type ManualCustomerInput = { name: string; phone: string };

/** 候選:同一支電話上找到的人。🔴 **本模組不挑,挑的人是員工。** */
export type ManualCustomerCandidate = {
  userId: string;
  name: string;
  email: string;
  /** 這個帳號存的電話原字面(可能是 `0912-345-678`);比對前要先正規化。 */
  phone: string | null;
  /**
   * 這個帳號是不是**後台自己開的**。
   * 🔴 由 `app_metadata` 身分鍵判定,**不是**看信箱網域 —— 網域是可以被搶註的
   *    (見上面威脅模型),而 `app_metadata` 只有 service_role 寫得到。
   * ⚠️ 這個旗標是**給員工看的資訊**,不是授權:本模組不會因為它是 true 就自動掛單。
   */
  isManual: boolean;
};

/**
 * 電話正規化 = 只留數字。
 *
 * ⚠️ **它不是身分鍵**(舊形狀才是)——它現在只是**搜尋提示**。
 * 🔴 **但不要讀成「所以不會認錯人」**(codex R3 F2 收回我原本那句):
 *    丙把認人的責任**改丟給員工**,**沒有消除錯綁的後果** ——
 *    員工在候選清單上點錯一個人,單子一樣掛到別人頭上。
 *    而候選清單來自 `admin_search_customers`,它**跨姓名 / Email / 電話**都會命中
 *    ⇒ 清單上可能出現**完全不同的人**。
 * ⇒ **片1 必須補真正的擋板**(讓員工看得出「這是誰、憑什麼是他」),
 *    不得因為「認人交給員工了」就少做那一格。
 */
export function normalizeManualPhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * 產生散客佔位信箱 —— local-part **由本模組自己產**,不收外面給的值。
 *
 * 🔴🔴 **E4(codex R1)**:舊版收 caller 給的 `randomId` ⇒ 空值、固定值、**手機號**都合法
 *    ⇒ 「不可枚舉」只是一句註解。現在它是**程式契約**:`crypto.randomUUID()` 在模組內呼叫。
 * 🔴 **為什麼不可枚舉**:手機號可枚舉 ⇒ 有人能照號碼段**批次搶註** ⇒ 我們每建一張散客單都撞號。
 */
function newPlaceholderEmail(): string {
  return `manual_${crypto.randomUUID()}@${MANUAL_SYNTHETIC_EMAIL_DOMAIN}`;
}

/** 本模組需要的 client 形狀(注入用;真身是 `createSupabaseServiceClient()`)。 */
export type ManualCustomerClient = {
  rpc(
    fn: 'admin_search_customers',
    args: { p_query: string; p_limit: number },
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
  auth: {
    admin: {
      createUser(attrs: {
        email: string;
        email_confirm?: boolean;
        app_metadata?: Record<string, unknown>;
        user_metadata?: Record<string, unknown>;
      }): Promise<{ data: { user: { id: string } | null }; error: { code?: string; message?: string } | null }>;
      getUserById(id: string): Promise<{
        data: { user: { app_metadata?: Record<string, unknown> } | null };
        error: { message?: string } | null;
      }>;
    };
  };
  from(table: 'customers'): {
    select(cols: 'user_id,name,email,phone'): {
      in(col: 'user_id', ids: string[]): Promise<{
        data: Array<{ user_id: string; name: string; email: string; phone: string | null }> | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

export type CandidateLookupResult = {
  candidates: ManualCustomerCandidate[];
  /** 命中太多被截斷 ⇒ 畫面必須說出來(靜默截斷會讓員工以為就這幾個)。 */
  truncated: boolean;
  /**
   * 同電話帳號數 —— 🔴 **只在【查回來的候選】範圍內**,不是全庫的確切數。
   *
   * ⚠️ **我原本寫「這支電話上【確切】有幾個帳號」—— 那句是假的**(codex R4 E1):
   *    候選來自 `admin_search_customers` 且**夾了 `CANDIDATE_LIMIT` = 20**
   *    ⇒ 命中超過 20 筆時,本欄數的是**被截斷之後**的那一段。
   *    ⇒ **我又一次把一個上限夾過的分母,宣稱成完整的分母。**
   *
   * 🔴 **與 `candidates.length` 也不是同一個數**:那支 RPC 是**跨姓名 / Email / 電話**的子字串搜尋
   *    ⇒ 一串數字也可能命中某人的 Email。本欄只數「正規化後電話真的相同」的那些。
   */
  samePhoneCount: number;
  /**
   * 要不要在建單畫面出**警告**(Sean 2026-08-24 `Q2=甲`)。
   *
   * 🔴 **是警告不是擋** —— 他明講**不設硬上限**。本模組**不得**因為這個旗標拒絕建帳號。
   * 🔴 **`truncated` 也算警告條件**(E1 的 fail-safe):命中多到被截斷時,
   *    `samePhoneCount` 反而可能偏小 ⇒ **不能因為「數出來只有 2」就安靜**。
   *    截斷本身就代表「這支電話周邊的帳號多到看不完」。
   */
  shouldWarnDuplicates: boolean;
};

const CANDIDATE_LIMIT = 20;

/**
 * 超過幾個就警告(Sean 2026-08-24 `Q2=甲` 逐字:「一支電話不設硬上限,但**超過 2 個**就在建單畫面出現警告」)。
 * ⇒ 2 個 = 不警告;3 個 = 警告。
 */
export const DUPLICATE_ACCOUNT_WARN_THRESHOLD = 2;

/**
 * 電話最少要幾個數字(codex R4 D1)。
 * 🔴 **對齊既有的註冊規則**,不自己發明:`packages/schemas/src/index.ts:46`
 *    `phone: z.string().regex(/^[\d\s-]{8,}$/)` —— 那條線上的最小長度就是 8。
 */
export const MIN_PHONE_DIGITS = 8;

/**
 * 🔴 **數的是「所有帳號【類型】」,含客人自己在前台註冊的 —— 這一格是我判的,理由留檔**:
 * ⚠️ **「所有」指的是【不分帳號是誰建的】,不是【全庫沒有遺漏】** —— 後者不成立,見 `samePhoneCount` 的截斷說明。
 *
 * Sean 沒有指定數哪些。而**警告要防的那個傷害是「一個人的歷史被切成好幾份」**
 * (`orders` / `order_items` / 地址 / 愛車 / 收藏 / tier / 錢包,7 張表 16 道 `_own` policy)——
 * **那個傷害不分帳號是誰建的**:員工開的第二個,與客人自己註冊的那個,對他來說是一樣的分裂。
 * ⇒ 只數 manual 帳號會**系統性低估**,而低估的方向正好是「不警告」= 靜默,那是本片一直在修的病。
 */
function countSamePhone(candidates: ManualCustomerCandidate[], normalizedPhone: string): number {
  return candidates.filter((c) => normalizeManualPhone(c.phone ?? '') === normalizedPhone).length;
}

/**
 * 用電話找候選客人(**唯讀**)。
 *
 * 🔴 **用現成的 `admin_search_customers` RPC,不自己寫查詢**(`20260816010000:213` 已 GRANT service_role)。
 *    理由不是省事:那支把**存起來的電話也去掉非數字**再比
 *    (`:121` `regexp_replace(lower(phone),'[^0-9]','','g')`,並有對應索引)
 *    ⇒ **客人自己在前台註冊時填的 `0912-345-678` 也找得到**。
 *    自己寫 `.eq('phone', 正規化值)` 會**系統性漏掉那些人** —— 而漏掉他們正是 `C-F1` 那個病
 *    (員工零訊號、靜默開出平行影子帳號、**客人日後登入看不到自己的單**)。
 *
 * ⚠️ **效度限制,畫面要照實說**:那支 RPC 是**子字串**比對 ⇒ 搜 `0912345678` 也會命中
 *    `10912345678` 這種包含它的號碼。**候選清單是「像的人」,不是「同一個人」。**
 */
export async function findCustomerCandidatesByPhone(
  client: ManualCustomerClient,
  rawPhone: string,
): Promise<CandidateLookupResult> {
  const phone = normalizeManualPhone(rawPhone);
  if (phone === '') {
    return { candidates: [], truncated: false, samePhoneCount: 0, shouldWarnDuplicates: false };
  }

  const res = await client.rpc('admin_search_customers', { p_query: phone, p_limit: CANDIDATE_LIMIT });
  if (res.error) throw res.error;
  const payload = res.data as { ids?: unknown; truncated?: unknown } | null;
  if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.ids)) {
    // 🔴 形狀不對 ⇒ 拋。靜默回空清單會讓「查不到」與「查壞了」長得一模一樣。
    throw new Error('findCustomerCandidatesByPhone:admin_search_customers 回傳形狀不對');
  }
  const ids = payload.ids.filter((v): v is string => typeof v === 'string');
  if (ids.length === 0) {
    return {
      candidates: [],
      truncated: payload.truncated === true,
      samePhoneCount: 0,
      shouldWarnDuplicates: false,
    };
  }

  const rows = await client.from('customers').select('user_id,name,email,phone').in('user_id', ids);
  if (rows.error) throw rows.error;

  const candidates: ManualCustomerCandidate[] = [];
  for (const row of rows.data ?? []) {
    const user = await client.auth.admin.getUserById(row.user_id);
    if (user.error) throw user.error;
    candidates.push({
      userId: row.user_id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      isManual: (user.data.user?.app_metadata ?? {}).pcm_provider === MANUAL_PROVIDER,
    });
  }
  const samePhoneCount = countSamePhone(candidates, phone);
  return {
    candidates,
    truncated: payload.truncated === true,
    samePhoneCount,
    // 🔴 截斷 ⇒ 一律警告(見 `shouldWarnDuplicates` docstring 的 fail-safe 理由)
    shouldWarnDuplicates: payload.truncated === true || samePhoneCount > DUPLICATE_ACCOUNT_WARN_THRESHOLD,
  };
}

/**
 * 建一位**新的**散客客人檔案。
 *
 * 🔴 **它永遠建新的,不會自動重用任何既有帳號** —— 要掛到既有帳號是**員工在畫面上選的**,
 *    走的是別的路(片1 拿 `findCustomerCandidatesByPhone` 的結果讓他挑)。
 *    這正是舊形狀那五條 must-fix 的根被拔掉的地方:**本模組不再宣稱它認得出誰是誰。**
 */
export async function createManualCustomer(
  client: ManualCustomerClient,
  input: ManualCustomerInput,
): Promise<
  { ok: true; userId: string } | { ok: false; reason: 'invalid_phone' | 'invalid_name'; message: string }
> {
  // 🔴🔴 **信任邊界的輸入驗證(codex R4 D1)**:原本只擋「零個數字」
  //    ⇒ **空姓名、`phone='1'` 都能建出一個【正式的 auth user】**,而且那種帳號刪不掉、還會
  //      讓候選搜尋變成極寬的子字串搜尋(`'1'` 幾乎命中所有人)。
  //    ⚠️ 這一格**不因為「今天沒有呼叫端」而可以省** —— 它建的是真的帳號。
  const name = input.name.trim();
  if (name === '') {
    return { ok: false, reason: 'invalid_name', message: '請填寫客人姓名 —— 訂單列表要靠它才認得出這張單是誰的。' };
  }
  const phone = normalizeManualPhone(input.phone);
  if (phone.length < MIN_PHONE_DIGITS) {
    return {
      ok: false,
      reason: 'invalid_phone',
      message: `請填寫完整的聯絡電話(至少 ${MIN_PHONE_DIGITS} 個數字)—— 太短的號碼會在找客人時撈出一大堆不相干的人。`,
    };
  }

  const email = newPlaceholderEmail();
  const created = await client.auth.admin.createUser({
    email,
    email_confirm: true,
    // 身分鍵(service_role-only);trigger 不讀這一欄。電話一起蓋著,供日後稽核比對。
    app_metadata: { pcm_provider: MANUAL_PROVIDER, pcm_manual_phone: phone },
    // trigger 從這裡取 name / phone 寫進 customers(`20260523034911:283-285`)。
    user_metadata: { name, phone },
  });
  if (created.error) throw created.error;
  const id = created.data.user?.id;
  if (!id) {
    throw new Error('createManualCustomer:createUser 成功但沒有回 user.id');
  }

  // 🔴🔴 **E5(codex R1):不信任 trigger,回頭確認那一列真的在。**
  //
  // ⚠️ **誠實揭示(codex R3):這一發【不是】與 createUser 同一個原子操作。**
  //    確認查詢自己斷線時,下面會拋 —— 而**已經建好的 auth user 與 customers 列不會回滾**
  //    ⇒ **員工重試會再建一個帳號**,正好放大「無界累積」那條。
  //    ⇒ 真正的修法是把兩件事包進一個 RPC(交易內),那是 schema 層的事、要另一輪
  //      ⇒ **本片不做,寫進未做清單。** 這裡先讓它**拋而不是靜默成功**。
  //    本檔頭自己寫著「正式庫上那條 trigger 存在/同版未確認」——
  //    **一個自己宣告了不確定的前提,不可以在下一行當成成立。**
  //    trigger 缺席時舊版會回 `ok:true`,而下一步建單才撞 FK(錯誤出現在離成因很遠的地方)。
  const check = await client.from('customers').select('user_id,name,email,phone').in('user_id', [id]);
  if (check.error) throw check.error;
  const row = (check.data ?? [])[0];
  if ((check.data ?? []).length !== 1 || !row) {
    throw new Error(
      `createManualCustomer:帳號建好了,但 customers 那一列沒有出現(user_id=${id})——` +
        '請找工程確認 on_auth_user_created trigger 是否還在。這張單先不要建。',
    );
  }
  // 🔴 **不只驗「有一列」,要驗那一列的【值】對**(codex R3):
  //    trigger 存在但**寫錯值**(取錯 metadata 鍵、欄位錯位)⇒ 只數列數的話**照樣成功**,
  //    而錯的資料會一路帶到訂單上。三個欄位都是我們剛剛送進去的,對得起來。
  if (row.email !== email || row.name !== name || (row.phone ?? '') !== phone) {
    throw new Error(
      `createManualCustomer:customers 那一列出現了,但內容對不上(user_id=${id})——` +
        'trigger 可能改過或取錯欄位。請找工程確認,這張單先不要建。',
    );
  }
  return { ok: true, userId: id };
}
