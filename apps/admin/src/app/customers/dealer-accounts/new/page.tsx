// 後台「新增經銷帳號」(B2B 計畫 §9.9 片 D4a)。只限管理者;送出時 action 會再驗一次。
import Link from 'next/link';
import { DealerAccountCreateForm } from '@/components/customers/dealer-account-create-form';
import { getSessionActor } from '@/lib/session/actor';
import { isActiveManager } from '@/lib/staff';

export const dynamic = 'force-dynamic';

export default async function NewDealerAccountPage() {
  const actor = await getSessionActor();
  const canCreate = actor ? await isActiveManager(actor.id).catch(() => false) : false;
  return (
    <div className='pcm-plist mx-auto max-w-3xl space-y-3'>
      <div className='pcm-head'>
        <h1>新增經銷帳號</h1>
        <span className='pcm-sp' />
        <Link href='/customers' className='hover:underline'>
          回客戶列表
        </Link>
      </div>
      {canCreate ? (
        <DealerAccountCreateForm />
      ) : (
        <p className='text-muted-foreground rounded-lg border p-6 text-sm'>
          只有管理者可以新增經銷帳號。需要建立時，請聯絡管理者。
        </p>
      )}
    </div>
  );
}
