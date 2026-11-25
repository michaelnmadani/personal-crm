// Checks the LinkedIn work-history paste (src/lib/parseLinkedIn.ts) against
// pastes shaped like real profiles: several roles under one employer, skills
// lines with and without "+N skills", descriptions, locations, and LinkedIn's
// doubled screen-reader lines.
//
//   node scripts/test-linkedin-paste.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const bundle = join(mkdtempSync(join(tmpdir(), 'crm-linkedin-')), 'parse.mjs')
await build({ entryPoints: [join(root, 'src/lib/parseLinkedIn.ts')], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'warning' })
const { parseLinkedInExperience } = await import(pathToFileURL(bundle).href)

const cases = {
  // Roles grouped under BOQ and Virgin Money, each followed by a skills line —
  // two of them the unmarked two-skill kind — then ungrouped entries, the
  // first of whose titles has an "and" in it too.
  'Johnny Lockwood': {
    paste: `BOQ Group
3 yrs
General Manager Broker & Strategic Partnerships
Nov 2023 - Present · 2 yrs 1 mo
Commercial Partnerships, Broker Distribution and +3 skills
General Manager Broker, Credit Cards & Loyalty (BOQ, ME and Virgin Money Australia)
Feb 2023 - Jan 2024 · 1 yr
Virgin Money Australia
11 yrs 3 mos
General Manager Commercial
Nov 2021 - Mar 2023 · 1 yr 5 mos
Growth Strategies, Business Growth Strategies and +2 skills
General Manager Lending, Cards & Deposits
Mar 2015 - Oct 2021 · 6 yrs 8 mos
Direct Banking, Growth Strategies and +4 skills
Head of Banking
Jun 2013 - Feb 2015 · 1 yr 9 mos
Growth Strategies and Business Growth Strategies
Head of Cards
Jan 2012 - May 2013 · 1 yr 5 mos
Growth Strategies and Business Growth Strategies
Senior Product and Project Manager
Macquarie Bank
2006 - Jan 2012
Technical Business Analyst
Commonwealth Bank of Australia
2003 - 2006`,
    want: [
      ['BOQ Group', 'General Manager Broker & Strategic Partnerships', 2023, null, true],
      ['BOQ Group', 'General Manager Broker, Credit Cards & Loyalty (BOQ, ME and Virgin Money Australia)', 2023, 2024, false],
      ['Virgin Money Australia', 'General Manager Commercial', 2021, 2023, false],
      ['Virgin Money Australia', 'General Manager Lending, Cards & Deposits', 2015, 2021, false],
      ['Virgin Money Australia', 'Head of Banking', 2013, 2015, false],
      ['Virgin Money Australia', 'Head of Cards', 2012, 2013, false],
      ['Macquarie Bank', 'Senior Product and Project Manager', 2006, 2012, false],
      ['Commonwealth Bank of Australia', 'Technical Business Analyst', 2003, 2006, false],
    ],
  },

  // Two long groups back to back, a location under a role, and an ungrouped
  // entry (with an employment type) straight after an unmarked skills line.
  'Kai Yang': {
    paste: `Group Chief Data and AI officer
ANZ · Full-time
Jul 2026 - Present · 5 mos
Melbourne, Victoria, Australia
HSBC
6 yrs
Chief Data and Analytics Officer, Asia & Middle East
Aug 2025 - Jul 2026 · 1 yr
Hong Kong SAR
Data Strategy, Artificial Intelligence (AI) and +3 skills
CIO, Asia Pacific
Sep 2023 - Mar 2024 · 7 mos
Artificial Intelligence (AI), Project Management and +8 skills
Chief Information Officer, Group Data Technology
Feb 2022 - Aug 2025 · 3 yrs 7 mos
Artificial Intelligence (AI), Data Analysis and +6 skills
MD, Chief Data Officer Asia Pacific
Jan 2020 - Feb 2022 · 2 yrs 2 mos
Executive Leadership, Enterprise Risk Management and +2 skills
Commonwealth Bank
16 yrs 5 mos
Group Chief Data Officer
Jul 2018 - Jan 2020 · 1 yr 7 mos
Data Governance and Executive Leadership
General Manager Analytics Strategy & Advisory
Apr 2017 - Jun 2018 · 1 yr 3 mos
Artificial Intelligence (AI), Project Management and +5 skills
Chief Risk Officer CommInsure
Feb 2016 - Mar 2017 · 1 yr 2 mos
Project Management, Data Analytics and +4 skills
General Manager, Balance Sheet and Specialist Advisory, Wealth
Mar 2010 - Feb 2016 · 6 yrs
Executive Leadership, Enterprise Risk Management and +1 skill
Executive Manager, Economic Capital, Group Treasury
Mar 2007 - Mar 2010 · 3 yrs 1 mo
Project Management, Executive Leadership and +3 skills
Head of EMTN Pricing, Global Markets & Treasury
Aug 2004 - Mar 2007 · 2 yrs 8 mos
Project Management, Enterprise Risk Management and +1 skill
Manager, Group Market Risk
Sep 2003 - Aug 2004 · 1 yr
Project Management and Analytical Skills
Senior Analyst
Deloitte Australia · Full-time
Jan 2001 - Aug 2003 · 2 yrs 8 mos`,
    want: [
      ['ANZ', 'Group Chief Data and AI officer', 2026, null, true],
      ['HSBC', 'Chief Data and Analytics Officer, Asia & Middle East', 2025, 2026, false],
      ['HSBC', 'CIO, Asia Pacific', 2023, 2024, false],
      ['HSBC', 'Chief Information Officer, Group Data Technology', 2022, 2025, false],
      ['HSBC', 'MD, Chief Data Officer Asia Pacific', 2020, 2022, false],
      ['Commonwealth Bank', 'Group Chief Data Officer', 2018, 2020, false],
      ['Commonwealth Bank', 'General Manager Analytics Strategy & Advisory', 2017, 2018, false],
      ['Commonwealth Bank', 'Chief Risk Officer CommInsure', 2016, 2017, false],
      ['Commonwealth Bank', 'General Manager, Balance Sheet and Specialist Advisory, Wealth', 2010, 2016, false],
      ['Commonwealth Bank', 'Executive Manager, Economic Capital, Group Treasury', 2007, 2010, false],
      ['Commonwealth Bank', 'Head of EMTN Pricing, Global Markets & Treasury', 2004, 2007, false],
      ['Commonwealth Bank', 'Manager, Group Market Risk', 2003, 2004, false],
      ['Deloitte Australia', 'Senior Analyst', 2001, 2003, false],
    ],
  },

  // Descriptions (prose, bullets, a numbered list), a location under each
  // group's heading, an employment-type line between a title and its dates.
  'Darren Moglia': {
    paste: `Managing Director
EnterpriseWorks Advisory
Oct 2025 - Present · 1 yr 2 mos
Sydney, New South Wales, Australia
EnterpriseWorks is an independent Australian advisory firm specialising in business and AI transformation, helping organisations improve productivity, strengthen execution, create capacity for growth and realise measurable business value from AI.
Our core services are:
1. Growth Strategy & AI Roadmap
2. AI Work Redesign & Transformation
3. AI Capability & Adoption
4. AI Operating Model & Workforce Planning
We also deliver executive briefings, research and insights, and keynote presentations. EnterpriseWorks is an approved NSW Government supplier (SCM0005).
Westpac Group
13 yrs 2 mos
Sydney, New South Wales, Australia
Go To Market Planning & Enterprise Projects
Nov 2020 - Aug 2025 · 4 yrs 10 mos
• Leading the Go to Market planning function for Westpac Group, including facilitating cross-functional planning across a group of 150 leaders in our Consumer and Business divisions.
• Designed and facilitated "The Growth Room", an advanced skills development forum to nurture top talent.
Director of Digital, Wealth Management
Nov 2017 - Oct 2020 · 3 yrs
• Introduced Agile Scrum across our digital and marketing teams.
Adobe and Salesforce
Head of Online Share Trading & Direct Distribution
Jul 2012 - Oct 2017 · 5 yrs 4 mos
• Managed commercial negotiation of high value supplier contracts.
Macquarie Bank
9 yrs
Sydney, New South Wales, Australia
Associate Director, Online Share Trading
Aug 2009 - Jun 2012 · 2 yrs 11 mos
• Extensive experience with PR and media interviews.
Associate Director, Stockbroking Operations
Mar 2007 - Aug 2009 · 2 yrs 6 mos
• Developed a Term Deposit product within 1 month to help protect the balance sheet during the GFC.
Service & Operations Manager
Full-time
Jul 2003 - Feb 2007 · 3 yrs 8 mos
• Designed and led a talent development program for our division of 130 people.
Finance Operations Manager
TD
Sep 2001 - Jun 2003 · 1 yr 10 mos
Sydney, New South Wales, Australia
Settlements Manager
BNP Paribas
Mar 1999 - Aug 2001 · 2 yrs 6 mos
Sydney, New South Wales, Australia
Retail, Institutional and Derivative Settlements
Bankers Trust
May 1996 - Feb 1999 · 2 yrs 10 mos
Sydney, New South Wales, Australia`,
    want: [
      ['EnterpriseWorks Advisory', 'Managing Director', 2025, null, true],
      ['Westpac Group', 'Go To Market Planning & Enterprise Projects', 2020, 2025, false],
      ['Westpac Group', 'Director of Digital, Wealth Management', 2017, 2020, false],
      ['Westpac Group', 'Head of Online Share Trading & Direct Distribution', 2012, 2017, false],
      ['Macquarie Bank', 'Associate Director, Online Share Trading', 2009, 2012, false],
      ['Macquarie Bank', 'Associate Director, Stockbroking Operations', 2007, 2009, false],
      ['Macquarie Bank', 'Service & Operations Manager', 2003, 2007, false],
      ['TD', 'Finance Operations Manager', 2001, 2003, false],
      ['BNP Paribas', 'Settlements Manager', 1999, 2001, false],
      ['Bankers Trust', 'Retail, Institutional and Derivative Settlements', 1996, 1999, false],
    ],
  },

  // A short description sentence with an "and" in it, and numbered description
  // points, each sitting just above the next role in a group.
  'Jonathan Chan': {
    paste: `SocietyOne
5 yrs 9 mos
Chief Growth Officer
Oct 2018 - Jul 2021 · 2 yrs 10 mos
Chief Operating Officer
Apr 2017 - Mar 2022 · 5 yrs
Responsible for partnerships and brokers.
Chief Product & Strategy Officer
Jul 2016 - Oct 2018 · 2 yrs 4 mos
Principal
The Boston Consulting Group (BCG)
Feb 2011 - Jun 2016 · 5 yrs 5 mos
Westpac
5 yrs 4 mos
Head of Strategy, Retail Banking
Sep 2009 - Dec 2010 · 1 yr 4 mos
Strategy Manager, Group Strategy
May 2009 - Sep 2009 · 5 mos
Key responsibilities:
1. Annual strategic planning process
4. Business unit/divisional strategic reviews together with key business stakeholders
Senior Strategy Analyst, Group Strategy
Jun 2007 - May 2009 · 2 yrs
Strategy Analyst, Group Strategy
Jul 2006 - Jun 2007 · 1 yr
Graduate Analyst, Group Strategy and M&A
Sep 2005 - Jun 2006 · 10 mos
Technical Consultant
Trustmarque Solutions
2000 - 2004`,
    want: [
      ['SocietyOne', 'Chief Growth Officer', 2018, 2021, false],
      ['SocietyOne', 'Chief Operating Officer', 2017, 2022, false],
      ['SocietyOne', 'Chief Product & Strategy Officer', 2016, 2018, false],
      ['The Boston Consulting Group (BCG)', 'Principal', 2011, 2016, false],
      ['Westpac', 'Head of Strategy, Retail Banking', 2009, 2010, false],
      ['Westpac', 'Strategy Manager, Group Strategy', 2009, 2009, false],
      ['Westpac', 'Senior Strategy Analyst, Group Strategy', 2007, 2009, false],
      ['Westpac', 'Strategy Analyst, Group Strategy', 2006, 2007, false],
      ['Westpac', 'Graduate Analyst, Group Strategy and M&A', 2005, 2006, false],
      ['Trustmarque Solutions', 'Technical Consultant', 2000, 2004, false],
    ],
  },
}

// LinkedIn copies every visible line twice: once on screen, once for screen readers.
const doubled = (paste) => paste.split('\n').flatMap((l) => [l, l]).join('\n')

let failures = 0
for (const [name, { paste, want }] of Object.entries(cases)) {
  for (const [label, text] of [['', paste], [' (doubled lines)', doubled(paste)]]) {
    const got = parseLinkedInExperience(text).map((r) => [r.company, r.title, r.start_year, r.end_year, r.is_current])
    const bad = want.map((w, i) => (JSON.stringify(w) === JSON.stringify(got[i]) ? null : { want: w, got: got[i] ?? null })).filter(Boolean)
    if (got.length !== want.length) bad.push({ want: `${want.length} roles`, got: `${got.length} roles` })
    console.log(`${bad.length ? '  FAIL' : '  ok  '} ${name}${label}: ${got.length} roles`)
    for (const b of bad) console.log(`         want ${JSON.stringify(b.want)}\n         got  ${JSON.stringify(b.got)}`)
    if (bad.length) failures++
  }
}
console.log(failures ? `\n${failures} FAILED` : '\nALL LINKEDIN PASTE CHECKS PASSED')
process.exit(failures ? 1 : 0)
