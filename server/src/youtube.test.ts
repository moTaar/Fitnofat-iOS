import { describe, expect, it } from "vitest";
import { buildQuery, dedupeSearch, parseIsoDuration, rankVideos, type ExerciseVideo } from "./youtube";

// Ranking is the only thing standing between a user and a 12-minute video essay
// about shoulder anatomy when they wanted to see a lateral raise. A search costs
// 100 of ~100 daily quota units, so there is no "just search again" — the one
// result set we pay for has to be ordered well, and that ordering is worth a
// guard.

const v = (over: Partial<ExerciseVideo> & { videoId: string }): ExerciseVideo => ({
  title: "Untitled",
  channelTitle: "Somebody",
  channelId: "UCunknown",
  thumbnail: "",
  ...over,
});

describe("buildQuery", () => {
  it("adds form intent so the search returns demos, not workout vlogs", () => {
    expect(buildQuery("Lateral Raise")).toContain("Lateral Raise");
    expect(buildQuery("Lateral Raise")).toMatch(/form|technique|how to/);
  });

  it("trims so a padded name can't skew the query", () => {
    expect(buildQuery("  Barbell Row  ")).toMatch(/^Barbell Row /);
  });
});

describe("parseIsoDuration", () => {
  it("parses the shapes YouTube actually returns", () => {
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("PT2M30S")).toBe(150);
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT3M")).toBe(180);
  });

  it("returns undefined rather than 0 for junk, so ranking skips it", () => {
    expect(parseIsoDuration("banana")).toBeUndefined();
    expect(parseIsoDuration("")).toBeUndefined();
  });
});

describe("rankVideos", () => {
  it("puts a titled demonstration above an unrelated workout vlog", () => {
    const ranked = rankVideos(
      [
        v({ videoId: "vlog", title: "FULL BODY WORKOUT — push day vlog" }),
        v({ videoId: "demo", title: "How To: Barbell Row — proper form", durationSec: 90 }),
      ],
      "Barbell Row"
    );
    expect(ranked[0].videoId).toBe("demo");
  });

  it("ranks what users picked above what relevance returned", () => {
    const list = [
      v({ videoId: "top", title: "Barbell Row technique", durationSec: 60 }),
      v({ videoId: "chosen", title: "Rowing", durationSec: 60 }),
    ];
    expect(rankVideos(list, "Barbell Row")[0].videoId).toBe("top");
    // …and the crowd-curation loop flips it once people actually choose one.
    expect(rankVideos(list, "Barbell Row", { chosen: 12 })[0].videoId).toBe("chosen");
  });

  it("damps picks so a single enthusiast can't pin a bad video forever", () => {
    const stuffed = rankVideos(
      [
        v({ videoId: "spam", title: "gym fails compilation" }),
        v({ videoId: "good", title: "Barbell Row proper form tutorial", durationSec: 75 }),
      ],
      "Barbell Row",
      { spam: 5_000, good: 40 }
    );
    expect(stuffed[0].videoId).toBe("good");
  });

  it("prefers a demo-length clip over a long-form talk", () => {
    const ranked = rankVideos(
      [
        v({ videoId: "talk", title: "Barbell Row form", durationSec: 900 }),
        v({ videoId: "demo", title: "Barbell Row form", durationSec: 75 }),
      ],
      "Barbell Row"
    );
    expect(ranked[0].videoId).toBe("demo");
  });

  it("does not let a viral video outrank a relevant one on reach alone", () => {
    const ranked = rankVideos(
      [
        v({ videoId: "viral", title: "gym motivation edit", viewCount: 40_000_000 }),
        v({ videoId: "demo", title: "Barbell Row — how to", durationSec: 80, viewCount: 12_000 }),
      ],
      "Barbell Row"
    );
    expect(ranked[0].videoId).toBe("demo");
  });

  it("caps the list so the picker stays a grid, not a feed", () => {
    const many = Array.from({ length: 12 }, (_, i) => v({ videoId: `id${i}` }));
    expect(rankVideos(many, "Squat").length).toBeLessThanOrEqual(8);
  });

  it("leaves the input array untouched", () => {
    const list = [v({ videoId: "a" }), v({ videoId: "b", title: "Squat how to" })];
    const before = list.map((x) => x.videoId);
    rankVideos(list, "Squat");
    expect(list.map((x) => x.videoId)).toEqual(before);
  });
});

describe("dedupeSearch", () => {
  it("collapses concurrent searches for the same movement into one", async () => {
    let calls = 0;
    const search = () =>
      new Promise<ExerciseVideo[]>((resolve) => {
        calls++;
        setTimeout(() => resolve([v({ videoId: "x" })]), 10);
      });

    const results = await Promise.all([
      dedupeSearch("barbell-row", search),
      dedupeSearch("barbell-row", search),
      dedupeSearch("barbell-row", search),
    ]);

    // One search, three callers served — the other two would each have burned
    // 100 of ~9000 daily units to fetch an identical answer.
    expect(calls).toBe(1);
    expect(results.every((r) => r[0].videoId === "x")).toBe(true);
  });

  it("does not collapse different movements", async () => {
    let calls = 0;
    const search = async () => { calls++; return []; };
    await Promise.all([dedupeSearch("squat", search), dedupeSearch("deadlift", search)]);
    expect(calls).toBe(2);
  });

  it("releases the slot after a failure so the next caller can retry", async () => {
    let calls = 0;
    const failing = async (): Promise<ExerciseVideo[]> => { calls++; throw new Error("YOUTUBE_QUOTA"); };
    await expect(dedupeSearch("dip", failing)).rejects.toThrow("YOUTUBE_QUOTA");
    await expect(dedupeSearch("dip", failing)).rejects.toThrow("YOUTUBE_QUOTA");
    expect(calls).toBe(2);
  });
});
