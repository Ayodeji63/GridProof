import { readFileSync } from "node:fs";
import { Wallet, JsonRpcProvider, Contract, id, formatEther } from "ethers";

const env: Record<string, string> = Object.fromEntries(
  readFileSync(new URL("./.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
);

const provider = new JsonRpcProvider(env.BOTCHAIN_RPC_URL);
const wallet = new Wallet(env.RELAYER_PRIVATE_KEY, provider);

console.log("relayer address :", wallet.address);
console.log("chainId         :", (await provider.getNetwork()).chainId.toString());
console.log("balance         :", formatEther(await provider.getBalance(wallet.address)), "native");

const attestation = new Contract(
  env.BOTCHAIN_UPTIME_ATTESTATION_ADDRESS,
  [
    "function hasRole(bytes32,address) view returns (bool)",
    "function paused() view returns (bool)",
    "function epochDuration() view returns (uint64)"
  ],
  provider
);

console.log("has RELAYER_ROLE:", await attestation.hasRole(id("RELAYER_ROLE"), wallet.address));
console.log("paused          :", await attestation.paused());
console.log("epochDuration   :", (await attestation.epochDuration()).toString(), "s");
