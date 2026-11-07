"use client";

import { useState } from "react";
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  Check,
  ChevronDown,
  FileText,
  Globe2,
  Mail,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Network,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Zap,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type WorkflowCard = {
  title: string;
  detail: string;
  icon: typeof FileText;
  tone?: "green" | "blue" | "purple";
};

const inputs: WorkflowCard[] = [
  { title: "New Lead", detail: "Form submission", icon: FileText },
  { title: "Support Request", detail: "Incoming message", icon: MessageCircle, tone: "blue" },
  { title: "Invoice Uploaded", detail: "New document", icon: FileText, tone: "green" },
  { title: "Webhook Event", detail: "App trigger", icon: Globe2 },
];

const outputs: WorkflowCard[] = [
  { title: "Update CRM", detail: "Contact created", icon: Network, tone: "purple" },
  { title: "Send Follow-Up Email", detail: "Reply delivered", icon: Mail, tone: "green" },
  { title: "Notify Team", detail: "Slack notification", icon: Send, tone: "blue" },
  { title: "Create Task", detail: "Added to project", icon: Check, tone: "purple" },
];

const builderModes = {
  builder: {
    label: "AI Workflow Builder",
    description: "Turn simple instructions into intelligent workflows. Build, customize, and manage automations without writing a single line of code.",
    prompt: "When a new lead submits a form, qualify it with AI and notify the sales team.",
    suggestions: ["Lead qualification", "Notify team", "Add to CRM"],
  },
  logic: {
    label: "Smart Logic",
    description: "Connect decisions, conditions, and actions with a clear visual logic layer that keeps every workflow easy to understand.",
    prompt: "If the lead score is high, route it to sales and create a follow-up task.",
    suggestions: ["Add condition", "Route to sales", "Create task"],
  },
  monitoring: {
    label: "Workflow Monitoring",
    description: "See every workflow in motion, spot bottlenecks early, and keep your most important automations running smoothly.",
    prompt: "Show me failed runs from this week and summarize the most common issue.",
    suggestions: ["View failed runs", "Open analytics", "Notify owner"],
  },
} as const;

const benefits = [
  { title: "Move Faster", icon: Zap, description: "Keep your workflows moving without delays. Automate repetitive tasks and get more done in less time." },
  { title: "Work Smarter", icon: BrainCircuit, description: "Let AI handle complex processes, make intelligent decisions, and turn everyday tasks into effortless automation." },
  { title: "Scale Effortlessly", icon: BarChart3, description: "Build flexible automations that adapt to your growing business and keep your operations running smoothly." },
];

const howItWorksSteps = [
  { eyebrow: "01 / The Idea", title: "Describe", description: "Tell Sideronostos what you want to automate, using simple everyday language.", active: true },
  { eyebrow: "02 / The Connection", title: "Connect", description: "Bring your favorite apps, tools, and data together in one seamless workspace.", active: false },
  { eyebrow: "03 / The Intelligence", title: "Generate", description: "Let AI transform your instructions into intelligent, ready-to-run workflows.", active: false },
  { eyebrow: "04 / The Launch", title: "Launch", description: "Put your automation to work and keep your team moving forward.", active: false },
];

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`landing-brand-mark${small ? " is-small" : ""}`} aria-hidden="true">
      <span className="landing-brand-ray ray-one" />
      <span className="landing-brand-ray ray-two" />
      <span className="landing-brand-ray ray-three" />
      <span className="landing-brand-ray ray-four" />
    </span>
  );
}

function LandingNavMenu({ label, items }: { label: string; items: string[] }) {
  return (
    <DropdownMenu>
      <div className="landing-nav-dropdown">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="landing-nav-trigger">{label}<ChevronDown size={16} /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="landing-nav-popover">
          {items.map((item) => <DropdownMenuItem key={item} asChild><a href="#workflow">{item}</a></DropdownMenuItem>)}
        </DropdownMenuContent>
      </div>
    </DropdownMenu>
  );
}

function WorkflowCardView({ card, side }: { card: WorkflowCard; side: "input" | "output" }) {
  const Icon = card.icon;
  return (
    <Card className={`landing-workflow-card ${side} ${card.tone ?? ""}`}>
      <span className="landing-workflow-icon"><Icon size={18} strokeWidth={1.7} /></span>
      <span className="landing-workflow-copy"><strong>{card.title}</strong><small>{card.detail}</small></span>
      <span className={`landing-workflow-status ${side === "input" ? "pending" : "complete"}`}>
        {side === "input" ? <MoreHorizontal size={18} /> : <Check size={14} />}
      </span>
      <span className="landing-port" aria-hidden="true" />
    </Card>
  );
}

function LandingSectionLabel({ number, children }: { number: string; children: React.ReactNode }) {
  return <div className="landing-section-label"><span>{number}</span><span>{children}</span></div>;
}

function AboutSection() {
  const [mode, setMode] = useState<keyof typeof builderModes>("builder");
  const active = builderModes[mode];

  return (
    <section id="about" className="landing-about">
      <div className="landing-section-shell">
        <LandingSectionLabel number="02">About Sideronostos.</LandingSectionLabel>
        <div className="landing-about-intro">
          <h2><span>Less Complexity.</span><em>More Possibility.</em></h2>
          <p>We bring your tools, data, and workflows together in one intelligent platform. Making automation simpler, faster, and accessible to every team.</p>
        </div>
        <Tabs value={mode} onValueChange={(value) => setMode(value as keyof typeof builderModes)} variant="line" className="landing-about-tabs">
          <TabsList variant="line" className="landing-about-tab-list">
            <TabsTrigger value="builder">01 / AI Builder</TabsTrigger>
            <TabsTrigger value="logic">02 / Smart Logic</TabsTrigger>
            <TabsTrigger value="monitoring">03 / Monitoring</TabsTrigger>
          </TabsList>
          {(Object.keys(builderModes) as Array<keyof typeof builderModes>).map((key) => (
            <TabsContent key={key} value={key} className="landing-about-content">
              <div className="landing-about-copy">
                <p className="landing-kicker">{active.label}</p>
                <p className="landing-about-description">{active.description}</p>
                <Button asChild className="landing-about-button"><a href="#workflow">Start Building <ArrowRight /></a></Button>
              </div>
              <Card className="landing-builder-card">
                <div className="landing-builder-glow" />
                <div className="landing-builder-inner">
                  <p className="landing-builder-placeholder">Describe your workflow...</p>
                  <div className="landing-builder-input">
                    <Textarea value={active.prompt} readOnly aria-label="Workflow prompt" />
                    <Button size="icon" aria-label="Run workflow"><Send /></Button>
                  </div>
                  <div className="landing-builder-suggestions">
                    {active.suggestions.map((suggestion) => <Badge key={suggestion} variant="secondary">{suggestion}</Badge>)}
                  </div>
                </div>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}

function BenefitsSection() {
  return (
    <section id="benefits" className="landing-benefits">
      <div className="landing-section-shell">
        <LandingSectionLabel number="03">Key Benefits</LandingSectionLabel>
        <div className="landing-benefits-intro">
          <h2>The Advantage of <em>Working Smarter.</em></h2>
          <p>Automate repetitive tasks, eliminate unnecessary complexity, and give<br className="landing-desktop-break" /> your team more time to focus on the work that truly matters.</p>
        </div>
        <div className="landing-benefits-grid">
          {benefits.map(({ title, icon: Icon, description }) => (
            <Card key={title} className="landing-benefit-card">
              <span className="landing-benefit-node" />
              <span className="landing-benefit-icon"><Icon /></span>
              <h3>{title}</h3>
              <p>{description}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section id="how-it-works" className="landing-how">
      <div className="landing-section-shell">
        <LandingSectionLabel number="04">How it Works</LandingSectionLabel>
        <div className="landing-how-layout">
          <div className="landing-how-intro">
            <h2><span>From Idea to</span><em>Automation</em></h2>
            <p>Turn simple instructions into powerful workflows in just a few steps, with AI handling the complexity along the way, so your team can focus on what matters.</p>
          </div>
          <div className="landing-how-timeline">
            <div className="landing-how-track" aria-hidden="true"><span className="landing-how-track-active" /></div>
            {howItWorksSteps.map((step) => (
              <Card key={step.eyebrow} className={`landing-how-step ${step.active ? "is-active" : ""}`}>
                <span className="landing-how-node" aria-hidden="true" />
                <p>{step.eyebrow}</p>
                <h3>{step.title}</h3>
                <span>{step.description}</span>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCtaSection() {
  return (
    <section id="final-cta" className="landing-final-cta">
      <div className="landing-cta-lines landing-cta-line-top-left" aria-hidden="true"><span /></div>
      <div className="landing-cta-lines landing-cta-line-top-right" aria-hidden="true"><span /></div>
      <div className="landing-cta-lines landing-cta-line-bottom-left" aria-hidden="true"><span /></div>
      <div className="landing-cta-lines landing-cta-line-bottom-right" aria-hidden="true"><span /></div>
      <div className="landing-final-cta-content">
        <Badge variant="outline" className="landing-final-cta-badge">Get Started with Sideronostos.</Badge>
        <h2>Ready to Work <em>Smarter?</em></h2>
        <p>Turn your ideas into intelligent workflows and let AI handle the busywork. Start automating with Sideronostos today.</p>
        <div className="landing-final-cta-actions">
          <Button asChild size="lg" className="landing-primary-button"><a href="#workflow">Start Building</a></Button>
          <Button asChild size="lg" variant="outline" className="landing-secondary-button"><a href="#demo">Explore Platforms</a></Button>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <main className="landing-page">
      <header className="landing-header">
        <div className="landing-nav-shell">
          <a className="landing-wordmark" href="#top" aria-label="Sideronostos home">
            <BrandMark small />
            <span>Sideronostos.</span>
          </a>

          <nav className={`landing-nav ${menuOpen ? "is-open" : ""}`} aria-label="Primary navigation">
            <a href="#top" onClick={() => setMenuOpen(false)}>Home</a>
            <LandingNavMenu label="Platform" items={["Automation", "Integrations"]} />
            <LandingNavMenu label="Solutions" items={["Operations", "Customer success"]} />
            <div className="landing-nav-spacer" />
            <LandingNavMenu label="Resources" items={["Guides", "Documentation"]} />
            <a href="#pricing" onClick={() => setMenuOpen(false)}>Pricing</a>
            <Button asChild size="lg" variant="secondary" className="landing-demo-button"><a href="#demo" onClick={() => setMenuOpen(false)}>Book a Demo</a></Button>
          </nav>

          <Button className="landing-menu-button" variant="ghost" size="icon-lg" type="button" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </Button>
        </div>
      </header>

      <section id="top" className="landing-hero">
        <div className="landing-hero-grid" aria-hidden="true" />
        <div className="landing-hero-content">
          <Badge variant="outline" className="landing-eyebrow"><Sparkles size={14} /> AI-Powered Workflow Automation</Badge>
          <h1><span>One Platform.</span><em>Endless Automation.</em></h1>
          <p>Simplify complex workflows, connect your tools, and let<br className="landing-desktop-break" /> AI handle the work that keeps your business moving.</p>
          <div className="landing-hero-actions">
            <Button asChild size="lg" className="landing-primary-button"><a href="#workflow">Start Building <ArrowRight size={17} /></a></Button>
            <Button asChild size="lg" variant="outline" className="landing-secondary-button"><a href="#workflow">Explore Platforms</a></Button>
          </div>
        </div>
      </section>

      <section id="workflow" className="landing-workflow" aria-label="Workflow automation preview">
        <div className="landing-workflow-grid" aria-hidden="true" />
        <div className="landing-flow-column landing-flow-inputs">
          {inputs.map((card) => <WorkflowCardView key={card.title} card={card} side="input" />)}
        </div>
        <div className="landing-flow-lines landing-flow-lines-left" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="landing-core-wrap">
          <div className="landing-core-glow" />
          <div className="landing-core-node">
            <div className="landing-core-top"><Plus size={20} /></div>
            <BrandMark />
            <strong>Sideronostos.</strong>
            <span>AI workflow engine</span>
          </div>
        </div>
        <div className="landing-flow-lines landing-flow-lines-right" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="landing-flow-column landing-flow-outputs">
          {outputs.map((card) => <WorkflowCardView key={card.title} card={card} side="output" />)}
        </div>
      </section>

      <AboutSection />
      <BenefitsSection />
      <HowItWorksSection />
      <FinalCtaSection />

      <footer id="pricing" className="landing-footer"><span>Build the way your team thinks.</span><a id="demo" href="mailto:hello@sideronostos.dev">Talk to our team <ArrowRight size={15} /></a><Settings2 size={16} aria-hidden="true" /></footer>
      <span className="sr-only">Sideronostos workflow automation platform</span>
    </main>
  );
}
