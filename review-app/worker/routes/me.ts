import type { Hono } from 'hono'
import type { AppEnv } from '../app'
import type { Me } from '../../shared/hosted'

export function meRoutes(app: Hono<AppEnv>): void {
  app.get('/api/me', (c) => {
    const me = c.get('me')
    const body: Me = { email: me.email, name: me.name, role: me.role, languages: [...me.languages] }
    return c.json(body)
  })
}
