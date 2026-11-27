import type { Metadata, Viewport } from "next";
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

const APP_DESCRIPTION =
  "Local-first web & macOS/Windows/Linux desktop studio for turning videos, Live Photos, HEICs, SVGs, and dotLottie into GIF, WebP, AVIF, APNG, WebM, MOV alpha, Sprite Sheets, Lottie & SVG — 100% offline.";

export const metadata: Metadata = {
  title: {
    default: "GIF Studio — Local-First Motion, Video & Animation Maker",
    template: "%s | GIF Studio",
  },
  description: APP_DESCRIPTION,
  applicationName: "GIF Studio",
  authors: [{ name: "Edgars Kalniņš", url: "https://github.com/EdgarsKalnins" }],
  creator: "Edgars Kalniņš",
  publisher: "Momentbox.lv",
  keywords: [
    "gif maker",
    "gif studio",
    "video to gif",
    "electron desktop app",
    "iphone heic to gif",
    "live photo mov to gif",
    "animated webp avif apng",
    "dotlottie svg converter",
    "ken burns gif maker",
    "boomerang gif generator",
    "momentbox",
    "riga",
    "latvia",
    "local first gif studio",
    "open source mit",
  ],
  openGraph: {
    title: "GIF Studio — Local-First Motion, Video & Animation Maker",
    description: APP_DESCRIPTION,
    type: "website",
    siteName: "GIF Studio",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "GIF Studio — Local-First Motion, Video & Animation Maker",
    description: APP_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f3ef" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
  colorScheme: "dark light",
};

const SOFTWARE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "GIF Studio",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "macOS, Windows, Linux",
  license: "https://opensource.org/licenses/MIT",
  isAccessibleForFree: true,
  description: APP_DESCRIPTION,
  featureList: [
    "iPhone HEIC, HEIF, animated GIF frame splitting, JPEG, PNG, and Live Photo MOV/MP4 ingestion",
    "Ken Burns, Zoom, Pan, Bounce, Camera Shake, and Pulse synthetic photo motion",
    "Clean, Polaroid, and 35mm Film framing borders with rounded corners",
    "Two-pass FFmpeg palette GIF, transparent RGBA sticker GIF/WebP, and H.264 MP4 export",
    "100% local zero-telemetry architecture",
  ],
  author: {
    "@type": "Person",
    name: "Edgars Kalniņš",
    url: "https://github.com/EdgarsKalnins",
    affiliation: {
      "@type": "Organization",
      name: "Momentbox.lv",
      url: "https://momentbox.lv",
    },
  },
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

const THEME_INIT_SCRIPT = `(function(){try{var r=document.documentElement;var t=localStorage.getItem('gif_studio_theme');var d=t!=='light';if(d){r.classList.add('dark');r.style.colorScheme='dark';}else{r.classList.remove('dark');r.style.colorScheme='light';}var a=localStorage.getItem('gif_studio_accent')||'amber';r.setAttribute('data-accent',a);var rad=localStorage.getItem('gif_studio_radius')||'balanced';r.setAttribute('data-radius',rad);var f=localStorage.getItem('gif_studio_font')||'technical';r.setAttribute('data-font',f);var isz=localStorage.getItem('gif_studio_icon_size')||'default';r.setAttribute('data-icon-size',isz);}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#f4f3ef] text-zinc-900 dark:bg-[#09090b] dark:text-zinc-100 font-sans selection:bg-[var(--studio-accent-soft)] selection:text-[var(--studio-accent-text)]">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_JSON_LD) }}
        />
      </body>
    </html>
  );
}
