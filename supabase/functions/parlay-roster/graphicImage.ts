const maxBytes = 5 * 1024 * 1024;
export function espnGraphicImage(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'a.espncdn.com' || url.port || url.username || url.password || url.search || url.hash
    || !/^\/i\/(?:headshots\/(?:nfl|nba|nhl)\/players\/full\/\d+|teamlogos\/(?:nfl|nba|nhl|soccer)\/500\/[a-z0-9_-]+)\.png$/.test(url.pathname))
    throw new Error('Choose a supported ESPN player portrait or team logo.');
  return url.href;
}
export async function graphicImage(value: string, fetcher: typeof fetch, cors: Record<string, string>) {
  let url: string;
  try { url = espnGraphicImage(value); }
  catch { return Response.json({ error: 'Choose a supported ESPN player portrait or team logo.' }, { status: 400, headers: cors }); }
  try {
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(12_000), headers: { Accept: 'image/png' } });
    const type = response.headers.get('content-type')?.split(';')[0].trim();
    if (!response.ok || type !== 'image/png' || Number(response.headers.get('content-length')) > maxBytes || !response.body)
      throw new Error('The selected ESPN image is unavailable or invalid.');
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error('The selected image exceeds the export size limit.');
        chunks.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    if (!size) throw new Error('The selected image is empty.');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if ([137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => bytes[index] !== byte))
      throw new Error('The selected image is not a valid PNG.');
    return new Response(bytes, { headers: { ...cors, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
  } catch (cause) {
    console.error('Graphic image retrieval failed', url, cause);
    return Response.json({ error: 'The selected player photo or team logo could not load. Reconnect and retry, or choose another image.' },
      { status: 502, headers: cors });
  }
}
