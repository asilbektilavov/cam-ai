'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { Bell, Moon, Sun, Search, Menu, Building2, AlertTriangle, Users, Flame, Eye, Car, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppStore } from '@/lib/store';
import { useBranches } from '@/hooks/use-branches';
import { cn } from '@/lib/utils';

export function Header() {
  const router = useRouter();
  const { data: session } = useSession();
  const { theme, setTheme } = useTheme();
  const { sidebarOpen, setSidebarOpen, selectedBranchId, setSelectedBranchId } = useAppStore();
  const { branches, isLoading: branchesLoading } = useBranches();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notifications, setNotifications] = useState<Array<{
    id: string;
    type: string;
    severity: string;
    description: string;
    timestamp: string;
    camera?: { name: string; location: string | null };
  }>>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/events?limit=10');
      if (!res.ok) return;
      const data = await res.json();
      const events = data.events || [];
      setNotifications(events);

      const stored = localStorage.getItem('camai-notif-seen');
      const seenAt = stored || new Date(0).toISOString();
      setLastSeenAt(seenAt);
      const count = events.filter((e: { timestamp: string }) => new Date(e.timestamp) > new Date(seenAt)).length;
      setUnreadCount(count);
    } catch {}
  }, []);

  const handleNotificationsOpen = (open: boolean) => {
    if (open) {
      fetchNotifications();
    }
    if (!open && notifications.length > 0) {
      const now = new Date().toISOString();
      localStorage.setItem('camai-notif-seen', now);
      setLastSeenAt(now);
      setUnreadCount(0);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const user = session?.user;

  return (
    <>
      <header
        className={cn(
          'fixed top-0 right-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 backdrop-blur-sm px-4 md:px-6 transition-all duration-300',
          'left-0',
          sidebarOpen ? 'md:left-64' : 'md:left-[68px]'
        )}
      >
        {/* Left: hamburger + search */}
        <div className="flex items-center gap-2 flex-1">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Branch Switcher */}
          {!branchesLoading && branches.length > 0 && (
            <Select
              value={selectedBranchId || undefined}
              onValueChange={(val) => setSelectedBranchId(val)}
            >
              <SelectTrigger size="sm" className="w-[160px] md:w-[200px]">
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <SelectValue placeholder="Филиал" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Search */}
          <div className="relative w-full max-w-md hidden sm:block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Поиск камер, событий..."
              className="pl-9 bg-muted/50"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-5 w-5" />
          </Button>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1 md:gap-2">
          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>

          {/* Notifications */}
          <DropdownMenu onOpenChange={handleNotificationsOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-96">
              <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                <p className="text-sm font-semibold">Уведомления</p>
                {unreadCount > 0 && (
                  <span className="text-xs text-muted-foreground">{unreadCount} новых</span>
                )}
              </div>
              {notifications.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Нет уведомлений
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  {notifications.map((n) => {
                    const isNew = lastSeenAt ? new Date(n.timestamp) > new Date(lastSeenAt) : false;
                    const icon = n.type === 'crowd' || n.type === 'people_count' ? Users
                      : n.type === 'fire_detected' || n.type === 'smoke_detected' ? Flame
                      : n.type === 'face_detected' ? UserCheck
                      : n.type === 'plate_detected' ? Car
                      : n.severity === 'warning' || n.severity === 'critical' ? AlertTriangle
                      : Eye;
                    const Icon = icon;
                    const severityColor = n.severity === 'critical' ? 'text-red-500'
                      : n.severity === 'warning' ? 'text-orange-500'
                      : 'text-muted-foreground';
                    const time = new Date(n.timestamp);
                    const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;
                    return (
                      <DropdownMenuItem
                        key={n.id}
                        className={cn('flex items-start gap-3 px-3 py-2.5 cursor-pointer', isNew && 'bg-primary/5')}
                        onClick={() => router.push('/analytics')}
                      >
                        <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', severityColor)} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{n.description}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {n.camera?.name ? `${n.camera.name} · ` : ''}{timeStr}
                          </p>
                        </div>
                        {isNew && <span className="h-2 w-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />}
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="justify-center text-sm text-primary cursor-pointer"
                onClick={() => router.push('/analytics')}
              >
                Показать все события
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Avatar with dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="outline-none">
                <Avatar className="h-8 w-8 cursor-pointer">
                  <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                    {user?.name?.charAt(0).toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-3 py-2">
                <p className="text-sm font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/settings')} className="cursor-pointer">
                Настройки
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive cursor-pointer"
                onClick={() => signOut({ callbackUrl: '/login' })}
              >
                Выйти
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Mobile search dialog */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="sm:hidden top-4 translate-y-0">
          <DialogHeader>
            <DialogTitle>Поиск</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Поиск камер, событий..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
