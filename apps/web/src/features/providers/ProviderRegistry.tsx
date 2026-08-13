import { RadioTower, UserPlus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import type { RegisterProviderRequest } from "@gridproof/shared-types";
import { apiClient } from "../../lib/api-client.js";
import { PageHeader, PanelHeader } from "../../components/PageHeader.js";

const initialForm: RegisterProviderRequest = {
  walletAddress: "",
  providerType: "reporter",
  zoneId: ""
};

export function ProviderRegistry() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initialForm);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: apiClient.providers,
    retry: 1
  });
  const registerProvider = useMutation({
    mutationFn: (input: RegisterProviderRequest) => apiClient.registerProvider(input),
    onSuccess: async (result) => {
      setLastResult(providerRegistrationMessage(result));
      setForm(initialForm);
      await queryClient.invalidateQueries({ queryKey: ["providers"] });
    }
  });

  const providers = providersQuery.data?.providers ?? [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLastResult(null);
    registerProvider.mutate({
      walletAddress: form.walletAddress,
      providerType: form.providerType,
      zoneId: form.zoneId
    });
  }

  return (
    <main className="shell">
      <PageHeader
        title="Provider Registry"
        description="Manage the sensor nodes and human reporters authorised to submit feeder evidence."
        status={<div className="health-pill">
          <RadioTower size={18} aria-hidden="true" />
          <span>{providers.length} registered</span>
        </div>}
      />

      <section className="dashboard-grid provider-grid">
        <form className="proof-panel provider-form" onSubmit={submit}>
          <PanelHeader title="Register provider" description="Add a sensor node or authorised human reporter." />
          <label className="field">
            Wallet address
            <input
              onChange={(event) => setForm((current) => ({ ...current, walletAddress: event.target.value }))}
              placeholder="0x…"
              required
              value={form.walletAddress}
            />
          </label>
          <label className="field">
            Provider type
            <select
              onChange={(event) =>
                setForm((current) => ({ ...current, providerType: event.target.value as "sensor" | "reporter" }))
              }
              value={form.providerType}
            >
              <option value="reporter">Human reporter</option>
              <option value="sensor">Sensor node</option>
            </select>
          </label>
          <label className="field">
            Zone UUID
            <input
              onChange={(event) => setForm((current) => ({ ...current, zoneId: event.target.value }))}
              placeholder="8a27f3e2-2608-4a88-b8db-efce68be2a59"
              required
              value={form.zoneId}
            />
          </label>
          <div className="action-row">
            <button
              disabled={registerProvider.isPending || form.walletAddress.length === 0 || form.zoneId.length === 0}
              type="submit"
            >
              <UserPlus size={18} aria-hidden="true" />
              {registerProvider.isPending ? "Registering…" : "Register provider"}
            </button>
          </div>
          {lastResult ? <p className="status-message">{lastResult}</p> : null}
          {registerProvider.isError ? (
            <p className="status-message error">Registration failed. Check the wallet, zone, and auth token.</p>
          ) : null}
        </form>

        <section className="zone-panel provider-list" aria-label="Registered providers">
          <PanelHeader title="Evidence sources" description="Registered providers and their current availability." />
          {providersQuery.isLoading ? <p className="status-message">Loading providers…</p> : null}
          {providersQuery.isError ? <p className="status-message error">Could not load providers.</p> : null}
          {!providersQuery.isLoading && !providersQuery.isError && providers.length === 0 ? (
            <p className="status-message">No providers registered yet. Add one to prepare a demo zone.</p>
          ) : null}
          <div className="provider-cards">
            {providers.map((provider) => (
              <article className="provider-card" key={provider.id}>
                <div>
                  <strong>{provider.providerType === "sensor" ? "Sensor node" : "Human reporter"}</strong>
                  <span className={provider.active ? "status-badge active" : "status-badge"}>{provider.active ? "Active" : "Inactive"}</span>
                </div>
                <p className="mono">{provider.walletAddress}</p>
                <dl>
                  <div>
                    <dt>Zone</dt>
                    <dd className="mono">{provider.zoneId}</dd>
                  </div>
                  <div>
                    <dt>Reputation</dt>
                    <dd>{provider.reputationCache}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function providerRegistrationMessage(result: Awaited<ReturnType<typeof apiClient.registerProvider>>): string {
  const base = result.duplicate ? "Provider already registered." : "Provider registration saved.";
  const registration = result.chainRegistration;

  if (!registration.configured) {
    return `${base} On-chain registry not configured yet; save BOTCHAIN_NODE_REGISTRY_ADDRESS and BOTCHAIN_CHAIN_ID after deployment.`;
  }

  if (registration.onChain?.matchesRequest) {
    return `${base} NodeRegistry already matches this provider wallet and zone.`;
  }

  return `${base} On-chain step: open the provider wallet and call NodeRegistry.register(${registration.zoneKey}, ${registration.providerTypeId}).`;
}
