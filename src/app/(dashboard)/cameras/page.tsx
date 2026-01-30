'use client';

import { useState } from 'react';
import {
  Camera,
  Plus,
  MoreVertical,
  Wifi,
  WifiOff,
  Wrench,
  Eye,
  Trash2,
  Settings,
  Video,
  Monitor,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { VenueType } from '@/lib/types';

export default function CamerasPage() {
  const { cameras, addCamera, removeCamera, toggleCameraStatus } = useAppStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [newCamera, setNewCamera] = useState({
    name: '',
    location: '',
    venueType: 'retail' as VenueType,
    resolution: '1920x1080',
    fps: 30,
  });

  const handleAdd = () => {
    if (!newCamera.name || !newCamera.location) {
      toast.error('Заполните все поля');
      return;
    }
    addCamera({
      ...newCamera,
      status: 'online',
      lastActivity: 'Только что',
    });
    toast.success(`Камера "${newCamera.name}" добавлена`);
    setNewCamera({ name: '', location: '', venueType: 'retail', resolution: '1920x1080', fps: 30 });
    setDialogOpen(false);
  };

  const onlineCameras = cameras.filter((c) => c.status === 'online').length;
  const offlineCameras = cameras.filter((c) => c.status === 'offline').length;
  const maintenanceCameras = cameras.filter((c) => c.status === 'maintenance').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Камеры</h1>
          <p className="text-muted-foreground">Управление камерами видеонаблюдения</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Добавить камеру
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Добавить камеру</DialogTitle>
              <DialogDescription>Настройте параметры новой камеры</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Название камеры</Label>
                <Input
                  placeholder="Камера входа"
                  value={newCamera.name}
                  onChange={(e) => setNewCamera({ ...newCamera, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Расположение</Label>
                <Input
                  placeholder="Главный вход"
                  value={newCamera.location}
                  onChange={(e) => setNewCamera({ ...newCamera, location: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Разрешение</Label>
                  <Select
                    value={newCamera.resolution}
                    onValueChange={(v) => setNewCamera({ ...newCamera, resolution: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1280x720">720p</SelectItem>
                      <SelectItem value="1920x1080">1080p</SelectItem>
                      <SelectItem value="2560x1440">2K</SelectItem>
                      <SelectItem value="3840x2160">4K</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>FPS</Label>
                  <Select
                    value={newCamera.fps.toString()}
                    onValueChange={(v) => setNewCamera({ ...newCamera, fps: parseInt(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 FPS</SelectItem>
                      <SelectItem value="20">20 FPS</SelectItem>
                      <SelectItem value="25">25 FPS</SelectItem>
                      <SelectItem value="30">30 FPS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={handleAdd} className="w-full">
                Добавить
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <Wifi className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{onlineCameras}</p>
              <p className="text-sm text-muted-foreground">Онлайн</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
              <WifiOff className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{offlineCameras}</p>
              <p className="text-sm text-muted-foreground">Офлайн</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-500/10">
              <Wrench className="h-5 w-5 text-yellow-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{maintenanceCameras}</p>
              <p className="text-sm text-muted-foreground">Обслуживание</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Camera Settings Dialog */}
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Настройки камеры</DialogTitle>
            <DialogDescription>
              {cameras.find((c) => c.id === selectedCamera)?.name}
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const cam = cameras.find((c) => c.id === selectedCamera);
            if (!cam) return null;
            return (
              <div className="space-y-4 mt-2">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Статус</p>
                    <p className="font-medium">{cam.status === 'online' ? 'Онлайн' : cam.status === 'maintenance' ? 'Обслуживание' : 'Офлайн'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Расположение</p>
                    <p className="font-medium">{cam.location}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Разрешение</p>
                    <p className="font-medium">{cam.resolution}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">FPS</p>
                    <p className="font-medium">{cam.fps}</p>
                  </div>
                </div>
                <div className="space-y-3 pt-2 border-t border-border">
                  <div className="flex items-center justify-between">
                    <Label>ИИ-анализ</Label>
                    <Switch defaultChecked />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Запись при движении</Label>
                    <Switch defaultChecked />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Ночной режим</Label>
                    <Switch />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => {
                      setSettingsDialogOpen(false);
                      toast.success('Настройки камеры сохранены');
                    }}
                  >
                    Сохранить
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setSettingsDialogOpen(false)}
                  >
                    Отмена
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Camera Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cameras.map((camera) => (
          <Card key={camera.id} className="overflow-hidden">
            {/* Camera Preview */}
            <div className="relative aspect-video bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
              {camera.status === 'online' ? (
                <Video className="h-10 w-10 text-gray-600" />
              ) : (
                <Monitor className="h-10 w-10 text-gray-700" />
              )}
              {camera.status === 'online' && (
                <>
                  <div className="absolute top-2 left-2 flex items-center gap-1">
                    <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[10px] text-red-400 font-medium">REC</span>
                  </div>
                  <div className="absolute top-2 right-2">
                    <div className="flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5">
                      <Eye className="h-3 w-3 text-green-400" />
                      <span className="text-[10px] text-green-400">AI</span>
                    </div>
                  </div>
                </>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent h-16" />
              <div className="absolute bottom-2 left-2">
                <Badge
                  variant={
                    camera.status === 'online'
                      ? 'default'
                      : camera.status === 'maintenance'
                      ? 'secondary'
                      : 'destructive'
                  }
                  className="text-[10px]"
                >
                  {camera.status === 'online'
                    ? 'LIVE'
                    : camera.status === 'maintenance'
                    ? 'ОБСЛУЖИВАНИЕ'
                    : 'ОФЛАЙН'}
                </Badge>
              </div>
            </div>

            {/* Camera Info */}
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{camera.name}</h3>
                  <p className="text-sm text-muted-foreground">{camera.location}</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => toggleCameraStatus(camera.id)}>
                      {camera.status === 'online' ? (
                        <>
                          <WifiOff className="h-4 w-4 mr-2" />
                          Отключить
                        </>
                      ) : (
                        <>
                          <Wifi className="h-4 w-4 mr-2" />
                          Включить
                        </>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setSelectedCamera(camera.id);
                        setSettingsDialogOpen(true);
                      }}
                      className="cursor-pointer"
                    >
                      <Settings className="h-4 w-4 mr-2" />
                      Настройки
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => {
                        removeCamera(camera.id);
                        toast.success('Камера удалена');
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Удалить
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                <span>{camera.resolution}</span>
                <span>{camera.fps} FPS</span>
                <span>{camera.lastActivity}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
