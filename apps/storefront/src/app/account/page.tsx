// app/account/page.tsx — 會員中心(server 守門 + 取 user/stats/featured/profile/addresses → client AccountView)
//
// 對齊 design-reference/components/AccountPages.jsx AccountPage(L310-681)。
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
import { fetchFeaturedProducts, fetchVehicleTaxonomy } from '@/lib/products';
import { LINE_SYNTHETIC_EMAIL_DOMAIN } from '@/lib/auth/line';
import { toMemberTier } from '@pcm/domain';
import { mapSupabaseWalletEntryToDomain } from '@pcm/adapters';
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

export default async function AccountPage() {
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
    .select('name, phone, birthday, tier, wallet_balance')
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
      user={{ name, displayEmail }}
      stats={{ tier, walletBalance, orderCount: orders.length }}
      walletEntries={walletEntries}
      walletEntriesFailed={walletEntriesFailed}
      walletEntryTotal={walletEntryTotal}
      walletBalanceFailed={walletBalanceFailed}
      featured={featured}
      profile={{ name, phone, birthday }}
      addresses={addresses}
      vehicles={vehicles}
      vehicleBrands={vehicleBrands}
      orders={orders}
      favorites={favorites}
      favoritesFailed={favoritesFailed}
    />
  );
}
