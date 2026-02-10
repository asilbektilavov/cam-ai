'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Server,
  Loader2,
  Plus,
  Shield,
  Activity,
  ArrowUpCircle,
  Clock,
  Wifi,
  WifiOff,
  AlertTriangle,
  RefreshCw,
  Trash2,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { apiGet, apiPost, apiPut } from '@/lib/api-client';

interface ServerNode {
  id: string;
  name: string;
  url: string;
  role: 'primary' | 'backup';
  status: 'online' | 'offline' | 'degraded';
  uptime: string;
  lastCheck: string;
  cpuUsage: number;
  memoryUsage: number;
  healthHistory: {
    timestamp: string;
    status: 'online' | 'offline' | 'degraded';
    responseTime: number;
  }[];
}

interface FailoverData {
  servers: ServerNode[];
  totalServers: number;
  onlineCount: number;
  offlineCount: number;
  degradedCount: number;
}

const statusConfig = {
  online: {
    label: 'Онлайн',
    dotColor: 'bg-green-500',
    textColor: 'text-green-500',
    bgColor: 'bg-green-500/10',
    icon: CheckCircle2,
  },
  offline: {
    label: 'Офлайн',
    dotColor: 'bg-red-500',
    textColor: 'text-red-500',
    bgColor: 'bg-red-500/10',
    icon: XCircle,
  },
  degraded: {
    label: 'Деградация',
    dotColor: 'bg-yellow-500',
    textColor: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
    icon: MinusCircle,
  },
};

export default function FailoverPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FailoverData | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [newServer, setNewServer] = useState({
    name: '',
    url: '',
    role: 'backup' as 'primary' | 'backup',
  });
  const [adding, setAdding] = useState(false);

  const fetchServers = useCallback(async () => {
    try {
      const result = await apiGet<FailoverData>('/api/failover');
      setData(result);
    } catch (err) {
      console.error('Failed to fetch failover data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    const interval = setInterval(fetchServers, 15000);
    return () => clearInterval(interval);
  }, [fetchServers]);

  const handleAddServer = async () => {
    if (!newServer.name || !newServer.url) {
      toast.error('Заполните все обязательные поля');
      return;
    }
    setAdding(true);
    try {
      await apiPost('/api/failover', newServer);
      toast.success(`Сервер "${newServer.name}" добавлен`);
      setNewServer({ name: '', url: '', role: 'backup' });
      setDialogOpen(false);
      fetchServers();
    } catch {
      toast.error('Не удалось добавить сервер');
    } finally {
      setAdding(false);
    }
  };

  const handlePromote = async (serverId: string) => {
    setPromoting(serverId);
    try {
      await apiPut('/api/failover', { serverId, action: 'promote' });
      toast.success('Сервер назначен основным');
      fetchServers();
    } catch {
      toast.error('Не удалось выполнить переключение');
    } finally {
      setPromoting(null);
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

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
          <h1 className="text-2xl font-bold">Отказоустойчивость</h1>
          <p className="text-muted-foreground">
            Управление серверами и автоматическое переключение
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchServers} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Обновить
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Добавить сервер
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Добавить сервер</DialogTitle>
                <DialogDescription>
                  Добавьте новый сервер для обеспечения отказоустойчивости
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Название сервера</Label>
                  <Input
                    placeholder="Сервер резервный #1"
                    value={newServer.name}
                    onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>URL сервера</Label>
                  <Input
                    placeholder="https://backup-01.example.com"
                    value={newServer.url}
                    onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Роль</Label>
                  <Select
                    value={newServer.role}
                    onValueChange={(v) =>
                      setNewServer({ ...newServer, role: v as 'primary' | 'backup' })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="primary">Основной (Primary)</SelectItem>
                      <SelectItem value="backup">Резервный (Backup)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleAddServer} disabled={adding} className="w-full gap-2">
                  {adding ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Добавить
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                <Server className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{data.totalServers}</p>
                <p className="text-sm text-muted-foreground">Всего серверов</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                <Wifi className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{data.onlineCount}</p>
                <p className="text-sm text-muted-foreground">Онлайн</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
                <WifiOff className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{data.offlineCount}</p>
                <p className="text-sm text-muted-foreground">Офлайн</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-500/10">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{data.degradedCount}</p>
                <p className="text-sm text-muted-foreground">Деградация</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Server List */}
      {data && data.servers.length > 0 ? (
        <div className="space-y-4">
          {data.servers.map((server) => {
            const sConfig = statusConfig[server.status];
            const StatusIcon = sConfig.icon;
            return (
              <Card key={server.id} className="overflow-hidden">
                <div className="flex">
                  {/* Status indicator strip */}
                  <div className={cn('w-1.5 shrink-0', sConfig.dotColor)} />

                  <div className="flex-1">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-4">
                          <div className={cn('flex h-12 w-12 items-center justify-center rounded-lg', sConfig.bgColor)}>
                            <Server className={cn('h-6 w-6', sConfig.textColor)} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-lg">{server.name}</h3>
                              <Badge
                                variant={server.role === 'primary' ? 'default' : 'secondary'}
                                className="text-xs"
                              >
                                {server.role === 'primary' ? 'Основной' : 'Резервный'}
                              </Badge>
                              <Badge variant="outline" className={cn('text-xs gap-1', sConfig.textColor)}>
                                <StatusIcon className="h-3 w-3" />
                                {sConfig.label}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-0.5">{server.url}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {server.role === 'backup' && server.status === 'online' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePromote(server.id)}
                              disabled={promoting === server.id}
                              className="gap-2"
                            >
                              {promoting === server.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <ArrowUpCircle className="h-4 w-4" />
                              )}
                              Сделать основным
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Server metrics */}
                      <div className="grid grid-cols-4 gap-6 mt-5 pt-4 border-t border-border">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Аптайм</p>
                          <p className="text-sm font-medium">{server.uptime}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">CPU</p>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  server.cpuUsage > 80 ? 'bg-red-500' : server.cpuUsage > 60 ? 'bg-yellow-500' : 'bg-green-500'
                                )}
                                style={{ width: `${server.cpuUsage}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium">{server.cpuUsage}%</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Память</p>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  server.memoryUsage > 80 ? 'bg-red-500' : server.memoryUsage > 60 ? 'bg-yellow-500' : 'bg-green-500'
                                )}
                                style={{ width: `${server.memoryUsage}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium">{server.memoryUsage}%</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Последняя проверка</p>
                          <p className="text-sm font-medium">{formatTime(server.lastCheck)}</p>
                        </div>
                      </div>

                      {/* Health check timeline */}
                      {server.healthHistory.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-border">
                          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            История проверок
                          </p>
                          <div className="flex items-center gap-0.5">
                            {server.healthHistory.map((check, i) => (
                              <div
                                key={i}
                                className={cn(
                                  'flex-1 h-6 rounded-sm transition-colors',
                                  check.status === 'online'
                                    ? 'bg-green-500/60 hover:bg-green-500'
                                    : check.status === 'degraded'
                                    ? 'bg-yellow-500/60 hover:bg-yellow-500'
                                    : 'bg-red-500/60 hover:bg-red-500'
                                )}
                                title={`${formatTime(check.timestamp)} — ${check.responseTime}ms — ${statusConfig[check.status].label}`}
                              />
                            ))}
                          </div>
                          <div className="flex justify-between mt-1">
                            <span className="text-[10px] text-muted-foreground">
                              {server.healthHistory.length > 0
                                ? formatTime(server.healthHistory[0].timestamp)
                                : ''}
                            </span>
                            <span className="text-[10px] text-muted-foreground">Сейчас</span>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Server className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Нет серверов</h3>
            <p className="text-muted-foreground mb-4">
              Добавьте серверы для настройки отказоустойчивости
            </p>
            <Button onClick={() => setDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Добавить сервер
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
