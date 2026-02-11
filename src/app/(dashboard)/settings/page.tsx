'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  User,
  Bell,
  Shield,
  Palette,
  Globe,
  Save,
  Camera,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Link2,
  Server,
  Brain,
  Sparkles,
  ShieldCheck,
  Key,
  Check,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost, apiPut, apiDelete } from '@/lib/api-client';

interface ProfileData {
  name: string;
  email: string;
  role: string;
  company: string;
}

interface NotificationSettings {
  critical: boolean;
  warnings: boolean;
  info: boolean;
  system: boolean;
  dailyReport: boolean;
  weeklyReport: boolean;
}

interface SystemSettings {
  language: string;
  timezone: string;
  autoRecord: boolean;
  cloudStorage: boolean;
  aiQuality: string;
}

interface SyncInstance {
  id: string;
  name: string;
  status: 'online' | 'offline';
  lastSyncAt: string | null;
  cameraCount: number;
}

interface SyncStatus {
  role: 'central' | 'satellite' | 'standalone';
  instances?: SyncInstance[];
  syncTarget?: string;
  queueSize?: number;
  lastSyncAt?: string | null;
}

export default function SettingsPage() {
  const { data: session } = useSession();

  // Loading states
  const [profileLoading, setProfileLoading] = useState(true);
  const [notifLoading, setNotifLoading] = useState(true);
  const [systemLoading, setSystemLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Profile
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');

  // Security
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [twoFA, setTwoFA] = useState(false);
  const [ipRestriction, setIpRestriction] = useState(false);

  // Notifications
  const [notifications, setNotifications] = useState<NotificationSettings>({
    critical: true,
    warnings: true,
    info: false,
    system: true,
    dailyReport: false,
    weeklyReport: true,
  });

  // System
  const [language, setLanguage] = useState('ru');
  const [timezone, setTimezone] = useState('utc+5');
  const [autoRecord, setAutoRecord] = useState(true);
  const [cloudStorage, setCloudStorage] = useState(true);
  const [aiQuality, setAiQuality] = useState('high');

  // Analysis mode
  const [analysisMode, setAnalysisMode] = useState('yolo_gemini_events');
  const [analysisModeLoading, setAnalysisModeLoading] = useState(true);
  const [savingAnalysisMode, setSavingAnalysisMode] = useState(false);

  // Gemini API key
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [geminiKeyInfo, setGeminiKeyInfo] = useState<{
    hasOrgKey: boolean;
    hasEnvKey: boolean;
    maskedKey: string | null;
    source: string;
  } | null>(null);
  const [geminiKeyLoading, setGeminiKeyLoading] = useState(true);
  const [savingGeminiKey, setSavingGeminiKey] = useState(false);

  // Sync
  const [syncLoading, setSyncLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  const fetchSyncStatus = useCallback(() => {
    apiGet<SyncStatus>('/api/sync/status')
      .then((data) => setSyncStatus(data))
      .catch(() => setSyncStatus(null))
      .finally(() => setSyncLoading(false));
  }, []);

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  // Load analysis mode
  useEffect(() => {
    apiGet<{ analysisMode: string }>('/api/settings/analysis-mode')
      .then((data) => setAnalysisMode(data.analysisMode))
      .catch(() => {})
      .finally(() => setAnalysisModeLoading(false));
  }, []);

  // Load Gemini key info
  const fetchGeminiKeyInfo = useCallback(() => {
    apiGet<{ hasOrgKey: boolean; hasEnvKey: boolean; maskedKey: string | null; source: string }>(
      '/api/settings/gemini-key'
    )
      .then((data) => setGeminiKeyInfo(data))
      .catch(() => {})
      .finally(() => setGeminiKeyLoading(false));
  }, []);

  useEffect(() => {
    fetchGeminiKeyInfo();
  }, [fetchGeminiKeyInfo]);

  const handleSaveGeminiKey = async () => {
    if (!geminiKeyInput.trim()) {
      toast.error('Введите API ключ');
      return;
    }
    setSavingGeminiKey(true);
    try {
      await apiPut('/api/settings/gemini-key', { apiKey: geminiKeyInput });
      toast.success('Gemini API ключ сохранён и проверен');
      setGeminiKeyInput('');
      fetchGeminiKeyInfo();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения ключа');
    } finally {
      setSavingGeminiKey(false);
    }
  };

  const handleDeleteGeminiKey = async () => {
    setSavingGeminiKey(true);
    try {
      await apiDelete('/api/settings/gemini-key');
      toast.success('API ключ удалён');
      fetchGeminiKeyInfo();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления ключа');
    } finally {
      setSavingGeminiKey(false);
    }
  };

  // Load profile data
  useEffect(() => {
    apiGet<ProfileData>('/api/settings/profile')
      .then((data) => {
        setName(data.name);
        setEmail(data.email);
        setRole(data.role);
        setCompany(data.company);
      })
      .catch(() => {
        // Fallback to session data
        if (session?.user) {
          setName(session.user.name || '');
          setEmail(session.user.email || '');
        }
      })
      .finally(() => setProfileLoading(false));
  }, [session]);

  // Load notification settings
  useEffect(() => {
    apiGet<NotificationSettings>('/api/settings/notifications')
      .then((data) => setNotifications(data))
      .catch(() => {})
      .finally(() => setNotifLoading(false));
  }, []);

  // Load system settings
  useEffect(() => {
    apiGet<SystemSettings>('/api/settings/system')
      .then((data) => {
        setLanguage(data.language);
        setTimezone(data.timezone);
        setAutoRecord(data.autoRecord);
        setCloudStorage(data.cloudStorage);
        setAiQuality(data.aiQuality);
      })
      .catch(() => {})
      .finally(() => setSystemLoading(false));
  }, []);

  const handleSaveProfile = async () => {
    if (!name || !email) {
      toast.error('Имя и email обязательны');
      return;
    }
    setSaving(true);
    try {
      await apiPatch('/api/settings/profile', { name, email, company });
      toast.success('Профиль обновлён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNotifications = async () => {
    setSaving(true);
    try {
      await apiPatch('/api/settings/notifications', notifications);
      toast.success('Настройки уведомлений сохранены');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword) {
      toast.error('Введите текущий пароль');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('Пароль должен содержать минимум 8 символов');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error('Пароли не совпадают');
      return;
    }
    setSaving(true);
    try {
      await apiPost('/api/settings/password', {
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      toast.success('Пароль изменён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка смены пароля');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSystem = async () => {
    setSaving(true);
    try {
      await apiPatch('/api/settings/system', {
        language,
        timezone,
        autoRecord,
        cloudStorage,
        aiQuality,
      });
      toast.success('Системные настройки сохранены');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAnalysisMode = async (mode: string) => {
    setSavingAnalysisMode(true);
    try {
      await apiPut('/api/settings/analysis-mode', { analysisMode: mode });
      setAnalysisMode(mode);
      toast.success('Режим анализа обновлён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSavingAnalysisMode(false);
    }
  };

  const roleLabels: Record<string, string> = {
    admin: 'Администратор',
    operator: 'Оператор',
    viewer: 'Наблюдатель',
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Настройки</h1>
        <p className="text-muted-foreground">Управление аккаунтом и настройками системы</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap">
          <TabsTrigger value="profile" className="gap-2">
            <User className="h-4 w-4" />
            Профиль
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4" />
            Уведомления
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Shield className="h-4 w-4" />
            Безопасность
          </TabsTrigger>
          <TabsTrigger value="system" className="gap-2">
            <Palette className="h-4 w-4" />
            Система
          </TabsTrigger>
          <TabsTrigger value="analysis" className="gap-2">
            <Brain className="h-4 w-4" />
            ИИ-анализ
          </TabsTrigger>
          <TabsTrigger value="sync" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Синхронизация
          </TabsTrigger>
        </TabsList>

        {/* Profile */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Профиль</CardTitle>
              <CardDescription>Информация о вашем аккаунте</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {profileLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="profile-name">Имя</Label>
                      <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="profile-email">Email</Label>
                      <Input id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="profile-company">Компания</Label>
                      <Input
                        id="profile-company"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        placeholder="Название компании"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Роль</Label>
                      <Input value={roleLabels[role] || role} disabled />
                    </div>
                  </div>
                  <Button onClick={handleSaveProfile} className="gap-2" disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Сохранить изменения
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Настройки уведомлений</CardTitle>
              <CardDescription>Выберите, о каких событиях вы хотите получать уведомления</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {notifLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {[
                    {
                      key: 'critical' as const,
                      title: 'Критические события',
                      description: 'Подозрительное поведение, нарушения безопасности',
                    },
                    {
                      key: 'warnings' as const,
                      title: 'Предупреждения',
                      description: 'Длинные очереди, камеры офлайн, нетипичная активность',
                    },
                    {
                      key: 'info' as const,
                      title: 'Информационные',
                      description: 'Подсчёт посетителей, распознавание номеров, VIP-клиенты',
                    },
                    {
                      key: 'system' as const,
                      title: 'Системные',
                      description: 'Обновления, обслуживание, отчёты',
                    },
                    {
                      key: 'dailyReport' as const,
                      title: 'Ежедневный отчёт',
                      description: 'Сводка за день на email в 22:00',
                    },
                    {
                      key: 'weeklyReport' as const,
                      title: 'Еженедельный отчёт',
                      description: 'Подробный отчёт каждый понедельник',
                    },
                  ].map((item) => (
                    <div key={item.key} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{item.title}</p>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                      </div>
                      <Switch
                        checked={notifications[item.key]}
                        onCheckedChange={(checked) =>
                          setNotifications((prev) => ({ ...prev, [item.key]: checked }))
                        }
                      />
                    </div>
                  ))}
                  <Separator />
                  <Button onClick={handleSaveNotifications} className="gap-2" disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Сохранить
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>Безопасность</CardTitle>
              <CardDescription>Настройки безопасности аккаунта</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cur-pass">Текущий пароль</Label>
                  <div className="relative">
                    <Input
                      id="cur-pass"
                      type={showPasswords ? 'text' : 'password'}
                      placeholder="Введите текущий пароль"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-pass">Новый пароль</Label>
                  <Input
                    id="new-pass"
                    type={showPasswords ? 'text' : 'password'}
                    placeholder="Минимум 8 символов"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-new-pass">Подтвердите пароль</Label>
                  <Input
                    id="confirm-new-pass"
                    type={showPasswords ? 'text' : 'password'}
                    placeholder="Повторите новый пароль"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPasswords(!showPasswords)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <span className="text-sm text-muted-foreground">
                    {showPasswords ? 'Скрыть пароли' : 'Показать пароли'}
                  </span>
                </div>
                <Button onClick={handleChangePassword} variant="outline" className="gap-2" disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Изменить пароль
                </Button>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Двухфакторная аутентификация</p>
                  <p className="text-sm text-muted-foreground">
                    Дополнительная защита через SMS или приложение
                  </p>
                </div>
                <Switch
                  checked={twoFA}
                  onCheckedChange={(checked) => {
                    setTwoFA(checked);
                    toast.success(checked ? '2FA включена' : '2FA отключена');
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Вход по IP</p>
                  <p className="text-sm text-muted-foreground">
                    Ограничить доступ только с доверенных IP-адресов
                  </p>
                </div>
                <Switch
                  checked={ipRestriction}
                  onCheckedChange={(checked) => {
                    setIpRestriction(checked);
                    toast.success(checked ? 'Ограничение по IP включено' : 'Ограничение по IP отключено');
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* System */}
        <TabsContent value="system">
          <Card>
            <CardHeader>
              <CardTitle>Системные настройки</CardTitle>
              <CardDescription>Общие параметры системы</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {systemLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Язык интерфейса</Label>
                      <Select value={language} onValueChange={setLanguage}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ru">Русский</SelectItem>
                          <SelectItem value="en">English</SelectItem>
                          <SelectItem value="uz">O&apos;zbek</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Часовой пояс</Label>
                      <Select value={timezone} onValueChange={setTimezone}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="utc+3">Москва (UTC+3)</SelectItem>
                          <SelectItem value="utc+5">Ташкент (UTC+5)</SelectItem>
                          <SelectItem value="utc+6">Алматы (UTC+6)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Camera className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">Автозапись</p>
                          <p className="text-sm text-muted-foreground">Автоматическая запись при детекции</p>
                        </div>
                      </div>
                      <Switch checked={autoRecord} onCheckedChange={setAutoRecord} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Globe className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">Облачное хранение</p>
                          <p className="text-sm text-muted-foreground">Сохранять записи в облако</p>
                        </div>
                      </div>
                      <Switch checked={cloudStorage} onCheckedChange={setCloudStorage} />
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Качество ИИ-анализа</Label>
                    <Select value={aiQuality} onValueChange={setAiQuality}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Экономный (быстрее, менее точно)</SelectItem>
                        <SelectItem value="medium">Средний (баланс скорости и точности)</SelectItem>
                        <SelectItem value="high">Высокий (максимальная точность)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleSaveSystem} className="gap-2" disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Сохранить
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analysis Mode */}
        <TabsContent value="analysis">
          <Card>
            <CardHeader>
              <CardTitle>Режим ИИ-анализа</CardTitle>
              <CardDescription>
                Выберите режим анализа видеопотоков. Влияет на все камеры организации.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {analysisModeLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-3">
                  {/* YOLO Only */}
                  <button
                    onClick={() => handleSaveAnalysisMode('yolo_only')}
                    disabled={savingAnalysisMode}
                    className={`relative flex flex-col items-start gap-3 rounded-xl border-2 p-5 text-left transition-all hover:shadow-md ${
                      analysisMode === 'yolo_only'
                        ? 'border-blue-500 bg-blue-500/5 shadow-sm'
                        : 'border-border hover:border-muted-foreground/30'
                    }`}
                  >
                    {analysisMode === 'yolo_only' && (
                      <div className="absolute top-3 right-3">
                        <div className="h-3 w-3 rounded-full bg-blue-500" />
                      </div>
                    )}
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-500/10">
                      <ShieldCheck className="h-6 w-6 text-blue-500" />
                    </div>
                    <div>
                      <p className="font-semibold">Только детекция (YOLO)</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Обнаружение объектов с bounding boxes в реальном времени. Определяет людей, транспорт, животных и другие объекты. Без текстовых описаний сцены.
                      </p>
                    </div>
                    <Badge variant="secondary" className="mt-auto">
                      Бесплатно
                    </Badge>
                  </button>

                  {/* YOLO + Gemini Events */}
                  <button
                    onClick={() => handleSaveAnalysisMode('yolo_gemini_events')}
                    disabled={savingAnalysisMode}
                    className={`relative flex flex-col items-start gap-3 rounded-xl border-2 p-5 text-left transition-all hover:shadow-md ${
                      analysisMode === 'yolo_gemini_events'
                        ? 'border-green-500 bg-green-500/5 shadow-sm'
                        : 'border-border hover:border-muted-foreground/30'
                    }`}
                  >
                    {analysisMode === 'yolo_gemini_events' && (
                      <div className="absolute top-3 right-3">
                        <div className="h-3 w-3 rounded-full bg-green-500" />
                      </div>
                    )}
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-green-500/10">
                      <Brain className="h-6 w-6 text-green-500" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">Умный анализ</p>
                        <Badge variant="default" className="text-[10px] px-1.5 py-0">
                          Рекомендуется
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Bounding boxes + AI-описание сцены при обнаружении аномалий. Gemini анализирует поведение, очереди и нестандартные ситуации только когда это нужно.
                      </p>
                    </div>
                    <Badge variant="secondary" className="mt-auto">
                      ~$5-15/камера/мес
                    </Badge>
                  </button>

                  {/* YOLO + Gemini Always */}
                  <button
                    onClick={() => handleSaveAnalysisMode('yolo_gemini_always')}
                    disabled={savingAnalysisMode}
                    className={`relative flex flex-col items-start gap-3 rounded-xl border-2 p-5 text-left transition-all hover:shadow-md ${
                      analysisMode === 'yolo_gemini_always'
                        ? 'border-purple-500 bg-purple-500/5 shadow-sm'
                        : 'border-border hover:border-muted-foreground/30'
                    }`}
                  >
                    {analysisMode === 'yolo_gemini_always' && (
                      <div className="absolute top-3 right-3">
                        <div className="h-3 w-3 rounded-full bg-purple-500" />
                      </div>
                    )}
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-purple-500/10">
                      <Sparkles className="h-6 w-6 text-purple-500" />
                    </div>
                    <div>
                      <p className="font-semibold">Полный анализ</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Bounding boxes + постоянный AI-мониторинг каждые 30 секунд. Полное описание сцены, анализ поведения, прогнозы. Максимальное качество аналитики.
                      </p>
                    </div>
                    <Badge variant="secondary" className="mt-auto">
                      ~$50/камера/мес
                    </Badge>
                  </button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Gemini API Key */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Gemini API ключ
              </CardTitle>
              <CardDescription>
                Для работы ИИ-функций (анализ сцены, AI-чат, саммари) нужен ключ Google Gemini API.
                Получите бесплатно на{' '}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 underline"
                >
                  aistudio.google.com
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {geminiKeyLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {/* Current status */}
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-2.5 w-2.5 rounded-full ${
                        geminiKeyInfo?.source !== 'none' ? 'bg-green-500' : 'bg-red-500'
                      }`}
                    />
                    <span className="text-sm">
                      {geminiKeyInfo?.source === 'organization' && (
                        <>Ключ организации: <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{geminiKeyInfo.maskedKey}</code></>
                      )}
                      {geminiKeyInfo?.source === 'environment' && (
                        <>Используется системный ключ (установлен администратором)</>
                      )}
                      {geminiKeyInfo?.source === 'none' && (
                        <span className="text-red-500">Ключ не настроен — ИИ-функции не работают</span>
                      )}
                    </span>
                  </div>

                  {/* Input */}
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="AIza..."
                      value={geminiKeyInput}
                      onChange={(e) => setGeminiKeyInput(e.target.value)}
                      className="font-mono text-sm"
                    />
                    <Button
                      onClick={handleSaveGeminiKey}
                      disabled={savingGeminiKey || !geminiKeyInput.trim()}
                      className="gap-1.5 shrink-0"
                    >
                      {savingGeminiKey ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      Проверить и сохранить
                    </Button>
                  </div>

                  {geminiKeyInfo?.hasOrgKey && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDeleteGeminiKey}
                      disabled={savingGeminiKey}
                      className="text-red-500 hover:text-red-600 gap-1.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Удалить ключ организации
                    </Button>
                  )}

                  <p className="text-xs text-muted-foreground">
                    При сохранении ключ проверяется тестовым запросом к Gemini API.
                    Ключ хранится в зашифрованной базе данных и доступен только вашей организации.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sync */}
        <TabsContent value="sync">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Синхронизация
              </CardTitle>
              <CardDescription>Статус синхронизации между экземплярами системы</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {syncLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !syncStatus ? (
                <p className="text-sm text-muted-foreground">Не удалось загрузить статус синхронизации</p>
              ) : syncStatus.role === 'standalone' ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Server className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Автономный режим — синхронизация не настроена
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Роль:</span>
                    <Badge variant="outline">
                      {syncStatus.role === 'central' ? 'Центральный сервер' : 'Сателлит'}
                    </Badge>
                  </div>

                  {syncStatus.role === 'central' && syncStatus.instances && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium">Подключённые экземпляры</h4>
                      {syncStatus.instances.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Нет подключённых экземпляров</p>
                      ) : (
                        <div className="space-y-2">
                          {syncStatus.instances.map((inst) => (
                            <div
                              key={inst.id}
                              className="flex items-center justify-between rounded-lg border p-3"
                            >
                              <div className="flex items-center gap-3">
                                <span
                                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                                    inst.status === 'online' ? 'bg-green-500' : 'bg-red-500'
                                  }`}
                                />
                                <div>
                                  <p className="text-sm font-medium">{inst.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {inst.lastSyncAt
                                      ? `Синхр.: ${new Date(inst.lastSyncAt).toLocaleString('ru-RU')}`
                                      : 'Ещё не синхронизировался'}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Camera className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">{inst.cameraCount}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {syncStatus.role === 'satellite' && (
                    <div className="space-y-4">
                      {syncStatus.syncTarget && (
                        <div className="space-y-1">
                          <span className="text-sm font-medium">Центральный сервер</span>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Link2 className="h-4 w-4 shrink-0" />
                            <span className="truncate">{syncStatus.syncTarget}</span>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-4">
                        {syncStatus.queueSize !== undefined && (
                          <div className="space-y-1">
                            <span className="text-sm font-medium">Очередь</span>
                            <p className="text-sm text-muted-foreground">
                              {syncStatus.queueSize} событий
                            </p>
                          </div>
                        )}
                        <div className="space-y-1">
                          <span className="text-sm font-medium">Последняя синхронизация</span>
                          <p className="text-sm text-muted-foreground">
                            {syncStatus.lastSyncAt
                              ? new Date(syncStatus.lastSyncAt).toLocaleString('ru-RU')
                              : 'Ещё не выполнялась'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
