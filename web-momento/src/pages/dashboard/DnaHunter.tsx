import { DnaLab } from "@/components/v64/DnaLab";

/** DNA Hunter — band-alphabet k-mer scanning toward the next ≥2× round. */
export default function DnaHunter() {
  return (
    <DnaLab
      title="DNA Hunter"
      subtitle="Sequence DNA of the full round history: every k-mer of the chosen alphabet is tested against the next round's target band, with Wilson CIs, z-scores and a multiple-comparison verdict. Filter by range, schedule scans on the deep tier, watch the live context chain."
      defaults={{ alphabet: "band", targetLo: 2, kMin: 2, kMax: 6, minSupport: 40 }}
    />
  );
}
