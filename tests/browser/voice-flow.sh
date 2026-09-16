#!/usr/bin/env bash
# 语音条端到端回归：假麦克风 → 按住说话 → 客户端转 WAV → /api/voice/transcribe（真 Whisper）→ 语音气泡 → 回放。
# 前置：本地 dev 已在 127.0.0.1:5173 运行（npm run dev，AI 绑定 remote），macOS（用 say 合成普通话样本）。
# 用法：bash tests/browser/voice-flow.sh
#
# 踩过的坑（2026-09-16）：macOS 上 Chromium 的音频服务是沙箱化独立进程，读不到 --use-file-for-fake-audio-capture
# 指定的文件，录到的是纯静音；必须加 --disable-features=AudioServiceOutOfProcess,AudioServiceSandbox。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/output/playwright"; mkdir -p "$OUT"
PWCLI="${PWCLI:-$HOME/.claude/skills/playwright/scripts/playwright_cli.sh}"
pw() { bash "$PWCLI" "$@"; }
export PLAYWRIGHT_CLI_SESSION=lotus-voice
ORIGIN="${ORIGIN:-http://127.0.0.1:5173}"
TEXT="${TEXT:-今天念佛五百声，心里很平静。}"

curl -sf "$ORIGIN/health" >/dev/null || { echo "dev 未运行：$ORIGIN"; exit 1; }

# 1. 合成样本：48 kHz 立体声、标准 44 字节头（Chrome 假设备只认 PCM WAV）
say -v Tingting -o "$OUT/voice-sample.aiff" "$TEXT"
afconvert -f WAVE -d LEI16@48000 -c 2 "$OUT/voice-sample.aiff" "$OUT/voice-sample-raw.wav"
python3 - "$OUT/voice-sample-raw.wav" "$OUT/voice-sample.wav" <<'PY'
import struct, sys
b = open(sys.argv[1], "rb").read(); pos = 12; fmt = data = None
while pos + 8 <= len(b):
    cid = b[pos:pos+4]; size = struct.unpack("<I", b[pos+4:pos+8])[0]; body = b[pos+8:pos+8+size]
    if cid == b"fmt ": fmt = body[:16]
    elif cid == b"data": data = body
    pos += 8 + size + (size & 1)
open(sys.argv[2], "wb").write(b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<I", 16) + fmt + b"data" + struct.pack("<I", len(data)) + data)
PY

# 2. 带假麦克风的 Chromium
cat > "$OUT/voice-mic.config.json" <<EOF
{ "browser": { "launchOptions": { "args": [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--use-file-for-fake-audio-capture=$OUT/voice-sample.wav%noloop",
  "--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox"
] } } }
EOF
pw close >/dev/null 2>&1 || true
pw open "$ORIGIN/#chat" --config "$OUT/voice-mic.config.json" >/dev/null
sleep 5

# 3. 按住说话（每条 pw 命令有约 2 s 启动开销，实际录到约 5 s）
snap="$(pw snapshot 2>&1)"
ref="$(grep -oE '"按住说话" \[ref=e[0-9]+\]' <<<"$snap" | grep -oE 'e[0-9]+' | head -1)"
[ -n "$ref" ] || { echo "找不到「按住说话」按钮（capabilities.voice 为 false？）"; exit 1; }
pw hover "$ref" >/dev/null; pw mousedown >/dev/null; sleep 2; pw mouseup >/dev/null
sleep 3
pw snapshot 2>&1 | grep -q "正在把这段话转成文字" && echo "✓ 录音结束，进入转写"

# 4. 等转写与回复
for i in $(seq 1 12); do sleep 5; snap="$(pw snapshot 2>&1)"; grep -q "播放语音" <<<"$snap" && break; done
grep -q "播放语音" <<<"$snap" || { echo "✗ 60 s 内没有出现语音气泡"; grep -E "alert|error" <<<"$snap" || true; exit 1; }
echo "✓ 语音气泡：$(grep -oE 'time \[ref=e[0-9]+\]: [0-9:]+' <<<"$snap" | head -1)"
echo "✓ 转写：$(grep -oE 'paragraph \[ref=e[0-9]+\]: [^\n]*' <<<"$snap" | head -1 | sed 's/.*\]: //')"

# 5. 回放到结尾
ref="$(grep -oE '"播放语音" \[ref=e[0-9]+\]' <<<"$snap" | grep -oE 'e[0-9]+' | head -1)"
pw click "$ref" >/dev/null; sleep 7
pw eval "() => { const a = document.querySelector('.voice-clip audio'); return a && !a.error && a.currentTime > 3 ? 'ok' : JSON.stringify({ t: a && a.currentTime, err: a && a.error && a.error.code }) }" 2>&1 | grep -q '"ok"' && echo "✓ 回放正常" || echo "✗ 回放异常"
pw screenshot >/dev/null 2>&1
echo "截图：$(ls -t "$ROOT/.playwright-cli"/*.png | head -1)"
