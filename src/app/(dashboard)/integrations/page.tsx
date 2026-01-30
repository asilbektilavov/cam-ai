'use client';

import { useState } from 'react';
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
  Copy,
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
import { useAppStore } from '@/lib/store';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const iconMap: Record<string, React.ElementType> = {
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
};

const categoryLabels: Record<string, string> = {
  notifications: 'Уведомления',
  crm: 'CRM & ERP',
  access: 'Доступ & POS',
  api: 'API & IoT',
};

const configFields: Record<string, { label: string; placeholder: string }[]> = {
  telegram: [
    { label: 'Bot Token', placeholder: '123456:ABC-DEF1234...' },
    { label: 'Chat ID', placeholder: '-1001234567890' },
  ],
  slack: [
    { label: 'Webhook URL', placeholder: 'https://hooks.slack.com/...' },
    { label: 'Канал', placeholder: '#alerts' },
  ],
  email: [
    { label: 'SMTP сервер', placeholder: 'smtp.gmail.com' },
    { label: 'Email', placeholder: 'alerts@company.com' },
  ],
  sms: [
    { label: 'API ключ', placeholder: 'sk_live_...' },
    { label: 'Номер телефона', placeholder: '+998901234567' },
  ],
  webhook: [
    { label: 'URL', placeholder: 'https://your-server.com/webhook' },
    { label: 'Secret Key', placeholder: 'whsec_...' },
  ],
  rest_api: [
    { label: 'API Key', placeholder: 'cam_api_...' },
    { label: 'Endpoint', placeholder: 'https://api.example.com' },
  ],
};

export default function IntegrationsPage() {
  const { integrations, toggleIntegration } = useAppStore();
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [configIntegration, setConfigIntegration] = useState<string | null>(null);

  const handleToggle = (id: string, name: string, connected: boolean) => {
    toggleIntegration(id);
    if (connected) {
      toast.info(`${name} отключён`);
    } else {
      toast.success(`${name} подключён`);
    }
  };

  const connectedCount = integrations.filter((i) => i.connected).length;

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
          const connectedInCategory = categoryIntegrations.filter((i) => i.connected).length;
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
                      key={i.id}
                      className={cn(
                        'h-1.5 flex-1 rounded-full',
                        i.connected ? 'bg-green-500' : 'bg-muted'
                      )}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Integrations by Category */}
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
                .filter((i) => tab === 'all' || i.category === tab)
                .map((integration) => {
                  const Icon = iconMap[integration.icon] || Circle;
                  return (
                    <Card
                      key={integration.id}
                      className={cn(
                        'transition-all',
                        integration.connected && 'border-green-500/30 bg-green-500/5'
                      )}
                    >
                      <CardContent className="p-5">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                'flex h-10 w-10 items-center justify-center rounded-lg',
                                integration.connected
                                  ? 'bg-green-500/10 text-green-500'
                                  : 'bg-muted text-muted-foreground'
                              )}
                            >
                              <Icon className="h-5 w-5" />
                            </div>
                            <div>
                              <h3 className="font-semibold flex items-center gap-2">
                                {integration.name}
                                {integration.connected && (
                                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                                )}
                              </h3>
                              <Badge variant="secondary" className="text-[10px] mt-0.5">
                                {categoryLabels[integration.category]}
                              </Badge>
                            </div>
                          </div>
                          <Switch
                            checked={integration.connected}
                            onCheckedChange={() =>
                              handleToggle(integration.id, integration.name, integration.connected)
                            }
                          />
                        </div>
                        <p className="text-sm text-muted-foreground mb-4">
                          {integration.description}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 flex-1"
                            disabled={!integration.connected}
                            onClick={() => {
                              setConfigIntegration(integration.id);
                              setConfigDialogOpen(true);
                            }}
                          >
                            <Settings className="h-3.5 w-3.5" />
                            Настроить
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => toast.info(`Документация ${integration.name} откроется в новом окне`)}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Docs
                          </Button>
                        </div>
                      </CardContent>
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
            <DialogTitle>
              Настройка {integrations.find((i) => i.id === configIntegration)?.name}
            </DialogTitle>
            <DialogDescription>
              Введите данные для подключения
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {(configFields[configIntegration || ''] || [
              { label: 'API ключ', placeholder: 'Введите API ключ' },
              { label: 'URL', placeholder: 'Введите URL' },
            ]).map((field) => (
              <div key={field.label} className="space-y-2">
                <Label>{field.label}</Label>
                <div className="flex gap-2">
                  <Input placeholder={field.placeholder} className="flex-1" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => toast.success(`${field.label} скопирован`)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1"
                onClick={() => {
                  setConfigDialogOpen(false);
                  toast.success('Настройки интеграции сохранены');
                }}
              >
                Сохранить
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setConfigDialogOpen(false);
                  toast.info('Тестовое соединение: успешно');
                }}
              >
                Тест
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* API Documentation Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            REST API
          </CardTitle>
          <CardDescription>Примеры использования API для интеграции</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-muted/50 p-4 font-mono text-sm">
            <div className="text-muted-foreground mb-2"># Получить список камер</div>
            <div className="text-green-500">GET</div>{' '}
            <span>/api/v1/cameras</span>
            <div className="mt-4 text-muted-foreground mb-2"># Получить события камеры</div>
            <div className="text-green-500">GET</div>{' '}
            <span>/api/v1/cameras/:id/events</span>
            <div className="mt-4 text-muted-foreground mb-2"># Webhook: подписка на события</div>
            <div className="text-yellow-500">POST</div>{' '}
            <span>/api/v1/webhooks</span>
            <div className="mt-2 text-muted-foreground">
              {'{'}<br />
              {'  "url": "https://your-server.com/webhook",'}<br />
              {'  "events": ["motion_detected", "face_recognized"]'}<br />
              {'}'}
            </div>
            <div className="mt-4 text-muted-foreground mb-2"># Аналитика за период</div>
            <div className="text-green-500">GET</div>{' '}
            <span>/api/v1/analytics?from=2025-01-01&to=2025-01-31</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
