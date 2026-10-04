# Audio pipeline

Sounds and music for "Basnie Karkonoszy" are generated with fal.ai and committed as mp3.

```bash
cd tools/assets
uv venv .venv && uv pip install --python .venv/bin/python fal-client pyyaml requests numpy soundfile imageio-ffmpeg pytest
.venv/bin/python audio.py                # generate whatever has no raw/audio/<id>.wav, process everything
.venv/bin/python audio.py --only ui/,mine/bell   # restrict to ids or category prefixes
.venv/bin/python audio.py --regen --only mine/bell   # throw the raw wav away and re-roll it
.venv/bin/python audio.py --check        # every manifest entry exists + decodes, total <= 10 MB, prints a table
.venv/bin/python -m pytest -q test_audio_manifest.py
```

The fal.ai key comes from `FAL_KEY` or the `fal:` line in `~/.api_keys` (`falkey.py`). It is never printed or committed.

## Files

| File | Purpose |
| --- | --- |
| `audio_manifest.yaml` | the source of truth: clip ids, prompts, seconds, loop flags, model routes |
| `audio.py` | generate -> silence check -> loop/one-shot shaping -> loudnorm -> mp3 -> manifest + lock |
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
4. ffmpeg `loudnorm` two-pass with `linear=true` (one constant gain, so a loop seam is not touched), `TP=-3`, `LRA=11`. Targets: music -20 LUFS, looped backgrounds -23, `ui/*` -18, other effects -16.
5. `-ar 44100 -c:a libmp3lame -q:a 3` (the ffmpeg from `imageio-ffmpeg` includes libmp3lame, there is no system ffmpeg).

## Things to know

- Peaky one-shots (tap, pluck, pick, steps, mold) cannot reach their LUFS target under `TP=-3`: they end up peaking at about -3 dBFS and read lower in LUFS (for example `herbs/pluck` -33.6 LUFS, `ui/tap` -26.1). They are already as loud as the true-peak ceiling allows, so `core/Audio.ts` should use per-clip gains if they sound too quiet next to the others.
- MP3 has encoder delay/padding. Decoders that honour the LAME gapless header should loop cleanly (not verified in a browser here, nobody can listen in this pipeline); a decoder that ignores it can add a tiny gap at the loop point. The baked-in crossfade removes the waveform discontinuity either way.
- The `seconds` in `manifest.json` is the length of the shaped audio before encoding (the decoded mp3 is within 10 ms).
- Raw wavs are kept in `raw/audio/` (git-ignored). Delete one (or use `--regen`) to re-roll a clip; the lock then records the new url and attempts.
