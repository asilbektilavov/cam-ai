'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Car,
  Search,
  Plus,
  Edit,
  Trash2,
  Shield,
  Clock,
  Loader2,
  Download,
  Upload,
  BarChart3,
  CheckSquare,
  RefreshCw,
  Image as ImageIcon,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';

// --- Types ---

interface LicensePlate {
  id: string;
  number: string;
  type: string;
  ownerName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { detections: number };
}

interface PlateDetection {
  id: string;
  number: string;
  confidence: number;
  imagePath: string | null;
  timestamp: string;
  licensePlateId: string | null;
  camera: { id: string; name: string; location: string };
  licensePlate: { id: string; number: string; type: string; ownerName: string | null } | null;
}

interface CameraOption {
  id: string;
  name: string;
}

// --- Helpers ---

function getTypeBadge(type: string) {
  switch (type) {
    case 'whitelist':
      return <Badge className="bg-green-500/15 text-green-600 border-green-500/30 hover:bg-green-500/20">Белый</Badge>;
    case 'blacklist':
      return <Badge className="bg-red-500/15 text-red-600 border-red-500/30 hover:bg-red-500/20">Черный</Badge>;
    default:
      return <Badge variant="secondary">Нейтральный</Badge>;
  }
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

// ===========================
// Main LPR Page
// ===========================

export default function LPRPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Номера авто</h1>
        <p className="text-muted-foreground">
          Распознавание номерных знаков и управление базой
        </p>
      </div>

      <Tabs defaultValue="journal">
        <TabsList>
          <TabsTrigger value="journal">Журнал</TabsTrigger>
          <TabsTrigger value="database">База номеров</TabsTrigger>
          <TabsTrigger value="stats">Статистика</TabsTrigger>
        </TabsList>

        <TabsContent value="journal">
          <JournalTab />
        </TabsContent>
        <TabsContent value="database">
          <DatabaseTab />
        </TabsContent>
        <TabsContent value="stats">
          <StatsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ===========================
// Journal Tab (Live Detections)
// ===========================

function JournalTab() {
  const [detections, setDetections] = useState<PlateDetection[]>([]);
  const [loading, setLoading] = useState(true);
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [filterCamera, setFilterCamera] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDetections = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterCamera && filterCamera !== 'all') params.set('cameraId', filterCamera);
      if (filterType && filterType !== 'all') params.set('type', filterType);
      if (filterFrom) params.set('from', filterFrom);
      if (filterTo) params.set('to', filterTo);
      if (searchQuery) params.set('search', searchQuery);
      params.set('limit', '50');

      const data = await apiGet<PlateDetection[]>(`/api/lpr/detections?${params.toString()}`);
      setDetections(data);
    } catch {
      console.error('Failed to fetch detections');
    } finally {
      setLoading(false);
    }
  }, [filterCamera, filterType, filterFrom, filterTo, searchQuery]);

  const fetchCameras = useCallback(async () => {
    try {
      const data = await apiGet<CameraOption[]>('/api/cameras');
      setCameras(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  useEffect(() => {
    fetchDetections();
  }, [fetchDetections]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        fetchDetections();
      }, 10000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchDetections]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Поиск номера</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="A001AA"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-[180px]"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Камера</Label>
              <Select value={filterCamera} onValueChange={setFilterCamera}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Все камеры" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все камеры</SelectItem>
                  {cameras.map((cam) => (
                    <SelectItem key={cam.id} value={cam.id}>{cam.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Тип</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Все типы" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все типы</SelectItem>
                  <SelectItem value="whitelist">Белый список</SelectItem>
                  <SelectItem value="blacklist">Черный список</SelectItem>
                  <SelectItem value="neutral">Нейтральный</SelectItem>
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
            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant={autoRefresh ? 'default' : 'outline'}
                size="sm"
                className="gap-1.5"
                onClick={() => setAutoRefresh(!autoRefresh)}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', autoRefresh && 'animate-spin')} />
                Авто
              </Button>
              <Button variant="outline" size="sm" onClick={fetchDetections}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detections Table */}
      {detections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Car className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Нет данных</h3>
            <p className="text-muted-foreground">
              Распознавания номеров пока не зафиксированы
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
                    <th className="text-left p-3 font-medium">Время</th>
                    <th className="text-left p-3 font-medium">Камера</th>
                    <th className="text-left p-3 font-medium">Номер</th>
                    <th className="text-left p-3 font-medium">Тип</th>
                    <th className="text-left p-3 font-medium">Владелец</th>
                    <th className="text-right p-3 font-medium">Точность</th>
                    <th className="text-center p-3 font-medium">Фото</th>
                  </tr>
                </thead>
                <tbody>
                  {detections.map((det) => (
                    <tr key={det.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(det.timestamp)}
                      </td>
                      <td className="p-3">{det.camera.name}</td>
                      <td className="p-3">
                        <span className="font-mono font-semibold text-base">{det.number}</span>
                      </td>
                      <td className="p-3">
                        {det.licensePlate ? getTypeBadge(det.licensePlate.type) : (
                          <Badge variant="outline">Неизвестен</Badge>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {det.licensePlate?.ownerName || '—'}
                      </td>
                      <td className="p-3 text-right">
                        <span className={cn(
                          'font-medium',
                          det.confidence >= 0.9 ? 'text-green-600' :
                          det.confidence >= 0.7 ? 'text-yellow-600' : 'text-red-600'
                        )}>
                          {(det.confidence * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        {det.imagePath ? (
                          <button
                            type="button"
                            className="inline-block rounded overflow-hidden border border-border hover:border-primary transition-colors cursor-pointer"
                            onClick={() => setPreviewSrc(det.imagePath)}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={det.imagePath}
                              alt={det.number}
                              className="h-10 w-auto object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).parentElement!.style.display = 'none';
                              }}
                            />
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Full-size screenshot preview */}
      <Dialog open={!!previewSrc} onOpenChange={() => setPreviewSrc(null)}>
        <DialogContent className="max-w-2xl p-2">
          {previewSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewSrc}
              alt="Скриншот распознавания"
              className="w-full h-auto rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===========================
// Database Tab (Manage Plates)
// ===========================

function DatabaseTab() {
  const [plates, setPlates] = useState<LicensePlate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPlate, setEditingPlate] = useState<LicensePlate | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Add form
  const [newNumber, setNewNumber] = useState('');
  const [newType, setNewType] = useState('neutral');
  const [newOwner, setNewOwner] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Edit form
  const [editNumber, setEditNumber] = useState('');
  const [editType, setEditType] = useState('neutral');
  const [editOwner, setEditOwner] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const fetchPlates = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterType && filterType !== 'all') params.set('type', filterType);
      const data = await apiGet<LicensePlate[]>(`/api/lpr/plates?${params.toString()}`);
      setPlates(data);
    } catch {
      toast.error('Не удалось загрузить номера');
    } finally {
      setLoading(false);
    }
  }, [search, filterType]);

  useEffect(() => {
    fetchPlates();
  }, [fetchPlates]);

  const handleAdd = async () => {
    if (!newNumber.trim()) {
      toast.error('Введите номер');
      return;
    }
    setSaving(true);
    try {
      await apiPost('/api/lpr/plates', {
        number: newNumber.trim(),
        type: newType,
        ownerName: newOwner.trim() || null,
        notes: newNotes.trim() || null,
      });
      toast.success('Номер добавлен');
      setAddDialogOpen(false);
      setNewNumber('');
      setNewType('neutral');
      setNewOwner('');
      setNewNotes('');
      fetchPlates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка добавления');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editingPlate) return;
    setSaving(true);
    try {
      await apiPatch(`/api/lpr/plates/${editingPlate.id}`, {
        number: editNumber.trim(),
        type: editType,
        ownerName: editOwner.trim() || null,
        notes: editNotes.trim() || null,
      });
      toast.success('Номер обновлен');
      setEditDialogOpen(false);
      setEditingPlate(null);
      fetchPlates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка обновления');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDelete(`/api/lpr/plates/${id}`);
      toast.success('Номер удален');
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      fetchPlates();
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  const openEditDialog = (plate: LicensePlate) => {
    setEditingPlate(plate);
    setEditNumber(plate.number);
    setEditType(plate.type);
    setEditOwner(plate.ownerName || '');
    setEditNotes(plate.notes || '');
    setEditDialogOpen(true);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === plates.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(plates.map((p) => p.id)));
    }
  };

  const handleBulkChangeType = async (type: string) => {
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map((id) => apiPatch(`/api/lpr/plates/${id}`, { type })));
      toast.success(`${ids.length} номеров обновлено`);
      setSelectedIds(new Set());
      fetchPlates();
    } catch {
      toast.error('Ошибка массового обновления');
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map((id) => apiDelete(`/api/lpr/plates/${id}`)));
      toast.success(`${ids.length} номеров удалено`);
      setSelectedIds(new Set());
      fetchPlates();
    } catch {
      toast.error('Ошибка массового удаления');
    }
  };

  const handleExport = () => {
    const csv = [
      'Номер,Тип,Владелец,Заметки',
      ...plates.map((p) =>
        `${p.number},${p.type},${p.ownerName || ''},${(p.notes || '').replace(/,/g, ';')}`
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plates-export.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Экспорт завершен');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter((l) => l.trim());
      // Skip header
      const dataLines = lines.slice(1);
      let added = 0;
      for (const line of dataLines) {
        const parts = line.split(',').map((s) => s.trim());
        if (parts.length >= 2) {
          try {
            await apiPost('/api/lpr/plates', {
              number: parts[0],
              type: parts[1] || 'neutral',
              ownerName: parts[2] || null,
              notes: parts[3] || null,
            });
            added++;
          } catch {
            // skip duplicates
          }
        }
      }
      toast.success(`Импортировано ${added} номеров`);
      fetchPlates();
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      {/* Actions Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по номеру..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Все типы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="whitelist">Белый список</SelectItem>
            <SelectItem value="blacklist">Черный список</SelectItem>
            <SelectItem value="neutral">Нейтральный</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" />
            Экспорт
          </Button>
          <Label className="cursor-pointer">
            <Button variant="outline" size="sm" className="gap-1.5" asChild>
              <span>
                <Upload className="h-3.5 w-3.5" />
                Импорт
              </span>
            </Button>
            <input type="file" accept=".csv" className="hidden" onChange={handleImport} />
          </Label>
          <Button size="sm" className="gap-1.5" onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Добавить
          </Button>
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <CheckSquare className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Выбрано: {selectedIds.size}</span>
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={() => handleBulkChangeType('whitelist')}>
                Белый
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleBulkChangeType('blacklist')}>
                Черный
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleBulkChangeType('neutral')}>
                Нейтральный
              </Button>
              <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Удалить
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plates Table */}
      {plates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Shield className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">База пуста</h3>
            <p className="text-muted-foreground mb-4">
              Добавьте номера в белый или черный список
            </p>
            <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Добавить номер
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-3 w-10">
                      <Checkbox
                        checked={selectedIds.size === plates.length && plates.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </th>
                    <th className="text-left p-3 font-medium">Номер</th>
                    <th className="text-left p-3 font-medium">Тип</th>
                    <th className="text-left p-3 font-medium">Владелец</th>
                    <th className="text-left p-3 font-medium">Заметки</th>
                    <th className="text-right p-3 font-medium">Распознаваний</th>
                    <th className="text-right p-3 font-medium w-24">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {plates.map((plate) => (
                    <tr key={plate.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <Checkbox
                          checked={selectedIds.has(plate.id)}
                          onCheckedChange={() => toggleSelect(plate.id)}
                        />
                      </td>
                      <td className="p-3">
                        <span className="font-mono font-semibold text-base">{plate.number}</span>
                      </td>
                      <td className="p-3">{getTypeBadge(plate.type)}</td>
                      <td className="p-3 text-muted-foreground">{plate.ownerName || '—'}</td>
                      <td className="p-3 text-muted-foreground max-w-[200px] truncate">
                        {plate.notes || '—'}
                      </td>
                      <td className="p-3 text-right">{plate._count.detections}</td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEditDialog(plate)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => handleDelete(plate.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add Plate Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить номер</DialogTitle>
            <DialogDescription>
              Добавьте номерной знак в базу данных
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Номер</Label>
              <Input
                placeholder="A001AA777"
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-2">
              <Label>Тип</Label>
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whitelist">Белый список</SelectItem>
                  <SelectItem value="blacklist">Черный список</SelectItem>
                  <SelectItem value="neutral">Нейтральный</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Владелец</Label>
              <Input
                placeholder="Иванов Иван Иванович"
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Заметки</Label>
              <Input
                placeholder="Служебный транспорт"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
              />
            </div>
            <Button className="w-full" onClick={handleAdd} disabled={saving || !newNumber.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Добавить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Plate Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Редактировать номер</DialogTitle>
            <DialogDescription>
              Изменение данных номерного знака
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Номер</Label>
              <Input
                placeholder="A001AA777"
                value={editNumber}
                onChange={(e) => setEditNumber(e.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-2">
              <Label>Тип</Label>
              <Select value={editType} onValueChange={setEditType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whitelist">Белый список</SelectItem>
                  <SelectItem value="blacklist">Черный список</SelectItem>
                  <SelectItem value="neutral">Нейтральный</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Владелец</Label>
              <Input
                placeholder="Иванов Иван Иванович"
                value={editOwner}
                onChange={(e) => setEditOwner(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Заметки</Label>
              <Input
                placeholder="Служебный транспорт"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </div>
            <Button className="w-full" onClick={handleEdit} disabled={saving || !editNumber.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===========================
// Statistics Tab
// ===========================

function StatsTab() {
  const [detections, setDetections] = useState<PlateDetection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Fetch a larger window for stats
        const now = new Date();
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const data = await apiGet<PlateDetection[]>(
          `/api/lpr/detections?from=${monthAgo.toISOString()}&limit=200`
        );
        setDetections(data);
      } catch {
        toast.error('Не удалось загрузить статистику');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const todayCount = detections.filter((d) => new Date(d.timestamp) >= todayStart).length;
  const weekCount = detections.filter((d) => new Date(d.timestamp) >= weekAgo).length;
  const monthCount = detections.length;

  // Most seen plates
  const plateCounts = new Map<string, number>();
  for (const det of detections) {
    plateCounts.set(det.number, (plateCounts.get(det.number) || 0) + 1);
  }
  const topPlates = Array.from(plateCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Detection timeline (last 7 days)
  const dayLabels: string[] = [];
  const dayCounts: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    dayLabels.push(dayStart.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }));
    dayCounts.push(
      detections.filter((d) => {
        const t = new Date(d.timestamp);
        return t >= dayStart && t < dayEnd;
      }).length
    );
  }
  const maxCount = Math.max(...dayCounts, 1);

  return (
    <div className="space-y-4 mt-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <Car className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{todayCount}</p>
              <p className="text-sm text-muted-foreground">Сегодня</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <Clock className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{weekCount}</p>
              <p className="text-sm text-muted-foreground">За неделю</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
              <BarChart3 className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{monthCount}</p>
              <p className="text-sm text-muted-foreground">За месяц</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Detection Timeline */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-4">Распознавания за неделю</h3>
            <div className="flex items-end gap-2 h-40">
              {dayCounts.map((count, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-muted-foreground">{count}</span>
                  <div
                    className="w-full bg-primary/80 rounded-t transition-all"
                    style={{ height: `${(count / maxCount) * 100}%`, minHeight: count > 0 ? '4px' : '0px' }}
                  />
                  <span className="text-[10px] text-muted-foreground">{dayLabels[i]}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Most Seen Plates */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-4">Часто встречающиеся номера</h3>
            {topPlates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет данных</p>
            ) : (
              <div className="space-y-2">
                {topPlates.map(([plate, count], i) => {
                  const det = detections.find((d) => d.number === plate);
                  return (
                    <div key={plate} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                      <span className="font-mono font-semibold flex-1">{plate}</span>
                      {det?.licensePlate && getTypeBadge(det.licensePlate.type)}
                      <span className="text-sm text-muted-foreground">{count} раз</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
