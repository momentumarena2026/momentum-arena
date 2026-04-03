import { isGeneratorPinVerified } from "@/lib/generator-pin";
import { PinGate } from "../../components/pin-gate";
import { GeneratorRunMobile } from "./run-mobile";

export default async function GeneratorRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const verified = await isGeneratorPinVerified();

  return (
    <PinGate verified={verified}>
      <GeneratorRunMobile generatorId={id} />
    </PinGate>
  );
}
