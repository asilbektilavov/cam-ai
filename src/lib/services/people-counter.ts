/**
 * People Counter Service
 *
 * Tracks people count per camera over time using an in-memory circular buffer.
 * Provides current count, hourly stats, and daily stats.
 */

const MAX_READINGS_PER_CAMERA = 1000;

interface CountReading {
  count: number;
  timestamp: Date;
}

interface HourlyStat {
  hour: number;
  avgCount: number;
  maxCount: number;
}

interface DailyStat {
  date: string;
  totalIn: number;
  totalOut: number;
  maxCount: number;
}

class PeopleCounter {
  private static instance: PeopleCounter;
  /** Circular buffer of readings per camera */
  private readings = new Map<string, CountReading[]>();
  /** Most recent count per camera for quick access */
  private currentCounts = new Map<string, number>();

  static getInstance(): PeopleCounter {
    if (!PeopleCounter.instance) {
      PeopleCounter.instance = new PeopleCounter();
    }
    return PeopleCounter.instance;
  }

  /**
   * Record a people count reading for a camera.
   */
  recordCount(cameraId: string, count: number, timestamp?: Date): void {
    const ts = timestamp || new Date();
    const reading: CountReading = { count, timestamp: ts };

    let buffer = this.readings.get(cameraId);
    if (!buffer) {
      buffer = [];
      this.readings.set(cameraId, buffer);
    }

    buffer.push(reading);

    // Circular buffer: remove oldest when exceeding max
    if (buffer.length > MAX_READINGS_PER_CAMERA) {
      buffer.shift();
    }

    // Update current count
    this.currentCounts.set(cameraId, count);
  }

  /**
   * Get the most recent people count for a camera.
   */
  getCurrentCount(cameraId: string): number {
    return this.currentCounts.get(cameraId) ?? 0;
  }

  /**
   * Get hourly statistics for a camera on a given date.
   * Returns an array of 24 entries (one per hour) with avgCount and maxCount.
   *
   * @param cameraId - Camera ID
   * @param date - Date string in "YYYY-MM-DD" format
   */
  getHourlyStats(cameraId: string, date: string): HourlyStat[] {
    const buffer = this.readings.get(cameraId) || [];
    const targetDate = new Date(date + 'T00:00:00');
    const targetDateStr = targetDate.toISOString().slice(0, 10);

    // Initialize 24-hour buckets
    const buckets: { counts: number[] }[] = Array.from({ length: 24 }, () => ({
      counts: [],
    }));

    for (const reading of buffer) {
      const readingDate = reading.timestamp.toISOString().slice(0, 10);
      if (readingDate === targetDateStr) {
        const hour = reading.timestamp.getHours();
        buckets[hour].counts.push(reading.count);
      }
    }

    return buckets.map((bucket, hour) => {
      if (bucket.counts.length === 0) {
        return { hour, avgCount: 0, maxCount: 0 };
      }

      const sum = bucket.counts.reduce((a, b) => a + b, 0);
      const avg = Math.round(sum / bucket.counts.length);
      const max = Math.max(...bucket.counts);

      return { hour, avgCount: avg, maxCount: max };
    });
  }

  /**
   * Get daily statistics for a camera over the last N days.
   *
   * @param cameraId - Camera ID
   * @param days - Number of days to include (from today going back)
   */
  getDailyStats(cameraId: string, days: number): DailyStat[] {
    const buffer = this.readings.get(cameraId) || [];
    const now = new Date();
    const stats: DailyStat[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().slice(0, 10);

      // Find all readings for this day
      const dayReadings = buffer.filter(
        (r) => r.timestamp.toISOString().slice(0, 10) === dateStr
      );

      if (dayReadings.length === 0) {
        stats.push({ date: dateStr, totalIn: 0, totalOut: 0, maxCount: 0 });
        continue;
      }

      const maxCount = Math.max(...dayReadings.map((r) => r.count));

      // Estimate totalIn/totalOut from count changes
      let totalIn = 0;
      let totalOut = 0;

      for (let j = 1; j < dayReadings.length; j++) {
        const diff = dayReadings[j].count - dayReadings[j - 1].count;
        if (diff > 0) {
          totalIn += diff;
        } else if (diff < 0) {
          totalOut += Math.abs(diff);
        }
      }

      // If only one reading, use the count as totalIn
      if (dayReadings.length === 1 && dayReadings[0].count > 0) {
        totalIn = dayReadings[0].count;
      }

      stats.push({ date: dateStr, totalIn, totalOut, maxCount });
    }

    return stats;
  }

  /**
   * Get the total number of readings stored for a camera.
   */
  getReadingsCount(cameraId: string): number {
    return this.readings.get(cameraId)?.length ?? 0;
  }

  /**
   * Clear all readings for a camera.
   */
  reset(cameraId: string): void {
    this.readings.delete(cameraId);
    this.currentCounts.delete(cameraId);
  }

  /**
   * Get all camera IDs that have counter data.
   */
  getCameraIds(): string[] {
    return Array.from(this.readings.keys());
  }
}

const globalForPeopleCounter = globalThis as unknown as {
  peopleCounter: PeopleCounter | undefined;
};

export const peopleCounter =
  globalForPeopleCounter.peopleCounter ?? PeopleCounter.getInstance();

if (process.env.NODE_ENV !== 'production')
  globalForPeopleCounter.peopleCounter = peopleCounter;
