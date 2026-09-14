// Default team and rate card (mirrors the original Excel workbook).
// Only type imports here so scripts/setup-db.ts can load this file directly with Node.
import type { Dept, Member, Rate } from "./types";

const TEAM: [string, string, Dept, number][] = [
  ["Abishek", "CIO", "Common", 120], ["Avinash", "CEO", "Common", 120], ["Aravindh", "Sales & Marketing", "Sales", 160],
  ["Arshad", "Content pipeline & campaigns, Editor", "Content", 160], ["Kannan SK", "Editor, Content strategist (external)", "Content", 160],
  ["Genga Parameshwari", "Graphic Designer", "Design", 160], ["Jegannath", "Embedded Architect & Course sales", "Automation", 160],
  ["Janakiram", "Embedded Architect & Course sales", "Automation", 160], ["Johnson", "Brand design lead", "Design", 160],
  ["Jon", "Jr. Graphic Designer", "Design", 160], ["Kannan P", "AI backend dev, Classory sales", "Software", 160],
  ["Muthu Kumaresa", "Editor", "Content", 160], ["Pradeep Suriya", "Full stack developer", "Software", 160],
  ["Vignesh", "Content writer", "Content", 160], ["Sherley Twinkle", "Admin – invoices, accounts, campaigns", "Admin", 160],
  ["Sudharson", "Sales & Marketing (part-time)", "Sales", 60],
];

const E = "Engineering", U = "UI/UX Design";
const RATES: [Dept, string, string, number, string?][] = [
  ["Content", "Reel / short-form edit (<60s)", "per video", 3], ["Content", "Long-form video edit (5–20 min)", "per video", 10], ["Content", "Long-form video edit (>20 min)", "per video", 16],
  ["Content", "Reel script / storyboard", "per script", 2], ["Content", "Long-form script", "per script", 5], ["Content", "Shoot / recording session", "per hour", 1.5],
  ["Content", "Thumbnail", "per thumbnail", 1.5], ["Content", "Carousel copy (text)", "per carousel", 2], ["Content", "Caption + hashtags set", "per post", 1],
  ["Content", "Blog / article (800+ words)", "per article", 5], ["Content", "Newsletter / email copy", "per email", 3], ["Content", "Post scheduling & publishing", "per post", 0.5],
  ["Content", "Monthly content calendar", "per brand", 6], ["Content", "Content strategy document", "per brand", 10], ["Content", "Campaign planning & setup", "per campaign", 6],
  ["Content", "Analytics / performance report", "per report", 3], ["Content", "Client review / revision round", "per round", 1],
  ["Design", "Social media static post", "per creative", 2], ["Design", "Carousel design (6–10 slides)", "per carousel", 5], ["Design", "Poster / flyer / banner", "per creative", 4],
  ["Design", "Logo concept", "per concept", 6], ["Design", "Logo finalisation + files", "per logo", 8], ["Design", "Full brand identity kit", "per brand", 25],
  ["Design", "Pitch deck / brochure (per 10 pages)", "per 10 pages", 10], ["Design", "UI screen design", "per screen", 4], ["Design", "Packaging / print collateral", "per item", 8],
  ["Design", "Motion graphic / animation (<30s)", "per animation", 6], ["Design", "Course creative / thumbnail", "per creative", 2], ["Design", "Design revision round", "per round", 1],
  ["Design", "Design review & mentoring", "per hour", 1.5],
  ["Automation", "Schematic design", "per board", 12], ["Automation", "PCB layout – 2 layer", "per board", 15], ["Automation", "PCB layout – 4+ layer", "per board", 25],
  ["Automation", "BOM + fabrication order prep", "per board", 3], ["Automation", "Prototype assembly & soldering", "per board", 5], ["Automation", "Hardware bring-up / testing session", "per session", 4],
  ["Automation", "Firmware feature / module", "per feature", 8], ["Automation", "Firmware bug fix", "per fix", 3], ["Automation", "R&D research / experiment", "per hour", 1],
  ["Automation", "Technical documentation", "per document", 5], ["Automation", "Client project milestone delivered", "per milestone", 15], ["Automation", "Solder Minds course module created", "per module", 8],
  ["Automation", "Workshop / training conducted", "per session", 10],
  ["Software", "Feature – small (<1 day)", "per feature", 4, E], ["Software", "Feature – medium (1–3 days)", "per feature", 10, E], ["Software", "Feature – large (>3 days)", "per feature", 20, E],
  ["Software", "Bug fix – minor", "per fix", 2, E], ["Software", "Bug fix – critical / production", "per fix", 5, E], ["Software", "API endpoint", "per endpoint", 3, E],
  ["Software", "Database / schema design", "per design", 6, E], ["Software", "AI model / prompt pipeline integration", "per integration", 8, E], ["Software", "Code review", "per PR", 1.5, E],
  ["Software", "Deployment / release", "per release", 4, E], ["Software", "Testing / QA session", "per hour", 1, E], ["Software", "Technical documentation (software)", "per document", 3, E],
  ["Software", "Production incident resolved", "per incident", 6, E],
  ["Software", "UX research / user interviews", "per session", 4, U], ["Software", "User flow / information architecture", "per flow", 5, U],
  ["Software", "Wireframes (low-fidelity)", "per screen", 2, U], ["Software", "App / web UI screen (high-fidelity)", "per screen", 4, U],
  ["Software", "Interactive prototype", "per flow", 6, U], ["Software", "Design system component", "per component", 3, U],
  ["Software", "Usability testing session", "per session", 4, U], ["Software", "UX audit / heuristic review", "per audit", 6, U],
  ["Software", "Design handoff & dev specs", "per screen", 1.5, U], ["Software", "UI/UX revision round", "per round", 1, U],
  ["Sales", "Cold outreach (10 contacts)", "per 10 contacts", 1], ["Sales", "Follow-up call / message", "per follow-up", 0.5], ["Sales", "Qualified lead generated", "per lead", 2],
  ["Sales", "Demo / discovery meeting", "per meeting", 4], ["Sales", "Proposal / quotation sent", "per proposal", 5], ["Sales", "Deal closed – small (<₹25k)", "per deal", 15],
  ["Sales", "Deal closed – medium (₹25k–₹1L)", "per deal", 30], ["Sales", "Deal closed – large (>₹1L)", "per deal", 60], ["Sales", "Course enrollment", "per enrollment", 3],
  ["Sales", "Ad campaign setup", "per campaign", 5], ["Sales", "Campaign performance report", "per report", 3], ["Sales", "Partnership / tie-up secured", "per partnership", 15],
  ["Sales", "Event / webinar conducted", "per event", 12],
  ["Admin", "Invoice raised", "per invoice", 1], ["Admin", "Payment collection follow-up", "per collection", 2], ["Admin", "Accounts reconciliation", "per week", 4],
  ["Admin", "Vendor / purchase handling", "per purchase", 2], ["Admin", "Compliance filing (GST, TDS etc.)", "per filing", 6], ["Admin", "HR / onboarding task", "per task", 3],
  ["Admin", "Marketing campaign coordination", "per campaign", 3], ["Admin", "Meeting minutes / documentation", "per document", 1],
  ["Common", "Team meeting / standup", "per hour", 1], ["Common", "Client meeting", "per meeting", 2], ["Common", "Planning / strategy session", "per session", 3],
  ["Common", "Mentoring / training others", "per hour", 1.5], ["Common", "Self-learning / upskilling", "per hour", 0.5], ["Common", "Hiring / interview", "per interview", 2],
  ["Common", "Investor / partner pitch", "per pitch", 8], ["Common", "Other work (hourly)", "per hour", 1],
];

export function defaultTeam(): Member[] {
  return TEAM.map(([name, role, dept, target], order) => ({ id: crypto.randomUUID(), name, role, dept, target, active: true, order }));
}

export function defaultRates(): Rate[] {
  return RATES.map(([dept, type, unit, rate, group], order) => ({ id: crypto.randomUUID(), dept, type, unit, rate, group: group ?? "", order }));
}
