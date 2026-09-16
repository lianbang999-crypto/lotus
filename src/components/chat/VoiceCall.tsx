import { useEffect, useMemo, useRef } from "react";
import { useVoiceAgent } from "agents/voice/react";
import { MicrophoneIcon, MicrophoneSlashIcon, PhoneDisconnectIcon } from "@phosphor-icons/react";
import { Dialog } from "../ui/dialog";
import { LotusMark } from "../LotusMark";
import { LotusVoiceTransport } from "./voiceTransport";

const statusText: Record<string, string> = {
  idle: "正在接通…",
  listening: "我在听，说完停一下就好",
  thinking: "小莲在想…",
  speaking: "小莲在说",
};

/**
 * 实时通话：用户主动发起、随时挂断，小莲不主动呼叫。
 * 通话里要记的功课、笔记只会生成待确认的记录放进对话，挂断后回到对话里点确认才保存——每一笔写入仍由用户确认。
 */
export function VoiceCall({ open, onClose }: { open: boolean; onClose: () => void }) {
  const transport = useMemo(() => new LotusVoiceTransport(), []);
  const { status, transcript, interimTranscript, audioLevel, isMuted, connected, error, startCall, endCall, toggleMute } =
    useVoiceAgent({ agent: "LotusAgent", transport, enabled: open, silenceDurationMs: 700 });
  const started = useRef(false);
  useEffect(() => {
    if (open && connected && !started.current) {
      started.current = true;
      void startCall();
    }
    if (!open) started.current = false;
  }, [open, connected, startCall]);
  function hangUp() {
    endCall();
    onClose();
  }
  const recent = transcript.slice(-4);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && hangUp()} title="和小莲通话" description="说完停一下，小莲就会回答；随时可以挂断。">
      <div className="voice-call" data-status={status}>
        <div className="voice-call-mark" style={{ ["--level" as string]: Math.min(1, audioLevel * 6) }}>
          <LotusMark size={64} />
        </div>
        <p className="voice-call-status" role="status">
          {error ? error : (statusText[status] ?? status)}
        </p>
        <div className="voice-call-transcript" aria-live="polite">
          {recent.map((line, i) => (
            <p key={`${line.timestamp}-${i}`} className={`voice-line voice-line-${line.role}`}>
              {line.text}
            </p>
          ))}
          {interimTranscript && <p className="voice-line voice-line-user is-interim">{interimTranscript}</p>}
        </div>
        <div className="voice-call-actions">
          <button type="button" className="voice-call-button" onClick={toggleMute} aria-pressed={isMuted} aria-label={isMuted ? "取消静音" : "静音"}>
            {isMuted ? <MicrophoneSlashIcon size={22} /> : <MicrophoneIcon size={22} />}
          </button>
          <button type="button" className="voice-call-button is-hangup" onClick={hangUp} aria-label="挂断">
            <PhoneDisconnectIcon size={22} weight="fill" />
          </button>
        </div>
        <p className="field-hint">通话里要记的功课、笔记会放到对话里，挂断后点一下确认才会保存。</p>
      </div>
    </Dialog>
  );
}
