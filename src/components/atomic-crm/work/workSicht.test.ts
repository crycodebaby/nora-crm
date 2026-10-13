import { parseSicht, withSicht } from "./workSicht";

const parse = (search: string) => parseSicht(new URLSearchParams(search));

describe("parseSicht (docs/nora/26 §4)", () => {
  it("reads mine and team", () => {
    expect(parse("sicht=mine")).toEqual({
      scope: "mine",
      needsNormalization: false,
    });
    expect(parse("sicht=team")).toEqual({
      scope: "team",
      needsNormalization: false,
    });
  });

  it("defaults a missing sicht to mine without touching the URL", () => {
    expect(parse("")).toEqual({ scope: "mine", needsNormalization: false });
    expect(parse("foo=bar")).toEqual({
      scope: "mine",
      needsNormalization: false,
    });
  });

  it("normalizes invalid or repeated values to mine", () => {
    for (const search of [
      "sicht=xyz",
      "sicht=",
      "sicht=Team",
      "sicht=team&sicht=team",
      "sicht=team&sicht=mine",
    ]) {
      expect(parse(search)).toEqual({
        scope: "mine",
        needsNormalization: true,
      });
    }
  });
});

describe("withSicht", () => {
  it("writes exactly one sicht and keeps other params", () => {
    const next = withSicht(
      new URLSearchParams("a=1&sicht=x&sicht=y&b=2"),
      "team",
    );
    expect(next.getAll("sicht")).toEqual(["team"]);
    expect(next.get("a")).toBe("1");
    expect(next.get("b")).toBe("2");
  });
});
