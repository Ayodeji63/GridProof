import { KeyRound } from "lucide-react";
import { Link } from "react-router-dom";

export function ReviewerSignInPrompt({ forbidden = false }: { forbidden?: boolean }) {
  return (
    <section className="review-item auth-required" role="alert">
      <div>
        <h2>{forbidden ? "Reviewer access required" : "Reviewer sign-in required"}</h2>
        <p>
          {forbidden
            ? "You are signed in, but this account is not a reviewer or admin. Upgrade it with the invite code in Settings."
            : "This operator area requires an active reviewer or admin session."}
        </p>
      </div>
      <Link className="button-link" to="/settings">
        <KeyRound size={18} aria-hidden="true" />
        {forbidden ? "Manage access" : "Go to Settings"}
      </Link>
    </section>
  );
}
