import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'F-ComFlow — Social Commerce OS',
  description: 'Unified inbox, AI order parsing, inventory, couriers and payments for Bangladeshi f-commerce.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
