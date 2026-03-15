'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Rocket,
  Server,
  Terminal,
  Camera,
  Brain,
  Bell,
  PartyPopper,
  ChevronRight,
  ChevronLeft,
  SkipForward,
  CheckCircle2,
  Copy,
  Cpu,
  HardDrive,
  Monitor,
  Wifi,
  Globe,
  Users,
  Timer,
  ScanFace,
  MessageCircle,
  LayoutDashboard,
  BarChart3,
  Shield,
  Laptop,
  Network,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface OnboardingStep {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
}

const steps: OnboardingStep[] = [
  { id: 'welcome', title: 'Добро пожаловать', subtitle: 'Знакомство с DSS', icon: Rocket, iconColor: 'text-blue-500', iconBg: 'bg-blue-500/10' },
  { id: 'requirements', title: 'Системные требования', subtitle: 'Что нужно для работы', icon: Server, iconColor: 'text-orange-500', iconBg: 'bg-orange-500/10' },
  { id: 'server-setup', title: 'Установка на сервер', subtitle: 'Для мастера / администратора', icon: Terminal, iconColor: 'text-green-500', iconBg: 'bg-green-500/10' },
  { id: 'remote-access', title: 'Удалённый доступ', subtitle: 'Подключение к серверу', icon: Globe, iconColor: 'text-indigo-500', iconBg: 'bg-indigo-500/10' },
  { id: 'cameras', title: 'Подключение камер', subtitle: 'Настройка видеопотоков', icon: Camera, iconColor: 'text-purple-500', iconBg: 'bg-purple-500/10' },
  { id: 'notifications', title: 'Уведомления', subtitle: 'Telegram, вебхуки, интеграции', icon: Bell, iconColor: 'text-yellow-500', iconBg: 'bg-yellow-500/10' },
  { id: 'management', title: 'Управление системой', subtitle: 'Обслуживание и обновления', icon: Settings, iconColor: 'text-rose-500', iconBg: 'bg-rose-500/10' },
  { id: 'done', title: 'Готово!', subtitle: 'Вы готовы к работе', icon: PartyPopper, iconColor: 'text-emerald-500', iconBg: 'bg-emerald-500/10' },
];

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative group">
      <pre className="rounded-lg bg-muted/50 border p-4 font-mono text-sm overflow-x-auto whitespace-pre-wrap break-all">
        {code}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => {
          navigator.clipboard.writeText(code);
          toast.success('Скопировано');
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function CmdItem({ label, cmd }: { label: string; cmd: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-mono truncate">{cmd}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={() => {
          navigator.clipboard.writeText(cmd);
          toast.success('Скопировано');
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─── Step content renderers ─────────────────────────────────────────────

function StepWelcome() {
  const features = [
    { icon: Camera, title: 'Подключение камер', desc: 'Поддержка Hikvision, Dahua, Trassir, DSS и IP Webcam' },
    { icon: Brain, title: 'ИИ-анализ', desc: 'Распознавание людей, лиц, номеров, очередей' },
    { icon: Bell, title: 'Уведомления', desc: 'Мгновенные оповещения в Telegram, email и по вебхуку' },
    { icon: BarChart3, title: 'Аналитика', desc: 'Детальная статистика, тепловые карты, отчёты' },
    { icon: ScanFace, title: 'Распознавание лиц', desc: 'Учёт посещаемости, поиск людей по фото' },
    { icon: Shield, title: 'Безопасность', desc: 'Детекция падений, оставленных предметов, вандализма' },
  ];

  return (
    <div className="space-y-8">
      <div className="text-center py-6">
        <img src="/logo.png" alt="DSS" className="mx-auto mb-6 h-16 rounded-2xl" />
        <h2 className="text-2xl font-bold mb-3">Добро пожаловать в DSS</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Digital Security Systems — ИИ-платформа для видеонаблюдения, которая превращает ваши камеры
          в интеллектуальную систему безопасности и аналитики.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {features.map((f) => (
          <div key={f.title} className="flex items-start gap-3 rounded-lg border p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <f.icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">{f.title}</p>
              <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
        <p className="text-sm font-medium mb-1">Как устроена эта инструкция</p>
        <p className="text-sm text-muted-foreground">
          Шаги 3-4 предназначены для <strong>мастера</strong> (установка сервера и настройка удалённого доступа).
          Шаги 5-8 — для <strong>пользователя</strong> (подключение камер, настройка функций, уведомления).
        </p>
      </div>
    </div>
  );
}

function StepRequirements() {
  const hardware = [
    { icon: Cpu, label: 'Процессор', value: 'x86_64: AMD Ryzen 7/9 или Intel Xeon (8+ ядер)' },
    { icon: HardDrive, label: 'Оперативная память', value: '32 ГБ RAM (рекомендуется 64 ГБ)' },
    { icon: HardDrive, label: 'Диск', value: 'NVMe SSD 512 ГБ+ (для записей видео)' },
    { icon: Monitor, label: 'ОС', value: 'Ubuntu 22.04+ / Debian 12+' },
  ];

  const network = [
    { icon: Wifi, text: 'Сервер и камеры должны быть в одной локальной сети (один роутер)' },
    { icon: Wifi, text: 'Рекомендуется проводное подключение (Ethernet) для стабильности' },
    { icon: Globe, text: 'Доступ в интернет — для ИИ-анализа и удалённого доступа' },
    { icon: Network, text: 'Для удалённого доступа — статический IP или Tailscale VPN' },
  ];

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        DSS устанавливается на сервер (ПК или мини-сервер) в локальной сети заказчика.
      </p>

      <div>
        <h3 className="font-semibold mb-3">Сервер (минимальные характеристики)</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {hardware.map((item) => (
            <div key={item.label} className="flex items-start gap-3 rounded-lg border p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <item.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Сеть</h3>
        <div className="space-y-2">
          {network.map((item) => (
            <div key={item.text} className="flex items-center gap-3 rounded-lg border p-3">
              <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-sm">{item.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Что нужно от заказчика</h3>
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <p>1. IP-камеры с RTSP-доступом (логин, пароль, IP-адрес)</p>
          <p>2. Доступ к роутеру для определения IP-адресов камер</p>
          <p>3. Ethernet-кабель для подключения сервера к роутеру</p>
          <p>4. Стабильное электропитание (желательно через ИБП)</p>
        </div>
      </div>
    </div>
  );
}

function StepServerSetup() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4">
        <p className="text-sm font-medium flex items-center gap-2">
          <Terminal className="h-4 w-4 text-orange-500" />
          Эта секция для мастера / администратора
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Все команды выполняются на сервере (мини-ПК) через SSH или напрямую с клавиатуры.
        </p>
      </div>

      <div>
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Badge className="h-6 w-6 p-0 flex items-center justify-center rounded-full">1</Badge>
          Подключитесь к серверу по SSH
        </h3>
        <p className="text-xs text-muted-foreground mb-2">
          Если работаете напрямую с клавиатуры — пропустите этот шаг.
        </p>
        <CodeBlock code="ssh user@IP-адрес-сервера" />
        <p className="text-xs text-muted-foreground mt-2">
          Пример: <code className="bg-muted px-1 py-0.5 rounded">ssh orangepi@192.168.1.100</code>
        </p>
      </div>

      <div>
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Badge className="h-6 w-6 p-0 flex items-center justify-center rounded-full">2</Badge>
          Скачайте DSS
        </h3>
        <CodeBlock code="sudo -i
cd /opt
git clone https://github.com/asilbektilavov/cam-ai.git camai
cd camai" />
      </div>

      <div>
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Badge className="h-6 w-6 p-0 flex items-center justify-center rounded-full">3</Badge>
          Запустите установщик
        </h3>
        <CodeBlock code="chmod +x scripts/install.sh && ./scripts/install.sh" />
        <p className="text-xs text-muted-foreground mt-2">
          Скрипт автоматически установит Docker, PostgreSQL, go2rtc и запустит все сервисы.
          В процессе попросит ввести Gemini API ключ (для ИИ-анализа).
        </p>
      </div>

      <div>
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Badge className="h-6 w-6 p-0 flex items-center justify-center rounded-full">4</Badge>
          Проверьте что всё работает
        </h3>
        <CodeBlock code="docker compose -f docker-compose.prod.yml ps" />
        <p className="text-xs text-muted-foreground mt-2">
          Контейнер <code className="bg-muted px-1 py-0.5 rounded">camai-app</code> должен быть в статусе <code className="bg-muted px-1 py-0.5 rounded">Up (healthy)</code>.
        </p>
      </div>

      <div>
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Badge className="h-6 w-6 p-0 flex items-center justify-center rounded-full">5</Badge>
          Откройте в браузере
        </h3>
        <CodeBlock code="http://IP-адрес-сервера:3000" />
        <p className="text-xs text-muted-foreground mt-2">
          Пример: <code className="bg-muted px-1 py-0.5 rounded">http://192.168.1.100:3000</code>.
          Для входа используйте предоставленные логин и пароль.
        </p>
      </div>

      <Separator />

      <div>
        <h3 className="font-semibold mb-2">Привязка к оборудованию</h3>
        <p className="text-sm text-muted-foreground">
          При первом запуске система автоматически привязывается к серверу по аппаратному ключу (<code className="bg-muted px-1 py-0.5 rounded">machine-id</code>).
          Перенос на другой сервер потребует повторной активации.
        </p>
      </div>
    </div>
  );
}

function StepRemoteAccess() {
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        После установки на сервер заказчик может получить доступ к DSS удалённо — из любой точки мира.
      </p>

      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Wifi className="h-5 w-5 text-blue-500" />
          Вариант 1: Локальная сеть (без интернета)
        </h3>
        <div className="rounded-lg border p-4 space-y-3 text-sm">
          <p>Если вы в той же сети (офис, магазин), просто откройте в браузере:</p>
          <CodeBlock code="http://IP-адрес-сервера:3000" />
          <p className="text-xs text-muted-foreground">
            IP-адрес сервера можно узнать командой <code className="bg-muted px-1 py-0.5 rounded">hostname -I</code> на сервере,
            или в списке устройств роутера.
          </p>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Globe className="h-5 w-5 text-green-500" />
          Вариант 2: Tailscale VPN (рекомендуется)
        </h3>
        <div className="rounded-lg border p-4 space-y-3 text-sm">
          <p><strong>На сервере (мастер делает один раз):</strong></p>
          <CodeBlock code={`curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up`} />
          <p className="text-xs text-muted-foreground">
            Авторизуйтесь через ссылку в терминале. Запомните Tailscale IP сервера (формат: <code className="bg-muted px-1 py-0.5 rounded">100.x.x.x</code>).
          </p>

          <Separator />

          <p><strong>На устройстве клиента (ПК, телефон):</strong></p>
          <div className="space-y-1">
            <p>1. Установите <a href="https://tailscale.com/download" target="_blank" rel="noopener" className="text-primary underline">Tailscale</a> на свой ПК или телефон</p>
            <p>2. Войдите в тот же Tailscale-аккаунт</p>
            <p>3. Откройте в браузере:</p>
          </div>
          <CodeBlock code="http://100.x.x.x:3000" />
          <p className="text-xs text-muted-foreground">
            Tailscale создаёт зашифрованный VPN-туннель. Работает из любой сети — дом, кафе, мобильный интернет.
          </p>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Network className="h-5 w-5 text-orange-500" />
          Вариант 3: Проброс порта (для опытных)
        </h3>
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <p>1. В настройках роутера пробросьте внешний порт (напр. 8443) на <code className="bg-muted px-1 py-0.5 rounded">IP-сервера:3000</code></p>
          <p>2. Узнайте внешний IP: <code className="bg-muted px-1 py-0.5 rounded">curl ifconfig.me</code></p>
          <p>3. Доступ: <code className="bg-muted px-1 py-0.5 rounded">http://внешний-IP:8443</code></p>
          <p className="text-xs text-muted-foreground mt-2">
            Рекомендуется настроить HTTPS (Let&apos;s Encrypt + nginx) при использовании проброса порта.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
        <p className="text-sm font-medium flex items-center gap-2">
          <Laptop className="h-4 w-4 text-green-500" />
          PWA — установка как приложение
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Откройте DSS в Chrome на телефоне или ПК → меню → «Установить приложение».
          DSS будет работать как отдельное приложение с иконкой на рабочем столе.
        </p>
      </div>
    </div>
  );
}

function StepCameras() {
  const brands = [
    {
      brand: 'DSS',
      url: 'rtsp://admin:password@192.168.1.55:554/stream2',
      note: 'stream1 = основной поток, stream2 = субпоток',
      color: 'text-emerald-400',
    },
    {
      brand: 'Hikvision',
      url: 'rtsp://admin:password@192.168.1.64:554/Streaming/Channels/101',
      note: 'Канал 101 = основной поток, 102 = субпоток',
      color: 'text-red-400',
    },
    {
      brand: 'Dahua',
      url: 'rtsp://admin:password@192.168.1.64:554/cam/realmonitor?channel=1&subtype=0',
      note: 'subtype=0 основной, subtype=1 субпоток',
      color: 'text-blue-400',
    },
    {
      brand: 'Trassir',
      url: 'rtsp://admin:password@192.168.1.64:554/live/main',
      note: 'main = основной поток, sub = субпоток',
      color: 'text-green-400',
    },
  ];

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        DSS поддерживает IP-камеры по протоколу RTSP и приложение IP Webcam для Android.
      </p>

      <div>
        <h3 className="font-semibold mb-3">Как добавить камеру</h3>
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <p>1. Перейдите на страницу «Камеры» в боковом меню</p>
          <p>2. Нажмите «Добавить камеру»</p>
          <p>3. Введите название, RTSP URL, логин и пароль камеры</p>
          <p>4. Выберите назначение камеры (детекция, посещаемость, распознавание номеров)</p>
          <p>5. Нажмите «Проверить подключение» → «Сохранить»</p>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Как узнать IP-адрес камеры</h3>
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <p>1. Откройте веб-интерфейс роутера (обычно <code className="bg-muted px-1 py-0.5 rounded">192.168.1.1</code>)</p>
          <p>2. Найдите список подключённых устройств (DHCP Clients)</p>
          <p>3. Найдите камеру по имени производителя</p>
          <p className="text-muted-foreground text-xs mt-2">
            Или используйте сканер: <code className="bg-muted px-1 py-0.5 rounded">nmap -sP 192.168.1.0/24</code>
          </p>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Шаблоны RTSP URL по производителям</h3>
        <div className="space-y-3">
          {brands.map((item) => (
            <div key={item.brand} className="rounded-lg border p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className={item.color}>{item.brand}</Badge>
              </div>
              <CodeBlock code={item.url} />
              <p className="text-xs text-muted-foreground mt-2">{item.note}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">IP Webcam (Android)</h3>
        <div className="rounded-lg border p-4 text-sm space-y-1">
          <p>1. Установите приложение «IP Webcam» из Google Play</p>
          <p>2. Запустите сервер в приложении</p>
          <p>3. Используйте URL: <code className="bg-muted px-1.5 py-0.5 rounded">http://192.168.1.X:8080</code></p>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Назначения камер</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            { label: 'Детекция объектов', desc: 'Подсчёт людей, тепловые карты, очереди', color: 'text-blue-500' },
            { label: 'Пересечение линии', desc: 'Трипвайр + распознавание лиц при пересечении', color: 'text-cyan-500' },
            { label: 'Посещаемость (вход)', desc: 'Распознавание лиц при входе', color: 'text-green-500' },
            { label: 'Посещаемость (выход)', desc: 'Фиксация ухода сотрудников', color: 'text-orange-500' },
            { label: 'Распознавание номеров', desc: 'LPR — детекция автомобильных номеров', color: 'text-purple-500' },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border p-3">
              <p className={cn('text-sm font-medium', item.color)}>{item.label}</p>
              <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepFeatures() {
  const features = [
    {
      icon: Shield,
      title: 'Пересечение линии (Tripwire)',
      description: 'Настройте виртуальную линию — при пересечении система распознаёт лицо и фиксирует вход/выход.',
      color: 'text-cyan-500',
      bg: 'bg-cyan-500/10',
    },
    {
      icon: Users,
      title: 'Контроль очередей',
      description: 'Подсчёт людей в очереди и уведомление при превышении порога. Идеально для магазинов и банков.',
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
    },
    {
      icon: ScanFace,
      title: 'Поиск человека',
      description: 'Загрузите фото — система найдёт этого человека на всех камерах в реальном времени.',
      color: 'text-red-500',
      bg: 'bg-red-500/10',
    },
    {
      icon: Timer,
      title: 'Детекция праздношатания',
      description: 'Обнаружение людей, которые находятся в одной зоне слишком долго.',
      color: 'text-orange-500',
      bg: 'bg-orange-500/10',
    },
    {
      icon: Monitor,
      title: 'Контроль рабочей зоны',
      description: 'Уведомление если рабочее место пустует дольше заданного времени.',
      color: 'text-purple-500',
      bg: 'bg-purple-500/10',
    },
    {
      icon: Shield,
      title: 'Детекция падений',
      description: 'Автоматическое обнаружение падения человека и мгновенное оповещение.',
      color: 'text-cyan-500',
      bg: 'bg-cyan-500/10',
    },
    {
      icon: Camera,
      title: 'Оставленные предметы',
      description: 'Обнаружение бесхозных сумок и предметов, оставленных без присмотра.',
      color: 'text-yellow-500',
      bg: 'bg-yellow-500/10',
    },
  ];

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        DSS предлагает умные функции для каждой камеры. Включите нужные в настройках камеры.
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        {features.map((f) => (
          <div key={f.title} className="rounded-lg border p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', f.bg)}>
                <f.icon className={cn('h-5 w-5', f.color)} />
              </div>
              <h4 className="text-sm font-semibold">{f.title}</h4>
            </div>
            <p className="text-sm text-muted-foreground">{f.description}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
        <p className="text-sm font-medium mb-2">Как включить</p>
        <div className="text-sm text-muted-foreground space-y-1">
          <p>1. Перейдите на страницу «Камеры»</p>
          <p>2. Нажмите на меню камеры → «Настройки»</p>
          <p>3. В разделе «Умные функции» включите нужные переключатели</p>
          <p>4. Настройте параметры (порог очереди, время и т.д.)</p>
          <p>5. Выберите интеграцию для отправки уведомлений</p>
        </div>
      </div>
    </div>
  );
}

function StepNotifications() {
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        Получайте мгновенные уведомления о событиях и сохраняйте записи в облако.
      </p>

      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-blue-500" />
          Telegram
        </h3>
        <div className="rounded-lg border p-4 space-y-3 text-sm">
          <p><strong>Шаг 1:</strong> Перейдите на страницу «Интеграции» в боковом меню</p>
          <p><strong>Шаг 2:</strong> В карточке Telegram нажмите «Открыть бота»</p>
          <p><strong>Шаг 3:</strong> Нажмите <strong>Start</strong> в Telegram-боте</p>
          <p><strong>Шаг 4:</strong> Вернитесь и нажмите «Подключить»</p>
          <p className="text-muted-foreground text-xs mt-2">
            После подключения вы будете получать уведомления о событиях, пересечениях линий, распознанных лицах и номерах.
          </p>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-green-500" />
          Google Drive
        </h3>
        <div className="rounded-lg border p-4 space-y-3 text-sm">
          <p>Автоматическое резервное копирование видеозаписей в Google Drive.</p>
          <p><strong>Шаг 1:</strong> Создайте OAuth-приложение в Google Cloud Console</p>
          <p><strong>Шаг 2:</strong> Введите Client ID и Client Secret на странице «Интеграции»</p>
          <p><strong>Шаг 3:</strong> Нажмите «Подключить Google Drive» и авторизуйтесь</p>
          <p className="text-muted-foreground text-xs mt-2">
            Записи автоматически загружаются в папку DSS перед удалением с сервера.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
        <p className="text-sm text-muted-foreground">
          Все интеграции настраиваются на странице «Интеграции» в боковом меню.
        </p>
      </div>
    </div>
  );
}

function StepManagement() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4">
        <p className="text-sm font-medium flex items-center gap-2">
          <Terminal className="h-4 w-4 text-orange-500" />
          Эта секция для мастера / администратора
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Команды для обслуживания сервера. Выполняются по SSH.
        </p>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Основные команды</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          <CmdItem label="Статус сервиса" cmd="docker compose -f docker-compose.prod.yml ps" />
          <CmdItem label="Логи приложения" cmd="docker logs camai-app --tail 50" />
          <CmdItem label="Логи в реальном времени" cmd="docker logs camai-app -f" />
          <CmdItem label="Перезапуск" cmd="docker compose -f docker-compose.prod.yml restart cam-ai" />
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Обновление системы</h3>
        <p className="text-sm text-muted-foreground mb-2">
          Для обновления DSS до последней версии выполните:
        </p>
        <CodeBlock code={`cd /opt/camai
git fetch origin && git reset --hard origin/line-crossing
docker compose -f docker-compose.prod.yml build cam-ai
docker compose -f docker-compose.prod.yml up -d cam-ai`} />
        <p className="text-xs text-muted-foreground mt-2">
          Обновление занимает 3-10 минут в зависимости от скорости интернета и мощности сервера.
          Данные (записи, настройки, камеры) сохраняются.
        </p>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Хранилище и записи</h3>
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <p>Записи хранятся в папке <code className="bg-muted px-1 py-0.5 rounded">/opt/camai/data/recordings/</code></p>
          <p>Автоматическая очистка при заполнении SSD на 85% (удаляются самые старые записи)</p>
          <p>Если подключён Google Drive — записи сначала загружаются в облако, затем удаляются локально</p>
          <p>Настройка хранилища: страница «Хранилище» в боковом меню</p>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Резервное копирование</h3>
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <p><strong>База данных:</strong></p>
          <CodeBlock code="docker exec camai-db pg_dump -U camai camai > backup.sql" />
          <p className="text-xs text-muted-foreground mt-1">
            Восстановление: <code className="bg-muted px-1 py-0.5 rounded">cat backup.sql | docker exec -i camai-db psql -U camai camai</code>
          </p>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Диагностика</h3>
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <p>Страница «Диагностика» в боковом меню показывает:</p>
          <div className="grid sm:grid-cols-2 gap-1 text-xs text-muted-foreground mt-1">
            <p>• Загрузка CPU и RAM</p>
            <p>• Свободное место на диске</p>
            <p>• Статус камер и сервисов</p>
            <p>• Здоровье базы данных</p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Полная остановка / запуск</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          <CmdItem label="Остановить всё" cmd="docker compose -f docker-compose.prod.yml down" />
          <CmdItem label="Запустить всё" cmd="docker compose -f docker-compose.prod.yml up -d" />
        </div>
      </div>
    </div>
  );
}

function StepDone({ onNavigate }: { onNavigate: (path: string) => void }) {
  const links = [
    { href: '/cameras', icon: Camera, label: 'Добавить камеру', desc: 'Подключите первую камеру' },
    { href: '/integrations', icon: Bell, label: 'Настроить уведомления', desc: 'Подключите Telegram' },
    { href: '/dashboard', icon: LayoutDashboard, label: 'Перейти к дашборду', desc: 'Начать мониторинг' },
  ];

  return (
    <div className="text-center py-6">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600">
        <PartyPopper className="h-8 w-8 text-white" />
      </div>
      <h2 className="text-2xl font-bold mb-3">Всё готово!</h2>
      <p className="text-muted-foreground max-w-lg mx-auto mb-8">
        Вы изучили основы работы с DSS. Теперь добавьте камеры,
        включите умные функции и настройте уведомления.
      </p>

      <div className="grid sm:grid-cols-3 gap-4 max-w-2xl mx-auto text-left">
        {links.map((link) => (
          <Card
            key={link.href}
            className="cursor-pointer hover:border-primary/50 transition-all"
            onClick={() => onNavigate(link.href)}
          >
            <CardContent className="p-4">
              <link.icon className="h-6 w-6 text-primary mb-2" />
              <p className="text-sm font-semibold">{link.label}</p>
              <p className="text-xs text-muted-foreground">{link.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const router = useRouter();
  const step = steps[currentStep];
  const progress = ((currentStep + 1) / steps.length) * 100;

  function renderContent() {
    switch (currentStep) {
      case 0: return <StepWelcome />;
      case 1: return <StepRequirements />;
      case 2: return <StepServerSetup />;
      case 3: return <StepRemoteAccess />;
      case 4: return <StepCameras />;
      case 5: return <StepNotifications />;
      case 6: return <StepManagement />;
      case 7: return <StepDone onNavigate={(path) => router.push(path)} />;
      default: return null;
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Начало работы</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Шаг {currentStep + 1} из {steps.length} — {step.subtitle}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/dashboard')}
          className="text-muted-foreground"
        >
          <SkipForward className="h-4 w-4 mr-2" />
          Пропустить
        </Button>
      </div>

      {/* Progress */}
      <Progress value={progress} className="h-1.5" />

      {/* Step indicators */}
      <div className="flex items-center justify-center gap-1 sm:gap-2 overflow-x-auto py-2">
        {steps.map((s, index) => (
          <div key={s.id} className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setCurrentStep(index)}
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-all',
                index < currentStep && 'bg-green-500 text-white',
                index === currentStep && 'bg-primary text-primary-foreground ring-2 ring-primary/30',
                index > currentStep && 'bg-muted text-muted-foreground'
              )}
            >
              {index < currentStep ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                index + 1
              )}
            </button>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  'h-0.5 w-4 sm:w-6 rounded-full hidden sm:block',
                  index < currentStep ? 'bg-green-500' : 'bg-muted'
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <Card>
        <CardContent className="p-6">
          {/* Step title */}
          <div className="flex items-center gap-3 mb-6">
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', step.iconBg)}>
              <step.icon className={cn('h-5 w-5', step.iconColor)} />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{step.title}</h2>
              <p className="text-sm text-muted-foreground">{step.subtitle}</p>
            </div>
          </div>

          <Separator className="mb-6" />

          {renderContent()}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrentStep((s) => s - 1)}
          disabled={currentStep === 0}
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Назад
        </Button>

        {currentStep < steps.length - 1 ? (
          <Button onClick={() => setCurrentStep((s) => s + 1)}>
            Далее
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        ) : (
          <Button onClick={() => router.push('/dashboard')}>
            Перейти к дашборду
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        )}
      </div>
    </div>
  );
}
