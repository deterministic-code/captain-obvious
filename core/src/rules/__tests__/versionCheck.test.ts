import { describe, expect, it } from "vitest";
import { detectVersionSkew } from "../versionCheck.js";

describe("detectVersionSkew", () => {
  it("flags 0.x rule packages outside the engine's minor bucket", () => {
    const skew = detectVersionSkew("0.3.1", [
      { name: "a", version: "0.3.0" },
      { name: "b", version: "0.1.2" },
      { name: "c", version: "0.4.0" },
    ]);
    expect(skew).toEqual([
      { name: "b", version: "0.1.2" },
      { name: "c", version: "0.4.0" },
    ]);
  });

  it("treats >=1.0 versions as compatible within the same major", () => {
    expect(
      detectVersionSkew("1.2.0", [
        { name: "a", version: "1.9.3" },
        { name: "b", version: "2.0.0" },
      ]),
    ).toEqual([{ name: "b", version: "2.0.0" }]);
  });

  it("returns [] when every package shares the engine's bucket", () => {
    expect(
      detectVersionSkew("0.3.0", [{ name: "a", version: "0.3.9" }]),
    ).toEqual([]);
  });
});
