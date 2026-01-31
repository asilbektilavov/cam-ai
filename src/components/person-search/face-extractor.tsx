'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FaceExtractorProps {
  onExtracted: (data: {
    photoBase64: string;
    descriptor: number[];
  }) => void;
}

export function FaceExtractor({ onExtracted }: FaceExtractorProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const processImage = useCallback(async (file: File) => {
    setStatus('loading');
    setError('');

    try {
      // Read file as base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setPreview(base64);

      // Load image into canvas
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = base64;
      });

      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Canvas not available');

      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context not available');
      ctx.drawImage(img, 0, 0);

      // Load face-api
      const faceapi = await import('@vladmandic/face-api');

      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);

      // Detect face
      const detection = await faceapi
        .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (!detection) {
        setStatus('error');
        setError('Лицо не обнаружено. Загрузите чёткое фото с лицом.');
        return;
      }

      // Draw face rectangle on preview
      const { x, y, width, height } = detection.detection.box;
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, width, height);
      setPreview(canvas.toDataURL('image/jpeg'));

      const descriptor = Array.from(detection.descriptor);

      onExtracted({ photoBase64: base64, descriptor });
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Ошибка обработки изображения');
    }
  }, [onExtracted]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImage(file);
    }
  };

  return (
    <div className="space-y-3">
      <canvas ref={canvasRef} className="hidden" />

      {preview ? (
        <div className="relative rounded-lg overflow-hidden border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Preview" className="w-full max-h-48 object-contain bg-black" />
          {status === 'success' && (
            <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-green-500/90 px-2 py-0.5">
              <CheckCircle2 className="h-3 w-3 text-white" />
              <span className="text-[10px] text-white font-bold">Лицо найдено</span>
            </div>
          )}
          {status === 'loading' && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
          )}
        </div>
      ) : (
        <div
          className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Нажмите для загрузки фото</p>
          <p className="text-xs text-muted-foreground mt-1">JPG, PNG до 5 МБ</p>
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={handleFileChange}
      />

      {preview && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setPreview(null);
            setStatus('idle');
            setError('');
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        >
          Загрузить другое фото
        </Button>
      )}
    </div>
  );
}
