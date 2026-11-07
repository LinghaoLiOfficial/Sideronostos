"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  Droplets,
  Leaf,
  MapPin,
  Menu,
  MicOff,
  Play,
  ShieldCheck,
  Target,
  Volume2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const metrics = [
  { value: "Up to 90%", label: "Less chemical use", icon: Leaf },
  { value: "Lower input costs", label: "Less waste per field", icon: Droplets },
  { value: "Faster response", label: "Threats detected earlier", icon: Target },
  { value: "Protected yield", label: "Targeted crop care", icon: ShieldCheck },
];

const risks = [
  { id: "north", label: "Pigweed 76%", x: "29%", y: "22%", tone: "medium" },
  { id: "east", label: "Pigweed 84%", x: "66%", y: "29%", tone: "high" },
  { id: "south", label: "Pigweed 10%", x: "39%", y: "62%", tone: "low" },
  { id: "west", label: "Pigweed 8%", x: "69%", y: "70%", tone: "low" },
];

function Brand({ inverse = false }: { inverse?: boolean }) {
  return <a href="#vision" className={`ag-brand ${inverse ? "inverse" : ""}`} aria-label="Sideronostos agriculture home"><span className="ag-brand-symbol">✳</span><span>Sideronostos.</span></a>;
}

function SectionTag({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <Badge variant="outline" className={`ag-section-tag ${dark ? "dark" : ""}`}>{children}</Badge>;
}

function AgricultureHeader({ muted, onMute }: { muted: boolean; onMute: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <header className="ag-header">
    <Brand inverse />
    <nav className={`ag-nav ${menuOpen ? "open" : ""}`}>
      <a href="#vision" onClick={() => setMenuOpen(false)}>Vision</a>
      <a href="#risk-map" onClick={() => setMenuOpen(false)}>Field intelligence</a>
      <a href="#outcomes" onClick={() => setMenuOpen(false)}>Outcomes</a>
    </nav>
    <div className="ag-header-actions">
      <Button variant="ghost" size="icon" aria-label={muted ? "Unmute page" : "Mute page"} onClick={onMute}>{muted ? <MicOff /> : <Volume2 />}</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="secondary" size="sm">En <ChevronDown /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuItem>English</DropdownMenuItem><DropdownMenuItem>中文</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
      <Button className="ag-mobile-menu" variant="ghost" size="icon" aria-label={menuOpen ? "Close menu" : "Open menu"} onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? <X /> : <Menu />}</Button>
    </div>
  </header>;
}

function VisionSection() {
  return <section id="vision" className="ag-vision ag-dark-section">
    <div className="ag-noise" />
    <div className="ag-section-inner">
      <SectionTag dark>✳ &nbsp; About Sideronostos.</SectionTag>
      <div className="ag-vision-heading"><h1>We Combine AI Vision,<br />Precision Robotics, and Biology</h1><p>We use AI, robotics, and biology to protect crops with fewer chemicals, lower costs, and less environmental impact.</p></div>
      <div className="ag-soil-visual">
        <div className="ag-soil-image" />
        <div className="ag-analysis-window"><span>Microbial activity</span><strong>62%</strong><div className="ag-analysis-photo" /><div className="ag-play"><Play /></div></div>
        <div className="ag-analysis-line"><i /><i /><i /></div>
      </div>
      <div className="ag-metric-heading">What our system delivers</div>
      <div className="ag-metrics">{metrics.map(({ value, label, icon: Icon }) => <Card key={value} className="ag-metric-card"><span className="ag-metric-icon"><Icon /></span><span><strong>{value}</strong><small>{label}</small></span></Card>)}</div>
    </div>
  </section>;
}

function RiskMapSection() {
  const [selected, setSelected] = useState("east");
  return <section id="risk-map" className="ag-risk-map">
    <div className="ag-map-overlay" />
    <div className="ag-map-top"><Brand /><div><Badge variant="secondary">Live field scan</Badge><span>2026 season</span></div></div>
    <div className="ag-map-markers">{risks.map((risk) => <button key={risk.id} className={`ag-risk-marker ${risk.tone} ${selected === risk.id ? "selected" : ""}`} style={{ left: risk.x, top: risk.y }} onClick={() => setSelected(risk.id)}><span className="ag-marker-pin"><MapPin /></span><strong>{risk.label}</strong></button>)}</div>
    <div className="ag-map-legend"><div className="ag-legend-labels"><span>Very High</span><span>High</span><span>Medium</span><span>Low</span><span>Very Low</span></div><div className="ag-gradient-bar" /><div className="ag-months">{["Jan", "Feb", "March", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"].map((month) => <span key={month}>{month}</span>)}</div><div className="ag-map-scroll"><ArrowDown /> Scroll to Explore</div></div>
  </section>;
}

function OutcomesSection() {
  return <section id="outcomes" className="ag-outcomes"><div className="ag-outcomes-inner"><div className="ag-outcomes-heading"><SectionTag>✳ &nbsp; Outcomes</SectionTag><h2>Better Economics,<br />with Less Chemistry</h2></div><div className="ag-outcome-body"><div className="ag-outcome-copy"><h3>Better margins</h3><p>Produce more efficiently while keeping input costs under control and margins strong.</p><Button asChild className="ag-green-button"><a href="#contact">Book a Demo <ArrowRight /></a></Button></div><Card className="ag-seedling-card"><div className="ag-seedling-image" /><div className="ag-margin-panel"><span>✳</span><strong>+14%</strong><small>margin gain</small><div className="ag-mini-chart"><i /><i /><i /><i /></div><div className="ag-mini-months"><span>Jan</span><span>Feb</span><span>March</span><span>Apr</span></div></div></Card></div></div></section>;
}

function PrecisionSection() {
  return <section className="ag-precision"><div className="ag-precision-image" /><div className="ag-precision-shade" /><div className="ag-precision-title"><SectionTag dark>✳ &nbsp; The market shift</SectionTag><h2>From Blanket Chemistry<br />to Precision Agriculture</h2></div><Card className="ag-data-panel ag-field-panel"><h3>Field Risk Score <span>✳</span></h3><small>Max</small><div className="ag-risk-bars"><i><b>6–12%</b></i><i><b>30–52%</b></i><i><b>10–12%</b></i></div><footer><span>Min</span><span>Humidity</span><span>Weed Growth</span><span>Pest Activity</span></footer></Card><Card className="ag-data-panel ag-chemical-panel"><h3>Chemical Reduction <span>✳</span></h3><p><Leaf /> vs. conventional methods</p><div className="ag-chemical-chart"><span>↓12% vs Apr</span><i /><i /><i /><i /><i /></div><footer><span>Jan</span><span>Feb</span><span>March</span><span>Apr</span><span>May</span><span>Jun</span></footer></Card><div className="ag-precision-scroll"><ArrowDown /> Scroll to Explore</div></section>;
}

export default function AgriculturePage() {
  const [muted, setMuted] = useState(false);
  return <main className={`agriculture-page ${muted ? "is-muted" : ""}`}><AgricultureHeader muted={muted} onMute={() => setMuted((value) => !value)} /><VisionSection /><RiskMapSection /><OutcomesSection /><PrecisionSection /><section id="contact" className="ag-contact"><SectionTag>Start with Sideronostos.</SectionTag><h2>Grow smarter from the ground up.</h2><div className="ag-contact-actions"><Button asChild className="ag-green-button"><a href="mailto:hello@sideronostos.dev">Talk to our team <ArrowRight /></a></Button><Button asChild variant="outline"><a href="/agriculture-app#showcase">Explore the App Experience <ArrowRight /></a></Button></div></section></main>;
}
