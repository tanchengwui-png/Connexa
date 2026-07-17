import Image from "next/image";
import { ConnexaLogo } from "@/components/connexa-logo";
import { getVisiblePublicPackages } from "@/lib/platform-packages";

export const dynamic = "force-dynamic";

const navItems = [
  { href: "#features", label: "Features" },
  { href: "#video", label: "Watch" },
  { href: "#pricing", label: "Pricing" },
  { href: "#contact", label: "Contact" }
];

const DEFAULT_CONNEXA_LANDING_VIDEO_URL = "https://www.youtube.com/watch?v=e5oyEIulVnA";

const featureCards = [
  {
    icon: "inbox",
    title: "Shared WhatsApp Inbox",
    body: "One team workspace for chats, notes, assignments, and replies."
  },
  {
    icon: "channels",
    title: "Multi-Number Connection",
    body: "Connect QR or Cloud API numbers from one place."
  },
  {
    icon: "automation",
    title: "Automation Workflows",
    body: "Welcome replies, keyword flows, and follow-up logic."
  },
  {
    icon: "campaigns",
    title: "Campaign Broadcasts",
    body: "Send targeted campaigns with media and scheduling."
  },
  {
    icon: "contacts",
    title: "Contacts and Leads",
    body: "Keep owners, tags, stages, and context connected."
  },
  {
    icon: "tracking",
    title: "Scheduling and Tracking",
    body: "Queue messages, book follow-up, and track delivery."
  }
];

const heroProofItems = [
  {
    title: "Shared Inbox",
    body: "Keep every customer chat visible to the team",
    icon: "chat"
  },
  {
    title: "Team Collaboration",
    body: "Assign ownership and stay aligned on follow-up",
    icon: "team"
  },
  {
    title: "Smart Automation",
    body: "Reply faster with rules, templates, and campaigns",
    icon: "bolt"
  }
];

const heroChips = [
  {
    title: "WhatsApp Connected",
    body: "Business number active",
    tone: "green",
    position: "top-left"
  },
  {
    title: "Lead Assigned",
    body: "Assigned to Sarah",
    tone: "blue",
    position: "top-center"
  },
  {
    title: "Follow-up Scheduled",
    body: "Tomorrow, 10:00 AM",
    tone: "amber",
    position: "top-right"
  },
  {
    title: "Response Time Improved",
    body: "32% vs last month",
    tone: "blue",
    position: "bottom-left"
  },
  {
    title: "Campaign Sent",
    body: "Brochure message sent",
    tone: "purple",
    position: "bottom-right"
  }
];

const statsItems = [
  {
    value: "1 inbox",
    label: "for sales, support, and follow-up"
  },
  {
    value: "Multi-number",
    label: "connection with QR and Cloud API setup"
  },
  {
    value: "Automated",
    label: "workflows, broadcasts, and message scheduling"
  }
];

function getConnexaLandingVideoEmbedUrl(input: string | undefined) {
  const fallbackVideoId = "e5oyEIulVnA";
  const rawValue = input?.trim() || DEFAULT_CONNEXA_LANDING_VIDEO_URL;

  try {
    const parsed = new URL(rawValue);
    const hostname = parsed.hostname.replace(/^www\./, "");

    if (hostname === "youtu.be") {
      const shortVideoId = parsed.pathname.replace(/\//g, "").trim();
      if (shortVideoId) {
        return `https://www.youtube.com/embed/${shortVideoId}`;
      }
    }

    if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      const videoId = parsed.searchParams.get("v")?.trim();
      if (videoId) {
        return `https://www.youtube.com/embed/${videoId}`;
      }

      const pathMatch = parsed.pathname.match(/^\/embed\/([^/]+)/);
      if (pathMatch?.[1]) {
        return `https://www.youtube.com/embed/${pathMatch[1]}`;
      }
    }
  } catch {
    return `https://www.youtube.com/embed/${fallbackVideoId}`;
  }

  return `https://www.youtube.com/embed/${fallbackVideoId}`;
}

export default async function ConnexaLandingPage() {
  const pricingPlans = await getVisiblePublicPackages();
  const landingVideoUrl = process.env.NEXT_PUBLIC_CONNEXA_LANDING_VIDEO_URL ?? DEFAULT_CONNEXA_LANDING_VIDEO_URL;
  const landingVideoEmbedUrl = getConnexaLandingVideoEmbedUrl(landingVideoUrl);

  return (
    <main className="connexa-dark-shell">
      <div className="connexa-dark-bg" aria-hidden="true">
        <div className="connexa-dark-glow glow-left" />
        <div className="connexa-dark-glow glow-right" />
        <div className="connexa-dark-glow glow-bottom" />
        <div className="connexa-dark-grid" />
      </div>

      <header className="connexa-header">
        <div className="connexa-header-inner">
          <div className="connexa-brand">
            <ConnexaLogo priority />
            <span className="connexa-brand-copy">
              <strong>Shared inbox for modern teams</strong>
              <span>By Recurvos</span>
            </span>
          </div>

          <nav className="connexa-nav" aria-label="Primary">
            {navItems.map((item) => (
              <a href={item.href} key={item.href}>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="connexa-header-actions">
            <a className="connexa-button connexa-button-glass" href="/login">
              Log In
            </a>
            <a className="connexa-button connexa-button-primary" href="/packages">
              Start Free Trial
            </a>
          </div>
        </div>
      </header>

      <section className="connexa-hero" id="hero">
        <div className="connexa-hero-copy">
          <span className="connexa-kicker">WhatsApp-first shared inbox for modern teams</span>

          <h1>
            One shared inbox for WhatsApp.
            <span>Keep conversations, assignments, and follow-up in one place.</span>
          </h1>

          <p>
            Connexa gives your team a clearer way to manage customer chats, stay aligned, and
            keep every conversation moving.
          </p>

          <div className="connexa-hero-actions">
            <a className="connexa-button connexa-button-primary connexa-button-large" href="/packages">
              Start Free Trial
            </a>
          </div>

          <div className="connexa-hero-proof-list">
            {heroProofItems.map((item) => (
              <article className="connexa-hero-proof-item" key={item.title}>
                <div className={`connexa-hero-proof-icon ${item.icon}`} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="connexa-preview-wrap">
          <div className="connexa-preview-glow" />
          {heroChips.map((chip) => (
            <div
              className={`connexa-hero-chip ${chip.position} ${chip.tone}`}
              key={`${chip.position}-${chip.title}`}
            >
              <div className="connexa-hero-chip-icon" />
              <div>
                <strong>{chip.title}</strong>
                <p>{chip.body}</p>
              </div>
            </div>
          ))}
          <div className="connexa-preview-shell">
            <Image
              src="/LandingPageImage.png"
              alt="Connexa inbox preview"
              className="connexa-preview-image"
              width={1600}
              height={1200}
              priority
            />
          </div>
        </div>
      </section>

      <section className="connexa-stats-band" aria-label="Platform overview">
        {statsItems.map((item) => (
          <article className="connexa-stat-card" key={item.value}>
            <strong>{item.value}</strong>
            <p>{item.label}</p>
          </article>
        ))}
      </section>

      <section className="connexa-section connexa-solutions-section" id="features">
        <div className="connexa-section-copy">
          <span>Solutions</span>
          <h2>Built to help teams handle WhatsApp work with more structure.</h2>
        </div>

        <div className="connexa-feature-grid">
          {featureCards.map((item) => (
            <article className="connexa-feature-card" key={item.title}>
              <div className={`connexa-feature-icon connexa-feature-icon-${item.icon}`} />
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="connexa-section connexa-video-section" id="video">
        <div className="connexa-video-layout">
          <div className="connexa-video-copy">
            <span>Watch Connexa</span>
            <h2>See the workspace in action.</h2>
            <p>
              Show your ad, walkthrough, or product intro without sending visitors away.
            </p>
          </div>

          <div className="connexa-video-frame">
            <iframe
              src={landingVideoEmbedUrl}
              title="Connexa landing page video"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
        </div>
      </section>

      <section className="connexa-section connexa-pricing-section" id="pricing">
        <div className="connexa-section-copy">
          <span>Pricing</span>
          <h2>Start simple. Upgrade when you grow.</h2>
        </div>

        <div className="connexa-pricing-grid">
          {pricingPlans.map((plan) => (
            <article
              className={`connexa-pricing-card${plan.featured ? " featured" : ""}`}
              key={plan.name}
            >
              <div className="connexa-pricing-head">
                <strong>{plan.name}</strong>
                {plan.featured ? <span>Most popular</span> : null}
              </div>
              <div className="connexa-pricing-price">{plan.price}</div>
              <div className="connexa-pricing-features">
                {plan.features.map((feature) => (
                  <div className="connexa-pricing-feature" key={feature}>
                    <span />
                    <p>{feature}</p>
                  </div>
                ))}
              </div>
              <a
                className={`connexa-button${plan.featured ? " connexa-button-white" : " connexa-button-glass"}`}
                href={`/packages`}
              >
                View Package
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="connexa-section connexa-contact-section" id="contact">
        <div className="connexa-contact-card">
          <div>
            <span>Ready to launch</span>
            <h3>Give your team one place to handle WhatsApp work.</h3>
            <p>
              Connexa helps teams stay fast, organized, and visible from first reply to follow-up.
            </p>
          </div>

          <div className="connexa-contact-actions">
            <a className="connexa-button connexa-button-primary connexa-button-large" href="/packages">
              Start Free Trial
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
