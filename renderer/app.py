import base64, json, os, re, subprocess, tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_BODY = 14 * 1024 * 1024
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def clean_text(value, limit=300):
    value = re.sub(r"[\r\n\t]+", " ", str(value or ""))
    return value[:limit].strip()

def srt_time(seconds):
    ms = max(0, int(seconds * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, b'{"ok":true}', "application/json")
        self.reply(404, b'not found', "text/plain")

    def do_POST(self):
        if self.path != "/render":
            return self.reply(404, b'not found', "text/plain")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                return self.reply(413, b'{"error":"Render request must be under 14 MB."}', "application/json")
            payload = json.loads(self.rfile.read(length))
            scenes = payload.get("scenes") or []
            audio = base64.b64decode(payload.get("audio_base64", ""), validate=True)
            if not audio or len(audio) > 10 * 1024 * 1024:
                return self.reply(400, b'{"error":"A valid voiceover MP3 under 10 MB is required."}', "application/json")
            scenes = [clean_text(x, 260).replace("-->", "—>") for x in scenes if clean_text(x, 260)]
            if not scenes:
                scenes = [clean_text(payload.get("title", "Auto AI video"), 100)]
            scenes = scenes[:20]
            title = clean_text(payload.get("title", "Auto AI"), 100)
            with tempfile.TemporaryDirectory() as tmp:
                audio_path = Path(tmp) / "voice.mp3"
                srt_path = Path(tmp) / "captions.srt"
                title_path = Path(tmp) / "title.txt"
                out_path = Path(tmp) / "render.mp4"
                audio_path.write_bytes(audio)
                title_path.write_text(title.replace("'", "’"), encoding="utf-8")
                probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(audio_path)], capture_output=True, text=True, timeout=20)
                duration = float(probe.stdout.strip())
                if duration <= 0 or duration > 180:
                    return self.reply(400, b'{"error":"Voiceover duration must be between 1 and 180 seconds."}', "application/json")
                weights = [max(1, len(x.split())) for x in scenes]
                total = sum(weights)
                cursor = 0.0
                entries = []
                for i, (scene, weight) in enumerate(zip(scenes, weights), 1):
                    start = cursor
                    cursor += duration * weight / total
                    end = min(duration, cursor)
                    entries.append(f"{i}\n{srt_time(start)} --> {srt_time(end)}\n{scene}\n")
                srt_path.write_text("\n".join(entries), encoding="utf-8")
                vf = f"drawtext=fontfile={FONT}:textfile={title_path}:fontcolor=0x9DB6FF:fontsize=44:x=(w-text_w)/2:y=110,subtitles={srt_path}:force_style='FontName=DejaVu Sans,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=250'"
                cmd = ["ffmpeg","-y","-f","lavfi","-i",f"color=c=0x101A30:s=1080x1920:r=30:d={duration:.3f}","-i",str(audio_path),"-vf",vf,"-c:v","libx264","-preset","veryfast","-tune","stillimage","-pix_fmt","yuv420p","-c:a","aac","-b:a","160k","-shortest","-movflags","+faststart",str(out_path)]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
                if result.returncode != 0:
                    raise RuntimeError((result.stderr or "FFmpeg render failed")[-1600:])
                video = out_path.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(len(video)))
                self.send_header("Content-Disposition", 'attachment; filename="auto-ai-render.mp4"')
                self.end_headers()
                self.wfile.write(video)
        except subprocess.TimeoutExpired:
            self.reply(504, b'{"error":"Video rendering timed out. Try a shorter script."}', "application/json")
        except Exception as exc:
            data = json.dumps({"error": str(exc)[:1800]}).encode()
            self.reply(500, data, "application/json")

    def reply(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
