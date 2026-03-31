export type StatusTone = "accent" | "success" | "warning" | "danger" | "default";

export interface StatusPillProps {
  readonly tone: StatusTone;
  readonly label: string;
}

function getStatusClassName(tone: StatusTone): string {
  switch (tone) {
    case "accent":
      return "t3-status-pill t3-status-pill-accent";
    case "success":
      return "t3-status-pill t3-status-pill-success";
    case "warning":
      return "t3-status-pill t3-status-pill-warning";
    case "danger":
      return "t3-status-pill t3-status-pill-danger";
    case "default":
      return "t3-status-pill t3-status-pill-default";
  }
}

export function StatusPill({ tone, label }: StatusPillProps) {
  return <span className={getStatusClassName(tone)}>{label}</span>;
}
