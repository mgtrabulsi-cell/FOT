import { pickBlurb, probabilityGrade } from '../../supabase/functions/_shared/gamewaire.ts';
import { bestBetLabels } from './gamewaireOrder';
import type { publishedSelections } from './gamewaireOrder';
import { gamewaireMarketLabels, gamewairePickTitle } from './gamewairePresentation';

export async function renderGamewairePickGraphics(picks: ReturnType<typeof publishedSelections>): Promise<File[]> {
  if (!picks.length || picks.length > 5) throw new Error('Choose one to five published selections for the pick graphics.');
  const fonts = ['700 42px Oswald', '600 30px "DM Sans"', '400 26px "DM Sans"'];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const loaded = await Promise.race([Promise.all(fonts.map((font) => document.fonts.load(font))), new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('GameWire fonts timed out. Retry creating the Angle draft.')), 15_000);
  })]).finally(() => clearTimeout(timeout));
  if (loaded.some((faces) => !faces.length) || fonts.some((font) => !document.fonts.check(font))) throw new Error('GameWire fonts could not load. Reconnect and retry creating the Angle draft.');
  const best = bestBetLabels(picks), files: File[] = [];
  for (let offset = 0; offset < picks.length; offset += 2) {
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser could not create the pick graphics.');
    const wrap = (value: string, font: string, width: number) => {
      ctx.font = font;
      const lines: string[] = [];
      for (const paragraph of value.split('\n\n')) {
        if (lines.length) lines.push('');
        let line = '';
        for (const word of paragraph.split(/\s+/)) {
          if (ctx.measureText(word).width > width) throw new Error('A pick label cannot fit the graphic. Shorten it before retrying.');
          const next = line ? `${line} ${word}` : word;
          if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
        }
        lines.push(line);
      }
      return lines;
    };
    const cards = picks.slice(offset, offset + 2).map((pick, index) => {
      const title = wrap(gamewairePickTitle(pick), '700 42px Oswald', 884);
      const matchup = wrap(`${pick.away} @ ${pick.home}`, '400 26px "DM Sans"', 884);
      const reason = wrap(pickBlurb(pick), '400 26px "DM Sans"', 840);
      return { pick, rank: offset + index + 1, title, matchup, reason, height: 330 + title.length * 52 + matchup.length * 36 + reason.length * 38 };
    });
    canvas.width = 1080; canvas.height = 156 + cards.reduce((sum, card) => sum + card.height + 28, 0);
    if (canvas.height > 6000) throw new Error('The pick reasoning is too long for a readable graphic. Create a post with fewer selections.');
    ctx.fillStyle = '#0c1523'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const text = (value: string, x: number, y: number, font: string, color = '#e5eaf3') => {
      ctx.font = font; ctx.fillStyle = color; ctx.fillText(value, x, y);
    };
    const brand = (x: number, y: number) => {
      text('Gamew', x, y, '700 36px Oswald'); const ai = x + ctx.measureText('Gamew').width;
      text('AI', ai, y, '700 36px Oswald', '#ff5965');
      text('re', ai + ctx.measureText('AI').width, y, '700 36px Oswald');
    };
    text('GAMEWIRE / PUBLISHED PICKS', 52, 65, '600 26px "DM Sans"', '#b6c6db');
    let y = 104;
    for (const card of cards) {
      const { pick } = card, label = best.get(pick.key);
      const gradient = ctx.createLinearGradient(52, y, 1028, y + card.height);
      gradient.addColorStop(0, label ? '#34202e' : '#0e1929'); gradient.addColorStop(1, '#0e1929');
      ctx.beginPath(); ctx.roundRect(52, y, 976, card.height, 12); ctx.fillStyle = gradient; ctx.fill();
      ctx.strokeStyle = label ? '#b94a59' : '#263b55'; ctx.lineWidth = 2; ctx.stroke();
      if (label) { ctx.fillStyle = '#ff5965'; ctx.fillRect(52, y + 12, 4, card.height - 24); }
      brand(84, y + 55);
      text(label ? `BEST BET / #1 ${label}` : `#${String(card.rank).padStart(2, '0')} ${pick.isGameLean ? 'Game Lean' : 'Top Pick'}`, 290, y + 52, '600 26px "DM Sans"', '#ffc0c6');
      ctx.strokeStyle = '#753443'; ctx.beginPath(); ctx.moveTo(84, y + 78); ctx.lineTo(996, y + 78); ctx.stroke();
      text(`#${String(card.rank).padStart(2, '0')} / ${pick.sport} / ${gamewaireMarketLabels[pick.market] ?? pick.market}`, 84, y + 120, '400 26px "DM Sans"', '#a7b9d1');
      let rowY = y + 177;
      card.title.forEach((line) => { text(line, 84, rowY, '700 42px Oswald'); rowY += 52; });
      card.matchup.forEach((line) => { text(line, 84, rowY, '400 26px "DM Sans"', '#a7b9d1'); rowY += 36; });
      const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(pick.start));
      text(`${date} ET`, 84, rowY, '400 26px "DM Sans"', '#a7b9d1'); rowY += 44;
      text(`${pick.american > 0 ? '+' : ''}${pick.american} / ${pick.book}`, 84, rowY, '600 30px "DM Sans"');
      text(`Probability grade ${probabilityGrade(pick.probability)}`, 608, rowY, '600 26px "DM Sans"', pick.probability >= 0.5 ? '#86d9ad' : '#b6c6db');
      rowY += 42;
      text('Saved analysis / Unvalidated estimate / No guaranteed outcome', 84, rowY, '400 24px "DM Sans"', '#b6c6db'); rowY += 24;
      ctx.fillStyle = '#080808'; ctx.fillRect(84, rowY, 912, card.reason.length * 38 + 32);
      rowY += 35;
      card.reason.forEach((line) => { text(line, 106, rowY, '400 26px "DM Sans"'); rowY += 38; });
      y += card.height + 28;
    }
    text('gamewire.us / Lines and prices are saved snapshots', 52, canvas.height - 24, '400 24px "DM Sans"', '#b6c6db');
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value)
      : reject(new Error('Your browser could not export a pick graphic. Retry creating the draft.')), 'image/png'));
    if (blob.size > 5 * 1024 * 1024) throw new Error('The generated pick graphic exceeds the attachment limit. Create a post with fewer picks.');
    files.push(new File([blob], `GameWire-GamewAIre-Picks-${files.length + 1}.png`, { type: 'image/png' }));
  }
  return files;
}
