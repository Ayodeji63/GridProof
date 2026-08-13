import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description: string;
  status?: ReactNode;
};

export function PageHeader({ title, description, status }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-heading">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {status ? <div className="page-status">{status}</div> : null}
    </header>
  );
}

type PanelHeaderProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function PanelHeader({ title, description, action }: PanelHeaderProps) {
  return (
    <header className="panel-header">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </header>
  );
}
