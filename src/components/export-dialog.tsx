"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiPost } from "@/lib/api-client";
import {
  Download,
  FileVideo,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ExportDialogProps {
  cameraId: string;
  cameraName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ExportStatus = "idle" | "processing" | "completed" | "error";

interface ExportResponse {
  exportId: string;
  status: string;
}

interface ExportProgressEvent {
  progress: number;
  status: string;
  message?: string;
  downloadUrl?: string;
  error?: string;
}

export function ExportDialog({
  cameraId,
  cameraName,
  open,
  onOpenChange,
}: ExportDialogProps) {
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("23:59");
  const [format, setFormat] = useState<"mp4" | "avi">("mp4");
  const [addTimestamp, setAddTimestamp] = useState(true);
  const [addWatermark, setAddWatermark] = useState(false);
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportId, setExportId] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset form when dialog opens
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (newOpen) {
        const today = new Date().toISOString().split("T")[0];
        setStartDate(today);
        setEndDate(today);
        setStatus("idle");
        setProgress(0);
        setProgressMessage("");
        setDownloadUrl(null);
        setError(null);
        setExportId(null);
      }
      onOpenChange(newOpen);
    },
    [onOpenChange]
  );

  // Cleanup on unmount or close
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  const pollExportStatus = useCallback(
    (expId: string) => {
      // Poll the export status endpoint every 2 seconds
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(
            `/api/cameras/${cameraId}/export/${expId}`
          );
          if (!res.ok) {
            const data = await res.json();
            if (data.status === "error") {
              setStatus("error");
              setError(data.error || "Ошибка экспорта");
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
              }
            }
            return;
          }

          const contentType = res.headers.get("content-type") || "";

          if (contentType.includes("application/json")) {
            const data = await res.json();
            if (data.status === "processing") {
              setProgress(data.progress || 50);
              setProgressMessage(data.message || "Обработка...");
            } else if (data.status === "error") {
              setStatus("error");
              setError(data.error || "Ошибка экспорта");
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
              }
            }
          } else {
            // File is ready for download - it returned the file
            setStatus("completed");
            setProgress(100);
            setProgressMessage("Готово!");
            setDownloadUrl(
              `/api/cameras/${cameraId}/export/${expId}`
            );
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
          }
        } catch {
          // Continue polling
        }
      }, 2000);
    },
    [cameraId]
  );

  const startSSE = useCallback(
    (expId: string) => {
      const url = `/api/cameras/${cameraId}/export/${expId}/progress`;
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data: ExportProgressEvent = JSON.parse(event.data);

          setProgress(data.progress);
          if (data.message) {
            setProgressMessage(data.message);
          }

          if (data.status === "completed") {
            setStatus("completed");
            setDownloadUrl(
              data.downloadUrl ||
                `/api/cameras/${cameraId}/export/${expId}`
            );
            eventSource.close();
            eventSourceRef.current = null;
          } else if (data.status === "error") {
            setStatus("error");
            setError(data.error || "Ошибка экспорта");
            eventSource.close();
            eventSourceRef.current = null;
          }
        } catch {
          // Skip unparseable messages
        }
      };

      eventSource.onerror = () => {
        // SSE failed, fall back to polling
        eventSource.close();
        eventSourceRef.current = null;
        pollExportStatus(expId);
      };
    },
    [cameraId, pollExportStatus]
  );

  const handleExport = async () => {
    if (!startDate || !endDate) return;

    setStatus("processing");
    setProgress(0);
    setProgressMessage("Запуск экспорта...");
    setError(null);
    setDownloadUrl(null);

    const startDateTime = `${startDate}T${startTime}:00`;
    const endDateTime = `${endDate}T${endTime}:00`;

    try {
      const response = await apiPost<ExportResponse>(
        `/api/cameras/${cameraId}/export`,
        {
          startTime: startDateTime,
          endTime: endDateTime,
          format,
          addTimestamp,
          addWatermark,
        }
      );

      setExportId(response.exportId);

      // Try SSE first, fall back to polling
      startSSE(response.exportId);
    } catch (err: unknown) {
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Не удалось начать экспорт"
      );
    }
  };

  const handleDownload = () => {
    if (downloadUrl) {
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${cameraName}_export_${exportId}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const isFormValid = startDate && endDate && startTime && endTime;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileVideo className="size-5" />
            Экспорт видео
          </DialogTitle>
          <DialogDescription>
            Камера: {cameraName}
          </DialogDescription>
        </DialogHeader>

        {status === "idle" && (
          <div className="space-y-4">
            {/* Date Range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start-date">Начало</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-date">Конец</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>

            {/* Format */}
            <div className="space-y-2">
              <Label>Формат</Label>
              <Select
                value={format}
                onValueChange={(v) => setFormat(v as "mp4" | "avi")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mp4">MP4</SelectItem>
                  <SelectItem value="avi">AVI</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Options */}
            <div className="space-y-3">
              <Label>Опции</Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="add-timestamp"
                  checked={addTimestamp}
                  onCheckedChange={(checked) =>
                    setAddTimestamp(checked === true)
                  }
                />
                <Label htmlFor="add-timestamp" className="font-normal cursor-pointer">
                  <Clock className="size-3.5 text-muted-foreground" />
                  Добавить временные метки
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="add-watermark"
                  checked={addWatermark}
                  onCheckedChange={(checked) =>
                    setAddWatermark(checked === true)
                  }
                />
                <Label htmlFor="add-watermark" className="font-normal cursor-pointer">
                  <FileVideo className="size-3.5 text-muted-foreground" />
                  Водяной знак с именем камеры
                </Label>
              </div>
            </div>
          </div>
        )}

        {status === "processing" && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3">
              <Loader2 className="size-5 animate-spin text-primary" />
              <div className="flex-1">
                <p className="text-sm font-medium">Экспорт видео...</p>
                <p className="text-xs text-muted-foreground">
                  {progressMessage}
                </p>
              </div>
              <span className="text-sm font-medium tabular-nums">
                {Math.round(progress)}%
              </span>
            </div>
            <Progress value={progress} />
          </div>
        )}

        {status === "completed" && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="size-6 text-green-500" />
              <div>
                <p className="text-sm font-medium">Экспорт завершён</p>
                <p className="text-xs text-muted-foreground">
                  Файл готов к скачиванию
                </p>
              </div>
            </div>
            <Button onClick={handleDownload} className="w-full gap-2">
              <Download className="size-4" />
              Скачать {format.toUpperCase()}
            </Button>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="size-6 text-destructive" />
              <div>
                <p className="text-sm font-medium">Ошибка экспорта</p>
                <p className="text-xs text-muted-foreground">{error}</p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => setStatus("idle")}
              className="w-full"
            >
              Попробовать снова
            </Button>
          </div>
        )}

        {status === "idle" && (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Отмена
            </Button>
            <Button
              onClick={handleExport}
              disabled={!isFormValid}
              className={cn("gap-2")}
            >
              <Download className="size-4" />
              Экспортировать
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
