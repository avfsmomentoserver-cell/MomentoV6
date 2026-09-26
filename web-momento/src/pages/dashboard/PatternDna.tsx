import { DnaLab } from "@/components/v64/DnaLab";

/** Pattern DNA — Aviator colour/tempo alphabets toward pink (≥10×) rounds. */
export default function PatternDna() {
  return (
    <DnaLab
      title="Pattern DNA"
      subtitle="Colour-and-tempo DNA: blue / purple / pink sequences (uppercase = a long wait before the round) scanned against the next pink. Change alphabet, k window, target band and the analysed range; every scan is honest about how many hits chance alone would produce."
      defaults={{ alphabet: "hue", targetLo: 10, kMin: 2, kMax: 8, minSupport: 30 }}
    />
  );
}
