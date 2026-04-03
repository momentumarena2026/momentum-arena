import { isGeneratorPinVerified } from "@/lib/generator-pin";
import { PinGate } from "../../components/pin-gate";
import { GeneratorFuelMobile } from "./fuel-mobile";

export default async function GeneratorFuelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const verified = await isGeneratorPinVerified();

  return (
    <PinGate verified={verified}>
      <GeneratorFuelMobile generatorId={id} />
    </PinGate>
  );
}
