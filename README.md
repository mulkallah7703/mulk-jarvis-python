# Mulk Jarvis

Voice assistant for **Mulk Allah Alsadi**. It listens from the moment it starts. Say **Kora** (or **كورا**) and it answers out loud, then keeps listening for the next question. No button, and no wake word between questions.

Two ways to run it:

- **On this computer:** Python, the local microphone, faster-whisper, and edge-tts. Setup is below.
- **On Vercel:** a Next.js page in this same repo. The browser listens and speaks. Gemini still answers. See [Web on Vercel](#web-on-vercel).

Speech-to-text on the desktop app stays on this machine (faster-whisper). Answers come from Gemini. Speech out is edge-tts, with an ElevenLabs switch when you want it.

## English setup

Python 3.10+ and a microphone.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Put a key from [Google AI Studio](https://aistudio.google.com/apikey) in `.env`:

```bash
GEMINI_API_KEY=your-key
```

`GOOGLE_API_KEY` works too. Then:

```bash
python -m jarvis
```

`python main.py` does the same thing. The first launch downloads the Whisper `base` model.

1. It waits, already listening.
2. Say **Kora**. It says **Hi Mulk Allah!** and opens a session.
3. Ask in Arabic or English. It answers in one or two sentences, then listens again.
4. Say **stop jarvis**, **goodbye**, or **توقف**. It goes back to waiting.
5. Ctrl+C during a session also goes back to waiting. Ctrl+C while it is waiting quits.

A command in the same breath as the wake word is answered immediately: `kora what time is it`.

No microphone:

```bash
python -m jarvis --text
python -m jarvis --list-devices
```

### Useful settings

| Variable | Default | Role |
| --- | --- | --- |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Thinking is off, for short replies. `gemini-2.5-flash-lite` is faster. `gemini-3.8-flash` is stronger. |
| `WHISPER_MODEL` | `base` | `tiny` is faster, `small` is better for Arabic. |
| `WHISPER_LANGUAGE` | auto | Set `ar` or `en` to skip detection. |
| `TTS_PROVIDER` | `edge` | `elevenlabs` plus `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`. |
| `EDGE_VOICE_AR` | `ar-SA-HamedNeural` | Arabic voice. English default is `en-US-GuyNeural`. |
| `VAD_SILENCE_MS` | `650` | Lower if it waits too long after you stop talking. |
| `INPUT_DEVICE` | default | Index or name from `--list-devices`. |

### Microphone

- **Linux:** `sudo apt install libportaudio2`. Your user should be able to open the mic (PipeWire or PulseAudio). If the wrong device is chosen, set `INPUT_DEVICE`.
- **macOS:** System Settings → Privacy & Security → Microphone, and allow the terminal. If the install fails to build audio, `brew install portaudio`.
- **Windows:** Settings → Privacy → Microphone, allow desktop apps. Then `--list-devices` and set `INPUT_DEVICE` if needed.

### Checks

```bash
python -m unittest discover -s tests
```

The browser wake-word checks live next to the page:

```bash
npm test
```

## Web on Vercel

The Python CLI needs a microphone process, faster-whisper, and edge-tts. That cannot stay running on Vercel serverless. The Next.js app at the repo root keeps the same conversation and leaves `python -m jarvis` unchanged.

1. The page asks for the microphone and listens for **Kora** or **كورا**.
2. It says **Hi Mulk Allah!** and opens a session.
3. Each spoken question is answered out loud. You do not say the wake word again.
4. **Mute** or **Stop** (or **stop jarvis**, **goodbye**, **توقف**) returns to waiting for the wake word.
5. Arabic, English, or a mix in one sentence. With an ElevenLabs key, each utterance goes to Scribe and the language is detected per phrase. The **العربية / English** buttons only set the browser recognizer, which is the fallback when Scribe is unavailable. You can also type.

Set the Vercel project to **Next.js** with the root directory `.` (this is already in `vercel.json`). Build command: `npm run build`.

Environment variables for the web app:

| Variable | Required | Role |
| --- | --- | --- |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | yes, to answer | Same key as the CLI. Without it, the wake greeting still works. |
| `GEMINI_MODEL` | no | Default `gemini-2.5-flash`. Production uses `gemini-3.6-flash`. |
| `GEMINI_FALLBACK_MODELS` | no | Comma-separated models tried after `GEMINI_MODEL` on 404 or 5xx. The voice path skips lite models. Quota and rate limits are spoken back instead of switching models. Default list is `gemini-3.1-flash-lite,gemini-3.5-flash-lite`. |
| `TTS_PROVIDER` | no | `browser`, `gemini`, or `elevenlabs`. The CLI value `edge` cannot run here. An ElevenLabs key is tried first; this chooses the fallback. |
| `GEMINI_TTS_MODEL` | no | Default `gemini-2.5-flash-preview-tts`. |
| `GEMINI_TTS_VOICE` | no | Default `Charon`. |
| `ELEVENLABS_API_KEY` | no | When set, `/api/tts` speaks with ElevenLabs first, and `/api/stt` transcribes with Scribe v2. Scribe is billed by audio duration. | 
| `ELEVENLABS_VOICE_ID` | no | Defaults to `ER6QMHaBjLyek2P4dKLO`. A missing voice falls back to `rPNcQ53R703tTmtue1AT`. |
| `ELEVENLABS_MODEL` | no | Defaults to `eleven_flash_v2_5`. `ELEVENLABS_MODEL_ID` is still accepted. |
| `X_API_KEY` | no | OAuth 1.0a consumer key. With the three tokens below, `POST /api/x/tweet` publishes directly. |
| `X_API_SECRET` | no | OAuth 1.0a consumer secret. |
| `X_ACCESS_TOKEN` | no | User access token. It must include Read and Write, or X answers 401 or 403. |
| `X_ACCESS_TOKEN_SECRET` | no | User access token secret. If any of the four is missing, KORA opens the compose page. A 401 or 403 also opens compose and asks for a new Access Token with Read and Write. |

If ElevenLabs is missing or returns an error, speech uses Gemini TTS when that key is set, then the browser voice.

The public URL spends the Gemini quota of whoever holds the key. Do not share the deployment if the key is unrestricted.

Local web check:

```bash
npm install
npm run build
npm run dev
```

`npm test` checks the wake and stop phrases against the same cases as the Python tests.

## العربية

مساعد صوتي لملك الله السعدي. يبدأ بالاستماع فوراً. قل **Kora** أو **كورا**، فيرد: **Hi Mulk Allah!** ثم أجب عن كل سؤال بالصوت دون إعادة كلمة التنبيه.

على **Vercel** الصفحة نفسها في المتصفح (Chrome أو Edge): الميكروفون في المتصفح، والإجابة من Gemini. المفتاح `GEMINI_API_KEY` أو `GOOGLE_API_KEY`. النطق من Gemini TTS أو ElevenLabs إن وُجد المفتاح، وإلا صوت المتصفح. **Mute** أو **Stop** أو **توقف** يرجع إلى انتظار كلمة التنبيه. التفاصيل في [Web on Vercel](#web-on-vercel).

التعرّف على الكلام محلي (Whisper). الإجابات من Gemini. النطق الافتراضي edge-tts، ويمكن لاحقاً ElevenLabs من ملف البيئة.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

ضع المفتاح في `.env`:

```bash
GEMINI_API_KEY=your-key
```

ثم:

```bash
python -m jarvis
```

- قل **كورا** للبدء.
- اسأل بالعربية أو بالإنجليزية. الجواب جملة أو جملتان، ثم يستمع مباشرة.
- للرجوع إلى الانتظار: **stop jarvis** أو **توقف** أو **خلاص** أو Ctrl+C.
- Ctrl+C أثناء الانتظار يغلق البرنامج.
- بلا ميكروفون: `python -m jarvis --text`
- أول تشغيل ينزّل نموذج Whisper.

**Linux:** `sudo apt install libportaudio2` ثم `python -m jarvis --list-devices` إذا لم يُلتقط الصوت.  
**macOS:** اسمح للطرف الطرفي بالميكروفون من إعدادات الخصوصية.  
**Windows:** اسمح لتطبيقات سطح المكتب بالميكروفون، ثم حدّد `INPUT_DEVICE` عند الحاجة.

لتجربة أدق للعربية: `WHISPER_MODEL=small` في `.env`.
