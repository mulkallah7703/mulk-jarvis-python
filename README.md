# Mulk Jarvis

Voice assistant for **Mulk Allah Alsadi**. It listens from the moment it starts. Say **mulk** (or **ملك** / **Mulk Allah**) and it answers out loud, then keeps listening for the next question. No button, and no wake word between questions.

Speech-to-text stays on this machine (faster-whisper). Answers come from Gemini. Speech out is edge-tts, with an ElevenLabs switch when you want it.

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
2. Say **mulk**. It says **Hi Mulk Allah!** and opens a session.
3. Ask in Arabic or English. It answers in one or two sentences, then listens again.
4. Say **stop jarvis**, **goodbye**, or **توقف**. It goes back to waiting.
5. Ctrl+C during a session also goes back to waiting. Ctrl+C while it is waiting quits.

A command in the same breath as the wake word is answered immediately: `mulk what time is it`.

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

## العربية

مساعد صوتي لملك الله السعدي. يبدأ بالاستماع فوراً. قل **mulk** أو **ملك** أو **ملك الله**، فيرد: **Hi Mulk Allah!** ثم أجب عن كل سؤال بالصوت دون إعادة كلمة التنبيه.

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

- قل **ملك** للبدء.
- اسأل بالعربية أو بالإنجليزية. الجواب جملة أو جملتان، ثم يستمع مباشرة.
- للرجوع إلى الانتظار: **stop jarvis** أو **توقف** أو **خلاص** أو Ctrl+C.
- Ctrl+C أثناء الانتظار يغلق البرنامج.
- بلا ميكروفون: `python -m jarvis --text`
- أول تشغيل ينزّل نموذج Whisper.

**Linux:** `sudo apt install libportaudio2` ثم `python -m jarvis --list-devices` إذا لم يُلتقط الصوت.  
**macOS:** اسمح للطرف الطرفي بالميكروفون من إعدادات الخصوصية.  
**Windows:** اسمح لتطبيقات سطح المكتب بالميكروفون، ثم حدّد `INPUT_DEVICE` عند الحاجة.

لتجربة أدق للعربية: `WHISPER_MODEL=small` في `.env`.
