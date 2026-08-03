import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, UsersRound, X } from "lucide-react";
import { OnlineRoomClient } from "../services/onlineRoom";

export function OnlineRoomModal({ onlineName, onClose, onConnectedChange, onRoomClient, onRoomUi, getRoomState, compact = false, keepAlive = false }) {
  const clientRef = useRef(null);
  const [roomId, setRoomId] = useState("");
  const [participants, setParticipants] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [joinMode, setJoinMode] = useState(false);

  useEffect(() => () => { if (!keepAlive) clientRef.current?.disconnect(); }, [keepAlive]);
  const connect = async (host) => {
    const id = host ? crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase() : roomId;
    setError("");
    const client = new OnlineRoomClient();
    clientRef.current?.disconnect();
    clientRef.current = client;
    client.onMessage((message) => {
      if (message.type === "room-state") setParticipants(message.participants || []);
      if (message.type === "participant-joined") setParticipants((current) => [...current, message.participant]);
      if (message.type === "participant-left") setParticipants((current) => current.filter((person) => person.id !== message.participantId));
      if (message.type === "ui") onRoomUi?.(message.state);
      if (message.type === "connection-closed") setConnected(false);
    });
    try {
      await client.connect({ id, name: onlineName, host });
      setRoomId(id);
      setConnected(true);
      onRoomClient?.(client, { id, host });
      if (host) client.send("ui", { state: getRoomState?.() || {} });
    }
    catch (connectError) { setError(connectError.message); client.disconnect(); }
  };
  const copyCode = async () => {
    try {
      if (window.electronAPI?.copyText) {
        if (!(await window.electronAPI.copyText(roomId))) throw new Error("Copy failed");
      } else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(roomId);
      else {
        const input = document.createElement("textarea");
        input.value = roomId;
        document.body.append(input);
        input.select();
        if (!document.execCommand("copy")) throw new Error("Copy failed");
        input.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Не удалось скопировать код. Выделите его и скопируйте вручную.");
    }
  };

  useEffect(() => { onConnectedChange?.(connected); }, [connected, onConnectedChange]);

  return createPortal(<div className={`online-room-backdrop ${connected && compact ? "is-docked" : ""}`} onMouseDown={connected && compact ? undefined : onClose}>
    <section className="online-room-modal" onMouseDown={(event) => event.stopPropagation()}>
        {!connected && <button type="button" className="karaoke-settings-close" onClick={onClose} aria-label="Закрыть"><X size={16} /></button>}
      <div className="microphone-panel-title"><UsersRound size={16} /> Совместное исполнение</div>
      {!connected ? <div className="online-room-form">
        {!joinMode ? <>
        <p>Комната получит новый код приглашения автоматически. Отправьте его другу — это не пароль, а адрес комнаты.</p>
        <div className="online-room-actions"><button type="button" className="btn btn-primary" onClick={() => connect(true)}>Создать комнату</button><button type="button" className="btn btn-ghost" onClick={() => setJoinMode(true)}>Войти по коду</button></div>
        </> : <>
        <p>Введите код приглашения, который прислал ведущий комнаты.</p>
        <label>Код приглашения<input className="input" value={roomId} placeholder="Например, E15235FE" maxLength={32} onChange={(event) => setRoomId(event.target.value.toUpperCase())} /></label>
        {error && <p className="karaoke-recording-error">{error}</p>}
        <div className="online-room-actions"><button type="button" className="btn btn-primary" onClick={() => connect(false)}>Войти</button><button type="button" className="btn btn-ghost" onClick={() => setJoinMode(false)}>Назад</button></div>
        </>}
      </div> : <div className="online-room-form">
        <span className="online-room-status">Комната активна</span>
        <div className="online-room-code-row"><strong className="online-room-code">{roomId}</strong><button type="button" className="btn btn-ghost" onClick={copyCode} title="Копировать код">{copied ? <Check size={17} /> : <Copy size={17} />}</button></div>
        <div className="online-room-participants">{participants.map((person) => <span key={person.id}>{person.name}{person.role === "host" ? " · ведущий" : ""}</span>)}</div>
        <button type="button" className="btn btn-ghost" onClick={() => { clientRef.current?.disconnect(); setConnected(false); setParticipants([]); onRoomClient?.(null); onClose(); }}>Выйти из комнаты</button>
      </div>}
    </section>
  </div>, document.body);
}
