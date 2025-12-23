/* global Midi */
const els = {
  file: document.getElementById("midiFile"),
  generate: document.getElementById("generate"),
  download: document.getElementById("download"),
  downloadMelody: document.getElementById("downloadMelody"),
  status: document.getElementById("status"),
  summary: document.getElementById("summary"),
  octave: document.getElementById("octave"),
  velocity: document.getElementById("velocity"),
  hold: document.getElementById("hold"),
  bars: document.getElementById("bars"),
  grid: document.getElementById("grid"),
  roll: document.getElementById("roll"),
  rollHeader: document.getElementById("rollHeader"),
  clearRoll: document.getElementById("clearRoll"),
  composeGenerate: document.getElementById("composeGenerate"),
};

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const CHORDS = {
  I: [0, 4, 7],
  IV: [5, 9, 0],
  V: [7, 11, 2],
  vi: [9, 0, 4],
};

let inputBuffer = null;
let lastBlob = null;
let melodyBlob = null;
let rollNotes = [];

function setStatus(text) {
  els.status.textContent = text;
}

function setSummary(text) {
  els.summary.textContent = text;
}

function pcName(pc) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return names[(pc + 12) % 12];
}

function estimateKey(notes) {
  if (notes.length === 0) return { tonic: 0, mode: "major" };
  const pcs = notes.map((n) => n.midi % 12);
  let bestScore = -Infinity;
  let best = { tonic: 0, mode: "major" };
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const [mode, scale] of [
      ["major", MAJOR_SCALE],
      ["minor", MINOR_SCALE],
    ]) {
      const set = new Set(scale.map((p) => (p + tonic) % 12));
      let score = pcs.reduce((acc, pc) => acc + (set.has(pc) ? 1 : 0), 0);
      if (mode === "minor") score -= 0.2;
      if (score > bestScore) {
        bestScore = score;
        best = { tonic, mode };
      }
    }
  }
  return best;
}

function buildChords(key) {
  return Object.entries(CHORDS).map(([name, degrees]) => {
    const pcs = degrees.map((d) => (key.tonic + d) % 12);
    return { name, pcs };
  });
}

function chooseChord(choices, prev, melodyPc) {
  if (prev && prev.pcs.includes(melodyPc)) return prev;
  const hit = choices.find((c) => c.pcs.includes(melodyPc));
  return hit || choices[0];
}

function collectNotes(midi) {
  const notes = [];
  midi.tracks.forEach((track) => {
    track.notes.forEach((note) => {
      notes.push({
        midi: note.midi,
        ticks: note.ticks,
        durationTicks: note.durationTicks,
        velocity: note.velocity,
      });
    });
  });
  return notes.sort((a, b) => a.ticks - b.ticks || a.midi - b.midi);
}

function addAccompaniment(midi, notes) {
  const key = estimateKey(notes);
  const choices = buildChords(key);
  const acc = midi.addTrack();
  acc.name = "Accompaniment";

  const targetOctave = Math.min(5, Math.max(2, parseInt(els.octave.value, 10) || 3));
  const base = targetOctave * 12;
  const velocity = Math.min(120, Math.max(20, parseInt(els.velocity.value, 10) || 60));
  const holdBeats = Math.max(0.25, Math.min(4, parseFloat(els.hold.value) || 1));

  let prevChord = null;
  let holdTicks = 0;
  const ticksPerBeat = midi.header.ppq || 480;
  const minHoldTicks = Math.round(holdBeats * ticksPerBeat);

  notes.forEach((note) => {
    const melodyPc = note.midi % 12;
    if (!prevChord || holdTicks >= minHoldTicks) {
      prevChord = chooseChord(choices, prevChord, melodyPc);
      holdTicks = 0;
    }
    holdTicks += note.durationTicks;

    prevChord.pcs.forEach((pc) => {
      let chordNote = base + pc;
      if (chordNote >= note.midi - 6) chordNote -= 12;
      if (chordNote < 36) chordNote += 12;
      acc.addNote({
        midi: chordNote,
        ticks: note.ticks,
        durationTicks: note.durationTicks,
        velocity: velocity / 127,
      });
    });
  });

  return key;
}

function buildMelodyFromRoll() {
  const bars = Math.min(8, Math.max(1, parseInt(els.bars.value, 10) || 1));
  const subdivision = parseInt(els.grid.value, 10) || 8;
  const stepsPerBar = Math.max(1, subdivision);
  const steps = bars * stepsPerBar;
  const midi = new Midi();
  const track = midi.addTrack();
  track.name = "Melody";
  const ticksPerBeat = midi.header.ppq || 480;
  const stepTicks = Math.round(ticksPerBeat * (4 / subdivision));

  for (let step = 0; step < steps; step += 1) {
    const midiNote = rollNotes[step];
    if (midiNote == null) continue;
    track.addNote({
      midi: midiNote,
      ticks: step * stepTicks,
      durationTicks: stepTicks,
      velocity: 0.9,
    });
  }
  return { midi, notes: collectNotes(midi) };
}

async function loadFile(file) {
  inputBuffer = await file.arrayBuffer();
  setStatus(`Loaded: ${file.name}`);
  els.generate.disabled = false;
  els.download.disabled = true;
  setSummary("No output yet.");
}

function buildOutput() {
  if (!inputBuffer) return;
  const midi = new Midi(inputBuffer);
  const notes = collectNotes(midi);
  if (notes.length === 0) {
    setStatus("No notes found in MIDI.");
    return;
  }
  const key = addAccompaniment(midi, notes);
  const output = midi.toArray();
  lastBlob = new Blob([output], { type: "audio/midi" });
  const noteCount = notes.length;
  setStatus(`Accompaniment ready. Notes: ${noteCount}`);
  setSummary(`Key estimate: ${pcName(key.tonic)} ${key.mode} | Tracks: ${midi.tracks.length}`);
  els.download.disabled = false;
}

function buildOutputFromRoll() {
  const { midi, notes } = buildMelodyFromRoll();
  if (notes.length === 0) {
    setStatus("No notes in roll.");
    return;
  }
  const melodyArray = midi.toArray();
  melodyBlob = new Blob([melodyArray], { type: "audio/midi" });
  const key = addAccompaniment(midi, notes);
  const output = midi.toArray();
  lastBlob = new Blob([output], { type: "audio/midi" });
  setStatus(`Accompaniment ready from roll. Notes: ${notes.length}`);
  setSummary(`Key estimate: ${pcName(key.tonic)} ${key.mode} | Tracks: ${midi.tracks.length}`);
  els.download.disabled = false;
  els.downloadMelody.disabled = false;
}

function downloadOutput() {
  if (!lastBlob) return;
  const url = URL.createObjectURL(lastBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "with_accompaniment.mid";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadMelody() {
  if (!melodyBlob) return;
  const url = URL.createObjectURL(melodyBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "melody.mid";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function pitchLabel(midi) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const pc = midi % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${names[pc]}${oct}`;
}

function buildRoll() {
  if (!els.roll || !els.rollHeader) return;
  const bars = Math.min(8, Math.max(1, parseInt(els.bars.value, 10) || 1));
  const subdivision = parseInt(els.grid.value, 10) || 8;
  const stepsPerBar = Math.max(1, subdivision);
  const steps = bars * stepsPerBar;
  const minMidi = 48; // C3
  const maxMidi = 84; // C6
  const rows = [];
  for (let m = maxMidi; m >= minMidi; m -= 1) rows.push(m);

  rollNotes = Array(steps).fill(null);
  els.rollHeader.innerHTML = "";
  els.rollHeader.style.gridTemplateColumns = `repeat(${steps}, minmax(24px, 1fr))`;
  for (let s = 0; s < steps; s += 1) {
    const div = document.createElement("div");
    if (s % stepsPerBar === 0) div.style.color = "#ffb457";
    div.textContent = s % stepsPerBar === 0 ? `|${s / stepsPerBar + 1}` : "";
    els.rollHeader.appendChild(div);
  }

  els.roll.innerHTML = "";
  rows.forEach((midi, rowIdx) => {
    const row = document.createElement("div");
    row.className = "roll-row";
    row.style.gridTemplateColumns = `repeat(${steps}, minmax(24px, 1fr))`;
    for (let step = 0; step < steps; step += 1) {
      const cell = document.createElement("div");
      cell.className = "roll-cell";
      if (step % stepsPerBar === 0) cell.classList.add("bar");
      cell.dataset.step = String(step);
      cell.dataset.midi = String(midi);
      if (rowIdx === 0) {
        const label = document.createElement("div");
        label.className = "roll-label";
        label.textContent = pitchLabel(midi);
        cell.appendChild(label);
      }
      cell.addEventListener("click", () => {
        const current = rollNotes[step];
        const newVal = current === midi ? null : midi;
        rollNotes[step] = newVal;
        renderRoll();
      });
      row.appendChild(cell);
    }
    els.roll.appendChild(row);
  });

  renderRoll();
  els.downloadMelody.disabled = true;
  els.download.disabled = true;
  setSummary("No output yet.");
}

function renderRoll() {
  const cells = els.roll.querySelectorAll(".roll-cell");
  cells.forEach((cell) => {
    const step = parseInt(cell.dataset.step, 10);
    const midi = parseInt(cell.dataset.midi, 10);
    const on = rollNotes[step] === midi;
    cell.classList.toggle("on", on);
  });
}

els.file.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) loadFile(file);
});

els.generate.addEventListener("click", () => {
  setStatus("Generating accompaniment...");
  requestAnimationFrame(buildOutput);
});

els.download.addEventListener("click", downloadOutput);
els.downloadMelody.addEventListener("click", downloadMelody);
els.composeGenerate.addEventListener("click", () => {
  setStatus("Generating accompaniment from roll...");
  requestAnimationFrame(buildOutputFromRoll);
});
els.clearRoll.addEventListener("click", () => {
  rollNotes = rollNotes.map(() => null);
  renderRoll();
  els.downloadMelody.disabled = true;
});
els.bars.addEventListener("change", buildRoll);
els.grid.addEventListener("change", buildRoll);

buildRoll();
