// 經銷品牌折扣設定頁(B2B 計畫 §10.4 片 E3)。所有員工都看得到折扣;儲存限管理者(action 會再驗)。
// 🔴 低於成本的原因只讀給管理者(server 端就不讀), 非管理者拿不到任何成本相關的值。
import Link from 'next/link';
import { BrandDiscountTable, type BrandDiscountRowView } from '@/components/customers/brand-discount-table';
import { TIER_LABEL, formatCustomerDate } from '@/lib/customers/customer-list-view';
import { loadBrandDiscountPage } from '@/lib/customers/brand-discount-repository';
import { formatAuditActor } from '@/lib/audit/audit-list-view';
import { getSessionActor } from '@/lib/session/actor';
import { isActiveManager, listAllStaff } from '@/lib/staff';
import type { MemberTier } from '@pcm/domain';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BrandDiscountsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = (
    <Link href={`/customers/${id}`} className='hover:underline'>
      回客戶明細
    </Link>
  );
  const shell = (body: React.ReactNode, title = '經銷品牌折扣') => (
    <div className='pcm-plist mx-auto space-y-3'>
      <div className='pcm-head'>
        <h1>{title}</h1>
        <span className='pcm-sp' />
        {back}
      </div>
      {body}
    </div>
  );
  if (!UUID_RE.test(id)) return shell(<p className='text-muted-foreground rounded-lg border p-6 text-sm'>找不到這位客人。</p>);

  const actor = await getSessionActor().catch(() => null);
  const manager = actor ? await isActiveManager(actor.id).catch(() => false) : false;
  const [result, staff] = await Promise.all([
    loadBrandDiscountPage(id, manager),
    listAllStaff().catch(() => []),
  ]);
  if (!result.ok) {
    return shell(
      <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
        品牌折扣載入失敗，請重新整理。若仍無法載入，請聯絡系統管理員。
      </div>,
    );
  }
  if (!result.page) return shell(<p className='text-muted-foreground rounded-lg border p-6 text-sm'>找不到這位客人。</p>);

  const { customer, brands, discounts } = result.page;
  const byBrand = new Map(discounts.map((d) => [d.brand_id, d]));
  const rows: BrandDiscountRowView[] = brands.map((b) => {
    const d = byBrand.get(b.id);
    return {
      brandId: b.id,
      brandName: b.name,
      current: d
        ? {
            percent: d.percent,
            below_cost_reason: d.below_cost_reason,
            updated_at: d.updated_at,
            updatedAtText: formatCustomerDate(d.updated_at),
            updatedByLabel: formatAuditActor(staff, d.updated_by),
          }
        : null,
    };
  });
  const tierLabel = TIER_LABEL[customer.tier as MemberTier] ?? customer.tier;

  return shell(
    <>
      <p className='text-sm'>
        {customer.name || customer.email}（{tierLabel}）。折扣從經銷價往下打：價格 = 經銷價 × (100 − 折扣%) ÷ 100，四捨五入到元。沒設定的品牌不打折。
      </p>
      {customer.tier !== 'store' && (
        <p className='rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900'>
          這位客人目前不是車行等級，折扣不會生效，也不能新增或修改；原有的設定可以清除。
        </p>
      )}
      <BrandDiscountTable customerId={id} rows={rows} canSave={manager} />
    </>,
    `經銷品牌折扣 · ${customer.name || customer.email}`,
  );
}
