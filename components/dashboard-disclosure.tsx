import type { ReactNode } from "react";

type DashboardDisclosureProps = {
  children: ReactNode;
  description?: string;
  eyebrow?: string;
  status?: string;
  statusActive?: boolean;
  title: string;
  className?: string;
  contentClassName?: string;
};

export function DashboardDisclosure({
  children,
  description,
  eyebrow,
  status,
  statusActive = false,
  title,
  className = "",
  contentClassName = "p-6"
}: DashboardDisclosureProps) {
  return (
    <details className={`panel group/disclosure overflow-hidden ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-5 px-6 py-5 outline-none transition hover:bg-white/[0.035] focus-visible:bg-white/[0.05] [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-plasma/75">
              {eyebrow}
            </p>
          ) : null}
          <span className={`${eyebrow ? "mt-2" : ""} block text-lg font-semibold text-white`}>
            {title}
          </span>
          {description ? (
            <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-white/52">
              {description}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {status ? (
            <span
              className={`rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] ${
                statusActive
                  ? "border-plasma/35 bg-plasma/10 text-plasma"
                  : "border-white/10 bg-black/25 text-white/55"
              }`}
            >
              {status}
            </span>
          ) : null}
          <span
            aria-hidden="true"
            className="text-lg text-plasma transition-transform duration-200 group-open/disclosure:rotate-180"
          >
            ⌄
          </span>
        </div>
      </summary>

      <div className={`border-t border-white/10 ${contentClassName}`}>{children}</div>
    </details>
  );
}
