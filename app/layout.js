export const metadata = {
  title: "Triage",
  description: "Decide, correct, and act on what the routines found.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#101822",
          fontFamily:
            "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {children}
      </body>
    </html>
  );
}
