'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageCircle,
  Hash,
  Mail,
  Smartphone,
  Building2,
  Database,
  Users,
  KeyRound,
  CreditCard,
  Webhook,
  Code,
  Radio,
  CheckCircle2,
  Circle,
  ExternalLink,
  Settings,
  Loader2,
  Send,
  Unlink,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { apiGet, apiPatch, apiPost, apiDelete } from '@/lib/api-client';

interface IntegrationItem {
  id: string;
  type: string;
  name: string;
  category: string;
  description: string;
  enabled: boolean;
  config: Record<string, string>;
}

interface TelegramStatus {
  configured: boolean;
  botUsername: string | null;
  connected: boolean;
  chatId: string | null;
  orgId: string;
  branches: Array<{ id: string; name: string; notifyEnabled: boolean }>;
}

const iconMap: Record<string, React.ElementType> = {
  telegram: MessageCircle,
  slack: Hash,
  email: Mail,
  sms: Smartphone,
  '1c': Database,
  bitrix: Building2,
  iiko: Users,
  skud: KeyRound,
  webhook: Webhook,
  rest_api: Code,
  mqtt: Radio,
  modbus: CreditCard,
};

const categoryLabels: Record<string, string> = {
  notifications: 'Уведомления',
  crm: 'CRM & ERP',
  access: 'Доступ & POS',
  api: 'API & IoT',
};

const configFields: Record<string, { key: string; label: string; placeholder: string }[]> = {
  slack: [
    { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/...' },
    { key: 'channel', label: 'Канал', placeholder: '#alerts' },
  ],
  email: [
    { key: 'smtpServer', label: 'SMTP сервер', placeholder: 'smtp.gmail.com' },
    { key: 'email', label: 'Email', placeholder: 'alerts@company.com' },
  ],
  sms: [
    { key: 'apiKey', label: 'API ключ', placeholder: 'sk_live_...' },
    { key: 'phone', label: 'Номер телефона', placeholder: '+998901234567' },
  ],
  webhook: [
    { key: 'url', label: 'URL', placeholder: 'https://your-server.com/webhook' },
    { key: 'secret', label: 'Secret Key', placeholder: 'whsec_...' },
  ],
  rest_api: [
    { key: 'apiKey', label: 'API Key', placeholder: 'cam_api_...' },
    { key: 'endpoint', label: 'Endpoint', placeholder: 'https://api.example.com' },
  ],
  mqtt: [
    { key: 'broker', label: 'Broker URL', placeholder: 'mqtt://broker.example.com' },
    { key: 'topic', label: 'Topic', placeholder: 'cam-ai/events' },
  ],
  modbus: [
    { key: 'host', label: 'Host', placeholder: '192.168.1.100' },
    { key: 'port', label: 'Port', placeholder: '502' },
  ],
};

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [configType, setConfigType] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const togglingRef = useRef<Set<string>>(new Set());

  // Telegram state
  const [tgStatus, setTgStatus] = useState<TelegramStatus | null>(null);
  const [tgLoading, setTgLoading] = useState(true);
  const [tgConnecting, setTgConnecting] = useState(false);
  const [tgDisconnecting, setTgDisconnecting] = useState(false);
  const [tgTestingSend, setTgTestingSend] = useState(false);

  const loadTelegramStatus = useCallback(async () => {
    try {
      const data = await apiGet<TelegramStatus>('/api/integrations/telegram/status');
      setTgStatus(data);
    } catch {
      // Telegram status not available
    } finally {
      setTgLoading(false);
    }
  }, []);

  useEffect(() => {
    apiGet<IntegrationItem[]>('/api/integrations')
      .then((data) => setIntegrations(data))
      .catch(() => toast.error('Не удалось загрузить интеграции'))
      .finally(() => setLoading(false));

    loadTelegramStatus();
  }, [loadTelegramStatus]);

  const handleToggle = async (type: string, name: string, currentEnabled: boolean) => {
    if (togglingRef.current.has(type)) return;
    togglingRef.current.add(type);

    setIntegrations((prev) =>
      prev.map((i) => (i.type === type ? { ...i, enabled: !currentEnabled } : i))
    );

    try {
      await apiPatch(`/api/integrations/${type}`, { enabled: !currentEnabled, name });
      toast.success(currentEnabled ? `${name} отключён` : `${name} подключён`);
    } catch {
      setIntegrations((prev) =>
        prev.map((i) => (i.type === type ? { ...i, enabled: currentEnabled } : i))
      );
      toast.error('Ошибка при переключении интеграции');
    } finally {
      togglingRef.current.delete(type);
    }
  };

  const openConfig = (type: string) => {
    const integration = integrations.find((i) => i.type === type);
    setConfigType(type);
    setConfigValues(integration?.config || {});
    setConfigDialogOpen(true);
  };

  const handleSaveConfig = async () => {
    if (!configType) return;
    setSaving(true);
    try {
      const integration = integrations.find((i) => i.type === configType);
      await apiPatch(`/api/integrations/${configType}`, {
        enabled: integration?.enabled ?? false,
        config: configValues,
        name: integration?.name,
      });
      setIntegrations((prev) =>
        prev.map((i) => (i.type === configType ? { ...i, config: { ...configValues } } : i))
      );
      setConfigDialogOpen(false);
      toast.success('Настройки интеграции сохранены');
    } catch {
      toast.error('Ошибка сохранения настроек');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!configType) return;
    setTesting(true);
    try {
      const result = await apiPost<{ success: boolean; message?: string; botName?: string; status?: number }>(
        `/api/integrations/${configType}`,
        { config: configValues }
      );
      if (result.success) {
        const extra = result.botName ? ` (@${result.botName})` : '';
        toast.success(`Тестовое соединение: успешно${extra}`);
      } else {
        toast.error(`Тестовое соединение: ошибка (${result.status || 'unknown'})`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка тестового соединения');
    } finally {
      setTesting(false);
    }
  };

  // Telegram handlers
  const handleTgConnect = async () => {
    setTgConnecting(true);
    try {
      const result = await apiPost<{ success: boolean; chatId: string }>('/api/integrations/telegram/connect', {});
      if (result.success) {
        toast.success('Telegram подключён!');
        await loadTelegramStatus();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось подключить');
    } finally {
      setTgConnecting(false);
    }
  };

  const handleTgDisconnect = async () => {
    setTgDisconnecting(true);
    try {
      await apiDelete('/api/integrations/telegram/connect');
      toast.success('Telegram отключён');
      await loadTelegramStatus();
    } catch {
      toast.error('Ошибка отключения');
    } finally {
      setTgDisconnecting(false);
    }
  };

  const handleTgBranchToggle = async (branchId: string, enabled: boolean) => {
    if (!tgStatus) return;

    const newBranches = tgStatus.branches.map((b) =>
      b.id === branchId ? { ...b, notifyEnabled: enabled } : b
    );
    setTgStatus({ ...tgStatus, branches: newBranches });

    const notifyBranches = newBranches.filter((b) => b.notifyEnabled).map((b) => b.id);
    try {
      await apiPatch('/api/integrations/telegram/branches', { notifyBranches });
    } catch {
      toast.error('Ошибка сохранения настроек');
      await loadTelegramStatus();
    }
  };

  const handleTgTestSend = async () => {
    setTgTestingSend(true);
    try {
      await apiPost('/api/integrations/telegram', {
        config: { botToken: '', chatId: tgStatus?.chatId },
      });
      toast.success('Тестовое сообщение отправлено');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setTgTestingSend(false);
    }
  };

  const connectedCount = integrations.filter((i) => i.enabled).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentConfigIntegration = integrations.find((i) => i.type === configType);
  const currentFields = configFields[configType || ''] || [
    { key: 'apiKey', label: 'API ключ', placeholder: 'Введите API ключ' },
    { key: 'url', label: 'URL', placeholder: 'Введите URL' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Интеграции</h1>
          <p className="text-muted-foreground">
            Подключено {connectedCount} из {integrations.length} интеграций
          </p>
        </div>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(categoryLabels).map(([key, label]) => {
          const categoryIntegrations = integrations.filter((i) => i.category === key);
          const connectedInCategory = categoryIntegrations.filter((i) => i.enabled).length;
          return (
            <Card key={key}>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground mb-1">{label}</p>
                <p className="text-xl font-bold">
                  {connectedInCategory}/{categoryIntegrations.length}
                </p>
                <div className="flex gap-1 mt-2">
                  {categoryIntegrations.map((i) => (
                    <div
                      key={i.type}
                      className={cn(
                        'h-1.5 flex-1 rounded-full',
                        i.enabled ? 'bg-green-500' : 'bg-muted'
                      )}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Telegram — Special Card */}
      <Card className={cn('transition-all', tgStatus?.connected && 'border-green-500/30 bg-green-500/5')}>
        <CardContent className="p-5">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg',
                tgStatus?.connected ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground'
              )}>
                <MessageCircle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  Telegram
                  {tgStatus?.connected && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                </h3>
                <Badge variant="secondary" className="text-[10px] mt-0.5">Уведомления</Badge>
              </div>
            </div>
            {tgStatus?.connected && (
              <Badge variant="default" className="bg-green-500">Подключено</Badge>
            )}
          </div>

          {tgLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Загрузка...</span>
            </div>
          ) : !tgStatus?.configured ? (
            // State 1: Not configured — show default bot with deep link
            <div className="space-y-3">
              <div className="text-sm space-y-2">
                <p className="font-medium">Подключите Telegram за 2 шага:</p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li>Нажмите «Открыть бота» — он откроется в Telegram</li>
                  <li>Нажмите <strong>Start</strong> в боте, затем вернитесь и нажмите «Подключить»</li>
                </ol>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" className="gap-2">
                  <a href={`https://t.me/cam_ai_assist_bot?start=${tgStatus?.orgId || ''}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    Открыть бота
                  </a>
                </Button>
                <Button onClick={handleTgConnect} disabled={tgConnecting} className="gap-2">
                  {tgConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                  Подключить
                </Button>
              </div>
            </div>
          ) : !tgStatus.connected ? (
            // State 2: Configured but not connected
            <div className="space-y-3">
              <div className="text-sm space-y-2">
                <p className="font-medium">Подключите Telegram за 2 шага:</p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li>Нажмите «Открыть бота» — он откроется в Telegram</li>
                  <li>Нажмите <strong>Start</strong> в боте, затем вернитесь и нажмите «Подключить»</li>
                </ol>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" className="gap-2">
                  <a href={`https://t.me/${tgStatus.botUsername}?start=${tgStatus.orgId}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    Открыть бота
                  </a>
                </Button>
                <Button onClick={handleTgConnect} disabled={tgConnecting} className="gap-2">
                  {tgConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                  Подключить
                </Button>
              </div>
            </div>
          ) : (
            // State 3: Connected
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Бот: <span className="font-medium text-foreground">@{tgStatus.botUsername}</span>
              </p>

              {tgStatus.branches.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Уведомления по филиалам:</p>
                  <div className="space-y-2">
                    {tgStatus.branches.map((branch) => (
                      <div key={branch.id} className="flex items-center justify-between">
                        <span className="text-sm">{branch.name}</span>
                        <Switch
                          checked={branch.notifyEnabled}
                          onCheckedChange={(checked) => handleTgBranchToggle(branch.id, checked)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={handleTgTestSend} disabled={tgTestingSend} className="gap-1.5">
                  {tgTestingSend ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Тест
                </Button>
                <Button variant="ghost" size="sm" onClick={handleTgDisconnect} disabled={tgDisconnecting} className="gap-1.5 text-destructive hover:text-destructive">
                  {tgDisconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                  Отключить
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Other Integrations */}
      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">Все</TabsTrigger>
          <TabsTrigger value="notifications">Уведомления</TabsTrigger>
          <TabsTrigger value="crm">CRM & ERP</TabsTrigger>
          <TabsTrigger value="access">Доступ & POS</TabsTrigger>
          <TabsTrigger value="api">API & IoT</TabsTrigger>
        </TabsList>

        {['all', 'notifications', 'crm', 'access', 'api'].map((tab) => (
          <TabsContent key={tab} value={tab}>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
              {integrations
                .filter((i) => i.type !== 'telegram')
                .filter((i) => tab === 'all' || i.category === tab)
                .map((integration) => {
                  const Icon = iconMap[integration.type] || Circle;
                  return (
                    <Card
                      key={integration.type}
                      className="transition-all relative overflow-hidden select-none"
                    >
                      <CardContent className="p-5 opacity-40">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                              <Icon className="h-5 w-5" />
                            </div>
                            <div>
                              <h3 className="font-semibold">{integration.name}</h3>
                              <Badge variant="secondary" className="text-[10px] mt-0.5">
                                {categoryLabels[integration.category]}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {integration.description}
                        </p>
                      </CardContent>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="text-sm font-semibold text-muted-foreground bg-background/80 px-3 py-1.5 rounded-md border">
                          В разработке
                        </span>
                      </div>
                    </Card>
                  );
                })}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Configure Dialog */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Настройка {currentConfigIntegration?.name}</DialogTitle>
            <DialogDescription>Введите данные для подключения</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {currentFields.map((field) => (
              <div key={field.key} className="space-y-2">
                <Label>{field.label}</Label>
                <Input
                  placeholder={field.placeholder}
                  value={configValues[field.key] || ''}
                  onChange={(e) =>
                    setConfigValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                />
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Button className="flex-1" onClick={handleSaveConfig} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Сохранить
              </Button>
              <Button variant="outline" onClick={handleTestConnection} disabled={testing}>
                {testing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Тест
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* API Documentation Preview */}
      <Card className="relative overflow-hidden select-none">
        <CardHeader className="blur-sm opacity-50">
          <CardTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            REST API
          </CardTitle>
          <CardDescription>Примеры использования API для интеграции</CardDescription>
        </CardHeader>
        <CardContent className="blur-sm opacity-50">
          <div className="rounded-lg bg-muted/50 p-4 font-mono text-sm">
            <div className="text-muted-foreground mb-2"># Получить список камер</div>
            <div className="text-green-500">GET</div>{' '}
            <span>/api/cameras</span>
            <div className="mt-4 text-muted-foreground mb-2"># Получить события</div>
            <div className="text-green-500">GET</div>{' '}
            <span>/api/events?limit=50&severity=critical</span>
            <div className="mt-4 text-muted-foreground mb-2"># Экспорт аналитики</div>
            <div className="text-green-500">GET</div>{' '}
            <span>/api/analytics/export?format=csv&period=week</span>
          </div>
        </CardContent>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-sm font-semibold text-muted-foreground bg-background/80 px-3 py-1.5 rounded-md border">
            В разработке
          </span>
        </div>
      </Card>
    </div>
  );
}
