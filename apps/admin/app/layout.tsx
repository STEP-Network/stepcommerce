import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata = { title: 'STEP Commerce — Admin' };

const NAV = [
  ['/', 'Dashboard'],
  ['/widgets', 'Widgets'],
  ['/advertisers', 'Annoncører'],
  ['/sites', 'Sites'],
  ['/templates', 'Skabeloner'],
  ['/preview', 'Preview'],
  ['/health', 'Health'],
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body>
        <header>
          <span className="brand">
            <b>STEP</b> Commerce
          </span>
          <nav>
            {NAV.map(([href, label]) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
