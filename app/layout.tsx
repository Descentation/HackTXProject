export const metadata = { title: "Light Coach", description: "Live lighting score and spoken directions for video calls" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fdfaf3", color: "#3b2f1d" }}>
        {children}
      </body>
    </html>
  );
}
