#!/usr/bin/env bash
# 语音条端到端回归：假麦克风 → 按住说话 → 客户端转 WAV → /api/voice/transcribe（真 Whisper）→ 语音气泡 → 回放。
# 前置：本地 dev 已在 127.0.0.1:5173 运行（npm run dev，AI 绑定 remote），macOS（用 say 合成普通话样本）。
# 用法：bash tests/browser/voice-flow.sh
#
# 踩过的坑（2026-09-16）：
# - macOS 上 Chromium 的音频服务是沙箱化独立进程，读不到 --use-file-for-fake-audio-capture 指定的文件，
#   录到的是纯静音；必须加 --disable-features=AudioServiceOutOfProcess,AudioServiceSandbox。
# - 页面里可能已有历史语音条。判据必须是"语音条数量 +1"，转写与回放都取最后一条，否则会拿旧记录冒充新结果。
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
count() { pw eval "() => document.querySelectorAll('.voice-clip').length" 2>&1 | grep -oE '^[0-9]+$' | head -1; }
before="$(count)"; before="${before:-0}"; echo "录前语音条数：$before"

# 3. 按住说话（每条 pw 命令有约 2 s 启动开销，实际录到约 5 s）
snap="$(pw snapshot 2>&1)"
ref="$(grep -E '"按住说话"' <<<"$snap" | grep -oE 'ref=[a-z0-9]+' | head -1 | cut -d= -f2)"
[ -n "$ref" ] || { echo "找不到「按住说话」按钮（capabilities.voice 为 false？）"; exit 1; }
pw hover "$ref" >/dev/null; pw mousedown >/dev/null; sleep 2; pw mouseup >/dev/null
sleep 3
pw snapshot 2>&1 | grep -q "正在把这段话转成文字" && echo "✓ 录音结束，进入转写"

# 4. 等新语音条出现（数量 +1）
for i in $(seq 1 12); do sleep 5; now="$(count)"; [ "${now:-0}" -gt "$before" ] && break; done
[ "${now:-0}" -gt "$before" ] || { echo "✗ 60 s 内语音条数量没有增加（仍为 ${now:-0}）"; pw snapshot 2>&1 | grep -E "alert|error" || true; exit 1; }
echo "✓ 新语音条出现（$before → $now）"
pw eval "() => { const c = [...document.querySelectorAll('.voice-clip')].at(-1); const t = c.nextElementSibling; return '时长 ' + c.querySelector('time').textContent + ' · 转写「' + (t ? t.textContent.trim() : '') + '」' }" 2>&1 | grep -E '^"' | sed 's/^"//; s/"$//' | sed 's/^/✓ /'

# 5. 回放最后一条到结尾
pw eval "() => { const c = [...document.querySelectorAll('.voice-clip')].at(-1); c.querySelector('button').click(); return 1 }" >/dev/null 2>&1; sleep 7
pw eval "() => { const a = [...document.querySelectorAll('.voice-clip audio')].at(-1); return a && !a.error && a.currentTime > 3 ? 'ok' : JSON.stringify({ t: a && a.currentTime, err: a && a.error && a.error.code }) }" 2>&1 | grep -q '"ok"' && echo "✓ 最后一条回放正常" || echo "✗ 回放异常"
pw screenshot >/dev/null 2>&1
echo "截图：$(ls -t "$ROOT/.playwright-cli"/*.png | head -1)"
