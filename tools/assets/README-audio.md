# Audio pipeline

Sounds and music for "Basnie Karkonoszy" are generated with fal.ai and committed as mp3.

```bash
cd tools/assets
uv venv .venv && uv pip install --python .venv/bin/python fal-client pyyaml requests numpy soundfile imageio-ffmpeg pytest
.venv/bin/python audio.py                # generate whatever has no raw/audio/<id>.wav, process everything
.venv/bin/python audio.py --only ui/,mine/bell   # restrict to ids or category prefixes; clips with a raw wav are only re-processed (no API calls)
.venv/bin/python audio.py --regen --only mine/bell   # throw the raw wav away and re-roll it
.venv/bin/python audio.py --check        # manifest complete, every entry exists + decodes, total <= 10 MB, prints a table; exit 1 on any problem
.venv/bin/python -m pytest -q test_audio_manifest.py
```

The fal.ai key comes from `FAL_KEY` or the `fal:` line in `~/.api_keys` (`falkey.py`). It is never printed or committed.

## Files

| File | Purpose |
| --- | --- |
| `audio_manifest.yaml` | the source of truth: clip ids, prompts, seconds, loop flags, model routes |
| `audio.py` | generate -> silence check -> loop/one-shot shaping -> constant gain (loops) or loudnorm (one-shots) -> mp3 -> manifest + lock |
| `raw/audio/<id>.wav` | raw model output, git-ignored (kept locally so re-processing needs no API calls) |
| `raw/audio.lock.json` | per clip: model actually used, prompt, seconds requested, wav url, raw and final peak dBFS, attempts, loudness target, normalization type |
| `../../public/assets/audio/<cat>/<id>.mp3` | the encoded clips |
| `../../public/assets/audio/manifest.json` | `{ "clips": { "<cat>/<id>": { "src": "audio/<cat>/<id>.mp3", "seconds": 3.2, "loop": false } } }`, `src` relative to `/assets/` |

The brief says "34 clips" but its YAML (copied verbatim) lists 33: 5 music, 4 ui, 6 glass, 5 turnips, 7 mine, 6 herbs.

## Models

Primary for both routes: `fal-ai/stable-audio-25/text-to-audio` with `{prompt, seconds_total}` (integer seconds, answers `{"audio": {"url": "...wav"}}`, 44.1 kHz stereo wav, about 12 s per clip, 45 s music took about 15 s).
`fal-ai/elevenlabs/sound-effects` rejected a request ("Sound effect generation failed") and is not used.

Fallbacks (tried automatically when the primary raises), probed once with one clip each on 2026-10-04:

| Fallback | Request | Response |
| --- | --- | --- |
| `cassetteai/sound-effects-generator` | `{"prompt": ..., "duration": 1}` | 3.8 s, `{"audio_file": {"url": "...generated.wav", "content_type": "application/octet-stream", "file_name": "generated.wav", "file_size": 176478}}`, 44.1 kHz stereo 16-bit wav |
| `cassetteai/music-generator` | `{"prompt": ..., "duration": 20}` | 21.9 s, same `audio_file` shape (3.5 MB for 20 s) |

Note the different response key (`audio_file`, not `audio`); `call_model` handles both. In the real run no clip needed a fallback and none needed a re-roll (every clip succeeded on attempt 1).

## What the script does to each clip

1. Request `ceil(seconds)` seconds (loops: one second more, so a whole `seconds` survive the crossfade).
2. Silence check on the raw wav: peak below -40 dBFS re-rolls, max 3 attempts. A primary-model exception tries the fallback within the same attempt. A clip that still fails is left out of `manifest.json` and listed on the console.
3. Loops: trim to whole seconds and equal-power crossfade the last 150 ms onto the first 150 ms (numpy), so `out[-1] -> out[0]` continues the original waveform. One-shots: trim to `seconds`, 3 ms fade in, 40 ms fade out.
4. Loudness. Targets: music -20 LUFS, looped backgrounds -23, `ui/*` -18, other effects -16; true-peak ceiling -3 dBTP.
   - Loops get ONE constant gain: `audio.py` measures integrated loudness and true peak once (ffmpeg `loudnorm` pass 1, used only as a meter) and applies `gain = min(target - measured LUFS, -3 - measured dBTP)` with a plain `volume=` filter. Head and tail get exactly the same gain, so there is no level step at the loop point. `loudnorm` itself is not used for loops because it silently switches to dynamic mode (a gain ramp across the clip) whenever the clip cannot reach the target inside TP/LRA, which is what happened to `music/mine` (LRA 21.7) before.
   - The encoded loop is verified: decoded peak must stay within 1 dB of the ceiling (mp3 overshoot margin) and the head-vs-tail gain step (RMS of the first and last second, mp3 vs source) must be <= 0.5 dB. A loop that fails is deleted, left out of `manifest.json`, and the run exits non-zero. The measured values are in the lock (`gain_db`, `measured_lufs`, `measured_tp_dbtp`, `loudness_shortfall_lu`, `loop_head_tail_gain_step_db`).
   - One-shots use two-pass `loudnorm` (`linear=true` when possible; ffmpeg falls back to its dynamic mode when linear is impossible, the type is stored as `normalization` in the lock). A one-shot has no seam, so a dynamic ramp there is harmless.
5. `-ar 44100 -c:a libmp3lame -q:a 3` (the ffmpeg from `imageio-ffmpeg` includes libmp3lame, there is no system ffmpeg).

## Things to know

- Peaky one-shots (tap, pluck, pick, steps, mold) cannot reach their LUFS target under `TP=-3`: they end up peaking at about -3 dBFS and read lower in LUFS (for example `herbs/pluck` -33.6 LUFS, `ui/tap` -26.1). They are already as loud as the true-peak ceiling allows, so `core/Audio.ts` should use per-clip gains if they sound too quiet next to the others.
- The same limit applies to three sparse, peaky loops that are now peak-limited by their constant gain instead of being compressed by dynamic loudnorm: `herbs/steps` (-28.8 LUFS vs -23 target), `mine/drip` (-29.9) and `mine/geiger_slow` (-26.4); the shortfall is recorded as `loudness_shortfall_lu` in the lock. Give them a gain in `core/Audio.ts` if they are too quiet.
- `audio.py --check` fails (exit 1) when `manifest.json` is incomplete (a clip of `audio_manifest.yaml` is missing, an unknown id is present, or a loop flag differs), not only when a file is missing or does not decode.
- MP3 has encoder delay/padding. Decoders that honour the LAME gapless header should loop cleanly (not verified in a browser here, nobody can listen in this pipeline); a decoder that ignores it can add a tiny gap at the loop point. The baked-in crossfade removes the waveform discontinuity either way.
- The `seconds` in `manifest.json` is the length of the shaped audio before encoding (the decoded mp3 is within 10 ms).
- Raw wavs are kept in `raw/audio/` (git-ignored). Delete one (or use `--regen`) to re-roll a clip; the lock then records the new url and attempts.
