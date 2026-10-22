import { useEffect, useState } from 'react';
import { supabase } from './services/supabaseClient';

type Delivery = { id: number; source_type: string; source_id: string; status: string; tweet_id: string | null; last_error: string | null };

export default function XPublishingStatus() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    const load = async () => {
      try {
        const [settings, recent] = await Promise.all([
          client.from('x_publishing_settings').select('enabled').eq('id', true).single(),
          client.from('x_publications').select('id,source_type,source_id,status,tweet_id,last_error').order('id', { ascending: false }).limit(10),
        ]);
        if (settings.error) throw settings.error;
        if (recent.error) throw recent.error;
        if (active) { setEnabled(settings.data.enabled); setDeliveries(recent.data); setError(''); }
      } catch (cause) {
        console.error('Could not load X publishing status', cause);
        if (active) setError('Could not check X publishing status. Retry before assuming a tweet was sent.');
      }
    };
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [retry]);
  return <details className="x-publishing-status">
    <summary>X publishing: {enabled === null ? 'checking connection' : enabled ? 'enabled' : 'not connected'}</summary>
    <p>Only first publications are eligible. Edits, mirrored posts, and weekly player boards do not send extra tweets.</p>
    {enabled === false && <p>Connect the GameWire X account before enabling. Posts published while disconnected are not queued for later.</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></p>}
    <ul>{deliveries.map((delivery) => <li key={delivery.id}>
      <a href={delivery.source_type === 'angle' ? `#analyst-desk/story/${delivery.source_id}` : `#livewire/post/${delivery.source_id}`}>View source</a>
      {' - '}{delivery.status}{delivery.last_error ? `: ${delivery.last_error}` : ''}
      {delivery.tweet_id && <> - <a href={`https://x.com/i/web/status/${delivery.tweet_id}`} target="_blank" rel="noopener noreferrer">View tweet</a></>}
    </li>)}</ul>
    <p>Failed or uncertain sends are not automatically reposted. Check the X account before manually posting again. Deleting a GameWire post does not delete a tweet already sent.</p>
  </details>;
}
