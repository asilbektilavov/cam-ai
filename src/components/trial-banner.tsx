'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock } from 'lucide-react';
import { apiGet } from '@/lib/api-client';

interface BillingData {
  trialEndsAt: string | null;
  subscription: { status: string } | null;
}

export function TrialBanner() {
  const [data, setData] = useState<BillingData | null>(null);

  useEffect(() => {
    apiGet<BillingData>('/api/billing')
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return null;

  // Has active subscription — no banner
  if (data.subscription && ['active', 'trialing'].includes(data.subscription.status)) {
    return null;
  }

  if (!data.trialEndsAt) return null;

  const trialEnd = new Date(data.trialEndsAt);
  const now = new Date();
  const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  // Trial expired
  if (daysLeft <= 0) {
    return (
      <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <span className="text-destructive font-medium">
            Пробный период истёк. Функции ограничены.
          </span>
        </div>
        <Link
          href="/settings?tab=billing"
          className="text-sm font-medium text-primary hover:underline whitespace-nowrap"
        >
          Оформить подписку
        </Link>
      </div>
    );
  }

  // Trial active with <= 7 days left
  if (daysLeft <= 7) {
    return (
      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-3 mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
          <span className="text-yellow-700 dark:text-yellow-300">
            Пробный период: осталось {daysLeft} {daysLeft === 1 ? 'день' : daysLeft <= 4 ? 'дня' : 'дней'}
          </span>
        </div>
        <Link
          href="/settings?tab=billing"
          className="text-sm font-medium text-primary hover:underline whitespace-nowrap"
        >
          Оформить подписку
        </Link>
      </div>
    );
  }

  return null;
}
