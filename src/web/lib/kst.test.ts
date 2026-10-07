import { describe, expect, it } from "vitest";
import { epochMsToKst, formatMeeting, formatPeriod, kstToEpochMs, kstWeekdayTime } from "./kst";

describe("KST date/time helpers", () => {
  it("converts KST wall time to epoch ms and back", () => {
    const ms = kstToEpochMs("2026-10-08", "21:00");
    expect(ms).toBe(Date.parse("2026-10-08T12:00:00Z"));
    expect(epochMsToKst(ms!)).toEqual({ date: "2026-10-08", time: "21:00" });
  });

  it("round-trips across many instants", () => {
    for (const iso of ["2026-01-01T00:00:00Z", "2026-06-15T14:59:00Z", "2026-06-15T15:00:00Z", "2027-12-31T23:59:00Z"]) {
      const ms = Date.parse(iso);
      const { date, time } = epochMsToKst(ms);
      expect(kstToEpochMs(date, time)).toBe(ms);
    }
  });

  it("handles KST midnight boundaries (previous UTC day)", () => {
    // 00:00 KST on Oct 8 is 15:00 UTC on Oct 7.
    expect(kstToEpochMs("2026-10-08", "00:00")).toBe(Date.parse("2026-10-07T15:00:00Z"));
    expect(epochMsToKst(Date.parse("2026-10-07T14:59:00Z"))).toEqual({ date: "2026-10-07", time: "23:59" });
    expect(epochMsToKst(Date.parse("2026-10-07T15:00:00Z"))).toEqual({ date: "2026-10-08", time: "00:00" });
    // New year in KST while UTC is still in the old year.
    expect(epochMsToKst(Date.parse("2026-12-31T15:30:00Z"))).toEqual({ date: "2027-01-01", time: "00:30" });
  });

  it("rejects missing or impossible input", () => {
    expect(kstToEpochMs("", "21:00")).toBeNull();
    expect(kstToEpochMs("2026-10-08", "")).toBeNull();
    expect(kstToEpochMs("2026-02-30", "10:00")).toBeNull();
    expect(kstToEpochMs("2026-10-08", "24:00")).toBeNull();
  });

  it("formats meetings and periods", () => {
    const now = Date.parse("2026-10-07T03:00:00Z");
    const ms = kstToEpochMs("2026-10-08", "21:00")!;
    expect(formatMeeting(ms, now)).toBe("10월 8일 (목) 21:00");
    expect(kstWeekdayTime(ms)).toBe("목 21:00");
    expect(formatMeeting(kstToEpochMs("2027-01-02", "09:05")!, now)).toBe("2027년 1월 2일 (토) 09:05");
    expect(formatPeriod("2026-10-03", "2026-10-09", now)).toBe("10월 3일 – 10월 9일");
    expect(formatPeriod("2026-10-03", null, now)).toBe("10월 3일부터");
    expect(formatPeriod(null, null, now)).toBeNull();
  });
});
