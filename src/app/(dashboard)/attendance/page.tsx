'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  UserCheck,
  Plus,
  Trash2,
  Loader2,
  Clock,
  LogIn,
  LogOut,
  Users,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  UserX,
  RefreshCw,
  Camera,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { apiGet, apiPost, apiDelete } from '@/lib/api-client';
import { FaceExtractor } from '@/components/person-search/face-extractor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Employee {
  id: string;
  name: string;
  position: string | null;
  department: string | null;
  photoPath: string | null;
  faceDescriptor: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { attendanceRecords: number };
}

interface AttendanceRecord {
  id: string;
  employeeId: string;
  cameraId: string;
  direction: 'check_in' | 'check_out';
  confidence: number;
  snapshotPath: string | null;
  timestamp: string;
  employee: {
    id: string;
    name: string;
    position: string | null;
    department: string | null;
    photoPath: string | null;
  };
}

interface AttendanceCamera {
  id: string;
  name: string;
  location: string;
  purpose: string;
  status: string;
  isMonitoring: boolean;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AttendancePage() {
  const [tab, setTab] = useState<'today' | 'employees' | 'cameras'>('today');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendanceCameras, setAttendanceCameras] = useState<AttendanceCamera[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });

  // Add employee form
  const [newName, setNewName] = useState('');
  const [newPosition, setNewPosition] = useState('');
  const [newDepartment, setNewDepartment] = useState('');
  const [extractedData, setExtractedData] = useState<{
    photoBase64: string;
    descriptor: number[];
  } | null>(null);
  const [saving, setSaving] = useState(false);

  // Detail expand
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [employeeRecords, setEmployeeRecords] = useState<AttendanceRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // ---------- Fetch ----------

  const fetchRecords = useCallback(async () => {
    try {
      const data = await apiGet<AttendanceRecord[]>(
        `/api/attendance?date=${selectedDate}`
      );
      setRecords(data);
    } catch {
      toast.error('Не удалось загрузить записи');
    }
  }, [selectedDate]);

  const fetchEmployees = useCallback(async () => {
    try {
      const data = await apiGet<Employee[]>('/api/attendance/employees');
      setEmployees(data);
    } catch {
      toast.error('Не удалось загрузить сотрудников');
    }
  }, []);

  const fetchCameras = useCallback(async () => {
    try {
      const all = await apiGet<AttendanceCamera[]>('/api/cameras');
      setAttendanceCameras(all.filter((c) => c.purpose.startsWith('attendance_')));
    } catch {
      // cameras may fail if no branch selected, ignore
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchRecords(), fetchEmployees(), fetchCameras()]).finally(() =>
      setLoading(false)
    );
  }, [fetchRecords, fetchEmployees, fetchCameras]);

  // ---------- Handlers ----------

  const handleAddEmployee = async () => {
    if (!newName.trim()) {
      toast.error('Введите имя сотрудника');
      return;
    }
    if (!extractedData) {
      toast.error('Загрузите фото и дождитесь извлечения лица');
      return;
    }
    setSaving(true);
    try {
      await apiPost('/api/attendance/employees', {
        name: newName.trim(),
        position: newPosition.trim() || null,
        department: newDepartment.trim() || null,
        photoBase64: extractedData.photoBase64,
        faceDescriptor: extractedData.descriptor,
      });
      toast.success(`Сотрудник "${newName}" добавлен`);
      setAddDialogOpen(false);
      setNewName('');
      setNewPosition('');
      setNewDepartment('');
      setExtractedData(null);
      fetchEmployees();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEmployee = async (id: string, name: string) => {
    if (!confirm(`Удалить сотрудника "${name}"?`)) return;
    try {
      await apiDelete(`/api/attendance/${id}`);
      toast.success('Сотрудник удалён');
      fetchEmployees();
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  const handleExpandEmployee = async (employeeId: string) => {
    if (expandedId === employeeId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(employeeId);
    setDetailLoading(true);
    try {
      const data = await apiGet<AttendanceRecord[]>(
        `/api/attendance?employeeId=${employeeId}`
      );
      setEmployeeRecords(data);
    } catch {
      toast.error('Ошибка загрузки');
    } finally {
      setDetailLoading(false);
    }
  };

  // ---------- Stats ----------
  // Records are sorted by timestamp DESC. Find each employee's latest record.

  const latestByEmployee = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of records) {
      if (!map.has(r.employeeId)) {
        map.set(r.employeeId, r); // first = most recent (DESC order)
      }
    }
    return map;
  }, [records]);

  const uniquePresent = new Set(
    records.filter((r) => r.direction === 'check_in').map((r) => r.employeeId)
  );
  const currentlyInside = [...latestByEmployee.values()].filter(
    (r) => r.direction === 'check_in'
  ).length;
  const currentlyLeft = [...latestByEmployee.values()].filter(
    (r) => r.direction === 'check_out'
  ).length;

  // ---------- Render ----------

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserCheck className="h-7 w-7" />
            Учёт посещаемости
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Автоматический учёт по Face ID
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { fetchRecords(); fetchEmployees(); fetchCameras(); }}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Обновить
          </Button>
          <Button size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Добавить сотрудника
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-500/10 p-2">
                <Users className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{employees.length}</p>
                <p className="text-xs text-muted-foreground">Сотрудников</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-500/10 p-2">
                <LogIn className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{uniquePresent.size}</p>
                <p className="text-xs text-muted-foreground">Пришли сегодня</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-orange-500/10 p-2">
                <LogOut className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{currentlyLeft}</p>
                <p className="text-xs text-muted-foreground">Ушли</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-500/10 p-2">
                <UserCheck className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{currentlyInside}</p>
                <p className="text-xs text-muted-foreground">Сейчас на месте</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        <button
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            tab === 'today'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setTab('today')}
        >
          <CalendarDays className="h-4 w-4 inline mr-1" />
          Журнал за день
        </button>
        <button
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            tab === 'employees'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setTab('employees')}
        >
          <Users className="h-4 w-4 inline mr-1" />
          Сотрудники ({employees.length})
        </button>
        <button
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            tab === 'cameras'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setTab('cameras')}
        >
          <Camera className="h-4 w-4 inline mr-1" />
          Камеры ({attendanceCameras.length})
        </button>
      </div>

      {/* Tab: Today */}
      {tab === 'today' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Label>Дата:</Label>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-auto"
            />
          </div>

          {records.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Нет записей за выбранную дату</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Записи ({records.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {records.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 py-3"
                    >
                      <div
                        className={cn(
                          'rounded-full p-1.5',
                          r.direction === 'check_in'
                            ? 'bg-green-500/10 text-green-500'
                            : 'bg-orange-500/10 text-orange-500'
                        )}
                      >
                        {r.direction === 'check_in' ? (
                          <LogIn className="h-4 w-4" />
                        ) : (
                          <LogOut className="h-4 w-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {r.employee.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r.employee.position || r.employee.department || ''}
                        </p>
                      </div>
                      <Badge
                        variant={
                          r.direction === 'check_in'
                            ? 'default'
                            : 'secondary'
                        }
                        className="shrink-0"
                      >
                        {r.direction === 'check_in' ? 'Вход' : 'Выход'}
                      </Badge>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-medium">
                          {new Date(r.timestamp).toLocaleTimeString('ru-RU', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {Math.round(r.confidence * 100)}%
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Tab: Employees */}
      {tab === 'employees' && (
        <div className="space-y-3">
          {employees.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <UserX className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Нет сотрудников</p>
                <Button
                  className="mt-4"
                  size="sm"
                  onClick={() => setAddDialogOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Добавить первого сотрудника
                </Button>
              </CardContent>
            </Card>
          ) : (
            employees.map((emp) => (
              <Card key={emp.id}>
                <CardContent className="py-3">
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                      {emp.photoPath ? (
                        <img
                          src={`/api/attendance/${emp.id}/photo`}
                          alt={emp.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Users className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {emp.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[emp.position, emp.department]
                          .filter(Boolean)
                          .join(' / ') || 'Нет данных'}
                      </p>
                    </div>

                    {/* Status badges */}
                    <Badge
                      variant={emp.faceDescriptor ? 'default' : 'destructive'}
                      className="shrink-0"
                    >
                      {emp.faceDescriptor ? 'Face ID' : 'Нет лица'}
                    </Badge>
                    <Badge variant="outline" className="shrink-0">
                      {emp._count.attendanceRecords} записей
                    </Badge>

                    {/* Actions */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleExpandEmployee(emp.id)}
                    >
                      {expandedId === emp.id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteEmployee(emp.id, emp.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Expanded detail */}
                  {expandedId === emp.id && (
                    <div className="mt-3 pt-3 border-t">
                      {detailLoading ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                      ) : employeeRecords.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-2">
                          Нет записей посещаемости
                        </p>
                      ) : (
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {employeeRecords.slice(0, 20).map((r) => (
                            <div
                              key={r.id}
                              className="flex items-center gap-2 text-sm"
                            >
                              <div
                                className={cn(
                                  'rounded-full p-1',
                                  r.direction === 'check_in'
                                    ? 'text-green-500'
                                    : 'text-orange-500'
                                )}
                              >
                                {r.direction === 'check_in' ? (
                                  <LogIn className="h-3 w-3" />
                                ) : (
                                  <LogOut className="h-3 w-3" />
                                )}
                              </div>
                              <span className="text-muted-foreground">
                                {new Date(r.timestamp).toLocaleDateString(
                                  'ru-RU'
                                )}
                              </span>
                              <span className="font-medium">
                                {new Date(r.timestamp).toLocaleTimeString(
                                  'ru-RU',
                                  { hour: '2-digit', minute: '2-digit' }
                                )}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {r.direction === 'check_in' ? 'Вход' : 'Выход'}
                              </Badge>
                              <span className="text-xs text-muted-foreground ml-auto">
                                {Math.round(r.confidence * 100)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Tab: Cameras */}
      {tab === 'cameras' && (
        <div className="space-y-3">
          {attendanceCameras.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Camera className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Нет камер посещаемости</p>
                <p className="text-xs mt-1">
                  Перейдите в раздел «Камеры» и добавьте камеру с назначением «Вход» или «Выход»
                </p>
              </CardContent>
            </Card>
          ) : (
            attendanceCameras.map((cam) => (
              <Card key={cam.id}>
                <CardContent className="py-3">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'rounded-full p-2',
                      cam.isMonitoring ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground'
                    )}>
                      {cam.isMonitoring ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{cam.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{cam.location}</p>
                    </div>
                    <Badge variant={cam.purpose === 'attendance_entry' ? 'default' : 'secondary'}>
                      {cam.purpose === 'attendance_entry' ? (
                        <><LogIn className="h-3 w-3 mr-1" />Вход</>
                      ) : (
                        <><LogOut className="h-3 w-3 mr-1" />Выход</>
                      )}
                    </Badge>
                    <Badge variant={cam.isMonitoring ? 'default' : 'outline'} className={cam.isMonitoring ? 'bg-green-600' : ''}>
                      {cam.isMonitoring ? 'Активна' : 'Остановлена'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Add Employee Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Добавить сотрудника</DialogTitle>
            <DialogDescription>
              Загрузите фото лица для автоматического распознавания
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="emp-name">Имя *</Label>
              <Input
                id="emp-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Иванов Иван"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="emp-pos">Должность</Label>
                <Input
                  id="emp-pos"
                  value={newPosition}
                  onChange={(e) => setNewPosition(e.target.value)}
                  placeholder="Менеджер"
                />
              </div>
              <div>
                <Label htmlFor="emp-dept">Отдел</Label>
                <Input
                  id="emp-dept"
                  value={newDepartment}
                  onChange={(e) => setNewDepartment(e.target.value)}
                  placeholder="IT"
                />
              </div>
            </div>

            <div>
              <Label>Фото лица *</Label>
              <FaceExtractor onExtracted={setExtractedData} />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Отмена
              </Button>
              <Button onClick={handleAddEmployee} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Добавить
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
