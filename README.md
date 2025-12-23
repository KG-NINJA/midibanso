# midibanso web

Static web app that lets you compose a monophonic melody in a piano roll and add accompaniment (block/bass/arpeggio), or import a MIDI file.

## GitHub Pages

1. Put `index.html`, `style.css`, and `app.js` in your repo root (or `/docs`).
2. Enable GitHub Pages from the repo settings.
3. Open the published URL, draw a melody in the piano roll (or drop a MIDI file), then generate accompaniment.

## Notes

- Runs fully in the browser. No uploads.
- Uses `@tonejs/midi` via CDN for MIDI parsing and writing.
