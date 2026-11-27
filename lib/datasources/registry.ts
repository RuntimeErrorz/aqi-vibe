import type { ProviderId } from '../types';
import type {
  AirQualityProvider,
  ProviderRuntimeContext,
  ProviderSecrets,
} from './types';
import { DEFAULT_WAQI_TOKENS, parseWaqiTokens } from '../services/cf-ranking-engine';

interface CircuitState {
  failures: number;
  openUntilMs: number;
  lastError?: string;
}

const FAILURE_THRESHOLD = 3;
const DEFAULT_OPEN_MS = 5 * 60 * 1000; // 5 min cooldown on transient failures / 429
const AUTH_OPEN_MS = 15 * 60 * 1000;   // 15 min cooldown on 401/403 invalid key

export class ProviderCircuitBreaker {
  private readonly states = new Map<ProviderId, CircuitState>();

  isOpen(id: ProviderId, nowMs = Date.now()): boolean {
    const st = this.states.get(id);
    if (!st) return false;
    if (st.openUntilMs > nowMs) return true;
    if (st.openUntilMs > 0 && st.openUntilMs <= nowMs) {
      // Half-open recovery: reset failure counter so provider gets a fresh chance
      this.states.delete(id);
    }
    return false;
  }

  recordSuccess(id: ProviderId): void {
    this.states.delete(id);
  }

  recordFailure(
    id: ProviderId,
    options?: { status?: number; message?: string; nowMs?: number }
  ): void {
    const nowMs = options?.nowMs ?? Date.now();
    const status = options?.status;
    const prev = this.states.get(id) || { failures: 0, openUntilMs: 0 };

    // Auth failures or explicit 429 rate-limit immediately trip the breaker
    if (status === 401 || status === 403) {
      this.states.set(id, {
        failures: FAILURE_THRESHOLD,
        openUntilMs: nowMs + AUTH_OPEN_MS,
        lastError: options?.message || `HTTP ${status}`,
      });
      return;
    }

    if (status === 429) {
      this.states.set(id, {
        failures: FAILURE_THRESHOLD,
        openUntilMs: nowMs + DEFAULT_OPEN_MS,
        lastError: options?.message || 'HTTP 429 rate limited',
      });
      return;
    }

    const nextFailures = prev.failures + 1;
    this.states.set(id, {
      failures: nextFailures,
      openUntilMs: nextFailures >= FAILURE_THRESHOLD ? nowMs + DEFAULT_OPEN_MS : 0,
      lastError: options?.message,
    });
  }

  reset(id?: ProviderId): void {
    if (id) {
      this.states.delete(id);
    } else {
      this.states.clear();
    }
  }

  snapshot(nowMs = Date.now()): Record<string, { open: boolean; failures: number; lastError?: string }> {
    const out: Record<string, { open: boolean; failures: number; lastError?: string }> = {};
    this.states.forEach((st, id) => {
      out[id] = {
        open: st.openUntilMs > nowMs,
        failures: st.failures,
        lastError: st.lastError,
      };
    });
    return out;
  }
}

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, AirQualityProvider>();
  readonly breaker = new ProviderCircuitBreaker();

  register(provider: AirQualityProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: ProviderId): AirQualityProvider | undefined {
    return this.providers.get(id);
  }

  list(): AirQualityProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Resolve candidate providers in order, filtering out unconfigured, browser-incompatible,
   * region-unsupported, or currently circuit-broken providers.
   */
  resolveCandidates(
    preferredOrder: readonly ProviderId[],
    countryCode: string | undefined,
    ctx: ProviderRuntimeContext,
    requiredCapability: keyof Pick<
      AirQualityProvider,
      'realtime' | 'stationDetail' | 'bounds' | 'hourlyTrend' | 'forecast' | 'mapTiles'
    >
  ): AirQualityProvider[] {
    const upperCountry = (countryCode || '').toUpperCase();
    const isBrowser = !ctx.isServer && typeof window !== 'undefined';
    const result: AirQualityProvider[] = [];
    const seen = new Set<ProviderId>();

    for (const id of preferredOrder) {
      if (seen.has(id)) continue;
      seen.add(id);

      const provider = this.providers.get(id);
      if (!provider) continue;
      if (!provider[requiredCapability]) continue;
      if (isBrowser && !provider.supportsBrowserDirect) continue;
      if (
        provider.supportedCountries !== '*' &&
        upperCountry &&
        !provider.supportedCountries.includes(upperCountry)
      ) {
        continue;
      }
      if (this.breaker.isOpen(id, ctx.nowMs)) continue;
      if (!provider.isAvailable(ctx)) continue;

      result.push(provider);
    }

    return result;
  }
}

export interface RawEnvBag {
  WAQI_TOKENS?: string;
  NEXT_PUBLIC_WAQI_TOKEN?: string;
  QWEATHER_API_HOST?: string;
  QWEATHER_API_KEY?: string;
  QWEATHER_JWT?: string;
  QWEATHER_DEVELOPER_ID?: string;
  QWEATHER_PROJECT_ID?: string;
  QWEATHER_CREDENTIAL_ID?: string;
  QWEATHER_PRIVATE_KEY?: string;
  CAIYUN_API_TOKEN?: string;
  OPENAQ_API_KEY?: string;
  AIRNOW_API_KEY?: string;
  GOOGLE_AQ_API_KEY?: string;
  MOENV_API_KEY?: string;
  OPENWEATHER_API_KEY?: string;
}

/**
 * Extract ProviderSecrets from Cloudflare Worker `env` or Node `process.env`.
 * IMPORTANT: Never use `{ ...rawEnv }` object spread on Cloudflare Worker `env`,
 * because `workerd` host-object bindings/secrets may be non-enumerable getters!
 * Always read each known key explicitly.
 */
export function resolveProviderSecrets(rawEnv?: RawEnvBag): ProviderSecrets {
  const procEnv: RawEnvBag =
    typeof process !== 'undefined' && process.env ? (process.env as unknown as RawEnvBag) : {};

  const pick = <K extends keyof RawEnvBag>(key: K): string | undefined => {
    const fromRaw = rawEnv ? rawEnv[key] : undefined;
    if (typeof fromRaw === 'string' && fromRaw.trim().length > 0) return fromRaw;
    const fromProc = procEnv[key];
    return typeof fromProc === 'string' && fromProc.trim().length > 0 ? fromProc : undefined;
  };

  const waqiRaw = pick('WAQI_TOKENS') || pick('NEXT_PUBLIC_WAQI_TOKEN');
  const waqiTokens = waqiRaw ? parseWaqiTokens(waqiRaw) : [...DEFAULT_WAQI_TOKENS];

  const clean = (v?: string): string | undefined => {
    const t = v?.trim();
    if (!t || t.startsWith('your_') || t === 'CHANGE_ME') return undefined;
    return t;
  };

  return {
    waqiTokens,
    qweatherHost: clean(pick('QWEATHER_API_HOST'))?.replace(/\/+$/, ''),
    qweatherApiKey: clean(pick('QWEATHER_API_KEY')),
    qweatherJwt: clean(pick('QWEATHER_JWT')),
    qweatherDeveloperId: clean(pick('QWEATHER_DEVELOPER_ID')),
    qweatherProjectId: clean(pick('QWEATHER_PROJECT_ID')),
    qweatherCredentialId: clean(pick('QWEATHER_CREDENTIAL_ID')),
    qweatherPrivateKey: clean(pick('QWEATHER_PRIVATE_KEY'))?.replace(/\\n/g, '\n'),
    caiyunToken: clean(pick('CAIYUN_API_TOKEN')),
    openaqApiKey: clean(pick('OPENAQ_API_KEY')),
    airnowApiKey: clean(pick('AIRNOW_API_KEY')),
    googleAqApiKey: clean(pick('GOOGLE_AQ_API_KEY')),
    moenvApiKey: clean(pick('MOENV_API_KEY')),
    openweatherApiKey: clean(pick('OPENWEATHER_API_KEY')),
  };
}
