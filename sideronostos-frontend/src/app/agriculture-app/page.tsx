"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  CloudSun,
  Crosshair,
  Droplets,
  Leaf,
  MapPin,
  MoreVertical,
  ScanLine,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Sprout,
  Sun,
  Thermometer,
  TriangleAlert,
  UserRound,
  Image as ImageIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Surface } from "@/components/ui/surface";

type Screen = "weather" | "fields" | "analysis";

function AppBrand() {
  return <a className="ag-app-brand" href="/agriculture"><span>✳</span>Sideronostos.</a>;
}

function PhoneShell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <Surface tone="dark" className={`ag-app-phone ${className}`}><span className="ag-app-phone-notch" aria-hidden="true" /><div className="ag-app-screen">{children}</div></Surface>;
}

function PhoneStatus() {
  return <div className="ag-app-status"><span>15:45</span><span>▮▮▮ ◔ ▰</span></div>;
}

function WeatherNav() {
  return <div className="ag-app-weather-nav"><span className="active"><Sprout /><small>Home</small></span><span><Leaf /><small>Fields</small></span><Button size="icon" aria-label="Scan crops"><ScanLine /></Button><span><BarChart3 /><small>Reports</small></span><span><UserRound /><small>Profile</small></span></div>;
}

function WeatherScreen() {
  return <PhoneShell className="ag-app-phone-featured"><div className="ag-app-photo-bg ag-app-crop-rows-bg" /><div className="ag-app-screen-shade ag-app-weather-shade" /><div className="ag-app-screen-content ag-app-weather-content"><PhoneStatus /><div className="ag-app-top-row"><Badge><MapPin /> Yorkshire, UK</Badge><Button variant="secondary" size="icon" aria-label="Notifications"><Bell /></Button></div><Card className="ag-app-glass-card ag-app-weather-card"><div className="ag-app-card-title"><span><CloudSun /> Weather</span><Badge>Today⌄</Badge></div><strong className="ag-app-temperature">22°</strong><div className="ag-app-temperature-scale"><span>20°</span><span>21°</span><span>23°</span><span>24°</span><span>25°</span><span>26°</span><span>27°</span><i /></div><div className="ag-app-temperature-band"><i /></div><div className="ag-app-hours"><span>9 AM</span><span>10 AM</span><span>11 AM</span><span>12 PM</span><span>1 PM</span></div></Card><Card className="ag-app-glass-card ag-app-stat-row"><span><Droplets /><small>Humidity</small><b>78%</b></span><span><CloudSun /><small>Clouds</small><b>65%</b></span><span><Sun /><small>UV Index</small><b>Low</b></span></Card><Card className="ag-app-glass-card ag-app-weather-dashboard"><div className="ag-app-alert"><span><TriangleAlert /></span><div><strong>Irrigation Needed</strong><small>AI detected nutrient deficiency in rice field.</small></div></div><div className="ag-app-fields-heading"><strong>My Fields</strong><a href="#showcase">View All</a></div><div className="ag-app-mini-fields"><Card><Badge>Pest Alert</Badge><div className="ag-app-mini-photo soybean" /><strong>Soybean Field</strong><small>10 ha · 2 hours ago</small></Card><Card><Badge>Needs Water</Badge><div className="ag-app-mini-photo corn" /><strong>Corn Field</strong><small>12 ha · 2 days ago</small></Card></div></Card><WeatherNav /></div></PhoneShell>;
}

function FieldsScreen() {
  return <PhoneShell><div className="ag-app-photo-bg ag-app-fields-bg" /><div className="ag-app-screen-shade ag-app-fields-shade" /><div className="ag-app-screen-content ag-app-fields-content"><PhoneStatus /><div className="ag-app-fields-title"><Button variant="secondary" size="icon" aria-label="Back"><ArrowLeft /></Button><strong>My Fields</strong><Button variant="secondary" size="icon" aria-label="More options"><MoreVertical /></Button></div><div className="ag-app-search"><Search /><span>Type name field</span><SlidersHorizontal /></div><div className="ag-app-field-boundary" aria-hidden="true" /><span className="ag-app-map-label soy"><span className="ag-app-field-marker"><Sprout /></span>Soybean Field</span><span className="ag-app-map-label corn"><span className="ag-app-field-marker"><Sprout /></span>Corn Field</span><span className="ag-app-map-pin"><span className="ag-app-field-marker"><Sprout /></span><b>Wheat Field</b></span><Button className="ag-app-locate" size="icon" aria-label="Locate field"><Crosshair /></Button><Card className="ag-app-field-detail"><div className="ag-app-detail-heading"><strong>Wheat Field</strong><span><ScanLine /> 8.5 ha</span></div><div className="ag-app-detail-stats"><span>Soil<small>Clay type</small><b>30%</b></span><span>Water<small>Normal Level</small><b>92%</b></span><span>Plant Health<small>Stable Growth</small><b>98%</b></span></div><div className="ag-app-harvest"><div className="ag-app-harvest-heading"><span>Predicted Harvest</span><Badge>↗ +15% vs last month</Badge></div><div className="ag-app-harvest-bar"><i /></div><div className="ag-app-harvest-result"><b>3.4 tons</b><small>◷ 102/47 days</small></div></div></Card></div></PhoneShell>;
}

function AnalysisScreen() {
  return <PhoneShell><div className="ag-app-photo-bg ag-app-leaf-bg" /><div className="ag-app-analysis-shade" /><div className="ag-app-screen-content"><PhoneStatus /><Button variant="secondary" size="icon" className="ag-app-analysis-back" aria-label="Back"><ArrowLeft /></Button><div className="ag-app-scan-frame"><span /><span /><span /><span /><div /></div><div className="ag-app-analysis-progress"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><Button className="ag-app-analyse"><Sparkles /> 60% Analyse</Button><Button variant="secondary" className="ag-app-cancel">Cancel</Button></div></PhoneShell>;
}

function TreatmentScreen() {
  return <PhoneShell className="ag-app-treatment-phone"><div className="ag-app-photo-bg ag-app-leaf-bg" /><div className="ag-app-treatment-shade" /><div className="ag-app-treatment-layout"><div className="ag-app-treatment-top"><PhoneStatus /><div className="ag-app-treatment-title"><Button variant="secondary" size="icon" aria-label="Back"><ArrowLeft /></Button><strong>Crop Analysis</strong><Button variant="secondary" size="icon" aria-label="More options"><MoreVertical /></Button></div></div><div className="ag-app-treatment-scroll"><Card className="ag-app-diagnosis-panel"><div className="ag-app-disease-alert"><span><TriangleAlert /></span><div><strong>Early Leaf Disease Detected</strong><small>AI found fungal infection on wheat leaves.</small></div></div><div className="ag-app-diagnosis-stats"><span><Droplets /><small>Humidity</small><b>78%</b></span><span><Thermometer /><small>Temperature</small><b>22°C</b></span></div></Card><Card className="ag-app-diagnosis-copy">We detected fungal leaf disease with moderate severity. High humidity and mild temperature may promote fungal growth. Would you like me to generate a treatment plan?</Card><div className="ag-app-chat-bubble user">Yes, I&apos;d like to see what you recommend</div><div className="ag-app-treatment-response">Here&apos;s your personalized treatment plan for the detected fungal infection.<Card><Badge>Day 1</Badge><strong>Apply Antifungal Type B</strong><small>• Active Ingredient: Azoxystrobin 250g/L</small><small>• Dosage: 1L per hectare</small><small>• Frequency: Once every 7 days, 3 cycles</small></Card><Card><Badge>Day 2</Badge><strong>Irrigation Adjustment</strong><small>• Avoid overhead watering for the next 5 days</small></Card></div></div><div className="ag-app-chat-input"><span>Type your question</span><Button variant="ghost" size="icon" aria-label="Attach image"><ImageIcon /></Button><Button size="icon" aria-label="Send question"><Send /></Button></div></div></PhoneShell>;
}

export default function AgricultureAppPage() {
  const [screen, setScreen] = useState<Screen>("weather");
  return <Surface tone="light"><main className="agriculture-app-page"><header className="ag-app-header"><AppBrand /><nav><a href="#showcase">App experience</a><a href="/agriculture">Agriculture intelligence</a></nav><Button asChild variant="outline"><a href="/agriculture"><ArrowLeft /> Back to agriculture</a></Button></header><section className="ag-app-hero"><Badge>Field intelligence, in your pocket.</Badge><h1>See your fields<br /><em>differently.</em></h1><p>One calm, clear view of crop health, field risk, and the next best action.</p><Button asChild className="ag-app-green-button"><a href="#showcase">Explore the app <ArrowRight /></a></Button></section><Surface tone="dark"><section id="showcase" className="ag-app-showcase"><div className="ag-app-showcase-heading"><span>01 / Product experience</span><h2>From scan to<br /><em>action.</em></h2><p>Designed for growers who need a faster signal, a simpler decision, and more confidence in every field.</p></div><div className="ag-app-desktop-wall"><div className="ag-app-side-panel"><TreatmentScreen /></div><div className="ag-app-main-phone"><WeatherScreen /></div><div className="ag-app-fields-phone"><FieldsScreen /></div><div className="ag-app-side-phone"><AnalysisScreen /></div></div><Tabs value={screen} onValueChange={(value) => setScreen(value as Screen)} className="ag-app-tabs"><TabsList><TabsTrigger value="weather">Weather</TabsTrigger><TabsTrigger value="fields">My Fields</TabsTrigger><TabsTrigger value="analysis">Crop Analysis</TabsTrigger></TabsList><TabsContent value="weather"><WeatherScreen /></TabsContent><TabsContent value="fields"><FieldsScreen /></TabsContent><TabsContent value="analysis"><AnalysisScreen /></TabsContent></Tabs></section></Surface><section className="ag-app-cta"><Badge>Built for the ground truth.</Badge><h2>Start monitoring<br /><em>your fields.</em></h2><p>Better signals. Better timing. Better outcomes for every acre.</p><div><Button asChild className="ag-app-green-button"><a href="#showcase">Explore Agriculture Intelligence <ArrowRight /></a></Button><Button asChild variant="outline"><a href="/agriculture#outcomes">Back to Agriculture</a></Button></div></section></main></Surface>;
}
