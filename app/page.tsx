import { ConnexaLogo } from "@/components/connexa-logo";
import { getVisiblePublicPackages } from "@/lib/platform-packages";

export const dynamic = "force-dynamic";

const navItems = [
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#contact", label: "Contact" }
];

const inboxItems = [
  { name: "Aina Property Lead", preview: "Asked about viewing slot", active: true },
  { name: "David Workshop", preview: "Need quotation update", active: false },
  { name: "Mira Boutique", preview: "Interested in package details", active: true },
  { name: "Klinik Orkid", preview: "Requested callback tomorrow", active: false }
];

const featureCards = [
  {
    title: "Shared Team Inbox",
    body: "Handle all conversations in one workspace with assignments, ownership, and visibility."
  },
  {
    title: "Contact Context",
    body: "View customer details, tags, notes, and full timeline without switching screens."
  },
  {
    title: "Action-First Workflow",
    body: "Turn any chat into a follow-up, reminder, task, or team handoff instantly."
  },
  {
    title: "Smart Automation",
    body: "Run welcome replies, lead follow-ups, and routing rules with less manual work."
  }
];

const whyCards = [
  {
    title: "Faster response handling",
    body: "Reduce missed messages and keep every conversation owned."
  },
  {
    title: "Cleaner team collaboration",
    body: "Assignments, notes, and context stay inside the same workflow."
  },
  {
    title: "Higher lead visibility",
    body: "Spot hot leads and priority chats before they go cold."
  },
  {
    title: "Ready to scale",
    body: "Start simple now and expand into automation, campaigns, and AI later."
  }
];

export default async function ConnexaLandingPage() {
  const pricingPlans = await getVisiblePublicPackages();

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
            <ConnexaLogo dark priority />
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

      <section className="connexa-hero">
        <div className="connexa-hero-copy">
          <span className="connexa-kicker">WhatsApp-first shared inbox for modern teams</span>

          <h1>
            Handle customer chats faster.
            <span>Close more conversations with less chaos.</span>
          </h1>

          <p>
            Connexa gives your team a beautiful shared inbox, contact context, assignments,
            automations, and fast actions in one workspace, built for businesses that want
            speed, clarity, and control.
          </p>

          <div className="connexa-hero-actions">
            <a className="connexa-button connexa-button-primary connexa-button-large" href="/packages">
              Start Free Trial
            </a>
            <a className="connexa-button connexa-button-glass connexa-button-large" href="#contact">
              Book Demo
            </a>
          </div>

          <div className="connexa-hero-points">
            <span>Shared inbox for teams</span>
            <span>Fast lead follow-up</span>
            <span>Clean WhatsApp workflow</span>
          </div>
        </div>

        <div className="connexa-preview-wrap">
          <div className="connexa-preview-glow" />
          <div className="connexa-preview-shell">
            <div className="connexa-preview-frame">
              <div className="connexa-preview-topbar">
                <div>
                  <strong>Connexa Inbox</strong>
                  <p>Realtime team conversation workspace</p>
                </div>
                <span>12 active now</span>
              </div>

              <div className="connexa-preview-grid">
                <div className="connexa-preview-list">
                  <div className="connexa-preview-panel-head">
                    <strong>Inbox</strong>
                    <span>24 open</span>
                  </div>

                  <div className="connexa-preview-list-items">
                    {inboxItems.map((item) => (
                      <div
                        className={`connexa-preview-list-item${item.active ? " active" : ""}`}
                        key={item.name}
                      >
                        <div>
                          <strong>{item.name}</strong>
                          <p>{item.preview}</p>
                        </div>
                        <span>Open</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="connexa-preview-chat">
                  <div className="connexa-preview-chat-head">
                    <div>
                      <strong>Aina Property Lead</strong>
                      <p>Assigned to Sarah • Hot Lead</p>
                    </div>
                    <span>High intent</span>
                  </div>

                  <div className="connexa-preview-messages">
                    <div className="connexa-preview-bubble inbound">
                      Hi, is the unit still available for viewing this weekend?
                    </div>
                    <div className="connexa-preview-bubble outbound">
                      Yes, available. I can help you book a slot. Would Saturday afternoon work?
                    </div>
                    <div className="connexa-preview-bubble inbound">
                      Saturday works. Can you send me the brochure too?
                    </div>
                  </div>

                  <div className="connexa-preview-composer">
                    <div className="connexa-preview-input">Reply to customer...</div>
                    <button className="connexa-preview-send" type="button">
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="connexa-section" id="features">
        <div className="connexa-section-copy">
          <span>Core features</span>
          <h2>Built to make everyday customer communication fast, clear, and controlled.</h2>
        </div>

        <div className="connexa-feature-grid">
          {featureCards.map((item) => (
            <article className="connexa-feature-card" key={item.title}>
              <div className="connexa-feature-icon" />
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="connexa-section connexa-why-section" id="why">
        <div className="connexa-why-grid">
          <article className="connexa-why-main">
            <span>Why Connexa</span>
            <h3>Made for speed, not clutter.</h3>
            <p>
              Most communication tools are overloaded, slow to learn, and hard for teams to use
              daily. Connexa is designed to feel focused from the first minute so your team can
              respond, assign, follow up, and move forward without friction.
            </p>
          </article>

          <div className="connexa-why-cards">
            {whyCards.map((item) => (
              <article className="connexa-why-card" key={item.title}>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="connexa-section" id="pricing">
        <div className="connexa-section-copy">
          <span>Pricing</span>
          <h2>Start simple. Upgrade when your team grows.</h2>
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
            <h3>Give your team a faster, cleaner way to handle customer conversations.</h3>
            <p>
              Connexa is designed to help growing teams centralize chats, act faster, and keep
              every conversation under control.
            </p>
          </div>

          <div className="connexa-contact-actions">
            <a className="connexa-button connexa-button-primary connexa-button-large" href="/packages">
              Start Free Trial
            </a>
            <a className="connexa-button connexa-button-glass connexa-button-large" href="#contact">
              Book a Demo
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
