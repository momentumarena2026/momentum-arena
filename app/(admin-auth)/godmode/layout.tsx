import Image from "next/image";
import Link from "next/link";

export default function GodmodeLayout({
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
          width={200}
          height={65}
          className="opacity-50 hover:opacity-100 transition-opacity"
        />
      </Link>
      {children}
    </div>
  );
}
