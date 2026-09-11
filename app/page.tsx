import { AppShell } from '@/components/app-shell';
import { AutonomousDashboard } from '@/components/autonomous-dashboard-v4';
import { getAutonomousOverview } from '@/lib/autonomous-data';

export default async function Home() {
  const autonomous = await getAutonomousOverview();
  return <AppShell active="Overview"><div className="content">
    <div className="eyebrow">Product Demand Intelligence</div>
    <h1>Discover what people need before you decide what to build.</h1>
    <p className="lead">Soln-Agent does not ask you to choose a market. It searches public conversations with an open mind, follows unexpected pain signals, finds repeated patterns and turns the strongest evidence into ranked product opportunities.</p>
    <AutonomousDashboard initialRuns={autonomous.runs as any} initialTopics={autonomous.topics as any} />
  </div></AppShell>;
}
