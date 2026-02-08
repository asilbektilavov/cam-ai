'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList,
  Search,
  Loader2,
  User,
  Clock,
  ChevronDown,
  Filter,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api-client';
import { toast } from 'sonner';

// --- Types ---

interface AuditLogEntry {
  id: string;
  action: string;
  target: string | null;
  targetType: string | null;
  details: string | null;
  ip: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

interface AuditResponse {
  logs: AuditLogEntry[];
  total: number;
}

// --- Action category mapping ---

interface ActionMeta {
  label: string;
  category: string;
  color: string;
}

const ACTION_MAP: Record<string, ActionMeta> = {
  'login': { label: 'Вход', category: 'auth', color: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  'logout': { label: 'Выход', category: 'auth', color: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  'camera.create': { label: 'Камера создана', category: 'camera', color: 'bg-green-500/15 text-green-600 border-green-500/30' },
  'camera.update': { label: 'Камера обновлена', category: 'camera', color: 'bg-green-500/15 text-green-600 border-green-500/30' },
  'camera.delete': { label: 'Камера удалена', category: 'camera', color: 'bg-green-500/15 text-green-600 border-green-500/30' },
  'branch.create': { label: 'Филиал создан', category: 'camera', color: 'bg-green-500/15 text-green-600 border-green-500/30' },
  'settings.update': { label: 'Настройки обновлены', category: 'settings', color: 'bg-purple-500/15 text-purple-600 border-purple-500/30' },
  'export.video': { label: 'Экспорт видео', category: 'export', color: 'bg-orange-500/15 text-orange-600 border-orange-500/30' },
  'ptz.move': { label: 'PTZ управление', category: 'ptz', color: 'bg-yellow-500/15 text-yellow-700 border-yellow-500/30' },
  'integration.update': { label: 'Интеграция обновлена', category: 'settings', color: 'bg-purple-500/15 text-purple-600 border-purple-500/30' },
  'user.create': { label: 'Пользователь создан', category: 'system', color: 'bg-gray-500/15 text-gray-600 border-gray-500/30' },
  'user.update': { label: 'Пользователь обновлен', category: 'system', color: 'bg-gray-500/15 text-gray-600 border-gray-500/30' },
  'lpr.plate.create': { label: 'Номер добавлен', category: 'camera', color: 'bg-green-500/15 text-green-600 border-green-500/30' },
  'lpr.plate.update': { label: 'Номер обновлен', category: 'camera', color: 'bg-green-500/15 text-green-600 border-green-500/30' },
  'lpr.plate.delete': { label: 'Номер удален', category: 'camera', color: 'bg-green-500/15 text-green-600 border-green-500/30' },
};

function getActionBadge(action: string) {
  const meta = ACTION_MAP[action];
  if (meta) {
    return <Badge className={cn(meta.color, 'hover:opacity-90')}>{meta.label}</Badge>;
  }
  // Fallback: determine category by prefix
  let color = 'bg-gray-500/15 text-gray-600 border-gray-500/30';
  if (action.startsWith('camera')) color = 'bg-green-500/15 text-green-600 border-green-500/30';
  else if (action.startsWith('settings') || action.startsWith('integration')) color = 'bg-purple-500/15 text-purple-600 border-purple-500/30';
  else if (action.startsWith('export')) color = 'bg-orange-500/15 text-orange-600 border-orange-500/30';
  else if (action.startsWith('ptz')) color = 'bg-yellow-500/15 text-yellow-700 border-yellow-500/30';
  else if (action === 'login' || action === 'logout') color = 'bg-blue-500/15 text-blue-600 border-blue-500/30';

  return <Badge className={cn(color, 'hover:opacity-90')}>{action}</Badge>;
}

function formatDate(date: string) {
  return new Date(date).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function parseDetails(details: string | null): string {
  if (!details) return '—';
  try {
    const obj = JSON.parse(details);
    return Object.entries(obj)
      .map(([key, val]) => `${key}: ${val}`)
      .join(', ');
  } catch {
    return details;
  }
}

// Available action types for filter
const ACTION_TYPES = [
  { value: 'login', label: 'Вход' },
  { value: 'logout', label: 'Выход' },
  { value: 'camera.create', label: 'Камера создана' },
  { value: 'camera.update', label: 'Камера обновлена' },
  { value: 'camera.delete', label: 'Камера удалена' },
  { value: 'branch.create', label: 'Филиал создан' },
  { value: 'settings.update', label: 'Настройки' },
  { value: 'export.video', label: 'Экспорт видео' },
  { value: 'ptz.move', label: 'PTZ' },
  { value: 'integration.update', label: 'Интеграция' },
  { value: 'user.create', label: 'Пользователь создан' },
  { value: 'user.update', label: 'Пользователь обновлен' },
];

const PAGE_SIZE = 50;

// ===========================
// Main Audit Page
// ===========================

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);

  // Filters
  const [filterAction, setFilterAction] = useState('all');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const fetchLogs = useCallback(async (reset = false) => {
    const currentOffset = reset ? 0 : offset;
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const params = new URLSearchParams();
      if (filterAction && filterAction !== 'all') params.set('action', filterAction);
      if (filterFrom) params.set('from', filterFrom);
      if (filterTo) params.set('to', filterTo);
      if (searchQuery) params.set('search', searchQuery);
      params.set('limit', PAGE_SIZE.toString());
      params.set('offset', currentOffset.toString());

      const data = await apiGet<AuditResponse>(`/api/audit?${params.toString()}`);

      if (reset) {
        setLogs(data.logs);
        setOffset(PAGE_SIZE);
      } else {
        setLogs((prev) => [...prev, ...data.logs]);
        setOffset((prev) => prev + PAGE_SIZE);
      }
      setTotal(data.total);
    } catch {
      toast.error('Не удалось загрузить журнал аудита');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filterAction, filterFrom, filterTo, searchQuery, offset]);

  // Reset and reload when filters change
  useEffect(() => {
    setOffset(0);
    fetchLogs(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterAction, filterFrom, filterTo, searchQuery]);

  const handleLoadMore = () => {
    fetchLogs(false);
  };

  const hasMore = logs.length < total;

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Журнал аудита</h1>
          <p className="text-muted-foreground">
            История действий пользователей в системе
          </p>
        </div>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Журнал аудита</h1>
          <p className="text-muted-foreground">
            История действий пользователей в системе
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            Записей: {total}
          </Badge>
          <Button
            variant={showFilters ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-3.5 w-3.5" />
            Фильтры
          </Button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Поиск</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Поиск в деталях..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 w-[200px]"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Тип действия</Label>
                <Select value={filterAction} onValueChange={setFilterAction}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Все действия" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все действия</SelectItem>
                    {ACTION_TYPES.map((at) => (
                      <SelectItem key={at.value} value={at.value}>
                        {at.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">От</Label>
                <Input
                  type="datetime-local"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                  className="w-[180px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">До</Label>
                <Input
                  type="datetime-local"
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                  className="w-[180px]"
                />
              </div>
              {(filterAction !== 'all' || filterFrom || filterTo || searchQuery) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilterAction('all');
                    setFilterFrom('');
                    setFilterTo('');
                    setSearchQuery('');
                  }}
                >
                  Сбросить
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Audit Table */}
      {logs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ClipboardList className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Журнал пуст</h3>
            <p className="text-muted-foreground">
              Записи аудита появятся при действиях пользователей
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        Время
                      </div>
                    </th>
                    <th className="text-left p-3 font-medium whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5" />
                        Пользователь
                      </div>
                    </th>
                    <th className="text-left p-3 font-medium">Действие</th>
                    <th className="text-left p-3 font-medium">Цель</th>
                    <th className="text-left p-3 font-medium">Детали</th>
                    <th className="text-left p-3 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(log.createdAt)}
                      </td>
                      <td className="p-3">
                        <div>
                          <p className="font-medium text-sm">{log.user.name}</p>
                          <p className="text-xs text-muted-foreground">{log.user.email}</p>
                        </div>
                      </td>
                      <td className="p-3">
                        {getActionBadge(log.action)}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {log.targetType && (
                          <span className="text-xs bg-muted px-1.5 py-0.5 rounded mr-1">
                            {log.targetType}
                          </span>
                        )}
                        {log.target ? (
                          <span className="font-mono text-xs">{log.target.slice(0, 12)}...</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground max-w-[250px] truncate text-xs">
                        {parseDetails(log.details)}
                      </td>
                      <td className="p-3 text-muted-foreground font-mono text-xs">
                        {log.ip || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Load More */}
            {hasMore && (
              <div className="flex justify-center p-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  Загрузить еще ({logs.length} из {total})
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
