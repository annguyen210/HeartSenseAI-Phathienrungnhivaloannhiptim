"use client";

import { useEffect, useState } from "react";

type Health = { ok: boolean; name: string; version: string };

export default function HomePage() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000"}/health`)
      .then((response) => response.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <main style={{ padding: 32, maxWidth: 1100, margin: "0 auto" }}>
      <section style={{ padding: 24, borderRadius: 24, background: "white", boxShadow: "0 20px 50px rgba(17,37,65,0.08)" }}>
        <p style={{ color: "#d94b63", fontWeight: 700 }}>HEARTSENSE Production Web</p>
        <h1 style={{ marginTop: 0 }}>Next.js web app scaffold san sang de noi voi API, DB va TensorFlow.js.</h1>
        <p>
          Trang nay la khung production song song voi prototype goc. Ban se dua camera, TensorFlow.js Face rPPG, OCR that,
          auth that va notification vao day.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16, marginTop: 20 }}>
          <article style={{ padding: 16, borderRadius: 18, background: "#f4f8fb" }}>
            <strong>API</strong>
            <p>{health ? `${health.name} ${health.version}` : "Dang cho ket noi API"}</p>
          </article>
          <article style={{ padding: 16, borderRadius: 18, background: "#f4f8fb" }}>
            <strong>Face rPPG</strong>
            <p>TensorFlow.js + ROI facial landmarks + POS signal extraction.</p>
          </article>
          <article style={{ padding: 16, borderRadius: 18, background: "#f4f8fb" }}>
            <strong>OCR / Reminder</strong>
            <p>Tesseract.js pipeline va parser ten thuoc/lieu dung.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
