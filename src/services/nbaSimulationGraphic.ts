import { renderBetGraphic } from './betGraphicStyle';

export type NBAGraphicRow = { title: string; detail: string; line: string; note: string };
export async function renderNBASimulationGraphic(title: string, subtitle: string, rows: NBAGraphicRow[]): Promise<Blob> {
  if (!rows.length) throw new Error('No verified NBA projections or results are available to export.');
  if (rows.length > 200) throw new Error('Choose a smaller NBA slate for this graphic.');
  return renderBetGraphic({
    title: title.startsWith('The Daily Triple') ? 'DAILY TRIPLE' : 'NBA SIM',
    subtitle: `${title} / ${subtitle}`,
    typography: 'brand',
    rows: rows.map(row => ({
      label: title.startsWith('The Daily Triple') ? '' : 'NBA',
      name: row.title, selection: row.line,
      ...(title.startsWith('The Daily Triple') ? {} : { detail: row.detail, note: row.note }),
    })),
    summary: title.startsWith('The Daily Triple') ? 'PROJECTED POINTS + REBOUNDS + ASSISTS' : 'GAMEWAIRE / NBA SIMULATIONS',
    note: 'Experimental estimates / Conditional on playing / Not betting recommendations',
    footerLabel: 'NBA MODEL ESTIMATES',
  });
}
