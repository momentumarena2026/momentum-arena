import Link from "next/link";
import Image from "next/image";

/**
 * Logo-only bar for payment screens (booking + cafe checkout): keeps a
 * way home without the full nav's links, chips and bell competing for
 * attention while the customer pays.
 */
export function MinimalHeader() {
  return (
    <nav className="border-b border-zinc-800 bg-zinc-950">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center">
          <Link href="/">
            <Image
              src="/blackLogo.png"
              alt="Momentum Arena"
              width={240}
              height={80}
              className="h-14 w-auto sm:h-24"
            />
          </Link>
        </div>
      </div>
    </nav>
  );
}
