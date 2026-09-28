import { describe, expect, it, vi } from "vitest";
import { openUrlInBrowser, parseChromiumProfiles, parseFirefoxProfiles } from "../src/browser.js";
import {
  AUTH_CONFIRMATION_REQUIRED_PREFIX,
  buildMongoClientOptions,
  cancelOidcBrowserAuth,
  getOidcBrowserAuthUrl,
  prepareOidcBrowserAuth,
} from "../src/config.js";

vi.mock("../src/browser.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/browser.js")>(),
  openUrlInBrowser: vi.fn(),
}));

describe("parseChromiumProfiles", () => {
  it("extracts profile keys, names, and emails from Local State", () => {
    const profiles = parseChromiumProfiles(JSON.stringify({
      profile: {
        info_cache: {
          Default: { name: "Work", user_name: "work@example.com" },
          "Profile 1": { name: "Personal" },
        },
      },
    }));

    expect(profiles).toEqual([
      {
        key: "Default",
        label: "Work (work@example.com)",
        isDefault: true,
      },
      {
        key: "Profile 1",
        label: "Personal",
        isDefault: false,
      },
    ]);
  });
});

describe("parseFirefoxProfiles", () => {
  it("extracts profile names and default marker from profiles.ini", () => {
    const profiles = parseFirefoxProfiles(`
[Profile0]
Name=default-release
Path=Profiles/default-release
Default=1

[Profile1]
Name=Personal
Path=Profiles/personal
`);

    expect(profiles).toEqual([
      {
        key: "default-release",
        label: "default-release (Default)",
        isDefault: true,
      },
      {
        key: "Personal",
        label: "Personal",
        isDefault: false,
      },
    ]);
  });
});

describe("cancelOidcBrowserAuth", () => {
  it("revokes an unused browser launch approval", async () => {
    const connectionId = "cancelled-browser-test";
    prepareOidcBrowserAuth(connectionId, { browser: "chrome", profile: null });
    cancelOidcBrowserAuth(connectionId);

    const options = buildMongoClientOptions({
      connectionId,
      connectionName: "Cancelled test",
      oidcProvider: "azure-browser",
      oidcTokenAudience: "test-audience",
      azureClientId: "test-client",
      azureTenantId: "organizations",
      oidcBrowser: "chrome",
      oidcBrowserProfile: null,
    });
    const callback = options.authMechanismProperties?.OIDC_HUMAN_CALLBACK;
    expect(callback).toBeDefined();
    await expect(callback!({} as Parameters<typeof callback>[0])).rejects.toThrow(
      AUTH_CONFIRMATION_REQUIRED_PREFIX,
    );
  });
});

describe("manual browser authentication", () => {
  it("exposes a URL without launching the browser and cancels the pending login", async () => {
    const connectionId = "manual-browser-test";
    prepareOidcBrowserAuth(connectionId, {
      browser: "chrome",
      profile: null,
      openBrowser: false,
    });
    const options = buildMongoClientOptions({
      connectionId,
      connectionName: "Manual test",
      oidcProvider: "azure-browser",
      oidcTokenAudience: "test-audience",
      azureClientId: "test-client",
      azureTenantId: "organizations",
      oidcBrowser: "chrome",
      oidcBrowserProfile: null,
    });
    const callback = options.authMechanismProperties?.OIDC_HUMAN_CALLBACK;
    expect(callback).toBeDefined();
    const login = callback!({} as Parameters<typeof callback>[0]);
    expect(getOidcBrowserAuthUrl(connectionId)).toContain("/oauth2/v2.0/authorize");
    expect(openUrlInBrowser).not.toHaveBeenCalled();

    await new Promise<void>((resolve) => setImmediate(resolve));
    cancelOidcBrowserAuth(connectionId);
    await expect(login).rejects.toThrow(/cancelled/i);
    expect(getOidcBrowserAuthUrl(connectionId)).toBeNull();
  });
});
