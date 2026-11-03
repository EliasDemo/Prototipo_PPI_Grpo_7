import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trazabilidad académica",
  description: "Prototipo de investigación: auditoría de registros académicos con Hyperledger Fabric",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
