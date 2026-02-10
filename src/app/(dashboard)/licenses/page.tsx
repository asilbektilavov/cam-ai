'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Key,
  Loader2,
  Shield,
  Camera,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Crown,
  Building2,
  Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { apiGet, apiPost } from '@/lib/api-client';

interface LicenseData {
  edition: 'starter' | 'professional' | 'enterprise';
  cameraLimit: number;
  camerasUsed: number;
  expiryDate: string;
  licenseKey: string;
  isActive: boolean;
  features: string[];
}

const editionConfig = {
  starter: {
    label: 'Starter',
    description: 'до 20 камер',
    color: 'bg-blue-500',
    textColor: 'text-blue-500',
    bgLight: 'bg-blue-500/10',
    icon: Zap,
    features: [
      'До 20 камер',
      'Базовая аналитика',
      'Детекция движения',
      'Подсчёт людей',
      '7 дней хранения',
      'Email-уведомления',
    ],
  },
  professional: {
    label: 'Professional',
    description: 'до 100 камер',
    color: 'bg-purple-500',
    textColor: 'text-purple-500',
    bgLight: 'bg-purple-500/10',
    icon: Crown,
    features: [
      'До 100 камер',
      'Расширенная аналитика',
      'Распознавание лиц',
      'Кросс-камерное отслеживание',
      'Аудио-аналитика',
      '30 дней хранения',
      'Telegram, Slack, Webhook',
      'API доступ',
    ],
  },
  enterprise: {
    label: 'Enterprise',
    description: 'безлимит',
    color: 'bg-amber-500',
    textColor: 'text-amber-500',
    bgLight: 'bg-amber-500/10',
    icon: Building2,
    features: [
      'Безлимит камер',
      'Все функции Professional',
      'Отказоустойчивость',
      'Мониторинг полок',
      'LPR (номера авто)',
      '90 дней хранения',
      'Приоритетная поддержка',
      'Кастомные интеграции',
      'SLA 99.9%',
    ],
  },
};

export default function LicensesPage() {
  const [loading, setLoading] = useState(true);
  const [license, setLicense] = useState<LicenseData | null>(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [activating, setActivating] = useState(false);

  const fetchLicense = useCallback(async () => {
    try {
      const result = await apiGet<LicenseData>('/api/licenses');
      setLicense(result);
    } catch (err) {
      console.error('Failed to fetch license:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLicense();
  }, [fetchLicense]);

  const handleActivate = async () => {
    if (!licenseKey.trim()) {
      toast.error('Введите лицензионный ключ');
      return;
    }
    setActivating(true);
    try {
      const result = await apiPost<LicenseData>('/api/licenses', { key: licenseKey });
      setLicense(result);
      setLicenseKey('');
      toast.success('Лицензия успешно активирована');
    } catch {
      toast.error('Недействительный лицензионный ключ');
    } finally {
      setActivating(false);
    }
  };

  const getDaysUntilExpiry = (expiryDate: string) => {
    const diff = new Date(expiryDate).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const getUsagePercent = (used: number, limit: number) => {
    if (limit === 0) return 0;
    return Math.round((used / limit) * 100);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentEdition = license ? editionConfig[license.edition] : null;
  const daysLeft = license ? getDaysUntilExpiry(license.expiryDate) : 0;
  const usagePercent = license ? getUsagePercent(license.camerasUsed, license.cameraLimit) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Управление лицензиями</h1>
        <p className="text-muted-foreground">
          Информация о текущей лицензии и активация
        </p>
      </div>

      {/* Current License */}
      {license && currentEdition && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn('flex h-12 w-12 items-center justify-center rounded-lg', currentEdition.bgLight)}>
                  <currentEdition.icon className={cn('h-6 w-6', currentEdition.textColor)} />
                </div>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    Текущая лицензия
                    <Badge className={cn(currentEdition.color, 'text-white border-0 text-sm')}>
                      {currentEdition.label}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{currentEdition.description}</CardDescription>
                </div>
              </div>
              <Badge
                variant={license.isActive ? 'default' : 'destructive'}
                className="gap-1"
              >
                {license.isActive ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    Активна
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3 w-3" />
                    Неактивна
                  </>
                )}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* License details grid */}
            <div className="grid sm:grid-cols-3 gap-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                  <Camera className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Лимит камер</p>
                  <p className="text-lg font-bold">
                    {license.cameraLimit === -1 ? 'Безлимит' : license.cameraLimit}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                  <Camera className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Камер используется</p>
                  <p className="text-lg font-bold">{license.camerasUsed}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
                  <Calendar className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Действует до</p>
                  <p className="text-lg font-bold">
                    {new Date(license.expiryDate).toLocaleDateString('ru-RU')}
                  </p>
                </div>
              </div>
            </div>

            {/* Camera usage progress */}
            {license.cameraLimit !== -1 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Использование камер</span>
                  <span className="font-medium">
                    {license.camerasUsed} / {license.cameraLimit}
                  </span>
                </div>
                <Progress
                  value={usagePercent}
                  className={cn(
                    'h-3',
                    usagePercent > 90
                      ? '[&>div]:bg-red-500'
                      : usagePercent > 70
                      ? '[&>div]:bg-yellow-500'
                      : '[&>div]:bg-green-500'
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  {usagePercent >= 90
                    ? 'Внимание: лимит камер почти исчерпан'
                    : `Доступно ещё ${license.cameraLimit - license.camerasUsed} камер`}
                </p>
              </div>
            )}

            {/* Expiry warning */}
            {daysLeft <= 30 && daysLeft > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                    Лицензия истекает через {daysLeft} дней
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Продлите лицензию для непрерывной работы
                  </p>
                </div>
              </div>
            )}

            {daysLeft <= 0 && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">
                    Лицензия истекла
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Активируйте новый ключ для продолжения работы
                  </p>
                </div>
              </div>
            )}

            {/* License key */}
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 font-mono">
              Ключ: {license.licenseKey.slice(0, 8)}****-****-****-{license.licenseKey.slice(-8)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Activate License */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Активация лицензии
          </CardTitle>
          <CardDescription>
            Введите лицензионный ключ для активации или обновления лицензии
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 max-w-lg">
            <div className="flex-1 space-y-2">
              <Label>Лицензионный ключ</Label>
              <Input
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                className="font-mono"
              />
            </div>
            <Button onClick={handleActivate} disabled={activating} className="gap-2">
              {activating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Key className="h-4 w-4" />
              )}
              Активировать
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Edition Comparison */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Сравнение редакций</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {(Object.entries(editionConfig) as [keyof typeof editionConfig, typeof editionConfig.starter][]).map(
            ([key, edition]) => {
              const isCurrentEdition = license?.edition === key;
              const EditionIcon = edition.icon;
              return (
                <Card
                  key={key}
                  className={cn(
                    'relative overflow-hidden transition-all',
                    isCurrentEdition && 'ring-2 ring-primary shadow-lg'
                  )}
                >
                  {isCurrentEdition && (
                    <div className="absolute top-0 right-0">
                      <Badge className="rounded-none rounded-bl-lg">Текущая</Badge>
                    </div>
                  )}
                  <CardHeader className="text-center pb-2">
                    <div className={cn('flex h-14 w-14 mx-auto items-center justify-center rounded-full mb-2', edition.bgLight)}>
                      <EditionIcon className={cn('h-7 w-7', edition.textColor)} />
                    </div>
                    <CardTitle>{edition.label}</CardTitle>
                    <CardDescription>{edition.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Separator className="mb-4" />
                    <ul className="space-y-2.5">
                      {edition.features.map((feature) => (
                        <li key={feature} className="flex items-center gap-2 text-sm">
                          <CheckCircle2 className={cn('h-4 w-4 shrink-0', edition.textColor)} />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            }
          )}
        </div>
      </div>
    </div>
  );
}
