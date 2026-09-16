#!/usr/bin/env bash
# 实时通话 + 朗读端到端回归：假麦克风 → 电话键 → withVoice（Nova-3 识别 → 同一颗脑子 → CosyVoice2 朗读）→ 挂断 → 通话并回聊天线程 → 点「朗读」。
# 前置：本地 dev 已在 127.0.0.1:5173 运行（AI 绑定 remote，.dev.vars 里 OPENAI_BASE_URL 指向 SiliconFlow），macOS（用 say 合成普通话样本）。
# 用法：bash tests/browser/call-flow.sh
#
# 样本前后各垫静音：前 1.5 s 让识别会话就绪，后 6 s 让客户端 VAD 判定说完；%noloop 只放一遍，之后就是静音。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/output/playwright"; mkdir -p "$OUT"
PWCLI="${PWCLI:-$HOME/.claude/skills/playwright/scripts/playwright_cli.sh}"
pw() { bash "$PWCLI" "$@"; }
export PLAYWRIGHT_CLI_SESSION=lotus-call
ORIGIN="${ORIGIN:-http://127.0.0.1:5173}"
TEXT="${TEXT:-今天念佛五百声，心里很平静。}"

curl -sf "$ORIGIN/health" >/dev/null || { echo "dev 未运行：$ORIGIN"; exit 1; }

say -v Tingting -o "$OUT/call-sample.aiff" "$TEXT"
afconvert -f WAVE -d LEI16@48000 -c 2 "$OUT/call-sample.aiff" "$OUT/call-sample-raw.wav"
python3 - "$OUT/call-sample-raw.wav" "$OUT/call-sample.wav" <<'PY'
import struct, sys
b = open(sys.argv[1], "rb").read(); pos = 12; fmt = data = None
while pos + 8 <= len(b):
    cid = b[pos:pos+4]; size = struct.unpack("<I", b[pos+4:pos+8])[0]; body = b[pos+8:pos+8+size]
    if cid == b"fmt ": fmt = body[:16]
    elif cid == b"data": data = body
    pos += 8 + size + (size & 1)
lead = bytes(48000 * 2 * 2 * 3 // 2); tail = bytes(48000 * 2 * 2 * 6)
data = lead + data + tail
open(sys.argv[2], "wb").write(b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<I", 16) + fmt + b"data" + struct.pack("<I", len(data)) + data)
PY

cat > "$OUT/call-mic.config.json" <<EOF
{ "browser": { "launchOptions": { "args": [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--use-file-for-fake-audio-capture=$OUT/call-sample.wav%noloop",
  "--autoplay-policy=no-user-gesture-required",
  "--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox"
] } } }
EOF
pw close >/dev/null 2>&1 || true
pw open "$ORIGIN/#chat" --config "$OUT/call-mic.config.json" >/dev/null
sleep 5
num() { grep -oE '^[0-9]+$' | head -1; }
tags_before="$(pw eval "() => document.querySelectorAll('.voice-call-tag').length" 2>&1 | num)"; tags_before="${tags_before:-0}"
pending() { pw eval "() => fetch('/api/proposals', { credentials: 'include' }).then(r => r.json()).then(d => d.proposals.filter(p => p.status === 'pending').length)" 2>&1 | num; }
pending_before="$(pending)"; pending_before="${pending_before:-0}"
echo "通话前：通话标记 $tags_before 条，待确认提案 $pending_before 条"

# 记录通话状态变化，事后判断是否真的到过 listening → thinking → speaking
pw eval "() => { window.__st = []; new MutationObserver(ms => ms.forEach(m => { const s = m.target.getAttribute('data-status'); if (s && window.__st.at(-1) !== s) window.__st.push(s); })).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-status'] }); return 1 }" >/dev/null 2>&1

snap="$(pw snapshot 2>&1)"
ref="$(grep -E '"和小莲通话"' <<<"$snap" | grep -oE 'ref=[a-z0-9]+' | head -1 | cut -d= -f2)"
[ -n "$ref" ] || { echo "找不到「和小莲通话」按钮（capabilities.voice/speech 为 false？）"; exit 1; }
pw click "$ref" >/dev/null
sleep 3
pw snapshot 2>&1 | grep -q "和小莲通话" && echo "✓ 通话页打开"

# 等识别结果与小莲的回答（假麦克风在 getUserMedia 时开始播放样本）
for i in $(seq 1 18); do
  sleep 5
  user="$(pw eval "() => document.querySelectorAll('.voice-line-user:not(.is-interim)').length" 2>&1 | num)"
  bot="$(pw eval "() => document.querySelectorAll('.voice-line-assistant').length" 2>&1 | num)"
  [ "${user:-0}" -gt 0 ] && [ "${bot:-0}" -gt 0 ] && break
done
[ "${user:-0}" -gt 0 ] || { echo "✗ 90 s 内没有识别出用户的话"; pw snapshot 2>&1 | grep -E "status|错误|error" | head -5; pw screenshot >/dev/null 2>&1; exit 1; }
pw eval "() => [...document.querySelectorAll('.voice-line')].map(l => (l.classList.contains('voice-line-user') ? '我：' : '小莲：') + l.textContent.trim()).join(' | ')" 2>&1 | grep -E '^"' | sed 's/^"//; s/"$//' | sed 's/^/✓ 通话内容：/'
[ "${bot:-0}" -gt 0 ] || echo "✗ 小莲没有回答"
# 让朗读放完再挂
sleep 8
pw eval "() => (window.__st || []).join(' → ')" 2>&1 | grep -E '^"' | sed 's/^"//; s/"$//' | sed 's/^/✓ 状态序列：/'

snap="$(pw snapshot 2>&1)"
hang="$(grep -E '"挂断"' <<<"$snap" | grep -oE 'ref=[a-z0-9]+' | head -1 | cut -d= -f2)"
[ -n "$hang" ] && pw click "$hang" >/dev/null
sleep 4
tags_after="$(pw eval "() => document.querySelectorAll('.voice-call-tag').length" 2>&1 | num)"
if [ "${tags_after:-0}" -ge $((tags_before + 2)) ]; then echo "✓ 通话并回聊天线程（通话标记 $tags_before → $tags_after）"; else echo "✗ 聊天线程里没有出现通话记录（$tags_before → ${tags_after:-0}）"; fi
pending_after="$(pending)"; pending_after="${pending_after:-0}"
if [ "$pending_after" -gt "$pending_before" ]; then echo "✓ 通话里的写入变成了待确认提案（$pending_before → $pending_after），没有直接落库"; else echo "· 待确认提案数未变（$pending_before → $pending_after）——这句话没有触发记录工具时属正常"; fi
pw eval "() => [...document.querySelectorAll('span, small, div')].filter(e => e.childElementCount === 0 && e.textContent.trim() === '等待你确认').length" 2>&1 | num | sed 's/^/  对话里「等待你确认」的卡片数：/'

# 朗读最后一条小莲的消息
snap="$(pw snapshot 2>&1)"
read_ref="$(grep -E '"朗读这段话"' <<<"$snap" | grep -oE 'ref=[a-z0-9]+' | tail -1 | cut -d= -f2)"
if [ -n "$read_ref" ]; then
  pw click "$read_ref" >/dev/null
  for i in $(seq 1 6); do sleep 3; pw snapshot 2>&1 | grep -q "朗读中" && { echo "✓ 朗读已开始（按钮显示「朗读中…」）"; break; }; done
  for i in $(seq 1 10); do sleep 3; pw snapshot 2>&1 | grep -q "朗读中" || { echo "✓ 朗读播放到结尾，按钮复位"; break; }; done
else
  echo "✗ 没找到「朗读」按钮"
fi
pw screenshot >/dev/null 2>&1
echo "截图：$(ls -t "$ROOT/.playwright-cli"/*.png | head -1)"
