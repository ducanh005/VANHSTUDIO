import type { AppProps } from 'next/app';
import Head from 'next/head';
import '../styles/globals.css';

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <title>VanhStudio</title>
      </Head>
      <div className="min-h-screen bg-bg text-text font-sans antialiased">
        <Component {...pageProps} />
      </div>
    </>
  );
}