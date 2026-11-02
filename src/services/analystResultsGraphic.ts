import { angleSportRecords } from './theAngle';
import type { Angle } from './theAngle';
import { renderResultsGraphic } from './gamewaireResultsGraphic';
import type { RecordGraphicSection } from './gamewaireResultsGraphic';

export function analystResultsSections(rows: Angle[]): RecordGraphicSection[] {
  const records = angleSportRecords(rows, 'straight');
  const best = records.filter(row => row.key !== 'COMBO' && row.wins + row.losses >= 5)
    .sort((a, b) => b.wins / (b.wins + b.losses) - a.wins / (a.wins + a.losses)
      || b.wins - a.wins || a.label.localeCompare(b.label)).slice(0, 3);
  const section = (title: string, wins: number, losses: number): RecordGraphicSection =>
    ({ title, wins, losses, hitRate: wins + losses ? wins / (wins + losses) : null, pending: 0, pushes: 0, voids: 0 });
  return [section('ALL STRAIGHTS', records.reduce((sum, row) => sum + row.wins, 0), records.reduce((sum, row) => sum + row.losses, 0)),
    ...best.map((row, index) => section(`#${index + 1} SPORT / ${row.label.toUpperCase()}`, row.wins, row.losses))];
}
export function renderAnalystResultsGraphic(rows: Angle[], now = new Date()) {
  return renderResultsGraphic([], now, { sections: analystResultsSections(rows) });
}
