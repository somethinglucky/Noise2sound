import { describe, expect, it } from "vitest";
import { type AudioData, durationSeconds, lengthSamples } from "./data";
import { insert, markRange, remove, slice } from "./edit";
import { canRedo, canUndo, createHistory, current, push, redo, undo } from "./history";
import { encodeWav } from "./wav";

/** 10 samples per second keeps the numbers easy to read. */
function make(values: number[], channels = 1): AudioData {
  return {
    sampleRate: 10,
    channels: Array.from({ length: channels }, () => Float32Array.from(values)),
  };
}

const ramp = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("edit", () => {
  it("slice keeps only the selected part", () => {
    const out = slice(make(ramp(10)), 0.2, 0.5);
    expect(Array.from(out.channels[0])).toEqual([2, 3, 4]);
  });

  it("slice accepts a reversed range", () => {
    const out = slice(make(ramp(10)), 0.5, 0.2);
    expect(Array.from(out.channels[0])).toEqual([2, 3, 4]);
  });

  it("remove drops the selected part and joins the rest", () => {
    const out = remove(make(ramp(10)), 0.2, 0.5);
    expect(Array.from(out.channels[0])).toEqual([0, 1, 5, 6, 7, 8, 9]);
  });

  it("insert puts a clip at the given time", () => {
    const out = insert(make([0, 1, 2, 3]), 0.2, make([9, 9]));
    expect(Array.from(out.channels[0])).toEqual([0, 1, 9, 9, 2, 3]);
  });

  it("insert at the very end appends", () => {
    const out = insert(make([0, 1]), 99, make([7]));
    expect(Array.from(out.channels[0])).toEqual([0, 1, 7]);
  });

  it("clamps out-of-range times", () => {
    const out = slice(make(ramp(4)), -5, 99);
    expect(lengthSamples(out)).toBe(4);
  });

  it("insert adapts a mono clip to a stereo clip", () => {
    const out = insert(make([0, 0], 2), 0.1, make([5], 1));
    expect(out.channels.length).toBe(2);
    expect(Array.from(out.channels[1])).toEqual([0, 5, 0]);
  });

  it("does not change the original", () => {
    const a = make(ramp(5));
    remove(a, 0, 0.3);
    expect(Array.from(a.channels[0])).toEqual([0, 1, 2, 3, 4]);
  });

  it("reports duration", () => {
    expect(durationSeconds(make(ramp(25)))).toBe(2.5);
  });
});

describe("markRange", () => {
  it("set start with no selection runs to the end of the clip", () => {
    expect(markRange(null, 2, 6, "start")).toEqual({ start: 2, end: 6 });
  });

  it("set end with no selection runs from the beginning", () => {
    expect(markRange(null, 4, 6, "end")).toEqual({ start: 0, end: 4 });
  });

  it("adjusts one edge and keeps the other", () => {
    expect(markRange({ start: 1, end: 5 }, 3, 6, "start")).toEqual({ start: 3, end: 5 });
    expect(markRange({ start: 1, end: 5 }, 4, 6, "end")).toEqual({ start: 1, end: 4 });
  });

  it("resets the other edge when edges would cross", () => {
    expect(markRange({ start: 1, end: 3 }, 4, 6, "start")).toEqual({ start: 4, end: 6 });
    expect(markRange({ start: 3, end: 5 }, 2, 6, "end")).toEqual({ start: 0, end: 2 });
  });

  it("returns null for an empty selection", () => {
    expect(markRange(null, 6, 6, "start")).toBeNull();
    expect(markRange(null, 0, 6, "end")).toBeNull();
  });
});

describe("history", () => {
  it("undoes and redoes", () => {
    let h = createHistory("a");
    h = push(h, "b");
    h = push(h, "c");
    expect(current(h)).toBe("c");
    h = undo(h);
    expect(current(h)).toBe("b");
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(current(h)).toBe("c");
    expect(canRedo(h)).toBe(false);
  });

  it("a new edit after undo drops the redo states", () => {
    let h = createHistory("a");
    h = push(h, "b");
    h = undo(h);
    h = push(h, "c");
    expect(canRedo(h)).toBe(false);
    h = undo(h);
    expect(current(h)).toBe("a");
  });

  it("caps the number of states", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 30; i++) h = push(h, i, 5);
    expect(h.states.length).toBe(5);
    expect(current(h)).toBe(30);
    expect(canUndo(h)).toBe(true);
  });
});

describe("wav", () => {
  it("writes a valid 16-bit PCM header and data size", async () => {
    const blob = encodeWav(make([0, 0.5, -0.5, 1], 2));
    const bytes = new DataView(await blob.arrayBuffer());
    const text = (o: number, n: number) =>
      String.fromCharCode(...Array.from({ length: n }, (_, i) => bytes.getUint8(o + i)));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(bytes.getUint16(22, true)).toBe(2); // channels
    expect(bytes.getUint32(24, true)).toBe(10); // sample rate
    expect(bytes.getUint32(40, true)).toBe(4 * 2 * 2); // data bytes
    expect(blob.size).toBe(44 + 16);
    expect(bytes.getInt16(44 + 4, true)).toBe(16383); // frame 1, left channel = 0.5
    expect(bytes.getInt16(44 + 8, true)).toBe(-16384); // frame 2, left channel = -0.5
    expect(bytes.getInt16(44 + 12, true)).toBe(32767); // frame 3, left channel = 1.0
  });
});
