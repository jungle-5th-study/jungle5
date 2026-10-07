import { describe, expect, it } from "vitest";
import { formatWeekRange } from "./format";

// Instants in KST (UTC+9).
const kst = (iso: string) => Date.parse(`${iso}+09:00`);

describe("formatWeekRange (Monday–Sunday, KST)", () => {
  it("a Monday starts its own week", () => {
    expect(formatWeekRange(kst("2026-10-05T00:00:00"))).toBe("10월 5일 – 10월 11일");
    expect(formatWeekRange(kst("2026-10-12T09:00:00"))).toBe("10월 12일 – 10월 18일");
  });

  it("a Sunday belongs to the week that started the Monday before", () => {
    expect(formatWeekRange(kst("2026-10-11T23:59:00"))).toBe("10월 5일 – 10월 11일");
    expect(formatWeekRange(kst("2026-10-04T12:00:00"))).toBe("9월 28일 – 10월 4일");
  });

  it("midweek (Wed 2026-10-07) and the UTC/KST day boundary", () => {
    expect(formatWeekRange(kst("2026-10-07T10:00:00"))).toBe("10월 5일 – 10월 11일");
    // Sunday 23:30 UTC is already Monday 08:30 in KST.
    expect(formatWeekRange(Date.parse("2026-10-11T23:30:00Z"))).toBe("10월 12일 – 10월 18일");
  });

  it("crosses month and year ends", () => {
    expect(formatWeekRange(kst("2026-12-31T12:00:00"))).toBe("12월 28일 – 1월 3일");
  });
});
