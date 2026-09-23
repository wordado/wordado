import { generateVapidKeys } from '../src/reminders/vapid'

/** Prints a VAPID key pair for server/.dev.vars locally, or for the Worker's secrets (plan 7). */
const keys = await generateVapidKeys('mailto:reminders@wordado.com')
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=${keys.subject}`)
