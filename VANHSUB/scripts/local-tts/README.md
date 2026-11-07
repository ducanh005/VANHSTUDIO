# Local Piper TTS for Windows

Standalone, CPU-only OpenAI-compatible speech service for VANHSUB's existing local TTS endpoint. It does not replace Google Flow, Edge or cloud credentials. No chargeable API is called.

Requires Python 3.12 x64. Create a dedicated virtual environment, then install `requirements-windows-piper.lock` using `pip install --only-binary=:all: --require-hashes -r ...`. Do not install into VANHSUB's shared Node dependencies or system Python.

Before download, check disk/RAM. The `vi_VN-vais1000-medium` model is 63,201,294 bytes; allow 600 MiB for model/runtime and keep at least 2 GiB free. Model revision `c10ece1aade47bb51c153c893d14e5bf8e5b7117` in [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices/tree/c10ece1aade47bb51c153c893d14e5bf8e5b7117/vi/vi_VN/vais1000/medium). Copy the `.onnx`, `.onnx.json` and `MODEL_CARD` into `<runtime>/models`.

Expected ONNX SHA256: `ec7c89e2c85f4d1edc24b6120c18aaf1bda614f06b511567eb9c7c0de15e2dab`.

Run the venv Python with `piper_server.py --runtime <runtime> --ffmpeg <absolute-ffmpeg.exe> --port 6006`. It binds only `127.0.0.1`, rejects Origin/DNS rebinding, permits one inference job at a time, bounds requests, and terminates only its own worker on disconnect/timeout. No narration is logged. Child model sessions are released after each request. ONNX uses CPU; no CUDA allocation is requested.

Set VANHSUB local TTS endpoint to `http://127.0.0.1:6006`, select `Local TTS` and voice `vi_VN-vais1000-medium`. `GET /health` exposes engine/job counters; `GET /v1/voices` returns the installed voice; `POST /v1/audio/speech` accepts standard input/voice/speed/response_format (MP3/WAV). It does not claim to implement every OpenAI API feature.

The engine is [Piper, GPL-3.0](https://github.com/OHF-Voice/piper1-gpl); model card attributes the [VAIS-1000 corpus under CC BY 4.0](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/vi/vi_VN/vais1000/medium/MODEL_CARD), trained by Piper contributors and fine-tuned from Lessac. Preserve the model card/attribution in the runtime. Engine/model are separately installed and not bundled into the application installer by these changes. Public redistribution needs a separate license/package review.
