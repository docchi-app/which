# Video kit

Makes short vertical (9:16) promo videos with a voice-over, from an HTML scene. Everything runs
locally: Piper for the voice, Playwright to film the scene frame by frame, ffmpeg to put it
together, and `music.py` for a simple beat.

## Say it right

The app is **Eithr**, said **"ee-ther"** (like "either"). The voice gets it wrong from the
spelling alone ("ee-thur"), so `voice.py` respells it before speaking:

| Written | The voice says |
|---|---|
| Eithr | Eether |
| eithr.app | Eether dot app |
| @eithr | at Eether |

Write lines normally (`lines.txt` says "Eithr"); only the audio uses the respelling. Add words to
`PRONOUNCE` in `voice.py` if the voice trips on something else.

## Make a video

```bash
pip install piper-tts                                  # once
python3 -m piper.download_voices en_US-hfc_female-medium --data-dir ~/.local/share/piper   # once

python3 scripts/video-kit/voice.py  scripts/video-kit/examples/props-hype   # vo*.wav + durs.txt
node    scripts/video-kit/render.cjs scripts/video-kit/examples/props-hype  # frames/ + starts.json
python3 scripts/video-kit/mix.py    scripts/video-kit/examples/props-hype --music --out eithr-props.mp4
```

A scene folder has `lines.txt` (one voice line per scene) and `scene.html`, which reads
`window.DURS` (each line's length), and exposes `window.TOTAL`, `window.STARTS` and
`window.seek(t)` so every frame can be filmed exactly. Copy `examples/props-hype` to start a new
one. Outputs (frames, audio, mp4) aren't committed.

Voices used so far: `en_US-hfc_female-medium` (bright, the hype videos) and
`en_US-amy-medium` (calmer). `--speed 0.9` is a little faster.

Brand basics (logo, colours, taglines) are in `docs/brand.md`.
