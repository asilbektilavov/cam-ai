'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Workflow,
  Plus,
  Edit,
  Trash2,
  Zap,
  Bell,
  Clock,
  Shield,
  Play,
  Pause,
  Loader2,
  Hash,
  Webhook,
  MessageCircle,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';

// ── Types ──────────────────────────────────────────────────────────────

interface AutomationTrigger {
  eventType: string | null;
  severity: string[];
  cameraId: string | null;
  schedule: { from: string; to: string } | null;
}

interface AutomationAction {
  type: string;
  message: string;
}

interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  trigger: AutomationTrigger;
  conditions: unknown[];
  actions: AutomationAction[];
  enabled: boolean;
  lastTriggeredAt: string | null;
  triggerCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CameraOption {
  id: string;
  name: string;
  location: string;
}

// ── Constants ──────────────────────────────────────────────────────────

const EVENT_TYPES: { value: string; label: string }[] = [
  { value: 'fire_detected', label: 'Огонь' },
  { value: 'smoke_detected', label: 'Дым' },
  { value: 'motion_detected', label: 'Движение' },
  { value: 'alert', label: 'Тревога' },
  { value: 'smart_alert', label: 'Умная тревога' },
  { value: 'line_crossing', label: 'Пересечение линии' },
  { value: 'queue_alert', label: 'Длинная очередь' },
  { value: 'abandoned_object', label: 'Оставленный предмет' },
  { value: 'tamper_detected', label: 'Саботаж камеры' },
  { value: 'ppe_violation', label: 'Нарушение СИЗ' },
  { value: 'plate_detected', label: 'Номер авто' },
  { value: 'person_sighting', label: 'Обнаружен человек' },
];

const EVENT_TYPE_MAP: Record<string, string> = Object.fromEntries(
  EVENT_TYPES.map((et) => [et.value, et.label])
);

const SEVERITY_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'critical', label: 'Критический', color: 'text-red-500' },
  { value: 'warning', label: 'Предупреждение', color: 'text-yellow-500' },
  { value: 'info', label: 'Информация', color: 'text-blue-500' },
];

const ACTION_TYPES: { value: string; label: string; icon: React.ElementType }[] = [
  { value: 'notify_telegram', label: 'Telegram', icon: MessageCircle },
  { value: 'notify_slack', label: 'Slack', icon: Hash },
  { value: 'notify_webhook', label: 'Webhook', icon: Webhook },
  { value: 'create_event', label: 'Создать событие', icon: Zap },
];

const ACTION_TYPE_MAP: Record<string, string> = Object.fromEntries(
  ACTION_TYPES.map((at) => [at.value, at.label])
);

const DEFAULT_MESSAGE = 'Обнаружен {event} на камере {camera} в {time}';

// ── Empty form state ───────────────────────────────────────────────────

function emptyForm() {
  return {
    name: '',
    description: '',
    eventType: '',
    severity: [] as string[],
    cameraId: '',
    scheduleFrom: '',
    scheduleTo: '',
    actionType: 'notify_telegram',
    actionMessage: DEFAULT_MESSAGE,
    enabled: true,
  };
}

// ── Page ───────────────────────────────────────────────────────────────

export default function AutomationPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());

  // ── Data loading ─────────────────────────────────────────────────

  const loadRules = useCallback(async () => {
    try {
      const data = await apiGet<AutomationRule[]>('/api/automation');
      setRules(data);
    } catch {
      toast.error('Не удалось загрузить правила автоматизации');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCameras = useCallback(async () => {
    try {
      const data = await apiGet<CameraOption[]>('/api/cameras');
      setCameras(
        Array.isArray(data)
          ? data.map((c: CameraOption) => ({ id: c.id, name: c.name, location: c.location }))
          : []
      );
    } catch {
      // cameras optional
    }
  }, []);

  useEffect(() => {
    loadRules();
    loadCameras();
  }, [loadRules, loadCameras]);

  // ── Handlers ─────────────────────────────────────────────────────

  const openCreateDialog = () => {
    setEditingId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEditDialog = (rule: AutomationRule) => {
    setEditingId(rule.id);
    const trigger = rule.trigger;
    const action = rule.actions?.[0];
    setForm({
      name: rule.name,
      description: rule.description || '',
      eventType: trigger?.eventType || '',
      severity: trigger?.severity || [],
      cameraId: trigger?.cameraId || '',
      scheduleFrom: trigger?.schedule?.from || '',
      scheduleTo: trigger?.schedule?.to || '',
      actionType: action?.type || 'notify_telegram',
      actionMessage: action?.message || DEFAULT_MESSAGE,
      enabled: rule.enabled,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Укажите название правила');
      return;
    }
    if (!form.eventType) {
      toast.error('Выберите тип события');
      return;
    }

    setSaving(true);

    const trigger: AutomationTrigger = {
      eventType: form.eventType || null,
      severity: form.severity,
      cameraId: form.cameraId || null,
      schedule:
        form.scheduleFrom && form.scheduleTo
          ? { from: form.scheduleFrom, to: form.scheduleTo }
          : null,
    };

    const actions: AutomationAction[] = [
      {
        type: form.actionType,
        message: form.actionMessage || DEFAULT_MESSAGE,
      },
    ];

    const payload = {
      name: form.name,
      description: form.description || null,
      trigger,
      conditions: [],
      actions,
      enabled: form.enabled,
    };

    try {
      if (editingId) {
        const updated = await apiPatch<AutomationRule>(`/api/automation/${editingId}`, payload);
        setRules((prev) => prev.map((r) => (r.id === editingId ? updated : r)));
        toast.success('Правило обновлено');
      } else {
        const created = await apiPost<AutomationRule>('/api/automation', payload);
        setRules((prev) => [created, ...prev]);
        toast.success('Правило создано');
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (rule: AutomationRule) => {
    const newEnabled = !rule.enabled;
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: newEnabled } : r)));

    try {
      await apiPatch(`/api/automation/${rule.id}`, { enabled: newEnabled });
      toast.success(newEnabled ? 'Правило включено' : 'Правило отключено');
    } catch {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !newEnabled } : r)));
      toast.error('Ошибка переключения');
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await apiDelete(`/api/automation/${id}`);
      setRules((prev) => prev.filter((r) => r.id !== id));
      toast.success('Правило удалено');
    } catch {
      toast.error('Ошибка удаления');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleSeverity = (value: string) => {
    setForm((prev) => ({
      ...prev,
      severity: prev.severity.includes(value)
        ? prev.severity.filter((s) => s !== value)
        : [...prev.severity, value],
    }));
  };

  // ── Render helpers ───────────────────────────────────────────────

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Никогда';
    return new Date(dateStr).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' });
  };

  const getTriggerBadge = (trigger: AutomationTrigger) => {
    return EVENT_TYPE_MAP[trigger?.eventType || ''] || 'Любое событие';
  };

  const getActionBadge = (actions: AutomationAction[]) => {
    if (!actions || actions.length === 0) return 'Нет действий';
    return ACTION_TYPE_MAP[actions[0]?.type || ''] || actions[0]?.type || 'Неизвестно';
  };

  const getActionIcon = (actionType: string) => {
    const found = ACTION_TYPES.find((a) => a.value === actionType);
    return found?.icon || Zap;
  };

  // ── Loading state ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────

  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Workflow className="h-6 w-6" />
            Автоматизация
          </h1>
          <p className="text-muted-foreground">
            {rules.length === 0
              ? 'Создайте правила для автоматической реакции на события'
              : `${enabledCount} из ${rules.length} правил активны`}
          </p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2">
          <Plus className="h-4 w-4" />
          Создать правило
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground mb-1">Всего правил</p>
            <p className="text-2xl font-bold">{rules.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground mb-1">Активные</p>
            <p className="text-2xl font-bold text-green-500">{enabledCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground mb-1">Отключённые</p>
            <p className="text-2xl font-bold text-muted-foreground">{rules.length - enabledCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground mb-1">Всего срабатываний</p>
            <p className="text-2xl font-bold">
              {rules.reduce((sum, r) => sum + r.triggerCount, 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Empty state */}
      {rules.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Workflow className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Нет правил автоматизации</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md">
              Создайте правила, чтобы автоматически отправлять уведомления,
              создавать события или вызывать вебхуки при определённых событиях на камерах.
            </p>
            <Button onClick={openCreateDialog} className="gap-2">
              <Plus className="h-4 w-4" />
              Создать первое правило
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Rules list */}
      <div className="grid gap-4">
        {rules.map((rule) => {
          const ActionIcon = getActionIcon(rule.actions?.[0]?.type || '');
          return (
            <Card
              key={rule.id}
              className={cn(
                'transition-all',
                rule.enabled ? 'border-green-500/20 bg-green-500/[0.02]' : 'opacity-70'
              )}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  {/* Left: info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold truncate">{rule.name}</h3>
                      {rule.enabled ? (
                        <Play className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      ) : (
                        <Pause className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                    </div>
                    {rule.description && (
                      <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                        {rule.description}
                      </p>
                    )}

                    {/* Badges */}
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <Badge variant="secondary" className="gap-1">
                        <Zap className="h-3 w-3" />
                        {getTriggerBadge(rule.trigger)}
                      </Badge>

                      {rule.trigger?.severity && rule.trigger.severity.length > 0 && (
                        <Badge variant="outline" className="gap-1">
                          <Shield className="h-3 w-3" />
                          {rule.trigger.severity
                            .map(
                              (s) =>
                                SEVERITY_OPTIONS.find((so) => so.value === s)?.label || s
                            )
                            .join(', ')}
                        </Badge>
                      )}

                      <Badge variant="outline" className="gap-1">
                        <ActionIcon className="h-3 w-3" />
                        {getActionBadge(rule.actions)}
                      </Badge>

                      {rule.trigger?.schedule && (
                        <Badge variant="outline" className="gap-1">
                          <Clock className="h-3 w-3" />
                          {rule.trigger.schedule.from} - {rule.trigger.schedule.to}
                        </Badge>
                      )}
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Bell className="h-3 w-3" />
                        Срабатываний: {rule.triggerCount}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Последнее: {formatDate(rule.lastTriggeredAt)}
                      </span>
                    </div>
                  </div>

                  {/* Right: controls */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={() => handleToggle(rule)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEditDialog(rule)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      disabled={deletingId === rule.id}
                      onClick={() => handleDelete(rule.id)}
                    >
                      {deletingId === rule.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Редактировать правило' : 'Создать правило'}
            </DialogTitle>
            <DialogDescription>
              Настройте триггер и действие для автоматической реакции на события
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 mt-2">
            {/* Name */}
            <div className="space-y-2">
              <Label>Название *</Label>
              <Input
                placeholder="Например: Оповещение о пожаре"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label>Описание</Label>
              <Textarea
                placeholder="Опишите что делает это правило..."
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                className="min-h-16 resize-none"
              />
            </div>

            {/* ── Trigger section ──────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Zap className="h-4 w-4 text-yellow-500" />
                Триггер
              </div>

              {/* Event type */}
              <div className="space-y-2">
                <Label>Тип события *</Label>
                <Select
                  value={form.eventType}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, eventType: value }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Выберите тип события" />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((et) => (
                      <SelectItem key={et.value} value={et.value}>
                        {et.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Severity */}
              <div className="space-y-2">
                <Label>Уровень серьёзности</Label>
                <div className="flex flex-wrap gap-3">
                  {SEVERITY_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Checkbox
                        checked={form.severity.includes(opt.value)}
                        onCheckedChange={() => toggleSeverity(opt.value)}
                      />
                      <span className={cn('text-sm', opt.color)}>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Camera selector */}
              <div className="space-y-2">
                <Label>Камера</Label>
                <Select
                  value={form.cameraId || '__all__'}
                  onValueChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      cameraId: value === '__all__' ? '' : value,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Все камеры" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Все камеры</SelectItem>
                    {cameras.map((cam) => (
                      <SelectItem key={cam.id} value={cam.id}>
                        {cam.name} ({cam.location})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Schedule */}
              <div className="space-y-2">
                <Label>Расписание (необязательно)</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Input
                      type="time"
                      value={form.scheduleFrom}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, scheduleFrom: e.target.value }))
                      }
                      placeholder="С"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground">—</span>
                  <div className="flex-1">
                    <Input
                      type="time"
                      value={form.scheduleTo}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, scheduleTo: e.target.value }))
                      }
                      placeholder="До"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Правило сработает только в указанный промежуток времени
                </p>
              </div>
            </div>

            {/* ── Action section ───────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Bell className="h-4 w-4 text-blue-500" />
                Действие
              </div>

              {/* Action type */}
              <div className="space-y-2">
                <Label>Тип действия</Label>
                <Select
                  value={form.actionType}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, actionType: value }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_TYPES.map((at) => (
                      <SelectItem key={at.value} value={at.value}>
                        <div className="flex items-center gap-2">
                          <at.icon className="h-4 w-4" />
                          {at.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Message template */}
              <div className="space-y-2">
                <Label>Шаблон сообщения</Label>
                <Textarea
                  placeholder={DEFAULT_MESSAGE}
                  value={form.actionMessage}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, actionMessage: e.target.value }))
                  }
                  className="min-h-20 resize-none"
                />
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { tag: '{event}', label: 'Событие' },
                    { tag: '{camera}', label: 'Камера' },
                    { tag: '{location}', label: 'Локация' },
                    { tag: '{time}', label: 'Время' },
                    { tag: '{severity}', label: 'Уровень' },
                  ].map((placeholder) => (
                    <button
                      key={placeholder.tag}
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          actionMessage: prev.actionMessage + ' ' + placeholder.tag,
                        }))
                      }
                      className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {placeholder.tag} — {placeholder.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Warning about integration requirement */}
              {form.actionType !== 'create_event' && (
                <div className="flex items-start gap-2 rounded-md border border-yellow-500/20 bg-yellow-500/5 p-3">
                  <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Для отправки уведомлений необходимо настроить соответствующую интеграцию
                    ({ACTION_TYPE_MAP[form.actionType] || form.actionType}) в разделе Интеграции.
                  </p>
                </div>
              )}
            </div>

            {/* Enabled toggle */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Включить правило</p>
                <p className="text-xs text-muted-foreground">
                  Правило начнёт работать сразу после сохранения
                </p>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, enabled: checked }))
                }
              />
            </div>

            {/* Save button */}
            <div className="flex gap-2 pt-1">
              <Button className="flex-1" onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editingId ? 'Сохранить' : 'Создать'}
              </Button>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Отмена
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
