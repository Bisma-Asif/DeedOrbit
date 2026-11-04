/**
 * Government identity-verification adapters — pluggable, manual-only by default.
 *
 * A "verified against NADRA" stamp is the single most load-bearing claim this
 * module can make, so the default provider is one that reaches *nobody*: it
 * returns null, and the route then refuses to write any provider-verified state.
 * Until a real endpoint is configured and returns a genuine success, a document
 * can only ever be stamped "Manually verified by {user}" — never a government
 * check the platform did not perform.
 *
 * Wiring a real service is a matter of adding a provider to the registry (or
 * configuring a `generic` HTTP one in the identity-provider settings); the
 * honesty rule lives here — no response, no claim.
 */

/** The three facts a live check is run against. */

export interface IdentityVerifyInput {
  /** Normalised 13-digit CNIC. */

  cnic: string

  name?: string | null

  dob?: string | null
}

/** A provider's answer. `ok` is the provider's verdict, `raw` is kept for audit. */

export interface IdentityVerifyResult {
  ok: boolean

  /** The provider's own reference for the check, stored as `provider_ref`. */

  ref: string

  /** The raw response body, stored encrypted as `provider_response_enc`. */

  raw: string
}

export interface IdentityProvider {
  id: string

  /**
   * Runs the check. Resolves to a result only when the service actually answered;
   * null means "no live verification happened" — the caller must not mark the
   * document provider-verified on a null.
   */

  verify(input: IdentityVerifyInput): Promise<IdentityVerifyResult | null>
}

/** Configuration a constructed HTTP provider needs to talk to a service. */

export interface IdentityProviderConfig {
  id: string

  endpoint: string

  /** A decrypted bearer/key; never logged, never echoed to a client. */

  credential: string | null
}

/** The shape a generic provider expects back from a live check. */

interface GenericVerifyResponse {
  ok?: boolean

  ref?: string
}

/**
 * The default provider: reaches nobody, answers nothing. Selected whenever no
 * real service is configured, which is every fresh install and every test run.
 */

export const manualIdentityProvider: IdentityProvider = {
  id: "manual",

  async verify(): Promise<IdentityVerifyResult | null> {
    return null
  },
}

/** A named, code-supplied provider that a deployment can register directly. */

const REGISTRY: Record<string, IdentityProvider> = {
  manual: manualIdentityProvider,
}

export function registerIdentityProvider(provider: IdentityProvider): void {
  REGISTRY[provider.id] = provider
}

/**
 * Builds a generic HTTP provider from a settings row. It POSTs the identity and
 * reads back `{ ok, ref }` from the response; any transport or parse failure is
 * a null, never an invented pass, and never a pass read off a malformed body.
 *
 * There is no dependency: `fetch` is global on Node 24. A short timeout keeps a
 * dead endpoint from hanging the reviewer's request.
 */

export function makeGenericProvider(
  config: IdentityProviderConfig,
): IdentityProvider {
  return {
    id: config.id,

    async verify(
      input: IdentityVerifyInput,
    ): Promise<IdentityVerifyResult | null> {
      const controller = new AbortController()

      const timer = setTimeout(() => controller.abort(), 8000)

      try {
        const response = await fetch(config.endpoint, {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            ...(config.credential
              ? { Authorization: `Bearer ${config.credential}` }
              : {}),
          },

          body: JSON.stringify({
            cnic: input.cnic,

            name: input.name ?? null,

            dob: input.dob ?? null,
          }),

          signal: controller.signal,
        })

        const text = await response.text()

        if (!response.ok) return { ok: false, ref: "", raw: text }

        let parsed: GenericVerifyResponse

        try {
          parsed = (JSON.parse(text) as GenericVerifyResponse)
        } catch {
          // A body that is not JSON is not a verification — refuse rather than guess.

          return null
        }

        return {
          ok: parsed.ok === true,

          ref: typeof parsed.ref === "string" ? parsed.ref : "",

          raw: text,
        }
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/**
 * Resolves the provider to use for a tenant.
 *
 * With no enabled config, or an id that has no registered implementation and is
 * not a usable `generic`/`nadra_verisys` HTTP endpoint, this returns the manual
 * provider — so the route's "no live provider" path is the default outcome, and
 * a misconfiguration can never produce a false government pass.
 */

export function resolveIdentityProvider(
  config: IdentityProviderConfig | null,
): IdentityProvider {
  if (!config) return manualIdentityProvider

  const registered = REGISTRY[config.id]

  if (registered) return registered

  if (
    (config.id === "generic" || config.id === "nadra_verisys") &&
    /^https?:\/\//i.test(config.endpoint)
  ) {
    return makeGenericProvider(config)
  }

  return manualIdentityProvider
}
