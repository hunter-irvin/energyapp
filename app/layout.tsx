import type { ReactNode } from "react";

export const metadata = {
  title: "Merchant BESS Arbitrage PoC",
  description: "Day-ahead BESS arbitrage planning and optimization.",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
