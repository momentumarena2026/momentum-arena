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
    <div onClick={() => trackHomepageSportClick(sport)}>
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
    <div onClick={() => trackHomepageCafeClick()}>
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
    <div onClick={() => trackHomepageCallClick()}>
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
    <div onClick={() => trackHomepageDirectionsClick()}>
      {children}
    </div>
  );
}
