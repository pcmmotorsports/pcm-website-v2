// 後台「經銷商申請」明細(B2B 計畫 §9.5,片 D1;核准 / 婉拒是片 D2)。
import Link from 'next/link';
import { TIER_LABEL, formatCustomerDate } from '@/lib/customers/customer-list-view';
import { DEALER_APP_STATUS_LABEL } from '@/lib/customers/dealer-application-view';
import { loadDealerApplication } from '@/lib/customers/dealer-application-repository';
import { DEALER_DECISION_MESSAGE, decisionBannerFor, parseDecisionCode } from '@/lib/customers/dealer-application-decision';
import { DealerDecisionForms } from '@/components/customers/dealer-decision-forms';
import { formatAuditActor } from '@/lib/audit/audit-list-view';
import { listAllStaff } from '@/lib/staff';
import type { MemberTier } from '@pcm/domain';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className='grid grid-cols-[8rem_1fr] gap-3 border-b py-2 text-sm last:border-b-0'>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='whitespace-pre-wrap break-words'>{value === '' || value === null ? '未填' : value}</dd>
    </div>
  );
}

const TONE_CLASS = {
  ok: 'rounded-lg border p-3 text-sm',
  warn: 'rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900',
  error: 'border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm',
} as const;

export default async function DealerApplicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const code = parseDecisionCode((await searchParams).r);

  const back = (
    <Link href='/customers/dealer-applications' className='hover:underline'>
      回經銷商申請列表
    </Link>
  );
  const notFoundView = (
    <div className='pcm-plist mx-auto space-y-3'>
      <div className='pcm-head'>
        <h1>經銷商申請</h1>
        <span className='pcm-sp' />
        {back}
      </div>
      <p className='text-muted-foreground rounded-lg border p-6 text-sm'>找不到這筆經銷商申請。可能網址有誤，請從列表重新點選。</p>
    </div>
  );
  if (!UUID_RE.test(id)) return notFoundView;

  // 讀不到員工名單不擋頁面, 決定的人退回顯示 id(同事故紀錄頁)。
  const [result, staff] = await Promise.all([
    loadDealerApplication(id),
    listAllStaff().catch((err: unknown) => {
      console.error('[admin/dealer-applications] 員工名單載入失敗,決定的人改顯示 id', err);
      return [];
    }),
  ]);
  if (!result.ok) {
    return (
      <div className='pcm-plist mx-auto space-y-3'>
        <div className='pcm-head'>
          <h1>經銷商申請</h1>
          <span className='pcm-sp' />
          {back}
        </div>
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          經銷商申請載入失敗，請重新整理。若仍無法載入，請聯絡系統管理員。
        </div>
      </div>
    );
  }
  if (!result.detail) return notFoundView;

  const { app, customer } = result.detail;
  const shown = decisionBannerFor(code, app.status);
  const banner = shown ? (
    <p role='status' className={TONE_CLASS[DEALER_DECISION_MESSAGE[shown].tone]}>
      {DEALER_DECISION_MESSAGE[shown].text}
    </p>
  ) : null;
  const tierLabel = customer ? (TIER_LABEL[customer.tier as MemberTier] ?? customer.tier) : '讀不到帳號資料';

  return (
    <div className='pcm-plist mx-auto space-y-3'>
      <div className='pcm-head'>
        <h1>{app.company_name}</h1>
        <p className='pcm-count'>{DEALER_APP_STATUS_LABEL[app.status]}</p>
        <span className='pcm-sp' />
        {back}
      </div>
      {banner}

      <section className='rounded-lg border bg-card p-4'>
        <h2 className='mb-2 text-sm font-medium'>申請資料</h2>
        <dl>
          <Row label='公司或商號名稱' value={app.company_name} />
          <Row label='統一編號' value={app.tax_id} />
          <Row label='店名' value={app.store_name} />
          <Row label='營業地區' value={app.region} />
          <Row label='聯絡人' value={app.contact_name} />
          <Row label='聯絡電話' value={app.contact_phone} />
          <Row label='聯絡 Email' value={app.contact_email} />
          <Row label='銷售品牌或需求' value={app.note} />
          <Row label='申請日期' value={formatCustomerDate(app.created_at)} />
        </dl>
      </section>

      <section className='rounded-lg border bg-card p-4'>
        <h2 className='mb-2 text-sm font-medium'>帳號</h2>
        <dl>
          <Row label='現在的等級' value={tierLabel} />
          <Row label='註冊日期' value={customer ? formatCustomerDate(customer.created_at) : '讀不到帳號資料'} />
          <Row label='登入 Email' value={customer?.email ?? '讀不到帳號資料'} />
          <Row
            label='客戶明細'
            value={
              <Link href={`/customers/${app.user_id}`} className='hover:underline'>
                開啟客戶明細
              </Link>
            }
          />
        </dl>
      </section>

      {app.status === 'pending' &&
        (customer ? (
          <DealerDecisionForms
            applicationId={app.id}
            companyName={app.company_name}
            currentTier={customer.tier as MemberTier}
            updatedAt={app.updated_at}
          />
        ) : (
          <p className='text-muted-foreground rounded-lg border p-4 text-sm'>讀不到這個帳號的資料，暫時不能審核。請重新整理。</p>
        ))}

      {app.status !== 'pending' && (
        <section className='rounded-lg border bg-card p-4'>
          <h2 className='mb-2 text-sm font-medium'>審核結果</h2>
          <dl>
            <Row label='結果' value={DEALER_APP_STATUS_LABEL[app.status]} />
            <Row label='決定的人' value={app.decided_by ? formatAuditActor(staff, app.decided_by) : ''} />
            <Row label='決定時間' value={app.decided_at ? formatCustomerDate(app.decided_at) : ''} />
            {app.status === 'rejected' && <Row label='婉拒原因' value={app.decide_note} />}
          </dl>
        </section>
      )}
    </div>
  );
}
