"""Throwaway TTS fallback benchmark. Nothing in the product imports this.

Usage (keys loaded from the environment, never printed):
  set -a; . /path/to/.env.hosted; set +a
  python3 bench.py synth|latency|analyze|build
"""
import base64, difflib, io, json, os, random, re, statistics, subprocess, sys, time, wave
from pathlib import Path
import httpx

HERE = Path(__file__).parent
RES = HERE / "results"; RES.mkdir(exist_ok=True)
LINES = json.loads((HERE / "lines.json").read_text())
LAT_LINES = ["bm2", "ml3", "en2"]
LANG = {"bm": "Malay", "ml": "Malay", "en": "English", "zh": "Chinese"}
CODE = {"bm": "ms", "ml": "ms", "en": "en", "zh": "zh"}
GEMINI_URL = ("https://aiplatform.googleapis.com/v1/publishers/google/models/"
              "gemini-3.8-flash-lite-tts:streamGenerateContent?alt=sse")


def fal_headers():
    return {"Authorization": f"Key {os.environ['FAL_KEY']}", "content-type": "application/json"}


def pcm_to_wav(pcm, rate=24000):
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm)
    return b.getvalue()


# Each synth returns (audio_bytes, file_ext, t_first_audio, t_total). Times in seconds,
# measured from request start. For non-streamed providers t_first = t_total (audio only
# exists when the whole clip is ready, download included).
def s_gemini_direct(c, text, lang):
    body = {"contents": [{"role": "user", "parts": [{"text": text}]}],
            "generationConfig": {"responseModalities": ["AUDIO"],
              "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": "Kore"}}},
              "response_format": {"audio": {"mime_type": "AUDIO_L16"}}}}
    t0 = time.perf_counter(); first = None; pcm = b""
    with c.stream("POST", GEMINI_URL, json=body, headers={"x-goog-api-key": os.environ["GOOGLE_CLOUD_API_KEY"]}) as r:
        if r.status_code != 200:
            raise RuntimeError(f"gemini HTTP {r.status_code}")
        for line in r.iter_lines():
            if not line.startswith("data:"): continue
            try: parts = json.loads(line[5:])["candidates"][0]["content"]["parts"]
            except Exception: continue
            for p in parts:
                d = (p.get("inlineData") or {}).get("data")
                if d:
                    if first is None: first = time.perf_counter() - t0
                    pcm += base64.b64decode(d)
    return pcm_to_wav(pcm[: len(pcm) // 2 * 2]), "wav", first, time.perf_counter() - t0


def _fal_sync(c, endpoint, payload):
    t0 = time.perf_counter()
    r = c.post(f"https://fal.run/{endpoint}", json=payload, headers=fal_headers())
    if r.status_code != 200:
        raise RuntimeError(f"fal {endpoint} HTTP {r.status_code}: {r.text[:200]}")
    j = r.json(); a = j["audio"]
    data = c.get(a["url"]).content
    ext = "wav" if "wav" in a.get("content_type", "") or a["url"].endswith(".wav") else \
          "mp3" if "mpeg" in a.get("content_type", "") else "pcm"
    t = time.perf_counter() - t0
    return data, ext, t, t


def s_gemini_fal(c, text, lang):
    return _fal_sync(c, "google/gemini-3.8-flash-lite-tts", {"prompt": text, "voice": "Kore"})


def s_eleven(c, text, lang):
    d, ext, a, b = _fal_sync(c, "elevenlabs/tts/eleven-v4-turbo",
        {"text": text, "voice": "Aria", "language_code": CODE[lang], "output_format": "pcm_24000"})
    return (pcm_to_wav(d), "wav", a, b) if ext in ("pcm", "wav") and not d[:4] == b"RIFF" else (d, ext, a, b)


def s_chatterbox(c, text, lang):
    v = {"bm": "malay", "ml": "malay", "en": "english", "zh": "chinese"}[lang]
    return _fal_sync(c, "fal-ai/chatterbox/text-to-speech/multilingual", {"text": text, "voice": v})


def s_minimax(c, text, lang):
    body = {"prompt": text, "voice_setting": {"voice_id": "Calm_Woman"}, "language_boost": LANG[lang],
            "audio_setting": {"sample_rate": 24000, "format": "mp3", "bitrate": 128000}}
    t0 = time.perf_counter(); first = None; buf = b""
    with c.stream("POST", "https://fal.run/fal-ai/minimax/speech-2.8-turbo/stream", json=body, headers=fal_headers()) as r:
        if r.status_code != 200:
            raise RuntimeError(f"minimax HTTP {r.status_code}")
        for ch in r.iter_bytes():
            if ch and first is None: first = time.perf_counter() - t0
            buf += ch
    return buf, "mp3", first, time.perf_counter() - t0


CANDS = {  # key: (label, function, streamed?)
    "gemini_direct": ("Gemini 3.8 Flash Lite TTS, Google direct (reference)", s_gemini_direct, True),
    "gemini_fal": ("Gemini 3.8 Flash Lite TTS via fal", s_gemini_fal, False),
    "minimax": ("MiniMax Speech 2.8 Turbo via fal (/stream)", s_minimax, True),
    "eleven": ("ElevenLabs Eleven v4 Turbo via fal", s_eleven, False),
    "chatterbox": ("Chatterbox Multilingual via fal", s_chatterbox, False),
}


def client():
    return httpx.Client(timeout=httpx.Timeout(60, connect=10))


def load(name):
    p = RES / name
    return json.loads(p.read_text()) if p.exists() else {}


def save(name, obj):
    (RES / name).write_text(json.dumps(obj, indent=1, ensure_ascii=False))


def cmd_synth(only=None):
    meta = load("synth.json"); c = client()
    for key, (label, fn, _) in CANDS.items():
        if only and key not in only: continue
        for ln in LINES:
            out = RES / key / f"{ln['id']}.raw"
            if (RES / key / f"{ln['id']}.meta").exists(): continue
            (RES / key).mkdir(exist_ok=True)
            try:
                data, ext, tf, tt = fn(c, ln["text"], ln["lang"])
            except Exception as e:
                print(key, ln["id"], "FAIL", str(e)[:200]); meta.setdefault(key, {})[ln["id"]] = {"error": str(e)[:200]}; continue
            out.write_bytes(data)
            (RES / key / f"{ln['id']}.meta").write_text(json.dumps({"ext": ext, "first": tf, "total": tt}))
            meta.setdefault(key, {})[ln["id"]] = {"ext": ext, "first": tf, "total": tt}
            print(key, ln["id"], ext, f"first={tf:.2f} total={tt:.2f}")
            if key == "gemini_direct": time.sleep(10)  # stay far below the shared 11 req/min limit
    save("synth.json", meta)


def cmd_latency():
    lat = load("latency.json"); c = client()
    for key, (label, fn, _) in CANDS.items():
        if key in ("gemini_direct", "chatterbox"): continue  # chatterbox: 12 single runs only; never re-hit the direct endpoint: use the 12 reference runs
        runs = {}
        for lid in LAT_LINES:
            ln = next(l for l in LINES if l["id"] == lid)
            try: fn(c, ln["text"], ln["lang"])  # warm-up, discarded
            except Exception as e: print(key, "warmup fail", str(e)[:120])
            vals = []
            for _ in range(5):
                try:
                    _, _, tf, tt = fn(c, ln["text"], ln["lang"]); vals.append((tf, tt))
                except Exception as e: print(key, lid, "fail", str(e)[:120])
            runs[lid] = vals
            print(key, lid, [f"{a:.2f}/{b:.2f}" for a, b in vals])
        lat[key] = runs
    save("latency.json", lat)


def to_wav24(src, dst):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(dst)], check=True)


def lead_silence_ms(wavp, thr_db=-40):
    with wave.open(str(wavp)) as w:
        n = w.getnframes(); raw = w.readframes(n)
    import array
    a = array.array("h"); a.frombytes(raw)
    thr = 32768 * 10 ** (thr_db / 20)
    for i, s in enumerate(a):
        if abs(s) > thr: return round(i / 24000 * 1000), n / 24000
    return None, n / 24000


def norm(s):
    s = s.lower()
    return re.sub(r"[^\w ]", " ", s)


def dg(c, wavp, lang):
    # nova-3: try the Malay model first for BM/Manglish, 'multi' otherwise; failures -> by ear
    langs = {"bm": ["ms", "multi"], "ml": ["ms", "multi"], "en": ["en"], "zh": ["zh", "multi"]}[lang]
    for L in langs:
        r = c.post(f"https://api.deepgram.com/v1/listen?model=nova-3&language={L}&smart_format=false",
                   headers={"Authorization": f"Token {os.environ['DEEPGRAM_API_KEY']}", "content-type": "audio/wav"},
                   content=Path(wavp).read_bytes())
        if r.status_code == 200:
            return L, r.json()["results"]["channels"][0]["alternatives"][0]["transcript"]
    return None, None


def cmd_analyze():
    meta = load("synth.json"); an = {}; c = client()
    for key in CANDS:
        for ln in LINES:
            m = (meta.get(key) or {}).get(ln["id"])
            if not m or "error" in m: continue
            src = RES / key / f"{ln['id']}.raw"; w = RES / key / f"{ln['id']}.wav"
            if m["ext"] == "pcm":
                w.write_bytes(pcm_to_wav(src.read_bytes()))
            elif m["ext"] == "wav" and src.read_bytes()[:4] != b"RIFF":
                w.write_bytes(pcm_to_wav(src.read_bytes()))
            else:
                tmp = src.with_name(src.stem + ".in." + m["ext"]); tmp.write_bytes(src.read_bytes()); to_wav24(tmp, w)
            sil, dur = lead_silence_ms(w)
            L, tr = dg(c, w, ln["lang"])
            sim = None
            if tr is not None:
                sim = round(difflib.SequenceMatcher(None, norm(ln["text"]), norm(tr)).ratio(), 2)
            an.setdefault(key, {})[ln["id"]] = {"dur": round(dur, 2), "lead_ms": sil, "chars": len(ln["text"]), "dg_lang": L, "dg": tr, "sim": sim}
            print(key, ln["id"], f"dur={dur:.2f} lead={sil}ms dg={L} sim={sim}")
    save("analysis.json", an)


SECTIONS = [("bm", "Bahasa Melayu"), ("ml", "Manglish"), ("en", "English"), ("zh", "Mandarin 中文")]
SHORT = {"gemini_direct": "Gemini direct", "gemini_fal": "Gemini via fal", "minimax": "MiniMax 2.8 Turbo",
         "eleven": "ElevenLabs v4 Turbo", "chatterbox": "Chatterbox ML"}


def cmd_build():
    keys = [k for k in CANDS if (RES / k / "bm1.wav").exists()]
    rnd = random.Random(20261114); order = keys[:]; rnd.shuffle(order)
    letters = {k: "ABCDEFG"[i] for i, k in enumerate(order)}
    tmp = RES / "m4a"; tmp.mkdir(exist_ok=True)
    uri = {}
    for k in keys:
        for ln in LINES:
            out = tmp / f"{k}_{ln['id']}.m4a"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(RES / k / f"{ln['id']}.wav"),
                "-af", "loudnorm=I=-20:TP=-2:LRA=7", "-ar", "24000", "-ac", "1", "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart", str(out)], check=True)
            uri[(k, ln["id"])] = "data:audio/mp4;base64," + base64.b64encode(out.read_bytes()).decode()
    rows = []
    for code, title in SECTIONS:
        rows.append(f'<h2>{title}</h2>')
        for ln in [l for l in LINES if l["lang"] == code]:
            rows.append(f'<div class="line"><p class="t">{ln["text"]} <span class="n">{ln["id"]} · {ln["note"]}</span></p><div class="cands">')
            for k in sorted(keys, key=lambda x: letters[x]):
                L = letters[k]; i = f"{k}_{ln['id']}"
                rows.append(f'<div class="c"><b>{L}</b><audio controls preload="none" src="{uri[(k, ln["id"])]}"></audio>'
                            f'<select data-k="{L}_{ln["id"]}" aria-label="rating {L} {ln["id"]}"><option value="">–</option>'
                            + "".join(f'<option>{n}</option>' for n in range(1, 6)) + '</select></div>')
            rows.append('</div></div>')
    key_rows = "".join(f'<li><b>{letters[k]}</b> = {CANDS[k][0]}</li>' for k in sorted(keys, key=lambda x: letters[x]))
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JomCall TTS fallback listening test</title><style>
:root{{--bg:#fff;--fg:#1a1a1a;--mut:#666;--bd:#ddd;--ac:#0a6}}
@media(prefers-color-scheme:dark){{:root{{--bg:#121212;--fg:#eee;--mut:#999;--bd:#333;--ac:#4c9}}}}
body{{margin:0;padding:16px;max-width:760px;margin-inline:auto;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,sans-serif}}
h1{{font-size:1.3rem}}h2{{margin-top:2rem;border-bottom:2px solid var(--ac)}}
.line{{border:1px solid var(--bd);border-radius:8px;padding:10px;margin:12px 0}}.t{{margin:0 0 8px;font-weight:600}}.n{{font-weight:400;color:var(--mut);font-size:.8rem;display:block}}
.c{{display:flex;align-items:center;gap:8px;margin:6px 0}}.c b{{width:1.4em;font-size:1.2rem}}audio{{flex:1;min-width:0;height:36px}}select{{font-size:16px;padding:4px}}
button{{font-size:16px;padding:10px 14px;margin:4px 4px 4px 0;border-radius:8px;border:1px solid var(--bd);background:var(--bg);color:var(--fg)}}
textarea{{width:100%;box-sizing:border-box;height:6em}}#key{{display:none}}
</style></head><body><h1>JomCall: fallback voice listening test</h1>
<p>Blind test. Candidates are lettered A–{"ABCDEFG"[len(keys)-1]}; the order differs from the README. Every clip is loudness-matched to −20 LUFS. Latency is <b>not</b> in these clips: judge only the sound.</p>
<p><b>How to rate:</b> for each line pick 1–5 per letter (5 = I would put this on a customer call; 3 = understandable but odd; 1 = wrong words, wrong language, or unpleasant). Listen for: Malay vowels and stress, "RM 85", the time, digits read one by one, the Malay road name, Manglish switching, and silence or clicks at the start. Use the buttons at the bottom to copy your picks and paste them to Claude, or just write "BM: C &gt; A &gt; D" etc. Ratings are kept only in this browser.</p>
{"".join(rows)}
<h2>Your ratings</h2><button id="copy">Copy my ratings</button><button id="reveal">Reveal which is which</button>
<textarea id="out" readonly placeholder="Ratings appear here"></textarea>
<div id="key"><h2>Key</h2><ul>{key_rows}</ul><p>Fixed voices: Gemini Kore · MiniMax Calm_Woman · ElevenLabs Aria · Chatterbox default voice.</p></div>
<script>
const S=document.querySelectorAll('select');
try{{S.forEach(s=>{{const v=localStorage.getItem('tts_'+s.dataset.k);if(v)s.value=v}})}}catch(e){{}}
S.forEach(s=>s.onchange=()=>{{try{{localStorage.setItem('tts_'+s.dataset.k,s.value)}}catch(e){{}}}});
document.getElementById('copy').onclick=()=>{{const o=[];S.forEach(s=>{{if(s.value)o.push(s.dataset.k+'='+s.value)}});const t=o.join(' ');
document.getElementById('out').value=t;try{{navigator.clipboard.writeText(t)}}catch(e){{}}}};
document.getElementById('reveal').onclick=()=>{{document.getElementById('key').style.display='block';document.getElementById('key').scrollIntoView()}};
document.addEventListener('play',e=>{{document.querySelectorAll('audio').forEach(a=>{{if(a!==e.target)a.pause()}})}},true);
</script></body></html>"""
    (HERE / "listen.html").write_text(html)
    save("letters.json", letters)
    print({k: letters[k] for k in keys}, len(html) / 1e6, "MB")


PRICE_PER_1K = {"gemini_fal": 0.03, "minimax": 0.06, "eleven": 0.04, "chatterbox": 0.025}  # fal model pages, 2026-11-14


def cmd_summary():
    syn, lat, an = load("synth.json"), load("latency.json"), load("analysis.json")
    out = []
    for k in CANDS:
        a = an.get(k, {}); s = syn.get(k, {})
        chars = sum(v["chars"] for v in a.values()); dur = sum(v["dur"] for v in a.values())
        if k in lat:
            runs = [r for v in lat[k].values() for r in v]; n = len(runs); how = "5 runs x 3 lines, warm-up dropped"
        else:
            runs = [(v["first"], v["total"]) for v in s.values() if "first" in v]; n = len(runs); how = "12 single runs (one per line)"
        first = statistics.median(r[0] for r in runs); total = statistics.median(r[1] for r in runs)
        rtfs = [s[i]["total"] / a[i]["dur"] for i in a if i in s and "total" in s[i]]
        cps = chars / dur
        ppm = PRICE_PER_1K[k] / 1000 * cps * 60 if k in PRICE_PER_1K else None
        lead = statistics.median(v["lead_ms"] for v in a.values() if v["lead_ms"] is not None)
        sims = [v["sim"] for v in a.values() if v["sim"] is not None]
        out.append(dict(key=k, n=n, how=how, first=round(first, 2), total=round(total, 2), rtf=round(statistics.median(rtfs), 2),
                        cps=round(cps, 1), usd_min=None if ppm is None else round(ppm, 4), lead_ms=lead, sim=round(statistics.mean(sims), 2),
                        max_first=round(max(r[0] for r in runs), 2)))
    save("summary.json", out)
    for o in out: print(o)


if __name__ == "__main__":
    cmd = sys.argv[1]
    {"synth": lambda: cmd_synth(sys.argv[2:] or None), "latency": cmd_latency, "analyze": cmd_analyze, "build": cmd_build, "summary": cmd_summary}[cmd]()
