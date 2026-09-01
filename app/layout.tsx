import "./globals.css";
import { themeInlineScript } from "../lib/theme-time";

export const metadata = { title: "LOGGLYPH Pilot", description: "LOGGLYPH conversation pilot" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <head>
        {/*
          時間帯によって背景色を変える。
          サーバー時刻はUTCなので、必ずクライアントの現地時刻で決める。
          ハイドレーション後に適用すると一瞬だけ既定色が見えるため、
          body の描画前に実行する。失敗しても :root の既定値（＝昼）が残る。
        */}
        <script dangerouslySetInnerHTML={{ __html: themeInlineScript() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
