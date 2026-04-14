"use client";

import {
  trackHomepageSportClick,
  trackHomepageCafeClick,
  trackHomepageCallClick,
  trackHomepageDirectionsClick,
} from "@/lib/analytics";

export function HomepageSportTracker({
  sport,
  children,
}: {
  sport: string;
  children: React.ReactNode;
}) {
  return (
    <div onClick={() => trackHomepageSportClick(sport)} className="contents">
      {children}
    </div>
  );
}

export function HomepageCafeTracker({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div onClick={() => trackHomepageCafeClick()} className="contents">
      {children}
    </div>
  );
}

export function HomepageCallTracker({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div onClick={() => trackHomepageCallClick()} className="contents">
      {children}
    </div>
  );
}

export function HomepageDirectionsTracker({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div onClick={() => trackHomepageDirectionsClick()} className="contents">
      {children}
    </div>
  );
}
