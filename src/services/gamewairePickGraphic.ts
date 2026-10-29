import { pickBlurb, probabilityGrade } from '../../supabase/functions/_shared/gamewaire.ts';
import { bestBetLabels } from './gamewaireOrder';
import type { publishedSelections } from './gamewaireOrder';
import { gamewaireMarketLabels, gamewairePickTitle } from './gamewairePresentation';

type InstagramEdition = { sport: 'NBA' | 'NFL'; date: string };
type GraphicPick = ReturnType<typeof publishedSelections>[number] & { instagramTopRank?: number | null; instagramLeanRank?: number | null };
export async function renderGamewairePickGraphics(picks: GraphicPick[], instagram?: InstagramEdition): Promise<File[]> {
  if (!picks.length || picks.length > (instagram ? 6 : 5)) throw new Error(instagram ? 'Choose one to six published selections for the Instagram carousel.' : 'Choose one to five published selections for the pick graphics.');
  if (instagram && (!/^\d{4}-\d{2}-\d{2}$/.test(instagram.date) || picks.some((pick) => pick.sport !== instagram.sport)))
    throw new Error('Choose a valid game date and one sport for the Instagram carousel.');
  const fonts = ['700 42px Oswald', '600 30px "DM Sans"', '400 26px "DM Sans"'];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const loaded = await Promise.race([Promise.all(fonts.map((font) => document.fonts.load(font))), new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('GameWire fonts timed out. Retry creating the pick graphics.')), 15_000);
  })]).finally(() => clearTimeout(timeout));
  if (loaded.some((faces) => !faces.length) || fonts.some((font) => !document.fonts.check(font))) throw new Error('GameWire fonts could not load. Reconnect and retry creating the pick graphics.');
  const best = bestBetLabels(picks), files: File[] = [];
  const step = instagram ? 1 : 2;
  const reasonFont = instagram ? '400 32px "DM Sans"' : '400 26px "DM Sans"';
  const reasonLineHeight = instagram ? 46 : 38;
  for (let offset = 0; offset < picks.length; offset += step) {
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
    const cards = picks.slice(offset, offset + step).map((pick, index) => {
      const title = wrap(gamewairePickTitle(pick), '700 42px Oswald', 884);
      const matchup = wrap(`${pick.away} @ ${pick.home}`, '400 26px "DM Sans"', 884);
      const reason = wrap(pickBlurb(pick), reasonFont, 840);
      return { pick, rank: offset + index + 1, title, matchup, reason, height: 330 + title.length * 52 + matchup.length * 36 + reason.length * reasonLineHeight };
    });
    const header = instagram ? 216 : 104;
    const pages = instagram ? (() => {
      const card = cards[0];
      const capacity = Math.floor((1350 - header - 80 - (card.height - card.reason.length * reasonLineHeight)) / reasonLineHeight);
      if (capacity < 3) throw new Error('The pick title or matchup is too long for a readable Instagram slide.');
      const result = [];
      for (let start = 0; start < card.reason.length; start += capacity) {
        const reason = card.reason.slice(start, start + capacity);
        result.push([{ ...card, reason, continued: start > 0, height: 330 + card.title.length * 52 + card.matchup.length * 36 + reason.length * reasonLineHeight }]);
      }
      return result;
    })() : [cards.map((card) => ({ ...card, continued: false }))];
    for (const page of pages) {
      canvas.width = 1080; canvas.height = instagram ? 1350 : 156 + page.reduce((sum, card) => sum + card.height + 28, 0);
      if (canvas.height > 6000) throw new Error('The pick reasoning is too long for a readable graphic. Create a post with fewer selections.');
      ctx.fillStyle = '#0c1523'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const text = (value: string, x: number, y: number, font: string, color = '#e5eaf3') => {
        ctx.font = font; ctx.fillStyle = color; ctx.fillText(value, x, y);
      };
      const brand = (x: number, y: number) => {
        text('Gamew', x, y, '700 36px Oswald'); const ai = x + ctx.measureText('Gamew').width;
        text('AI', ai, y, '700 36px Oswald', '#ff5965');
        text('re', ai + ctx.measureText('AI').width, y, '700 36px Oswald');
        return ai + ctx.measureText('AI').width + ctx.measureText('re').width;
      };
      if (instagram) {
        ctx.fillStyle = '#ff5965'; ctx.fillRect(52, 38, 72, 6);
        const brandEnd = brand(52, 97);
        text("'s BEST BETS", brandEnd + 2, 97, '700 36px Oswald');
        text(`${instagram.sport} / ${Number(instagram.date.slice(5, 7))}/${Number(instagram.date.slice(8))} / ${instagram.date.slice(0, 4)}`, 52, 151, '600 30px "DM Sans"', '#ffc0c6');
        text(`PUBLISHED TOP 3 PICKS + TOP 3 GAME LEANS / SLIDE ${files.length + 1}`, 52, 188, '400 24px "DM Sans"', '#b6c6db');
      } else text('GAMEWIRE / PUBLISHED PICKS', 52, 65, '600 26px "DM Sans"', '#b6c6db');
      let y = header;
      for (const card of page) {
        const { pick } = card, label = best.get(pick.key);
        const gradient = ctx.createLinearGradient(52, y, 1028, y + card.height);
        gradient.addColorStop(0, label ? '#34202e' : '#0e1929'); gradient.addColorStop(1, '#0e1929');
        ctx.beginPath(); ctx.roundRect(52, y, 976, card.height, 12); ctx.fillStyle = gradient; ctx.fill();
        ctx.strokeStyle = label ? '#b94a59' : '#263b55'; ctx.lineWidth = 2; ctx.stroke();
        if (label) { ctx.fillStyle = '#ff5965'; ctx.fillRect(52, y + 12, 4, card.height - 24); }
        brand(84, y + 55);
        text(label ? `BEST BET / #1 ${label}` : `#${String(card.rank).padStart(2, '0')} ${pick.isGameLean || instagram && pick.instagramTopRank === null ? 'Game Lean' : 'Top Pick'}`, 290, y + 52, '600 26px "DM Sans"', '#ffc0c6');
        ctx.strokeStyle = '#753443'; ctx.beginPath(); ctx.moveTo(84, y + 78); ctx.lineTo(996, y + 78); ctx.stroke();
        const topRank = pick.instagramTopRank === undefined ? !pick.isGameLean ? picks.filter((row) => !row.isGameLean).findIndex((row) => row.key === pick.key) + 1 : null : pick.instagramTopRank;
        const leanRank = pick.instagramLeanRank === undefined ? pick.isGameLean || pick.isPublishedLean ? picks.filter((row) => row.isGameLean || row.isPublishedLean).findIndex((row) => row.key === pick.key) + 1 : null : pick.instagramLeanRank;
        const categoryRank = instagram ? [
          topRank ? `TOP PICK #${topRank}` : '',
          leanRank ? `GAME LEAN #${leanRank}` : '',
        ].filter(Boolean).join(' + ') : `#${String(card.rank).padStart(2, '0')} / ${pick.sport}`;
        text(`${categoryRank} / ${gamewaireMarketLabels[pick.market] ?? pick.market}${card.continued ? ' / CONTINUED' : ''}`, 84, y + 120, '400 26px "DM Sans"', '#a7b9d1');
        let rowY = y + 177;
        card.title.forEach((line) => { text(line, 84, rowY, '700 42px Oswald'); rowY += 52; });
        card.matchup.forEach((line) => { text(line, 84, rowY, '400 26px "DM Sans"', '#a7b9d1'); rowY += 36; });
        const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(pick.start));
        text(`${date} ET`, 84, rowY, '400 26px "DM Sans"', '#a7b9d1'); rowY += 44;
        text(`${pick.american > 0 ? '+' : ''}${pick.american} / ${pick.book}`, 84, rowY, '600 30px "DM Sans"');
        text(`Probability grade ${probabilityGrade(pick.probability)}`, 608, rowY, '600 26px "DM Sans"', pick.probability >= 0.5 ? '#86d9ad' : '#b6c6db');
        rowY += 42;
        text('Saved analysis / Unvalidated estimate / No guaranteed outcome', 84, rowY, '400 24px "DM Sans"', '#b6c6db'); rowY += 24;
        ctx.fillStyle = '#080808'; ctx.fillRect(84, rowY, 912, card.reason.length * reasonLineHeight + 32);
        rowY += 35;
        card.reason.forEach((line) => { text(line, 106, rowY, reasonFont); rowY += reasonLineHeight; });
        y += card.height + 28;
      }
      text('gamewire.us / Lines and prices are saved snapshots', 52, canvas.height - 24, '400 24px "DM Sans"', '#b6c6db');
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value)
        : reject(new Error('Your browser could not export a pick graphic. Retry creating the draft.')), 'image/png'));
      if (blob.size > 5 * 1024 * 1024) throw new Error('The generated pick graphic exceeds the attachment limit. Create a post with fewer picks.');
      if (instagram && files.length >= 20) throw new Error('The full reasoning exceeds 20 Instagram slides. Shorten the published write-ups before retrying.');
      files.push(new File([blob], instagram ? `GamewAIre-Best-Bets-${instagram.sport}-${instagram.date}-${String(files.length + 1).padStart(2, '0')}.png`
        : `GameWire-GamewAIre-Picks-${files.length + 1}.png`, { type: 'image/png' }));
    }
  }
  return files;
}
