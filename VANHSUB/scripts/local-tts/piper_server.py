"""Loopback-only OpenAI speech endpoint for an independently installed Piper runtime.

Piper is GPL-3.0; voice attribution and model files remain in the runtime directory.
No models or third-party binaries are bundled with VANHSUB.
"""
import argparse
import json
import math
import os
from pathlib import Path
import select
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VOICE = "vi_VN-vais1000-medium"


def worker(model, output):
    from piper import PiperVoice, SynthesisConfig
    from piper.config import PiperConfig
    import onnxruntime
    request = json.load(sys.stdin)
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    with open(str(model) + '.json', encoding='utf-8') as config:
        voice = PiperVoice(config=PiperConfig.from_dict(json.load(config)),
                           session=onnxruntime.InferenceSession(str(model), sess_options=options,
                                                               providers=['CPUExecutionProvider']))
    with wave.open(output, "wb") as audio:
        voice.synthesize_wav(request["input"], audio, syn_config=SynthesisConfig(length_scale=1 / request["speed"]))


def serve(args):
    runtime = Path(args.runtime).resolve()
    jobs = runtime / "jobs"
    jobs.mkdir(parents=True, exist_ok=True)
    model = runtime / "models" / (VOICE + ".onnx")
    if not model.is_file() or not Path(args.ffmpeg).is_file():
        raise RuntimeError("Missing installed model or FFmpeg")
    gate = threading.Lock()
    stats = {"started": 0, "completed": 0, "cancelled": 0, "failed": 0, "active": 0}

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def log_message(self, *_):
            pass  # Do not log narration, paths, headers or account data.

        def send_data(self, status, value, mime="application/json"):
            data = json.dumps(value).encode() if mime == "application/json" else value
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def allowed(self):
            # Reject browser-origin requests, DNS rebinding and non-loopback clients.
            return (self.client_address[0] == "127.0.0.1" and
                    self.headers.get("Host", "").split(":")[0] in ("127.0.0.1", "localhost") and
                    not self.headers.get("Origin"))

        def do_GET(self):
            if not self.allowed():
                return self.send_data(403, {"error": "LOCAL_CLIENT_REQUIRED"})
            if self.path in ("/voices", "/v1/voices"):
                return self.send_data(200, [VOICE])
            if self.path == "/health":
                return self.send_data(200, {"engine": "piper", "voice": VOICE, "cpuOnly": True, **stats})
            self.send_data(404, {"error": "NOT_FOUND"})

        def do_POST(self):
            if not self.allowed():
                return self.send_data(403, {"error": "LOCAL_CLIENT_REQUIRED"})
            if self.path != "/v1/audio/speech":
                return self.send_data(404, {"error": "NOT_FOUND"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 65536:
                    raise ValueError()
                request = json.loads(self.rfile.read(length))
                text, speed = request.get("input"), float(request.get("speed", 1))
                fmt = request.get("response_format", "mp3")
                if (not isinstance(text, str) or not text.strip() or len(text) > 6000 or
                        request.get("voice") != VOICE or not math.isfinite(speed) or not 0.5 <= speed <= 2 or fmt not in ("mp3", "wav")):
                    raise ValueError()
            except (ValueError, TypeError, AttributeError):
                return self.send_data(400, {"error": "INVALID_SPEECH_REQUEST"})
            if not gate.acquire(blocking=False):
                return self.send_data(429, {"error": "LOCAL_ENGINE_BUSY"})
            stats["started"] += 1
            stats["active"] = 1
            job = Path(tempfile.mkdtemp(prefix="piper-job-", dir=jobs)).resolve()
            proc = None
            try:
                output = job / "speech.wav"
                env = {**os.environ, "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2"}
                proc = subprocess.Popen([sys.executable, __file__, "--worker", str(model), str(output)],
                                        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                        env=env, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                proc.stdin.write(json.dumps({"input": text, "speed": speed}).encode())
                proc.stdin.close()
                deadline = time.monotonic() + 90
                while proc.poll() is None:
                    if time.monotonic() > deadline:
                        raise TimeoutError()
                    if select.select([self.connection], [], [], 0)[0] and self.connection.recv(1, 2) == b"":
                        stats["cancelled"] += 1
                        return
                    time.sleep(0.05)
                if proc.returncode != 0 or not output.is_file():
                    raise RuntimeError()
                if fmt == "mp3":
                    encoded = job / "speech.mp3"
                    subprocess.run([args.ffmpeg, "-v", "error", "-i", str(output), "-codec:a", "libmp3lame", "-b:a", "96k", str(encoded)],
                                   check=True, timeout=15, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                    output = encoded
                self.send_data(200, output.read_bytes(), "audio/mpeg" if fmt == "mp3" else "audio/wav")
                stats["completed"] += 1
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                stats["cancelled"] += 1
            except Exception:
                stats["failed"] += 1
                try:
                    self.send_data(503, {"error": "LOCAL_SYNTHESIS_FAILED"})
                except OSError:
                    pass
            finally:
                if proc is not None and proc.poll() is None:
                    proc.kill()
                if proc is not None:
                    proc.wait(timeout=5)
                # Only this request's freshly allocated directory may be removed.
                if job.parent == jobs.resolve() and job.name.startswith("piper-job-"):
                    shutil.rmtree(job)
                stats["active"] = 0
                gate.release()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    server.serve_forever()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--worker":
        worker(sys.argv[2], sys.argv[3])
    else:
        parser = argparse.ArgumentParser()
        parser.add_argument("--runtime", required=True)
        parser.add_argument("--ffmpeg", required=True)
        parser.add_argument("--port", type=int, default=6006)
        serve(parser.parse_args())
