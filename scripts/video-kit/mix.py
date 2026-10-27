"""Puts a video together: frames + voice-over lines (+ optional music, ducked under the voice).

    python3 scripts/video-kit/mix.py <scene dir> [--music] [--out eithr-video.mp4]

Uses vo*.wav, starts.json and total.txt (from voice.py and render.cjs). With --music it first
makes music.wav with music.py. Needs ffmpeg.
"""

import argparse
import json
import subprocess
from pathlib import Path

KIT = Path(__file__).parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("scene", type=Path)
    ap.add_argument("--music", action="store_true")
    ap.add_argument("--out", default="eithr-video.mp4")
    args = ap.parse_args()
    d = args.scene
    starts = json.loads((d / "starts.json").read_text())
    total = float((d / "total.txt").read_text())

    inputs, f = [], []
    for i, s in enumerate(starts):
        inputs += ["-i", str(d / f"vo{i + 1}.wav")]
        ms = int((s + 0.25) * 1000)
        f.append(f"[{i}:a]adelay={ms}|{ms},aformat=sample_rates=44100:channel_layouts=stereo[a{i}]")
    k = len(starts)
    voices = "".join(f"[a{i}]" for i in range(k))
    if args.music:
        subprocess.run(["python3", str(KIT / "music.py"), str(total)], cwd=d, check=True)
        inputs += ["-i", str(d / "music.wav")]
        f.append(f"{voices}amix=inputs={k}:normalize=0,apad,atrim=0:{total},volume=1.6,asplit=2[voice][key]")
        f.append(f"[{k}:a]atrim=0:{total},volume=0.32[mus]")
        f.append("[mus][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=300[ducked]")
        f.append("[voice][ducked]amix=inputs=2:normalize=0,loudnorm=I=-15:TP=-1.5[out]")
    else:
        f.append(f"{voices}amix=inputs={k}:normalize=0,apad,atrim=0:{total},loudnorm=I=-16:TP=-1.5[out]")
    audio = d / "mix.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(f), "-map", "[out]", "-ar", "44100", str(audio)], check=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-framerate", "30", "-i", str(d / "frames/f%05d.jpg"), "-i", str(audio),
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-c:a", "aac", "-b:a", "160k",
         "-shortest", "-movflags", "+faststart", str(d / args.out)],
        check=True,
    )
    print(d / args.out)


if __name__ == "__main__":
    main()
