import { KeyRound, LogOut, Save } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import type { UserRole } from "@gridproof/shared-types";
import { apiClient } from "../../lib/api-client.js";

export function AuthSettings() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(() => storedToken() ?? "");
  const [identity, setIdentity] = useState("");
  const [role, setRole] = useState<Exclude<UserRole, "public">>("reporter");
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const authQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: apiClient.authMe,
    retry: 1
  });
  const registerMutation = useMutation({
    mutationFn: () =>
      apiClient.authRegister({
        phoneOrEmail: identity.trim(),
        role,
        inviteCode: inviteCode.trim().length > 0 ? inviteCode.trim() : undefined
      }),
    onSuccess: async (session) => {
      await saveSession(session.token, `Registered ${session.user.role} session for ${session.user.phoneOrEmail}.`);
    }
  });
  const loginMutation = useMutation({
    mutationFn: () => apiClient.authLogin({ phoneOrEmail: identity.trim() }),
    onSuccess: async (session) => {
      await saveSession(session.token, `Logged in as ${session.user.role}.`);
    }
  });

  const user = authQuery.data?.user ?? null;
  const envTokenActive = hasEnvDemoToken();
  const storageAvailable = typeof localStorage !== "undefined";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!storageAvailable) {
      setMessage("Token storage is not available in this browser context.");
      return;
    }

    const trimmed = token.trim();
    if (trimmed.length === 0) {
      localStorage.removeItem(apiClient.authTokenStorageKey);
      setMessage("Local auth token cleared.");
    } else {
      localStorage.setItem(apiClient.authTokenStorageKey, trimmed);
      setMessage("Local auth token saved.");
    }
    await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
  }

  async function clearToken() {
    setToken("");
    setMessage(null);
    if (storageAvailable) {
      localStorage.removeItem(apiClient.authTokenStorageKey);
      setMessage("Local auth token cleared.");
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    }
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    registerMutation.mutate();
  }

  async function login() {
    setMessage(null);
    loginMutation.mutate();
  }

  async function saveSession(sessionToken: string, successMessage: string) {
    if (!storageAvailable) {
      setMessage("Token storage is not available in this browser context.");
      return;
    }

    localStorage.setItem(apiClient.authTokenStorageKey, sessionToken);
    setToken(sessionToken);
    setMessage(successMessage);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["auth-me"] }),
      queryClient.invalidateQueries({ queryKey: ["review-queue"] }),
      queryClient.invalidateQueries({ queryKey: ["notifications"] })
    ]);
  }

  return (
    <main className="shell narrow">
      <section className="topbar" aria-label="Settings heading">
        <div>
          <p className="eyebrow">Auth bridge</p>
          <h1>Settings</h1>
        </div>
        <div className="health-pill">
          <KeyRound size={18} aria-hidden="true" />
          <span>{user ? user.role : "Public"}</span>
        </div>
      </section>

      <section className="proof-panel provider-form settings-panel">
        <div>
          <p className="eyebrow">Current session</p>
          <h2>{user ? "Authenticated" : "Public access"}</h2>
          {authQuery.isLoading ? <p className="status-message">Checking current token…</p> : null}
          {authQuery.isError ? (
            <p className="status-message error">Token verification failed. Save a valid Supabase-compatible JWT.</p>
          ) : null}
          {!authQuery.isLoading && !authQuery.isError ? (
            <dl>
              <div>
                <dt>Role</dt>
                <dd>{user?.role ?? "public"}</dd>
              </div>
              <div>
                <dt>Identity</dt>
                <dd className="mono">{user?.phoneOrEmail ?? "anonymous"}</dd>
              </div>
              <div>
                <dt>Token source</dt>
                <dd>{envTokenActive ? "VITE_DEMO_AUTH_TOKEN" : storedToken() ? "localStorage" : "none"}</dd>
              </div>
            </dl>
          ) : null}
        </div>

        <form className="provider-form" onSubmit={save}>
          <label className="field">
            Local bearer JWT
            <textarea
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste a reviewer/admin/report token for local demo flows"
              rows={6}
              value={token}
            />
          </label>
          <div className="action-row">
            <button type="submit">
              <Save size={18} aria-hidden="true" />
              Save token
            </button>
            <button onClick={clearToken} type="button">
              <LogOut size={18} aria-hidden="true" />
              Clear local token
            </button>
          </div>
        </form>

        {envTokenActive ? (
          <p className="status-message">
            An environment demo token is active and takes precedence over localStorage for API and realtime calls.
          </p>
        ) : null}
        {message ? <p className="status-message">{message}</p> : null}
      </section>

      <section className="proof-panel provider-form settings-panel">
        <div>
          <p className="eyebrow">Demo session</p>
          <h2>Register or log in</h2>
          <p>
            Create a reporter token for fallback evidence flows, or use an invite code to issue reviewer/admin demo
            sessions.
          </p>
        </div>

        <form className="provider-form" onSubmit={register}>
          <label className="field">
            Email or phone
            <input
              onChange={(event) => setIdentity(event.target.value)}
              placeholder="reporter@gridproof.test"
              required
              value={identity}
            />
          </label>
          <label className="field">
            Role
            <select
              onChange={(event) => setRole(event.target.value as Exclude<UserRole, "public">)}
              value={role}
            >
              <option value="reporter">Reporter</option>
              <option value="reviewer">Reviewer</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label className="field">
            Invite code
            <input
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="Required for reviewer/admin"
              value={inviteCode}
            />
          </label>
          <div className="action-row">
            <button disabled={registerMutation.isPending || identity.trim().length === 0} type="submit">
              <Save size={18} aria-hidden="true" />
              Register & save token
            </button>
            <button
              disabled={loginMutation.isPending || identity.trim().length === 0}
              onClick={login}
              type="button"
            >
              <KeyRound size={18} aria-hidden="true" />
              Login & save token
            </button>
          </div>
        </form>

        {registerMutation.isError ? (
          <p className="status-message error">Registration failed. Reviewer/admin roles require a valid invite code.</p>
        ) : null}
        {loginMutation.isError ? (
          <p className="status-message error">Login failed. Register this email or phone first.</p>
        ) : null}
      </section>
    </main>
  );
}

function storedToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(apiClient.authTokenStorageKey);
}

function hasEnvDemoToken(): boolean {
  const envToken = import.meta.env.VITE_DEMO_AUTH_TOKEN;
  return typeof envToken === "string" && envToken.length > 0;
}
