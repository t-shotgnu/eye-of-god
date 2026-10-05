import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { ArrowRight, FileCode2, GitPullRequest, Settings2 } from "lucide-react";
import { useConfiguration } from "./configuration-context";

export function AppLayout({ children }: { children: ReactNode }) {
  const { config } = useConfiguration();

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/">
          <img src="/observation.svg" alt="" width="38" height="38" />
          <span>
            Eye of God
            <span className="brand-sub">Thy work shall be seen</span>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>
            <GitPullRequest size={17} /> Pull requests
          </NavLink>
          <NavLink to="/sandbox">
            <FileCode2 size={17} /> Sandbox
          </NavLink>
          <NavLink to="/settings">
            <Settings2 size={17} /> Settings
          </NavLink>
        </nav>
        <span className="connection">
          {config.settings.demo
            ? "Demo workspace"
            : config.settings.repository || "Azure DevOps"}
        </span>
      </header>
      {config.settings.demo && (
        <div className="demo-banner">
          <span>DEMO</span> Local sample pull requests{" "}
          <Link to="/settings">
            Connect Azure DevOps <ArrowRight size={13} />
          </Link>
        </div>
      )}
      {children}
      <footer>
        <span>
          Eye of God <span className="muted">/ Azure Repos</span>
        </span>
        <span className="footer-creed">
          <span aria-hidden="true">✦</span> All is seen. Human judgement comes
          last.
        </span>
      </footer>
    </div>
  );
}
