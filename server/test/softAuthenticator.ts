import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { cose, isoBase64URL, isoCBOR, isoUint8Array } from '@simplewebauthn/server/helpers'

/** User present, user verified, attested credential data included (WebAuthn §6.1). */
const UP = 0x01
const UV = 0x04
const AT = 0x40

/** Bytes on a plain ArrayBuffer, as the helpers take them. */
type Bytes = Uint8Array<ArrayBuffer>

interface Credential {
  readonly id: Bytes
  readonly privateKey: KeyObject
  readonly userHandle: string
}

export interface SoftAuthenticator {
  /** What `navigator.credentials.create` gives the page for these options. */
  register(options: PublicKeyCredentialCreationOptionsJSON): RegistrationResponseJSON
  /** What `navigator.credentials.get` gives the page for these options. */
  authenticate(options: PublicKeyCredentialRequestOptionsJSON): AuthenticationResponseJSON
  /** The ids of the credentials it holds, base64url, oldest first. */
  readonly credentialIds: readonly string[]
  /** The same keys, answering a page at another origin, as a relayed (phished) ceremony would. */
  at(origin: string): SoftAuthenticator
}

const sha256 = (data: Bytes): Bytes => new Uint8Array(createHash('sha256').update(data).digest())

const u16 = (n: number): Bytes => new Uint8Array([(n >> 8) & 0xff, n & 0xff])

const clientData = (type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string): Bytes =>
  isoUint8Array.fromUTF8String(JSON.stringify({ type, challenge, origin, crossOrigin: false }))

/**
 * A platform authenticator in software, for driving the passkey endpoints in tests: a P-256 key per credential,
 * `none` attestation, user verified on every ceremony, the counter always 0 (as synced passkeys report), an
 * all-zero AAGUID. Every credential is discoverable. It refuses options for another relying party, as a device does.
 */
export function softAuthenticator(rpId: string, origin: string): SoftAuthenticator {
  return device(rpId, origin, [])
}

function device(rpId: string, origin: string, credentials: Credential[]): SoftAuthenticator {
  const rpIdHash = sha256(isoUint8Array.fromUTF8String(rpId))
  const counter = new Uint8Array(4)

  return {
    get credentialIds() {
      return credentials.map((c) => isoBase64URL.fromBuffer(c.id))
    },

    at: (other) => device(rpId, other, credentials),

    register(options) {
      if (options.rp.id !== rpId) throw new Error(`soft authenticator: relying party ${options.rp.id ?? '(none)'}, not ${rpId}`)
      if (!options.pubKeyCredParams.some((p) => p.alg === cose.COSEALG.ES256)) throw new Error('soft authenticator: ES256 not offered')
      const excluded = new Set((options.excludeCredentials ?? []).map((c) => c.id))
      if (credentials.some((c) => excluded.has(isoBase64URL.fromBuffer(c.id)))) throw new Error('soft authenticator: already registered (InvalidStateError)')

      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const jwk = publicKey.export({ format: 'jwk' })
      const coseKey = new Map<number, number | Bytes>([
        [cose.COSEKEYS.kty, cose.COSEKTY.EC2],
        [cose.COSEKEYS.alg, cose.COSEALG.ES256],
        [cose.COSEKEYS.crv, cose.COSECRV.P256],
        [cose.COSEKEYS.x, isoBase64URL.toBuffer(jwk.x!)],
        [cose.COSEKEYS.y, isoBase64URL.toBuffer(jwk.y!)],
      ])
      const id = new Uint8Array(randomBytes(16))
      const authData = isoUint8Array.concat([rpIdHash, new Uint8Array([UP | UV | AT]), counter, new Uint8Array(16), u16(id.length), id, isoCBOR.encode(coseKey)])
      const attestationObject = isoCBOR.encode(
        new Map<string, string | Bytes | Map<string, string>>([
          ['fmt', 'none'],
          ['attStmt', new Map<string, string>()],
          ['authData', authData],
        ]),
      )
      credentials.push({ id, privateKey, userHandle: options.user.id })

      const credentialId = isoBase64URL.fromBuffer(id)
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(clientData('webauthn.create', options.challenge, origin)),
          attestationObject: isoBase64URL.fromBuffer(attestationObject),
          transports: ['internal'],
        },
        authenticatorAttachment: 'platform',
        clientExtensionResults: {},
      }
    },

    authenticate(options) {
      if (options.rpId !== undefined && options.rpId !== rpId) throw new Error(`soft authenticator: relying party ${options.rpId}, not ${rpId}`)
      const allowed = (options.allowCredentials ?? []).map((c) => c.id)
      // With no list, the request is for a discoverable credential: the device offers the one it has.
      const credential = allowed.length === 0 ? credentials.at(-1) : credentials.find((c) => allowed.includes(isoBase64URL.fromBuffer(c.id)))
      if (!credential) throw new Error('soft authenticator: no credential for this request (NotAllowedError)')

      const authData = isoUint8Array.concat([rpIdHash, new Uint8Array([UP | UV]), counter])
      const clientDataJSON = clientData('webauthn.get', options.challenge, origin)
      // ECDSA in DER, as WebAuthn carries it.
      const signature = sign('sha256', isoUint8Array.concat([authData, sha256(clientDataJSON)]), credential.privateKey)

      const credentialId = isoBase64URL.fromBuffer(credential.id)
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
          authenticatorData: isoBase64URL.fromBuffer(authData),
          signature: isoBase64URL.fromBuffer(new Uint8Array(signature)),
          userHandle: credential.userHandle,
        },
        authenticatorAttachment: 'platform',
        clientExtensionResults: {},
      }
    },
  }
}
