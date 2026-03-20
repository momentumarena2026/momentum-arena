import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4">
      <Link href="/" className="mb-8">
        <Image
          src="/blackLogo.png"
          alt="Momentum Arena"
          width={180}
          height={60}
          priority
        />
      </Link>
      {children}
    </div>
  );
}
