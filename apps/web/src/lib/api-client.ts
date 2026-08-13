import {
  alertsResponseSchema,
  authLoginRequestSchema,
  authMeResponseSchema,
  authRegisterRequestSchema,
  authSessionResponseSchema,
  healthResponseSchema,
  ingestResponseSchema,
  metricsResponseSchema,
  notificationsResponseSchema,
  demoSimulationRequestSchema,
  demoSimulationResponseSchema,
  demoWalletChallengeRequestSchema,
  demoWalletChallengeResponseSchema,
  proofResponseSchema,
  readinessResponseSchema,
  providersResponseSchema,
  registerProviderResponseSchema,
  reporterIngestRequestSchema,
  reviewDecisionResponseSchema,
  reviewQueueResponseSchema,
  zoneHistoryResponseSchema,
  zonesResponseSchema,
  type AlertsResponse,
  type AuthLoginRequest,
  type AuthMeResponse,
  type AuthRegisterRequest,
  type AuthSessionResponse,
  type HealthResponse,
  type IngestResponse,
  type MetricsResponse,
  type NotificationsResponse,
  type DemoSimulationRequest,
  type DemoSimulationResponse,
  type DemoWalletChallengeRequest,
  type DemoWalletChallengeResponse,
  type ProofResponse,
  type ReadinessResponse,
  type ProvidersResponse,
  type RegisterProviderRequest,
  type RegisterProviderResponse,
  type ReporterIngestRequest,
  type ReviewDecisionRequest,
  type ReviewDecisionResponse,
  type ReviewQueueResponse,
  type ZoneHistoryResponse,
  type ZonesResponse
} from "@gridproof/shared-types";
import { ApiError } from "./api-error.js";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";
const authTokenStorageKey = "gridproof.authToken";

async function getJson<T>(path: string, parse: (value: unknown) => T, allowedErrorStatuses: number[] = []): Promise<T> {
  const url = `${apiBaseUrl}${path}`;
  const init = authInit();
  const response = init ? await fetch(url, init) : await fetch(url);
  if (!response.ok && !allowedErrorStatuses.includes(response.status)) {
    throw await apiError(response);
  }

  return parse(await response.json());
}

async function postJson<T>(
  path: string,
  body: unknown,
  parse: (value: unknown) => T
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw await apiError(response);
  }

  return parse(await response.json());
}

export const apiClient = {
  authTokenStorageKey,
  authMe: (): Promise<AuthMeResponse> => getJson("/auth/me", (value) => authMeResponseSchema.parse(value)),
  authRegister: (body: AuthRegisterRequest): Promise<AuthSessionResponse> =>
    postJson("/auth/register", authRegisterRequestSchema.parse(body), (value) => authSessionResponseSchema.parse(value)),
  authLogin: (body: AuthLoginRequest): Promise<AuthSessionResponse> =>
    postJson("/auth/login", authLoginRequestSchema.parse(body), (value) => authSessionResponseSchema.parse(value)),
  health: (): Promise<HealthResponse> => getJson("/health", (value) => healthResponseSchema.parse(value)),
  metrics: (): Promise<MetricsResponse> => getJson("/metrics", (value) => metricsResponseSchema.parse(value)),
  readiness: (): Promise<ReadinessResponse> =>
    getJson("/readiness", (value) => readinessResponseSchema.parse(value), [503]),
  alerts: (): Promise<AlertsResponse> => getJson("/alerts", (value) => alertsResponseSchema.parse(value)),
  zones: (): Promise<ZonesResponse> => getJson("/zones", (value) => zonesResponseSchema.parse(value)),
  zoneHistory: (zoneId: string): Promise<ZoneHistoryResponse> =>
    getJson(`/zones/${zoneId}/history`, (value) => zoneHistoryResponseSchema.parse(value)),
  providers: (): Promise<ProvidersResponse> =>
    getJson("/providers", (value) => providersResponseSchema.parse(value)),
  registerProvider: (body: RegisterProviderRequest): Promise<RegisterProviderResponse> =>
    postJson("/providers", body, (value) => registerProviderResponseSchema.parse(value)),
  submitReport: (body: ReporterIngestRequest): Promise<IngestResponse> =>
    postJson("/ingest/report", reporterIngestRequestSchema.parse(body), (value) => ingestResponseSchema.parse(value)),
  notifications: (): Promise<NotificationsResponse> =>
    getJson("/admin/notifications", (value) => notificationsResponseSchema.parse(value)),
  demoWalletChallenge: (body: DemoWalletChallengeRequest): Promise<DemoWalletChallengeResponse> =>
    postJson(
      "/demo/wallet-challenge",
      demoWalletChallengeRequestSchema.parse(body),
      (value) => demoWalletChallengeResponseSchema.parse(value)
    ),
  runDemoSimulation: (body: DemoSimulationRequest): Promise<DemoSimulationResponse> =>
    postJson(
      "/demo/simulations",
      demoSimulationRequestSchema.parse(body),
      (value) => demoSimulationResponseSchema.parse(value)
    ),
  demoSimulation: (id: string): Promise<DemoSimulationResponse> =>
    getJson(`/demo/simulations/${id}`, (value) => demoSimulationResponseSchema.parse(value)),
  proof: (zoneId: string, epoch: string): Promise<ProofResponse> =>
    getJson(`/chain/proof/${zoneId}/${epoch}`, (value) => proofResponseSchema.parse(value)),
  reviewQueue: (): Promise<ReviewQueueResponse> =>
    getJson("/admin/review-queue", (value) => reviewQueueResponseSchema.parse(value)),
  resolveReview: (reviewId: string, body: ReviewDecisionRequest): Promise<ReviewDecisionResponse> =>
    postJson(`/admin/review/${reviewId}/decision`, body, (value) => reviewDecisionResponseSchema.parse(value))
};

function authInit(): RequestInit | undefined {
  const headers = authHeaders();
  return Object.keys(headers).length > 0 ? { headers } : undefined;
}

function authHeaders(): Record<string, string> {
  const token = authToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function authToken(): string | null {
  const envToken = import.meta.env.VITE_DEMO_AUTH_TOKEN;
  if (typeof envToken === "string" && envToken.length > 0) return envToken;

  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(authTokenStorageKey);
}

async function apiError(response: Response): Promise<ApiError> {
  let code: string | null = null;
  let message = `GridProof API request failed: ${response.status}`;

  try {
    const body = await response.clone().json() as { error?: { code?: unknown; message?: unknown } };
    if (typeof body.error?.code === "string") code = body.error.code;
    if (typeof body.error?.message === "string") message = body.error.message;
  } catch {
    // Preserve the status-based fallback when the upstream response is not JSON.
  }

  return new ApiError(response.status, code, message);
}
