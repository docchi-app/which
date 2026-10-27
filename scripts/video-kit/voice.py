"""Voice-over for a video: one WAV per line, plus durs.txt (seconds per line) for the scene.

    python3 scripts/video-kit/voice.py <scene dir> [--voice en_US-hfc_female-medium] [--speed 0.95]

Reads <scene dir>/lines.txt (one line per scene) and writes vo1.wav, vo2.wav, … and durs.txt there.
The brand name is respelled for the voice so it's always said "ee-ther" (see PRONOUNCE).
Needs Piper: pip install piper-tts, then python3 -m piper.download_voices <voice> in the voices dir.
"""

import argparse
import re
import wave
from pathlib import Path

from piper import PiperVoice, SynthesisConfig

# How the voice should say words it would get wrong. "Eithr" alone comes out "ee-thur";
# "Eether" gives "ee-ther", like "either".
PRONOUNCE = {
    r"\beithr\.app\b": "Eether dot app",
    r"\beithr\b": "Eether",
    r"@eithr\b": "at Eether",
}


def speakable(text: str) -> str:
    for pattern, said in PRONOUNCE.items():
        text = re.sub(pattern, said, text, flags=re.IGNORECASE)
    return text


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("scene", type=Path)
    ap.add_argument("--voice", default="en_US-hfc_female-medium")
    ap.add_argument("--voices-dir", type=Path, default=Path.home() / ".local/share/piper")
    ap.add_argument("--speed", type=float, default=0.95, help="length scale: below 1 is faster")
    args = ap.parse_args()

    voice = PiperVoice.load(args.voices_dir / f"{args.voice}.onnx")
    config = SynthesisConfig(length_scale=args.speed)
    lines = [l.strip() for l in (args.scene / "lines.txt").read_text().splitlines() if l.strip()]
    durs = []
    for i, line in enumerate(lines, 1):
        out = args.scene / f"vo{i}.wav"
        with wave.open(str(out), "wb") as wav:
            voice.synthesize_wav(speakable(line), wav, syn_config=config)
        with wave.open(str(out)) as wav:
            durs.append(wav.getnframes() / wav.getframerate())
        print(f"vo{i}.wav  {durs[-1]:.2f}s  {speakable(line)}")
    (args.scene / "durs.txt").write_text(" ".join(f"{d:.2f}" for d in durs) + "\n")


if __name__ == "__main__":
    main()
