/* global Midi */
const els = {
  file: document.getElementById("midiFile"),
  generate: document.getElementById("generate"),
  download: document.getElementById("download"),
  downloadMelody: document.getElementById("downloadMelody"),
  previewMelody: document.getElementById("previewMelody"),
  previewAcc: document.getElementById("previewAcc"),
  previewAll: document.getElementById("previewAll"),
  status: document.getElementById("status"),
  summary: document.getElementById("summary"),
  octave: document.getElementById("octave"),
  velocity: document.getElementById("velocity"),
  hold: document.getElementById("hold"),
  style: document.getElementById("style"),
  wave: document.getElementById("wave"),
  bassRhythm: document.getElementById("bassRhythm"),
  arpDir: document.getElementById("arpDir"),
  bars: document.getElementById("bars"),
  grid: document.getElementById("grid"),
  tempo: document.getElementById("tempo"),
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
let lastMidi = null;
let lastMelodyNotes = [];
let lastAccNotes = [];
let audioCtx = null;

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
  const style = els.style?.value || "block";
  const bassRhythm = els.bassRhythm?.value || "quarter";
  const arpDir = els.arpDir?.value || "up";

  let prevChord = null;
  let holdTicks = 0;
  const ticksPerBeat = midi.header.ppq || 480;
  const minHoldTicks = Math.round(holdBeats * ticksPerBeat);
  const accNotes = [];

  notes.forEach((note) => {
    const melodyPc = note.midi % 12;
    if (!prevChord || holdTicks >= minHoldTicks) {
      prevChord = chooseChord(choices, prevChord, melodyPc);
      holdTicks = 0;
    }
    holdTicks += note.durationTicks;

    if (style === "bass") {
      const rootPc = prevChord.pcs[0];
      const rhythmOffsets =
        bassRhythm === "eighth"
          ? [0, 0.5]
          : bassRhythm === "sync"
            ? [0, 0.75]
            : [0];
      const beatTicks = ticksPerBeat;
      const maxTicks = note.durationTicks;
      rhythmOffsets.forEach((offset) => {
        const tickOffset = Math.round(offset * beatTicks);
        if (tickOffset >= maxTicks) return;
        let chordNote = base + rootPc - 12;
        if (chordNote >= note.midi - 6) chordNote -= 12;
        if (chordNote < 24) chordNote += 12;
        accNotes.push({
          midi: chordNote,
          ticks: note.ticks + tickOffset,
          durationTicks: Math.min(maxTicks - tickOffset, beatTicks),
          velocity: velocity / 127,
        });
      });
    } else if (style === "arp") {
      const baseSeq = prevChord.pcs.slice();
      const seq =
        arpDir === "down"
          ? baseSeq.slice().reverse()
          : arpDir === "updown"
            ? baseSeq.concat(baseSeq.slice(1, -1).reverse())
            : baseSeq;
      const arpCount = Math.max(1, seq.length);
      const dur = Math.max(1, Math.floor(note.durationTicks / arpCount));
      for (let i = 0; i < arpCount; i += 1) {
        const pc = seq[i % seq.length];
        let chordNote = base + pc;
        if (chordNote >= note.midi - 6) chordNote -= 12;
        if (chordNote < 36) chordNote += 12;
        accNotes.push({
          midi: chordNote,
          ticks: note.ticks + i * dur,
          durationTicks: dur,
          velocity: velocity / 127,
        });
      }
    } else {
      prevChord.pcs.forEach((pc) => {
        let chordNote = base + pc;
        if (chordNote >= note.midi - 6) chordNote -= 12;
        if (chordNote < 36) chordNote += 12;
        accNotes.push({
          midi: chordNote,
          ticks: note.ticks,
          durationTicks: note.durationTicks,
          velocity: velocity / 127,
        });
      });
    }
  });

  accNotes.forEach((n) => acc.addNote(n));
  lastAccNotes = accNotes.slice();
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
  const bpm = Math.min(220, Math.max(40, parseInt(els.tempo.value, 10) || 120));
  if (midi.header.setTempo) {
    midi.header.setTempo(bpm);
  } else {
    midi.header.tempos = [{ ticks: 0, bpm }];
  }

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
  lastMidi = midi;
  lastMelodyNotes = notes.slice();
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
  lastMidi = midi;
  lastMelodyNotes = notes.slice();
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

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function ticksToSeconds(ticks, bpm, ppq) {
  const beats = ticks / ppq;
  return (60 / bpm) * beats;
}

function getBpm() {
  if (lastMidi?.header?.tempos?.length) {
    return lastMidi.header.tempos[0].bpm || 120;
  }
  return Math.min(220, Math.max(40, parseInt(els.tempo.value, 10) || 120));
}

function playNotes(notes, bpm, gain = 0.12) {
  if (!notes || notes.length === 0) return;
  ensureAudio();
  const ctx = audioCtx;
  const ppq = lastMidi?.header?.ppq || 480;
  const startAt = ctx.currentTime + 0.05;
  const wave = els.wave?.value || "sine";
  notes.forEach((n) => {
    const t = startAt + ticksToSeconds(n.ticks, bpm, ppq);
    const dur = Math.max(0.05, ticksToSeconds(n.durationTicks, bpm, ppq));
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(midiToFreq(n.midi), t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  });
}

function previewMelody() {
  if (!lastMelodyNotes.length) {
    const { notes } = buildMelodyFromRoll();
    lastMelodyNotes = notes.slice();
  }
  playNotes(lastMelodyNotes, getBpm(), 0.14);
}

function previewAcc() {
  if (!lastAccNotes.length) {
    if (inputBuffer) buildOutput();
    else buildOutputFromRoll();
  }
  playNotes(lastAccNotes, getBpm(), 0.10);
}

function previewAll() {
  previewMelody();
  previewAcc();
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
els.previewMelody.addEventListener("click", previewMelody);
els.previewAcc.addEventListener("click", previewAcc);
els.previewAll.addEventListener("click", previewAll);
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
els.tempo.addEventListener("change", buildRoll);

buildRoll();
