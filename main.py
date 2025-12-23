#!/usr/bin/env python3
"""Add simple accompaniment to a monophonic melody MIDI file."""
from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import List, Tuple

import mido

MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]

CHORDS = {
    "I": (0, 4, 7),
    "IV": (5, 9, 0),
    "V": (7, 11, 2),
    "vi": (9, 0, 4),
}


@dataclass
class NoteEvent:
    start: int
    end: int
    note: int
    velocity: int


@dataclass
class KeyEstimate:
    tonic_pc: int
    mode: str  # "major" or "minor"


@dataclass
class ChordChoice:
    name: str
    pcs: Tuple[int, int, int]


def parse_melody(mid: mido.MidiFile) -> List[NoteEvent]:
    merged = mido.merge_tracks(mid.tracks)
    abs_time = 0
    notes: List[NoteEvent] = []
    current_note = None
    current_start = None
    current_velocity = 64

    for msg in merged:
        abs_time += msg.time
        if msg.type == "note_on" and msg.velocity > 0:
            if current_note is not None and current_start is not None:
                # Close previous note if a new note starts (monophonic fallback).
                notes.append(
                    NoteEvent(
                        start=current_start,
                        end=abs_time,
                        note=current_note,
                        velocity=current_velocity,
                    )
                )
            current_note = msg.note
            current_start = abs_time
            current_velocity = msg.velocity
        elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
            if current_note is None or current_start is None:
                continue
            if msg.note != current_note:
                continue
            notes.append(
                NoteEvent(
                    start=current_start,
                    end=abs_time,
                    note=current_note,
                    velocity=current_velocity,
                )
            )
            current_note = None
            current_start = None

    return notes


def estimate_key(notes: List[NoteEvent]) -> KeyEstimate:
    if not notes:
        return KeyEstimate(tonic_pc=0, mode="major")
    pcs = [n.note % 12 for n in notes]
    best_score = float("-inf")
    best = KeyEstimate(tonic_pc=0, mode="major")
    for tonic_pc in range(12):
        for mode, scale in ("major", MAJOR_SCALE), ("minor", MINOR_SCALE):
            scale_pcs = {(tonic_pc + p) % 12 for p in scale}
            score = sum(1 for pc in pcs if pc in scale_pcs)
            if mode == "minor":
                score -= 0.2
            if score > best_score:
                best_score = score
                best = KeyEstimate(tonic_pc=tonic_pc, mode=mode)
    return best


def build_chords(key: KeyEstimate) -> List[ChordChoice]:
    choices: List[ChordChoice] = []
    for name, degrees in CHORDS.items():
        pcs = tuple(((key.tonic_pc + degree) % 12) for degree in degrees)
        choices.append(ChordChoice(name=name, pcs=pcs))
    return choices


def accompaniment_events(notes: List[NoteEvent]) -> List[Tuple[int, mido.Message]]:
    if not notes:
        return []
    key = estimate_key(notes)
    choices = build_chords(key)
    events: List[Tuple[int, mido.Message]] = []
    prev: ChordChoice | None = None

    for n in notes:
        melody_pc = n.note % 12
        chord = None
        if prev and melody_pc in prev.pcs:
            chord = prev
        else:
            chord = next((c for c in choices if melody_pc in c.pcs), choices[0])
        prev = chord

        # Place chord around octave 3-4, below melody.
        target_octave = max(2, (n.note // 12) - 2)
        base = target_octave * 12
        for pc in chord.pcs:
            note_num = base + pc
            events.append((n.start, mido.Message("note_on", note=note_num, velocity=60)))
            events.append((n.end, mido.Message("note_off", note=note_num, velocity=0)))

    return events


def build_accompaniment_track(events: List[Tuple[int, mido.Message]]) -> mido.MidiTrack:
    track = mido.MidiTrack()
    events_sorted = sorted(events, key=lambda x: x[0])
    last_time = 0
    for t, msg in events_sorted:
        delta = t - last_time
        last_time = t
        msg.time = max(0, delta)
        track.append(msg)
    return track


def build_output(mid: mido.MidiFile, acc_track: mido.MidiTrack) -> mido.MidiFile:
    out = mido.MidiFile(ticks_per_beat=mid.ticks_per_beat)
    # Keep original tracks as-is; append accompaniment as a new track.
    for tr in mid.tracks:
        out.tracks.append(mido.MidiTrack(tr))
    out.tracks.append(acc_track)
    return out


def main(argv: List[str]) -> int:
    if len(argv) != 3:
        print("Usage: python3 main.py input.mid output.mid")
        return 2
    input_path, output_path = argv[1], argv[2]
    mid = mido.MidiFile(input_path)
    melody = parse_melody(mid)
    if not melody:
        print("No melody notes found.")
        return 1
    events = accompaniment_events(melody)
    acc_track = build_accompaniment_track(events)
    out = build_output(mid, acc_track)
    out.save(output_path)
    print(f"Wrote {output_path} with accompaniment track.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
