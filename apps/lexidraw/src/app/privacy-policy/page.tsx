import type { Metadata } from "next/types";
import { Contact, LegalPage, Operator } from "~/components/legal-page";

export const metadata: Metadata = { title: "Lexidraw | Privacy" };

const PROCESSORS = [
  [
    "Vercel",
    "hosts Lexidraw, stores uploaded images and thumbnails, and counts page views",
  ],
  ["Turso", "hosts the database with your account, files and settings"],
  [
    "OpenAI and Google",
    "run the AI and read-aloud features, when you use them",
  ],
  ["GitHub", "signs you in, if you choose Continue with GitHub"],
  ["Unsplash", "finds images when you search for one"],
  ["Bright Data", "fetches the web pages you save as links"],
  ["Cloudflare", "protects the services that turn pages into text and audio"],
] as const;

export default function PrivacyPolicy() {
  return (
    <LegalPage
      title="Privacy"
      intro={
        <>
          This page says what Lexidraw, run by <Operator />, keeps about you and
          why.
        </>
      }
    >
      <section>
        <h2>What we keep</h2>
        <ul>
          <li>
            Your account: your name, your email address, and your password,
            stored only as a one-way hash. If you sign in with GitHub, we keep
            the account id GitHub gives us instead of a password.
          </li>
          <li>
            Your files: documents, drawings, folders, saved links, comments and
            thumbnails, and who you’ve shared each one with.
          </li>
          <li>Your settings, and your API tokens, stored only as hashes.</li>
          <li>
            Page visits: the page, the page you came from, your browser, your IP
            address and your approximate location (city, region and country).
          </li>
        </ul>
      </section>
      <section>
        <h2>How we use it</h2>
        <p>
          Only to run Lexidraw: to show you your files, to show your name to the
          people you share with, to keep the service secure, and to see which
          pages are used. When you use an AI or read-aloud feature, the text it
          needs is sent to that service. We don’t sell your data or show you
          ads.
        </p>
      </section>
      <section>
        <h2>Services that handle your data</h2>
        <ul>
          {PROCESSORS.map(([name, purpose]) => (
            <li key={name}>
              <strong className="font-medium">{name}</strong> {purpose}.
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Your choices</h2>
        <p>
          You can change your name and email in Settings, and delete any file at
          any time. To delete your account or get a copy of your data,{" "}
          <Contact />.
        </p>
      </section>
      <section>
        <h2>Children</h2>
        <p>Lexidraw isn’t meant for children under 13.</p>
      </section>
      <section>
        <h2>Changes</h2>
        <p>When this page changes, the date at the top changes with it.</p>
      </section>
    </LegalPage>
  );
}
