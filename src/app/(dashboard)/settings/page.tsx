'use client';

import { useState, useEffect } from 'react';
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
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';

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
    if (newPassword.length < 6) {
      toast.error('Пароль должен содержать минимум 6 символов');
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
                    placeholder="Минимум 6 символов"
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
      </Tabs>
    </div>
  );
}
