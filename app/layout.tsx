import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "The Pass — Six Degrees of FIFA",
  description:
    "Trace the shortest chain of club and national-team links between any two players in FIFA 15–21, then add yourself to the network.",
  openGraph: {
    title: "The Pass — Every player is closer than you think",
    description:
      "Explore 41,533 players across seven FIFA editions and find the shortest route between them.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "The Pass — Six Degrees of FIFA",
    description: "Find the shortest teammate chain between any two footballers.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
