'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Video,
  VideoOff,
  Circle,
  Square,
  Settings,
  Loader2,
  Wifi,
  WifiOff,
  Eye,
  Monitor,
  Archive,
  Download,
  MapPin,
  Users,
  Shield,
  Target,
  Car,
  PawPrint,
  Box,
  Flame,
  Filter,
  DoorOpen,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Go2rtcInlinePlayer } from '@/components/go2rtc-inline-player';
import { DetectionOverlay, type Detection } from '@/components/detection-overlay';
import { useEventStream } from '@/hooks/use-event-stream';
import { useBrowserDetection } from '@/hooks/use-browser-detection';
import { useBrowserFaceDetection } from '@/hooks/use-browser-face-detection';
import { PtzControls } from '@/components/ptz-controls';
import { ExportDialog } from '@/components/export-dialog';
import HeatmapOverlay from '@/components/heatmap-overlay';
import PeopleCounterWidget from '@/components/people-counter-widget';
import OccupancyWidget from '@/components/occupancy-widget';
import { apiGet, apiPost, apiPatch } from '@/lib/api-client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface CameraDetail {
  id: string;
  name: string;
  location: string;
  streamUrl: string;
  status: string;
  venueType: string;
  purpose: string;
  resolution: string;
  fps: number;
  isMonitoring: boolean;
  isRecording: boolean;
  isStreaming: boolean;
  retentionDays: number;
  onvifHost: string | null;
  onvifPort: number | null;
  onvifUser: string | null;
  onvifPass: string | null;
  hasPtz: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function CameraDetailPage() {
  const params = useParams();
  const router = useRouter();
  const cameraId = params.id as string;

  const [camera, setCamera] = useState<CameraDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [streamAction, setStreamAction] = useState<'starting' | 'stopping' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedClasses, setSelectedClasses] = useState<Set<string>>(
    new Set(['person', 'vehicle', 'animal', 'fire', 'other'])
  );
  const [selectedOtherTypes, setSelectedOtherTypes] = useState<Set<string>>(
    new Set(['backpack', 'handbag', 'suitcase', 'knife', 'cell_phone', 'bottle'])
  );
  const [liveCounts, setLiveCounts] = useState({ personCount: 0, totalCount: 0 });
  const [liveDetections, setLiveDetections] = useState<Detection[]>([]);
  const [fireDetections, setFireDetections] = useState<Detection[]>([]);
  const [faceDetections, setFaceDetections] = useState<Detection[]>([]);
  const [measuredLatency, setMeasuredLatency] = useState<number | undefined>();
  const latencyEmaRef = useRef<number | null>(null);

  // Browser-side detection via ONNX Runtime Web
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handleVideoRef = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
  }, []);

  // Map selectedClasses categories → YOLO type strings for browser detection
  const browserEnabledTypes = useMemo(() => {
    const types = new Set<string>();
    if (selectedClasses.has('person')) types.add('person');
    if (selectedClasses.has('vehicle')) {
      for (const t of ['car', 'bus', 'truck', 'motorcycle', 'bicycle', 'airplane', 'train', 'boat']) types.add(t);
    }
    if (selectedClasses.has('animal')) {
      for (const t of ['cat', 'dog', 'bird', 'horse', 'sheep', 'cow', 'elephant', 'bear']) types.add(t);
    }
    if (selectedClasses.has('other')) {
      for (const t of selectedOtherTypes) types.add(t);
    }
    return types;
  }, [selectedClasses, selectedOtherTypes]);

  const isAttendance = camera?.purpose?.startsWith('attendance_') ?? false;

  const {
    detections: browserDetections,
    fps: browserFps,
    backend: browserBackend,
    loading: browserLoading,
  } = useBrowserDetection(videoRef, {
    enabled: !isAttendance && selectedClasses.size > 0,
    enabledClasses: browserEnabledTypes,
    targetFps: 10,
  });

  // Browser-side face detection for attendance cameras (instant visual feedback)
  const {
    detections: browserFaces,
    fps: faceFps,
    loading: faceLoading,
  } = useBrowserFaceDetection(videoRef, {
    enabled: isAttendance && (camera?.isStreaming || camera?.isMonitoring || false),
  });
  const [onvifForm, setOnvifForm] = useState({
    onvifHost: '',
    onvifPort: 80,
    onvifUser: '',
    onvifPass: '',
    hasPtz: false,
  });

  const fetchCamera = useCallback(async () => {
    try {
      const data = await apiGet<CameraDetail>(`/api/cameras/${cameraId}`);
      setCamera(data);
      setOnvifForm({
        onvifHost: data.onvifHost || '',
        onvifPort: data.onvifPort || 80,
        onvifUser: data.onvifUser || '',
        onvifPass: data.onvifPass || '',
        hasPtz: data.hasPtz,
      });
    } catch {
      toast.error('Камера не найдена');
      router.push('/cameras');
    } finally {
      setLoading(false);
    }
  }, [cameraId, router]);

  useEffect(() => {
    fetchCamera();
  }, [fetchCamera]);

  // Map detection type → filter category
  const typeToCategory = useCallback((type: string): string => {
    if (type === 'person') return 'person';
    if (['car', 'bus', 'truck', 'motorcycle', 'bicycle', 'airplane', 'train', 'boat'].includes(type)) return 'vehicle';
    if (['cat', 'dog', 'bird', 'horse', 'sheep', 'cow', 'elephant', 'bear'].includes(type)) return 'animal';
    if (type === 'fire' || type === 'smoke') return 'fire';
    return 'other';
  }, []);

  const handleStreamToggle = async () => {
    if (!camera) return;
    const action = camera.isStreaming ? 'stop' : 'start';
    setStreamAction(action === 'start' ? 'starting' : 'stopping');
    try {
      await apiPost(`/api/cameras/${cameraId}/stream`, { action });
      toast.success(action === 'start' ? 'Трансляция запущена' : 'Трансляция остановлена');
      // Refresh after a small delay to let stream start
      setTimeout(fetchCamera, 1000);
    } catch {
      toast.error('Не удалось управлять трансляцией');
    } finally {
      setStreamAction(null);
    }
  };

  const handleSaveOnvif = async () => {
    setSaving(true);
    try {
      await apiPatch(`/api/cameras/${cameraId}`, onvifForm);
      toast.success('Настройки ONVIF сохранены');
      setSettingsOpen(false);
      fetchCamera();
    } catch {
      toast.error('Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const DETECTION_CATEGORIES = [
    { id: 'person', label: 'Люди', icon: Users, color: '#3B82F6' },
    { id: 'vehicle', label: 'Транспорт', icon: Car, color: '#22C55E' },
    { id: 'animal', label: 'Животные', icon: PawPrint, color: '#8B5CF6' },
    { id: 'fire', label: 'Пожар', icon: Flame, color: '#EF4444' },
    { id: 'other', label: 'Прочее', icon: Box, color: '#6B7280' },
  ];

  const OTHER_SUBTYPES = [
    { type: 'backpack',      label: 'Рюкзак' },
    { type: 'handbag',       label: 'Сумка' },
    { type: 'suitcase',      label: 'Чемодан' },
    { type: 'umbrella',      label: 'Зонт' },
    { type: 'bottle',        label: 'Бутылка' },
    { type: 'cup',           label: 'Чашка' },
    { type: 'knife',         label: 'Нож' },
    { type: 'scissors',      label: 'Ножницы' },
    { type: 'cell_phone',    label: 'Телефон' },
    { type: 'laptop',        label: 'Ноутбук' },
    { type: 'keyboard',      label: 'Клавиатура' },
    { type: 'mouse',         label: 'Мышь' },
    { type: 'tv',            label: 'Монитор' },
    { type: 'book',          label: 'Книга' },
    { type: 'clock',         label: 'Часы' },
    { type: 'vase',          label: 'Ваза' },
    { type: 'chair',         label: 'Стул' },
    { type: 'couch',         label: 'Диван' },
    { type: 'dining_table',  label: 'Стол' },
    { type: 'potted_plant',  label: 'Растение' },
    { type: 'bench',         label: 'Скамейка' },
    { type: 'traffic_light', label: 'Светофор' },
    { type: 'fire_hydrant',  label: 'Гидрант' },
    { type: 'stop_sign',     label: 'Знак стоп' },
    { type: 'bowl',          label: 'Миска' },
  ];

  const toggleClass = (cls: string) => {
    setSelectedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(cls)) {
        next.delete(cls);
      } else {
        next.add(cls);
      }
      return next;
    });
  };

  // SSE: receive live YOLO detections + fire/smoke events
  useEventStream(
    useCallback(
      (event) => {
        if (event.cameraId !== cameraId) return;

        if (event.type === 'frame_analyzed' && Array.isArray(event.data.detections)) {
          const dets = event.data.detections as Detection[];
          const now = Date.now();

          setLiveDetections(dets);

          // Measure pipeline latency from server timestamp
          const capturedAt = event.data.capturedAt as number | undefined;
          if (capturedAt) {
            const latency = Math.max(0, now - capturedAt);
            if (latencyEmaRef.current === null) {
              latencyEmaRef.current = latency;
            } else {
              latencyEmaRef.current = 0.85 * latencyEmaRef.current + 0.15 * latency;
            }
            setMeasuredLatency(Math.round(latencyEmaRef.current));
          }
        }

        // Fire/smoke from server-side HSV detection
        if (event.type === 'fire_detected' || event.type === 'smoke_detected') {
          const regions = event.data.regions as Array<{ bbox: { x: number; y: number; w: number; h: number } }> | undefined;
          const confidence = (event.data.confidence as number) || 0.8;
          const isFire = event.type === 'fire_detected';
          const dets: Detection[] = (regions || []).map(r => ({
            type: isFire ? 'fire' : 'smoke',
            label: isFire ? 'Огонь' : 'Дым',
            confidence,
            bbox: r.bbox,
            classId: -1,
            color: isFire ? '#EF4444' : '#F59E0B',
          }));
          setFireDetections(dets);
          // Auto-clear after 3s (fire detection runs every ~30 polls)
          setTimeout(() => setFireDetections([]), 3000);
        }
      },
      [cameraId]
    )
  );

  // Poll face recognition data from server (reliable, works regardless of SSE state)
  // Only active when the page is open for an attendance camera
  useEffect(() => {
    if (!isAttendance || !camera?.isMonitoring) return;

    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/attendance/face-events?cameraId=${cameraId}`);
        if (!active) return;
        const data = await res.json();
        if (Array.isArray(data.detections) && data.detections.length > 0) {
          setFaceDetections(data.detections as Detection[]);
        }
      } catch {
        // Network error — ignore, will retry
      }
    };

    poll(); // initial fetch
    const interval = setInterval(poll, 500); // poll every 500ms

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isAttendance, camera?.isMonitoring, cameraId]);

  // Merge attendance detections:
  // Browser faces (fast, accurate position) = PRIMARY for bbox
  // Server SSE faces (slow, ~1fps, has identity) = enriches with name/color
  // Uses center-distance matching (robust to bbox size differences between models)
  const mergedFaceDetections = useMemo(() => {
    if (!isAttendance) return faceDetections;
    if (browserFaces.length === 0) return faceDetections;

    // No server data yet — just show browser faces
    if (faceDetections.length === 0) return browserFaces;

    const MATCH_DIST = 0.25; // max center distance (normalized) to match
    const result: Detection[] = [];
    const usedServerIndices = new Set<number>();

    for (const bf of browserFaces) {
      const bfCx = bf.bbox.x + bf.bbox.w / 2;
      const bfCy = bf.bbox.y + bf.bbox.h / 2;

      // Find closest server face by center distance
      let bestServer: Detection | null = null;
      let bestIdx = -1;
      let bestDist = MATCH_DIST;

      for (let i = 0; i < faceDetections.length; i++) {
        if (usedServerIndices.has(i)) continue;
        const sf = faceDetections[i];
        const sfCx = sf.bbox.x + sf.bbox.w / 2;
        const sfCy = sf.bbox.y + sf.bbox.h / 2;
        const dist = Math.sqrt((bfCx - sfCx) ** 2 + (bfCy - sfCy) ** 2);
        if (dist < bestDist) {
          bestDist = dist;
          bestServer = sf;
          bestIdx = i;
        }
      }

      if (bestServer) {
        usedServerIndices.add(bestIdx);
        result.push({
          ...bestServer,
          bbox: bf.bbox, // use browser bbox — it tracks faster
        });
      } else {
        // No server match — use closest server identity if only one face
        if (faceDetections.length === 1 && browserFaces.length === 1) {
          result.push({ ...faceDetections[0], bbox: bf.bbox });
        } else {
          result.push(bf);
        }
      }
    }

    return result;
  }, [isAttendance, faceDetections, browserFaces]);

  // Use browser detections when available, fall back to SSE server detections
  const useBrowser = browserDetections.length > 0 || (!browserLoading && browserFps > 0);

  // Filter detections by selected categories
  const filteredDetections = useMemo(() => {
    if (selectedClasses.size === 0) return [];

    // Fire/smoke detections from server (always merged, regardless of browser/SSE mode)
    const fireDets = selectedClasses.has('fire') ? fireDetections : [];

    // Browser detections are already filtered by enabledClasses in the hook
    if (useBrowser) return [...browserDetections, ...fireDets];

    // Fallback: SSE server detections — filter by confidence + category + NMS
    const filtered = liveDetections.filter(d => {
      const cat = typeToCategory(d.type);
      if (!selectedClasses.has(cat)) return false;
      if (cat === 'other' && !selectedOtherTypes.has(d.type)) return false;
      const minConf = cat === 'person' ? 0.7 : cat === 'vehicle' ? 0.45 : 0.55;
      return d.confidence >= minConf;
    });
    const kept: typeof filtered = [];
    for (const det of filtered.sort((a, b) => b.confidence - a.confidence)) {
      const dominated = kept.some(k => {
        if (k.type !== det.type) return false;
        const x1 = Math.max(k.bbox.x, det.bbox.x);
        const y1 = Math.max(k.bbox.y, det.bbox.y);
        const x2 = Math.min(k.bbox.x + k.bbox.w, det.bbox.x + det.bbox.w);
        const y2 = Math.min(k.bbox.y + k.bbox.h, det.bbox.y + det.bbox.h);
        const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        const union = k.bbox.w * k.bbox.h + det.bbox.w * det.bbox.h - inter;
        return union > 0 && inter / union > 0.45;
      });
      if (!dominated) kept.push(det);
    }
    return [...kept, ...fireDets];
  }, [liveDetections, browserDetections, fireDetections, useBrowser, selectedClasses, selectedOtherTypes, typeToCategory]);

  // Update counts from filtered detections
  useEffect(() => {
    const personCount = filteredDetections.filter(d => d.type === 'person').length;
    setLiveCounts({ personCount, totalCount: filteredDetections.length });
  }, [filteredDetections]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!camera) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/cameras')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{camera.name}</h1>
              <Badge variant={camera.status === 'online' ? 'default' : 'destructive'}>
                {camera.status === 'online' ? (
                  <><Wifi className="h-3 w-3 mr-1" /> Онлайн</>
                ) : (
                  <><WifiOff className="h-3 w-3 mr-1" /> Офлайн</>
                )}
              </Badge>
              {camera.isMonitoring && (
                <Badge variant="secondary">
                  <Eye className="h-3 w-3 mr-1" /> AI
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">{camera.location}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
            <Download className="h-4 w-4 mr-2" />
            Экспорт
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/archive?cameraId=${cameraId}`}>
              <Archive className="h-4 w-4 mr-2" />
              Архив
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4 mr-2" />
            ONVIF
          </Button>
        </div>
      </div>

      {/* Main content: Video + PTZ */}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Video Area */}
        <div className="space-y-4">
          {/* Video Player */}
          <div className="relative aspect-video rounded-lg overflow-hidden bg-gradient-to-br from-gray-800 to-gray-900">
            {camera.isStreaming || camera.isMonitoring ? (
              <>
                <Go2rtcInlinePlayer
                  streamName={cameraId}
                  className="absolute inset-0 w-full h-full"
                  protocol={camera.streamUrl.toLowerCase().startsWith('rtsp://') ? 'rtsp' : 'http'}
                  onVideoRef={handleVideoRef}
                />
                <DetectionOverlay
                  detections={isAttendance ? mergedFaceDetections : filteredDetections}
                  visible={isAttendance || selectedClasses.size > 0}
                  pipelineLatencyMs={isAttendance ? undefined : (useBrowser ? 0 : measuredLatency)}
                />
                {/* Browser AI badge — only for detection cameras */}
                {!isAttendance && selectedClasses.size > 0 && (
                  <div className="absolute bottom-3 left-3 z-20">
                    {browserLoading ? (
                      <Badge variant="secondary" className="bg-black/60 text-yellow-400 border-0 text-[10px] px-1.5 py-0.5 gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        AI загрузка...
                      </Badge>
                    ) : useBrowser ? (
                      <Badge variant="secondary" className="bg-black/60 text-green-400 border-0 text-[10px] px-1.5 py-0.5 gap-1">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-400" />
                        </span>
                        AI Browser {browserFps}fps {browserBackend === 'webgpu' ? '⚡' : ''}
                      </Badge>
                    ) : null}
                  </div>
                )}
                {/* Attendance badge */}
                {isAttendance && (camera.isMonitoring || camera.isStreaming) && (
                  <div className="absolute bottom-3 left-3 z-20 flex gap-1">
                    {faceLoading ? (
                      <Badge variant="secondary" className="bg-black/60 text-yellow-400 border-0 text-[10px] px-1.5 py-0.5 gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Face AI загрузка...
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-black/60 text-green-400 border-0 text-[10px] px-1.5 py-0.5 gap-1">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-400" />
                        </span>
                        Face AI {faceFps > 0 ? `${faceFps}fps` : 'Browser'}
                      </Badge>
                    )}
                    {camera.isMonitoring && (
                      <Badge variant="secondary" className="bg-black/60 text-blue-400 border-0 text-[10px] px-1.5 py-0.5 gap-1">
                        <Shield className="h-3 w-3" />
                        Recognition
                      </Badge>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <Monitor className="h-16 w-16 text-gray-600" />
                <p className="text-gray-400 text-sm">
                  Трансляция не активна
                </p>
                <Button onClick={handleStreamToggle} disabled={!!streamAction}>
                  {streamAction === 'starting' ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Video className="h-4 w-4 mr-2" />
                  )}
                  Запустить трансляцию
                </Button>
              </div>
            )}
          </div>

          {/* Stream Controls */}
          <div className="flex items-center gap-3">
            {camera.isStreaming ? (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleStreamToggle}
                  disabled={!!streamAction}
                >
                  {streamAction === 'stopping' ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <VideoOff className="h-4 w-4 mr-2" />
                  )}
                  Остановить трансляцию
                </Button>
                <div className="flex items-center gap-2 text-sm">
                  <div className="flex items-center gap-1.5">
                    <Circle className={cn(
                      'h-3 w-3',
                      camera.isRecording ? 'text-red-500 fill-red-500 animate-pulse' : 'text-gray-400'
                    )} />
                    <span className={camera.isRecording ? 'text-red-500' : 'text-muted-foreground'}>
                      {camera.isRecording ? 'Запись идёт' : 'Запись выключена'}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                Запустите трансляцию для просмотра живого видео и PTZ-управления
              </div>
            )}
          </div>

          {/* Detection Filter — only for detection cameras */}
          {!isAttendance && (camera.isStreaming || camera.isMonitoring) && (
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2.5">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Фильтр детекции</span>
                  {selectedClasses.size > 0 && liveCounts.totalCount > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {liveCounts.personCount > 0 && `${liveCounts.personCount} чел.`}
                      {liveCounts.personCount > 0 && liveCounts.totalCount > liveCounts.personCount && ' / '}
                      {liveCounts.totalCount > liveCounts.personCount && `${liveCounts.totalCount - liveCounts.personCount} объект.`}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {selectedClasses.size === 0
                      ? 'Детекция выкл.'
                      : selectedClasses.size === DETECTION_CATEGORIES.length
                        ? 'Все объекты'
                        : `${selectedClasses.size} из ${DETECTION_CATEGORIES.length}`}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {DETECTION_CATEGORIES.map((cat) => {
                    const Icon = cat.icon;
                    const active = selectedClasses.has(cat.id);
                    return (
                      <button
                        key={cat.id}
                        onClick={() => toggleClass(cat.id)}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border',
                          active
                            ? 'border-transparent text-white'
                            : 'border-border text-muted-foreground bg-muted/50 hover:bg-muted'
                        )}
                        style={active ? { backgroundColor: cat.color } : undefined}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {cat.label}
                        {cat.id === 'other' && active && (
                          <span className="ml-0.5 opacity-75">({selectedOtherTypes.size})</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {selectedClasses.has('other') && (
                  <div className="mt-3 pt-3 border-t">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-muted-foreground">Объекты для отслеживания</span>
                      <div className="flex gap-2">
                        <button
                          className="text-[10px] text-muted-foreground hover:text-foreground"
                          onClick={() => setSelectedOtherTypes(new Set(OTHER_SUBTYPES.map(s => s.type)))}
                        >
                          Все
                        </button>
                        <button
                          className="text-[10px] text-muted-foreground hover:text-foreground"
                          onClick={() => setSelectedOtherTypes(new Set())}
                        >
                          Сброс
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {OTHER_SUBTYPES.map((sub) => {
                        const active = selectedOtherTypes.has(sub.type);
                        return (
                          <button
                            key={sub.type}
                            onClick={() => {
                              setSelectedOtherTypes((prev) => {
                                const next = new Set(prev);
                                if (next.has(sub.type)) next.delete(sub.type);
                                else next.add(sub.type);
                                return next;
                              });
                            }}
                            className={cn(
                              'px-2 py-0.5 rounded-full text-[11px] border transition-colors',
                              active
                                ? 'bg-gray-600 text-white border-gray-600'
                                : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
                            )}
                          >
                            {sub.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Camera Info Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">Разрешение</p>
                <p className="font-medium">{camera.resolution}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">FPS</p>
                <p className="font-medium">{camera.fps}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">Хранение</p>
                <p className="font-medium">{camera.retentionDays} дней</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">ONVIF</p>
                <p className="font-medium">
                  {camera.onvifHost ? `${camera.onvifHost}:${camera.onvifPort}` : 'Не настроен'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Analytics Tabs — only for detection cameras */}
          {!isAttendance && (
            <Tabs defaultValue="heatmap" className="mt-2">
              <TabsList>
                <TabsTrigger value="heatmap">
                  <MapPin className="h-4 w-4 mr-1.5" />
                  Тепловая карта
                </TabsTrigger>
                <TabsTrigger value="people">
                  <Users className="h-4 w-4 mr-1.5" />
                  Подсчёт людей
                </TabsTrigger>
                <TabsTrigger value="occupancy">
                  <DoorOpen className="h-4 w-4 mr-1.5" />
                  Заполняемость
                </TabsTrigger>
              </TabsList>

              <TabsContent value="heatmap">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      Тепловая карта активности
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <HeatmapOverlay cameraId={cameraId} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="people">
                <PeopleCounterWidget
                  cameraId={cameraId}
                  cameraName={camera.name}
                />
              </TabsContent>

              <TabsContent value="occupancy">
                <OccupancyWidget
                  cameraId={cameraId}
                  cameraName={camera.name}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>

        {/* PTZ Sidebar */}
        <div className="space-y-4">
          <PtzControls
            cameraId={cameraId}
            hasPtz={camera.hasPtz}
          />

          {/* Quick Links */}
          <Card>
            <CardHeader className="pb-3 px-4 pt-4">
              <CardTitle className="text-sm">Быстрые ссылки</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                <Link href={`/archive?cameraId=${cameraId}`}>
                  <Archive className="h-4 w-4 mr-2" />
                  Видеоархив
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                <Link href="/storage">
                  <Square className="h-4 w-4 mr-2" />
                  Хранилище
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Export Dialog */}
      <ExportDialog
        cameraId={cameraId}
        cameraName={camera.name}
        open={exportOpen}
        onOpenChange={setExportOpen}
      />

      {/* ONVIF Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Настройки ONVIF / PTZ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>ONVIF Хост (IP)</Label>
              <Input
                placeholder="192.168.1.100"
                value={onvifForm.onvifHost}
                onChange={(e) => setOnvifForm({ ...onvifForm, onvifHost: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Порт</Label>
              <Input
                type="number"
                placeholder="80"
                value={onvifForm.onvifPort}
                onChange={(e) => setOnvifForm({ ...onvifForm, onvifPort: parseInt(e.target.value) || 80 })}
              />
            </div>
            <div className="space-y-2">
              <Label>Логин</Label>
              <Input
                placeholder="admin"
                value={onvifForm.onvifUser}
                onChange={(e) => setOnvifForm({ ...onvifForm, onvifUser: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Пароль</Label>
              <Input
                type="password"
                placeholder="password"
                value={onvifForm.onvifPass}
                onChange={(e) => setOnvifForm({ ...onvifForm, onvifPass: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Поддержка PTZ</Label>
              <Switch
                checked={onvifForm.hasPtz}
                onCheckedChange={(v) => setOnvifForm({ ...onvifForm, hasPtz: v })}
              />
            </div>
            <Button onClick={handleSaveOnvif} className="w-full" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
