import { ArrowDown } from "lucide-react";

export function DivineInvocation() {
  return (
    <section className="divine-invocation" aria-labelledby="invocation-title">
      <div className="invocation-copy">
        <span className="eyebrow invocation-eyebrow">
          <span aria-hidden="true">✦</span> In the presence of the all-seeing
        </span>
        <h2 id="invocation-title">
          Let no flaw
          <br />
          escape <em>the light.</em>
        </h2>
        <p>
          Bring your work before the eye. Let what is hidden be revealed, and
          what is worthy endure.
        </p>
        <a className="invocation-link" href="#pull-request-register">
          Bring forth the changes <ArrowDown size={14} />
        </a>
      </div>
      <div className="invocation-seal" aria-hidden="true">
        <img src="/divine-eye.svg" alt="" width="420" height="360" />
        <span>Nothing hidden · Nothing overlooked</span>
      </div>
      <div className="invocation-rule" aria-hidden="true">
        <span>I / Observe</span>
        <span>II / Discern</span>
        <span>III / Refine</span>
      </div>
    </section>
  );
}
