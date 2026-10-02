import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GraphMind — See how your code thinks",
  description: "Interactive code inspection, step-by-step execution, structure graphs and Big-O benchmarking.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
