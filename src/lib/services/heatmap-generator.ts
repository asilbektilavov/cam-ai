/**
 * Heatmap Generator Service
 *
 * Stores people positions from AI analysis per camera in an in-memory grid.
 * Grid: 20x15 cells, each cell stores a hit count.
 * Provides normalized heatmap data (0-1) for visualization.
 */

const GRID_WIDTH = 20;
const GRID_HEIGHT = 15;

interface HeatmapGrid {
  /** Raw hit counts per cell [row][col] */
  cells: number[][];
  /** Total number of recordPositions calls */
  totalRecordings: number;
  /** Timestamp of the first recording */
  startedAt: number;
}

class HeatmapGenerator {
  private static instance: HeatmapGenerator;
  private grids = new Map<string, HeatmapGrid>();

  static getInstance(): HeatmapGenerator {
    if (!HeatmapGenerator.instance) {
      HeatmapGenerator.instance = new HeatmapGenerator();
    }
    return HeatmapGenerator.instance;
  }

  /**
   * Create an empty grid of zeros.
   */
  private createEmptyGrid(): number[][] {
    return Array.from({ length: GRID_HEIGHT }, () =>
      Array.from({ length: GRID_WIDTH }, () => 0)
    );
  }

  /**
   * Get or create a heatmap grid for a camera.
   */
  private getOrCreateGrid(cameraId: string): HeatmapGrid {
    let grid = this.grids.get(cameraId);
    if (!grid) {
      grid = {
        cells: this.createEmptyGrid(),
        totalRecordings: 0,
        startedAt: Date.now(),
      };
      this.grids.set(cameraId, grid);
    }
    return grid;
  }

  /**
   * Record detected people positions into the heatmap grid.
   * Positions should be normalized coordinates (0-1 range).
   * x: 0 = left, 1 = right
   * y: 0 = top, 1 = bottom
   */
  recordPositions(cameraId: string, positions: { x: number; y: number }[]): void {
    const grid = this.getOrCreateGrid(cameraId);
    grid.totalRecordings++;

    for (const pos of positions) {
      // Clamp to [0, 1)
      const nx = Math.min(Math.max(pos.x, 0), 0.9999);
      const ny = Math.min(Math.max(pos.y, 0), 0.9999);

      const col = Math.floor(nx * GRID_WIDTH);
      const row = Math.floor(ny * GRID_HEIGHT);

      grid.cells[row][col]++;

      // Also apply gaussian-like spread to neighboring cells for smoother heatmap
      const neighbors = [
        [row - 1, col],
        [row + 1, col],
        [row, col - 1],
        [row, col + 1],
      ];

      for (const [nr, nc] of neighbors) {
        if (nr >= 0 && nr < GRID_HEIGHT && nc >= 0 && nc < GRID_WIDTH) {
          grid.cells[nr][nc] += 0.5;
        }
      }
    }
  }

  /**
   * Get normalized heatmap data (0-1 range) for a camera.
   * Returns a 20x15 grid where 0 = no activity, 1 = max activity.
   */
  getHeatmapData(cameraId: string): number[][] {
    const grid = this.grids.get(cameraId);
    if (!grid) {
      return this.createEmptyGrid();
    }

    // Find the maximum value in the grid
    let maxVal = 0;
    for (let row = 0; row < GRID_HEIGHT; row++) {
      for (let col = 0; col < GRID_WIDTH; col++) {
        if (grid.cells[row][col] > maxVal) {
          maxVal = grid.cells[row][col];
        }
      }
    }

    // Normalize: if maxVal is 0, everything is 0
    if (maxVal === 0) {
      return this.createEmptyGrid();
    }

    const normalized: number[][] = Array.from({ length: GRID_HEIGHT }, () =>
      Array.from({ length: GRID_WIDTH }, () => 0)
    );

    for (let row = 0; row < GRID_HEIGHT; row++) {
      for (let col = 0; col < GRID_WIDTH; col++) {
        normalized[row][col] = Math.round((grid.cells[row][col] / maxVal) * 1000) / 1000;
      }
    }

    return normalized;
  }

  /**
   * Get raw (non-normalized) heatmap data for a camera.
   */
  getRawData(cameraId: string): { cells: number[][]; totalRecordings: number; startedAt: number } | null {
    const grid = this.grids.get(cameraId);
    if (!grid) return null;
    return {
      cells: grid.cells.map((row) => [...row]),
      totalRecordings: grid.totalRecordings,
      startedAt: grid.startedAt,
    };
  }

  /**
   * Reset (clear) the heatmap for a camera.
   */
  resetHeatmap(cameraId: string): void {
    this.grids.delete(cameraId);
  }

  /**
   * Check if a camera has any heatmap data.
   */
  hasData(cameraId: string): boolean {
    const grid = this.grids.get(cameraId);
    return !!grid && grid.totalRecordings > 0;
  }

  /**
   * Get all camera IDs that have heatmap data.
   */
  getCameraIds(): string[] {
    return Array.from(this.grids.keys());
  }
}

const globalForHeatmap = globalThis as unknown as {
  heatmapGenerator: HeatmapGenerator | undefined;
};

export const heatmapGenerator =
  globalForHeatmap.heatmapGenerator ?? HeatmapGenerator.getInstance();

if (process.env.NODE_ENV !== 'production')
  globalForHeatmap.heatmapGenerator = heatmapGenerator;
