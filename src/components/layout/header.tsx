'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Bell, Moon, Sun, Search, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';

export function Header() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { user, sidebarOpen, setSidebarOpen, events, cameras, logout } = useAppStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const criticalCount = events.filter((e) => e.severity === 'critical').length;

  const searchResults = searchQuery.trim()
    ? [
        ...cameras
          .filter(
            (c) =>
              c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              c.location.toLowerCase().includes(searchQuery.toLowerCase())
          )
          .map((c) => ({ type: 'camera' as const, label: c.name, sub: c.location, id: c.id })),
        ...events
          .filter((e) =>
            e.description.toLowerCase().includes(searchQuery.toLowerCase())
          )
          .slice(0, 5)
          .map((e) => ({
            type: 'event' as const,
            label: e.description,
            sub: new Date(e.timestamp).toLocaleString('ru-RU'),
            id: e.id,
          })),
      ]
    : [];

  return (
    <>
      <header
        className={cn(
          'fixed top-0 right-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 backdrop-blur-sm px-4 md:px-6 transition-all duration-300',
          // Desktop: offset by sidebar
          sidebarOpen ? 'md:left-64' : 'md:left-[68px]',
          // Mobile: full width
          'left-0 md:left-[68px]'
        )}
      >
        {/* Left: hamburger + search */}
        <div className="flex items-center gap-2 flex-1">
          {/* Mobile hamburger */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Search */}
          <div className="relative w-full max-w-md hidden sm:block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Поиск камер, событий..."
              className="pl-9 bg-muted/50"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value.trim()) setSearchOpen(true);
              }}
              onFocus={() => {
                if (searchQuery.trim()) setSearchOpen(true);
              }}
            />
            {/* Search results dropdown */}
            {searchOpen && searchQuery.trim() && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-border bg-popover shadow-lg max-h-80 overflow-auto z-50">
                {searchResults.length > 0 ? (
                  searchResults.map((result, i) => (
                    <button
                      key={`${result.type}-${result.id}-${i}`}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent transition-colors border-b border-border last:border-0"
                      onClick={() => {
                        setSearchOpen(false);
                        setSearchQuery('');
                        if (result.type === 'camera') router.push('/cameras');
                        else router.push('/analytics');
                      }}
                    >
                      <Badge variant="secondary" className="text-[10px] mt-0.5 shrink-0">
                        {result.type === 'camera' ? 'Камера' : 'Событие'}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{result.label}</p>
                        <p className="text-xs text-muted-foreground">{result.sub}</p>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    Ничего не найдено
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mobile search button */}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                {criticalCount > 0 && (
                  <Badge
                    variant="destructive"
                    className="absolute -right-1 -top-1 h-5 w-5 rounded-full p-0 text-[10px] flex items-center justify-center"
                  >
                    {criticalCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <div className="px-3 py-2 border-b border-border">
                <p className="text-sm font-semibold">Уведомления</p>
              </div>
              {events.slice(0, 5).map((event) => (
                <DropdownMenuItem
                  key={event.id}
                  className="flex flex-col items-start gap-1 p-3 cursor-pointer"
                  onClick={() => router.push('/analytics')}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        'h-2 w-2 rounded-full shrink-0',
                        event.severity === 'critical'
                          ? 'bg-red-500'
                          : event.severity === 'warning'
                          ? 'bg-yellow-500'
                          : 'bg-blue-500'
                      )}
                    />
                    <span className="text-sm">{event.description}</span>
                  </div>
                  <span className="text-xs text-muted-foreground pl-4">
                    {new Date(event.timestamp).toLocaleString('ru-RU')}
                  </span>
                </DropdownMenuItem>
              ))}
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
              <DropdownMenuItem onClick={() => router.push('/select-venue')} className="cursor-pointer">
                Сменить тип заведения
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive cursor-pointer"
                onClick={() => {
                  logout();
                  window.location.href = '/login';
                }}
              >
                Выйти
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Mobile search dialog */}
      <Dialog open={searchOpen && typeof window !== 'undefined' && window.innerWidth < 640} onOpenChange={setSearchOpen}>
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
          {searchQuery.trim() && (
            <div className="max-h-60 overflow-auto space-y-1">
              {searchResults.length > 0 ? (
                searchResults.map((result, i) => (
                  <button
                    key={`m-${result.type}-${result.id}-${i}`}
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent transition-colors"
                    onClick={() => {
                      setSearchOpen(false);
                      setSearchQuery('');
                      if (result.type === 'camera') router.push('/cameras');
                      else router.push('/analytics');
                    }}
                  >
                    <Badge variant="secondary" className="text-[10px] mt-0.5 shrink-0">
                      {result.type === 'camera' ? 'Камера' : 'Событие'}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{result.label}</p>
                      <p className="text-xs text-muted-foreground">{result.sub}</p>
                    </div>
                  </button>
                ))
              ) : (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  Ничего не найдено
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Click outside to close search on desktop */}
      {searchOpen && searchQuery.trim() && (
        <div
          className="fixed inset-0 z-20 hidden sm:block"
          onClick={() => setSearchOpen(false)}
        />
      )}
    </>
  );
}
