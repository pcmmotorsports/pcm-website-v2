// 經銷商申請頁(B2B 計畫 §9.4 文案、§9.7 頁面細節;片 B)。
// 入口(頁尾 / 經銷站)屬於片 C, 等經銷站上線再接;「前往經銷站」按鈕屬片 C。
// 片 B2:審核中可以修改, 用同一頁 ?edit=1(不開子路徑);存好後回 ?updated=1 顯示「已更新申請資料。」
// 🔴 每次請求重新讀, 不快取:送出後回來看到的必須是最新狀態(§9.7)。
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getVerifiedUser } from '@/lib/auth/verified-user';
import { resolveAuthenticatedTierStrict } from '@/lib/tier';
import { EMPTY_DEALER_APPLY } from '@/lib/dealer-apply/form';
import { decideDealerApplyView, type MineRow } from '@/lib/dealer-apply/view';
import { DealerApplyForm } from '@/components/dealer-apply/DealerApplyForm';
// 天地要自己 import(同 app/stores/page.tsx 檔頭:本站 app/ 底下沒有共用 layout 包 header / footer)。
// Sean 2026-09-25 截圖:少了它們這一頁回不到網站。
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import '../../styles/dealer-apply.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '申請成為 PCM 經銷商',
  robots: { index: false, follow: false },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default async function DealerApplyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, user } = await getVerifiedUser();
  if (!user) redirect(`/login?next=${encodeURIComponent('/dealer-apply')}`);
  // 核准後升級的是這個登入帳號, 表單最上方寫給客人看(LINE 登入可能沒有 Email)
  const accountEmail = user.email || null;

  // 讀不到等級(ok:false)與讀不到申請紀錄同一種處理:顯示載入失敗, 不退回空白表單(Fable R1)
  const tierResult = await resolveAuthenticatedTierStrict();
  const { data, error } = await supabase.rpc('dealer_application_mine');
  if (error) console.error('[dealer-apply] 讀申請紀錄失敗', { code: error.code, message: error.message });
  const mine = (Array.isArray(data) ? (data[0] as MineRow | undefined) : undefined) ?? null;
  const view = decideDealerApplyView({
    tier: tierResult.tier,
    mine,
    readFailed: Boolean(error) || !tierResult.ok,
    edit: sp.edit === '1',
  });

  return (
    <>
      <Header currentPage="account" />
      <main className="dap-page">
        {view.kind === 'dealer' && (
          <>
            <h1 className="dap-title">您的經銷商資格已開通</h1>
            <p className="dap-lead">您現在可以到經銷商專區登入，查看經銷價格並下單。</p>
            {/* 片 C(計畫 §9.4)。網址與按鈕字跟前台窗 agent/b2b-front 的 site-login-copy.ts(B2B_SITE_URL)同一個;
                合併後改用那個常數, 不留兩份。 */}
            <a className="auth-submit auth-submit-link" href="https://b2b.pcmmotorsports.com/login">
              前往 b2b.pcmmotorsports.com
            </a>
          </>
        )}

        {view.kind === 'pending' && (
          <>
            <h1 className="dap-title">申請已送出</h1>
            {/* 只看網址會在重新整理時重複出現;送出時兩個時間相同, 改過才不同(Fable R1) */}
            {sp.updated === '1' && view.mine.updated_at !== view.mine.created_at && (
              <p className="dap-notice" role="status">
                已更新申請資料。
              </p>
            )}
            <div className="dap-status">
              <p>我們已收到您的申請，PCM 業務會盡快與您聯絡。審核結果也可以隨時回到這個頁面查看。</p>
              <p className="dap-meta">
                申請日期 {formatDate(view.mine.created_at)}｜公司名稱 {view.mine.company_name}
              </p>
              <a className="auth-submit auth-submit-link dap-edit" href="/dealer-apply?edit=1">
                修改申請資料
              </a>
            </div>
          </>
        )}

        {view.kind === 'edit' && (
          <>
            <h1 className="dap-title">修改申請資料</h1>
            <p className="dap-lead">申請還在審核中，可以修改下面的資料。審核完成後就不能再修改。</p>
            <DealerApplyForm initial={view.prefill} submitLabel="儲存修改" editId={view.id} accountEmail={accountEmail} />
          </>
        )}

        {view.kind === 'approved_not_effective' && (
          <>
            {/* Sean 2026-09-25 Q9 甲:經銷被改回一般會員時, 照婉拒那一格讓他重新提出 */}
            <h1 className="dap-title">您的經銷資格目前沒有啟用</h1>
            <p className="dap-lead">
              您的帳號目前是一般會員，看不到經銷價。如果要恢復經銷資格，請確認下面的資料後重新提出申請；有問題也可以聯絡 PCM 業務。
            </p>
            <DealerApplyForm initial={view.prefill} submitLabel="重新提出申請" accountEmail={accountEmail} />
          </>
        )}

        {view.kind === 'load_error' && (
          <>
            <h1 className="dap-title">申請成為 PCM 經銷商</h1>
            <div className="auth-err" role="alert">
              申請資料載入失敗，請重新整理。若仍無法載入，請聯絡 PCM 業務。
            </div>
          </>
        )}

        {view.kind === 'rejected' && (
          <>
            <h1 className="dap-title">這次的申請未通過</h1>
            <p className="dap-lead">
              這次沒有通過審核。如果情況有變動或想了解原因，請與 PCM 業務聯絡；也可以修改下面的資料後重新提出申請。
            </p>
            <DealerApplyForm initial={view.prefill} submitLabel="重新提出申請" accountEmail={accountEmail} />
          </>
        )}

        {view.kind === 'form' && (
          <>
            <h1 className="dap-title">申請成為 PCM 經銷商</h1>
            <p className="dap-lead">
              填寫以下資料後我們會與您聯絡確認。通過後您的帳號就能登入經銷商專區，看到經銷價格並直接下單。
            </p>
            <DealerApplyForm
              initial={{ ...EMPTY_DEALER_APPLY, contactEmail: user.email ?? '' }}
              submitLabel="送出經銷商申請"
              accountEmail={accountEmail}
            />
          </>
        )}

        <a className="dap-back" href="/account">
          回到會員中心
        </a>
      </main>
      <HomeFooter />
    </>
  );
}
