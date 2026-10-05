import { createApp } from './app'
import type { Env } from './bindings'

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    return createApp({ env, fetch: (input, init) => fetch(input, init), now: () => new Date(), log: (line) => console.log(line) }).fetch(request)
  },
}
