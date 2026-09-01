"use client";

export default function Composer({
  value,
  onChange,
  onSend,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  return (
    <div className="composer">
      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          /*
           * Enterは改行。送信は「送る」ボタン（またはPCの ⌘/Ctrl + Enter）だけ。
           *
           * 以前は Enter で送信していたが、文章の途中で誤って送ってしまう
           * 事故が起きた。この会話では一度送った発話を取り消せないので、
           * 「打ち間違いで送られない」ことを優先する。
           */
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={disabled ? "" : "ここに話してみる…"}
      />
      <button onClick={onSend} disabled={disabled}>
        送る
      </button>
    </div>
  );
}
