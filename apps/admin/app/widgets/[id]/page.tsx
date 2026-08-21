// Wizard shell. Loads everything once, renders the stepper, and hands the data
// to the step that is showing. Steps are reachable in any order — the stepper is
// a map, not a cage — but the launch step refuses to go live until the hard
// blockers are gone.
import Link from 'next/link';
import { query } from '@/lib/db';
import { basePathUrl } from '@/lib/base-path';
import { loadAdvertisers, loadSources, loadTargeting, loadWidget, readiness, stepBySlug, STEPS } from '@/lib/wizard';
import type { BrowserParams } from '@/app/_components/product-browser';
import StepType from './step-type';
import StepAdvertisers from './step-advertisers';
import StepSources from './step-sources';
import StepPricing from './step-pricing';
import StepDesign from './step-design';
import StepTargeting from './step-targeting';
import StepLaunch from './step-launch';

export const dynamic = 'force-dynamic';

export default async function WidgetWizard({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<BrowserParams & { step?: string; error?: string; ok?: string; pick?: string; code?: string; kv?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const step = stepBySlug(sp.step);

  const w = await loadWidget(id);
  if (!w) return <h1>Widget ikke fundet</h1>;

  const [advertisers, sources, targeting, feedIssueRows] = await Promise.all([
    loadAdvertisers(id),
    loadSources(id),
    loadTargeting(id),
    query<{ demo: boolean; name: string; status: string; type: string }>(
      `select f.source_url like '%/api/demo-feed%' as demo, f.name, f.status, f.type
       from instance_source s join feed f on f.id = s.feed_id where s.instance_id = $1`,
      [id],
    ),
  ]);
  const feedIssues = {
    demo: feedIssueRows.some((r) => r.demo),
    unhealthy: feedIssueRows.filter((r) => r.type !== 'manual' && r.status !== 'healthy').map((r) => r.name),
  };
  const blockers = readiness(w, advertisers, sources, targeting, feedIssues);

  return (
    <>
      <h1>
        {w.name} <span className={`status ${w.status}`}>{w.status}</span>
      </h1>
      <p className="muted">
        <Link href="/widgets">← Alle widgets</Link> · {w.domain} ·{' '}
        {w.widget_type === 'takeover' ? 'takeover' : 'produkt-matching'}
        {w.mode === 'shared' ? ` · delt mellem ${advertisers.length} annoncører` : ''}
        {w.placement_code ? <> · <code>{w.placement_code}</code></> : ''}
      </p>

      <nav className="steps">
        {STEPS.map((s) => (
          <a key={s.slug} className={s.slug === step.slug ? 'on' : w.wizard_step >= s.n ? 'done' : ''}
             href={basePathUrl(`/widgets/${id}?step=${s.slug}`)}>
            <span className="n"><span>{s.n}</span></span>{s.title}
          </a>
        ))}
      </nav>

      {sp.error && <p className="bad">{sp.error}</p>}
      {sp.ok && <p className="ok">{sp.ok}</p>}

      {step.slug === 'type' && <StepType w={w} />}
      {step.slug === 'advertisers' && <StepAdvertisers w={w} advertisers={advertisers} />}
      {step.slug === 'sources' && <StepSources w={w} sources={sources} advertisers={advertisers} feedIssues={feedIssues} />}
      {step.slug === 'pricing' && <StepPricing w={w} advertisers={advertisers} sources={sources} />}
      {step.slug === 'design' && <StepDesign w={w} sp={sp} />}
      {step.slug === 'targeting' && <StepTargeting w={w} sources={sources} targeting={targeting} sp={sp} />}
      {step.slug === 'launch' && <StepLaunch w={w} blockers={blockers} targeting={targeting} advertisers={advertisers} sources={sources} />}
    </>
  );
}
