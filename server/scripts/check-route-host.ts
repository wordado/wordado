import { readFileSync } from 'node:fs'
import { originHost, productionRouteHost } from './routeHost'

/**
 * Fails a production deploy whose APP_ORIGIN names another host than wrangler.jsonc's production route:
 * the Worker would get a BASE_URL its own address does not match (docs/deploy.md, "Moving the app").
 * usage: tsx scripts/check-route-host.ts <wrangler.jsonc> <APP_ORIGIN>
 */
const [file, origin] = process.argv.slice(2)
if (!file || origin === undefined) {
  console.error('usage: tsx scripts/check-route-host.ts <wrangler.jsonc> <APP_ORIGIN>')
  process.exit(2)
}
const route = productionRouteHost(readFileSync(file, 'utf8'))
const app = originHost(origin)
if (route === null || app === null || route !== app) {
  console.error(
    `::error::the production route is ${route ?? '(none)'} but APP_ORIGIN is ${origin}: they must be the same host (docs/deploy.md, "Moving the app to app.wordado.com")`,
  )
  process.exit(1)
}
console.log(`The production route and APP_ORIGIN agree: ${route}`)
