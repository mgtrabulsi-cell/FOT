import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function recoveryPermitted(report, runs, now = Date.now()) {
  return report.recoveryAllowed === true && !report.ok
    && !runs.some(run => ['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(run.status))
    && !runs.some(run => run.event === 'workflow_dispatch' && run.actor?.login === 'github-actions[bot]'
      && now - Date.parse(run.created_at) < 6 * 3600000);
}

export async function recoverSite(report, api, now = Date.now()) {
  let recovery = 'No redeploy: only confirmed missing application assets are repairable automatically.';
  if (report.recoveryAllowed && !report.ok) {
    const runs = await api('GET', '/actions/workflows/deploy.yml/runs?per_page=50');
    if (recoveryPermitted(report, runs.workflow_runs, now)) {
      await api('POST', '/actions/workflows/deploy.yml/dispatches', { ref: 'main' });
      recovery = 'Requested a tested redeployment of main; at most once per six hours.';
    } else recovery = 'Redeployment deferred: another deployment is active or an automatic attempt occurred within six hours.';
  }
  const marker = '<!-- gamewire-availability-monitor -->';
  const title = '[Availability] GameWire automatic incident';
  const issues = await api('GET', '/issues?state=open&per_page=100');
  const incident = issues.find(issue => !issue.pull_request && issue.title === title && issue.body?.startsWith(marker));
  const body = `${marker}\nCheck: ${report.checkedAt}\n\nHomepage/assets: ${report.static.ok ? 'healthy' : 'failed'}\nBrowser startup and cached reload: ${report.browser.ok ? 'healthy' : 'failed'}\nUncaught browser errors: ${report.runtimeErrorCount ?? 0}\n\n${recovery}\n\nDetailed diagnostic report is attached to the availability workflow run. GitHub schedules may be delayed; this is not an uptime guarantee.`;
  if (report.ok) {
    if (incident) await api('PATCH', `/issues/${incident.number}`, { state: 'closed', state_reason: 'completed',
      body: `${body}\n\nRecovered: both static and browser checks passed.` });
  } else if (incident) await api('PATCH', `/issues/${incident.number}`, { body });
  else await api('POST', '/issues', { title, body });
  return recovery;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) throw new Error('Availability automation GitHub configuration is missing');
  const report = JSON.parse(await readFile('site-health-report.json', 'utf8'));
  const api = async (method, path, body) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Availability automation ${method} ${path.split('?')[0]} failed (HTTP ${response.status})`);
    return response.status === 204 ? null : response.json();
  };
  console.log(await recoverSite(report, api));
}
