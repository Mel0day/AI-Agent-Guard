import type { RiskLevel } from "../types";

interface RiskBadgeProps {
  level: RiskLevel;
  size?: "sm" | "md";
}

const CONFIG: Record<
  RiskLevel,
  { label: string; className: string }
> = {
  CRITICAL: {
    label: "CRITICAL",
    className:
      "bg-red-900/60 text-red-300 border border-red-700/60 font-semibold",
  },
  WARN: {
    label: "WARN",
    className:
      "bg-orange-900/60 text-orange-300 border border-orange-700/60 font-semibold",
  },
  INFO: {
    label: "INFO",
    className:
      "bg-blue-900/60 text-blue-300 border border-blue-700/60 font-medium",
  },
};

export default function RiskBadge({ level, size = "sm" }: RiskBadgeProps) {
  const { label, className } = CONFIG[level];
  const sizeClass = size === "sm" ? "text-xs px-1.5 py-0.5" : "text-sm px-2 py-1";

  return (
    <span className={`inline-block rounded ${sizeClass} ${className} font-mono tracking-wide`}>
      {label}
    </span>
  );
}
