'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  MessageCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Send,
  Unlink,
  HardDrive,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';

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

const categoryLabels: Record<string, string> = {
  storage: 'Хранилище',
  notifications: 'Уведомления',
};

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Telegram state
  const [tgStatus, setTgStatus] = useState<TelegramStatus | null>(null);
  const [tgLoading, setTgLoading] = useState(true);
  const [tgConnecting, setTgConnecting] = useState(false);
  const [tgDisconnecting, setTgDisconnecting] = useState(false);
  const [tgTestingSend, setTgTestingSend] = useState(false);

  // Google Drive state
  const [gdStatus, setGdStatus] = useState<{ connected: boolean; email: string; configured: boolean }>({ connected: false, email: '', configured: false });
  const [gdLoading, setGdLoading] = useState(true);
  const [gdConnecting, setGdConnecting] = useState(false);
  const [gdDisconnecting, setGdDisconnecting] = useState(false);
  const [gdTesting, setGdTesting] = useState(false);
  const [gdClientId, setGdClientId] = useState('');
  const [gdClientSecret, setGdClientSecret] = useState('');
  const [gdSaving, setGdSaving] = useState(false);

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

  const loadGDriveStatus = useCallback(async () => {
    try {
      const data = await apiPost<{ connected: boolean; email: string; configured: boolean }>('/api/integrations/google-drive/auth', {});
      setGdStatus(data);
    } catch {
      // Google Drive not available
    } finally {
      setGdLoading(false);
    }
  }, []);

  useEffect(() => {
    apiGet<IntegrationItem[]>('/api/integrations')
      .then((data) => setIntegrations(data))
      .catch(() => toast.error('Не удалось загрузить интеграции'))
      .finally(() => setLoading(false));

    loadTelegramStatus();
    loadGDriveStatus();

    // Check for Google Drive callback result in URL
    const params = new URLSearchParams(window.location.search);
    const gdriveResult = params.get('gdrive');
    if (gdriveResult === 'connected') {
      toast.success('Google Drive подключён!');
      window.history.replaceState({}, '', window.location.pathname);
      loadGDriveStatus();
    } else if (gdriveResult === 'error') {
      toast.error('Ошибка подключения Google Drive');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [loadTelegramStatus, loadGDriveStatus]);


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

  // Google Drive handlers
  const handleGdSaveCredentials = async () => {
    if (!gdClientId.trim() || !gdClientSecret.trim()) {
      toast.error('Заполните Client ID и Client Secret');
      return;
    }
    setGdSaving(true);
    try {
      await apiPost('/api/integrations/google-drive/auth', {
        clientId: gdClientId.trim(),
        clientSecret: gdClientSecret.trim(),
      });
      toast.success('Credentials сохранены');
      setGdStatus((prev) => ({ ...prev, configured: true }));
      setGdClientId('');
      setGdClientSecret('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setGdSaving(false);
    }
  };

  const handleGdConnect = async () => {
    setGdConnecting(true);
    try {
      const result = await apiGet<{ url: string }>('/api/integrations/google-drive/auth');
      window.location.href = result.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось начать подключение');
      setGdConnecting(false);
    }
  };

  const handleGdDisconnect = async () => {
    setGdDisconnecting(true);
    try {
      await apiDelete('/api/integrations/google-drive/auth');
      toast.success('Google Drive отключён');
      setGdStatus({ connected: false, email: '', configured: false });
    } catch {
      toast.error('Ошибка отключения');
    } finally {
      setGdDisconnecting(false);
    }
  };

  const handleGdTest = async () => {
    setGdTesting(true);
    try {
      const result = await apiPost<{ success: boolean; message?: string }>('/api/integrations/google_drive', { config: {} });
      if (result.success) {
        toast.success(result.message || 'Google Drive: соединение OK');
      } else {
        toast.error('Google Drive: ошибка соединения');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка тестового соединения');
    } finally {
      setGdTesting(false);
    }
  };

  const totalAvailable = 2; // Telegram + Google Drive
  const connectedCount = (tgStatus?.connected ? 1 : 0) + (gdStatus.connected ? 1 : 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Интеграции</h1>
          <p className="text-muted-foreground">
            Подключено {connectedCount} из {totalAvailable} интеграций
          </p>
        </div>
      </div>


      {/* Google Drive — Special Card */}
      <Card className={cn('transition-all', gdStatus.connected && 'border-green-500/30 bg-green-500/5')}>
        <CardContent className="p-5">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg',
                gdStatus.connected ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground'
              )}>
                <HardDrive className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  Google Drive
                  {gdStatus.connected && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                </h3>
                <Badge variant="secondary" className="text-[10px] mt-0.5">Хранилище</Badge>
              </div>
            </div>
            {gdStatus.connected && (
              <Badge variant="default" className="bg-green-500">Подключено</Badge>
            )}
          </div>

          {gdLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Загрузка...</span>
            </div>
          ) : gdStatus.connected ? (
            // State 3: Connected — show account info
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Аккаунт: <span className="font-medium text-foreground">{gdStatus.email}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Записи автоматически загружаются в папку DSS перед удалением. Автоочистка Drive при заполнении на 90%.
              </p>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={handleGdTest} disabled={gdTesting} className="gap-1.5">
                  {gdTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Тест
                </Button>
                <Button variant="ghost" size="sm" onClick={handleGdDisconnect} disabled={gdDisconnecting} className="gap-1.5 text-destructive hover:text-destructive">
                  {gdDisconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                  Отключить
                </Button>
              </div>
            </div>
          ) : gdStatus.configured ? (
            // State 2: Credentials saved, not connected — one button
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Нажмите кнопку для авторизации через Google-аккаунт. Записи будут автоматически сохраняться в папку DSS.
              </p>
              <Button onClick={handleGdConnect} disabled={gdConnecting} className="gap-2">
                {gdConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Подключить Google Drive
              </Button>
            </div>
          ) : (
            // State 1: Not configured — enter Client ID/Secret
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Для подключения создайте OAuth-приложение в{' '}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">
                  Google Cloud Console
                </a>
                {' '}и введите данные ниже.
              </p>
              <div className="space-y-2">
                <Input
                  placeholder="Client ID"
                  value={gdClientId}
                  onChange={(e) => setGdClientId(e.target.value)}
                />
                <Input
                  type="password"
                  placeholder="Client Secret"
                  value={gdClientSecret}
                  onChange={(e) => setGdClientSecret(e.target.value)}
                />
              </div>
              <Button onClick={handleGdSaveCredentials} disabled={gdSaving || !gdClientId.trim() || !gdClientSecret.trim()} className="gap-2">
                {gdSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDrive className="h-4 w-4" />}
                Сохранить и подключить
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

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

    </div>
  );
}
