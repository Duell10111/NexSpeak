"""Rebuild the bundled soundboard sounds (Python standard library + FFmpeg with libmp3lame).

Everything is synthesized here from oscillators and seeded noise; no samples are used.
Run from apps/web: python3 scripts/generate-sounds.py
"""
import math
from pathlib import Path
import random
import struct
import subprocess
import tempfile
import wave

RATE = 48000
# All sounds share one integrated loudness so none of them jumps out in a call.
LOUDNESS = "-20"
OUT = Path(__file__).resolve().parent.parent / "public" / "sounds"
TAU = 2 * math.pi


def silence(seconds):
    return [0.0] * int(seconds * RATE)


def mix(target, source, at, gain=1.0, release=0.03):
    """Add `source` at `at` seconds, fading its last `release` seconds so a cut-off note does not click."""
    start = int(at * RATE)
    if len(target) < start + len(source):
        target.extend([0.0] * (start + len(source) - len(target)))
    r = min(int(release * RATE), len(source))
    for i, value in enumerate(source):
        left = len(source) - 1 - i
        fade = 0.5 - 0.5 * math.cos(math.pi * left / r) if left < r else 1.0
        target[start + i] += value * gain * fade


def envelope(n, attack, decay):
    """Short linear attack, then exponential decay with time constant `decay` (seconds)."""
    a = max(1, int(attack * RATE))
    return [i / a if i < a else math.exp(-(i - a) / (decay * RATE)) for i in range(n)]


def partials(freq, seconds, spec, attack=0.002):
    """Sum of sines; spec = [(ratio, gain, decay)]. Each partial decays on its own."""
    n = int(seconds * RATE)
    out = [0.0] * n
    for ratio, gain, decay in spec:
        f = freq * ratio
        if f >= RATE / 2:
            continue
        env = envelope(n, attack, decay)
        step = TAU * f / RATE
        for i in range(n):
            out[i] += gain * env[i] * math.sin(step * i)
    return out


def noise(seconds, seed):
    rng = random.Random(seed)
    return [rng.uniform(-1, 1) for _ in range(int(seconds * RATE))]


def biquad(signal, kind, freq, q=0.707):
    """RBJ cookbook filter: lowpass, highpass or bandpass (constant peak gain)."""
    w = TAU * freq / RATE
    alpha = math.sin(w) / (2 * q)
    cos = math.cos(w)
    if kind == "lowpass":
        b = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
    elif kind == "highpass":
        b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
    else:
        b = [alpha, 0.0, -alpha]
    a0, a1, a2 = 1 + alpha, -2 * cos, 1 - alpha
    b0, b1, b2 = (x / a0 for x in b)
    a1, a2 = a1 / a0, a2 / a0
    out, x1, x2, y1, y2 = [], 0.0, 0.0, 0.0, 0.0
    for x in signal:
        y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        out.append(y)
        x2, x1, y2, y1 = x1, x, y1, y
    return out


def shaped(signal, attack, decay):
    env = envelope(len(signal), attack, decay)
    return [s * e for s, e in zip(signal, env)]


def reverb(signal, wet=0.18, tail=0.6):
    """Small Schroeder room (parallel combs into series allpasses) for a bit of space."""
    padded = signal + silence(tail)
    combs = []
    for delay_ms, feedback in ((29.7, 0.77), (37.1, 0.75), (41.1, 0.73), (43.7, 0.71)):
        d = int(delay_ms * RATE / 1000)
        buf = [0.0] * d
        out, damp = [], 0.0
        for i, x in enumerate(padded):
            y = buf[i % d]
            damp = 0.6 * y + 0.4 * damp
            buf[i % d] = x + damp * feedback
            out.append(y)
        combs.append(out)
    wet_signal = [sum(c[i] for c in combs) / 4 for i in range(len(padded))]
    for delay_ms in (5.0, 1.7):
        d = int(delay_ms * RATE / 1000)
        buf = [0.0] * d
        out = []
        for i, x in enumerate(wet_signal):
            delayed = buf[i % d]
            y = -0.7 * x + delayed
            buf[i % d] = x + 0.7 * y
            out.append(y)
        wet_signal = out
    return [d + wet * w for d, w in zip(padded, wet_signal)]


def finish(signal, fade=0.08):
    """Trim the tail below -54 dB, fade out, and normalize the peak (loudness is set on encode)."""
    peak = max(abs(s) for s in signal)
    end = len(signal)
    while end > 0 and abs(signal[end - 1]) < peak * 0.002:
        end -= 1
    signal = signal[:end]
    f = int(fade * RATE)
    for i in range(f):
        signal[len(signal) - f + i] *= 1 - i / f
    peak = max(abs(s) for s in signal)
    return [s / peak * 0.89 for s in signal]


def note(name):
    names = {"C": -9, "D": -7, "E": -5, "F": -4, "G": -2, "A": 0, "B": 2}
    semitone = names[name[0]] + (1 if "#" in name else 0) + 12 * (int(name[-1]) - 4)
    return 440 * 2 ** (semitone / 12)


def bell(freq, seconds):
    # Slightly inharmonic partials with faster-decaying highs give a soft glass/bell tone.
    return partials(freq, seconds, [
        (1.0, 1.0, 0.55), (2.0, 0.45, 0.32), (3.01, 0.22, 0.18),
        (4.17, 0.12, 0.10), (5.43, 0.06, 0.06), (1.003, 0.35, 0.7),
    ], attack=0.003)


def pluck(freq, seconds):
    return partials(freq, seconds, [
        (1.0, 1.0, 0.22), (2.0, 0.5, 0.12), (3.0, 0.28, 0.07), (4.0, 0.14, 0.05), (1.005, 0.4, 0.25),
    ], attack=0.002)


def chime():
    # Two-note "ding-dong" a major third down, like a doorbell but brighter.
    out = []
    mix(out, bell(note("E6"), 1.4), 0.0, 0.8, release=0.3)
    mix(out, bell(note("C6"), 1.5), 0.16, 0.75, release=0.3)
    mix(out, partials(note("E7"), 0.3, [(1.0, 1.0, 0.05)]), 0.0, 0.08)
    return finish(reverb(out, wet=0.22))


def celebrate():
    # Quick rising major arpeggio, then a bright chord with a shimmer of sparkles on top.
    out = []
    for i, name in enumerate(("C5", "E5", "G5", "C6")):
        mix(out, pluck(note(name), 0.45), i * 0.075, 0.55)
    chord_at = 0.3
    for name, gain in (("C5", 0.35), ("E5", 0.3), ("G5", 0.3), ("C6", 0.4), ("E6", 0.25)):
        mix(out, bell(note(name), 1.5), chord_at, gain, release=0.3)
    rng = random.Random(7)
    for k in range(9):
        freq = note("C7") * 2 ** (rng.choice((0, 4, 7, 12)) / 12)
        mix(out, partials(freq, 0.18, [(1.0, 1.0, 0.04), (2.0, 0.3, 0.02)]), chord_at + 0.03 + k * 0.045, 0.12)
    return finish(reverb(out, wet=0.2))


def tom(freq, seed):
    n = int(0.4 * RATE)
    phase, body = 0.0, []
    for i in range(n):
        t = i / RATE
        phase += TAU * freq * (1 + 0.6 * math.exp(-t / 0.02)) / RATE
        body.append(math.sin(phase) * math.exp(-t / 0.12))
    hit = shaped(biquad(noise(0.4, seed), "bandpass", 2500, 0.8), 0.0005, 0.01)
    return [b + 0.25 * h for b, h in zip(body, hit)]


def snare(seed):
    n = int(0.35 * RATE)
    tone = [math.sin(TAU * 185 * i / RATE) * math.exp(-i / (0.05 * RATE)) for i in range(n)]
    rattle = shaped(biquad(biquad(noise(0.35, seed), "highpass", 1200), "lowpass", 9000), 0.001, 0.09)
    return [0.5 * a + 0.8 * b for a, b in zip(tone, rattle)]


def kick():
    n = int(0.45 * RATE)
    phase, out = 0.0, []
    for i in range(n):
        t = i / RATE
        phase += TAU * (48 + 110 * math.exp(-t / 0.035)) / RATE
        out.append(math.sin(phase) * math.exp(-t / 0.16))
    return out


def cymbal(seed):
    # Filtered noise with a few inharmonic partials on top for the metallic ring.
    seconds = 0.9
    hiss = biquad(noise(seconds, seed), "highpass", 4500)
    body = [a + 0.6 * b for a, b in zip(
        biquad(hiss, "bandpass", 7500, 1.2), biquad(hiss, "bandpass", 11000, 1.5))]
    ring = partials(1, seconds, [(f, 0.05, 0.12) for f in (3227, 4213, 5671, 6829)], attack=0.001)
    return shaped([0.9 * b + r for b, r in zip(body, ring)], 0.001, 0.22)


def drum():
    # "Ba-dum-tss": two toms, then kick + snare under a cymbal crash.
    out = []
    mix(out, tom(190, 1), 0.0, 0.7)
    mix(out, tom(140, 2), 0.13, 0.75)
    mix(out, kick(), 0.33, 1.0)
    mix(out, snare(3), 0.33, 0.5)
    mix(out, cymbal(4), 0.34, 0.3)
    return finish(reverb(out, wet=0.12, tail=0.3))


def write(name, signal):
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / f"{name}.wav"
        with wave.open(str(raw), "wb") as file:
            file.setnchannels(1)
            file.setsampwidth(2)
            file.setframerate(RATE)
            file.writeframes(b"".join(struct.pack("<h", round(s * 32767)) for s in signal))
        subprocess.run([
            "ffmpeg", "-loglevel", "error", "-y", "-i", str(raw),
            "-af", f"loudnorm=I={LOUDNESS}:TP=-1.5:LRA=20,aresample={RATE}",
            "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", "64k", "-ac", "1",
            str(OUT / f"{name}.mp3"),
        ], check=True)


for name, build in (("chime", chime), ("celebrate", celebrate), ("drum", drum)):
    write(name, build())
    print(f"wrote {OUT / name}.mp3")
