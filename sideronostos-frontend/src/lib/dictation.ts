/** Browser speech adapter, independent of React, farm data and model providers. */
export type DictationSnapshot = {
  phase: "idle" | "starting" | "listening" | "finishing";
  preview: string;
  error: string | null;
};
export type RecognitionPort = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult:
    | ((event: {
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal: boolean }
        >;
      }) => void)
    | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type Options = {
  create: () => RecognitionPort | null;
  language: string;
  onSnapshot: (value: DictationSnapshot) => void;
  onText: (text: string) => void;
};
export function browserRecognition(): RecognitionPort | null {
  if (typeof window === "undefined") return null;
  const host = window as unknown as {
    SpeechRecognition?: new () => RecognitionPort;
    webkitSpeechRecognition?: new () => RecognitionPort;
  };
  const Constructor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  return Constructor ? new Constructor() : null;
}
export function createDictation({
  create,
  language,
  onSnapshot,
  onText,
}: Options) {
  type Session = {
    port: RecognitionPort;
    phase: DictationSnapshot["phase"];
    final: string;
    preview: string;
    limit?: ReturnType<typeof setTimeout>;
    deadline?: ReturnType<typeof setTimeout>;
  };
  let current: Session | null = null;
  function cancel(error: string | null = null) {
    const old = current;
    current = null;
    if (old) {
      clearTimeout(old.limit);
      clearTimeout(old.deadline);
      try {
        old.port.abort();
      } catch {
        /* Already disconnected. */
      }
    }
    onSnapshot({ phase: "idle", preview: "", error });
  }
  function finish() {
    if (!current || current.phase === "finishing") return;
    if (current.phase === "starting") {
      cancel("麦克风尚未就绪。允许权限后，请再次按住说话。");
      return;
    }
    const session = current;
    session.phase = "finishing";
    clearTimeout(session.limit);
    onSnapshot({ phase: "finishing", preview: session.preview, error: null });
    session.deadline = setTimeout(() => {
      if (current === session) cancel("语音转写没有完成，请重试或直接打字。");
    }, 8000);
    try {
      session.port.stop();
    } catch {
      cancel("语音已中断，请重试。");
    }
  }
  function start() {
    if (current) return;
    let port: RecognitionPort | null;
    try {
      port = create();
    } catch {
      port = null;
    }
    if (!port) {
      cancel("此浏览器暂不支持语音输入，可使用系统听写或直接打字。");
      return;
    }
    const session: Session = {
      port,
      phase: "starting",
      final: "",
      preview: "",
    };
    current = session;
    const valid = () => current === session;
    port.lang = language;
    port.interimResults = true;
    port.continuous = true;
    port.onstart = () => {
      if (!valid()) {
        try {
          port.abort();
        } catch {}
        return;
      }
      session.phase = "listening";
      clearTimeout(session.deadline);
      session.limit = setTimeout(finish, 60000);
      onSnapshot({ phase: "listening", preview: "", error: null });
    };
    port.onresult = (event) => {
      if (!valid()) return;
      const results = Array.from(event.results);
      session.final = results
        .filter((r) => r.isFinal)
        .map((r) => r[0]?.transcript ?? "")
        .join("")
        .trim();
      session.preview = results
        .map((r) => r[0]?.transcript ?? "")
        .join("")
        .trim();
      onSnapshot({
        phase: session.phase,
        preview: session.preview,
        error: null,
      });
    };
    port.onerror = (event) => {
      if (!valid()) return;
      const errors: Record<string, string> = {
        "not-allowed":
          "未获得麦克风权限。请在浏览器的网站设置中允许麦克风，或直接打字。",
        "service-not-allowed":
          "浏览器的语音服务不可用，可以使用系统听写或直接打字。",
        "audio-capture": "没有找到可用麦克风，请检查设备后重试。",
        network: "语音服务连接不上，请检查网络后重试，或直接打字。",
        "no-speech": "没有听清，请再次按住说话。",
        "language-not-supported": "语音服务暂不支持当前语言，可使用系统听写。",
      };
      cancel(errors[event.error] ?? "语音已中断，请重试或直接打字。");
    };
    port.onend = () => {
      if (!valid()) return;
      const text = session.final;
      current = null;
      clearTimeout(session.limit);
      clearTimeout(session.deadline);
      onSnapshot({
        phase: "idle",
        preview: "",
        error: text ? null : "没有听清，请再次按住说话。",
      });
      if (text) onText(text);
    };
    onSnapshot({ phase: "starting", preview: "", error: null });
    session.deadline = setTimeout(() => {
      if (valid()) cancel("麦克风未能启动，请检查权限后重试。");
    }, 15000);
    try {
      port.start();
    } catch {
      cancel("语音输入无法启动，请检查麦克风权限后重试。");
    }
  }
  return { start, finish, cancel };
}
