import {
  ArrowRight,
  BookOpen,
  ExternalLink,
  Github,
  Landmark,
  ShieldCheck,
  TestTube2,
} from "lucide-react";
import Link from "next/link";

const githubUrl = "https://github.com/hilson946/updown-market";

const docs = [
  {
    title: "Protocol",
    icon: Landmark,
    body: "Each market is an immutable USDC pool. Users choose UP or DOWN, the pool locks after the grace window, and winners share the final pool after fees.",
    items: ["Prediction window anchored by predictionStart", "Betting opens one full interval before predictionStart", "Five-second grace period after predictionStart"],
  },
  {
    title: "Testing",
    icon: TestTube2,
    body: "Local mode uses Anvil, MockUSDC, and a mock TWAP oracle so the complete flow can be tested without real funds.",
    items: ["Connect wallet", "Get test USDC", "Place signed bet", "Set oracle, settle, claim, or refund"],
  },
  {
    title: "Security",
    icon: ShieldCheck,
    body: "The MVP keeps result authority out of the frontend and relayer. Settlement depends on oracle output, and failure modes route funds to refund.",
    items: ["No admin settlement override", "Replay-protected EIP-712 signatures", "Relayer market allowlist", "TWAP adapter for Base deployments"],
  },
];

export default function DocsPage() {
  return (
    <main className="siteShell docsShell">
      <header className="siteNav">
        <Link className="brandMark" href="/">
          <span>UD</span>
          <b>UP/DOWN</b>
        </Link>
        <nav aria-label="Primary">
          <Link href="/app">Launch App</Link>
          <a href={githubUrl} target="_blank" rel="noreferrer">
            <Github size={16} />
            GitHub
          </a>
        </nav>
      </header>

      <section className="docsHero">
        <p className="eyebrow">DOCUMENTATION</p>
        <h1>Protocol Notes</h1>
        <p>
          The app is split into an informational entry point, a wallet-gated trading desk, a local test-funds flow,
          and contract docs for security review.
        </p>
        <div className="heroActions">
          <Link className="primaryCta" href="/app">
            Launch App
            <ArrowRight size={18} />
          </Link>
          <a className="secondaryCta" href={githubUrl} target="_blank" rel="noreferrer">
            GitHub
            <ExternalLink size={18} />
          </a>
        </div>
      </section>

      <section className="docsGrid">
        {docs.map((section) => {
          const Icon = section.icon;
          return (
            <article className="docsPanel" key={section.title}>
              <div className="panelIcon">
                <Icon size={22} />
              </div>
              <h2>{section.title}</h2>
              <p>{section.body}</p>
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </section>

      <section className="resourceBand">
        <div>
          <BookOpen size={18} />
          <span>Repository docs</span>
        </div>
        <a href={`${githubUrl}/blob/main/README.md`} target="_blank" rel="noreferrer">
          README
        </a>
        <a href={`${githubUrl}/blob/main/docs/oracle-design.md`} target="_blank" rel="noreferrer">
          Oracle Design
        </a>
        <a href={`${githubUrl}/blob/main/docs/security-audit-scope.md`} target="_blank" rel="noreferrer">
          Security Scope
        </a>
        <a href={`${githubUrl}/blob/main/docs/deployment-base.md`} target="_blank" rel="noreferrer">
          Base Deployment
        </a>
      </section>
    </main>
  );
}
