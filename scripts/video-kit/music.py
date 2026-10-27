import numpy as np, wave, sys
SR = 44100; BPM = 120; beat = 60 / BPM
total = float(sys.argv[1])
n = int(SR * total); out = np.zeros(n)
t_all = np.arange(n) / SR
def add(sig, at, gain=1.0):
    i = int(at * SR); j = min(n, i + len(sig))
    if i < n: out[i:j] += sig[: j - i] * gain
def env(length, attack=0.005, decay=0.2):
    t = np.arange(int(SR * length)) / SR
    return np.minimum(1, t / attack) * np.exp(-t / decay)
def kick():
    t = np.arange(int(SR * 0.35)) / SR
    f = 50 + 110 * np.exp(-t * 35)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
def clap():
    t = np.arange(int(SR * 0.18)) / SR
    noise = np.random.default_rng(1).standard_normal(len(t))
    return noise * np.exp(-t * 22) * 0.6
def hat():
    t = np.arange(int(SR * 0.05)) / SR
    noise = np.random.default_rng(2).standard_normal(len(t))
    hp = np.diff(noise, prepend=0)
    return hp * np.exp(-t * 80) * 0.25
def tone(freq, length, shape='saw', decay=0.25):
    t = np.arange(int(SR * length)) / SR
    if shape == 'saw':
        s = sum(np.sin(2 * np.pi * freq * k * t) / k for k in range(1, 7))
    else:
        s = np.sin(2 * np.pi * freq * t)
    return s * env(length, 0.004, decay)
def note(m): return 440 * 2 ** ((m - 69) / 12)
chords = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]  # C G Am F
bass = [36, 31, 33, 29]
bars = int(total / (4 * beat)) + 1
K, Cl, H = kick(), clap(), hat()
for b in range(bars):
    t0 = b * 4 * beat
    ch = chords[b % 4]
    for q in range(4):
        add(K, t0 + q * beat, 0.9)
        if q in (1, 3): add(Cl, t0 + q * beat, 0.5)
        for e in range(2): add(H, t0 + q * beat + e * beat / 2, 0.6 if e else 0.35)
        add(tone(note(bass[b % 4]), beat * 0.9, 'sine', 0.3), t0 + q * beat, 0.55)
    # Bright off-beat chord stabs (the bouncy part).
    for q in range(4):
        for m in ch:
            add(tone(note(m + 12), beat * 0.4, 'saw', 0.09), t0 + q * beat + beat / 2, 0.07)
# Gentle intro/outro.
fade = np.ones(n); fi = int(SR * 0.4); fo = int(SR * 2.0)
fade[:fi] = np.linspace(0, 1, fi); fade[-fo:] = np.linspace(1, 0, fo)
out *= fade
out = np.tanh(out * 0.9)
out /= np.max(np.abs(out)) + 1e-9
pcm = (out * 0.8 * 32767).astype(np.int16)
stereo = np.repeat(pcm[:, None], 2, axis=1)
with wave.open('music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(stereo.tobytes())
print('ok', total)
