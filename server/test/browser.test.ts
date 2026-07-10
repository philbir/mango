import { describe, expect, it } from "vitest";
import { parseChromiumProfiles, parseFirefoxProfiles } from "../src/browser.js";

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
