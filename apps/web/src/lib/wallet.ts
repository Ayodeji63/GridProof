type EthereumProvider = {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
};

export function injectedWallet(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  const ethereum = (window as typeof window & { ethereum?: EthereumProvider }).ethereum;
  return ethereum ?? null;
}

export async function connectInjectedWallet(): Promise<string> {
  const provider = injectedWallet();
  if (!provider) throw new Error("No browser wallet detected. Install MetaMask or another EVM wallet to continue.");
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const address = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
  if (!address) throw new Error("The wallet did not return an account.");
  return address;
}

export async function signWalletMessage(address: string, message: string): Promise<string> {
  const provider = injectedWallet();
  if (!provider) throw new Error("The connected wallet is no longer available.");
  const signature = await provider.request({ method: "personal_sign", params: [message, address] });
  if (typeof signature !== "string") throw new Error("The wallet did not return a signature.");
  return signature;
}
