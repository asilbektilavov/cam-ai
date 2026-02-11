/**
 * Occupancy Tracker Service
 *
 * Tracks door-based in/out people crossings per camera.
 * Maintains totalIn, totalOut, and a circular buffer of crossing events
 * to calculate real-time occupancy and hourly/daily statistics.
 */

const MAX_EVENTS_PER_CAMERA = 5000;

export type CrossingDirection = 'in' | 'out';

interface CrossingEvent {
  direction: CrossingDirection;
  timestamp: Date;
}

interface OccupancyState {
  totalIn: number;
  totalOut: number;
  events: CrossingEvent[];
}

interface HourlyCrossingStat {
  hour: number;
  in: number;
  out: number;
}

interface DailyCrossingStat {
  date: string;
  in: number;
  out: number;
}

class OccupancyTracker {
  private static instance: OccupancyTracker;
  private states = new Map<string, OccupancyState>();

  static getInstance(): OccupancyTracker {
    if (!OccupancyTracker.instance) {
      OccupancyTracker.instance = new OccupancyTracker();
    }
    return OccupancyTracker.instance;
  }

  recordCrossing(cameraId: string, direction: CrossingDirection, timestamp?: Date): void {
    let state = this.states.get(cameraId);
    if (!state) {
      state = { totalIn: 0, totalOut: 0, events: [] };
      this.states.set(cameraId, state);
    }

    if (direction === 'in') {
      state.totalIn++;
    } else {
      state.totalOut++;
    }

    state.events.push({ direction, timestamp: timestamp ?? new Date() });

    // Circular buffer
    if (state.events.length > MAX_EVENTS_PER_CAMERA) {
      state.events.shift();
    }
  }

  getOccupancy(cameraId: string): { currentOccupancy: number; totalIn: number; totalOut: number } {
    const state = this.states.get(cameraId);
    if (!state) {
      return { currentOccupancy: 0, totalIn: 0, totalOut: 0 };
    }
    return {
      currentOccupancy: Math.max(0, state.totalIn - state.totalOut),
      totalIn: state.totalIn,
      totalOut: state.totalOut,
    };
  }

  getHourlyCrossings(cameraId: string, date: string): HourlyCrossingStat[] {
    const state = this.states.get(cameraId);
    const targetDateStr = date; // YYYY-MM-DD

    const buckets: HourlyCrossingStat[] = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      in: 0,
      out: 0,
    }));

    if (!state) return buckets;

    for (const event of state.events) {
      const eventDate = event.timestamp.toISOString().slice(0, 10);
      if (eventDate === targetDateStr) {
        const hour = event.timestamp.getHours();
        if (event.direction === 'in') {
          buckets[hour].in++;
        } else {
          buckets[hour].out++;
        }
      }
    }

    return buckets;
  }

  getDailyCrossings(cameraId: string, days: number): DailyCrossingStat[] {
    const state = this.states.get(cameraId);
    const now = new Date();
    const stats: DailyCrossingStat[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      stats.push({ date: dateStr, in: 0, out: 0 });
    }

    if (!state) return stats;

    const dateMap = new Map<string, DailyCrossingStat>();
    for (const s of stats) {
      dateMap.set(s.date, s);
    }

    for (const event of state.events) {
      const eventDate = event.timestamp.toISOString().slice(0, 10);
      const bucket = dateMap.get(eventDate);
      if (bucket) {
        if (event.direction === 'in') {
          bucket.in++;
        } else {
          bucket.out++;
        }
      }
    }

    return stats;
  }

  resetDay(cameraId: string): void {
    const state = this.states.get(cameraId);
    if (state) {
      state.totalIn = 0;
      state.totalOut = 0;
      state.events = [];
    }
  }

  getCameraIds(): string[] {
    return Array.from(this.states.keys());
  }
}

const globalForOccupancy = globalThis as unknown as {
  occupancyTracker: OccupancyTracker | undefined;
};

export const occupancyTracker =
  globalForOccupancy.occupancyTracker ?? OccupancyTracker.getInstance();

if (process.env.NODE_ENV !== 'production')
  globalForOccupancy.occupancyTracker = occupancyTracker;
