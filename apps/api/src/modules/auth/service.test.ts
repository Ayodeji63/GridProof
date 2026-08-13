import { afterEach, describe, expect, it } from "vitest";
import { clearAuditLogStore, listMemoryAuditLogs } from "../audit/service.js";
import { clearAuthStore, findUserForLogin, registerUser } from "./service.js";

describe("auth service", () => {
  afterEach(() => {
    clearAuthStore();
    clearAuditLogStore();
    delete process.env.DATABASE_URL;
    delete process.env.GRIDPROOF_AUTH_INVITE_CODE;
  });

  it("normalizes reporter identities and supports demo login lookup", async () => {
    const user = await registerUser({ phoneOrEmail: " Reporter@GridProof.test ", role: "reporter" });
    const loginUser = await findUserForLogin("REPORTER@gridproof.test");

    expect(user.phoneOrEmail).toBe("reporter@gridproof.test");
    expect(loginUser).toEqual(user);
    expect(listMemoryAuditLogs("user.registered")).toHaveLength(1);
  });

  it("returns an existing demo user instead of creating duplicate audit entries", async () => {
    const first = await registerUser({ phoneOrEmail: "+2348012345678", role: "reporter" });
    const second = await registerUser({ phoneOrEmail: " +2348012345678 ", role: "reporter" });

    expect(second).toEqual(first);
    expect(listMemoryAuditLogs("user.registered")).toHaveLength(1);
  });

  it("requires the configured invite code for reviewer and admin accounts", async () => {
    await expect(registerUser({ phoneOrEmail: "reviewer@gridproof.test", role: "reviewer" })).rejects.toMatchObject({
      code: "INVITE_REQUIRED",
      statusCode: 403
    });

    process.env.GRIDPROOF_AUTH_INVITE_CODE = "demo-invite";
    const reviewer = await registerUser({
      phoneOrEmail: "reviewer@gridproof.test",
      role: "reviewer",
      inviteCode: "demo-invite"
    });
    const admin = await registerUser({
      phoneOrEmail: "admin@gridproof.test",
      role: "admin",
      inviteCode: "demo-invite"
    });

    expect(reviewer.role).toBe("reviewer");
    expect(admin.role).toBe("admin");
  });

  it("upgrades an existing reporter when a valid reviewer invite is supplied", async () => {
    await registerUser({ phoneOrEmail: "operator@gridproof.test", role: "reporter" });
    process.env.GRIDPROOF_AUTH_INVITE_CODE = "demo-invite";

    const reviewer = await registerUser({
      phoneOrEmail: "operator@gridproof.test",
      role: "reviewer",
      inviteCode: "demo-invite"
    });
    const loginUser = await findUserForLogin("operator@gridproof.test");

    expect(reviewer.role).toBe("reviewer");
    expect(loginUser?.role).toBe("reviewer");
    expect(listMemoryAuditLogs("user.role_upgraded")).toHaveLength(1);
  });

  it("does not let open reporter registration downgrade a privileged account", async () => {
    process.env.GRIDPROOF_AUTH_INVITE_CODE = "demo-invite";
    await registerUser({
      phoneOrEmail: "admin@gridproof.test",
      role: "admin",
      inviteCode: "demo-invite"
    });

    const existing = await registerUser({ phoneOrEmail: "admin@gridproof.test", role: "reporter" });

    expect(existing.role).toBe("admin");
  });
});
