import { readFileSync } from 'node:fs'
import { passkeyRpIdFits } from '../src/config'
import { originHost, productionPasskeyRpId, productionRouteHost } from './routeHost'

/**
 * Fails a production deploy whose APP_ORIGIN names another host than wrangler.jsonc's production route:
 * the Worker would get a BASE_URL its own address does not match (docs/deploy.md, "Moving the app"). Also one
 * whose PASSKEY_RP_ID is not a domain APP_ORIGIN is on: the Worker would refuse to start (#304).
 * usage: tsx scripts/check-route-host.ts <wrangler.jsonc> <APP_ORIGIN>
 */
const [file, origin] = process.argv.slice(2)
if (!file || origin === undefined) {
  console.error('usage: tsx scripts/check-route-host.ts <wrangler.jsonc> <APP_ORIGIN>')
  process.exit(2)
}
const wrangler = readFileSync(file, 'utf8')
const route = productionRouteHost(wrangler)
const app = originHost(origin)
if (route === null || app === null || route !== app) {
  console.error(
    `::error::the production route is ${route ?? '(none)'} but APP_ORIGIN is ${origin}: they must be the same host (docs/deploy.md, "Moving the app to app.wordado.com")`,
  )
  process.exit(1)
}
const rpId = productionPasskeyRpId(wrangler)
if (rpId !== null && !passkeyRpIdFits(rpId, origin)) {
  console.error(`::error::the production PASSKEY_RP_ID is ${rpId} but APP_ORIGIN is ${origin}: its host must be that domain or on it (#304)`)
  process.exit(1)
}
console.log(`The production route and APP_ORIGIN agree: ${route}${rpId === null ? '' : `, on the passkey domain ${rpId}`}`)
