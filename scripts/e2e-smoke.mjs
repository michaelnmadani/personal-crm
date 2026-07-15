// End-to-end smoke test: signs up/in a throwaway user and exercises the core flows
// against a running dev server (npm run dev) and your real Supabase project.
//
//   node scripts/e2e-smoke.mjs signup   # first run
//   node scripts/e2e-smoke.mjs signin   # subsequent runs
//
// Env: BASE_URL (default http://127.0.0.1:5173), TEST_EMAIL, TEST_PASSWORD,
//      CHROMIUM_PATH (optional explicit browser binary), SHOT_DIR (screenshots).
// Playwright is intentionally not a package dependency (its postinstall downloads
// browsers) — run `npm i -D playwright` once before using this script.
// Note: requires an environment with direct network access to your Supabase URL.
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const EMAIL = process.env.TEST_EMAIL ?? 'crm.selftest@example.com'
const PASS = process.env.TEST_PASSWORD ?? 'selftest-Passw0rd!'
const MODE = process.argv[2] ?? 'signup'
const DIR = process.env.SHOT_DIR ?? '.'

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined,
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.setDefaultTimeout(20000)
const shot = (n) => page.screenshot({ path: `${DIR}/${n}.png`, fullPage: true })

try {
  await page.goto(BASE)
  await page.waitForSelector('text=Personal CRM')

  if (MODE === 'signup') {
    await page.click('text=First time? Create your account')
    await page.fill('input[type=email]', EMAIL)
    await page.fill('input[type=password]', PASS)
    await page.click('button:has-text("Create account")')
  } else {
    await page.fill('input[type=email]', EMAIL)
    await page.fill('input[type=password]', PASS)
    await page.click('button:has-text("Sign in")')
  }

  const outcome = await Promise.race([
    page.waitForSelector('h1:has-text("Today")').then(() => 'in'),
    page.waitForSelector('text=Account created').then(() => 'confirm'),
    page.waitForSelector('.text-red-400').then(() => 'error'),
  ])
  if (outcome === 'confirm') {
    console.log('NEEDS_CONFIRM: email confirmation is enabled — confirm the user, then rerun with `signin`')
    process.exit(2)
  }
  if (outcome === 'error') {
    console.log('AUTH_ERROR:', await page.locator('.text-red-400').first().textContent())
    process.exit(3)
  }
  console.log('signed in, Today visible')

  await page.locator('aside a[href="/contacts"]').click()
  await page.fill('input[placeholder^="Quick add"]', 'Ada Testperson')
  await page.click('button:has-text("Add")')
  await page.waitForSelector('h1:has-text("Ada Testperson")')
  console.log('contact created + profile open')

  await page.locator('text=+ add').first().click()
  await page.fill('input[placeholder="Name"]', 'Sam Testperson')
  await page.fill('input[placeholder="or birth year, e.g. 2017"]', '2017')
  await page.click('text=Save family member')
  await page.waitForSelector('text=Sam Testperson')
  console.log('family member added')

  await page.fill('input[placeholder="Hobby…"]', 'Hobby')
  await page.fill('input[placeholder="value"]', 'chess')
  await page.click('[aria-label="Add fact"]')
  await page.waitForSelector('span:text("chess")')
  console.log('fact added')

  await page.fill('textarea[placeholder^="What happened"]', 'Coffee catch-up — discussed the fundraise.')
  await page.click('button:has-text("Log it")')
  await page.waitForSelector('text=discussed the fundraise')
  console.log('interaction logged')

  await page.locator('text=+ add').nth(1).click()
  await page.waitForSelector('h2:has-text("New reminder")')
  await page.fill('input[placeholder="Follow up on the proposal"]', 'Send Ada the deck')
  await page.click('button:has-text("Add reminder")')
  await page.waitForSelector('text=Send Ada the deck')
  console.log('reminder added')
  await shot('profile')

  await page.locator('aside a[href="/"]').click()
  await page.waitForSelector('h1:has-text("Today")')
  await page.waitForSelector('text=Send Ada the deck')
  await page.waitForSelector('text=discussed the fundraise')
  await shot('today')
  console.log('Today shows reminder + recent note')

  await page.locator('aside a[href="/reminders"]').click()
  await page.waitForSelector('text=Send Ada the deck')
  await page.locator('aside a[href="/contacts"]').click()
  await page.waitForSelector('text=Ada Testperson')
  console.log('ALL OK')
} catch (e) {
  await shot('failure')
  console.error('FAILED:', e.message)
  process.exit(1)
} finally {
  await browser.close()
}
