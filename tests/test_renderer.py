import base64
import json
import os
import subprocess
import tempfile
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORT = "8765"

def main():
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        audio = tmp_path / "tone.mp3"
        image = tmp_path / "scene.jpg"
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi", "-i",
            "sine=frequency=440:duration=2", "-q:a", "9", str(audio)
        ], check=True, capture_output=True)
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi", "-i",
            "color=c=navy:s=640x960:d=1", "-frames:v", "1", str(image)
        ], check=True, capture_output=True)

        env = os.environ.copy()
        env["PORT"] = PORT
        server = subprocess.Popen(
            ["python", str(ROOT / "renderer" / "app.py")],
            cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        try:
            health_url = f"http://127.0.0.1:{PORT}/health"
            for _ in range(40):
                if server.poll() is not None:
                    raise RuntimeError("Renderer process exited before becoming healthy.")
                try:
                    with urllib.request.urlopen(health_url, timeout=1) as response:
                        if response.status == 200:
                            break
                except Exception:
                    time.sleep(0.25)
            else:
                raise RuntimeError("Renderer did not become healthy.")

            payload = {
                "title": "Auto AI renderer test",
                "scenes": [{"visual": "Test scene", "text": "Renderer test"}],
                "scene_images": [base64.b64encode(image.read_bytes()).decode("ascii")],
                "audio_base64": base64.b64encode(audio.read_bytes()).decode("ascii")
            }
            request = urllib.request.Request(
                f"http://127.0.0.1:{PORT}/render",
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            try:
                with urllib.request.urlopen(request, timeout=90) as response:
                    video = response.read()
                    if response.status != 200:
                        raise RuntimeError(f"Renderer returned HTTP {response.status}.")
            except urllib.error.HTTPError as error:
                detail = error.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"Renderer returned HTTP {error.code}: {detail[:1200]}") from error

            video_path = tmp_path / "rendered.mp4"
            video_path.write_bytes(video)
            if len(video) < 1000:
                raise RuntimeError("Rendered MP4 was unexpectedly small.")
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=format_name,duration",
                 "-of", "json", str(video_path)],
                check=True, capture_output=True, text=True
            )
            metadata = json.loads(probe.stdout).get("format", {})
            if "mp4" not in metadata.get("format_name", "") or float(metadata.get("duration", 0)) <= 0:
                raise RuntimeError("FFprobe could not verify a valid MP4 with a positive duration.")
            print(f"Renderer integration test passed ({len(video)} bytes, {metadata['duration']} seconds).")
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()

if __name__ == "__main__":
    main()
