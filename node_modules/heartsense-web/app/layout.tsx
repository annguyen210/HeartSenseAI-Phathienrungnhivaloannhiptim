export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body style={{ margin: 0, fontFamily: "Segoe UI, sans-serif", background: "#eef4f7", color: "#163150" }}>
        {children}
      </body>
    </html>
  );
}
