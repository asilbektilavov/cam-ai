'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import {
  Camera,
  LayoutDashboard,
  BarChart3,
  Plug,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Video,
  X,
  ScanFace,
  BookOpen,
  Building2,
  Archive,
  HardDrive,
  LayoutGrid,
  Map,
  Car,
  Shield,
  Workflow,
  ClipboardList,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAppStore } from '@/lib/store';

const navItems = [
  { href: '/onboarding', label: 'Начало работы', icon: BookOpen },
  { href: '/dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { href: '/branches', label: 'Филиалы', icon: Building2 },
  { href: '/cameras', label: 'Камеры', icon: Camera },
  { href: '/wall', label: 'Видеостена', icon: LayoutGrid },
  { href: '/map', label: 'Карта объекта', icon: Map },
  { href: '/archive', label: 'Видеоархив', icon: Archive },
  { href: '/person-search', label: 'Поиск людей', icon: ScanFace },
  { href: '/lpr', label: 'Номера авто', icon: Car },
  { href: '/analytics', label: 'Аналитика', icon: BarChart3 },
  { href: '/automation', label: 'Автоматизация', icon: Workflow },
  { href: '/audit', label: 'Аудит', icon: ClipboardList },
  { href: '/storage', label: 'Хранилище', icon: HardDrive },
  { href: '/integrations', label: 'Интеграции', icon: Plug },
  { href: '/settings', label: 'Настройки', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { sidebarOpen, setSidebarOpen } = useAppStore();

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-border bg-card transition-all duration-300',
          'md:translate-x-0',
          sidebarOpen ? 'w-64' : 'md:w-[68px] w-64',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
              <Video className="h-5 w-5 text-white" />
            </div>
            {sidebarOpen && (
              <span className="text-lg font-bold tracking-tight">CamAI</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden h-8 w-8"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item, index) => {
            const isActive = pathname === item.href;
            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => {
                    if (window.innerWidth < 768) {
                      setSidebarOpen(false);
                    }
                  }}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {sidebarOpen && <span>{item.label}</span>}
                </Link>
                {index === 0 && <Separator className="my-2" />}
              </div>
            );
          })}
        </nav>

        <Separator />

        {/* User & Logout */}
        <div className="p-3">
          {sidebarOpen && session?.user && (
            <div className="mb-2 rounded-lg bg-muted/50 px-3 py-2">
              <p className="text-sm font-medium truncate">{session.user.name}</p>
              <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
            </div>
          )}
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {sidebarOpen && <span>Выйти</span>}
          </button>
        </div>

        {/* Toggle — only on desktop */}
        <div className="hidden md:block border-t border-border p-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>
      </aside>
    </>
  );
}
