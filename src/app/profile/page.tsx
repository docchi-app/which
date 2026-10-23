import { AccountCard } from "@/components/AccountCard";
import { ComingSoon } from "@/components/ComingSoon";

export default function ProfilePage() {
  return (
    <ComingSoon section="profile" title="Your profile" blurb="Your polls, votes received and best rank will live here.">
      <AccountCard />
    </ComingSoon>
  );
}
