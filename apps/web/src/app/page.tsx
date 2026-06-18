import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Github,
  LockKeyhole,
  ShieldCheck,
  TestTube2,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const githubUrl = "https://github.com/hilson946/updown-market";

const metrics = [
  { label: "Settlement", value: "On-chain TWAP" },
  { label: "Custody", value: "Market contract" },
  { label: "Trading", value: "Gas-sponsored" },
];

const guarantees = [
  "Immutable market contracts",
  "No admin result override",
  "Anyone can trigger settlement",
  "Refunds on oracle failure, ties, or one-sided pools",
];

export default function LandingPage() {
  return (
    <main className="siteShell">
      <header className="siteNav">
        <Link className="brandMark" href="/">
          <span>UD</span>
          <b>UP/DOWN</b>
        </Link>
        <nav aria-label="Primary">
          <Link href="/docs">
            <BookOpen size={16} />
            Docs
          </Link>
          <a href={githubUrl} target="_blank" rel="noreferrer">
            <Github size={16} />
            GitHub
          </a>
          <Link className="launchLink" href="/app">
            Launch App
            <ArrowRight size={16} />
          </Link>
        </nav>
      </header>

      <section className="landingHero">
        <Image
          src="/trading-preview.png"
          alt="UP/DOWN trading interface preview"
          fill
          priority
          className="heroImage"
          sizes="100vw"
        />
        <div className="heroScrim" />
        <div className="landingHeroContent">
          <p className="eyebrow">BASE EVM PREDICTION MARKETS</p>
          <h1>UP/DOWN</h1>
          <p>
            A short-horizon prediction market for crypto, sports-style demo feeds, macro indexes, and DeFi baskets.
            Users connect a wallet, test with local USDC, then trade through signed intents and a gas-paying relayer.
          </p>
          <div className="heroActions">
            <Link className="primaryCta" href="/app">
              Launch App
              <ArrowRight size={18} />
            </Link>
            <Link className="secondaryCta" href="/docs">
              Read Docs
              <BookOpen size={18} />
            </Link>
          </div>
        </div>
      </section>

      <section className="landingBand">
        <div className="metricRow">
          {metrics.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="landingGrid">
        <div className="landingPanel">
          <div className="panelIcon">
            <TestTube2 size={22} />
          </div>
          <h2>Test First</h2>
          <p>
            Local Anvil deployments expose a test-funds control inside the app. Connect a wallet, get mock USDC, and
            run the full bet, settle, claim, and refund loop before touching real networks.
          </p>
        </div>
        <div className="landingPanel">
          <div className="panelIcon">
            <Wallet size={22} />
          </div>
          <h2>Connect To Trade</h2>
          <p>
            The trading desk stays read-only until a wallet is connected. Bets are EIP-712 signed by the user and
            submitted by the relayer, so market interaction feels closer to a production dapp.
          </p>
        </div>
        <div className="landingPanel">
          <div className="panelIcon">
            <LockKeyhole size={22} />
          </div>
          <h2>Locked Rules</h2>
          <p>
            Markets accept orders for the full previous interval plus a five-second grace window, then lock and settle
            from oracle prices at prediction start and prediction end.
          </p>
        </div>
      </section>

      <section className="assuranceBand">
        <div>
          <p className="eyebrow">SECURITY MODEL</p>
          <h2>Built Around Verifiable Settlement</h2>
        </div>
        <div className="guaranteeList">
          {guarantees.map((item) => (
            <span key={item}>
              <CheckCircle2 size={16} />
              {item}
            </span>
          ))}
        </div>
        <Link className="auditLink" href="/docs">
          <ShieldCheck size={18} />
          Review Security Scope
        </Link>
      </section>
    </main>
  );
}
