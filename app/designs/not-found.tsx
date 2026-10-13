import Link from "next/link";

export default function DesignsNotFound() {
  return (
    <main style={{ maxWidth: 560, margin: "12vh auto", padding: 24 }}>
      <h1>Səhifə tapılmadı</h1>
      <p>Bu səhifə hazırda əlçatan deyil.</p>
      <Link href="/">İş axınına qayıt</Link>
    </main>
  );
}
