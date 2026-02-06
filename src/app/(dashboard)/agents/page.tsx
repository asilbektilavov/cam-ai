'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Server,
  Plus,
  Copy,
  Check,
  Wifi,
  WifiOff,
  Camera,
  RefreshCw,
  Terminal,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { apiGet, apiPost } from '@/lib/api-client';

interface AgentCamera {
  id: string;
  name: string;
  status: string;
}

interface AgentInfo {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  version: string | null;
  ipAddress: string | null;
  agentCameras: AgentCamera[];
}

interface AgentTokenData {
  id: string;
  token: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  agent: AgentInfo | null;
}

export default function AgentsPage() {
  const [tokens, setTokens] = useState<AgentTokenData[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showNewToken, setShowNewToken] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    try {
      const data = await apiGet<AgentTokenData[]>('/api/agent/tokens');
      setTokens(data);
    } catch {
      toast.error('Ошибка загрузки агентов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const createToken = async () => {
    setCreating(true);
    try {
      const data = await apiPost<{ id: string; token: string; name: string }>('/api/agent/tokens', {
        name: newName || 'Agent',
      });
      setShowNewToken(data.token);
      setNewName('');
      fetchTokens();
      toast.success('Токен агента создан');
    } catch {
      toast.error('Ошибка создания токена');
    } finally {
      setCreating(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success('Скопировано');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getInstallCommand = (token: string) => {
    const host = typeof window !== 'undefined' ? window.location.origin : 'https://your-server.com';
    return `docker run -d --name camai-agent --network=host -e API_URL=${host} -e API_KEY=${token} ghcr.io/camai/agent:latest`;
  };

  const timeAgo = (date: string | null) => {
    if (!date) return 'никогда';
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'только что';
    if (minutes < 60) return `${minutes} мин назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ч назад`;
    return `${Math.floor(hours / 24)} дн назад`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Агенты</h1>
          <p className="text-muted-foreground">
            Edge-агенты обрабатывают видео локально и отправляют результаты в облако
          </p>
        </div>
        <Button onClick={fetchTokens} variant="outline" size="icon">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Create new token */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Подключить нового агента
          </CardTitle>
          <CardDescription>
            Создайте токен и установите агент на любой компьютер в сети с камерами
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="agent-name">Название (необязательно)</Label>
              <Input
                id="agent-name"
                placeholder="Например: Офис на Навои"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={createToken} disabled={creating}>
                {creating ? 'Создание...' : 'Создать токен'}
              </Button>
            </div>
          </div>

          {showNewToken && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 space-y-3">
              <p className="text-sm font-medium text-green-600 dark:text-green-400">
                Токен создан! Сохраните его — он показывается только один раз.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono break-all">
                  {showNewToken}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(showNewToken, 'new-token')}
                >
                  {copiedId === 'new-token' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <Terminal className="h-4 w-4" />
                  Команда установки:
                </p>
                <div className="flex items-start gap-2">
                  <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono break-all">
                    {getInstallCommand(showNewToken)}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => copyToClipboard(getInstallCommand(showNewToken), 'install-cmd')}
                  >
                    {copiedId === 'install-cmd' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <Button variant="ghost" size="sm" onClick={() => setShowNewToken(null)}>
                Скрыть
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agents list */}
      {loading ? (
        <div className="text-center text-muted-foreground py-8">Загрузка...</div>
      ) : tokens.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Server className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-2">Нет подключённых агентов</h3>
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              Создайте токен выше и установите агент на компьютер рядом с камерами.
              Агент автоматически найдёт камеры и начнёт отправлять аналитику.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {tokens.map((t) => (
            <Card key={t.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 rounded-lg p-2 ${t.agent?.status === 'online' ? 'bg-green-500/10' : 'bg-muted'}`}>
                      {t.agent?.status === 'online' ? (
                        <Wifi className="h-5 w-5 text-green-500" />
                      ) : (
                        <WifiOff className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{t.name}</h3>
                        <Badge variant={t.agent?.status === 'online' ? 'default' : 'secondary'}>
                          {t.agent?.status === 'online' ? 'Онлайн' : 'Офлайн'}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground mt-1 space-y-0.5">
                        {t.agent && (
                          <>
                            <p>IP: {t.agent.ipAddress || '—'} {t.agent.version && `• v${t.agent.version}`}</p>
                            <p>Последняя активность: {timeAgo(t.agent.lastSeenAt)}</p>
                          </>
                        )}
                        {!t.agent && (
                          <p>Агент ещё не подключался</p>
                        )}
                      </div>
                      {/* Cameras from this agent */}
                      {t.agent?.agentCameras && t.agent.agentCameras.length > 0 && (
                        <div className="flex items-center gap-2 mt-2">
                          <Camera className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">
                            {t.agent.agentCameras.length} камер
                          </span>
                          <div className="flex gap-1">
                            {t.agent.agentCameras.map((cam) => (
                              <Badge key={cam.id} variant="outline" className="text-xs">
                                {cam.name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
