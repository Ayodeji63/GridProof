import { KeyRound } from "lucide-react";
import { Link } from "react-router-dom";

export function ReviewerSignInPrompt() {
  return (
    <section className="review-item auth-required" role="alert">
      <div>
        <p className="eyebrow">Protected operator area</p>
        <h2>Reviewer sign-in required</h2>
        <p>Sign in with a reviewer or admin account to access this page.</p>
      </div>
      <Link className="button-link" to="/settings">
        <KeyRound size={18} aria-hidden="true" />
        Go to Settings
      </Link>
    </section>
  );
}
