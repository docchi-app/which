import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Community guidelines · Docchi" };

export default function GuidelinesPage() {
  return (
    <LegalPage
      path="/guidelines"
      title="Community guidelines"
      intro="Docchi is for fun, quick “this or that” questions. Keep it light, keep it kind. Short version: would you be fine with your mum, your friend and a stranger all seeing this poll?"
    >
      <h2>Go for it</h2>
      <ul>
        <li>Everyday dilemmas, food fights, hot takes on movies, cricket, music, tech and life.</li>
        <li>Questions about yourself (“Which haircut?”) and friendly ones for your circle.</li>
        <li>Opinions people can disagree on, as long as nobody is being attacked.</li>
      </ul>

      <h2>Not on Docchi</h2>
      <ul>
        <li><strong>Hate or harassment:</strong> attacking people for religion, caste, gender, sexuality, race, region, disability or looks; bullying, mocking or “rate this person” polls about someone who didn&apos;t agree to it.</li>
        <li><strong>Real names and private details</strong> of anyone else: phone numbers, addresses, photos, school or workplace.</li>
        <li><strong>Sexual content</strong>, and anything at all sexualising minors (reported to the authorities).</li>
        <li><strong>Violence or threats</strong>, glorifying violence, or encouraging self-harm.</li>
        <li><strong>Spam and scams:</strong> ads, links to make money, fake giveaways, repeated or copy-paste polls.</li>
        <li><strong>Illegal things:</strong> drugs, weapons, gambling or anything else that breaks Indian law.</li>
        <li><strong>Misleading people</strong> on health, elections or emergencies, or pretending to be someone else (including Docchi).</li>
      </ul>

      <h2>If you see something</h2>
      <p>
        Tap <strong>⋯ → Report</strong> on the poll, or <strong>Report</strong> on the person&apos;s profile. Reports are
        anonymous. A poll that several people report is hidden straight away until we review it. You can also block
        anyone from their profile.
      </p>

      <h2>What we do</h2>
      <ul>
        <li>Remove polls that break these rules.</li>
        <li>Ban accounts for serious or repeated breaks. A ban stops voting and posting and hides that person&apos;s polls.</li>
        <li>Keep removed polls and reports for a while so we can review appeals and help the authorities when the law requires it.</li>
      </ul>
      <p>Think we got it wrong? Write to us (below) and we&apos;ll take another look.</p>
    </LegalPage>
  );
}
