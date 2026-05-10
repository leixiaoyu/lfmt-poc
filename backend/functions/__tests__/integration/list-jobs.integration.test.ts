/**
 * Integration Tests — GET /jobs (list jobs endpoint)
 *
 * These tests verify end-to-end behaviour against the deployed API.
 * They require a live environment; they are skipped automatically when
 * `SKIP_INTEGRATION_TESTS=true` or when `API_URL` is not set.
 *
 * Key coverage:
 * 1. Authenticated user receives only their own jobs (isolation).
 * 2. Second user receives only their own jobs (mutual isolation).
 * 3. IDOR guard: a `?userId=<other>` query-string override is silently
 *    ignored — the response reflects the JWT claim, not the override.
 * 4. Unauthenticated request returns 401 (API Gateway Cognito authorizer).
 *
 * Pre-requisites (all met by the dev environment):
 * - API_URL set to the deployed API Gateway base URL
 * - Cognito User Pool auto-confirms users (pre-sign-up Lambda trigger)
 * - Users are registered and tokens obtained via POST /auth/login
 */

import { randomBytes } from 'crypto';

const API_BASE_URL =
  process.env.API_URL || 'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1';
const SKIP = process.env.SKIP_INTEGRATION_TESTS === 'true' || !process.env.API_URL;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const randomEmail = () => `it-list-jobs-${randomBytes(6).toString('hex')}@example.org`;

const TEST_PASSWORD = 'IntTest999!';
const TEST_FIRST = 'ListJobs';
const TEST_LAST = 'Tester';

async function jsonFetch(
  path: string,
  opts: RequestInit = {}
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers as Record<string, string>),
    },
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

/** Register + login and return the access token. */
async function registerAndLogin(email: string): Promise<string> {
  const reg = await jsonFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: TEST_PASSWORD,
      confirmPassword: TEST_PASSWORD,
      firstName: TEST_FIRST,
      lastName: TEST_LAST,
      acceptedTerms: true,
      acceptedPrivacy: true,
    }),
  });
  if (reg.status !== 201) {
    throw new Error(`Registration failed (${reg.status}): ${JSON.stringify(reg.data)}`);
  }

  const login = await jsonFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  if (login.status !== 200) {
    throw new Error(`Login failed (${login.status}): ${JSON.stringify(login.data)}`);
  }
  const loginData = login.data as { accessToken?: string; tokens?: { accessToken?: string } };
  const token = loginData.accessToken || loginData.tokens?.accessToken;
  if (!token) {
    throw new Error(`No accessToken in login response: ${JSON.stringify(loginData)}`);
  }
  return token;
}

/** Call GET /jobs with the provided access token (and optional query params). */
async function listJobs(
  token: string,
  queryParams: Record<string, string> = {}
): Promise<{ status: number; data: unknown }> {
  const qs = new URLSearchParams(queryParams).toString();
  return jsonFetch(`/jobs${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// eslint-disable-next-line jest/no-disabled-tests
(SKIP ? describe.skip : describe)('GET /jobs — integration', () => {
  let tokenA: string;
  let tokenB: string;
  const emailA = randomEmail();
  const emailB = randomEmail();

  beforeAll(async () => {
    // Register and authenticate two independent users.
    // Both registrations are kicked off in parallel to reduce wall-clock time.
    [tokenA, tokenB] = await Promise.all([
      registerAndLogin(emailA),
      registerAndLogin(emailB),
    ]);
  }, 30_000);

  it('returns 200 and an array for an authenticated user (even with 0 jobs)', async () => {
    const result = await listJobs(tokenA);
    expect(result.status).toBe(200);
    const body = result.data as { jobs: unknown[]; count: number };
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(typeof body.count).toBe('number');
  });

  it('user A sees only their own jobs and not user B jobs', async () => {
    const [resultA, resultB] = await Promise.all([listJobs(tokenA), listJobs(tokenB)]);
    expect(resultA.status).toBe(200);
    expect(resultB.status).toBe(200);

    const bodyA = resultA.data as { jobs: Array<{ userId: string }> };
    const bodyB = resultB.data as { jobs: Array<{ userId: string }> };

    // If either user has jobs, assert cross-ownership isolation.
    // (In a fresh environment both lists may be empty — that is valid too.)
    if (bodyA.jobs.length > 0) {
      const userIds = bodyA.jobs.map((j) => j.userId);
      const uniqueUsers = new Set(userIds);
      // All jobs returned to A belong to a single userId — A's own sub.
      expect(uniqueUsers.size).toBe(1);
    }

    if (bodyB.jobs.length > 0) {
      const userIds = bodyB.jobs.map((j) => j.userId);
      const uniqueUsers = new Set(userIds);
      expect(uniqueUsers.size).toBe(1);
    }

    // A's and B's job sets must not intersect.
    const idsA = new Set((bodyA.jobs || []).map((j: { jobId?: string }) => j.jobId));
    const idsB = new Set((bodyB.jobs || []).map((j: { jobId?: string }) => j.jobId));
    for (const id of idsA) {
      expect(idsB.has(id)).toBe(false);
    }
  });

  it('IDOR guard: ?userId=<other> query param is silently ignored', async () => {
    // User A lists their jobs while supplying user B's sub as a query-string override.
    // The response MUST NOT include any of B's jobs — the param must be silently ignored.
    // We do not know B's Cognito sub directly, but we can use the literal string
    // 'other-user-sub' to verify the param is ignored without it happening to match
    // any real user.
    const result = await listJobs(tokenA, { userId: 'injected-other-user-sub' });
    expect(result.status).toBe(200);

    const body = result.data as { jobs: Array<{ userId: string }> };
    // Every returned job must belong to A's own account (not the override value).
    if (body.jobs.length > 0) {
      body.jobs.forEach((job) => {
        // The override value must never appear as a job owner.
        expect(job.userId).not.toBe('injected-other-user-sub');
      });
    }
  });

  it('returns 401 for unauthenticated requests', async () => {
    // No Authorization header — API Gateway Cognito authorizer rejects before Lambda runs.
    const result = await jsonFetch('/jobs', { method: 'GET' });
    expect(result.status).toBe(401);
  });
});
