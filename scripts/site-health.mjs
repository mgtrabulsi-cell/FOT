import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const origin = 'https://gamewire.us/';
export async function deployedAssets(fetcher = fetch) {
  const response = await fetcher(new URL(`sw.js?health=${Date.now()}`, origin), { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Service worker manifest returned HTTP ${response.status}`);
  const source = await response.text();
  const match = source.match(/^self\.GAMEWIRE_OFFLINE = (\{[^\n]+\});/);
  if (!match) throw new Error('Deployed asset manifest is missing');
  const assets = JSON.parse(match[1]).assets;
  if (!Array.isArray(assets)) throw new Error('Deployed asset manifest is invalid');
  return assets.filter(asset => typeof asset === 'string' && /^assets\/[\w-]+\.(?:js|css)$/.test(asset));
}

export async function checkSite({ preserve = false, fetcher = fetch, output = 'dist' } = {}) {
  const response = await fetcher(new URL(`?health=${Date.now()}`, origin), { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Homepage returned HTTP ${response.status}`);
  const html = await response.text();
  if (!html.includes('id="root"')) throw new Error('Homepage is not the GameWire application');
  const assets = await deployedAssets(fetcher);
  const references = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1].replace(/^\.?\//, ''));
  if (!references.some(asset => asset.endsWith('.js'))) throw new Error('Homepage has no application entry');
  for (const asset of new Set([...assets, ...references])) {
    if (!/^assets\/[\w-]+\.(?:js|css)$/.test(asset)) throw new Error(`Unexpected application asset: ${asset}`);
    const result = await fetcher(new URL(asset, origin), { signal: AbortSignal.timeout(30000), cache: 'no-store' });
    if (!result.ok) throw new Error(`${asset} returned HTTP ${result.status}`);
    const type = result.headers.get('content-type') ?? '';
    if (!(asset.endsWith('.js') ? /javascript/ : /text\/css/).test(type)) throw new Error(`${asset} returned an invalid content type`);
    const content = new Uint8Array(await result.arrayBuffer());
    if (!content.length) throw new Error(`${asset} is empty`);
    if (preserve) {
      const file = resolve(output, asset);
      await mkdir(resolve(output, 'assets'), { recursive: true });
      // New build files always take precedence over retained assets.
      await writeFile(file, content, { flag: 'wx' }).catch(error => {
        if (error.code !== 'EEXIST') throw error;
      });
    }
  }
  console.log(`GameWire homepage and ${assets.length} deployed assets verified${preserve ? '; previous build retained' : ''}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkSite({ preserve: process.argv.includes('--preserve') });
}
