import type { Metadata } from "next/types";
import { Contact, LegalPage, Operator } from "~/components/legal-page";

export const metadata: Metadata = { title: "Lexidraw | Terms" };

export default function TermsOfService() {
  return (
    <LegalPage
      title="Terms"
      intro={
        <>
          These terms cover your use of Lexidraw, run by <Operator />. By using
          Lexidraw you agree to them; if you don’t, please don’t use it.
        </>
      }
    >
      <section>
        <h2>Your files are yours</h2>
        <p>
          You own what you create. You let us store, process and show it only to
          run Lexidraw for you: showing it to the people you share it with,
          drawing its thumbnail, and sending it to an AI or voice service when
          you use those features.
        </p>
      </section>
      <section>
        <h2>Sharing</h2>
        <p>
          You decide who can open your files. A file set to “Anyone with the
          link” opens for anyone who has the link, without signing in, so share
          such links with care.
        </p>
      </section>
      <section>
        <h2>Using Lexidraw fairly</h2>
        <p>Please don’t use Lexidraw to:</p>
        <ul>
          <li>break the law or help someone else break it,</li>
          <li>spread malware, or attack Lexidraw or its users,</li>
          <li>infringe someone else’s copyright or other rights,</li>
          <li>
            collect other people’s personal details without their consent.
          </li>
        </ul>
      </section>
      <section>
        <h2>AI features</h2>
        <p>
          AI answers and suggestions can be wrong. Check anything that matters
          before you rely on it.
        </p>
      </section>
      <section>
        <h2>No guarantees</h2>
        <p>
          Lexidraw is provided as it is, without warranties. Features can change
          or stop, and it can be unavailable at times. Keep your own copies of
          anything important: documents export to Markdown and PDF, drawings to
          Excalidraw files.
        </p>
      </section>
      <section>
        <h2>Ending your use</h2>
        <p>
          You can stop using Lexidraw at any time. We may suspend an account
          that breaks these terms.
        </p>
      </section>
      <section>
        <h2>Questions</h2>
        <p>
          To ask about these terms, <Contact />.
        </p>
      </section>
    </LegalPage>
  );
}
