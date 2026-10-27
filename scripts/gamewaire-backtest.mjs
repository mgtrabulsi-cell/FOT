import { readFileSync } from 'node:fs';
import { readSettings, replayBacktest } from '../supabase/functions/_shared/gamewaire.ts';

if (!process.argv[2]) throw new Error('Provide a JSON file containing { sport, settings, cases } with archived pre-event odds/data and outcomes. Never use current data for a historical prediction.');
const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!['NFL', 'NBA'].includes(input.sport) || !Array.isArray(input.cases)) throw new Error('Invalid historical replay input.');
console.log(JSON.stringify(replayBacktest(input.cases, readSettings(input.settings, input.sport)), null, 2));
