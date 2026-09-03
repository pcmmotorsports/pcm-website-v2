// app/account/page.tsx — 會員中心(server 守門 + 取 user/stats/featured/profile/addresses → client AccountView)
//
// 對齊 design-reference/components/AccountPages.jsx AccountPage(L310-681)。
//
// 🔴🔴 **要照 OD 的 `pcm-home-redesign/account-page.html` 做這一頁的人,先讀這一段。**
//    (2026-08-30 線D;而本檔對齊的是 `design-reference`,那是【另一份】設計來源 ——
//     兩份都存在,而它們對這一塊講的話不一樣。)
//
//    那支稿的訂單概覽塊(`acc-glance`)逐字寫著:
//        <div class="acc-glance-sub">出貨後會通知你預計送達日</div>
//    🛑 **那句話【不能照抄上線】,而理由有兩層:**
//      ① ⛔ ~~**「會通知」那一半今天做不到** —— 出貨通知信的整條管線都建好了
//         (view / use case / 模板 / cron 都在),**而沒有任何一行碼呼叫它**~~
//         🔴 **2026-09-03 訂正:碼路徑已接上(一個真的 `await`)。**
//            🛑 **而【客人真的會收到】= 未量測, 不要從那一格推出來** —— 見本段末。
//         ⛔ ~~數法原本寫「`enqueueOrderShippedEmails(` 全 repo 呼叫端 ⇒ 0;
//            正對照 `sweepEmailOutbox(` ⇒ 2」~~
//         🔴🔴 **2026-08-30 線【客人帳戶區】`-eb`:那條指令今天照跑會得 3, 不是 0** ——
//            **因為上面這句註解自己就是其中一個命中**(另外兩個是定義檔與同名 `.test.ts`)。
//            📌 **⇒ 一句記錄「這裡沒有呼叫端」的註解, 自己變成了那個命中。**
//            ⇒ 而 3 看起來就像「它被接上了」⇒ **下一個重量的人會得到相反的結論。**
//         ✅ **⇒ 換成這把(兩件事一起做:只掃 `apps/`、濾掉註解行):**
//            `git grep -n "enqueueOrderShippedEmails" -- apps | grep -vE ':[0-9]+: *(//|\*)' | wc -l`
//            · `-- apps` 的理由:**定義與 barrel re-export 都住 `packages/`, 它們不是呼叫端**
//            · 濾註解的理由:那正是把 0 變成 3 的東西
//         🔴 **三發實跑(同一條命令只換名字), 而第三發才是重點**:
//            `enqueueOrderShippedEmails` ⇒ **0**
//            正對照 `sweepEmailOutbox` ⇒ **6**(`app/api/cron/email-sweep/route.ts` 的 import + 真的 `await`)
//            負對照 `zzzNotAFunction` ⇒ **0**
//            ⇒ **沒有那個 6, 上面那個 0 與「這把尺撈不到任何呼叫端」印同一個數字。**
//         ⚠️ **上面那三發是 2026-08-30 的讀數。⛔ ~~「而結論沒有變:正式呼叫端仍然是 0」~~**
//         🔴 **2026-09-03 用【同一把尺】重跑 ⇒ 命中 3, 不是 0** ——
//            而 **3 是 grep 命中數;呼叫端是 1**(`api/cron/email-sweep/route.ts:425` 真的 `await`;
//            另兩個是同檔 `:45` import 與 `route.test.ts:47` fixture)。
//            ⇒ ✅ **碼路徑已接上。** 而 `shipped-email-cutoff.ts` 檔頭同一句也一起訂正了。
//
//         🛑🛑 **而【客人真的會收到嗎】這一格 —— 我沒有量, 而它不在這把尺的射程裡**:
//            整條線由 env `SHIPPED_EMAIL_CUTOFF` 控;沒設 ⇒ `skipped_no_cutoff` ⇒ **一封都不寄**,
//            而 `route.ts:396-399` 逐字:「Sean 以為他上膛了, 而一封都不會寄, 且沒有任何東西會吵」。
//            ⇒ 📌 **grep 在「env 有設」與「沒設」兩個世界印同一個 3** ⇒ 對這個問題**零判別力**。
//            ⇒ ⛔ ~~判別訊號 = `shippedEnqueueStatus === 'completed'`~~ **必要而不充分**
//              (code-reviewer R2 nit):`route.ts:408-413` 在 env 合格的**當下**就設成 `completed`
//              ⇒ **enqueue 了 0 筆與 50 筆印同一個字** ⇒ 對「客人真的會收到」一樣零判別力。
//              📌 **⇒ 我寫的那個訂正, 犯的正是它自己在講的那個病。**
//            ⇒ ✅ 判別訊號 = `shippedEnqueueStatus === 'completed'` **且**同一則 log 的
//              `shippedEnqueueCounts.enqueued > 0`。
//
//         🛑🛑 **而那句稿上的話【仍然不能上線】—— 理由換成只剩 ② 那一半, 而它比 ① 硬**:
//            稿承諾的是「預計送達日」,而我們的出貨信給的是 **箱號 / 貨運 / 追蹤碼**
//            (量 2026-09-03,`sweep-email-outbox.ts` 的 `buildOrderShippedText` 函式體:
//             `送達|到貨|預計` ⇒ **0**;🟢 正對照同段 `追蹤碼` ⇒ **4**、`title` ⇒ **1**
//             ⇒ 尺會動, 而那個 0 不是尺沒接上)。
//            📌 **⇒ 現在通知得到了, 而通知的內容裡【沒有那個日期】。**
//            ⇒ ⇒ 🔴 **所以下一個人不要因為「①  已經解決了」就把這句話接上去** ——
//              ① 只是**碼路徑**解決了;而攔阻仍有兩道:**env 上膛沒**(未量), 與 ② **Sean 拍的先不做**。
//      ② 🔴 **「預計送達日」那一半【Sean 說先不做】** ——
//         2026-08-29 他逐字:「預計到貨(od-head-eta)⇒ 先不做(等有到貨日資料再說)」
//         (`memory/project_0829-sean-three-rulings-order-detail-blocks.md`)
//         ⇒ 沒有到貨日資料 ⇒ 那句承諾我們給不起。
//
//    📌 **⇒ 而稿本身不會告訴你這兩件事 —— 稿不知道自己過期了。**
//    ✅ **⇒ 今天客人看得到的地方【零通知承諾】**(顧客站與法律頁掃過:「會通知/通知您/
//       通知你/寄出後」全 0;而「出貨後」那幾處講的是到貨時間)⇒ **所以還沒有人被違約。**
//    ⇒ 要做的話:先接那條線(plan 在 `~/pcm-mailbox/plan-線D-出貨通知接線-20260830.md`),
//      而文案只能講【已出貨 + 單號】,不能講送達日。
// g-1a 殼 + 7-tab nav;g-2 接 overview/orders tab 真資料(stats + featured)+ Issue 1
// LINE 合成 email 過濾(server-side、line.ts 為 server-only 不可洩到 client);
// g-4a 擴 select 5 欄(+ name/phone/birthday)+ profile prop 傳 AccountView(Q4=A SoT)。
// g-5a 讀收件地址清單(getAddressRepo→listByCustomer、RLS 守自己 row)+ addresses prop 傳 AccountView
// (AddressTab 列表;g-5b 接新增表單 addAddressAction;編輯/刪除/設預設留 g-5c)。
//
// server 守門(codex 關卡1 finding-2/5):用 getUser()(向 auth server 驗 JWT、非可偽造的
// getSession)→ 無 user 就 redirect('/login')。直打網址也擋;Header 條件路由(g-1b)僅 cosmetic。
//
// dynamic:本頁經 createServerSupabaseClient 讀 cookies()、本就走動態 render;force-dynamic 為
// 顯式標記、非安全必需(安全靠 getUser 守門本身)。
//
// g-2 資料路徑(對齊 plan v2 決策 1):
// - tier + wallet_balance 走 createServerSupabaseClient 直查 customers(RLS customers_select_own
//   涵蓋、authenticated role),不繞 SupabaseWalletAdapter(後者強制 service_role writeClient
//   ctor、storefront 不允許注入 service_role)。
// - featured 走既有 fetchFeaturedProducts()(server-only;perf/P3 起函式本身釘 general +
//   unstable_cache 60s,內層 listAllProducts({limit:4, orderBy:'created_desc'}) 全目錄最新前 4)。
//   前菜 D 起與首頁共用同一「最新商品」資料源(created_at 遞減)、非舊 id 升冪。
// - row missing(PGRST116、極罕、trigger handle_new_auth_user 應已建)或 RLS 失敗 → 退化
//   tier='general' + walletBalance=0、console.error 警示、頁面不 500。
//
// g-2 Issue 1(LINE 合成 email 過濾、codex k1 round2 M-r2-1):
// - LINE_SYNTHETIC_EMAIL_DOMAIN 在 lib/auth/line.ts 為 server-only export;
//   page.tsx(server)端比對、過濾後傳 displayEmail / isSyntheticEmail 給 client AccountView;
//   AccountView 不 import line.ts(避免破 client/server 邊界)。
//
// g-4a profile SoT(Sean 拍 Q4=A、2026-05-28):
// - select 改 5 欄 `name, phone, birthday, tier, wallet_balance`(原 2 欄擴 3 欄)
// - name 來源優先 customers.name(SoT)→ user_metadata.name 退化 fallback(新用戶 trigger
//   handle_new_auth_user 已寫 customers.name from user_metadata、極罕 row missing 才走 fallback)
// - profile prop forward AccountView:{ name, phone, birthday }、用於 g-4b ProfileTab form 初值
// - phone/birthday null → '' 還原成 form-friendly 字串(domain 為 string|null、form 用 string)

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getAddressRepo, getVehicleRepo, getOrderRepo, getFavoritesRepo } from '@/lib/auth/composition';
import { AccountView } from '@/components/account/AccountView';
// 🔴 **分頁清單從 `account-nav.ts` 拿, 不從 `AccountView` 拿**(2026-08-27 真瀏覽器抓到):
//    `AccountView` 有 `'use client'` ⇒ 從 server component import 它的普通 export
//    拿到的是 client reference 不是陣列 ⇒ 執行期 500, 而**單元測試全綠**(vitest 沒有 RSC 邊界)。
import { ACCOUNT_TAB_IDS, type AccountTabId } from '@/components/account/account-nav';
import { fetchFeaturedProducts, fetchVehicleTaxonomy } from '@/lib/products';
import { LINE_SYNTHETIC_EMAIL_DOMAIN } from '@/lib/auth/line';
import { toMemberTier } from '@pcm/domain';
import { mapSupabaseWalletEntryToDomain, narrowGender } from '@pcm/adapters';
import type {
  MemberTier,
  CustomerAddress,
  CustomerVehicle,
  OrderListItem,
  FavoriteListItem,
  WalletLedgerEntry,
} from '@pcm/domain';

/**
 * 儲值金明細一次顯示幾筆(#202 解凍第一片)。
 *
 * 🔴 **這一版【不分頁】** —— 而那不是省事,是**刻意的**:
 * 分頁會逼出「當時餘額」那一欄的累加問題(plan `§3-b`:前端累加在第二頁起全錯而不會紅),
 * 而 Sean `Q3=乙` 已經拍板**不顯示那一欄** ⇒ 這一版連那個問題都不存在。
 * ⚠️ **代價明寫**:超過 20 筆的客人**看不到更舊的**,而畫面上**不會說**。
 *    ⇒ 這是本片的已知缺口,列進交件;要補的是分頁,不是把 20 改大。
 */
const WALLET_LEDGER_LIMIT = 20;

export const dynamic = 'force-dynamic';

/**
 * `?tab=` → 首屏分頁(2026-08-27;Sean 拍 **B** = 只修「回不來」)。
 *
 * 🔴 **不合法的值安靜落在總覽,不報錯**(Sean `Q1` 拍甲)。
 *    ⚠️ **而那個選擇的代價要留在這裡,因為它是他讀過之後選的、不是我們沒想到**:
 *    **哪天我們改了分頁的代號(例如 `orders` 改名),舊書籤與舊連結會【安靜地】落在總覽,
 *      而客人不會回報 —— 他只會覺得「怎麼跳錯了」然後自己再點一次。**
 *    ⇒ 要改 `NAV` 的 id 之前,先想一下這一段。
 * 🔴 **合法值的唯一來源是 `NAV`**(`account-nav.ts`)—— 這裡**不再打一份七個字串**:
 *    兩份清單會漂,而漂掉的那天這裡會把一個合法分頁判成不合法、安靜落總覽。
 */
function tabFromSearchParams(raw: string | string[] | undefined): AccountTabId | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string') return undefined;
  return ACCOUNT_TAB_IDS.includes(v as AccountTabId) ? (v as AccountTabId) : undefined;
}

export default async function AccountPage(
  // 🔴 **整個參數選填,不只 `searchParams` 選填**:既有測試以 `AccountPage()` 零引數呼叫
  //    (`page.test.tsx` 有 4 處)⇒ 若寫成必填,那 4 格會因為**簽名**而紅,
  //    而它們一格都不是在測分頁。**那種紅會逼下一個人去改測試,而測試沒有錯。**
  //    ⚠️ 而 Next 真的呼叫時一定會給 —— 選填只影響測試那一側。
  //    🔴 **而它有一個【未來】的代價,寫下來**(code-reviewer 2026-08-27 nit):
  //       自己寫的 inline 型別讓 Next 生成的 `PageProps<'/account'>` **完全不參與** ——
  //       哪天 `searchParams` 的契約再變(它在 Next 15→16 已經變過一次:同步 → Promise),
  //       **這支檔不會紅,而測試餵的是我自己寫的同一個形狀,也不會紅。**
  props?: { searchParams?: Promise<Record<string, string | string[] | undefined>> },
) {
  const initialTab = tabFromSearchParams((await props?.searchParams)?.tab);
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // #190:未登入 → /login 帶 next=/account,登入成功後導回會員中心(非一律首頁)。
  if (!user) redirect(`/login?next=${encodeURIComponent('/account')}`);

  const rawEmail = user.email ?? '';

  // Issue 1:LINE 合成 email(line_{sub}@line.pcmmotorsports.local)不可顯 UI、避免後端身分識別洩漏
  const isSyntheticEmail = rawEmail.endsWith(`@${LINE_SYNTHETIC_EMAIL_DOMAIN}`);
  const displayEmail = isSyntheticEmail ? '' : rawEmail;

  // ── 儲值金明細(#202 解凍第一片;Sean 2026-08-26「甲 只顯示餘額和明細」)──────
  //
  // 🔴🔴 **這一發【刻意排在 customers 查詢之前】**(對抗審查 must-fix,2026-08-26):
  //    餘額與明細是**兩發獨立查詢**,中間有人寫入的話畫面會同時顯示兩個時點的東西。
  //    ⇒ 跨兩發 PostgREST 呼叫**做不出交易** ⇒ 不一致消不掉,**而方向可以選**。
  //
  //    🔴🔴 **我上一版寫的理由是【假的】,而它假得很有說服力**(`code-reviewer` R1 Critical):
  //    我寫「先讀明細後讀餘額 ⇒ 餘額永遠不比明細舊 ⇒ 最壞是餘額比明細多,**不是**餘額 0 而下面有交易」。
  //    **前半對,後半錯。** 中間 commit 的若是一筆 `use`(結帳折抵,`migration:110` CHECK `amount < 0`),
  //    餘額會**變小**而明細沒有那一筆 ⇒ **得到的正好是我宣稱排除掉的那個畫面。**
  //    📌 **「餘額比較新」推不出「餘額比較大」** —— 我把一個方向性結論當成了值的結論。
  //
  //    ✅ **排序的選擇仍然成立,而理由要換成誠實的那句**:
  //      **兩個方向都有難看的畫面,而我們選【餘額是兩者中較新的那個】** ——
  //      因為餘額是客人真正會拿去用的數字,而明細是解釋它的東西。
  //      **讓解釋落後於數字,比讓數字落後於解釋好。**
  //
  // 🔴 **不走 `SupabaseWalletAdapter`** —— 本檔 `:18-19` 逐字寫著它「強制 service_role
  //    writeClient ctor、storefront 不允許注入 service_role」。service_role 是 BYPASSRLS
  //    ⇒ 一旦注進來,下面那道 RLS 與上面那道 `getUser()` **同時失效**,而畫面一模一樣。
  //
  // 🔴 **客人是誰由 `auth.uid()` 決定,不是由任何傳進來的參數**:
  //    `20260523034911_init_customers_and_subtables.sql:209-211` 逐字
  //      CREATE POLICY wallet_select_own ON customer_wallet_ledger
  //        FOR SELECT TO authenticated USING (auth.uid() = customer_user_id);
  //    ⇒ 就算有人塞別人的 id,SQL 撈不到那些列。**這不是「我們小心不傳」,是結構上撈不到。**
  //
  // 🔴 **排序帶唯一鍵 `id`**(`docs/patterns/pagination-loop-review.md` 第五條):
  //    `entry_date` 是 date、`created_at` 可能同秒 ⇒ 只靠它們排序時同分那幾筆順序未定義。
  //    形狀抄自 `SupabaseWalletAdapter.listEntries`(那裡的註解寫著同一個理由),**不 import 它**。
  let walletEntries: WalletLedgerEntry[] = [];
  let walletEntriesFailed = false;
  /** 這位客人的明細總筆數。`null` = 沒拿到(而那時 `walletEntriesFailed` 必為 true)。 */
  let walletEntryTotal: number | null = null;
  {
    const {
      data: ledgerRows,
      error: ledgerError,
      count: ledgerCount,
    } = await supabase
      .from('customer_wallet_ledger')
      // 🔴 `count: 'exact'` 由伺服器對【整個篩選集】算,不受 `db-max-rows` 限制。
      //    **沒有它,畫面上的「N 筆」會是【這一頁的筆數】假扮成【總筆數】**
      //    —— 第 21 筆起被截掉而畫面照樣說「20 ENTRIES」。(對抗審查 must-fix)
      .select('id, customer_user_id, entry_date, entry_type, amount, note, related_order_id, created_at', {
        count: 'exact',
      })
      .eq('customer_user_id', user.id)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(WALLET_LEDGER_LIMIT);
    // 🔴 **三種失敗都當失敗,不挑一種**(對抗審查 must-fix:`data=null && error=null` 這組
    //    本來被 `?? []` 吃成「他真的沒交易」):
    //      ① error 有值 ② data 是 null 而 error 也是 null ③ count 沒回來
    //    ③ 的理由抄自 `SupabaseWalletAdapter.listEntries`:**「共 N 筆」是這個畫面的地基,
    //      沒有 N 就是讀取失敗,不是「總數 0」** —— 靜默轉 0 會印出「顯示 20 筆 / 共 0 筆」。
    if (ledgerError || ledgerRows === null || ledgerCount === null) {
      // 🔴 **讀不到 ≠ 沒有交易** —— 退化成空陣列會讓畫面對客人說「尚無交易紀錄」,而那是說謊。
      //    ⇒ 帶一個獨立旗標上去,由 `WalletTab` 顯示「暫時讀不到」。頁面仍 200、不倒其他分頁。
      console.error('[account/page] 儲值金明細讀取失敗:', {
        error: ledgerError,
        rowsIsNull: ledgerRows === null,
        countIsNull: ledgerCount === null,
      });
      walletEntriesFailed = true;
    } else {
      // 🔴 用 `@pcm/adapters` 的既有 mapper,**不在這裡抄一份欄位對照** —— 兩份會漂,
      //    而漂了之後畫面照樣顯示得出東西(欄位對錯了只是金額或日期變成別的)。
      walletEntries = ledgerRows.map(mapSupabaseWalletEntryToDomain);
      walletEntryTotal = ledgerCount;
    }
  }

  // g-4a Q4=A:select 5 欄(+ name/phone/birthday;tier + wallet_balance 沿用 g-2 path)
  const { data: customerRow, error: customerError } = await supabase
    .from('customers')
    .select('name, phone, birthday, gender, tier, wallet_balance')
    .eq('user_id', user.id)
    .single();

  let tier: MemberTier = 'general';
  let walletBalance = 0;
  /**
   * 🔴 **餘額【沒讀到】** —— 與 `walletBalance === 0` 是兩件事(對抗審查 must-fix)。
   * customers 查詢失敗時餘額退化成 `0`,而**明細那一發可能是成功的**
   * ⇒ 客人會看到「NT$ 0」配著一串真實交易 ⇒ **那是在對他顯示一個錯的金額。**
   */
  let walletBalanceFailed = false;
  // name SoT:customers.name 為主、user_metadata.name 退化 fallback(g-4a Q4=A)。
  const metadataName = (user.user_metadata?.name as string | undefined) ?? '';
  let name = metadataName;
  let phone = '';
  let birthday = '';
  let gender = '';
  if (customerError) {
    // PGRST116(row missing、trigger handle_new_auth_user 應已建、極罕)或 RLS/session 異常 → 退化、不 500
    console.error('[account/page] customers row 讀取失敗、退化 general/0/metadata-name:', customerError);
    // 🔴 餘額那一格改成「讀不到」而不是「0」—— 見上面 `walletBalanceFailed` 的理由。
    walletBalanceFailed = true;
  } else if (customerRow) {
    // DB enum member_tier ('general'|'store'|'premiumStore') 與 MemberTier TS type 字面一致(migration L8 + L32-33)
    // 🔴 `#873` 同款(派工單只點名 checkout,而**這裡是同一個病的第二個現場**):
    //    裸 cast ⇒ DB enum 多一個值就把 TS 不認得的字串放進 tier。
    //    退化方向照 `lib/tier.ts` 拍板:只准往下、不得回經銷 tier;而且不得靜默。
    const parsedTier = toMemberTier(customerRow.tier);
    if (parsedTier === null) {
      console.error('[account/page] customers.tier 是本版不認得的值、退化 general:', customerRow.tier);
    }
    tier = parsedTier ?? 'general';
    walletBalance = customerRow.wallet_balance;
    // Q4=A:customers.name 為主、空字串退化 user_metadata.name(極罕、trigger 應已同步)
    name = customerRow.name || metadataName;
    // phone/birthday domain string|null → form 用 string、null/undefined 還原 ''
    phone = customerRow.phone ?? '';
    birthday = customerRow.birthday ?? '';
    // 🔴 `gender` 走同一條「domain null → form ''」的路,而它多一格要講:
    //    `''` 在表單上是「不選擇」,而 DB 的 `null` 同時代表「沒被問」與「問了沒填」
    //    ⇒ 兩者在這裡被壓成同一個 `''`。**那是刻意的** —— 表單表達不了「沒被問」,
    //      而想表達「我不說」的人有 `undisclosed` 可以選。
      // 🔴 走 `narrowGender` 而不是裸 cast —— codex R1 nit,而它是對的:
    //    裸 cast 時,DB 裡一個本版不認得的值會**原樣進到 select 的 value**
    //    ⇒ 那顆下拉停在一個【沒有對應 option】的值上,而且沒有任何 log。
    //    ⇒ `narrowGender` 認不得就回 null + `console.error` ⇒ 畫面退回「不選擇」而留下鑑識。
    gender =
      narrowGender((customerRow as { gender?: string | null }).gender, 'account/page') ?? '';
  }

  // g-2:推薦走 fetchFeaturedProducts、走 Supabase 真資料(非 mock)
  //
  // ⚠️ tier-aware pricing 暫不接(codex k2 round1 must-fix#1 + 三級會員價格鐵則):
  //   products_public projection 把 store/premiumStore 價設 dummy 0
  //   (packages/adapters/src/supabase/mappers/product.ts L139/L143、避免經銷敏感洩 public view)、
  //   toUIProduct(p, tier) 套 computeEffectivePrice 後對 store/premiumStore 會顯「NT$ 0」。
  //   M-1-16 接 server-side tier-aware price endpoint 後才能真按 tier 顯示。
  //   g-2 階段先固定走 'general' 公開價(視覺對齊 design + 不顯 NT$ 0 + 不洩經銷價),
  //   manifest 已揭示 business override「推薦固定 general、tier-aware 待 M-1-16」。
  //   perf/P3 起 fetchFeaturedProducts 本身釘 'general'(unstable_cache 60s、不再收 tier 參數
  //   ——本頁原本就固定 general、語意不變)。
  const featured = await fetchFeaturedProducts();

  // g-5a:讀自己的收件地址清單(getAddressRepo→listByCustomer、RLS addresses_*_own 守自己 row)。
  // 鏡像 customers 讀的退化 pattern:adapter error(RLS/連線異常)→ 退化空陣列 + console.error、頁面不 500
  // (AddressTab 走空狀態)。新增表單(addAddress)g-5b 已接;編輯/刪除/設預設留 g-5c。
  let addresses: CustomerAddress[] = [];
  try {
    addresses = await (await getAddressRepo()).listByCustomer(user.id);
  } catch (addressError) {
    console.error('[account/page] addresses 讀取失敗、退化空陣列:', addressError);
  }

  // g-6a:讀自己的愛車清單(getVehicleRepo→listByCustomer、RLS vehicles_*_own 守自己 row)。
  // 鏡像 g-5a addresses 退化 pattern:adapter error(RLS/連線異常)→ 退化空陣列 + console.error、頁面不 500
  // (VehiclesTab 走空狀態)。新增表單(addVehicle)g-6b 接;編輯/刪除/設主車留 g-6c。
  let vehicles: CustomerVehicle[] = [];
  try {
    vehicles = await (await getVehicleRepo()).listByCustomer(user.id);
  } catch (vehicleError) {
    console.error('[account/page] vehicles 讀取失敗、退化空陣列:', vehicleError);
  }

  // M-3:讀自己的訂單摘要清單(getOrderRepo→listSummariesByCustomer、RLS orders_select_own 守自己 row)。
  // 鏡像 g-5a/g-6a 退化 pattern:adapter error(RLS/連線異常)→ 退化空陣列 + console.error、頁面不 500
  // (OrdersTab / Overview 最近訂單走空狀態)。orderCount 與 Overview 最近訂單同源此 orders、天然一致(Q5=A)。
  let orders: OrderListItem[] = [];
  try {
    orders = await (await getOrderRepo()).listSummariesByCustomer(user.id);
  } catch (orderError) {
    console.error('[account/page] orders 讀取失敗、退化空陣列:', orderError);
  }

  // M-4b #191:讀自己的收藏清單(getFavoritesRepo→listByCustomer、RLS favorites_select_own 守自己 row)。
  // 鏡像 g-5a/g-6a 退化 pattern:adapter error → 退化空陣列 + console.error、頁面不 500(走空狀態)。
  // 🔴 客人看不到的商品(軟下架)**不會出現在這裡** —— adapter `products!inner` + RLS 的自然結果
  // (Sean 2026-08-18 逐字「甲 = 不顯示(清單直接少一項)」),本頁沒有也不該有過濾邏輯。
  let favorites: FavoriteListItem[] = [];
  // 🔴 **讀取失敗不得與「沒有收藏」印同一個畫面**(`MAIN-035 ①-1`,標【必修】)。
  //   這一格與同頁的 addresses / vehicles / orders **刻意不同形** —— 那三條退化成 `[]`
  //   是既有慣例,而本片被明確要求分開。⇒ 若日後有人「統一風格」把它改回去,那是回歸。
  let favoritesFailed = false;
  try {
    favorites = await (await getFavoritesRepo()).listByCustomer(user.id);
  } catch (favoriteError) {
    console.error('[account/page] favorites 讀取失敗:', favoriteError);
    favoritesFailed = true;
  }

  // V-1c++(Sean 07-16 實測回饋二輪):車型欄改品牌/車型雙下拉(與首頁同 combobox 原型),
  // 結構化 taxonomy 直傳(unstable_cache 60s、失敗回 []=表單退回純自由輸入);
  // 點選組出的名稱=字典標準字面「品牌 車型」→ 首頁愛車 chips 一鍵套用可精確命中。
  const vehicleBrands = await fetchVehicleTaxonomy();

  return (
    <AccountView
      initialTab={initialTab}
      user={{ name, displayEmail }}
      stats={{ tier, walletBalance, orderCount: orders.length }}
      walletEntries={walletEntries}
      walletEntriesFailed={walletEntriesFailed}
      walletEntryTotal={walletEntryTotal}
      walletBalanceFailed={walletBalanceFailed}
      featured={featured}
      profile={{ name, phone, birthday, gender }}
      addresses={addresses}
      vehicles={vehicles}
      vehicleBrands={vehicleBrands}
      orders={orders}
      favorites={favorites}
      favoritesFailed={favoritesFailed}
    />
  );
}
