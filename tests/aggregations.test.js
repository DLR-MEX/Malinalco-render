import { describe, it, expect } from 'vitest';
import { computeAggregations } from '../src/reports/aggregations.js';

// Construye [tsMs, val] a partir de una fecha local concreta.
function pt(y, mo, d, h, mi, val) {
  return [new Date(y, mo - 1, d, h, mi, 0, 0).getTime(), val];
}

describe('computeAggregations', () => {
  it('devuelve estructura vacia sin datos', () => {
    const agg = computeAggregations([], 20, 30);
    expect(agg.samples).toBe(0);
    expect(agg.heatmap).toBeNull();
    expect(agg.daily).toEqual([]);
  });

  it('promedia los sensores por minuto (1 serie interior)', () => {
    // Dos sensores en el mismo minuto: 22 y 28 -> promedio 25.
    const series = [
      { var: 's1', data: [pt(2026, 6, 18, 10, 0, 22)] },
      { var: 's2', data: [pt(2026, 6, 18, 10, 0, 28)] },
    ];
    const agg = computeAggregations(series, 20, 30);
    expect(agg.samples).toBe(1);
    expect(agg.overall.avg).toBe(25);
    expect(agg.daily).toHaveLength(1);
    expect(agg.daily[0].avg).toBe(25);
    expect(agg.daily[0].in_range_pct).toBe(100); // 25 dentro de 20-30
  });

  it('calcula % en rango, picos y dia mas alto/bajo', () => {
    const series = [{
      var: 's1',
      data: [
        pt(2026, 6, 18, 8, 0, 18),   // fuera (bajo)
        pt(2026, 6, 18, 14, 0, 35),  // fuera (alto) + pico caliente
        pt(2026, 6, 19, 9, 0, 25),   // dentro
        pt(2026, 6, 19, 15, 0, 26),  // dentro
      ],
    }];
    const agg = computeAggregations(series, 20, 30);
    expect(agg.samples).toBe(4);
    expect(agg.daily).toHaveLength(2);
    expect(agg.peaks.hottest.value).toBe(35);
    expect(agg.peaks.coldest.value).toBe(18);
    // dia 18: avg (18+35)/2=26.5 ; dia 19: avg 25.5 -> mas alto = 18, mas bajo = 19
    expect(agg.overall.hottest_day.avg).toBe(26.5);
    expect(agg.overall.coldest_day.avg).toBe(25.5);
    // dia 19 estuvo 100% en rango; dia 18, 0%.
    const d19 = agg.daily.find((d) => d.date === '2026-06-19');
    expect(d19.in_range_pct).toBe(100);
  });

  it('arma el heatmap dia x hora (24 columnas)', () => {
    const series = [{ var: 's1', data: [pt(2026, 6, 18, 10, 0, 25), pt(2026, 6, 18, 11, 0, 27)] }];
    const agg = computeAggregations(series, 20, 30);
    expect(agg.heatmap.days).toHaveLength(1);
    expect(agg.heatmap.values[0]).toHaveLength(24);
    expect(agg.heatmap.values[0][10]).toBe(25);
    expect(agg.heatmap.values[0][11]).toBe(27);
    expect(agg.heatmap.values[0][0]).toBeNull();
  });
});
