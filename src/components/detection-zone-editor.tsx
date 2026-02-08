"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Minus,
  Square,
  Trash2,
  Save,
  Plus,
  MousePointer,
  Eye,
  EyeOff,
  GripVertical,
  ArrowLeftRight,
  ArrowUpDown,
} from "lucide-react";

// --- Types ---

interface Point {
  x: number;
  y: number;
}

export interface DetectionZone {
  id?: string;
  name: string;
  type: "line_crossing" | "queue_zone" | "restricted_area" | "counting_zone";
  points: Point[];
  direction?: "in" | "out" | "both";
  config?: Record<string, unknown>;
  enabled: boolean;
}

interface DetectionZoneEditorProps {
  cameraId: string;
  snapshotUrl?: string;
  zones: DetectionZone[];
  onSave: (zones: DetectionZone[]) => void;
}

type Tool = "select" | "line" | "rect" | "delete";

const ZONE_COLORS: Record<string, string> = {
  line_crossing: "#ef4444",
  queue_zone: "#f59e0b",
  restricted_area: "#dc2626",
  counting_zone: "#3b82f6",
};

const ZONE_TYPE_LABELS: Record<string, string> = {
  line_crossing: "Линия пересечения",
  queue_zone: "Зона очереди",
  restricted_area: "Запретная зона",
  counting_zone: "Зона подсчёта",
};

// Direction labels used in the select dropdown below
// const DIRECTION_LABELS: Record<string, string> = {
//   in: "Вход", out: "Выход", both: "Оба направления",
// };

// --- Component ---

export function DetectionZoneEditor({
  snapshotUrl,
  zones: initialZones,
  onSave,
}: DetectionZoneEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);

  const [zones, setZones] = useState<DetectionZone[]>(initialZones);
  const [selectedZoneIndex, setSelectedZoneIndex] = useState<number | null>(
    null
  );
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [lineFirstPoint, setLineFirstPoint] = useState<Point | null>(null);
  const [currentMousePos, setCurrentMousePos] = useState<Point | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 640, height: 360 });
  const [imageLoaded, setImageLoaded] = useState(false);

  // Load background image
  useEffect(() => {
    if (!snapshotUrl) {
      setImageLoaded(false);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      bgImageRef.current = img;
      setImageLoaded(true);
    };
    img.onerror = () => {
      bgImageRef.current = null;
      setImageLoaded(false);
    };
    img.src = snapshotUrl;
  }, [snapshotUrl]);

  // Resize canvas to fit container
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const w = Math.floor(rect.width);
        const h = Math.floor((w * 9) / 16); // 16:9 aspect ratio
        setCanvasSize({ width: w, height: h });
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Convert pixel coordinates to normalized (0-1)
  const toNormalized = useCallback(
    (px: number, py: number): Point => ({
      x: Math.max(0, Math.min(1, px / canvasSize.width)),
      y: Math.max(0, Math.min(1, py / canvasSize.height)),
    }),
    [canvasSize]
  );

  // Convert normalized coordinates to pixel
  const toPixel = useCallback(
    (nx: number, ny: number): Point => ({
      x: nx * canvasSize.width,
      y: ny * canvasSize.height,
    }),
    [canvasSize]
  );

  // Draw everything on canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    // Draw background
    if (bgImageRef.current && imageLoaded) {
      ctx.drawImage(
        bgImageRef.current,
        0,
        0,
        canvasSize.width,
        canvasSize.height
      );
    } else {
      // Dark background
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

      // Grid pattern
      ctx.strokeStyle = "#ffffff10";
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < canvasSize.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasSize.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvasSize.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvasSize.width, y);
        ctx.stroke();
      }

      // Center text
      ctx.fillStyle = "#ffffff40";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        "Снимок камеры не доступен",
        canvasSize.width / 2,
        canvasSize.height / 2
      );
    }

    // Draw existing zones
    zones.forEach((zone, index) => {
      if (!zone.enabled && index !== selectedZoneIndex) return;

      const color = ZONE_COLORS[zone.type] || "#3b82f6";
      const isSelected = index === selectedZoneIndex;
      const alpha = zone.enabled ? (isSelected ? 0.4 : 0.25) : 0.1;

      if (zone.type === "line_crossing" && zone.points.length === 2) {
        // Draw line
        const p1 = toPixel(zone.points[0].x, zone.points[0].y);
        const p2 = toPixel(zone.points[1].x, zone.points[1].y);

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.setLineDash(isSelected ? [] : [6, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw endpoints
        [p1, p2].forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, isSelected ? 6 : 4, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1;
          ctx.stroke();
        });

        // Draw direction arrow
        if (zone.direction && zone.direction !== "both") {
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;
          const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          const perpAngle =
            zone.direction === "in" ? angle + Math.PI / 2 : angle - Math.PI / 2;
          const arrowLen = 20;

          ctx.beginPath();
          ctx.moveTo(midX, midY);
          ctx.lineTo(
            midX + Math.cos(perpAngle) * arrowLen,
            midY + Math.sin(perpAngle) * arrowLen
          );
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();

          // Arrowhead
          const tipX = midX + Math.cos(perpAngle) * arrowLen;
          const tipY = midY + Math.sin(perpAngle) * arrowLen;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(
            tipX - Math.cos(perpAngle - 0.4) * 8,
            tipY - Math.sin(perpAngle - 0.4) * 8
          );
          ctx.lineTo(
            tipX - Math.cos(perpAngle + 0.4) * 8,
            tipY - Math.sin(perpAngle + 0.4) * 8
          );
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
        }
      } else if (zone.points.length >= 2) {
        // Draw polygon/rectangle
        const pixelPoints = zone.points.map((p) => toPixel(p.x, p.y));

        ctx.beginPath();
        ctx.moveTo(pixelPoints[0].x, pixelPoints[0].y);
        for (let i = 1; i < pixelPoints.length; i++) {
          ctx.lineTo(pixelPoints[i].x, pixelPoints[i].y);
        }
        ctx.closePath();

        // Fill
        ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, "0");
        ctx.fill();

        // Stroke
        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.setLineDash(isSelected ? [] : [6, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw corner points if selected
        if (isSelected) {
          pixelPoints.forEach((p) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1;
            ctx.stroke();
          });
        }
      }

      // Draw label
      if (zone.points.length >= 2) {
        const avgX =
          zone.points.reduce((s, p) => s + p.x, 0) / zone.points.length;
        const avgY =
          zone.points.reduce((s, p) => s + p.y, 0) / zone.points.length;
        const labelPos = toPixel(avgX, avgY);

        ctx.font = "bold 12px sans-serif";
        const metrics = ctx.measureText(zone.name);
        const labelW = metrics.width + 12;
        const labelH = 20;

        ctx.fillStyle = color + "cc";
        ctx.beginPath();
        ctx.roundRect(
          labelPos.x - labelW / 2,
          labelPos.y - labelH / 2,
          labelW,
          labelH,
          4
        );
        ctx.fill();

        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(zone.name, labelPos.x, labelPos.y);
      }
    });

    // Draw current drawing preview
    if (activeTool === "line" && lineFirstPoint && currentMousePos) {
      const p1 = toPixel(lineFirstPoint.x, lineFirstPoint.y);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(currentMousePos.x, currentMousePos.y);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw start point
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
    }

    if (activeTool === "rect" && isDrawing && drawStart && currentMousePos) {
      const p1 = toPixel(drawStart.x, drawStart.y);
      const w = currentMousePos.x - p1.x;
      const h = currentMousePos.y - p1.y;

      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(p1.x, p1.y, w, h);
      ctx.setLineDash([]);

      ctx.fillStyle = "#3b82f620";
      ctx.fillRect(p1.x, p1.y, w, h);
    }
  }, [
    zones,
    selectedZoneIndex,
    activeTool,
    lineFirstPoint,
    isDrawing,
    drawStart,
    currentMousePos,
    canvasSize,
    imageLoaded,
    toPixel,
  ]);

  // Redraw whenever state changes
  useEffect(() => {
    draw();
  }, [draw]);

  // Get mouse position relative to canvas
  const getCanvasPos = (e: ReactMouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  // Handle canvas click
  const handleCanvasMouseDown = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPos(e);
    const normalized = toNormalized(pos.x, pos.y);

    if (activeTool === "select") {
      // Find clicked zone
      let found = false;
      for (let i = zones.length - 1; i >= 0; i--) {
        const zone = zones[i];
        if (!zone.enabled) continue;

        if (zone.type === "line_crossing" && zone.points.length === 2) {
          // Check distance to line
          const p1 = toPixel(zone.points[0].x, zone.points[0].y);
          const p2 = toPixel(zone.points[1].x, zone.points[1].y);
          const dist = pointToLineDistance(pos, p1, p2);
          if (dist < 15) {
            setSelectedZoneIndex(i);
            found = true;
            break;
          }
        } else if (zone.points.length >= 3) {
          // Check point in polygon
          const pixelPoints = zone.points.map((p) =>
            toPixel(p.x, p.y)
          );
          if (isPointInPolygon(pos, pixelPoints)) {
            setSelectedZoneIndex(i);
            found = true;
            break;
          }
        } else if (zone.points.length === 4) {
          // Rectangle (4 points)
          const pixelPoints = zone.points.map((p) =>
            toPixel(p.x, p.y)
          );
          if (isPointInPolygon(pos, pixelPoints)) {
            setSelectedZoneIndex(i);
            found = true;
            break;
          }
        }
      }
      if (!found) {
        setSelectedZoneIndex(null);
      }
    } else if (activeTool === "line") {
      if (!lineFirstPoint) {
        // Set first point
        setLineFirstPoint(normalized);
      } else {
        // Set second point and create zone
        const newZone: DetectionZone = {
          name: `Линия ${zones.length + 1}`,
          type: "line_crossing",
          points: [lineFirstPoint, normalized],
          direction: "both",
          enabled: true,
        };
        setZones((prev) => [...prev, newZone]);
        setSelectedZoneIndex(zones.length);
        setLineFirstPoint(null);
        setCurrentMousePos(null);
        setActiveTool("select");
      }
    } else if (activeTool === "rect") {
      setIsDrawing(true);
      setDrawStart(normalized);
    } else if (activeTool === "delete") {
      // Find and delete clicked zone
      for (let i = zones.length - 1; i >= 0; i--) {
        const zone = zones[i];
        if (zone.type === "line_crossing" && zone.points.length === 2) {
          const p1 = toPixel(zone.points[0].x, zone.points[0].y);
          const p2 = toPixel(zone.points[1].x, zone.points[1].y);
          if (pointToLineDistance(pos, p1, p2) < 15) {
            setZones((prev) => prev.filter((_, idx) => idx !== i));
            if (selectedZoneIndex === i) setSelectedZoneIndex(null);
            else if (selectedZoneIndex !== null && selectedZoneIndex > i)
              setSelectedZoneIndex(selectedZoneIndex - 1);
            break;
          }
        } else if (zone.points.length >= 2) {
          const pixelPoints = zone.points.map((p) =>
            toPixel(p.x, p.y)
          );
          if (isPointInPolygon(pos, pixelPoints)) {
            setZones((prev) => prev.filter((_, idx) => idx !== i));
            if (selectedZoneIndex === i) setSelectedZoneIndex(null);
            else if (selectedZoneIndex !== null && selectedZoneIndex > i)
              setSelectedZoneIndex(selectedZoneIndex - 1);
            break;
          }
        }
      }
    }
  };

  const handleCanvasMouseMove = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPos(e);
    setCurrentMousePos(pos);
  };

  const handleCanvasMouseUp = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (activeTool === "rect" && isDrawing && drawStart) {
      const pos = getCanvasPos(e);
      const endNorm = toNormalized(pos.x, pos.y);

      // Minimum size check
      const minSize = 0.02;
      if (
        Math.abs(endNorm.x - drawStart.x) > minSize &&
        Math.abs(endNorm.y - drawStart.y) > minSize
      ) {
        const x1 = Math.min(drawStart.x, endNorm.x);
        const y1 = Math.min(drawStart.y, endNorm.y);
        const x2 = Math.max(drawStart.x, endNorm.x);
        const y2 = Math.max(drawStart.y, endNorm.y);

        const newZone: DetectionZone = {
          name: `Зона ${zones.length + 1}`,
          type: "counting_zone",
          points: [
            { x: x1, y: y1 },
            { x: x2, y: y1 },
            { x: x2, y: y2 },
            { x: x1, y: y2 },
          ],
          enabled: true,
        };
        setZones((prev) => [...prev, newZone]);
        setSelectedZoneIndex(zones.length);
        setActiveTool("select");
      }

      setIsDrawing(false);
      setDrawStart(null);
      setCurrentMousePos(null);
    }
  };

  // Zone property updates
  const updateZone = (index: number, updates: Partial<DetectionZone>) => {
    setZones((prev) =>
      prev.map((z, i) => (i === index ? { ...z, ...updates } : z))
    );
  };

  const deleteZone = (index: number) => {
    setZones((prev) => prev.filter((_, i) => i !== index));
    if (selectedZoneIndex === index) {
      setSelectedZoneIndex(null);
    } else if (selectedZoneIndex !== null && selectedZoneIndex > index) {
      setSelectedZoneIndex(selectedZoneIndex - 1);
    }
  };

  const addNewZone = () => {
    const newZone: DetectionZone = {
      name: `Зона ${zones.length + 1}`,
      type: "counting_zone",
      points: [
        { x: 0.25, y: 0.25 },
        { x: 0.75, y: 0.25 },
        { x: 0.75, y: 0.75 },
        { x: 0.25, y: 0.75 },
      ],
      enabled: true,
    };
    setZones((prev) => [...prev, newZone]);
    setSelectedZoneIndex(zones.length);
  };

  const handleSave = () => {
    onSave(zones);
  };

  const selectedZone =
    selectedZoneIndex !== null ? zones[selectedZoneIndex] : null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Canvas Area */}
      <div className="flex-1 space-y-3">
        {/* Toolbar */}
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
          <Button
            variant={activeTool === "select" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setActiveTool("select");
              setLineFirstPoint(null);
              setIsDrawing(false);
            }}
            title="Выбор"
          >
            <MousePointer className="size-4" />
            <span className="hidden sm:inline">Выбор</span>
          </Button>
          <Button
            variant={activeTool === "line" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setActiveTool("line");
              setLineFirstPoint(null);
              setIsDrawing(false);
            }}
            title="Линия"
          >
            <Minus className="size-4" />
            <span className="hidden sm:inline">Линия</span>
          </Button>
          <Button
            variant={activeTool === "rect" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setActiveTool("rect");
              setLineFirstPoint(null);
              setIsDrawing(false);
            }}
            title="Прямоугольник"
          >
            <Square className="size-4" />
            <span className="hidden sm:inline">Зона</span>
          </Button>
          <div className="mx-1 h-6 w-px bg-border" />
          <Button
            variant={activeTool === "delete" ? "destructive" : "ghost"}
            size="sm"
            onClick={() => {
              setActiveTool("delete");
              setLineFirstPoint(null);
              setIsDrawing(false);
            }}
            title="Удалить"
          >
            <Trash2 className="size-4" />
            <span className="hidden sm:inline">Удалить</span>
          </Button>

          <div className="flex-1" />

          <Button size="sm" onClick={handleSave} className="gap-1.5">
            <Save className="size-4" />
            Сохранить
          </Button>
        </div>

        {/* Drawing hint */}
        {activeTool === "line" && (
          <div className="rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            {lineFirstPoint
              ? "Кликните на вторую точку для завершения линии"
              : "Кликните на первую точку линии пересечения"}
          </div>
        )}
        {activeTool === "rect" && (
          <div className="rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            Нажмите и перетащите для создания прямоугольной зоны
          </div>
        )}
        {activeTool === "delete" && (
          <div className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            Кликните на зону для удаления
          </div>
        )}

        {/* Canvas */}
        <div
          ref={containerRef}
          className="relative overflow-hidden rounded-lg border bg-black"
        >
          <canvas
            ref={canvasRef}
            width={canvasSize.width}
            height={canvasSize.height}
            className={cn(
              "w-full",
              activeTool === "line" && "cursor-crosshair",
              activeTool === "rect" && "cursor-crosshair",
              activeTool === "delete" && "cursor-pointer",
              activeTool === "select" && "cursor-default"
            )}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={() => setCurrentMousePos(null)}
          />
        </div>
      </div>

      {/* Zone List Panel */}
      <div className="w-full space-y-3 lg:w-80">
        {/* Zone list */}
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <h3 className="text-sm font-semibold">
              Зоны детекции ({zones.length})
            </h3>
            <Button variant="ghost" size="icon-xs" onClick={addNewZone}>
              <Plus className="size-3.5" />
            </Button>
          </div>

          <ScrollArea className="max-h-[300px]">
            {zones.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                Нет зон. Используйте инструменты выше для создания.
              </div>
            ) : (
              <div className="divide-y">
                {zones.map((zone, index) => (
                  <div
                    key={index}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors hover:bg-accent/50",
                      selectedZoneIndex === index && "bg-accent"
                    )}
                    onClick={() => setSelectedZoneIndex(index)}
                  >
                    <GripVertical className="size-3.5 text-muted-foreground/50 shrink-0" />
                    <div
                      className="size-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          ZONE_COLORS[zone.type] || "#3b82f6",
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">
                        {zone.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {ZONE_TYPE_LABELS[zone.type]}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateZone(index, { enabled: !zone.enabled });
                      }}
                    >
                      {zone.enabled ? (
                        <Eye className="size-3 text-green-500" />
                      ) : (
                        <EyeOff className="size-3 text-muted-foreground" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteZone(index);
                      }}
                    >
                      <Trash2 className="size-3 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Selected zone properties */}
        {selectedZone && selectedZoneIndex !== null && (
          <div className="space-y-3 rounded-lg border bg-card p-3">
            <h4 className="text-sm font-semibold">Свойства зоны</h4>

            <div className="space-y-2">
              <Label className="text-xs">Название</Label>
              <Input
                value={selectedZone.name}
                onChange={(e) =>
                  updateZone(selectedZoneIndex, {
                    name: e.target.value,
                  })
                }
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Тип</Label>
              <Select
                value={selectedZone.type}
                onValueChange={(v) =>
                  updateZone(selectedZoneIndex, {
                    type: v as DetectionZone["type"],
                    // Reset direction for non-line types
                    direction: v === "line_crossing" ? "both" : undefined,
                  })
                }
              >
                <SelectTrigger className="h-8 w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="line_crossing">
                    <div className="flex items-center gap-2">
                      <ArrowLeftRight className="size-3.5" />
                      Линия пересечения
                    </div>
                  </SelectItem>
                  <SelectItem value="queue_zone">
                    <div className="flex items-center gap-2">
                      <ArrowUpDown className="size-3.5" />
                      Зона очереди
                    </div>
                  </SelectItem>
                  <SelectItem value="restricted_area">
                    <div className="flex items-center gap-2">
                      <Square className="size-3.5" />
                      Запретная зона
                    </div>
                  </SelectItem>
                  <SelectItem value="counting_zone">
                    <div className="flex items-center gap-2">
                      <Square className="size-3.5" />
                      Зона подсчёта
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {selectedZone.type === "line_crossing" && (
              <div className="space-y-2">
                <Label className="text-xs">Направление</Label>
                <Select
                  value={selectedZone.direction || "both"}
                  onValueChange={(v) =>
                    updateZone(selectedZoneIndex, {
                      direction: v as "in" | "out" | "both",
                    })
                  }
                >
                  <SelectTrigger className="h-8 w-full text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">Вход</SelectItem>
                    <SelectItem value="out">Выход</SelectItem>
                    <SelectItem value="both">Оба направления</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <Label className="text-xs">Активна</Label>
              <Switch
                checked={selectedZone.enabled}
                onCheckedChange={(checked) =>
                  updateZone(selectedZoneIndex, { enabled: checked })
                }
                size="sm"
              />
            </div>

            <div className="pt-1">
              <Badge
                variant="outline"
                className="text-[10px]"
                style={{
                  borderColor: ZONE_COLORS[selectedZone.type],
                  color: ZONE_COLORS[selectedZone.type],
                }}
              >
                {selectedZone.points.length} точек
              </Badge>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Geometry Helpers ---

function pointToLineDistance(
  point: Point,
  lineStart: Point,
  lineEnd: Point
): number {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  const param = lenSq !== 0 ? dot / lenSq : -1;

  let xx: number, yy: number;

  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }

  const dx = point.x - xx;
  const dy = point.y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    if (
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }

  return inside;
}
