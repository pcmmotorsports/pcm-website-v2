// 經銷商申請頁(B2B 計畫 §9.4 文案、§9.7 頁面細節;片 B)。
// 入口(頁尾 / 經銷站)屬於片 C, 等經銷站上線再接。「修改申請資料」是片 B2;「前往經銷站」按鈕屬片 C。
// 🔴 每次請求重新讀, 不快取:送出後回來看到的必須是最新狀態(§9.7)。
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getVerifiedUser } from '@/lib/auth/verified-user';
import { resolveAuthenticatedTierStrict } from '@/lib/tier';
import { EMPTY_DEALER_APPLY } from '@/lib/dealer-apply/form';
import { decideDealerApplyView, type MineRow } from '@/lib/dealer-apply/view';
import { DealerApplyForm } from '@/components/dealer-apply/DealerApplyForm';
import '../../styles/dealer-apply.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '申請成為 PCM 經銷商',
  robots: { index: false, follow: false },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default async function DealerApplyPage() {
  const { supabase, user } = await getVerifiedUser();
  if (!user) redirect(`/login?next=${encodeURIComponent('/dealer-apply')}`);

  // 讀不到等級(ok:false)與讀不到申請紀錄同一種處理:顯示載入失敗, 不退回空白表單(Fable R1)
  const tierResult = await resolveAuthenticatedTierStrict();
  const { data, error } = await supabase.rpc('dealer_application_mine');
  if (error) console.error('[dealer-apply] 讀申請紀錄失敗', { code: error.code, message: error.message });
  const mine = (Array.isArray(data) ? (data[0] as MineRow | undefined) : undefined) ?? null;
  const view = decideDealerApplyView({ tier: tierResult.tier, mine, readFailed: Boolean(error) || !tierResult.ok });

  return (
    <main className="dap-page">
      {view.kind === 'dealer' && (
        <>
          <h1 className="dap-title">您的經銷商資格已開通</h1>
          <p className="dap-lead">您現在可以到經銷商專區登入，查看經銷價格並下單。</p>
        </>
      )}

      {view.kind === 'pending' && (
        <>
          <h1 className="dap-title">申請已送出</h1>
          <div className="dap-status">
            <p>我們已收到您的申請，PCM 業務會盡快與您聯絡。審核結果也可以隨時回到這個頁面查看。</p>
            <p className="dap-meta">
              申請日期 {formatDate(view.mine.created_at)}｜公司名稱 {view.mine.company_name}
            </p>
          </div>
        </>
      )}

      {view.kind === 'approved_not_effective' && (
        <>
          <h1 className="dap-title">申請已核准</h1>
          <div className="dap-status" role="status">
            <p>您的申請已核准，但帳號資格尚未生效，請與 PCM 業務聯絡。</p>
          </div>
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
          <DealerApplyForm initial={view.prefill} submitLabel="重新提出申請" />
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
          />
        </>
      )}
    </main>
  );
}
